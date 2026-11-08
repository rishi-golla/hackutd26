// CPR metronome: short clicks scheduled ahead on the AudioContext clock (a 25 ms timer keeps 100 ms of beats
// queued), so timing stays exact even when the main thread is busy. Each beat is reported on the
// performance.now() clock at the moment it leaves the speaker, the same clock as DeviceMotion timestamps, so
// beatSync can compare compressions with beats directly.

const LOOKAHEAD_S = 0.1;
const TICK_MS = 25;

export class Metronome {
  bpm = 110;
  /** Called when a beat is scheduled: its output time (s, performance.now clock) and index. */
  onBeat?: (beatPerfS: number, index: number) => void;
  private master: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeatCtx = 0;
  private index = 0;

  constructor(private ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(bpm = this.bpm): void {
    if (this.running) return;
    this.bpm = bpm;
    this.index = 0;
    this.nextBeatCtx = this.ctx.currentTime + 0.15;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Quieter while something is being spoken, so the words are heard; the beat never stops. */
  duck(on: boolean): void {
    this.master.gain.setTargetAtTime(on ? 0.25 : 1, this.ctx.currentTime, 0.03);
  }

  /** AudioContext time → performance.now() seconds at which that sound leaves the speaker. */
  toPerfSeconds(ctxTime: number): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0) {
      return ts.performanceTime / 1000 + (ctxTime - ts.contextTime);
    }
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return performance.now() / 1000 + (ctxTime - this.ctx.currentTime) + latency;
  }

  private tick(): void {
    while (this.nextBeatCtx < this.ctx.currentTime + LOOKAHEAD_S) {
      this.click(this.nextBeatCtx);
      this.onBeat?.(this.toPerfSeconds(this.nextBeatCtx), this.index++);
      this.nextBeatCtx += 60 / this.bpm;
    }
  }

  /** A 40 ms 1.5 kHz click with a fast attack: sharp enough to compress to, short enough not to mask speech. */
  private click(t: number): void {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.frequency.value = 1500;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.9, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}
