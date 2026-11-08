// CPR assistance state machine and spoken-cue policy. Pure: feed it a snapshot every ~250 ms, it says which mode
// the phone is in, whether the metronome plays, and at most one short cue to speak.
//
//   idle ──status=arrest──▶ waiting_for_sensor ──finger detected──▶ active ◀──▶ paused (no compressions 10 s)
//     ▲                                                                   │
//     └──────────────────── status leaves arrest ◀───────────────────────┘
//
// The finger-sensor gate only applies to starting: once assistance is running, a finger taken off the sensor never
// stops the beat. Cue rules follow spec §15: "Faster" / "Slower" after 5 s and at most every 10 s, one cue per 4 s
// at most, short words, never over other speech. "Follow the beat" and the sensor prompt are the phone's own.

export type Mode = 'idle' | 'waiting_for_sensor' | 'active' | 'paused';

export type CoachInput = {
  /** seconds, any monotonic clock */
  now: number;
  inArrest: boolean;
  /** relay status is anything but "no finger" (and fresh) */
  fingerDetected: boolean;
  rate: number | null;
  compressing: boolean;
  /** seconds since the last compression; null = none yet */
  sinceLast: number | null;
  onBeatPct: number | null;
  /** compressions in the beat window */
  beatN: number;
  /** something is being spoken right now */
  speaking: boolean;
  /** the demo's "CPR slow / CPR good" override is on: keep the beat, leave rate and pause cues to the server */
  override?: boolean;
};

export type Cue = { key: string; text: string; priority: number };
export type CoachOutput = { mode: Mode; metronome: boolean; cue: Cue | null };

export const TARGET_MIN = 100;
export const TARGET_MAX = 120;
/** §15: "Push faster" / "Slow down" need the condition for 5 s. The phone-only "Follow the beat" needs 3 s. */
const RATE_HOLD_S = 5;
const BEAT_HOLD_S = 3;
const SPACING_S = 4;
const PAUSE_S = 10;

const CUES = {
  sensor: { key: 'sensor', text: 'Place the finger sensor', priority: 2, repeatS: 20 },
  resume: { key: 'resume', text: 'Resume compressions', priority: 1, repeatS: 10 },
  // §15: P1 / P2, repeat no sooner than 10 s.
  faster: { key: 'faster', text: 'Faster', priority: 1, repeatS: 10 },
  slower: { key: 'slower', text: 'Slower', priority: 2, repeatS: 10 },
  beat: { key: 'beat', text: 'Follow the beat', priority: 3, repeatS: 8 },
} as const;
type CueKey = keyof typeof CUES;

export class Coach {
  mode: Mode = 'idle';
  private activeSince = 0;
  private heldSince: Partial<Record<CueKey, number>> = {};
  private lastCue: Partial<Record<CueKey, number>> = {};
  private lastAnyCue = -Infinity;

  step(i: CoachInput): CoachOutput {
    if (!i.inArrest) {
      this.reset();
      return { mode: 'idle', metronome: false, cue: null };
    }
    if (this.mode === 'idle' || this.mode === 'waiting_for_sensor') {
      if (i.fingerDetected) {
        this.mode = 'active';
        this.activeSince = i.now;
        this.heldSince = {};
      } else {
        this.mode = 'waiting_for_sensor';
      }
    }

    const want: CueKey[] = [];
    if (this.mode === 'waiting_for_sensor') {
      want.push('sensor');
    } else {
      // Pause time counts from activation at most: bumps before CPR started (walking, kneeling) never count.
      const noCompressionS = Math.min(i.sinceLast ?? Infinity, i.now - this.activeSince);
      // Demo override: the beat keeps going, but the phone's motion data isn't the truth, so no rate/pause cues
      // (the server speaks from the override instead: still one voice).
      this.mode = !i.override && noCompressionS >= PAUSE_S ? 'paused' : 'active';
      if (this.mode === 'paused') want.push('resume');
      const rate = !i.override && i.compressing ? i.rate : null;
      if (this.held('faster', rate !== null && rate < TARGET_MIN, i.now, RATE_HOLD_S)) want.push('faster');
      if (this.held('slower', rate !== null && rate > TARGET_MAX, i.now, RATE_HOLD_S)) want.push('slower');
      const inRange = rate !== null && rate >= TARGET_MIN && rate <= TARGET_MAX;
      if (this.held('beat', inRange && i.beatN >= 6 && i.onBeatPct !== null && i.onBeatPct < 60, i.now, BEAT_HOLD_S)) want.push('beat');
    }

    return { mode: this.mode, metronome: this.mode !== 'waiting_for_sensor', cue: this.pick(want, i) };
  }

  reset(): void {
    this.mode = 'idle';
    this.heldSince = {};
    this.lastCue = {};
    this.lastAnyCue = -Infinity;
  }

  /** True once `cond` has held for `holdS` seconds. */
  private held(key: CueKey, cond: boolean, now: number, holdS: number): boolean {
    if (!cond) {
      delete this.heldSince[key];
      return false;
    }
    this.heldSince[key] ??= now;
    return now - this.heldSince[key]! >= holdS;
  }

  private pick(want: CueKey[], i: CoachInput): Cue | null {
    if (i.speaking || i.now - this.lastAnyCue < SPACING_S) return null;
    const ready = want
      .map(k => CUES[k])
      .filter(c => this.lastCue[c.key as CueKey] === undefined || i.now - this.lastCue[c.key as CueKey]! >= c.repeatS)
      .sort((a, b) => a.priority - b.priority);
    const c = ready[0];
    if (!c) return null;
    this.lastCue[c.key as CueKey] = i.now;
    this.lastAnyCue = i.now;
    return { key: c.key, text: c.text, priority: c.priority };
  }
}
