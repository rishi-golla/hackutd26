// The when-to-speak policy layer (spec §15, §19 agent rules). Everything the brain says goes through here and
// then through add_callout, the same queue the rules use. Server-side, queue_callout drops identical unspoken
// words; the 4 s spacing, word limits, the 20 s advisory gap and the facts-only number check are enforced here.
// Calls are serialised so two concurrent requests can't both see a free slot.
import type { Conn } from './db';
import { step } from './db';
import { numbersSupported } from './llm';
import { spoken, spokenUnit } from './spoken';
import { tsMs } from './state';

export type SpeechKind = 'readback' | 'answer' | 'advisory' | 'record' | 'ask' | 'control' | 'vision' | 'trend';

const SPACING_S = 4;
const ADVISORY_GAP_S = 15;
/** "ask" is a reply to the medic (a clarifying question), not an unprompted advisory, so it gets room.
 *  "vision" is the answer to "Handoff, look": fixed wording from the sampler, never the model's.
 *  "trend" is the brain's fixed note about a worsening vitals trend (decision 24): fixed code, not the model, so it
 *  keeps the advisory's 15-word cap and spoken numbers but not the 15 s advisory gap (the 4 s spacing still holds). */
const WORD_LIMIT: Record<SpeechKind, number> = { readback: 40, answer: 30, advisory: 15, record: 25, ask: 12, control: 3, vision: 20, trend: 15 };
const DECIMAL_OR_INT = /\b\d{1,3}(?:\.\d+)?\b/g;
const PROPER_NOUN_ALLOW = new Set(['Handoff', 'Consider', 'Note', 'Copy', 'Logged', 'Cancelled', 'Nemotron', 'EHR', 'ID', 'CPR', 'ROSC', 'AED', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Medic', 'Patient']);
/** The first capitalised word (not at a sentence start, not allowed above) that the facts don't contain, or undefined. */
export function unknownProperNoun(text: string, corpus: string): string | undefined {
  const facts = corpus.toLowerCase();
  const tokens = text.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    if (/[.!?:;"]$/.test(tokens[i - 1])) continue; // a sentence start
    const word = tokens[i].replace(/^[("'“]+|[)"'”,.!?;:]+$/g, '');
    if (!/^[A-Z][a-z]{2,}$/.test(word) || PROPER_NOUN_ALLOW.has(word)) continue;
    if (!facts.includes(word.toLowerCase())) return word;
  }
  return undefined;
}

/** An unprompted advisory shorter than this is a fragment, not advice. */
const ADVISORY_MIN_WORDS = 4;
/** An unprompted note is not repeated within this long, even in different capitalisation or punctuation. */
const REPEAT_S = 120;
const sameWords = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

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
    // A long answer keeps its leading whole sentences that fit, rather than being lost entirely.
    if (kind === 'answer' && words.split(' ').length > WORD_LIMIT[kind]) {
      let kept = '';
      for (const sentence of words.match(/[^.!?]+[.!?]+/g) ?? []) {
        const next = `${kept} ${sentence.trim()}`.trim();
        if (next.split(' ').length > WORD_LIMIT[kind]) break;
        kept = next;
      }
      if (kept) words = kept;
    }
    const count = words.split(' ').length;
    // A fragment is not an advisory ("Consider: epinephrine running", live Sun ~05:03): a whole short sentence or nothing.
    if (kind === 'advisory' && count < ADVISORY_MIN_WORDS) {
      await step(this.conn, 'policy', `Dropped advisory (${count} words, a fragment): "${words.slice(0, 60)}"`);
      return false;
    }
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
    // Names too: a capitalised word mid-sentence that the facts don't contain is the model's ("Borischa" for
    // "Donocha", live Sun ~09:07). Sentence starts, months, days and Handoff's own words are allowed.
    if (corpus !== undefined && (kind === 'answer' || kind === 'advisory')) {
      const stray = unknownProperNoun(words, corpus);
      if (stray) {
        await step(this.conn, 'policy', `Dropped ${kind}: "${stray}" is not in the facts`);
        return false;
      }
    }
    // Numbers are spoken in words (spec §15). Read-backs already are; answers and advisories come from the model.
    if (kind === 'answer' || kind === 'advisory' || kind === 'trend') {
      words = words
        .replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h, m) => `${spoken(Number(h))} ${Number(m) === 0 ? 'hundred' : Number(m) < 10 ? `oh ${spoken(Number(m))}` : spoken(Number(m))}`) // 22:11 → twenty-two eleven
        // "1 mg" → "one milligram", "300 mg" → "three hundred milligrams" ("one milligrams" was heard live, Sun ~04:58).
        .replace(/\b(\d+(?:\.\d+)?)\s*(mg|mcg)\b/gi, (_m, n, u) => `${spoken(Number(n))} ${spokenUnit(u.toLowerCase() === 'mg' ? 'mg' : 'mcg', Number(n))}`)
        .replace(/\bmcg\b/gi, 'micrograms')
        .replace(/\bmg\b/gi, 'milligrams')
        .replace(/\bIO\b/g, 'I-O')
        .replace(/\bIV\b/g, 'I-V')
        .replace(/\bIM\b/g, 'I-M')
        .replace(DECIMAL_OR_INT, n => spoken(Number(n)));
    }

    // Never the same unprompted note twice in two minutes (the model repeated "oxygen saturation falling fast.
    // Consider airway and oxygen." 20 s apart, live Sun ~04:49). The server only drops identical *unspoken* rows.
    if (kind === 'advisory' || kind === 'trend') {
      const same = [...this.conn.db.callout.iter()].find(c => (c.spokenAt !== undefined || c.priority > 0) && sameWords(c.text, words) && (Date.now() - tsMs(c.spokenAt ?? c.createdAt)) / 1000 < REPEAT_S);
      if (same) {
        await step(this.conn, 'policy', `Dropped ${kind}: the same words were said ${Math.round((Date.now() - tsMs(same.spokenAt ?? same.createdAt)) / 1000)} s ago`);
        return false;
      }
    }

    // Then the 15 s gap between unprompted advisories (decision 21).
    if (kind === 'advisory') {
      const since = (Date.now() - this.lastAdvisoryAt) / 1000;
      if (since < ADVISORY_GAP_S) {
        await step(this.conn, 'policy', `Dropped advisory: last one ${Math.round(since)} s ago (min ${ADVISORY_GAP_S})`);
        return false;
      }
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
