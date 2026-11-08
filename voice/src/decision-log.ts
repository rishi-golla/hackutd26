// Public progress and outcomes, never private model reasoning. Uses the existing agent_step contract (H5).
import { randomUUID } from 'node:crypto';
import { activeIncident, step, type Conn } from './db';

export type DecisionPhase = 'progress' | 'complete' | 'error';

/** One model operation; its ID keeps overlapping turns separate on the dashboard. */
export class DecisionLog {
  private readonly id = randomUUID();
  private readonly incidentId: bigint | undefined;
  constructor(private conn: Conn, private valid: () => boolean) {
    this.incidentId = activeIncident(conn)?.id;
  }

  async write(phase: DecisionPhase, text: string) {
    if (this.incidentId === undefined || activeIncident(this.conn)?.id !== this.incidentId || !this.valid()) return;
    let plain = text.replace(/\s+/g, ' ').trim().slice(0, 180);
    let summary = JSON.stringify({ v: 1, id: this.id, phase, text: plain });
    // db.step caps summaries at 300 characters: truncate the text, never the JSON envelope.
    while (summary.length > 300) {
      plain = plain.slice(0, -1);
      summary = JSON.stringify({ v: 1, id: this.id, phase, text: plain });
    }
    await step(this.conn, 'decision', summary);
  }
}

/** Fixed phrases describe the request about to run, not a result we haven't received. */
export function toolProgress(name: string): string {
  const phrases: Record<string, string> = {
    get_state: 'Reading the latest patient state.',
    get_recent_transcript: 'Reviewing the recent clinical updates.',
    get_timeline: 'Reviewing the incident timeline.',
    check_allergy: 'Checking the recorded allergies.',
    check_dose_range: 'Checking the protocol dose range.',
    search_ehr: 'Requesting matching patient records from the EHR.',
    pull_record: 'Requesting the patient record.',
    log_event: 'Recording the clinical update.',
    set_status: 'Updating the incident status.',
    speak: 'Preparing a reply for the medic.',
  };
  return phrases[name] ?? 'Processing the clinical update.';
}

/** Public wording is selected from facts already in the state, never a free-form clinical claim. */
export function publicSummaries(corpus: string): string[] {
  const options = ['Reviewed the latest state; continuing to monitor without an additional advisory.'];
  if (/^VITALS no (?:valid reading|data)\b/m.test(corpus)) options.push('No current valid pulse reading is available; continuing to monitor.');
  if (/^PATIENT not identified yet \(no record\)$/m.test(corpus)) options.push('No patient record is available yet; monitoring the documented incident.');
  if (/^RECENT SPEECH /m.test(corpus)) options.push('Reviewed the recent callouts; no additional advisory selected.');
  if (/^INCIDENT .*· status ROSC\b/m.test(corpus)) options.push('Reviewed the recorded ROSC status; continuing to monitor.');
  // Only when the TREND line itself says WORSENING: a rising SpO2 must not be called a worsening trend.
  if (/^TREND .*· WORSENING$/m.test(corpus)) options.push('Reviewed the worsening vitals trend; an advisory was considered.');
  return options;
}

/** Only an offered, grounded sentence is accepted; unknown wording uses the neutral fallback. */
export function publicSummary(value: unknown, corpus: string, fallback: string): string {
  return typeof value === 'string' && publicSummaries(corpus).includes(value.trim()) ? value.trim() : fallback;
}

/**
 * A dashboard sentence in the advisory field is not an advisory. Seen live (Sun ~04:45): the model answered
 * {"advisory": "Reviewed the latest state; continuing to monitor…"} and it was queued for the speaker. Status
 * wording ("Reviewed…", "Monitoring…", "No additional advisory…") and the offered summaries are never spoken.
 */
