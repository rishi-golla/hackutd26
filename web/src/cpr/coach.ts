// CPR assistance state machine (decision 21). Pure: feed it a snapshot every ~250 ms, it says which mode the phone
// is in and whether the metronome plays. The phone speaks nothing itself: the spoken cues ("Faster", "Follow the
// beat", "Place the finger sensor"...) are §15 rules on the server, spoken by the voice worker like every callout.
//
//   idle ──status=arrest──▶ waiting_for_sensor ──finger detected──▶ active ◀──▶ paused (no compressions 10 s)
//     ▲                                                                   │
//     └──────────────────── status leaves arrest ◀───────────────────────┘
//
// The finger-sensor gate only applies to starting: once assistance is running, a finger taken off the sensor never
// stops the beat.

export type Mode = 'idle' | 'waiting_for_sensor' | 'active' | 'paused';

export type CoachInput = {
  /** seconds, any monotonic clock */
  now: number;
  inArrest: boolean;
  /** the finger sensor reports a finger (fresh hub state, not no_finger / sensor_error) */
  fingerDetected: boolean;
  /** seconds since the last compression; null = none yet */
  sinceLast: number | null;
};

export type CoachOutput = { mode: Mode; metronome: boolean };

/** Same as the server's "Resume compressions" rule (§15). */
const PAUSE_S = 10;

export class Coach {
  mode: Mode = 'idle';
  private activeSince = 0;

  step(i: CoachInput): CoachOutput {
    if (!i.inArrest) {
      this.mode = 'idle';
      return { mode: 'idle', metronome: false };
    }
    if (this.mode === 'idle' || this.mode === 'waiting_for_sensor') {
      if (!i.fingerDetected) {
        this.mode = 'waiting_for_sensor';
        return { mode: this.mode, metronome: false };
      }
      this.activeSince = i.now;
    }
    // Pause time counts from activation at most: bumps before CPR started (walking, kneeling) never count.
    const noCompressionS = Math.min(i.sinceLast ?? Infinity, i.now - this.activeSince);
    this.mode = noCompressionS >= PAUSE_S ? 'paused' : 'active';
    return { mode: this.mode, metronome: true };
  }
}
