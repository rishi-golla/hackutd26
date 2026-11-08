import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../src/brain.js';
import { CONFIG } from '../src/config.js';
import { Policy } from '../src/policy.js';
import type { Speaker } from '../src/speaker.js';
import { advisoryDecision, DecisionLog, publicSummaries, publicSummary } from '../src/decision-log.js';
import { fakeConn, nowTs } from './fakes.js';

const speaker = { recentlySaid: () => [], dropUnspokenReadbacks: async () => {} } as unknown as Speaker;
const setup = () => fakeConn({ incident: [{ id: 1n, status: 'on_scene', startedAt: nowTs(), updatedAt: nowTs(), demoMode: true }] });
const updates = (fake: ReturnType<typeof setup>) => fake.rows.agentStep.filter(s => s.tool === 'decision').map(s => JSON.parse(s.summary));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

async function withFetch(fetcher: typeof fetch, fn: () => Promise<void>) {
  const oldFetch = globalThis.fetch;
  const key = CONFIG.nvidiaApiKey;
  const proactive = CONFIG.proactive;
  globalThis.fetch = fetcher;
  CONFIG.nvidiaApiKey = 'test-key';
  CONFIG.proactive = false;
  try { await fn(); } finally {
    globalThis.fetch = oldFetch;
    CONFIG.nvidiaApiKey = key;
    CONFIG.proactive = proactive;
  }
}
const response = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
// A direct tick avoids waiting ten seconds; we still exercise the production prompt, request and policy paths.
const tick = (brain: Brain): Promise<void> => (brain as unknown as { proactiveTick(): Promise<void> }).proactiveTick();

async function until(predicate: () => boolean) {
  for (let n = 0; n < 100 && !predicate(); n++) await new Promise(r => setTimeout(r, 1));
  assert.ok(predicate(), 'expected asynchronous progress');
}

test('progress reaches the trace before the model completes; silent outcome queues no speech', async () => {
  const fake = setup();
  const gate = deferred<Response>();
  await withFetch((() => gate.promise) as typeof fetch, async () => {
    const brain = new Brain(fake.conn, speaker, new Policy(fake.conn));
    const run = tick(brain);
    await until(() => updates(fake).length === 1);
    assert.equal(updates(fake)[0].phase, 'progress');
    gate.resolve(response(JSON.stringify({ advisory: null, summary: 'No additional advisory needed; continuing to monitor the recorded state.' })));
    await run;
    const rows = updates(fake);
    assert.deepEqual(rows.map(r => r.phase), ['progress', 'complete']);
    assert.equal(rows[0].id, rows[1].id);
    assert.match(rows[1].text, /continuing to monitor/);
    assert.equal(fake.rows.callout.length, 0);
    await tick(brain);
    assert.equal(updates(fake).length, 2, 'unchanged state is not reviewed again');
  });
});

test('overlapping audio decisions get separate IDs and retain their own outcomes', async () => {
  const fake = setup();
  const gates = [deferred<Response>(), deferred<Response>()];
  let requests = 0;
  await withFetch((() => gates[requests++].promise) as typeof fetch, async () => {
    const brain = new Brain(fake.conn, speaker, new Policy(fake.conn));
    const first = brain.handleUtterance('His breathing is shallow', 'test');
    const second = brain.handleUtterance('Did you watch the game yesterday', 'test');
    await until(() => requests === 2);
    assert.equal(new Set(updates(fake).map(r => r.id)).size, 2);
    gates[1].resolve(response('DROP'));
    await second;
    gates[0].resolve(response('SILENT'));
    await first;
    const rows = updates(fake);
    const outcomes = rows.filter(r => r.phase === 'complete');
    assert.match(outcomes[0].text, /Ignored unrelated audio/);
    assert.equal(outcomes[0].id, rows[1].id);
    assert.equal(outcomes[1].id, rows[0].id);
    assert.ok(fake.rows.agentStep.every(r => !r.summary.includes('game yesterday')));
    assert.deepEqual(fake.rows.transcript.map(r => r.text), ['His breathing is shallow']);
  });
});

test('a model failure is an error, never a successful monitoring decision or exception text', async () => {
  const fake = setup();
  await withFetch((async () => { throw new Error('private request details'); }) as typeof fetch, async () => {
    await tick(new Brain(fake.conn, speaker, new Policy(fake.conn)));
    assert.deepEqual(updates(fake).map(r => r.phase), ['progress', 'error']);
    assert.ok(fake.rows.agentStep.every(r => !r.summary.includes('private request details')));
    assert.equal(fake.rows.callout.length, 0);
  });
});

