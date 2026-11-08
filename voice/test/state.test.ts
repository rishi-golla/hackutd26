import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationJson, readState, summarize } from '../src/state.js';
import { fakeConn, timestamp } from './fakes.js';

test('conversation merges what the medic and Handoff said in time order, with the trace, for the latest incident', () => {
  const t0 = Date.now() - 60_000;
  const { conn } = fakeConn({
    incident: [
      { id: 1n, unit: 'Medic 12', status: 'closed', demoMode: true, startedAt: timestamp(t0 - 600_000), updatedAt: timestamp(t0 - 500_000) },
      { id: 2n, unit: 'Medic 12', status: 'closed', demoMode: true, startedAt: timestamp(t0), updatedAt: timestamp(t0 + 50_000) },
    ],
    transcript: [
      { id: 1n, incidentId: 1n, ts: timestamp(t0 - 550_000), text: 'old call' },
      { id: 2n, incidentId: 2n, ts: timestamp(t0 + 1_000), text: 'Administering one milligram of epinephrine IV' },
      { id: 3n, incidentId: 2n, ts: timestamp(t0 + 5_000), text: 'Yes' },
    ],
    callout: [
      { id: 1n, incidentId: 2n, text: 'Copy. Epinephrine, one milligram, I-V. Log it?', priority: 0, createdAt: timestamp(t0 + 1_500), spokenAt: timestamp(t0 + 2_000) },
      { id: 2n, incidentId: 2n, text: 'Logged.', priority: 0, createdAt: timestamp(t0 + 5_500), spokenAt: undefined },
    ],
    agentStep: [{ id: 1n, incidentId: 2n, ts: timestamp(t0 + 1_200), workflow: 'voice', tool: 'read_back', summary: 'Epinephrine 1 mg IV' }],
  });
  const c = conversationJson(conn);
  assert.deepEqual(c.incident, { id: 2, unit: 'Medic 12', status: 'closed', active: false });
  assert.deepEqual(c.lines.map(l => `${l.who}: ${l.text}`), [
    'user: Administering one milligram of epinephrine IV',
    'assistant: Copy. Epinephrine, one milligram, I-V. Log it?',
    'user: Yes',
    'assistant: Logged.',
  ]);
  assert.equal((c.lines[3] as { spoken?: boolean }).spoken, false, 'queued, not spoken yet');
  assert.deepEqual(c.steps.map(s => s.tool), ['read_back']);
});

test('empty database summarizes as standby with no incident', () => {
  const { conn } = fakeConn();
  assert.equal(summarize(readState(conn)), 'INCIDENT none active (standby). Nothing to coach; only answer direct questions.');
});

test('populated incident summary includes patient, valid fresh data, CPR, timers, events and transcript', () => {
  const now = Date.now();
  const incidentId = 7n;
  const { conn } = fakeConn({
    incident: [{ id: incidentId, unit: 'Medic 12', status: 'arrest', startedAt: timestamp(now - 180_000), updatedAt: timestamp(now), arrestStartedAt: timestamp(now - 180_000), destinationId: 2n, etaAt: timestamp(now + 420_000), patientRef: 'pt-0001', demoMode: true }],
    hospital: [{ id: 2n, name: 'Avon Heart Institute', capabilities: '', driveMin: 7, bedsFree: 1 }],
    patientRecord: [{ incidentId, patientRef: 'pt-0001', name: 'Jordan Avery', birthDate: '1968-03-14', allergies: ['amiodarone'], medications: ['warfarin'], conditions: ['CAD'], codeStatus: 'Full code', source: 'EHR', updatedAt: timestamp(now) }],
    vitals: [{ id: 3n, incidentId, ts: timestamp(now - 1000), device: 'relay', hr: 104, spo2: 93, tempC: 36.4, status: 'pulse', simulated: false }],
    cprState: [{ incidentId, rate: 111, count: 142, sinceLastS: 0, paused: false, compressing: true, source: 'bodycam', updatedAt: timestamp(now), cycleStartedAt: undefined, countBase: 0, rateSum: 111, rateSamples: 1, longestPauseS: 7 }],
    // 32.5 s so the floor stays "0:32" even if a few hundred ms pass before summarize() runs.
    timer: [{ id: 1n, incidentId, kind: 'epi', dueAt: timestamp(now + 32_500), state: 'running' }, { id: 2n, incidentId, kind: 'cycle', dueAt: timestamp(now + 60_000), state: 'cancelled' }],
    event: [{ id: 5n, incidentId, ts: timestamp(now - 60_000), kind: 'med_epinephrine', label: 'Epinephrine 1 mg IO', sources: [{ kind: 'read-back', detail: '', ts: timestamp(now - 60_000) }], mergedCount: 1, status: 'logged' }],
    transcript: [{ id: 9n, incidentId, ts: timestamp(now - 5000), text: 'giving the i-gel now' }],
  });
  const summary = summarize(readState(conn));
  for (const line of [
    'INCIDENT Medic 12 · status ARREST', 'DEMO TIMING on', 'destination Avon Heart Institute', 'PATIENT Jordan Avery, 58 (EHR)',
    'allergies: amiodarone', 'meds: warfarin', 'VITALS (relay, 1 s ago) HR 104 · SpO2 93 (experimental) · temp 36.4 C',
    'CPR rate 111/min · compressing · 142 compressions this arrest', 'longest pause 7 s', 'TIMERS epi due in 0:32',
    'EVENTS (last 8)', 'Epinephrine 1 mg IO [read-back]', 'TRANSCRIPT (last 6)', 'giving the i-gel now',
  ]) assert.ok(summary.includes(line), `missing ${line}\n${summary}`);
  assert.ok(!summary.includes('cycle '));
});

test('stale pulse vitals label relay offline; fresh no-finger vitals explain no valid reading', () => {
  const now = Date.now();
  const incidentId = 8n;
  const base = { id: incidentId, unit: 'Medic 1', status: 'on_scene', startedAt: timestamp(now), updatedAt: timestamp(now), arrestStartedAt: undefined, destinationId: undefined, etaAt: undefined, patientRef: undefined, demoMode: false };
  const stale = fakeConn({ incident: [base], vitals: [{ id: 1n, incidentId, ts: timestamp(now - 7000), device: 'relay', hr: 80, spo2: 98, tempC: 36, status: 'pulse', simulated: false }] });
  assert.match(summarize(readState(stale.conn)), /VITALS no valid reading \(relay offline\)/);
  const noFinger = fakeConn({ incident: [base], vitals: [{ id: 1n, incidentId, ts: timestamp(now), device: 'relay', hr: undefined, spo2: undefined, tempC: undefined, status: 'no finger', simulated: false }] });
  assert.match(summarize(readState(noFinger.conn)), /VITALS no valid reading \(no finger\)/);
});
