// W6 · Patient identified → EHR pull (spec §17, §19, X3–X8).
// Two triggers:
//   - incident.patientRef is set (the "Identify patient" control, or any identify_patient call) and this incident
//     has no record for it yet → pull the record.
//   - the medic says something that may hold a name and a birth date → Nemotron decides whether to search the EHR.
//     It searches only with both (X8), asks the crew instead of guessing, and the rule parser does the same
//     without a key or when the model fails.
// The record is mapped from FHIR by code, never by the model. The model writes only the spoken summary, which is
// checked against the record (facts only); otherwise the template speaks.
import type { Conn } from './db';
import { step } from './db';
import { CONFIG, llmConfigured } from './config';
import { chat, numbersSupported, unsupportedClaim, type ChatMessage, type ToolDef } from './llm';
import { ageOn, snapshot } from './facts';
import { getRecord, searchPatients, type EhrRecord, type PatientMatch } from './ehr';

const W = 'W6';

/** `${incidentId}:${patientRef}` pulls already started, so identify_patient from W6 doesn't trigger a second pull. */
const claimed = new Set<string>();
export function claimPull(incidentId: bigint, patientRef: string): boolean {
  const key = `${incidentId}:${patientRef}`;
  if (claimed.has(key)) return false;
  claimed.add(key);
  return true;
}

/** A transcript line worth checking for a patient's identity: a name intro, "born", a date of birth or a year. */
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
export const IDENTITY_HINT = new RegExp(
  String.raw`\b(patient(?:'s)?(?: name)? is|name is|identified as|born|date of birth|dob|d\.o\.b)\b|\b(19|20)\d{2}\b|\b\d{1,2}/\d{1,2}/\d{2,4}\b|\b(${MONTHS})\.? \d{1,2}\b`,
  'i'
);

// ---------------------------------------------------------------------------
// Rule parser (no key, or the model failed)
// ---------------------------------------------------------------------------

const MONTH_NUM: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : undefined);
const NAME_STOP = new Set(['born', 'dob', 'date', 'age', 'aged', 'and', 'birth', 'he', 'she', 'they', 'who', 'is', 'was']);