test('a completion after reset never lands in the replacement incident', async () => {
  const fake = setup();
  const gate = deferred<Response>();
  await withFetch((() => gate.promise) as typeof fetch, async () => {
    const brain = new Brain(fake.conn, speaker, new Policy(fake.conn));
    const run = tick(brain);
    await until(() => updates(fake).length === 1);
    fake.db.incident.delete(fake.rows.incident[0]);
    fake.db.incident.insert({ id: 2n, status: 'on_scene', startedAt: nowTs(), updatedAt: nowTs() });
    gate.resolve(response('{"advisory":null,"summary":"Continuing to monitor."}'));
    await run;
    assert.equal(updates(fake).length, 1);
    assert.ok(fake.rows.agentStep.every(r => r.incidentId === 1n));
  });
});

test('tool request progress appears before an EHR response, and a rejected tool ends as an error', async () => {
  const fake = setup();
  let requests = 0;
  await withFetch((async () => {
    requests++;
    if (requests === 1) return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [
      { id: 'search', type: 'function', function: { name: 'search_ehr', arguments: '{}' } },
    ] } }] }));
    return response('SILENT');
  }) as typeof fetch, async () => {
    await new Brain(fake.conn, speaker, new Policy(fake.conn)).handleUtterance('Handoff, can you find the patient record?', 'test');
    const rows = updates(fake);
    assert.match(rows[1].text, /Requesting matching patient records/);
    assert.equal(rows.at(-1).phase, 'error');
    assert.doesNotMatch(rows.at(-1).text, /record pulled|saved|\bsuccess\b/i);
  });
});

test('tool progress remains live until the reducer finishes, then reports its actual outcome', async () => {
  const fake = setup();
  const gate = deferred<void>();
  const original = fake.conn.reducers.logEvent;
  (fake.conn.reducers as any).logEvent = async (args: any) => { await gate.promise; await original(args); };
  let requests = 0;
  await withFetch((async () => {
    requests++;
    if (requests === 1) return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [
      { id: 'log', type: 'function', function: { name: 'log_event', arguments: JSON.stringify({ kind: 'finding', label: 'Shallow breathing' }) } },
    ] } }] }));
    return response('SILENT');
  }) as typeof fetch, async () => {
    const run = new Brain(fake.conn, speaker, new Policy(fake.conn)).handleUtterance('Shallow breathing', 'test');
    await until(() => updates(fake).some(r => /Recording the clinical update/.test(r.text)));
    assert.equal(updates(fake).at(-1).phase, 'progress');
    assert.equal(fake.rows.event.length, 0, 'the reducer has not resolved yet');
    gate.resolve();
    await run;
    assert.equal(fake.calls.filter(c => c.reducer === 'logEvent').length, 1);
    const end = updates(fake).at(-1);
    assert.equal(end.phase, 'complete');
    assert.match(end.text, /Recorded the clinical update/);
  });
});

test('overlapping proactive ticks are deduplicated while the first review is in flight', async () => {
  const fake = setup();
  const gate = deferred<Response>();
  let requests = 0;
  await withFetch((() => { requests++; return gate.promise; }) as typeof fetch, async () => {
    const brain = new Brain(fake.conn, speaker, new Policy(fake.conn));
    const first = tick(brain);
    await until(() => requests === 1);
    await tick(brain);
    assert.equal(requests, 1);
    gate.resolve(response('{"advisory":null,"summary":"Reviewed the latest state; continuing to monitor."}'));
    await first;
    assert.deepEqual(updates(fake).map(r => r.phase), ['progress', 'complete']);
    assert.equal(fake.rows.callout.length, 0);
  });
});

test('an advisory blocked by policy is not logged as queued or delivered', async () => {
  const fake = setup();
  await withFetch((async () => response('{"advisory":"Consider heart rate 999.","summary":"Preparing an advisory."}')) as typeof fetch, async () => {
    await tick(new Brain(fake.conn, speaker, new Policy(fake.conn)));
    assert.equal(updates(fake).at(-1).phase, 'error');
    assert.match(updates(fake).at(-1).text, /did not queue/);
    assert.equal(fake.rows.callout.length, 0);
  });
});

