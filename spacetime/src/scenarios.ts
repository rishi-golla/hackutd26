// Hardcoded synthetic scenarios that override the relay's sensor data (synthesize_seizure).
// Edit the numbers freely: tick_rules plays SEIZURE_VITALS one row per second from the moment the
// scenario starts, then holds the last row. Waveform batches cycle.
// All rows written from here are stored with simulated = true. Synthetic data, not a medical model.

export type SyntheticVitals = {
  hr: number | undefined;
  spo2: number | undefined;
  tempC: number | undefined;
  /** relay status vocabulary: pulse | acquiring | no finger | ... (hr/spo2 only count when 'pulse') */
  status: string;
};

/** Device name on rows written by the scenario, so they're never mistaken for the real relay. */
export const SYNTHETIC_DEVICE = 'sim-seizure';

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

/** The synthetic row for second `index` of the scenario (holds the last row after the end). */
export function seizureFrame(index: number) {
  const i = Math.max(0, index);
  return {
    vitals: SEIZURE_VITALS[Math.min(i, SEIZURE_VITALS.length - 1)],
    waveform: SEIZURE_WAVEFORM[i % SEIZURE_WAVEFORM.length],
  };
}
