// The seizure beat (/controls Seizure: HR climbs to ~170, SpO2 falls to ~80 over 30 s): the brain notices the
// worsening trend, says one note per episode, and the review is visible in the decision log (decision 24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../src/brain.js';
import { CONFIG } from '../src/config.js';
import { Policy } from '../src/policy.js';
import type { Speaker } from '../src/speaker.js';
import { readState, summarize } from '../src/state.js';
import { callsTo, fakeConn, nowTs, timestamp } from './fakes.js';

const speaker = { recentlySaid: () => [], dropUnspokenReadbacks: async () => {} } as unknown as Speaker;

/** 30 one-second readings: SpO2 97 → 84, HR 96 → 165, the newest 1 s old. */
function seizure() {
  const now = Date.now();
  const vitals = Array.from({ length: 30 }, (_, i) => {
    const f = i / 29;
    return { id: BigInt(i + 1), incidentId: 1n, ts: timestamp(now - 30_000 + i * 1000), device: 'sim', hr: Math.round(96 + 69 * f), spo2: Math.round(97 - 13 * f), status: 'pulse', simulated: true };
  });
  return fakeConn({ incident: [{ id: 1n, unit: 'Medic 12', status: 'on_scene', startedAt: nowTs(), updatedAt: nowTs(), demoMode: true }], vitals });
}
const updates = (calls: { reducer: string; args: any }[]) =>
  callsTo(calls, 'logAgentStep').filter(c => c.args.tool === 'decision').map(c => JSON.parse(c.args.summary));
/** The fixed note's own rows: plain `trend` steps (fixed code, labelled "Agent" on the dashboard), never decision rows. */
const trendSteps = (calls: { reducer: string; args: any }[]) => callsTo(calls, 'logAgentStep').filter(c => c.args.tool === 'trend').map(c => c.args.summary as string);
const speakSteps = (calls: { reducer: string; args: any }[]) => callsTo(calls, 'logAgentStep').filter(c => c.args.tool === 'speak').map(c => c.args.summary as string);
const tick = (brain: Brain): Promise<void> => (brain as unknown as { proactiveTick(): Promise<void> }).proactiveTick();

async function withAdvisory(content: string, fn: (requests: any[]) => Promise<void>) {
  const realFetch = globalThis.fetch;
  const key = CONFIG.nvidiaApiKey;
  const proactive = CONFIG.proactive;
  const log = console.log;
  const requests: any[] = [];
  CONFIG.nvidiaApiKey = 'test-key';
  CONFIG.proactive = false;
  console.log = () => {};
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  }) as unknown as typeof fetch;
  try { await fn(requests); } finally {
    globalThis.fetch = realFetch;
    CONFIG.nvidiaApiKey = key;
    CONFIG.proactive = proactive;
    console.log = log;
  }
}

test('a seizure slide reads as a worsening trend with a TREND line', () => {
  const { conn } = seizure();
  const s = readState(conn);
  assert.equal(s.trend?.worsening, true);
  assert.deepEqual([s.trend?.spo2, s.trend?.hr], [{ from: 97, to: 84 }, { from: 96, to: 165 }]);
  assert.match(summarize(s), /^TREND \(last 29 s\) SpO2 97 → 84 · HR 96 → 165 · SpO2 falling fast, HR rising fast · WORSENING$/m);
});

