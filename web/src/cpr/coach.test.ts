import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Coach, type CoachInput, type CoachOutput } from './coach.ts';

const base: CoachInput = {
  now: 0,
  inArrest: true,
  fingerDetected: true,
  rate: 110,
  compressing: true,
  sinceLast: 0.3,
  onBeatPct: 95,
  beatN: 8,
  speaking: false,
};

/** Run the coach from t0 to t1 every 0.25 s with `patch(t)`; returns the outputs with their times. */
function run(coach: Coach, t0: number, t1: number, patch: (t: number) => Partial<CoachInput> = () => ({})) {
  const out: (CoachOutput & { t: number })[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += 0.25) out.push({ t, ...coach.step({ ...base, now: t, ...patch(t) }) });
  return out;
}
const cues = (out: (CoachOutput & { t: number })[]) => out.filter(o => o.cue).map(o => `${o.t}:${o.cue!.text}`);

test('not in an arrest: idle, silent, no beat', () => {
  const out = run(new Coach(), 0, 10, () => ({ inArrest: false }));
  assert.ok(out.every(o => o.mode === 'idle' && !o.metronome && !o.cue));
});

test('arrest without the finger sensor: no beat, asks for the sensor every 20 s', () => {
  const out = run(new Coach(), 0, 45, () => ({ fingerDetected: false, compressing: false, rate: null, sinceLast: null }));
  assert.ok(out.every(o => o.mode === 'waiting_for_sensor' && !o.metronome));
  assert.deepEqual(cues(out), ['0:Place the finger sensor', '20:Place the finger sensor', '40:Place the finger sensor']);
});

test('finger detected: beat starts; good CPR stays quiet', () => {
  const coach = new Coach();
  run(coach, 0, 2, () => ({ fingerDetected: false }));
  const out = run(coach, 2.25, 30);
  assert.ok(out.every(o => o.mode === 'active' && o.metronome));
  assert.deepEqual(cues(out), []);
});

test('slow CPR: "Faster" after 5 s, repeated no sooner than 10 s (§15)', () => {
  const out = run(new Coach(), 0, 26, () => ({ rate: 92 }));
  assert.deepEqual(cues(out), ['5:Faster', '15:Faster', '25:Faster']);
});

test('fast CPR: "Slower" after 5 s', () => {
  assert.deepEqual(cues(run(new Coach(), 0, 6, () => ({ rate: 135 }))), ['5:Slower']);
});

test('right rate, off the beat: "Follow the beat"', () => {
  assert.deepEqual(cues(run(new Coach(), 0, 4, () => ({ onBeatPct: 40 }))), ['3:Follow the beat']);
});

test('no compressions for 10 s: paused, "Resume compressions" every 10 s, beat keeps going', () => {
  const coach = new Coach();
  run(coach, 0, 5);
  const out = run(coach, 5.25, 32, t => ({ compressing: false, rate: null, sinceLast: t - 5 }));
  assert.ok(out.filter(o => o.t >= 15).every(o => o.mode === 'paused' && o.metronome));
  assert.deepEqual(cues(out), ['15:Resume compressions', '25:Resume compressions']);
});

test('finger taken off mid-CPR never stops the beat', () => {
  const coach = new Coach();
  run(coach, 0, 5);
  const out = run(coach, 5.25, 20, () => ({ fingerDetected: false }));
  assert.ok(out.every(o => o.mode === 'active' && o.metronome));
});

test('never speaks over other speech, and keeps 4 s between cues', () => {
  const coach = new Coach();
  const out = run(coach, 0, 10, t => ({ rate: 92, speaking: t >= 4.5 && t < 7 }));
  // Faster becomes due at 5 s but speech is on until 7 s; then one cue, then nothing for 4 s.
  assert.deepEqual(cues(out), ['7:Faster']);
});

test('pause time counts from activation: old bumps before the arrest never trigger "Resume compressions"', () => {
  // The detector last saw a bump 30 s ago (walking to the patient); assistance has just started.
  const out = run(new Coach(), 0, 9, () => ({ compressing: false, rate: null, sinceLast: 30 }));
  assert.ok(out.every(o => o.mode === 'active'));
  assert.deepEqual(cues(out), []);
});

test('demo CPR override: beat keeps going, no rate or pause cues from the phone', () => {
  const out = run(new Coach(), 0, 30, () => ({ override: true, compressing: false, rate: null, sinceLast: null }));
  assert.ok(out.every(o => o.mode === 'active' && o.metronome));
  assert.deepEqual(cues(out), []);
});

test('leaving the arrest (ROSC) stops everything and resets', () => {
  const coach = new Coach();
  run(coach, 0, 5, () => ({ rate: 92 }));
  const out = run(coach, 5.25, 8, () => ({ inArrest: false }));
  assert.ok(out.every(o => o.mode === 'idle' && !o.metronome && !o.cue));
});
