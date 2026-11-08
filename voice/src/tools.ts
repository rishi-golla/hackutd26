// Nemotron's tools for a voice turn (voice/README.md "Nemotron tools"). Every call is traced. Guardrails:
// medications are never logged by the model (only the read-back parser and the camera do), doses and allergies
// are judged only by the deterministic checks, and the model's speech goes through the policy layer.
import type { Conn } from './db';
import { activeIncident, step } from './db';
import { CONFIG } from './config';
import type { ToolDef } from './llm';
import { checkAllergy, checkDoseRange } from './checks';
import { fetchRecord, searchPatients } from './ehr';
import { hhmm, readState, summarize, tsMs } from './state';
import type { Policy } from './policy';

export const TOOLS: ToolDef[] = [
  { type: 'function', function: { name: 'get_state', description: 'The live state: incident, patient record, vitals, CPR, timers, recent events and transcript.', parameters: { type: 'object', properties: {} } } },
  {
    type: 'function',
    function: { name: 'get_recent_transcript', description: 'The last n things the medic said.', parameters: { type: 'object', properties: { n: { type: 'integer', default: 10 } } } },
  },
  { type: 'function', function: { name: 'get_timeline', description: 'All events this incident with time, status and sources.', parameters: { type: 'object', properties: {} } } },
  {
    type: 'function',
    function: {
      name: 'log_event',
      description: 'Log one clinical fact that was said, to the medic or not: a procedure, an airway device, a finding or a MARK note. One call per distinct fact. NOT for medications or shocks: those are logged automatically from the read-back.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['airway', 'procedure', 'finding', 'mark', 'cpr_started'], description: 'cpr_started = the medic says CPR or compressions are starting (label "CPR started"); airway = airway device placed; procedure = IV/IO access, pulse check, suction, splint, monitor, etc.; finding = something observed or reported (breathing, skin, pupils, bleeding, pain, injuries, mental status, history from a bystander, pill bottles, scene hazards); mark = a MARK note' },
          label: { type: 'string', description: 'Short timeline label, e.g. "Airway placed (i-gel)", "IO access right tibia", "Breathing shallow", "Skin pale and sweaty", "Pill bottle by the bed"' },
          detail: { type: 'string', description: 'The medic\'s words' },
        },
        required: ['kind', 'label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_status',
      description: 'Change the incident status when the medic states it plainly: arrest (no pulse, cardiac arrest), rosc (pulse is back), en_route (transporting). Starting CPR is not a status: log_event kind cpr_started.',
      parameters: { type: 'object', properties: { status: { type: 'string', enum: ['arrest', 'rosc', 'en_route'] }, detail: { type: 'string', description: 'the medic\'s words' } }, required: ['status'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_dose_range',
      description: 'Deterministic protocol dose check (epinephrine 0.3–1 mg, amiodarone 150–300 mg).',
      parameters: { type: 'object', properties: { drug: { type: 'string' }, dose: { type: 'number' }, unit: { type: 'string' } }, required: ['drug', 'dose', 'unit'] },
    },
  },
  {
    type: 'function',
    function: { name: 'check_allergy', description: 'Deterministic check of a drug against the pulled record\'s allergy list.', parameters: { type: 'object', properties: { drug: { type: 'string' } }, required: ['drug'] } },
  },
  {
    type: 'function',
    function: {
      name: 'search_ehr',
      description: 'Search the EHR by full name and birth date (YYYY-MM-DD). Only when the medic gave both. Several matches: ask which, never guess.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, birth_date: { type: 'string' } }, required: ['name', 'birth_date'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pull_record',
      description: 'Identify the patient and pull their record into the incident. Use the id from search_ehr. The spoken summary is produced automatically.',
      parameters: { type: 'object', properties: { patient_id: { type: 'string' } }, required: ['patient_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'speak',
      description: 'Say something to the medic, once per line, only when the line was meant for you. At most 30 words, plain conversational wording; facts about the patient and incident only from the state and tool results. Advisory protocol wording ("Consider…"), never an order.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
];

const W6_TOOLS = new Set(['search_ehr', 'pull_record']);

/** The tool list for a turn. With VOICE_W6=off the EHR tools are not offered (the bodycam lane runs W6). */
export function toolsFor(w6: boolean): ToolDef[] {
  return w6 ? TOOLS : TOOLS.filter(t => !W6_TOOLS.has(t.function.name));
}

export type ToolContext = {
  conn: Conn;
  policy: Policy;
  /** Everything the model has seen this turn; numbers it speaks must come from here. */
  corpus: string[];
  /** W6 hook on the brain (pulls, saves, speaks the summary; deduplicated). */
  pullRecord: (patientRef: string, method: string) => Promise<string>;
  /** False once the incident this turn started under is gone; speech is dropped instead of queued. */
  valid: () => boolean;
  /** What the medic said this turn; status changes must be stated in it, not inferred. */
  utterance: string;
  /** Reads an action (procedure, airway) back and asks "Log it?"; the brain owns the pending confirmation. */
  confirmAction: (kind: string, label: string) => Promise<void>;
};

/** Actions are read back and confirmed like medications; findings and marks are logged quietly. */
const CONFIRMED_KINDS = new Set(['airway', 'procedure']);
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const sameLabel = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const STATUS_WORDS: Record<string, RegExp> = {
  arrest: /\b(no pulse|pulseless|cardiac arrest|in arrest|coding)\b/i,
  rosc: /\b(rosc|pulse (is |came )?back|got a pulse|we have a pulse|return of (spontaneous )?circulation)\b/i,
  en_route: /\b(transport\w*|en route|loading|leaving (the )?scene|rolling|heading to)\b/i,
};
/**
 * The status shortcut with no model turn (brain.ts) only takes phrases that can't mean anything else. "no pulse ox
 * reading", "loading the epi", "rolling him", "check for ROSC" are not status changes: those lines go to Nemotron,
 * which still needs STATUS_WORDS in the line to set a status.
 */
export const STATUS_PLAIN: Record<'arrest' | 'rosc' | 'en_route', RegExp> = {
  // "no pulse" but not a pulse ox, and not a limb ("no pulse in the left foot").
  arrest: /\b(cardiac arrest|pulseless|no pulse(?!\s*-?\s*ox)(?!\s+(?:in|on|at)\b))\b/i,
  rosc: /\b(we(?:'ve| have)? got (?:a pulse|rosc)|we have (?:a pulse|rosc)|got a pulse back|pulse is back|rosc achieved|return of spontaneous circulation)\b/i,
  en_route: /\b(en route|we're transporting|transporting now|leaving (?:the )?scene)\b/i,
};
/** Conditional, hypothetical or negated wording: never a status change without the model ("in case he arrests",
 *  "he's not in cardiac arrest", "we're not transporting now"). */
export const NOT_PLAIN = /\b(?:if|in case|might|may|could|possible|suspected|risk|watch(?:ing)? for|worried|about to|going to|before|check(?:ing)? for|not|no longer|never)\b|n't\b/i;

/** CPR starting is not a status (spec change log Sun ~02:15): it is `log_event('cpr_started')`, which the module
 *  turns into the CPR start (cycle timer, CPR stats, and the arrest if there isn't one yet). */
export const CPR_START = /\b(start(?:ing|ed)?|begin(?:ning)?|initiat(?:e|ing|ed))\s+(?:chest\s+)?(cpr|compressions)\b/i;

/** Log the CPR start once per 10 minutes. Returns false when it was already on the timeline. */
export async function logCprStarted(conn: Conn, utterance: string): Promise<boolean> {
  const s = readState(conn);
  if (s.events.some(e => e.kind === 'cpr_started' && Date.now() - tsMs(e.ts) < DUPLICATE_WINDOW_MS)) return false;
  await conn.reducers.logEvent({ kind: 'cpr_started', label: 'CPR started', sourceKind: 'voice', sourceDetail: utterance.slice(0, 200) });
  await step(conn, 'log_event', 'cpr_started: CPR started (medic said so)');
  return true;
}

const j = (v: unknown) => JSON.stringify(v);

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { conn } = ctx;
  const inc = activeIncident(conn);
  const remember = (out: string) => {
    ctx.corpus.push(out);
    return out;
  };
  if (W6_TOOLS.has(name) && !CONFIG.w6) return j({ error: 'the EHR lookup is handled by the bodycam (VOICE_W6=off)' });
  switch (name) {
    case 'get_state': {
      await step(conn, 'get_state', 'state summary');
      return remember(summarize(readState(conn)));
    }
    case 'get_recent_transcript': {
      const n = Math.min(30, Math.max(1, Number(args.n ?? 10)));
      const s = readState(conn);
      await step(conn, 'get_recent_transcript', `${n} lines`);
      return remember(j(s.transcript.slice(-n).map(t => ({ time: hhmm(t.ts), text: t.text }))));
    }
    case 'get_timeline': {
      const s = readState(conn);
      await step(conn, 'get_timeline', `${s.events.length} events`);
      return remember(j(s.events.map(e => ({ id: Number(e.id), time: hhmm(e.ts), kind: e.kind, label: e.label, status: e.status, sources: [...new Set(e.sources.map(x => x.kind))] }))));
    }
    case 'log_event': {
      const kind = String(args.kind ?? '');
      if (kind === 'cpr_started') {
        if (!inc) return j({ error: 'no active incident' });
        if (!CPR_START.test(ctx.utterance)) {
          await step(conn, 'log_event', `Refused cpr_started: the medic didn't say CPR is starting ("${ctx.utterance.slice(0, 60)}")`);
          return j({ error: 'the medic did not say CPR or compressions are starting; do nothing' });
        }
        return j((await logCprStarted(conn, ctx.utterance)) ? { ok: true, note: 'CPR start logged. Do not speak about it.' } : { error: 'CPR start already on the timeline' });
      }
      if (!['airway', 'procedure', 'finding', 'mark'].includes(kind)) {
        await step(conn, 'log_event', `Refused kind "${kind}": medications and shocks come only from the read-back or the camera`);
        return j({ error: 'only airway, procedure, finding or mark; medications and shocks are logged by the read-back system' });
      }
      if (!inc) return j({ error: 'no active incident' });
      const label = String(args.label ?? '').slice(0, 80);
      if (!label) return j({ error: 'label required' });
      // A line that carries a dose is a medication statement, however garbled: the read-back owns it entirely.
      if (/\b(\d+(?:\.\d+)?\s*(mg|mcg|g|ml)|milligrams?|micrograms?|one of|a milligram)\b/i.test(ctx.utterance)) {
        await step(conn, 'log_event', `Refused "${label}": the medic's line carries a dose, so it is a medication statement`);
        return j({ error: 'the medic stated a dose, so this is a medication statement handled by the read-back system; do nothing' });
      }
      // A "something administered / 1 mg" label is a medication (or a garbled drug name): never a procedure.
      if (/\b(administer\w*|given|gave|pushed|push|mg|mcg|milligrams?|micrograms?|dose|units?|shock\w*|defib\w*|joules?)\b/i.test(label)) {
        await step(conn, 'log_event', `Refused "${label}": looks like a medication or a garbled drug; the read-back owns those`);
        return j({ error: 'that looks like a medication or a shock, or an unclear word; those are logged by the read-back system. If the word was unclear, do nothing.' });
      }
      if (kind !== 'mark' && /\?\s*$/.test(ctx.utterance)) {
        await step(conn, 'log_event', `Refused "${label}": the line was a question, not a clinical fact`);
        return j({ error: 'a question is not a finding or a procedure; log nothing for it' });
      }
      const s = readState(conn);
      if (s.events.some(e => e.kind === kind && e.status !== 'cancelled' && sameLabel(e.label, label) && Date.now() - tsMs(e.ts) < DUPLICATE_WINDOW_MS)) {
        await step(conn, 'log_event', `Skipped "${label}": already on the timeline`);
        return j({ error: 'already on the timeline; do not log it again' });
      }
      await conn.reducers.logEvent({ kind, label, sourceKind: 'voice', sourceDetail: String(args.detail ?? label).slice(0, 200) });
      await step(conn, 'log_event', `${kind}: ${label}`);
      if (CONFIRMED_KINDS.has(kind)) {
        await ctx.confirmAction(kind, label);
        return j({ ok: true, note: 'logged as unconfirmed; the medic was read it back and asked "Log it?" automatically. Do not speak about it.' });
      }
      return j({ ok: true, note: 'logged quietly. Do not acknowledge it out loud.' });
    }
    case 'set_status': {
      const status = String(args.status ?? '');
      if (!['arrest', 'rosc', 'en_route'].includes(status)) return j({ error: 'status must be arrest, rosc or en_route' });
      if (!inc) return j({ error: 'no active incident' });
      if (inc.status === status) return j({ ok: true, note: `already ${status}` });
      if (!STATUS_WORDS[status].test(ctx.utterance)) {
        await step(conn, 'set_status', `Refused ${status}: the medic didn't say so ("${ctx.utterance.slice(0, 60)}")`);
        return j({ error: `the medic did not plainly state ${status}; do nothing` });
      }
      await conn.reducers.setStatus({ status, sourceKind: 'voice', sourceDetail: ctx.utterance.slice(0, 200) });
      await step(conn, 'set_status', `${inc.status} → ${status} (medic said so)`);
      return j({ ok: true, status });
    }
    case 'check_dose_range': {
      const out = checkDoseRange(String(args.drug ?? ''), Number(args.dose), String(args.unit ?? 'mg'));
      await step(conn, 'check_dose_range', `${args.drug} ${args.dose} ${args.unit}: ${out.verdict}`);
      return remember(j(out));
    }
    case 'check_allergy': {
      const s = readState(conn);
      const out = checkAllergy(String(args.drug ?? ''), s.record?.allergies ?? []);
      await step(conn, 'check_allergy', `${args.drug}: ${out.allergic ? `ALLERGY (${out.match})` : s.record ? 'no recorded allergy' : 'no record pulled yet'}`);
      return remember(j({ ...out, recordAvailable: !!s.record }));
    }
    case 'search_ehr': {
      const name = String(args.name ?? '').trim();
      const birthDate = String(args.birth_date ?? '').trim();
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return j({ error: 'name and birth_date (YYYY-MM-DD) are both required (X8)' });
      try {
        const matches = await searchPatients(name, birthDate);
        await step(conn, 'search_ehr', `${name} ${birthDate}: ${matches.length} match${matches.length === 1 ? '' : 'es'}`);
        // One match: pull it now instead of spending another tool round on pull_record (live, Sun ~02:00).
        if (matches.length === 1 && inc) {
          const summary = await ctx.pullRecord(matches[0].id, 'voice');
          return remember(j({ matches, pulled: true, summary, note: 'record pulled and its summary spoken automatically; do not repeat it' }));
        }
        return remember(j({ matches }));
      } catch (err) {
        await step(conn, 'search_ehr', `EHR unavailable: ${(err as Error).message.slice(0, 80)}`);
        return j({ error: 'EHR unavailable' });
      }
    }
    case 'pull_record': {
      const id = String(args.patient_id ?? '').trim();
      if (!id) return j({ error: 'patient_id required' });
      if (!inc) return j({ error: 'no active incident' });
      try {
        const summary = await ctx.pullRecord(id, 'voice');
        return remember(j({ ok: true, summary }));
      } catch (err) {
        return j({ error: (err as Error).message.slice(0, 120) });
      }
    }
    case 'speak': {
      const text = String(args.text ?? '');
      const ok = await ctx.policy.say(text, 1, 'answer', ctx.corpus.join('\n'), ctx.valid);
      return j(ok ? { ok: true } : { error: 'dropped by the policy layer (too long, or a number not in the facts); rephrase with facts from the tools only, or stay silent' });
    }
    default:
      return j({ error: `unknown tool ${name}` });
  }
}

/** For fetchRecord's consumers: re-export so brain.ts has one import for the EHR path. */
export { fetchRecord };
