import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeen, personName, seenEvent } from '../src/seen.js';
import { Brain } from '../src/brain.js';
import { Policy } from '../src/policy.js';
import type { Speaker } from '../src/speaker.js';
import { callsTo, fakeConn, nowTs } from './fakes.js';

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const stubSpeaker = { recentlySaid: () => [], dropUnspokenReadbacks: async () => {} } as unknown as Speaker;

test('personName reads "LAST, FIRST" cards and plain names', () => {
  assert.equal(personName('AVERY, JORDAN'), 'Jordan Avery');
  assert.equal(personName('jordan  avery'), 'Jordan Avery');
});

test('parseSeen validates the finding shapes the vision sampler posts', () => {
  assert.deepEqual(parseSeen({ type: 'id_card', name: 'AVERY, JORDAN', birth_date: '1968-03-14', confidence: 0.99 }), {
    type: 'id_card', name: 'Jordan Avery', birthDate: '1968-03-14', confidence: 0.99, detail: undefined,
  });
  assert.equal(parseSeen({ type: 'id_card', name: 'Jordan Avery', birthDate: 'March 14' }), undefined, 'birth date must be ISO');
  assert.equal(parseSeen({ type: 'id_card', name: 'Jordan', birthDate: '1968-03-14' }), undefined, 'a single name is not an identity');
  assert.deepEqual(parseSeen({ type: 'medication', drug: 'epinephrine', dose: '1 mg/10 mL' }), {
    type: 'medication', drug: 'epinephrine', dose: '1 mg/10 mL', confidence: undefined, detail: undefined,
  });
  assert.deepEqual(parseSeen({ type: 'aed_pads', detail: 'evidence/1-aed.jpg' }), { type: 'aed_pads', confidence: undefined, detail: 'evidence/1-aed.jpg' });
  assert.equal(parseSeen({ type: 'face', confidence: 1 }), undefined);
  assert.equal(parseSeen({}), undefined);
});

test('seenEvent names drugs through the read-back aliases and never logs one it cannot name', () => {
  assert.deepEqual(seenEvent({ type: 'medication', drug: 'epi', dose: '1 mg' }), { kind: 'med_epinephrine', label: 'Epinephrine 1 mg' });
  assert.deepEqual(seenEvent({ type: 'medication', drug: 'Amiodarone' }), { kind: 'med_amiodarone', label: 'Amiodarone' });
  assert.deepEqual(seenEvent({ type: 'medication', drug: 'sodium bicarb', dose: '50 mEq' }), { kind: 'med_sodium_bicarbonate', label: 'Sodium Bicarbonate 50 mEq' });
  assert.equal(seenEvent({ type: 'medication', drug: 'saline flush' }), undefined);
  assert.deepEqual(seenEvent({ type: 'aed_pads' }), { kind: 'procedure', label: 'AED pads on' });
  assert.deepEqual(seenEvent({ type: 'airway_device' }), { kind: 'airway', label: 'Airway device placed' });
});

test('a drug the camera saw is logged with source seen and the brain asks for the dose (RB8, RB9)', async () => {
  const { conn, db, rows, calls } = fakeConn({
    incident: [{ id: 1n, unit: 'Medic 12', status: 'arrest', demoMode: true, startedAt: nowTs(), updatedAt: nowTs() }],
  });
  const brain = new Brain(conn, stubSpeaker, new Policy(conn));
  await quiet(async () => {
    brain.start();
    assert.equal(await brain.handleSeen({ type: 'medication', drug: 'epinephrine', confidence: 0.91, detail: 'evidence/1-epinephrine.jpg' }), 'logged');
    const logged = callsTo(calls, 'logEvent');
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0].args, { kind: 'med_epinephrine', label: 'Epinephrine', sourceKind: 'seen', sourceDetail: 'evidence/1-epinephrine.jpg' });
    // The module writes the row; it comes back "logged" with a seen source, and onEvent takes it from there.
    db.event.insert({ id: 1n, incidentId: 1n, ts: nowTs(), kind: 'med_epinephrine', label: 'Epinephrine', sources: [{ kind: 'seen', detail: 'evidence/1-epinephrine.jpg' }], mergedCount: 1, status: 'logged' });
    await wait(50);
    assert.ok(callsTo(calls, 'setEventStatus').some(c => c.args.eventId === 1n && c.args.status === 'flagged'), 'seen but not said stays flagged');
    assert.ok(rows.callout.some(c => c.text === 'Saw epinephrine. What dose?'), 'asks for the dose once');
    brain.stop();
  });
});

