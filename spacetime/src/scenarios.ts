// Hardcoded synthetic scenarios that override the relay's sensor data while one is on (vitals_override).
// seizure: synthesize_seizure. arrest / rosc: started by the Arrest / ROSC demo controls, so the dashboard and the
// agents see an arrest's vitals instead of whatever the real finger clip reads.
// Edit the numbers freely: tick_rules plays a scenario's vitals one row per second from the moment it starts,
// then holds the last row. Waveform batches cycle.
// All rows written from here are stored with simulated = true. Synthetic data, not a medical model.

export type SyntheticVitals = {
  hr: number | undefined;
  spo2: number | undefined;
  tempC: number | undefined;
  /** relay status vocabulary: pulse | acquiring | no finger | ..., plus 'no pulse' (arrest). Readers trust hr/spo2
   * only when 'pulse'; the arrest's hr 0 is there so screens can show a flat zero. */
  status: string;
};

/** One row per second. Tonic-clonic seizure: HR climbs into the 160s, SpO₂ falls into the low 80s. */
export const SEIZURE_VITALS: SyntheticVitals[] = [
  // 0–4 s: onset
  { hr: 96, spo2: 97, tempC: 36.9, status: 'pulse' },
  { hr: 104, spo2: 97, tempC: 36.9, status: 'pulse' },
  { hr: 112, spo2: 96, tempC: 36.9, status: 'pulse' },
  { hr: 121, spo2: 96, tempC: 37.0, status: 'pulse' },
  { hr: 128, spo2: 95, tempC: 37.0, status: 'pulse' },
  // 5–14 s: tonic phase, breathing stops, HR climbs
  { hr: 134, spo2: 94, tempC: 37.0, status: 'pulse' },
  { hr: 139, spo2: 94, tempC: 37.0, status: 'pulse' },
  { hr: 143, spo2: 93, tempC: 37.1, status: 'pulse' },
  { hr: 147, spo2: 92, tempC: 37.1, status: 'pulse' },
  { hr: 150, spo2: 92, tempC: 37.1, status: 'pulse' },
  { hr: 152, spo2: 91, tempC: 37.1, status: 'pulse' },
  { hr: 154, spo2: 90, tempC: 37.1, status: 'pulse' },
  { hr: 155, spo2: 90, tempC: 37.2, status: 'pulse' },
  { hr: 157, spo2: 89, tempC: 37.2, status: 'pulse' },
  { hr: 158, spo2: 88, tempC: 37.2, status: 'pulse' },
  // 15–24 s: clonic phase, desaturation continues
  { hr: 160, spo2: 87, tempC: 37.2, status: 'pulse' },
  { hr: 163, spo2: 87, tempC: 37.2, status: 'pulse' },
  { hr: 161, spo2: 86, tempC: 37.3, status: 'pulse' },
  { hr: 165, spo2: 85, tempC: 37.3, status: 'pulse' },
  { hr: 164, spo2: 85, tempC: 37.3, status: 'pulse' },
  { hr: 167, spo2: 84, tempC: 37.3, status: 'pulse' },
  { hr: 166, spo2: 84, tempC: 37.3, status: 'pulse' },
  { hr: 168, spo2: 83, tempC: 37.4, status: 'pulse' },
  { hr: 167, spo2: 83, tempC: 37.4, status: 'pulse' },
  { hr: 169, spo2: 82, tempC: 37.4, status: 'pulse' },
  // 25–29 s: sustained; the last row is held until the scenario is stopped
  { hr: 168, spo2: 82, tempC: 37.4, status: 'pulse' },
  { hr: 170, spo2: 81, tempC: 37.4, status: 'pulse' },
  { hr: 169, spo2: 81, tempC: 37.4, status: 'pulse' },
  { hr: 171, spo2: 80, tempC: 37.5, status: 'pulse' },
  { hr: 170, spo2: 80, tempC: 37.5, status: 'pulse' },
];

/**
 * Pulse waveform batches (raw IR values, like the relay's), one batch per second at 25 Hz.
 * Fast, irregular beats with motion artifact from the convulsions.
 */
export const SEIZURE_WAVEFORM_RATE_HZ = 25;
export const SEIZURE_WAVEFORM: number[][] = [
  [110120, 110480, 111050, 110610, 109920, 109640, 110310, 111280, 110870, 110050, 109510, 110190, 111460,
   110940, 109780, 109300, 110420, 111650, 111020, 109890, 109420, 110260, 111390, 110710, 109980],
  [109610, 110750, 111820, 111140, 109870, 108950, 110030, 111590, 112240, 110880, 109400, 109120, 110570,
   111930, 111060, 109530, 108840, 110290, 111760, 112050, 110460, 109230, 109610, 110980, 111420],
  [110840, 109720, 109150, 110380, 111960, 111310, 109680, 108720, 109950, 111640, 112380, 110920, 109240,
   108910, 110470, 112110, 111580, 109810, 108630, 109760, 111490, 112260, 110730, 109180, 109540],
  [110290, 111570, 110860, 109340, 108870, 110150, 111820, 112430, 111010, 109470, 108760, 109980, 111710,
   112190, 110620, 109090, 109360, 110940, 112050, 111280, 109660, 108820, 110120, 111690, 111150],
];