const STATUS_WORDING = /^(?:reviewed|reviewing|monitoring|continuing to monitor|no (?:additional |further )?advisory|nothing (?:to|further)|no (?:current |valid )*(?:reading|data|vitals|record)|the (?:patient|state|incident) (?:is|was|remains)|state (?:reviewed|unchanged))\b/i;
/** Anywhere in the text: "…; continuing to monitor." is a dashboard sentence however it starts (live Sun ~05:16). */
const STATUS_ANYWHERE = /\b(?:continuing to monitor|no (?:additional|further) advisory|keep monitoring|will monitor)\b/i;
export function isStatusNotAdvisory(text: string, corpus: string): boolean {
  const t = text.trim().replace(/\s+/g, ' ');
  return publicSummaries(corpus).some(s => s.toLowerCase() === t.toLowerCase()) || STATUS_WORDING.test(t) || STATUS_ANYWHERE.test(t);
}

/**
 * Clinical things an advisory may name only when the state names them too (§19: facts only, never invented
 * findings). Each entry: the words in the advisory, and the words that must then appear in the state summary.
 */
const GROUNDED: [RegExp, RegExp][] = [
  // Vitals words need a valid reading on the VITALS line: with the clip off the model said "SpO2 dropping to zero"
  // (live Sun ~05:12, Maincloud, status "no finger").
  [/\b(?:spo2|oxygen saturation|sats?|desaturat\w*|heart rate|pulse ox|tachycard\w*|bradycard\w*)\b/i, /^VITALS \((?:relay|simulated), \d+ s ago\)/m],
  [/\b(?:post-?shock|shocks?|defib\w*|shocked)\b/i, /\b(?:shock|defib)/i],
  [/\b(?:post-?arrest|post-?rosc|rosc)\b/i, /\b(?:ARREST|ROSC)\b/],
  [/\bseiz\w*/i, /\bseiz/i],
  [/\bstroke\b/i, /\bstroke\b/i],
  [/\bepi(?:nephrine)?\b/i, /\bepi(?:nephrine)?\b/i],
  [/\bamio(?:darone)?\b/i, /\bamio(?:darone)?\b/i],
  [/\ballerg\w*/i, /\ballerg/i],
  [/\b(?:warfarin|blood thinner|anticoagul\w*)\b/i, /\b(?:warfarin|apixaban|rivaroxaban|heparin|anticoagul)/i],
  [/\b(?:cpr|compressions?)\b/i, /\b(?:CPR|compress)/i],
  [/\b(?:the record|ehr|chart)\b/i, /\(EHR\)|\(cached\)/],
  [/\bid card\b/i, /\bID card\b/i],
];

/** The first thing the advisory names that the state summary doesn't, or undefined when it is grounded. */
export function ungroundedTerm(advisory: string, corpus: string): string | undefined {
  for (const [said, known] of GROUNDED) {
    const m = said.exec(advisory);
    if (m && !known.test(corpus)) return m[0];
  }
  return undefined;
}

/** Accept legacy SILENT/advisory replies, but never speak a malformed structured response or a status sentence. */
export function advisoryDecision(content: string, corpus: string): { advisory: string | null; summary: string } {
  const fallback = 'Reviewed the latest state; continuing to monitor without an additional advisory.';
  const plain = content.trim();
  if (!plain) throw new Error('Empty advisory decision');
  if (/^SILENT\.?$/i.test(plain)) return { advisory: null, summary: fallback };
  if (/^(?:null|true|false)$/i.test(plain)) throw new Error('Invalid advisory decision');
  if (!/^[{["`]/.test(plain)) {
    return isStatusNotAdvisory(plain, corpus)
      ? { advisory: null, summary: publicSummary(plain, corpus, fallback) }
      : { advisory: plain, summary: 'Prepared an advisory from the latest patient state.' };
  }
  const parsed = JSON.parse(plain.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!parsed || typeof parsed !== 'object' || !('advisory' in parsed) || (parsed.advisory !== null && typeof parsed.advisory !== 'string')) throw new Error('Invalid advisory decision');
  let advisory: string | null = parsed.advisory?.trim() || null;
  // The model copied its summary into the advisory: a decision to keep monitoring, with nothing to say aloud.
  if (advisory && isStatusNotAdvisory(advisory, corpus)) advisory = null;
  return { advisory, summary: publicSummary(parsed.summary, corpus, advisory ? 'Prepared an advisory from the latest patient state.' : fallback) };
}
