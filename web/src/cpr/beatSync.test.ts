// Beat sync on synthetic chest motion run through the real detector.
// The synthetic deepest point of compression k is at (k + 0.75) · T, so a metronome grid at t0 = 0.75 · T is
// "perfectly on the beat".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompressionDetector, synthMotion } from './dsp.ts';
import { BeatSync } from './beatSync.ts';

function run(opts: { cpm: number; gridBpm?: number; phaseS?: number; timingJitterS?: number; seed?: number; seconds?: number }) {
  const gridBpm = opts.gridBpm ?? 110;
  const sync = new BeatSync();
  sync.setGrid(0.75 * (60 / gridBpm), gridBpm);
  const det = new CompressionDetector();
  const s = synthMotion({ seconds: opts.seconds ?? 20, cpm: opts.cpm, phaseS: opts.phaseS, timingJitterS: opts.timingJitterS, seed: opts.seed ?? 11 });
  for (const x of s) {
    const pt = det.process(x.t, x.ax, x.ay, x.az);
    if (pt !== null && pt > 3) sync.addCompression(pt);
  }
  return { sync, det };
}

test('on the beat at 110/min: ≥ 90 % on beat, mean error near 0', () => {
  const { sync } = run({ cpm: 110 });
  const st = sync.stats();
  assert.ok(st.onBeatPct !== null && st.onBeatPct >= 90, `on beat ${st.onBeatPct}`);
  assert.ok(Math.abs(st.meanErrMs!) < 40, `mean error ${st.meanErrMs}`);
});

test('a steady 150 ms lag reads as late and mostly off the beat', () => {
  const { sync } = run({ cpm: 110, phaseS: 0.15 });
  const st = sync.stats();
  assert.ok(st.meanErrMs! > 100 && st.meanErrMs! < 200, `mean error ${st.meanErrMs}`);
  assert.ok(st.onBeatPct! <= 30, `on beat ${st.onBeatPct}`);
});

test('calibration absorbs a steady habit: after calibrating a 150 ms lag, the same rhythm is on the beat', () => {
  const { sync } = run({ cpm: 110, phaseS: 0.15 });
  const offset = sync.calibrate();
  assert.ok(offset !== null && Math.abs(offset - 150) < 40, `offset ${offset}`);
  // Same rescuer, same habit, new run with the learned offset.
  const again = new BeatSync(offset!);
  again.setGrid(0.75 * (60 / 110), 110);
  const det = new CompressionDetector();
  for (const x of synthMotion({ seconds: 20, cpm: 110, phaseS: 0.15, seed: 12 })) {
    const pt = det.process(x.t, x.ax, x.ay, x.az);
    if (pt !== null && pt > 3) again.addCompression(pt);
  }
  assert.ok(again.stats().onBeatPct! >= 90, `on beat ${again.stats().onBeatPct}`);
});

test('wrong tempo (95/min against a 110 beat) drifts off the beat', () => {
  const { sync } = run({ cpm: 95, seconds: 30 });
  assert.ok(sync.stats().onBeatPct! <= 50, `on beat ${sync.stats().onBeatPct}`);
});

test('human timing jitter (50 ms) still reads as mostly on the beat', () => {
  const { sync } = run({ cpm: 110, timingJitterS: 0.05, seed: 21 });
  assert.ok(sync.stats().onBeatPct! >= 70, `on beat ${sync.stats().onBeatPct}`);
});

test('no grid, no verdict', () => {
  const sync = new BeatSync();
  assert.equal(sync.addCompression(1.23), null);
  assert.deepEqual(sync.stats(), { n: 0, onBeatPct: null, meanErrMs: null });
});

test('calibration rejects a sloppy run (not following the beat) and keeps the old offset', () => {
  const { sync } = run({ cpm: 95, seconds: 30 }); // drifting against a 110 beat: errors spread over the whole cycle
  assert.equal(sync.calibrate(), null);
  assert.equal(sync.offsetMs, 0);
});