/** Name and birth date from what the medic said, e.g. "Patient is Jordan Avery, born March 14, 1968". */
export function parseIdentity(text: string): { name?: string; birthDate?: string } {
  let name: string | undefined;
  // Same line only, so "…Jordan Avery" + "Wife says…" on the next line doesn't become one name.
  const n = /(?:patient(?:'s)?(?: name)? is|name is|identified as)[ \t]+([a-z][a-z'\-]*(?:[ \t]+[a-z][a-z'\-]*){0,3})/i.exec(text);
  if (n) {
    const words: string[] = [];
    for (const w of n[1].split(/\s+/)) {
      if (NAME_STOP.has(w.toLowerCase())) break;
      words.push(w);
    }
    if (words.length) name = words.join(' ');
  }
  let birthDate: string | undefined;
  let m: RegExpExecArray | null;
  if ((m = /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/.exec(text))) birthDate = iso(+m[1], +m[2], +m[3]);
  else if ((m = /\b(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})\b/.exec(text))) birthDate = iso(+m[3], +m[1], +m[2]);
  else if ((m = new RegExp(String.raw`\b(${MONTHS})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b`, 'i').exec(text)))
    birthDate = iso(+m[3], MONTH_NUM[m[1].slice(0, 3).toLowerCase()], +m[2]);
  else if ((m = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTHS})\.?,?\s+((?:19|20)\d{2})\b`, 'i').exec(text)))
    birthDate = iso(+m[3], MONTH_NUM[m[2].slice(0, 3).toLowerCase()], +m[1]);
  return { name, birthDate };
}

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

/** Questions to the crew (agent callouts: 8 words or fewer, at most one every 20 s per incident). */
const ASK = {
  need_birth_date: "Need the patient's birth date.",
  multiple_matches: 'Several records match. Confirm name and birth date.',
  no_match: 'No record found. Check name and birth date.',
} as const;
type AskReason = keyof typeof ASK;
const lastAsk = new Map<bigint, number>();

async function askCrew(conn: Conn, incidentId: bigint, reason: AskReason, how: string): Promise<string> {
  const last = lastAsk.get(incidentId) ?? 0;
  if (Date.now() - last < 20_000) {
    await step(conn, W, 'ask_crew', `Skipped: asked the crew less than 20 s ago (${reason})`);
    return 'skipped: asked less than 20 s ago';
  }
  lastAsk.set(incidentId, Date.now());
  await conn.reducers.addCallout({ text: ASK[reason], priority: 2 });
  await step(conn, W, 'ask_crew', `"${ASK[reason]}" (${how})`);
  return `asked: ${ASK[reason]}`;
}

/** ehr_get_record → save_patient_record. Every field comes from the EHR (or the labelled cached copy). */
async function pullRecord(conn: Conn, patientRef: string): Promise<EhrRecord | undefined> {
  const t0 = Date.now();
  const rec = await getRecord(patientRef);
  if (!rec) {
    await step(conn, W, 'ehr_get_record', `No record for ${patientRef}`);
    return undefined;
  }
  await step(
    conn,
    W,
    'ehr_get_record',
    `${patientRef} from the ${rec.source === 'cached' ? 'cached copy (EHR not answering)' : 'EHR'} in ${Date.now() - t0} ms`
  );
  await conn.reducers.savePatientRecord(rec);
  const age = ageOn(rec.birthDate);
  await step(
    conn,
    W,
    'save_patient_record',
    `${rec.name}${age !== undefined ? `, ${age}` : ''}; allergies: ${rec.allergies.join(', ') || 'none recorded'}; ` +
      `meds: ${rec.medications.join(', ') || 'none recorded'}; ${rec.codeStatus || 'code status not recorded'}` +
      (rec.source === 'cached' ? ' (cached)' : '')
  );
  return rec;
}

/** X4: name, age, allergies, one key medication; facts only. */
export function templateCallout(rec: EhrRecord): string {
  const age = ageOn(rec.birthDate);
  return (
    `Record found. ${rec.name}${age !== undefined ? `, ${age}` : ''}. ` +
    (rec.allergies.length ? `Allergy: ${rec.allergies.join(', ')}.` : 'No allergies recorded.') +
    (rec.medications[0] ? ` On ${rec.medications[0]}.` : '') +
    (rec.source === 'cached' ? ' Cached record.' : '')
  );
}

function recordFacts(rec: EhrRecord) {
  return {
    name: rec.name,
    age: ageOn(rec.birthDate),
    allergies: rec.allergies,
    medications: rec.medications,
    conditions: rec.conditions,
    code_status: rec.codeStatus,
    source: rec.source,
  };
}

/** Why a drafted summary breaks the X4 / facts-only rules, or undefined if it's fine. */
export function calloutProblem(text: string, rec: EhrRecord): string | undefined {
  const corpus = JSON.stringify(recordFacts(rec));
  if (!/^record found\b/i.test(text)) return 'must start with "Record found"';
  const at = text.toLowerCase().indexOf(rec.name.toLowerCase());
  if (at < 0) return 'must say the patient name exactly as recorded';
  const after = text.slice(at + rec.name.length).split(/\s+/).filter(w => /\w/.test(w)).length;
  if (after > 12) return 'at most 12 words after the name';
  const missing = rec.allergies.find(a => !text.toLowerCase().includes(a.toLowerCase()));
  if (missing) return `must mention the recorded allergy "${missing}"`;
  if (!rec.allergies.length && !/\bno (known )?allergies\b/i.test(text)) return 'must say "No allergies recorded"';
  if (/\b(to|on|takes|allergy:)\s*[.,]|\b(to|on|takes)\s*$/i.test(text)) return 'a fact is missing (empty item)';
  if (!numbersSupported(text, corpus)) return 'a number in it is not in the record';
  const claim = unsupportedClaim(text, corpus);
  if (claim) return `"${claim}" is not in the record`;
  return undefined;
}

const SUMMARY_SYSTEM = `You are the record agent in Handoff, a prototype paramedic assistant. All data is synthetic.
A patient record was just pulled from the EHR. Write the sentence the medic will hear on the bodycam speaker.
Format: "Record found. <name>, <age in digits>. Allergy: <every recorded allergy>. On <one key medication>."
If no allergies are recorded, say "No allergies recorded." At most 12 words after the name. Plain text, no
quotes. Use only the facts given. Never add sex, doses, history or advice.`;

async function speakSummary(conn: Conn, rec: EhrRecord) {
  let text: string | undefined;
  let how = 'template';
  if (llmConfigured()) {
    try {
      const t0 = Date.now();
      const reply = await chat(
        [
          { role: 'system', content: SUMMARY_SYSTEM },
          { role: 'user', content: JSON.stringify(recordFacts(rec)) },
        ],
        { timeoutMs: CONFIG.w6SummaryTimeoutMs, maxTokens: 80 }
      );
      const draft = reply.content.replace(/^["']|["']$/g, '').trim();
      const problem = calloutProblem(draft, rec);
      if (problem) {
        await step(conn, W, 'self_check', `Summary rejected: ${problem}`);
      } else {
        text = draft;
        how = `Nemotron, ${Date.now() - t0} ms`;
      }
    } catch (err) {
      await step(conn, W, 'fallback', `Nemotron: ${(err as Error).message.slice(0, 120)}; template summary`);
    }
  }
  text ??= templateCallout(rec);
  // X7: a record from the cached copy must say so.
  if (rec.source === 'cached' && !/cached/i.test(text)) text += ' Cached record.';
  await conn.reducers.addCallout({ text, priority: 2 });
  await step(conn, W, 'add_callout', `"${text}" (${how})`);
}

// ---------------------------------------------------------------------------
// Trigger: incident.patientRef set
// ---------------------------------------------------------------------------

export async function runW6Pull(conn: Conn, incidentId: bigint, patientRef: string) {
  const s = snapshot(conn, incidentId);
  if (!s.incident || s.incident.status === 'closed') return;
  const method = [...s.events].reverse().find(e => e.kind === 'patient_identified')?.sources[0]?.kind;
  await step(conn, W, '', `Trigger: patient identified (${patientRef}${method ? `, ${method}` : ''})`);
  const rec = await pullRecord(conn, patientRef);
  if (rec) await speakSummary(conn, rec);
}

// ---------------------------------------------------------------------------
// Trigger: the medic said something that may identify the patient
// ---------------------------------------------------------------------------

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'ehr_search',
      description:
        "Search the EHR for a patient. Needs BOTH the name and the birth date exactly as the medic said them. Returns the matching patients.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'given and family name as spoken' },
          birth_date: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['name', 'birth_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pull_record',
      description:
        'Identify the patient and pull their record. Only for the single match of your last ehr_search; never guess between several.',
      parameters: {
        type: 'object',
        properties: { patient_id: { type: 'string', description: 'id from ehr_search, e.g. pt-0001' } },
        required: ['patient_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_crew',
      description: 'Ask the crew out loud instead of guessing. The words are fixed for each reason.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string', enum: Object.keys(ASK) } },
        required: ['reason'],
      },
    },
  },
];

const SYSTEM = `You are the record agent in Handoff, a prototype paramedic assistant. All data is synthetic.
You get the latest lines the medic said on scene. Decide whether they identify the patient.
- Only search when the medic said BOTH a name and a birth date: call ehr_search with them (birth date as
  YYYY-MM-DD). One match: call pull_record with its id. Several matches or none: call ask_crew
  (multiple_matches or no_match). Never guess.
- A name without a birth date: call ask_crew with need_birth_date. Do not search.
- No patient name in the lines (questions, plans, other talk): call no tool and reply "no identity".
Use only what the medic said. Never invent names, dates or ids.`;

/** Words of `value` that are not in `said`, for the facts-only check on the model's search arguments. */
const unspoken = (value: string, said: string) => value.toLowerCase().split(/[\s,]+/).filter(w => w && !said.includes(w));

export async function runW6Transcript(conn: Conn, incidentId: bigint) {
  const deadline = Date.now() + CONFIG.w6DeadlineMs;
  const lines = snapshot(conn, incidentId).transcript.slice(-6);
  if (!lines.length) return;
  const said = lines.map(l => l.text).join('\n');
  const saidLower = said.toLowerCase();
  await step(conn, W, '', `Trigger: medic said "${lines[lines.length - 1].text.slice(0, 120)}"`);

  const state = { matches: undefined as PatientMatch[] | undefined, done: false };

  const identifyAndPull = async (m: PatientMatch, how: string) => {
    claimPull(incidentId, m.id);
    await conn.reducers.identifyPatient({ patientRef: m.id, method: 'voice' });
    await step(conn, W, 'identify_patient', `${m.name}, born ${m.birthDate} → ${m.id} (${how})`);
    state.done = true;
    const rec = await pullRecord(conn, m.id);
    if (rec) await speakSummary(conn, rec);
  };

  const search = async (name: string, birthDate: string, how: string) => {
    const r = await searchPatients(name, birthDate);
    state.matches = r.matches;
    await step(
      conn,
      W,
      'ehr_search',
      `${name}, ${birthDate} → ${r.matches.length} match${r.matches.length === 1 ? '' : 'es'}${r.source === 'cached' ? ' (cached copy)' : ''} (${how})`
    );
    return r.matches;
  };

  const runTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case 'ehr_search': {
        const n = String(args.name ?? '').trim();
        const dob = String(args.birth_date ?? '').trim();
        // X8: search only with a name and a birth date.
        if (!n || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
          return JSON.stringify({ error: 'needs a name and a birth date (YYYY-MM-DD); if no birth date was said, call ask_crew with need_birth_date' });
        }
        // Facts only: the name and the birth year must be in what the medic said.
        const missing = unspoken(n, saidLower);
        if (missing.length || !saidLower.includes(dob.slice(0, 4))) {
          await step(conn, W, 'self_check', `Search refused: "${missing.join(' ') || dob}" is not in what the medic said`);
          return JSON.stringify({ error: 'use the name and birth date exactly as the medic said them' });
        }
        const matches = await search(n, dob, 'Nemotron');
        return JSON.stringify({ matches: matches.map(m => ({ id: m.id, name: m.name, birth_date: m.birthDate })) });
      }
      case 'pull_record': {
        const id = String(args.patient_id ?? '');
        const m = state.matches?.find(x => x.id === id);
        if (!state.matches) return JSON.stringify({ error: 'call ehr_search first' });
        if (!m) return JSON.stringify({ error: 'patient_id is not in the last search results' });
        if (state.matches.length !== 1) return JSON.stringify({ error: 'several matches: call ask_crew with multiple_matches, never guess' });
        await identifyAndPull(m, 'Nemotron');
        return JSON.stringify({ ok: true });
      }
      case 'ask_crew': {
        const reason = String(args.reason ?? '') as AskReason;
        if (!(reason in ASK)) return JSON.stringify({ error: `reason must be one of ${Object.keys(ASK).join(', ')}` });
        const out = await askCrew(conn, incidentId, reason, 'Nemotron');
        state.done = true;
        return JSON.stringify({ ok: true, result: out });
      }
      default:
        return JSON.stringify({ error: `unknown tool ${name}` });
    }
  };

  if (llmConfigured()) {
    await step(conn, W, 'plan', 'Look for a name and birth date; search the EHR only with both, ask instead of guessing');
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `What the medic said, oldest first:\n${lines.map(l => `- ${l.text}`).join('\n')}` },
    ];
    try {
      for (let turn = 0; turn < 5 && !state.done; turn++) {
        const remaining = deadline - Date.now();
        if (remaining < 1500) throw new Error('W6 deadline reached');
        const t0 = Date.now();
        const reply = await chat(messages, { tools: TOOLS, timeoutMs: Math.min(remaining, CONFIG.llmTimeoutMs), maxTokens: 300 });
        if (reply.toolCalls.length === 0) {
          if (turn > 0) break;
          await step(conn, W, 'decide', `No name and birth date in what was said; no search (Nemotron, ${Date.now() - t0} ms)`);
          return;
        }
        messages.push({ role: 'assistant', content: reply.content || null, tool_calls: reply.toolCalls });
        for (const call of reply.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            // leave empty; the tool reports what's missing
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(call.function.name, args) });
          if (state.done) break;
        }
      }
      if (state.done) return;
      await step(conn, W, 'fallback', 'Nemotron stopped without finishing; rule parser');
    } catch (err) {
      await step(conn, W, 'fallback', `Nemotron: ${(err as Error).message.slice(0, 120)}; rule parser`);
    }
  } else {
    await step(conn, W, 'fallback', 'Nemotron not configured (no NVIDIA_API_KEY); rule parser');
  }

  // The rule: same policy as the model, from a fixed parser.
  if (state.done) return;
  const s = snapshot(conn, incidentId);
  if (!s.incident || s.incident.status === 'closed' || s.record) return;
  const { name, birthDate } = parseIdentity(said);
  if (!name && !birthDate) {
    await step(conn, W, 'decide', 'No name and birth date in what was said; no search (rule)');
    return;
  }
  if (!name || !birthDate) {
    if (name) await askCrew(conn, incidentId, 'need_birth_date', 'rule');
    else await step(conn, W, 'decide', `Birth date ${birthDate} heard but no name; waiting (rule)`);
    return;
  }
  const matches = await search(name, birthDate, 'rule');
  if (matches.length === 1) await identifyAndPull(matches[0], 'rule');
  else await askCrew(conn, incidentId, matches.length ? 'multiple_matches' : 'no_match', 'rule');
}
