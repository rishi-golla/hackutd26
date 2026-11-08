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
  return options;
}

/** Only an offered, grounded sentence is accepted; unknown wording uses the neutral fallback. */
export function publicSummary(value: unknown, corpus: string, fallback: string): string {
  return typeof value === 'string' && publicSummaries(corpus).includes(value.trim()) ? value.trim() : fallback;
}

/** Accept legacy SILENT/advisory replies, but never speak a malformed structured response. */
export function advisoryDecision(content: string, corpus: string): { advisory: string | null; summary: string } {
  const fallback = 'Reviewed the latest state; continuing to monitor without an additional advisory.';
  const plain = content.trim();
  if (!plain) throw new Error('Empty advisory decision');
  if (/^SILENT\.?$/i.test(plain)) return { advisory: null, summary: fallback };
  if (/^(?:null|true|false)$/i.test(plain)) throw new Error('Invalid advisory decision');
  if (!/^[{["`]/.test(plain)) return { advisory: plain, summary: 'Prepared an advisory from the latest patient state.' };
  const parsed = JSON.parse(plain.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!parsed || typeof parsed !== 'object' || !('advisory' in parsed) || (parsed.advisory !== null && typeof parsed.advisory !== 'string')) throw new Error('Invalid advisory decision');
  const advisory = parsed.advisory?.trim() || null;
  return { advisory, summary: publicSummary(parsed.summary, corpus, advisory ? 'Prepared an advisory from the latest patient state.' : fallback) };
}
