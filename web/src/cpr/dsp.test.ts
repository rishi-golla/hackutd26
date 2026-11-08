// Same checks as the hardware branch's DSP self-test (hardware/software/phone/index.html selfTest()).
// Run: cd web && npm run test:cpr
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BandPass, CompressionDetector, PeakDetector, runDetector, synthMotion } from './dsp.ts';

test('band-pass 0.7-4 Hz passes 1.8 Hz, blocks DC and 15 Hz', () => {
  const bp = new BandPass(60, 0.7, 4);
  assert.ok(bp.gainAt(1.8, 60) > 0.8, `gain at 1.8 Hz ${bp.gainAt(1.8, 60).toFixed(2)}`);
  assert.ok(bp.gainAt(1e-6, 60) < 1e-3, 'DC not blocked');
  assert.ok(bp.gainAt(15, 60) < 0.1, `gain at 15 Hz ${bp.gainAt(15, 60).toFixed(3)}`);
});

test('peak detector counts a double bump inside the refractory window once', () => {
  const sig = new Array(300).fill(0);
  const pd = new PeakDetector(100, { refractoryS: 0.3 });
  const found: number[] = [];
  for (const [c, h] of [
    [100, 0.8],
    [115, 1.0],
  ]) {
    for (let i = -5; i <= 5; i++) sig[c + i] = Math.max(sig[c + i], h * (1 - Math.abs(i) / 6));
  }
  for (const x of sig) {
    const p = pd.process(x);
    if (p !== null) found.push(p);
  }
  assert.deepEqual(found, [100]);
});

for (const cpm of [80, 110, 140]) {
  test(`compression rate ${cpm}/min within 3 (random tilt, 60 Hz, jitter)`, () => {
    const s = synthMotion({ seconds: 20, cpm, seed: cpm });
    const det = runDetector(s);
    const st = det.state(s[s.length - 1].t);
    assert.ok(st.rate !== null && Math.abs(st.rate - cpm) <= 3, `rate ${st.rate}`);
    const expected = (20 * cpm) / 60;
    assert.ok(Math.abs(det.count - expected) <= 3, `count ${det.count} vs ~${expected.toFixed(0)}`);
  });
}

test('shallow compressions (0.5 cm) at 110/min still counted', () => {
  const s = synthMotion({ seconds: 15, cpm: 110, depthM: 0.005, seed: 3 });
  const st = runDetector(s).state(s[s.length - 1].t);
  assert.ok(st.rate !== null && Math.abs(st.rate - 110) <= 3, `rate ${st.rate}`);
});

test('100 Hz sensor rate and phone lying flat', () => {
  const s = synthMotion({ seconds: 15, cpm: 110, fs: 100, tiltDeg: 0, seed: 4 });
  const st = runDetector(s).state(s[s.length - 1].t);
  assert.ok(st.rate !== null && Math.abs(st.rate - 110) <= 3, `rate ${st.rate}`);
});

test('still phone: no compressions counted', () => {
  const s = synthMotion({ seconds: 15, cpm: 110, depthM: 0, seed: 5 });
  assert.equal(runDetector(s).count, 0);
});

test('pause > 10 s is flagged, resume clears it', () => {
  const s = synthMotion({ seconds: 40, cpm: 110, pauses: [[12, 25]], seed: 6 });
  const det = new CompressionDetector();
  let seenPause = false;
  let seenRateAfter = false;
  for (const x of s) {
    det.process(x.t, x.ax, x.ay, x.az);
    const st = det.state(x.t);
    if (x.t > 12 && x.t < 21) assert.ok(!st.paused, `paused too early at ${x.t.toFixed(1)} s`);
    if (x.t > 23 && x.t < 25) seenPause ||= st.paused;
    if (x.t > 32) seenRateAfter ||= st.rate !== null && Math.abs(st.rate - 110) <= 4;
  }
  assert.ok(seenPause, 'pause not flagged');
  assert.ok(seenRateAfter, 'rate did not come back after the pause');
});
