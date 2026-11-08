import { Timestamp } from 'spacetimedb';
import type { Conn } from '../src/db.js';

export const timestamp = (ms: number) => new Timestamp(BigInt(ms) * 1000n);
export const nowTs = () => timestamp(Date.now());

type Listener = (...args: any[]) => void;

class FakeTable<T extends Record<string, any>> {
  private inserts: Listener[] = [];
  private updates: Listener[] = [];
  private deletes: Listener[] = [];
  constructor(readonly rows: T[]) {}
  iter(): Iterable<T> { return this.rows; }
  onInsert(listener: Listener) { this.inserts.push(listener); }
  onUpdate(listener: Listener) { this.updates.push(listener); }
  onDelete(listener: Listener) { this.deletes.push(listener); }
  delete(row: T) {
    const key = row.id !== undefined ? 'id' : 'incidentId';
    const index = this.rows.findIndex(old => old[key] === row[key]);
    if (index >= 0) {
      this.rows.splice(index, 1);
      for (const listener of this.deletes) listener({}, row);
    }
  }
  insert(row: T) {
    this.rows.push(row);
    for (const listener of this.inserts) listener({}, row);
  }
  update(row: T) {
    const key = row.id !== undefined ? 'id' : 'incidentId';
    const index = this.rows.findIndex(old => old[key] === row[key]);
    if (index >= 0) {
      const old = this.rows[index];
      this.rows[index] = row;
      for (const listener of this.updates) listener({}, old, row);
    }
  }
}

const TABLES = [
  'incident', 'hospital', 'patientRecord', 'vitals', 'cprState', 'timer', 'event', 'transcript', 'callout',
  'agentStep', 'device', 'erMessage', 'report', 'vitalsOverride',
] as const;

export type FakeSeed = Partial<Record<(typeof TABLES)[number], Record<string, any>[]>>;

export function fakeConn(seed: FakeSeed = {}) {
  const rows: Record<string, Record<string, any>[]> = {};
  const db: Record<string, FakeTable<any>> = {};
  for (const name of TABLES) {
    rows[name] = seed[name] ?? [];
    db[name] = new FakeTable(rows[name]);
  }
  const calls: { reducer: string; args: any }[] = [];
  const record = (reducer: string, args: any) => { calls.push({ reducer, args }); };
  const reducers: Record<string, (...args: any[]) => Promise<void>> = {};
  for (const name of [
    'addCallout', 'calloutSpoken', 'logAgentStep', 'addTranscript', 'logEvent', 'setEventStatus', 'identifyPatient',
    'savePatientRecord', 'setStatus', 'pushVitals', 'pushCpr', 'pushWaveform', 'addTimer', 'cancelTimer', 'demoControl',
  ]) reducers[name] = async (args: any) => {
    record(name, args);
    const incidentId = [...rows.incident].filter(r => r.status !== 'closed').sort((a, b) => a.id < b.id ? 1 : -1)[0]?.id ?? 0n;
    if (name === 'addCallout') {
      const duplicate = rows.callout.some(c => c.spokenAt === undefined && c.text === args.text);
      if (!duplicate) {
        const id = rows.callout.reduce((max, c) => c.id > max ? c.id : max, 0n) + 1n;
        db.callout.insert({ id, incidentId, text: args.text, priority: args.priority, createdAt: nowTs(), spokenAt: undefined });
      }
    } else if (name === 'calloutSpoken') {
      const row = rows.callout.find(c => c.id === args.calloutId);
      if (row && row.spokenAt === undefined) db.callout.update({ ...row, spokenAt: nowTs() });
    } else if (name === 'logAgentStep') {
      const id = rows.agentStep.reduce((max, r) => r.id > max ? r.id : max, 0n) + 1n;
      db.agentStep.insert({ id, incidentId, ts: nowTs(), ...args });
    } else if (name === 'addTranscript') {
      const id = rows.transcript.reduce((max, r) => r.id > max ? r.id : max, 0n) + 1n;
      db.transcript.insert({ id, incidentId, ts: nowTs(), ...args });
    } else if (name === 'savePatientRecord') {
      const row = { incidentId, updatedAt: nowTs(), ...args };
      const old = rows.patientRecord.find(r => r.incidentId === incidentId);
      if (old) db.patientRecord.update(row); else db.patientRecord.insert(row);
    } else if (name === 'identifyPatient') {
      const row = rows.incident.find(r => r.id === incidentId);
      if (row) db.incident.update({ ...row, patientRef: args.patientRef, updatedAt: nowTs() });
    } else if (name === 'setEventStatus') {
      const row = rows.event.find(r => r.id === args.eventId);
      if (row) db.event.update({ ...row, status: args.status });
    }
  };
  return { conn: { db, reducers } as unknown as Conn, db, rows, calls };
}

export function callsTo(calls: { reducer: string; args: any }[], reducer: string) {
  return calls.filter(call => call.reducer === reducer);
}
