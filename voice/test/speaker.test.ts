import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Speaker } from '../src/speaker.js';
import type { Callout } from '../src/module_bindings/types.js';
import { callsTo, fakeConn, nowTs, timestamp } from './fakes.js';

class FakeSocket {
  sent: string[] = [];
  closed = false;
  listeners = new Map<string, ((data?: unknown) => void)[]>();
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.emit('close'); }
  on(event: string, listener: (data?: unknown) => void) {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
    return this;
  }
  emit(event: string, data?: unknown) { for (const listener of this.listeners.get(event) ?? []) listener(data); }
  message(data: unknown) { this.emit('message', JSON.stringify(data)); }
  last() { return JSON.parse(this.sent.at(-1)!) as { type: string; id: string; text: string; priority: number }; }
}

const callout = (id: bigint, text: string, priority: number, createdAt: number): Callout => ({
  id, incidentId: 1n, text, priority, createdAt: timestamp(createdAt), spokenAt: undefined,
});
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('speaker orders by priority, sends one at a time, and advances after spoken acknowledgement', async () => {
  const now = Date.now();
  const { conn, rows, calls } = fakeConn({ callout: [
    callout(1n, 'older P2', 2, now - 3000),
    callout(2n, 'P1', 1, now - 2000),
    callout(3n, 'P0', 0, now - 1000),
  ] });
  const speaker = new Speaker(conn);
  const ws = new FakeSocket();
  speaker.attach(ws as any);
  assert.equal(ws.last().text, 'P0');
  speaker.tick();
  assert.equal(ws.sent.length, 1);
  ws.message({ type: 'spoken', id: '3' });
  await flush();
  assert.equal(ws.last().text, 'P1');
  const spokenP0 = rows.callout.find(c => c.id === 3n);
  assert.ok(spokenP0?.spokenAt instanceof Object);
  ws.message({ type: 'spoken', id: '2' });
  await flush();
  assert.equal(ws.last().text, 'older P2');
  assert.deepEqual(callsTo(calls, 'calloutSpoken').map(c => c.args.calloutId), [3n, 2n]);
  speaker.close();
});

test('user_speaking holds queued speech until the medic stops', async () => {
  const { conn, rows } = fakeConn();
  const speaker = new Speaker(conn);
  const ws = new FakeSocket();
  speaker.attach(ws as any);
  ws.message({ type: 'user_speaking', active: true });
  await conn.reducers.addCallout({ text: 'queued while medic speaks', priority: 1 });
  assert.equal(ws.sent.length, 0);
  ws.message({ type: 'user_speaking', active: false });
  assert.equal(ws.last().text, 'queued while medic speaks');
  assert.equal(rows.callout[0].spokenAt, undefined);
  speaker.close();
});

test('detaching mouth leaves the in-flight callout unspoken for degraded-mode playback', async () => {
  const { conn, rows, calls } = fakeConn();
  const speaker = new Speaker(conn);
  const ws = new FakeSocket();
  speaker.attach(ws as any);
  await conn.reducers.addCallout({ text: 'leave me queued', priority: 0 });
  assert.equal(ws.last().text, 'leave me queued');
  ws.close();
  await flush();
  assert.equal(speaker.connected, false);
  assert.equal(rows.callout[0].spokenAt, undefined);
  assert.equal(callsTo(calls, 'calloutSpoken').length, 0);
  speaker.close();
});

test('P2 rows wait while a question is waiting for its answer; P0 still goes; the answer releases them', async () => {
  const fake = fakeConn({ incident: [{ id: 1n, status: 'arrest', startedAt: nowTs(), updatedAt: nowTs(), demoMode: true }] });
  const speaker = new Speaker(fake.conn);
  const sent: string[] = [];
  const ws = { send: (m: string) => sent.push(JSON.parse(m).text), close: () => {}, on: () => {} } as unknown as import('ws').WebSocket;
  speaker.attach(ws);
  speaker.holdLow(8000);
  fake.db.callout.insert({ id: 1n, incidentId: 1n, text: 'Two minutes. Rhythm check, switch compressors.', priority: 2, createdAt: nowTs(), spokenAt: undefined });
  speaker.tick();
  assert.deepEqual(sent, [], 'the rule callout waits behind the open question');
  fake.db.callout.insert({ id: 2n, incidentId: 1n, text: 'Logged.', priority: 0, createdAt: nowTs(), spokenAt: undefined });
  speaker.tick();
  assert.deepEqual(sent, ['Logged.'], 'P0 is not held');
  // The mouth finishes "Logged." (the row is marked spoken), the answer releases the hold, and the held row goes.
  fake.db.callout.update({ ...fake.rows.callout[1], spokenAt: nowTs() });
  speaker.releaseLow();
  speaker.tick();
  assert.deepEqual(sent, ['Logged.', 'Two minutes. Rhythm check, switch compressors.']);
  speaker.close();
});
