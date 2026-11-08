// Compares each detected compression with the metronome beat. Everything is on one clock: compression times come
// from DeviceMotion timestamps (performance.now, seconds) and the metronome reports when each beat leaves the
// speaker on that same clock (metronome.ts). Pure logic, no browser APIs.

/** A compression within this many ms of a beat counts as on the beat. */
export const ON_BEAT_MS = 120;
/**
 * The detector marks the deepest point of each compression (measured on synthetic motion: within ±15 ms at
 * 50–100 Hz sensor rates, 100–120/min), and the beat means "bottom of the compression now". So the default offset
 * is 0; the 10 s calibration learns the rescuer's own habit.
 */
export const DEFAULT_OFFSET_MS = 0;

/** Calibration limits: interquartile spread of the timing errors, and the largest offset accepted. */
export const MAX_CALIBRATION_IQR_MS = 150;
export const MAX_OFFSET_MS = 200;

export type BeatGrid = { t0: number; periodS: number };
export type BeatStats = { n: number; onBeatPct: number | null; meanErrMs: number | null };

/** Wrap ms into (−period/2, period/2]. */
function wrap(ms: number, periodMs: number): number {
  let e = ms % periodMs;
  if (e > periodMs / 2) e -= periodMs;
  if (e <= -periodMs / 2) e += periodMs;
  return e;
}

export class BeatSync {
  private grid: BeatGrid | null = null;
  /** Corrected signed errors of the last `windowSize` compressions (ms). */
  private window: number[] = [];
  /** Uncorrected errors, for calibration (ms). */
  private raw: number[] = [];

  constructor(
    public offsetMs = DEFAULT_OFFSET_MS,
    private windowSize = 8,
    private onBeatMs = ON_BEAT_MS
  ) {}

  /** The metronome's beats: t0 = time of any beat (s, compression clock), at `bpm`. */
  setGrid(t0: number, bpm: number): void {
    const periodS = 60 / bpm;
    if (!this.grid || Math.abs(this.grid.periodS - periodS) > 1e-6) {
      this.window = [];
      this.raw = [];
    }
    this.grid = { t0, periodS };
  }

  clearGrid(): void {
    this.grid = null;
    this.window = [];
    this.raw = [];
  }

  /** Signed error (ms) of a compression at t against the nearest beat, after the offset; null without a beat. */
  addCompression(t: number): { errorMs: number; onBeat: boolean } | null {
    if (!this.grid) return null;
    const periodMs = this.grid.periodS * 1000;
    const raw = wrap((t - this.grid.t0) * 1000, periodMs);
    this.raw.push(raw);
    if (this.raw.length > 40) this.raw.shift();
    const errorMs = wrap(raw - this.offsetMs, periodMs);
    this.window.push(errorMs);
    if (this.window.length > this.windowSize) this.window.shift();
    return { errorMs, onBeat: Math.abs(errorMs) <= this.onBeatMs };
  }

  stats(): BeatStats {
    const n = this.window.length;
    if (n === 0) return { n, onBeatPct: null, meanErrMs: null };
    const on = this.window.filter(e => Math.abs(e) <= this.onBeatMs).length;
    const mean = this.window.reduce((a, b) => a + b, 0) / n;
    return { n, onBeatPct: (100 * on) / n, meanErrMs: mean };
  }

  /**
   * Learn the rescuer's natural offset: the median uncorrected error of the last `minN`+ compressions made while
   * following the beat. Returns the new offset (ms), or null with too few compressions.
   */
  calibrate(minN = 8): number | null {
    if (this.raw.length < minN) return null;
    const sorted = [...this.raw].sort((a, b) => a - b);
    const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.round(f * (sorted.length - 1)))];
    const median = q(0.5);
    // Only a steady rhythm calibrates: a wide spread (not following the beat) or a huge offset is rejected, so a
    // sloppy run never changes what "on the beat" means.
    if (q(0.75) - q(0.25) > MAX_CALIBRATION_IQR_MS || Math.abs(median) > MAX_OFFSET_MS) return null;
    this.offsetMs = median;
    this.window = [];
    return this.offsetMs;
  }

  reset(): void {
    this.window = [];
    this.raw = [];
  }
}
