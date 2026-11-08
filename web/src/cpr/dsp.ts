// Chest-compression detection from the phone's accelerometer.
// A faithful TypeScript port of the tested detector in the hardware branch:
//   hardware/software/phone/index.html, <script id="dsp"> (and software/pi/lib/dsp.py).
// Algorithm unchanged: gravity estimate → vertical acceleration → band-pass 0.7–4 Hz → prominence peak picker
// (0.25 s refractory) → rate = median of recent intervals; PAUSE after pauseS without a compression.

const SQRT_HALF = Math.SQRT1_2;

/** One 2nd-order IIR section, Direct Form I. RBJ "Audio EQ Cookbook" coefficients, a0 = 1. */
export class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    readonly b0: number,
    readonly b1: number,
    readonly b2: number,
    readonly a1: number,
    readonly a2: number
  ) {
    this.reset(0);
  }

  static design(kind: 'lowpass' | 'highpass', fs: number, f0: number, q = SQRT_HALF): Biquad {
    if (!(f0 > 0 && f0 < fs / 2)) throw new Error(`cut-off ${f0} Hz outside 0..fs/2`);
    const w0 = (2 * Math.PI * f0) / fs;
    const cw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = kind === 'lowpass' ? (1 - cw) / 2 : (1 + cw) / 2;
    const b1 = kind === 'lowpass' ? 1 - cw : -(1 + cw);
    const a0 = 1 + alpha;
    return new Biquad(b0 / a0, b1 / a0, b0 / a0, (-2 * cw) / a0, (1 - alpha) / a0);
  }

  dcGain(): number {
    return (this.b0 + this.b1 + this.b2) / (1 + this.a1 + this.a2);
  }

  /** State as if x0 had been the input forever: no start-up transient. */
  reset(x0: number): void {
    this.x1 = this.x2 = x0;
    this.y1 = this.y2 = this.dcGain() * x0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  gainAt(f: number, fs: number): number {
    const w = (2 * Math.PI * f) / fs;
    const c1 = Math.cos(w), s1 = -Math.sin(w), c2 = Math.cos(2 * w), s2 = -Math.sin(2 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = this.b1 * s1 + this.b2 * s2;
    const dr = 1 + this.a1 * c1 + this.a2 * c2, di = this.a1 * s1 + this.a2 * s2;
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }
}

export class BandPass {
  private hp: Biquad;
  private lp: Biquad;

  constructor(fs: number, lowHz: number, highHz: number) {
    this.hp = Biquad.design('highpass', fs, lowHz);
    this.lp = Biquad.design('lowpass', fs, highHz);
  }

  reset(x0: number): void {
    this.hp.reset(x0);
    this.lp.reset(0);
  }

  process(x: number): number {
    return this.lp.process(this.hp.process(x));
  }

  gainAt(f: number, fs: number): number {
    return this.hp.gainAt(f, fs) * this.lp.gainAt(f, fs);
  }
}

/**
 * Streaming peak picker judged by prominence (height above the lowest point since the previous peak). A candidate
 * starts on a rising sample, follows the signal up while it climbs, and is confirmed once the signal falls back by
 * dropFrac of its prominence; no candidate may start within refractoryS of a confirmed peak.
 */
export class PeakDetector {
  n = 0;
  private refractory: number;
  private thresholdFrac: number;
  private decay: number;
  private minProminence: number;
  private dropFrac: number;
  private prev: number | null = null;
  private valley = Infinity;
  private envelope = 0;
  private candidate: { i: number; v: number } | null = null;
  private lastPeak: number | null = null;

  constructor(
    fs: number,
    opts: { refractoryS?: number; thresholdFrac?: number; envelopeTauS?: number; minProminence?: number; dropFrac?: number } = {}
  ) {
    this.refractory = Math.max(1, Math.round((opts.refractoryS || 0.3) * fs));
    this.thresholdFrac = opts.thresholdFrac === undefined ? 0.5 : opts.thresholdFrac;
    this.decay = Math.exp(-1 / ((opts.envelopeTauS || 2.0) * fs));
    this.minProminence = opts.minProminence || 0;
    this.dropFrac = opts.dropFrac === undefined ? 0.5 : opts.dropFrac;
    this.reset();
  }

  reset(): void {
    this.n = 0;
    this.prev = null;
    this.valley = Infinity;
    this.envelope = 0;
    this.candidate = null;
    this.lastPeak = null;
  }

  /** Feed one sample; returns the index of a newly confirmed peak, or null. */
  process(x: number): number | null {
    const i = this.n++;
    const prev = this.prev;
    const c = this.candidate;
    this.prev = x;
    this.envelope *= this.decay;
    if (!c) {
      this.valley = Math.min(this.valley, x);
      if (
        prev !== null &&
        x > prev &&
        (this.lastPeak === null || i - this.lastPeak >= this.refractory) &&
        x - this.valley > Math.max(this.minProminence, this.thresholdFrac * this.envelope)
      ) {
        this.candidate = { i, v: x };
      }
      return null;
    }
    if (x > c.v) {
      c.i = i;
      c.v = x;
      return null; // still climbing
    }
    const prominence = c.v - this.valley;
    if (c.v - x < this.dropFrac * prominence) return null;
    this.envelope = Math.max(this.envelope, prominence);
    this.lastPeak = c.i;
    this.valley = x;
    this.candidate = null;
    return c.i;
  }
}

/** Events per minute from the median of the good intervals between consecutive events. */
export function ratePerMinute(times: number[], minI: number, maxI: number, minN: number): number | null {
  const iv: number[] = [];
  for (let k = 1; k < times.length; k++) {
    const d = times[k] - times[k - 1];
    if (d >= minI && d <= maxI) iv.push(d);
  }
  if (iv.length < minN) return null;
  iv.sort((a, b) => a - b);
  const m = iv.length % 2 ? iv[(iv.length - 1) / 2] : (iv[iv.length / 2 - 1] + iv[iv.length / 2]) / 2;
  return 60 / m;
}

export type CompressionState = {
  rate: number | null;
  count: number;
  sinceLast: number | null;
  compressing: boolean;
  paused: boolean;
  fs: number | null;
};

/**
 * Chest-compression counter from DeviceMotion accelerationIncludingGravity.
 *  1. gravity = slow average of the acceleration (time constant gravityTauS)
 *  2. vertical = (acc − gravity) projected on the gravity direction → works in any phone orientation
 *  3. band-pass 0.7–4 Hz (42–240 /min), then peak detection with a 0.25 s refractory window
 *  4. rate = median interval of the last compressions; PAUSE when none for > pauseS
 */
export class CompressionDetector {
  count = 0;
  lastPeakT: number | null = null;
  /** Times (s) of the last 12 compressions. */
  peakTimes: number[] = [];
  vertical = 0;
  y = 0;
  fs: number | null = null;
  private gravityTauS: number;
  private minProminence: number;
  private pauseS: number;
  private n = 0;
  private lastT: number | null = null;
  private dtAvg: number | null = null;
  private g: [number, number, number] | null = null;
  private bp: BandPass | null = null;
  private det: PeakDetector | null = null;
  private times: number[] = new Array(256);

  constructor(opts: { gravityTauS?: number; minProminence?: number; pauseS?: number } = {}) {
    this.gravityTauS = opts.gravityTauS || 1.5;
    this.minProminence = opts.minProminence === undefined ? 0.4 : opts.minProminence; // m/s²
    this.pauseS = opts.pauseS || 10;
  }

  reset(): void {
    this.n = 0;
    this.lastT = null;
    this.dtAvg = null;
    this.g = null;
    this.fs = null;
    this.bp = null;
    this.det = null;
    this.times = new Array(256);
    this.peakTimes = [];
    this.count = 0;
    this.lastPeakT = null;
    this.y = 0;
    this.vertical = 0;
  }

  /** t in seconds; ax, ay, az in m/s² (including gravity). Returns the time of a new compression, or null. */
  process(t: number, ax: number, ay: number, az: number): number | null {
    const dt = this.lastT === null ? 0 : t - this.lastT;
    if (this.lastT !== null && (dt <= 0 || dt > 0.5)) {
      this.lastT = t; // gap: skip
      return null;
    }
    this.lastT = t;
    if (dt > 0) this.dtAvg = this.dtAvg === null ? dt : 0.95 * this.dtAvg + 0.05 * dt;
    if (!this.g) this.g = [ax, ay, az];
    else {
      const a = dt / (this.gravityTauS + dt);
      this.g[0] += a * (ax - this.g[0]);
      this.g[1] += a * (ay - this.g[1]);
      this.g[2] += a * (az - this.g[2]);
    }
    const gn = Math.hypot(this.g[0], this.g[1], this.g[2]);
    if (gn < 1) return null;
    const v = ((ax - this.g[0]) * this.g[0] + (ay - this.g[1]) * this.g[1] + (az - this.g[2]) * this.g[2]) / gn;
    this.vertical = v;
    if (this.dtAvg === null || (this.n < 10 && !this.bp)) {
      this.n++;
      return null;
    }
    const fs = 1 / this.dtAvg;
    if (!this.bp || !this.fs || Math.abs(fs - this.fs) / this.fs > 0.2) {
      // (re)design for the real event rate
      this.fs = fs;
      this.bp = new BandPass(fs, 0.7, Math.min(4.0, fs * 0.45));
      this.bp.reset(v);
      this.det = new PeakDetector(fs, { refractoryS: 0.25, thresholdFrac: 0.5, minProminence: this.minProminence });
    }
    this.y = this.bp.process(v);
    const k = this.det!.n;
    this.times[k % this.times.length] = t;
    const idx = this.det!.process(this.y);
    this.n++;
    if (idx === null) return null;
    const pt = this.times[idx % this.times.length];
    this.peakTimes.push(pt);
    if (this.peakTimes.length > 12) this.peakTimes.shift();
    this.count++;
    this.lastPeakT = pt;
    return pt;
  }

  /** `now` in the same clock as process(). */
  state(now: number): CompressionState {
    const since = this.lastPeakT === null ? null : now - this.lastPeakT;
    const compressing = since !== null && since < 2.5;
    const recent = this.peakTimes.slice(-6);
    return {
      rate: compressing ? ratePerMinute(recent, 0.25, 1.5, 3) : null,
      count: this.count,
      sinceLast: since,
      compressing,
      paused: since !== null && since > this.pauseS,
      fs: this.fs,
    };
  }
}

// ---- synthetic signals for tests (same generator as the hardware branch's self-test) ----

function rng(seed: number) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

export type MotionSample = { t: number; ax: number; ay: number; az: number };

/**
 * Phone at a random fixed tilt; the wearer's chest moves up/down depthM (peak) at cpm, with optional pauses.
 * Event times jitter like a browser's. The deepest point of compression k is at t0 + (k + 0.75) · 60/cpm
 * (acceleration −depth·ω²·sin(phase) peaks upward at phase 3π/2). `phaseS` shifts the whole motion later.
 */
export function synthMotion(o: {
  seconds: number;
  cpm?: number;
  seed?: number;
  fs?: number;
  tiltDeg?: number;
  depthM?: number;
  noise?: number;
  pauses?: [number, number][];
  phaseS?: number;
  /** Per-compression timing jitter (s, standard deviation) applied to the phase. */
  timingJitterS?: number;
}): MotionSample[] {
  const r = rng(o.seed || 1);
  const fs = o.fs || 60;
  const out: MotionSample[] = [];
  const th = ((o.tiltDeg === undefined ? 35 : o.tiltDeg) * Math.PI) / 180;
  const ph = r() * 2 * Math.PI;
  const up = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]; // gravity axis in phone frame
  const w = (2 * Math.PI * (o.cpm || 110)) / 60;
  const pauses = o.pauses || [];
  const depth = o.depthM === undefined ? 0.02 : o.depthM;
  const shift = o.phaseS || 0;
  let t = 0;
  let phase = -w * shift;
  let jitterPhase = 0;
  let lastCycle = 0;
  while (t < o.seconds) {
    const dt = 1 / fs + (r() - 0.5) * 0.004;
    t += dt;
    const paused = pauses.some(p => t >= p[0] && t < p[1]);
    let acc = 0;
    if (!paused) {
      phase += w * dt;
      const cycle = Math.floor(phase / (2 * Math.PI));
      if (o.timingJitterS && cycle !== lastCycle) {
        lastCycle = cycle;
        jitterPhase = gauss(r) * o.timingJitterS * w;
      }
      acc = phase > 0 ? -depth * w * w * Math.sin(phase + jitterPhase) : 0;
    }
    const n = o.noise === undefined ? 0.08 : o.noise;
    const g = 9.81 + acc;
    out.push({ t, ax: up[0] * g + n * gauss(r), ay: up[1] * g + n * gauss(r), az: up[2] * g + n * gauss(r) });
  }
  return out;
}

export function runDetector(samples: MotionSample[], det = new CompressionDetector()): CompressionDetector {
  for (const s of samples) det.process(s.t, s.ax, s.ay, s.az);
  return det;
}
