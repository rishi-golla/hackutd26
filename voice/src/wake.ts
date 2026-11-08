// The name gate (SPEC decision 21): the medic addresses Handoff by name ("Handoff, giving one milligram of epi IO",
// "Model, IO access placed"). Lines that don't start with a wake word are room talk: never logged, never sent to
// Nemotron. VOICE_WAKE_WORDS sets the words ("handoff,model" by default; "off" turns the gate off).

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

/** "handoff" also matches what speech-to-text makes of it ("hand off", "hand-off"), but never "hands off", which
 *  is what a medic says before a shock. */
function pattern(word: string): string {
  const w = word.trim().toLowerCase();
  if (w === 'handoff') return 'hand\\s?-?\\s?off(?!s)';
  return w.replace(ESCAPE, '\\$&');
}

/** Optional filler before the name ("hey Handoff", "okay, Model"). Nothing else: "this model is..." is room talk. */
const LEAD = '(?:(?:hey|hi|ok|okay|uh|um|so)[\\s,]+)?';

export function wakeRegex(words: string[]): RegExp | null {
  const alts = words.map(w => w.trim()).filter(Boolean).map(pattern);
  if (alts.length === 0) return null;
  return new RegExp(`^\\s*${LEAD}(?:${alts.join('|')})\\b[\\s,.!:;-]*`, 'i');
}

/** Whether the line starts with a wake word, and the line without it. With no wake words every line is "woken". */
export function splitWake(text: string, words: string[]): { woke: boolean; rest: string } {
  const re = wakeRegex(words);
  if (!re) return { woke: true, rest: text };
  const m = re.exec(text);
  return m ? { woke: true, rest: text.slice(m[0].length).trim() } : { woke: false, rest: text };
}