test('malformed advisory JSON fails closed; unsupported summary numbers fall back', () => {
  assert.throws(() => advisoryDecision('{"summary":"Continue monitoring"}', ''));
  assert.throws(() => advisoryDecision('{bad json', ''));
  assert.equal(advisoryDecision('SILENT', '').advisory, null);
  assert.equal(publicSummary('Heart rate 999 is improving.', 'Heart rate 80', 'fallback'), 'fallback');
  assert.equal(publicSummary('The patient is stable.', '', 'fallback'), 'fallback');
  assert.equal(publicSummary('No treatment is needed.', '', 'fallback'), 'fallback');
  assert.equal(publicSummary('Possible myocardial infarction.', '', 'fallback'), 'fallback');
  assert.equal(publicSummary('No intervention is required.', '', 'fallback'), 'fallback');
  assert.equal(publicSummary('<think>hidden</think>', '', 'fallback'), 'fallback');
  assert.equal(publicSummaries('VITALS no valid reading\nPATIENT not identified yet (no record)').includes('No patient record is available yet; monitoring the documented incident.'), true);
  for (const invalid of ['', '[]', 'null', '"a primitive string"']) {
    assert.throws(() => advisoryDecision(invalid, ''));
  }
});

test('empty audio and proactive responses end as errors, never monitoring successes', async () => {
  const audio = setup();
  await withFetch((async () => response('')) as typeof fetch, async () => {
    await new Brain(audio.conn, speaker, new Policy(audio.conn)).handleUtterance('Handoff, review the case', 'test');
    assert.equal(updates(audio).at(-1).phase, 'error');
  });

  const proactive = setup();
  await withFetch((async () => response('')) as typeof fetch, async () => {
    await tick(new Brain(proactive.conn, speaker, new Policy(proactive.conn)));
    assert.equal(updates(proactive).at(-1).phase, 'error');
  });
});

test('plain-text get_state tool results do not throw during result inspection', async () => {
  const fake = setup();
  let requests = 0;
  await withFetch((async () => {
    requests++;
    if (requests === 1) return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [
      { id: 'state', type: 'function', function: { name: 'get_state', arguments: '{}' } },
    ] } }] }));
    return response('SILENT');
  }) as typeof fetch, async () => {
    await new Brain(fake.conn, speaker, new Policy(fake.conn)).handleUtterance('Handoff, review the current case', 'test');
    assert.equal(updates(fake).at(-1).phase, 'complete');
    assert.doesNotMatch(updates(fake).at(-1).text, /Could not finish/);
  });
});

test('JSON summaries stay parseable within the reducer client limit, including quotes and escapes', async () => {
  const fake = setup();
  const log = new DecisionLog(fake.conn, () => true);
  await log.write('progress', '\\"'.repeat(180));
  const summary = fake.rows.agentStep[0].summary;
  assert.ok(summary.length <= 300);
  assert.equal(JSON.parse(summary).phase, 'progress');
  fake.db.incident.delete(fake.rows.incident[0]);
  await log.write('complete', 'Do not write after close');
  assert.equal(fake.rows.agentStep.length, 1);
});

test('a worsening TREND line offers the trend summary; a non-worsening movement does not', () => {
  const trend = 'Reviewed the worsening vitals trend; an advisory was considered.';
  assert.ok(publicSummaries('VITALS (simulated, 1 s ago) HR 165\nTREND (last 29 s) SpO2 97 → 84 · HR 96 → 165 · SpO2 falling fast, HR rising fast · WORSENING').includes(trend));
  assert.ok(!publicSummaries('TREND (last 20 s) SpO2 90 → 95 · SpO2 rising').includes(trend), 'a rising SpO2 is never called worsening');
  assert.ok(!publicSummaries('VITALS (simulated, 1 s ago) HR 80').includes(trend));
});

test('a dashboard sentence in the advisory field is a keep-monitoring decision, never speech (seen live Sun ~04:45)', async () => {
  const fake = setup();
  const corpus = 'INCIDENT Medic 12 · status ON_SCENE\nPATIENT not identified yet (no record)';
  const copied = advisoryDecision(JSON.stringify({ advisory: 'Reviewed the latest state; continuing to monitor without an additional advisory.', summary: 'Reviewed the latest state; continuing to monitor without an additional advisory.' }), corpus);
  assert.equal(copied.advisory, null);
  assert.match(copied.summary, /continuing to monitor/);
  const status = advisoryDecision(JSON.stringify({ advisory: 'Monitoring the patient; no additional advisory needed.', summary: 'whatever' }), corpus);
  assert.equal(status.advisory, null);
  const plain = advisoryDecision('Reviewed the latest update; continuing to monitor.', corpus);
  assert.equal(plain.advisory, null, 'legacy plain text in status wording is not spoken either');
  const real = advisoryDecision(JSON.stringify({ advisory: 'Consider checking the record for allergies before the next drug.', summary: 'x' }), corpus);
  assert.equal(real.advisory, 'Consider checking the record for allergies before the next drug.');
  // End to end: the brain queues nothing for the copied summary.
  await withFetch((async () => response(JSON.stringify({ advisory: 'Reviewed the latest state; continuing to monitor without an additional advisory.', summary: 'Reviewed the latest state; continuing to monitor without an additional advisory.' }))) as typeof fetch, async () => {
    const brain = new Brain(fake.conn, speaker, new Policy(fake.conn));
    await tick(brain);
    assert.equal(fake.rows.callout.length, 0, 'nothing queued for the speaker');
    assert.deepEqual(updates(fake).map(r => r.phase), ['progress', 'complete']);
  });
});

