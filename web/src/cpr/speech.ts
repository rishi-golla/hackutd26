// One shared voice for the bodycam page. CPR cues use it, and the voice gate (workflow 1) should too, so nothing
// ever talks over anything else. Lower priority number = more urgent (spec §15: 0 read-back, 1 urgent, 2 normal,
// 3 low). A new utterance only interrupts one that is less urgent.

type Listener = (speaking: boolean) => void;

let current: { u: SpeechSynthesisUtterance; priority: number } | null = null;
const listeners = new Set<Listener>();

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
const notify = (speaking: boolean) => listeners.forEach(fn => fn(speaking));

export function isSpeaking(): boolean {
  return current !== null;
}

/** Subscribe to speaking on/off (e.g. to duck the metronome). Returns the unsubscribe function. */
export function onSpeakingChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call from the tap-to-start gesture: unlocks speech on mobile browsers so the first cue isn't delayed. */
export function warmUpSpeech(): void {
  if (!supported()) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

/** Speak `text` unless something at least as urgent is already speaking. Returns whether it was spoken. */
export function speak(text: string, priority = 2): boolean {
  if (!supported()) return false;
  if (current && priority >= current.priority) return false;
  if (current) window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  const done = () => {
    if (current?.u === u) {
      current = null;
      notify(false);
    }
  };
  u.onend = done;
  u.onerror = done;
  // Some mobile browsers never fire onend (or drop the utterance). Without this, "speaking" would stay on, every
  // later cue would be skipped and the metronome would stay ducked. ~150 ms per character is generous at rate 1.1.
  setTimeout(done, 2000 + text.length * 150);
  current = { u, priority };
  notify(true);
  window.speechSynthesis.speak(u);
  return true;
}
