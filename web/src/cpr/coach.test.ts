import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Coach, type CoachInput, type CoachOutput } from './coach.ts';

const base: CoachInput = { now: 0, inArrest: true, fingerDetected: true, sinceLast: 0.3 };

/** Run the coach from t0 to t1 every 0.25 s with `patch(t)`; returns the outputs with their times. */
function run(coach: Coach, t0: number, t1: number, patch: (t: number) => Partial<CoachInput> = () => ({})) {
  const out: (CoachOutput & { t: number })[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += 0.25) out.push({ t, ...coach.step({ ...base, now: t, ...patch(t) }) });
  return out;
}

test('not in an arrest: idle, no beat', () => {
  const out = run(new Coach(), 0, 10, () => ({ inArrest: false }));
  assert.ok(out.every(o => o.mode === 'idle' && !o.metronome));
});

test('arrest without the finger sensor: waits, no beat', () => {
  const out = run(new Coach(), 0, 30, () => ({ fingerDetected: false, sinceLast: null }));
  assert.ok(out.every(o => o.mode === 'waiting_for_sensor' && !o.metronome));
});

test('finger detected: the beat starts at once', () => {
  const coach = new Coach();
  run(coach, 0, 2, () => ({ fingerDetected: false }));
  const out = run(coach, 2.25, 30);
  assert.ok(out.every(o => o.mode === 'active' && o.metronome));
});

test('no compressions for 10 s: paused, the beat keeps going', () => {
  const coach = new Coach();
  run(coach, 0, 5);
  const out = run(coach, 5.25, 20, t => ({ sinceLast: t - 5 }));
  assert.ok(out.filter(o => o.t < 15).every(o => o.mode === 'active'));
  assert.ok(out.filter(o => o.t >= 15).every(o => o.mode === 'paused' && o.metronome));
});

test('pause time counts from activation: old bumps before the arrest never read as a pause', () => {
  const out = run(new Coach(), 0, 9, () => ({ sinceLast: 30 }));
  assert.ok(out.every(o => o.mode === 'active'));
});

test('finger taken off mid-CPR never stops the beat', () => {
  const coach = new Coach();
  run(coach, 0, 5);
  const out = run(coach, 5.25, 20, () => ({ fingerDetected: false }));
  assert.ok(out.every(o => o.mode === 'active' && o.metronome));
});

test('leaving the arrest (ROSC) stops the beat; the next arrest waits for the sensor again', () => {
  const coach = new Coach();
  run(coach, 0, 5);
  assert.ok(run(coach, 5.25, 8, () => ({ inArrest: false })).every(o => o.mode === 'idle' && !o.metronome));
  assert.equal(coach.step({ ...base, now: 9, fingerDetected: false }).mode, 'waiting_for_sensor');
});
