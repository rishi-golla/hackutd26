// The when-to-speak policy layer (spec §15, §19 agent rules). Everything the brain says goes through here and
// then through add_callout, the same queue the rules use. Server-side, queue_callout drops identical unspoken
// words; the 4 s spacing, word limits, the 20 s advisory gap and the facts-only number check are enforced here.
// Calls are serialised so two concurrent requests can't both see a free slot.
import type { Conn } from './db';
import { step } from './db';
import { numbersSupported } from './llm';
import { spoken } from './spoken';
import { tsMs } from './state';

export type SpeechKind = 'readback' | 'answer' | 'advisory' | 'record' | 'ask' | 'control' | 'vision';

const SPACING_S = 4;
const ADVISORY_GAP_S = 15;
/** "ask" is a reply to the medic (a clarifying question), not an unprompted advisory, so it gets room.
 *  "vision" is the answer to "Handoff, look": fixed wording from the sampler, never the model's. */
const WORD_LIMIT: Record<SpeechKind, number> = { readback: 40, answer: 30, advisory: 15, record: 25, ask: 12, control: 3, vision: 20 };
const DECIMAL_OR_INT = /\b\d{1,3}(?:\.\d+)?\b/g;

export class Policy {
  private lastAdvisoryAt = 0;
  private lastQueuedAt = 0;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private conn: Conn) {}

  /**
   * Queue words for the mouth. Returns false (and says why in the trace) when the policy drops them.
   * `corpus` is the text the numbers in an answer must come from (the state summary and tool results).
   * `valid` is re-checked after any wait, right before add_callout: words about an incident or patient that
   * changed while they waited are dropped instead of landing in the next incident.
   */
  say(text: string, priority: number, kind: SpeechKind, corpus?: string, valid?: () => boolean): Promise<boolean> {
    // Read-backs and control words (P0) are exempt from spacing, so they never wait behind a P1–P3 call that is.
    if (priority === 0) return this.sayNow(text, priority, kind, corpus, valid);
    const run = this.chain.then(() => this.sayNow(text, priority, kind, corpus, valid));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async sayNow(text: string, priority: number, kind: SpeechKind, corpus?: string, valid?: () => boolean): Promise<boolean> {
    let words = text.replace(/\s+/g, ' ').trim();
    if (!words) return false;
    // Advisory wording: protocol phrasing, never an order (spec §19). Before the word count, so the cap holds.
    if (kind === 'advisory' && /^(give|push|stop|start|do|administer|shock)\b/i.test(words) && !/^consider\b/i.test(words)) {
      words = `Consider: ${words}`;
    }
    const count = words.split(' ').length;
    if (count > WORD_LIMIT[kind]) {
      await step(this.conn, 'policy', `Dropped ${kind} (${count} words, limit ${WORD_LIMIT[kind]}): "${words.slice(0, 60)}"`);
      return false;
    }
    if (kind !== 'readback' && /\bdepth\b/i.test(words)) {
      await step(this.conn, 'policy', 'Dropped: never claims compression depth');
      return false;
    }
    // Facts only: every number, in digits or in words ("two hundred"), must appear in the facts.
    if (corpus !== undefined && !numbersSupported(words, corpus)) {
      await step(this.conn, 'policy', `Dropped ${kind}: a number in it is not in the facts: "${words.slice(0, 60)}"`);
      return false;
    }
    if (kind === 'advisory') {
      const since = (Date.now() - this.lastAdvisoryAt) / 1000;
      if (since < ADVISORY_GAP_S) {
        await step(this.conn, 'policy', `Dropped advisory: last one ${Math.round(since)} s ago (min ${ADVISORY_GAP_S})`);
        return false;
      }
    }
    // Numbers are spoken in words (spec §15). Read-backs already are; answers and advisories come from the model.
    if (kind === 'answer' || kind === 'advisory') {
      words = words
        .replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h, m) => `${spoken(Number(h))} ${Number(m) === 0 ? 'hundred' : Number(m) < 10 ? `oh ${spoken(Number(m))}` : spoken(Number(m))}`) // 22:11 → twenty-two eleven
        .replace(/\bmcg\b/gi, 'micrograms')
        .replace(/\bmg\b/gi, 'milligrams')
        .replace(/\bIO\b/g, 'I-O')
        .replace(/\bIV\b/g, 'I-V')
        .replace(/\bIM\b/g, 'I-M')
        .replace(DECIMAL_OR_INT, n => spoken(Number(n)));
    }

    // At most one callout every 4 s across rules and agent (read-backs and control words are exempt).
    if (priority > 0) {
      const waited = await this.waitForSpacing(kind === 'advisory' ? 0 : SPACING_S * 1000);
      if (!waited) {
        await step(this.conn, 'policy', `Dropped ${kind}: another callout queued in the last ${SPACING_S} s`);
        return false;
      }
    }
    if (valid && !valid()) {
      await step(this.conn, 'policy', `Dropped ${kind}: the incident or patient changed while it waited: "${words.slice(0, 60)}"`);
      return false;
    }
    try {
      await this.conn.reducers.addCallout({ text: words, priority });
    } catch (err) {
      await step(this.conn, 'policy', `add_callout failed: ${(err as Error).message.slice(0, 80)}`);
      return false;
    }
    if (priority > 0) this.lastQueuedAt = Date.now();
    if (kind === 'advisory') this.lastAdvisoryAt = Date.now();
    await step(this.conn, 'speak', `P${priority} ${kind}: "${words}"`);
    return true;
  }

  /** True when no P1–P3 callout was queued in the last 4 s (by anyone, or by us); waits up to `maxWaitMs`. */
  private async waitForSpacing(maxWaitMs: number): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const ours = (Date.now() - this.lastQueuedAt) / 1000 < SPACING_S;
      const recent = ours || [...this.conn.db.callout.iter()].some(c => c.priority > 0 && (Date.now() - tsMs(c.createdAt)) / 1000 < SPACING_S);
      if (!recent) return true;
      if (Date.now() >= deadline) return false;
      await new Promise(r => setTimeout(r, 250));
    }
  }
}