test('a silent review of a worsening trend is followed by one fixed note, once per episode', async () => {
  const { conn, calls } = seizure();
  await withAdvisory(JSON.stringify({ advisory: null, summary: 'Reviewed the worsening vitals trend; an advisory was considered.' }), async requests => {
    const brain = new Brain(conn, speaker, new Policy(conn));
    await tick(brain);
    assert.equal(requests.length, 1);
    assert.match(requests[0].messages[0].content, /a worsening trend in the TREND line/);
    assert.match(requests[0].messages[0].content, /- Reviewed the worsening vitals trend; an advisory was considered\./, 'offered as a dashboard summary');
    const said = callsTo(calls, 'addCallout').map(c => c.args.text);
    assert.deepEqual(said, ['Note: oxygen saturation falling, ninety-seven to eighty-four.']);
    const rows = updates(calls);
    assert.deepEqual(rows.map(r => r.phase), ['progress', 'complete'], "the model's review is the only decision operation");
    assert.equal(rows[1].text, 'Reviewed the worsening vitals trend; an advisory was considered.');
    // The fixed note is fixed code: its rows are `trend` steps and its speech kind is `trend`, so the dashboard
    // never labels it "Nemotron" (decision 24).
    assert.match(trendSteps(calls)[0], /^Worsening vitals trend \(SpO2 falling fast, HR rising fast\); no advisory was queued/);
    assert.match(speakSteps(calls).at(-1)!, /^P2 trend: "Note: oxygen saturation falling/);
    await tick(brain);
    assert.equal(callsTo(calls, 'addCallout').length, 1, 'one note per episode');
    assert.equal(updates(calls).length, 2);
  });
});

test('a heart rate climbing back from under 50 (the ROSC scenario, 38 → 104) is a recovery, not a worsening trend', () => {
  const now = Date.now();
  const vitals = Array.from({ length: 12 }, (_, i) => ({ id: BigInt(i + 1), incidentId: 1n, ts: timestamp(now - 12_000 + i * 1000), device: 'sim-rosc', hr: Math.round(38 + 66 * (i / 11)), spo2: i > 3 ? 93 : undefined, status: 'pulse', simulated: true }));
  const { conn } = fakeConn({ incident: [{ id: 1n, unit: 'Medic 12', status: 'rosc', startedAt: nowTs(), updatedAt: nowTs(), demoMode: true }], vitals });
  const s = readState(conn);
  assert.equal(s.trend?.worsening, false);
  assert.equal(s.trend?.words, 'HR rising');
  assert.doesNotMatch(summarize(s), /WORSENING/);
});

test('a dropped reading does not end the episode, so the same slide never gets a second note', async () => {
  const fake = seizure();
  const { conn, calls } = fake;
  await withAdvisory(JSON.stringify({ advisory: null, summary: 'Reviewed the latest state; continuing to monitor without an additional advisory.' }), async () => {
    const brain = new Brain(conn, speaker, new Policy(conn));
    await tick(brain);
    assert.equal(callsTo(calls, 'addCallout').length, 1);
    // The clip slips: one "no finger" row, then the slide continues.
    fake.db.vitals.insert({ id: 100n, incidentId: 1n, ts: nowTs(), device: 'sim', hr: undefined, spo2: undefined, status: 'no finger', simulated: true });
    await tick(brain);
    fake.db.vitals.insert({ id: 101n, incidentId: 1n, ts: nowTs(), device: 'sim', hr: 168, spo2: 82, status: 'pulse', simulated: true });
    await tick(brain);
    assert.equal(callsTo(calls, 'addCallout').length, 1, 'still one note for the episode');
  });
});

test("the model's advisory during a worsening trend is the episode's note; no fixed note is added", async () => {
  const { conn, calls } = seizure();
  const advisory = 'Note: oxygen saturation falling fast. Consider airway and oxygen.';
  await withAdvisory(JSON.stringify({ advisory, summary: 'Reviewed the worsening vitals trend; an advisory was considered.' }), async () => {
    const brain = new Brain(conn, speaker, new Policy(conn));
    await tick(brain);
    assert.deepEqual(callsTo(calls, 'addCallout').map(c => c.args.text), [advisory]);
    assert.equal(updates(calls).at(-1).text, `Queued advisory: ${advisory}`);
    await tick(brain);
    assert.equal(callsTo(calls, 'addCallout').length, 1);
  });
});

test('with the model off, the trend timer still says the fixed note once', async t => {
  const { conn, calls } = seizure();
  const key = CONFIG.nvidiaApiKey;
  const log = console.log;
  CONFIG.nvidiaApiKey = '';
  console.log = () => {};
  t.mock.timers.enable({ apis: ['setInterval'] });
  const brain = new Brain(conn, speaker, new Policy(conn));
  try {
    brain.start();
    t.mock.timers.tick(5_000);
    for (let i = 0; i < 100 && callsTo(calls, 'addCallout').length === 0; i++) await new Promise(r => setImmediate(r));
    assert.deepEqual(callsTo(calls, 'addCallout').map(c => c.args.text), ['Note: oxygen saturation falling, ninety-seven to eighty-four.']);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    assert.equal(updates(calls).length, 0, 'fixed code writes no Nemotron decision rows');
    assert.equal(trendSteps(calls).length, 1);
    t.mock.timers.tick(5_000);
    t.mock.timers.tick(5_000);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    assert.equal(callsTo(calls, 'addCallout').length, 1);
  } finally {
    brain.stop();
    CONFIG.nvidiaApiKey = key;
    console.log = log;
  }
});
