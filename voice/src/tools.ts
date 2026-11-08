// Nemotron's tools for a voice turn (voice/README.md "Nemotron tools"). Every call is traced. Guardrails:
// medications are never logged by the model (only the read-back parser and the camera do), doses and allergies
// are judged only by the deterministic checks, and the model's speech goes through the policy layer.
import type { Conn } from './db';
import { activeIncident, step } from './db';
import { CONFIG } from './config';
import type { ToolDef } from './llm';
import { checkAllergy, checkDoseRange } from './checks';
import { fetchRecord, searchPatients } from './ehr';
import { hhmm, readState, summarize } from './state';
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
      description: 'Log a procedure or finding the medic stated. NOT for medications or shocks: those are logged automatically from the read-back.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['airway', 'procedure', 'finding', 'mark'], description: 'airway = airway device placed; procedure = IV/IO access, pulse check, etc.; finding = something observed; mark = a MARK note' },
          label: { type: 'string', description: 'Short timeline label, e.g. "Airway placed (i-gel)", "IO access right tibia", "Pill bottle by the bed"' },
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
      description: 'Change the incident status when the medic states it plainly: arrest (no pulse, starting CPR), rosc (pulse is back), en_route (transporting).',
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
      description: 'Say something to the medic. At most 15 words; only facts from the state and tool results. Advisory protocol wording ("Consider…"), never an order.',
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
};

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
      if (!['airway', 'procedure', 'finding', 'mark'].includes(kind)) {
        await step(conn, 'log_event', `Refused kind "${kind}": medications and shocks come only from the read-back or the camera`);
        return j({ error: 'only airway, procedure, finding or mark; medications and shocks are logged by the read-back system' });
      }
      if (!inc) return j({ error: 'no active incident' });
      const label = String(args.label ?? '').slice(0, 80);
      if (!label) return j({ error: 'label required' });
      await conn.reducers.logEvent({ kind, label, sourceKind: 'voice', sourceDetail: String(args.detail ?? label).slice(0, 200) });
      await step(conn, 'log_event', `${kind}: ${label}`);
      return j({ ok: true });
    }
    case 'set_status': {
      const status = String(args.status ?? '');
      if (!['arrest', 'rosc', 'en_route'].includes(status)) return j({ error: 'status must be arrest, rosc or en_route' });
      if (!inc) return j({ error: 'no active incident' });
      if (inc.status === status) return j({ ok: true, note: `already ${status}` });
      await conn.reducers.setStatus({ status, sourceKind: 'voice', sourceDetail: String(args.detail ?? '').slice(0, 200) });
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
