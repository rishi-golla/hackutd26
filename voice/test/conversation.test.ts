import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../src/brain.js';
import { CONFIG } from '../src/config.js';
import { Policy } from '../src/policy.js';
import type { Speaker } from '../src/speaker.js';
import { callsTo, fakeConn, nowTs } from './fakes.js';

const stubSpeaker = { recentlySaid: () => [], dropUnspokenReadbacks: async () => {} } as unknown as Speaker;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

type Reply = { content?: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] };
const toolCall = (name: string, args: Record<string, unknown>) => ({ id: `call-${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });

/** Nemotron stand-in: answers from a queue and records every request body. */
async function withModel(replies: Reply[], fn: (requests: any[]) => Promise<void>) {
  const realFetch = globalThis.fetch;
  const realKey = CONFIG.nvidiaApiKey;
  const realProactive = CONFIG.proactive;
  const log = console.log;
  const requests: any[] = [];
  CONFIG.nvidiaApiKey = 'test-key';
  CONFIG.proactive = false;
  console.log = () => {};
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    requests.push(JSON.parse(init.body));
    const message = replies.shift() ?? { content: 'SILENT' };
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  }) as unknown as typeof fetch;
  try {
    await fn(requests);
  } finally {
    globalThis.fetch = realFetch;
    CONFIG.nvidiaApiKey = realKey;
    CONFIG.proactive = realProactive;
    console.log = log;
  }
}

async function settle(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await wait(10);
  await wait(20);
}

/** An incident in arrest whose logEvent writes the row back, like the module does. */
const arrest = () => {
  const fake = fakeConn({ incident: [{ id: 1n, unit: 'Medic 12', status: 'arrest', demoMode: true, startedAt: nowTs(), updatedAt: nowTs() }] });
  const record = fake.conn.reducers.logEvent;
  (fake.conn.reducers as any).logEvent = async (args: any) => {
    await record(args);
    const id = fake.rows.event.reduce((max, r) => r.id > max ? r.id : max, 0n) + 1n;
    fake.db.event.insert({ id, incidentId: 1n, ts: nowTs(), kind: args.kind, label: args.label, status: 'logged', sources: [{ kind: args.sourceKind, detail: args.sourceDetail }] });
  };
  return fake;
};
const statusOf = (rows: Record<string, any[]>, label: string) => rows.event.find(e => e.label === label)?.status;

test('filler never reaches the model; any other line does, even without clinical keywords', async () => {
  const { conn, calls } = arrest();
  await withModel([{ tool_calls: [toolCall('log_event', { kind: 'finding', label: 'Skin pale and sweaty' })] }, { content: 'SILENT' }], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Yeah, okay.', 'pipecat');
    await settle(() => false);
    assert.equal(requests.length, 0, 'filler is skipped');
    await brain.handleUtterance("He's really pale and sweating a lot", 'pipecat');
    await settle(() => requests.length >= 2);
    assert.equal(requests.length, 2);
    assert.deepEqual(callsTo(calls, 'logEvent').map(c => c.args.label), ['Skin pale and sweaty']);
    assert.equal(callsTo(calls, 'addCallout').length, 0, 'documented silently: the line was not meant for Handoff');
  });
});

test('the next turn sees the previous exchange as conversation memory', async () => {
  const { conn, calls } = arrest();
  await withModel([{ content: 'I read back doses, check allergies, pull the record and log what you tell me.' }, { content: 'SILENT' }], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Handoff, what can you do?', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').length > 0);
    assert.match(callsTo(calls, 'addCallout')[0].args.text, /read back doses/);
    await brain.handleUtterance('Cool, and the allergies part, how does that work?', 'pipecat');
    await settle(() => requests.length >= 2);
    const messages = requests[1].messages as { role: string; content: string }[];
    assert.deepEqual(messages.map(m => m.role), ['system', 'user'], 'memory is plain text, not past assistant turns');
    assert.match(messages[1].content, /RECENT CONVERSATION[\s\S]*what can you do\?" → you: said "I read back doses/);
    assert.match(messages[1].content, /NEW LINE: "Cool, and the allergies part/);
  });
});

test('an action note the model writes as text is not spoken', async () => {
  const { conn, calls } = arrest();
  await withModel([{ content: 'Logged finding: Breathing shallow' }], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('His breathing is pretty shallow', 'pipecat');
    await settle(() => requests.length >= 1);
    assert.equal(callsTo(calls, 'addCallout').length, 0);
  });
});

test('a spoken medication is read back with "Log it?", stays logged (not flagged) until answered, and "yes" confirms it', async () => {
  const { conn, calls, rows } = arrest();
  await withModel([], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Administering one milligram of epinephrine IO', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').length > 0 && statusOf(rows, 'Epinephrine 1 mg IO') !== undefined);
    assert.equal(callsTo(calls, 'addCallout')[0].args.text, 'Copy. Epinephrine, one milligram, I-O. Log it?');
    await settle(() => false);
    assert.equal(statusOf(rows, 'Epinephrine 1 mg IO'), 'logged', 'unanswered routine dose is not shown as a problem');
    assert.equal(callsTo(calls, 'setEventStatus').length, 0);
    await brain.handleUtterance('Yes, log it.', 'pipecat');
    await settle(() => statusOf(rows, 'Epinephrine 1 mg IO') === 'confirmed');
    assert.equal(statusOf(rows, 'Epinephrine 1 mg IO'), 'confirmed');
    assert.equal(callsTo(calls, 'addCallout').at(-1)!.args.text, 'Logged.');
    assert.equal(requests.length, 0, 'read-back and the answer need no model call');
  });
});

test('"no" cancels; an out-of-range dose asks "Log it anyway?"', async () => {
  const { conn, calls, rows } = arrest();
  await withModel([], async () => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Giving two milligrams of epinephrine IV', 'pipecat');
    await settle(() => statusOf(rows, 'Epinephrine 2 mg IV') === 'flagged');
    assert.match(callsTo(calls, 'addCallout')[0].args.text, /Outside the protocol range\. Log it anyway\?$/);
    await brain.handleUtterance("No, don't log it.", 'pipecat');
    await settle(() => statusOf(rows, 'Epinephrine 2 mg IV') === 'cancelled');
    assert.equal(statusOf(rows, 'Epinephrine 2 mg IV'), 'cancelled');
  });
});

test('a procedure Nemotron logs is read back and asked about; questions and duplicates are refused', async () => {
  const { conn, calls, rows } = arrest();
  const ioCall = toolCall('log_event', { kind: 'procedure', label: 'IO access right tibia' });
  await withModel([
    { tool_calls: [ioCall] }, { content: 'SILENT' },
    { tool_calls: [toolCall('log_event', { kind: 'finding', label: 'Asked about capabilities' })] }, { content: 'SILENT' },
    { tool_calls: [ioCall] }, { content: 'SILENT' },
  ], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance("I've got IO access in the right tibia", 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').length > 0);
    assert.equal(callsTo(calls, 'addCallout')[0].args.text, 'Copy. IO access right tibia. Log it?');
    assert.equal(statusOf(rows, 'IO access right tibia'), 'logged');
    await brain.handleUtterance('Yep', 'pipecat');
    await settle(() => statusOf(rows, 'IO access right tibia') === 'confirmed');
    assert.equal(statusOf(rows, 'IO access right tibia'), 'confirmed');
    await brain.handleUtterance('Handoff, what else can you track for me?', 'pipecat');
    await settle(() => requests.length >= 4);
    await brain.handleUtterance('The IO in the right tibia is flushing fine', 'pipecat');
    await settle(() => requests.length >= 6);
    assert.deepEqual(callsTo(calls, 'logEvent').map(c => c.args.label), ['IO access right tibia'], 'the question and the repeat were not logged');
  });
});

test('our own "Log it?" heard back through the mic does not confirm the event', async () => {
  const { conn, rows } = arrest();
  const saying = { recentlySaid: () => ['Copy. Epinephrine, one milligram, I-V. Log it?'], dropUnspokenReadbacks: async () => {} } as unknown as Speaker;
  await withModel([], async () => {
    const brain = new Brain(conn, saying, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Giving one milligram of epinephrine IV', 'pipecat');
    await settle(() => statusOf(rows, 'Epinephrine 1 mg IV') !== undefined);
    await brain.handleUtterance('Log it?', 'pipecat');
    await settle(() => false);
    assert.equal(statusOf(rows, 'Epinephrine 1 mg IV'), 'logged', 'not confirmed by our own words');
  });
});

test('a medication heard in pieces is completed from later lines, through a misheard line in between', async () => {
  const { conn, calls, rows } = arrest();
  await withModel([{ content: 'SILENT' }], async () => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Administering one milligram of blah blah', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').length > 0);
    assert.equal(callsTo(calls, 'addCallout')[0].args.text, 'Which drug?');
    await brain.handleUtterance('Hold on a second there', 'pipecat');
    await settle(() => false);
    await brain.handleUtterance('Epinephrine', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').some(c => c.args.text === 'Copy. Epinephrine, one milligram. Log it?'));
    assert.equal(callsTo(calls, 'addCallout').at(-1)!.args.text, 'Copy. Epinephrine, one milligram. Log it?');
  });
});

test('"One milligram of" then "epinephrine IV", and a lone drug then its dose, each make one read-back', async () => {
  const { conn, calls, rows } = arrest();
  await withModel([], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('One milligram of', 'pipecat');
    await brain.handleUtterance('epinephrine IV', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').some(c => c.args.text === 'Copy. Epinephrine, one milligram, I-V. Log it?'));
    await brain.handleUtterance('Yes', 'pipecat');
    await settle(() => statusOf(rows, 'Epinephrine 1 mg IV') === 'confirmed');
    await brain.handleUtterance('Amiodarone', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').some(c => c.args.text === 'Amiodarone. What dose?'));
    await brain.handleUtterance('Three hundred milligrams', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').some(c => c.args.text === 'Copy. Amiodarone, three hundred milligrams. Log it?'));
    assert.equal(statusOf(rows, 'Amiodarone 300 mg'), 'logged');
    assert.equal(requests.length, 0, 'no model call anywhere in the medication flow');
  });
});

test('a plainly stated status change is set at once with no model call', async () => {
  const { conn, calls } = fakeConn({ incident: [{ id: 1n, unit: 'Medic 12', status: 'on_scene', demoMode: true, startedAt: nowTs(), updatedAt: nowTs() }] });
  await withModel([], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Cardiac arrest', 'pipecat');
    await settle(() => callsTo(calls, 'setStatus').length > 0);
    assert.deepEqual(callsTo(calls, 'setStatus').map(c => c.args.status), ['arrest']);
    assert.equal(callsTo(calls, 'addCallout')[0].args.text, 'Copy, cardiac arrest.');
    await brain.handleUtterance('Did he have a cardiac arrest before?', 'pipecat');
    await settle(() => false);
    assert.equal(callsTo(calls, 'setStatus').length, 1, 'a question never changes the status');
    assert.ok(requests.length <= 1);
  });
});

test('"starting compressions" starts CPR through cpr_started, never as an arrest status', async () => {
  const { conn, calls } = fakeConn({ incident: [{ id: 1n, unit: 'Medic 12', status: 'on_scene', demoMode: true, startedAt: nowTs(), updatedAt: nowTs() }] });
  await withModel([], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Starting compressions now', 'pipecat');
    await settle(() => callsTo(calls, 'logEvent').length > 0);
    assert.deepEqual(callsTo(calls, 'logEvent').map(c => [c.args.kind, c.args.label]), [['cpr_started', 'CPR started']]);
    assert.equal(callsTo(calls, 'setStatus').length, 0, 'the module sets the arrest itself');
    assert.equal(callsTo(calls, 'addCallout')[0].args.text, 'Copy, CPR started.');
    assert.equal(requests.length, 0);
  });
});

test('a question still gets an answer when the model spends its tool rounds', async () => {
  const { conn, calls } = arrest();
  const look = { tool_calls: [toolCall('get_timeline', {})] };
  await withModel([look, look, look, { content: 'Nothing given yet.' }], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Handoff, what have we given so far?', 'pipecat');
    await settle(() => requests.length >= 4 && callsTo(calls, 'addCallout').length > 0);
    assert.equal(requests[0].tools.some((t: any) => t.function.name === 'get_state'), false, 'get_state is not offered');
    assert.equal(callsTo(calls, 'addCallout')[0].args.text, 'Nothing given yet.');
  });
});

test('a bare "yes" with no pending question goes to Nemotron', async () => {
  const { conn } = arrest();
  await withModel([{ content: 'SILENT' }], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Yes, he takes it every day', 'pipecat');
    await settle(() => requests.length >= 1);
    assert.equal(requests.length, 1);
  });
});

test('one spoken answer per line: text after a speak call is not said again', async () => {
  const { conn, calls } = arrest();
  await withModel([{ tool_calls: [toolCall('speak', { text: 'Not documented yet.' })] }, { content: 'Done, I told the medic.' }], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Handoff, when did the arrest start?', 'pipecat');
    await settle(() => requests.length >= 2);
    assert.deepEqual(callsTo(calls, 'addCallout').map(c => c.args.text), ['Not documented yet.']);
  });
});

test('fix 2: words that only look like a status change never set one without the model', async () => {
  const { conn, calls } = fakeConn({ incident: [{ id: 1n, unit: 'Medic 12', status: 'on_scene', demoMode: true, startedAt: nowTs(), updatedAt: nowTs() }] });
  await withModel([], async () => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    for (const line of ['No pulse ox reading yet', 'Loading the epi now', 'Rolling him onto the board', 'Get the pads on in case he goes into cardiac arrest', 'Pulse check for ROSC in two minutes']) {
      await brain.handleUtterance(line, 'pipecat');
    }
    await settle(() => false);
    assert.equal(callsTo(calls, 'setStatus').length, 0);
    await brain.handleUtterance('We have a pulse', 'pipecat');
    await settle(() => callsTo(calls, 'setStatus').length > 0);
    assert.deepEqual(callsTo(calls, 'setStatus').map(c => c.args.status), ['rosc']);
  });
});

test('keep or drop: a line Nemotron drops is stored nowhere; a kept line is stored once, after the decision', async () => {
  const { conn, calls } = arrest();
  await withModel([
    { content: 'DROP' },
    { tool_calls: [toolCall('log_event', { kind: 'finding', label: 'Skin pale and sweaty' })] }, { content: 'SILENT' },
  ], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Did you see the game last night', 'pipecat');
    await settle(() => requests.length >= 1);
    assert.equal(callsTo(calls, 'addTranscript').length, 0, 'a dropped line is not in the transcript');
    assert.equal(callsTo(calls, 'logAgentStep').length, 0, 'nor in the agent trace');
    assert.equal(callsTo(calls, 'logEvent').length, 0);
    await brain.handleUtterance('His skin is pale and sweaty', 'pipecat');
    await settle(() => callsTo(calls, 'addTranscript').length > 0);
    assert.deepEqual(callsTo(calls, 'addTranscript').map(c => c.args.text), ['His skin is pale and sweaty']);
    assert.deepEqual(callsTo(calls, 'logEvent').map(c => c.args.label), ['Skin pale and sweaty']);
    // The model judged the second line with the voice log, the dropped line marked as such.
    assert.match(requests[1].messages.at(-1).content, /VOICE LOG[\s\S]*\[dropped\] "Did you see the game last night"/);
  });
});

test('keep or drop: filler and our own words are dropped without a model call; a read-back is always stored', async () => {
  const { conn, calls } = arrest();
  const saying = { recentlySaid: () => ['Two minutes. Rhythm check, switch compressors.'], dropUnspokenReadbacks: async () => {} } as unknown as Speaker;
  await withModel([], async requests => {
    const brain = new Brain(conn, saying, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Okay, so', 'pipecat');
    await brain.handleUtterance('Two minutes. Rhythm check, switch compressors.', 'pipecat');
    await settle(() => false);
    assert.equal(requests.length, 0);
    assert.equal(callsTo(calls, 'addTranscript').length, 0);
    await brain.handleUtterance('Administering one milligram of epinephrine IO', 'pipecat');
    await settle(() => callsTo(calls, 'addTranscript').length > 0);
    assert.deepEqual(callsTo(calls, 'addTranscript').map(c => c.args.text), ['Administering one milligram of epinephrine IO']);
    assert.equal(requests.length, 0, 'the read-back needs no model call');
  });
});

test('status shortcut: "we\'ve got a pulse" counts; negations and a limb pulse do not', async () => {
  const { conn, calls } = fakeConn({ incident: [{ id: 1n, unit: 'Medic 12', status: 'arrest', demoMode: true, startedAt: nowTs(), updatedAt: nowTs() }] });
  await withModel([], async () => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    for (const line of ["He's not in cardiac arrest anymore", 'No pulse in the left foot', "We're not transporting now"]) {
      await brain.handleUtterance(line, 'pipecat');
    }
    await settle(() => false);
    assert.equal(callsTo(calls, 'setStatus').length, 0);
    await brain.handleUtterance("We've got a pulse", 'pipecat');
    await settle(() => callsTo(calls, 'setStatus').length > 0);
    assert.deepEqual(callsTo(calls, 'setStatus').map(c => c.args.status), ['rosc']);
  });
});

test('"no" while a medication is half-heard drops the half, never the read-back before it', async () => {
  const { conn, calls, rows } = arrest();
  await withModel([], async () => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Administering one milligram of epinephrine IO', 'pipecat');
    await settle(() => statusOf(rows, 'Epinephrine 1 mg IO') !== undefined);
    await brain.handleUtterance('Amiodarone', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').some(c => c.args.text === 'Amiodarone. What dose?'));
    await brain.handleUtterance('No', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').at(-1)!.args.text === 'Cancelled.');
    assert.equal(statusOf(rows, 'Epinephrine 1 mg IO'), 'logged', 'the epi read-back is untouched');
    assert.equal(callsTo(calls, 'setEventStatus').length, 0);
  });
});

test('keep or drop: DROP after a tool ran keeps the line and is never spoken; "Drop in heart rate…" is an answer', async () => {
  const { conn, calls } = arrest();
  await withModel([
    { tool_calls: [toolCall('get_timeline', {})] }, { content: 'DROP' },
    { content: 'Drop in heart rate since ROSC.' },
  ], async requests => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('What did we do so far for him', 'pipecat');
    await settle(() => callsTo(calls, 'addTranscript').length > 0);
    assert.deepEqual(callsTo(calls, 'addTranscript').map(c => c.args.text), ['What did we do so far for him'], 'a tool ran: kept');
    assert.ok(!callsTo(calls, 'addCallout').some(c => /drop/i.test(c.args.text)), '"DROP" is never said');
    await brain.handleUtterance('Handoff, anything changed in his heart rate?', 'pipecat');
    await settle(() => requests.length >= 3 && callsTo(calls, 'addTranscript').length > 1);
    assert.equal(callsTo(calls, 'addTranscript').length, 2, 'a reply that starts with "Drop" is not a DROP');
  });
});

test('keep or drop: a line nobody could judge is stored; a lone fragment is dropped, the statement after it stored', async () => {
  const { conn, calls } = arrest();
  await withModel([], async () => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    CONFIG.nvidiaApiKey = '';
    await brain.handleUtterance('His skin is pale and sweaty', 'pipecat');
    CONFIG.nvidiaApiKey = 'test-key';
    await brain.handleUtterance('Administering', 'pipecat');
    await brain.handleUtterance('one milligram of epinephrine IO', 'pipecat');
    await settle(() => callsTo(calls, 'addTranscript').length >= 2);
    // "One milligram of epinephrine IO" is a whole statement on its own, so it is the line stored.
    assert.deepEqual(callsTo(calls, 'addTranscript').map(c => c.args.text), ['His skin is pale and sweaty', 'one milligram of epinephrine IO']);
  });
});

test('keep or drop: a kept line is never stored under the next incident', async () => {
  const fake = arrest();
  const { conn, calls } = fake;
  await withModel([{ tool_calls: [toolCall('log_event', { kind: 'finding', label: 'Skin pale' })] }, { content: 'SILENT' }], async () => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    const modelFetch = globalThis.fetch;
    let reset = false;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const res = await modelFetch(...args);
      if (!reset) {
        reset = true; // a new incident starts while the model is thinking
        fake.db.incident.insert({ id: 2n, unit: 'Medic 12', status: 'on_scene', demoMode: true, startedAt: nowTs(), updatedAt: nowTs() });
      }
      return res;
    }) as typeof fetch;
    await brain.handleUtterance('His skin is pale', 'pipecat');
    await settle(() => false);
    assert.equal(callsTo(calls, 'addTranscript').length, 0);
  });
});

test('"no" drops a half-heard medication even with no earlier read-back', async () => {
  const { conn, calls } = arrest();
  await withModel([], async () => {
    const brain = new Brain(conn, stubSpeaker, new Policy(conn));
    brain.start();
    await brain.handleUtterance('Amiodarone', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').some(c => c.args.text === 'Amiodarone. What dose?'));
    await brain.handleUtterance('No', 'pipecat');
    await settle(() => callsTo(calls, 'addCallout').at(-1)!.args.text === 'Cancelled.');
    await brain.handleUtterance('Three hundred milligrams', 'pipecat');
    await settle(() => false);
    assert.equal(callsTo(calls, 'logEvent').length, 0, 'the dropped half is not completed later');
  });
});