test('an advisory that names something the state does not hold is not spoken (facts only, §19)', async () => {
  const corpus = 'INCIDENT Medic 12 · status ON_SCENE · DEMO TIMING on\nPATIENT not identified yet (no record)\nVITALS no data (relay offline)';
  const { ungroundedTerm } = await import('../src/decision-log.js');
  assert.equal(ungroundedTerm('Consider checking pulse post-shock', corpus), 'post-shock');
  assert.equal(ungroundedTerm('Note: Epinephrine administered; seizure activity observed.', corpus), 'seizure');
  assert.equal(ungroundedTerm('Consider confirming the airway and oxygen.', corpus), undefined);
  assert.equal(ungroundedTerm('Consider the amiodarone allergy before the next dose.', corpus + '\nPATIENT Jordan Avery, 58 (EHR) · allergies: amiodarone'), undefined);
  const fake = setup();
  await withFetch((async () => response(JSON.stringify({ advisory: 'Consider checking pulse post-shock', summary: 'x' }))) as typeof fetch, async () => {
    const brain = new Brain(fake.conn, speaker, new Policy(fake.conn));
    await tick(brain);
    assert.equal(fake.rows.callout.length, 0);
    assert.match(updates(fake).at(-1).text, /not in the state and was not spoken/);
    assert.ok(fake.rows.agentStep.some(s => s.tool === 'policy' && /post-shock/.test(s.summary)));
  });
});

test('the same unprompted note is not said twice within two minutes', async () => {
  const fake = setup();
  let n = 0;
  await withFetch((async () => response(JSON.stringify({ advisory: 'Consider confirming the airway and oxygen.', summary: 'x' }))) as typeof fetch, async () => {
    const brain = new Brain(fake.conn, speaker, new Policy(fake.conn));
    await tick(brain);
    assert.equal(fake.rows.callout.length, 1);
    // Said, then the state changes again and the model repeats itself.
    fake.db.callout.update({ ...fake.rows.callout[0], spokenAt: nowTs() });
    fake.db.incident.update({ ...fake.rows.incident[0], status: 'en_route', updatedAt: nowTs() });
    await new Promise(r => setTimeout(r, 20));
    n = fake.rows.agentStep.length;
    await tick(brain);
    assert.equal(fake.rows.callout.length, 1, 'the repeat is dropped');
    assert.ok(fake.rows.agentStep.slice(n).some(s => /same words were said|repeated a callout just spoken/.test(s.summary)), 'dropped as a repeat (by the restatement check or the policy)');
  });
});

test('an advisory that restates a callout spoken in the last 30 s is not said again', async () => {
  const { restatesRecentSpeech } = await import('../src/brain.js');
  const { readState } = await import('../src/state.js');
  const fake = setup();
  fake.db.patientRecord.insert({ incidentId: 1n, patientRef: 'pt-0001', name: 'Jordan Avery', birthDate: '1968-03-14', allergies: ['amiodarone'], medications: ['warfarin'], conditions: [], codeStatus: 'full code', source: 'EHR', updatedAt: nowTs() });
  fake.db.callout.insert({ id: 1n, incidentId: 1n, text: 'Amiodarone, three hundred milligrams. Warning: the record lists an amiodarone allergy. Log it anyway?', priority: 0, createdAt: nowTs(), spokenAt: nowTs() });
  const s = readState(fake.conn);
  assert.ok(restatesRecentSpeech('Note: amiodarone allergy confirmed. Warfarin present.', s));
  assert.equal(restatesRecentSpeech('Consider checking the airway and oxygen.', s), undefined);
  await withFetch((async () => response(JSON.stringify({ advisory: 'Note: amiodarone allergy confirmed. Warfarin present.', summary: 'x' }))) as typeof fetch, async () => {
    const brain = new Brain(fake.conn, speaker, new Policy(fake.conn));
    await tick(brain);
    assert.equal(fake.rows.callout.length, 1, 'nothing new queued');
    assert.match(updates(fake).at(-1).text, /repeated a callout just spoken/);
  });
});
