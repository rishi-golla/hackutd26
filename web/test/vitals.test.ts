import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epiText, etaMinutes, readingOf, statusPhases, statusTone } from '../src/routes/hospital/vitals';

const ts = (ms: number) => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n }) as never;
const now = 1_000_000;
const vit = (ms: number, extra: Record<string, unknown>) => ({ ts: ts(ms), device: 'relay-1', status: 'pulse', ...extra });

test('a reading is live, held briefly through a dropout, measuring while the sensor settles, else none', () => {
  assert.deepEqual(readingOf([vit(now - 1000, { hr: 88 })], r => r.hr as number | undefined, now), { kind: 'live', value: 88 });
  assert.deepEqual(readingOf([vit(now - 500, { status: 'no finger' }), vit(now - 3000, { hr: 88 })], r => r.hr as number | undefined, now), { kind: 'held', value: 88 });
  assert.deepEqual(readingOf([vit(now - 500, { status: 'acquiring' }), vit(now - 9000, { hr: 88 })], r => r.hr as number | undefined, now), { kind: 'measuring' });
  assert.deepEqual(readingOf([vit(now - 9000, { hr: 88 })], r => r.hr as number | undefined, now), { kind: 'none' }, 'a stale number is never shown');
});

test('the phase bar follows the status events and stops when the call closes', () => {
  const start = 0;
  const phases = statusPhases(start, 600_000, [
    { ts: ts(0), kind: 'status_on_scene' },
    { ts: ts(120_000), kind: 'status_arrest' },
    { ts: ts(300_000), kind: 'status_rosc' },
    { ts: ts(400_000), kind: 'med_epinephrine' },
    { ts: ts(450_000), kind: 'status_en_route' },
  ]);
  assert.deepEqual(phases.map(p => [p.status, p.startMs, p.endMs]), [
    ['on_scene', 0, 120_000], ['arrest', 120_000, 300_000], ['rosc', 300_000, 450_000], ['en_route', 450_000, 600_000],
  ]);
  assert.deepEqual(statusPhases(0, 100, [{ ts: ts(50), kind: 'status_closed' }]).map(p => p.status), ['on_scene']);
});

test('status tones and the epi timer text', () => {
  assert.equal(statusTone('arrest'), 'red');
  assert.equal(statusTone('rosc'), 'green');
  assert.equal(statusTone('en_route'), 'blue');
  assert.equal(statusTone('closed'), 'grey');
  assert.equal(epiText({ state: 'pending', dueAt: ts(now + 90_000) }, now), '1:30');
  assert.equal(epiText({ state: 'due', dueAt: ts(now + 90_000) }, now), 'Due now');
});

test('an ETA is no longer shown after arrival or incident close even when the timestamp remains', () => {
  const eta = ts(now + 120_000);
  assert.equal(etaMinutes('en_route', eta, now), 2);
  assert.equal(etaMinutes('en_route', ts(now - 60_000), now), 0);
  assert.equal(etaMinutes('arrived', eta, now), undefined);
  assert.equal(etaMinutes('closed', eta, now), undefined);
  assert.equal(etaMinutes('on_scene', undefined, now), undefined);
});
