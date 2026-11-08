import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentStep } from '../src/module_bindings/types';
import { agentLabel, decisionUpdate, groupThoughts, headline, liveThoughts, stepSentence } from '../src/routes/hospital/thoughts';

const row = (id: number, tool: string, summary: string, ms = id * 1000): AgentStep => ({
  id: BigInt(id), incidentId: 1n, workflow: 'voice', tool, summary,
  ts: { microsSinceUnixEpoch: BigInt(ms) * 1000n } as AgentStep['ts'],
});
const update = (id: number, turn: string, phase: string, text: string, ms?: number) => row(id, 'decision', JSON.stringify({ v: 1, id: turn, phase, text }), ms);

test('interleaved decisions and deterministic read-backs stay separate, with accurate source labels', () => {
  const thoughts = groupThoughts([
    update(1, 'a', 'progress', 'Requesting patient records.'),
    update(2, 'b', 'progress', 'Reviewing state.'),
    row(3, 'read_back', 'Epinephrine 1 mg'),
    update(4, 'b', 'complete', 'Continuing to monitor.'),
    update(5, 'a', 'error', 'Request failed.'),
  ]);
  assert.equal(thoughts.length, 3);
  assert.deepEqual(thoughts[0].steps.map(s => s.id), [1n, 5n]);
  assert.deepEqual(thoughts[1].steps.map(s => s.id), [2n, 4n]);
  assert.equal(agentLabel(thoughts[2]), 'Agent · voice');
  assert.equal(agentLabel(thoughts[0]), 'Nemotron · voice');
  assert.equal(stepSentence(headline(thoughts[0]), 'done').phrase, 'Request failed.');
});

test('completion immediately leaves the live line and its summary survives reconnect replay', () => {
  const rows = [update(1, 'a', 'progress', 'Reviewing state.'), update(2, 'a', 'complete', 'Continuing to monitor.')];
  const thoughts = groupThoughts(rows.reverse());
  assert.equal(liveThoughts(thoughts, 2100).size, 0);
  assert.equal(thoughts.length, 1);
  assert.equal(stepSentence(headline(thoughts[0]), 'done').phrase, 'Continuing to monitor.');
});

test('missing completion expires without inventing success; long requests keep their ID', () => {
  const thought = groupThoughts([update(1, 'a', 'progress', 'Requesting the record.')])[0];
  assert.equal(liveThoughts([thought], 1100).size, 1);
  assert.equal(liveThoughts([thought], 22_000).size, 0);
  assert.equal(liveThoughts([thought], 0).size, 0, 'future clock skew never displays busy forever');
  assert.equal(stepSentence(headline(thought), 'done').phrase, 'No completion received');
  const replay = groupThoughts([...thought.steps, update(2, 'a', 'complete', 'Review finished.', 40_000)]);
  assert.equal(replay.length, 1);
  assert.equal(replay[0].closed, true);
});

test('unknown and malformed legacy rows remain readable; queued speech is never called delivered', () => {
  const malformed = row(1, 'decision', '{bad json');
  assert.equal(decisionUpdate(malformed), undefined);
  assert.equal(stepSentence(malformed, 'done').phrase, '{bad json');
  assert.equal(stepSentence(row(2, 'new_tool', 'A readable legacy summary'), 'done').phrase, 'A readable legacy summary');
  assert.equal(stepSentence(row(3, 'speak', 'P1 answer: Hello'), 'done').phrase, 'Queued speech');
  const workflow = { ...row(4, 'plan', 'Choose hospital'), workflow: 'W1' };
  assert.equal(agentLabel(groupThoughts([workflow])[0]), 'Agent · W1', 'legacy rows do not prove a model ran');
});

test('pending or failed EHR fetches never read as a completed pull', () => {
  const pending = stepSentence(row(1, 'ehr_get_record', 'pt-0001 (spoken name)'), 'now');
  const failed = stepSentence(row(2, 'ehr_get_record', 'failed: EHR unavailable'), 'done');
  assert.doesNotMatch(`${pending.phrase} ${pending.detail}`, /pulled/i);
  assert.doesNotMatch(`${failed.phrase} ${failed.detail}`, /pulled/i);

  const saved = stepSentence(row(3, 'save_patient_record', 'Jordan Avery: 1 allergies, 2 meds (EHR)'), 'done');
  assert.match(`${saved.phrase} ${saved.detail}`, /saved/i);
});

test('repeated camera findings are bounded and bookkeeping is hidden', () => {
  const frames = Array.from({ length: 70 }, (_, i) => row(i + 1, 'vision', `pads ${i}`, i * 1000));
  const thoughts = groupThoughts([...frames, row(71, 'policy', 'Dropped speech')]);
  assert.equal(thoughts.length, 2);
  assert.ok(thoughts.every(t => t.steps.length === 1));
});