test('a drug the camera saw with a printed dose keeps that dose in the label and asks to confirm (RB10)', async () => {
  const { conn, db, rows, calls } = fakeConn({
    incident: [{ id: 1n, unit: 'Medic 12', status: 'arrest', demoMode: true, startedAt: nowTs(), updatedAt: nowTs(), patientRef: 'pt-0001' }],
    patientRecord: [{ incidentId: 1n, patientRef: 'pt-0001', name: 'Jordan Avery', birthDate: '1968-03-14', allergies: ['amiodarone'], medications: ['warfarin'], conditions: [], codeStatus: 'Full code', source: 'EHR', updatedAt: nowTs() }],
  });
  const brain = new Brain(conn, stubSpeaker, new Policy(conn));
  await quiet(async () => {
    brain.start();
    assert.equal(await brain.handleSeen({ type: 'medication', drug: 'epi', dose: '1 mg' }), 'logged');
    assert.deepEqual(callsTo(calls, 'logEvent')[0].args.label, 'Epinephrine 1 mg');
    db.event.insert({ id: 1n, incidentId: 1n, ts: nowTs(), kind: 'med_epinephrine', label: 'Epinephrine 1 mg', sources: [{ kind: 'seen', detail: 'vision frame' }], mergedCount: 1, status: 'logged' });
    await wait(50);
    assert.ok(rows.callout.some(c => c.text === 'Saw epinephrine, one milligram. Confirm?'), 'in-range printed dose asks for confirm');
    // The allergy drug: the same deterministic warning as a spoken dose, no words needed.
    assert.equal(await brain.handleSeen({ type: 'medication', drug: 'amiodarone' }), 'logged');
    db.event.insert({ id: 2n, incidentId: 1n, ts: nowTs(), kind: 'med_amiodarone', label: 'Amiodarone', sources: [{ kind: 'seen', detail: 'vision frame' }], mergedCount: 1, status: 'logged' });
    await wait(50);
    assert.ok(rows.callout.some(c => c.text.startsWith('Saw amiodarone. Warning: the record lists an amiodarone allergy')), 'allergy warning from the camera alone');
    brain.stop();
  });
});

test('an ID card runs the W6 search with method "ID card" and pulls the record; the same card again does nothing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/Patient?')) return Response.json({ entry: [{ resource: { resourceType: 'Patient', id: 'pt-0001', name: [{ given: ['Jordan'], family: 'Avery' }], birthDate: '1968-03-14' } }] });
    return Response.json({ entry: [
      { resource: { resourceType: 'Patient', id: 'pt-0001', name: [{ given: ['Jordan'], family: 'Avery' }], birthDate: '1968-03-14' } },
      { resource: { resourceType: 'AllergyIntolerance', code: { text: 'amiodarone' } } },
    ] });
  }) as typeof fetch;
  const { conn, rows, calls } = fakeConn({
    incident: [{ id: 1n, unit: 'Medic 12', status: 'active', demoMode: true, startedAt: nowTs(), updatedAt: nowTs() }],
  });
  const brain = new Brain(conn, stubSpeaker, new Policy(conn));
  try {
    await quiet(async () => {
      brain.start();
      assert.equal(await brain.handleSeen({ type: 'id_card', name: 'Jordan Avery', birthDate: '1968-03-14', confidence: 0.99 }), 'identified');
      await wait(50); // identify_patient sets patientRef, and the W6 trigger (onIncident) finishes the pull
      const identified = callsTo(calls, 'identifyPatient');
      assert.deepEqual(identified.map(c => c.args), [{ patientRef: 'pt-0001', method: 'ID card' }]);
      assert.equal(rows.patientRecord.length, 1);
      assert.equal(rows.patientRecord[0].allergies[0], 'amiodarone');
      assert.ok(rows.callout.some(c => c.text.startsWith('Record found. Jordan Avery')), 'spoken summary queued');
      const callouts = rows.callout.length;
      assert.equal(await brain.handleSeen({ type: 'id_card', name: 'AVERY, JORDAN', birthDate: '1968-03-14' }), 'identified');
      assert.equal(callsTo(calls, 'identifyPatient').length, 1, 'not identified twice');
      assert.equal(rows.callout.length, callouts, 'nothing new to say');
      brain.stop();
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('"Handoff, look" and "Handoff, mark" are handled without a model turn (B6)', async () => {
  const { conn, rows, calls } = fakeConn({
    incident: [{ id: 1n, unit: 'Medic 12', status: 'active', demoMode: true, startedAt: nowTs(), updatedAt: nowTs() }],
  });
  const brain = new Brain(conn, stubSpeaker, new Policy(conn));
  await quiet(async () => {
    brain.start();
    await brain.handleUtterance('Handoff, look.', 'pipecat');
    await wait(30);
    assert.equal(callsTo(calls, 'logEvent').length, 0, 'look logs nothing; the sampler answers');
    assert.ok(rows.agentStep.some(s => s.tool === 'look'), 'traced as a look');
    await brain.handleUtterance('Hand off mark', 'pipecat');
    await wait(30);
    const marks = callsTo(calls, 'logEvent');
    assert.equal(marks.length, 1);
    assert.equal(marks[0].args.kind, 'mark');
    assert.equal(marks[0].args.sourceKind, 'voice');
    assert.ok(rows.callout.some(c => c.text === 'Marked.'));
    assert.ok(!rows.agentStep.some(s => s.tool === 'nemotron'), 'no model turn for either shortcut');
    brain.stop();
  });
});

test('without an active incident a finding is traced and not logged', async () => {
  const { conn, calls } = fakeConn();
  const brain = new Brain(conn, stubSpeaker, new Policy(conn));
  await quiet(async () => {
    brain.start();
    assert.equal(await brain.handleSeen({ type: 'aed_pads', confidence: 0.8 }), 'no active incident');
    assert.equal(await brain.handleSeen({ type: 'id_card', name: 'Jordan Avery', birthDate: '1968-03-14' }), 'no active incident');
    assert.equal(callsTo(calls, 'logEvent').length, 0);
    assert.equal(callsTo(calls, 'identifyPatient').length, 0);
    brain.stop();
  });
});
