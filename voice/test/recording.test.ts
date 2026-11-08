import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRecorder, SESSION_VIDEO_LABEL, UNATTACHED_CHUNKS } from '../src/recording.js';
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
const call = (id: bigint, status = 'on_scene') => ({ id, unit: 'Medic 12', status, startedAt: nowTs(), updatedAt: nowTs(), demoMode: false });
const URL = '/recordings/clip-abc12345.webm';

test('a clip is attached to the open call once and keeps going while that call is open', async () => {
  const { conn, calls } = fakeConn({ incident: [call(7n)] });
  const recorder = new SessionRecorder(conn);
  assert.deepEqual(await quiet(() => recorder.chunk('clip-abc12345', URL, 0)), { incident: '7', restart: false, discard: false });
  assert.deepEqual(await quiet(() => recorder.chunk('clip-abc12345', URL, 1)), { incident: '7', restart: false, discard: false });
  const attached = callsTo(calls, 'demoControl');
  assert.equal(attached.length, 1);
  assert.equal(attached[0].args.action, 'attach_recording');
  assert.deepEqual(JSON.parse(attached[0].args.arg), { incidentId: '7', url: URL, label: SESSION_VIDEO_LABEL });
});

test('the phone starts a new clip when the call ends or another one starts, and the old clip is kept', async () => {
  const { conn, rows } = fakeConn({ incident: [call(7n)] });
  const recorder = new SessionRecorder(conn);
  await quiet(() => recorder.chunk('clip-abc12345', URL, 0));
  rows.incident[0] = { ...rows.incident[0], status: 'closed' };
  assert.deepEqual(await recorder.chunk('clip-abc12345', URL, 1), { incident: null, restart: true, discard: false });
});

test('a clip that never finds a call is discarded after a minute, and attaches if a call opens in time', async () => {
  const { conn, rows, calls } = fakeConn();
  const recorder = new SessionRecorder(conn);
  for (let seq = 0; seq < UNATTACHED_CHUNKS - 1; seq++) {
    assert.deepEqual(await recorder.chunk('clip-idle0001', '/recordings/clip-idle0001.webm', seq), { incident: null, restart: false, discard: false });
  }
  assert.deepEqual(await recorder.chunk('clip-idle0001', '/recordings/clip-idle0001.webm', UNATTACHED_CHUNKS - 1), { incident: null, restart: true, discard: true });

  await recorder.chunk('clip-late0001', '/recordings/clip-late0001.webm', 0);
  rows.incident.push(call(9n));
  assert.deepEqual(await quiet(() => recorder.chunk('clip-late0001', '/recordings/clip-late0001.webm', 1)), { incident: '9', restart: false, discard: false });
  assert.equal(callsTo(calls, 'demoControl').length, 1);
});

test('bad clip names, paths and sequence numbers are refused', async () => {
  const recorder = new SessionRecorder(fakeConn().conn);
  await assert.rejects(recorder.chunk('../x', URL, 0));
  await assert.rejects(recorder.chunk('clip-abc12345', '/etc/passwd', 0));
  await assert.rejects(recorder.chunk('clip-abc12345', URL, -1));
});