/** Arrest: no pulse. HR 0, SpO₂ unreadable (no perfusion), temperature holds. Held until ROSC, close or reset. */
export const ARREST_VITALS: SyntheticVitals[] = [{ hr: 0, spo2: undefined, tempC: 36.6, status: 'no pulse' }];

/** ROSC: the pulse comes back. HR climbs to ~104, SpO₂ (readable again after a few seconds) to ~93, then holds. */
export const ROSC_VITALS: SyntheticVitals[] = [
  { hr: 38, spo2: undefined, tempC: 36.6, status: 'pulse' },
  { hr: 56, spo2: undefined, tempC: 36.6, status: 'pulse' },
  { hr: 70, spo2: undefined, tempC: 36.6, status: 'pulse' },
  { hr: 82, spo2: 84, tempC: 36.5, status: 'pulse' },
  { hr: 91, spo2: 86, tempC: 36.5, status: 'pulse' },
  { hr: 97, spo2: 88, tempC: 36.5, status: 'pulse' },
  { hr: 101, spo2: 90, tempC: 36.5, status: 'pulse' },
  { hr: 103, spo2: 91, tempC: 36.4, status: 'pulse' },
  { hr: 104, spo2: 92, tempC: 36.4, status: 'pulse' },
  { hr: 104, spo2: 93, tempC: 36.4, status: 'pulse' },
];

/** A flat line with sensor noise (no pulse), one batch per second at 25 Hz. */
const FLAT_WAVEFORM: number[][] = [0, 1, 2, 3].map(b =>
  Array.from({ length: SEIZURE_WAVEFORM_RATE_HZ }, (_, i) => 110000 + Math.round(40 * Math.sin((b * 25 + i) * 1.7))),
);

/** A calm pulse at ~100/min: a sharp upstroke and a slower fall, one batch per second at 25 Hz. */
const PULSE_WAVEFORM: number[][] = [0, 1, 2, 3].map(b =>
  Array.from({ length: SEIZURE_WAVEFORM_RATE_HZ }, (_, i) => {
    const phase = ((b * 25 + i) % 15) / 15; // 15 samples a beat = 100/min at 25 Hz
    const pulse = phase < 0.2 ? phase / 0.2 : Math.exp(-(phase - 0.2) * 4);
    return 110000 + Math.round(1500 * pulse);
  }),
);

/**
 * Normal vitals for a patient teammate whose finger clip is off or unreliable (/controls "Normal vitals", Sun ~06:15).
 * 60 one-second rows that loop: HR drifts 72–84 with small beat-to-beat jitter, SpO₂ 97–99, temperature 36.6–36.8.
 * Deterministic (a fixed pseudo-random sequence), so every run looks the same and nothing here is a measurement.
 */
export const NORMAL_VITALS: SyntheticVitals[] = Array.from({ length: 60 }, (_, i) => {
  const slow = Math.sin((i / 60) * 2 * Math.PI); // one slow swing over the minute
  const jitter = ((i * 7919) % 7) - 3; // -3..3, fixed per second
  const hr = Math.round(78 + 5 * slow + jitter * 0.6);
  const spo2 = 98 + (((i * 31) % 10) < 2 ? -1 : ((i * 31) % 10) > 8 ? 1 : 0);
  return { hr, spo2, tempC: Math.round((36.7 + 0.1 * slow) * 10) / 10, status: 'pulse' };
});

type Scenario = { label: string; vitals: SyntheticVitals[]; waveform: number[][]; /** wrap around instead of holding the last row */ loop?: boolean };

/** Every scenario by vitals_override.scenario name. */
export const SCENARIOS: Record<string, Scenario> = {
  seizure: { label: 'seizure', vitals: SEIZURE_VITALS, waveform: SEIZURE_WAVEFORM },
  arrest: { label: 'arrest (no pulse)', vitals: ARREST_VITALS, waveform: FLAT_WAVEFORM },
  rosc: { label: 'ROSC', vitals: ROSC_VITALS, waveform: PULSE_WAVEFORM },
  normal: { label: 'normal vitals', vitals: NORMAL_VITALS, waveform: PULSE_WAVEFORM, loop: true },
};

/** Device name on rows written by a scenario (sim-seizure, sim-arrest, sim-rosc), never mistaken for the relay. */
export function syntheticDevice(scenario: string) {
  return `sim-${scenario}`;
}

/** The synthetic row for second `index` of a scenario (holds the last row after the end, or loops when `loop` is set). */
export function scenarioFrame(scenario: string, index: number) {
  const sc = SCENARIOS[scenario] ?? SCENARIOS.seizure;
  const i = Math.max(0, index);
  return {
    vitals: sc.vitals[sc.loop ? i % sc.vitals.length : Math.min(i, sc.vitals.length - 1)],
    waveform: sc.waveform[i % sc.waveform.length],
  };
}
