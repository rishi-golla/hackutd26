import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Policy } from '../src/policy.js';
import { callsTo, fakeConn, nowTs } from './fakes.js';

test('policy applies the word limit for every speech kind', async () => {
  const { conn, calls } = fakeConn();
  const policy = new Policy(conn);
  const limits = { readback: 40, answer: 30, advisory: 15, record: 25, ask: 12, control: 3 } as const;
  for (const [kind, limit] of Object.entries(limits) as [keyof typeof limits, number][]) {
    const words = Array(limit + 1).fill('word').join(' ');
    assert.equal(await policy.say(words, 0, kind), false, `${kind} should reject ${limit + 1} words`);
  }
  assert.equal(callsTo(calls, 'addCallout').length, 0);
  assert.equal(callsTo(calls, 'logAgentStep').filter(c => c.args.tool === 'policy').length, 6);
});

test('a long answer keeps the whole leading sentences that fit; one long sentence is still dropped', async () => {
  const { conn, rows } = fakeConn();
  const policy = new Policy(conn);
  const sentence = 'I can read back doses and check allergies for you.';
  assert.equal(await policy.say(`${sentence} ${sentence} ${sentence} ${sentence}`, 0, 'answer'), true);
  assert.equal(rows.callout[0].text, `${sentence} ${sentence} ${sentence}`);
  assert.equal(await policy.say(Array(31).fill('word').join(' '), 0, 'answer'), false);
});

test('advisories are limited to one per 20 seconds and order wording gets Consider prefix', async () => {
  const { conn, calls, rows } = fakeConn();
  const policy = new Policy(conn);
  assert.equal(await policy.say('Push faster', 2, 'advisory', 'CPR rate 111'), true);
  assert.equal(rows.callout[0].text, 'Consider: Push faster');
  assert.equal(await policy.say('Consider another check', 2, 'advisory', ''), false);
  assert.equal(callsTo(calls, 'addCallout').length, 1);
});

test('answers and advisories drop unsupported numbers, and answer digits become words', async () => {
  const { conn, rows } = fakeConn();
  const policy = new Policy(conn);
  assert.equal(await policy.say('Heart rate is 111', 1, 'answer', 'HR 104'), false);
  assert.equal(await policy.say('SpO2 93 in 2 min', 1, 'answer', 'SpO2 93 in 2 min'), true);
  assert.match(rows.callout[0].text, /ninety-three/);
  assert.match(rows.callout[0].text, /two/);
  assert.doesNotMatch(rows.callout[0].text.replace(/SpO2/g, ''), /\d/);
  assert.equal(await policy.say('Push in 5 minutes', 2, 'advisory', 'CPR rate 110'), false);
});

test('depth claims are dropped; normal priority callouts pass when the queue has no recent item', async () => {
  const { conn, rows } = fakeConn();
  const policy = new Policy(conn);
  assert.equal(await policy.say('Compression depth is unknown', 1, 'answer', 'depth unknown'), false);
  assert.equal(await policy.say('Copy. Epinephrine, one milligram.', 0, 'readback'), true);
  assert.equal(await policy.say('The patient is stable', 1, 'answer'), true);
  assert.equal(rows.callout.length, 2);
});

test('"1 mg" is spoken as "one milligram", "300 mg" as "three hundred milligrams"', async () => {
  const { conn, calls } = fakeConn({ incident: [{ id: 1n, status: 'arrest', startedAt: nowTs(), updatedAt: nowTs(), demoMode: true }] });
  const policy = new Policy(conn);
  await policy.say("We've given epinephrine 1 mg IO and amiodarone 300 mg.", 1, 'answer', 'EVENTS 1 mg 300 mg');
  assert.equal(callsTo(calls, 'addCallout')[0].args.text, "We've given epinephrine one milligram I-O and amiodarone three hundred milligrams.");
});
