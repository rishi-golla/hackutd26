// The compact state the model sees (spec §19 "What it sees"): built from the tables, never raw waveforms.
// Numbers are copied from the rows; a missing reading says so. The text block is the proposed format for the
// §28 "state-summary format" question.
import type { Timestamp } from 'spacetimedb';
import type { Conn } from './db';
import { activeIncident } from './db';
import { CONFIG } from './config';
import type { Callout, CprState, Event, Hospital, Incident, PatientRecord, Timer, Transcript, Vitals } from './module_bindings/types';

export const tsMs = (ts: Timestamp) => Number(ts.microsSinceUnixEpoch / 1000n);

function fmt(ms: number, withSeconds: boolean): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
    timeZone: CONFIG.timeZone,
  });
}
export const hhmm = (ts: Timestamp) => fmt(tsMs(ts), false);
export const hhmmss = (ts: Timestamp) => fmt(tsMs(ts), true);

export function ageOn(birthDate: string, now = new Date()): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  return age;
}

const byId = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Vitals count only if the relay reported in the last 5 s with status pulse (same as rules.ts). */
const VITALS_FRESH_S = 5;
const CPR_FRESH_S = 3;

export type State = {
  now: number;
  incident?: Incident;
  destination?: Hospital;
  record?: PatientRecord;
  /** The newest vitals row and whether it is a fresh, valid reading. */
  vitals?: Vitals & { ageS: number; valid: boolean };
  cpr?: CprState & { fresh: boolean };
  timers: Timer[];
  /** Not cancelled, oldest first. */
  events: Event[];
  /** Oldest first. */
  transcript: Transcript[];
  /** Spoken callouts, newest first. */
  recentSpeech: Callout[];
  /** Waiting to be spoken, by priority then age. */
  pending: Callout[];
};

export function readState(conn: Conn): State {
  const now = Date.now();
  const incident = activeIncident(conn);
  const id = incident?.id;
  const pick = <T extends { incidentId: bigint }>(rows: Iterable<T>) =>
    id === undefined ? [] : [...rows].filter(r => r.incidentId === id);

  const destination = incident?.destinationId !== undefined ? [...conn.db.hospital.iter()].find(h => h.id === incident.destinationId) : undefined;
  const record = id === undefined ? undefined : [...conn.db.patientRecord.iter()].find(r => r.incidentId === id);
  const v = pick(conn.db.vitals.iter()).sort(byId).at(-1);
  const vitals = v ? { ...v, ageS: (now - tsMs(v.ts)) / 1000, valid: v.status === 'pulse' && (now - tsMs(v.ts)) / 1000 < VITALS_FRESH_S } : undefined;
  const c = id === undefined ? undefined : [...conn.db.cprState.iter()].find(r => r.incidentId === id);
  const cpr = c ? { ...c, fresh: c.source === 'override' || (now - tsMs(c.updatedAt)) / 1000 < CPR_FRESH_S } : undefined;
  const timers = pick(conn.db.timer.iter()).filter(t => t.state !== 'cancelled');
  const events = pick(conn.db.event.iter()).filter(e => e.status !== 'cancelled').sort(byId);
  const transcript = pick(conn.db.transcript.iter()).sort(byId);
  const callouts = [...conn.db.callout.iter()];
  const recentSpeech = callouts.filter(c => c.spokenAt !== undefined).sort(byId).reverse().slice(0, 5);
  const pending = callouts
    .filter(c => c.spokenAt === undefined)
    .sort((a, b) => a.priority - b.priority || Number(a.id - b.id));
  return { now, incident, destination, record, vitals, cpr, timers, events, transcript, recentSpeech, pending };
}

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** The text block the model reads. About 200–300 tokens. */
export function summarize(s: State): string {
  const lines: string[] = [];
  const inc = s.incident;
  if (!inc) return 'INCIDENT none active (standby). Nothing to coach; only answer direct questions.';

  const since = inc.status === 'arrest' && inc.arrestStartedAt ? ` (since ${hhmm(inc.arrestStartedAt)}, ${Math.round((s.now - tsMs(inc.arrestStartedAt)) / 60000)} min)` : '';
  const eta = inc.etaAt ? `, ETA ${Math.max(0, Math.round((tsMs(inc.etaAt) - s.now) / 60000))} min` : '';
  lines.push(
    `INCIDENT ${inc.unit} · status ${inc.status.toUpperCase()}${since} · DEMO TIMING ${inc.demoMode ? 'on' : 'off'}` +
      (s.destination ? ` · destination ${s.destination.name}${eta}` : ' · destination not set') +
      (inc.patientRef ? ` · patientRef ${inc.patientRef}` : '')
  );

  if (s.record) {
    const r = s.record;
    const age = ageOn(r.birthDate);
    lines.push(
      `PATIENT ${r.name}${age !== undefined ? `, ${age}` : ''} (${r.source}) · allergies: ${r.allergies.join(', ') || 'none recorded'}` +
        ` · meds: ${r.medications.join(', ') || 'none recorded'} · history: ${r.conditions.join(', ') || 'none recorded'} · ${r.codeStatus || 'code status not recorded'}`
    );
  } else {
    lines.push('PATIENT not identified yet (no record)');
  }

  const v = s.vitals;
  if (v && v.valid) {
    const parts = [
      v.hr !== undefined ? `HR ${Math.round(v.hr)}` : undefined,
      v.spo2 !== undefined ? `SpO2 ${Math.round(v.spo2)} (experimental)` : undefined,
      v.tempC !== undefined ? `temp ${v.tempC.toFixed(1)} C` : undefined,
    ].filter(Boolean);
    lines.push(`VITALS (${v.simulated ? 'simulated' : 'relay'}, ${Math.round(v.ageS)} s ago) ${parts.join(' · ')}`);
  } else if (v) {
    // Never a stale number (spec R4, §24.1): the temperature only while the relay is still reporting.
    const fresh = v.ageS < VITALS_FRESH_S;
    lines.push(`VITALS no valid reading (${fresh ? v.status : 'relay offline'})${fresh && v.tempC !== undefined ? ` · temp ${v.tempC.toFixed(1)} C` : ''}`);
  } else {
    lines.push('VITALS no data (relay offline)');
  }

  const c = s.cpr;
  if (c && c.fresh && inc.status === 'arrest') {
    const avg = c.rateSamples > 0 ? Math.round(c.rateSum / c.rateSamples) : undefined;
    lines.push(
      `CPR ${c.compressing && c.rate !== undefined ? `rate ${Math.round(c.rate)}/min · compressing` : `paused ${Math.round(c.sinceLastS)} s`}` +
        ` · ${c.count - c.countBase} compressions this arrest` +
        (avg !== undefined ? ` · average ${avg}/min` : '') +
        ` · longest pause ${Math.round(c.longestPauseS)} s${c.source === 'override' ? ' (demo override, simulated)' : ''}`
    );
  } else if (inc.status === 'arrest') {
    lines.push('CPR no motion data from the bodycam');
  }

  if (s.timers.length) {
    lines.push(
      'TIMERS ' +
        s.timers
          .map(t => {
            const left = (tsMs(t.dueAt) - s.now) / 1000;
            return `${t.kind} ${t.state === 'due' || left <= 0 ? 'DUE' : `due in ${mmss(left)}`}`;
          })
          .join(' · ')
    );
  }

  const ev = s.events.slice(-8);
  if (ev.length) {
    lines.push(
      'EVENTS (last 8) ' +
        ev
          .map(e => {
            const chips = [...new Set(e.sources.map(x => x.kind))].join(', ');
            const flag = e.status === 'flagged' ? ' FLAGGED' : e.status === 'confirmed' ? ' confirmed' : '';
            return `${hhmm(e.ts)} ${e.label} [${chips}${flag}]`;
          })
          .join(' · ')
    );
  }

  if (s.recentSpeech.length) {
    lines.push('RECENT SPEECH ' + s.recentSpeech.map(c => `${c.spokenAt ? hhmm(c.spokenAt) : ''} "${c.text}"`).join(' · '));
  }
  const tx = s.transcript.slice(-6);
  if (tx.length) lines.push('TRANSCRIPT (last 6) ' + tx.map(t => `${hhmmss(t.ts)} "${t.text}"`).join(' · '));
  return lines.join('\n');
}

/** GET /state: the same facts as JSON (for the mocks and debugging). */
export function stateJson(s: State) {
  const inc = s.incident;
  return {
    incident: inc
      ? {
          id: Number(inc.id),
          unit: inc.unit,
          status: inc.status,
          demoMode: inc.demoMode,
          patientRef: inc.patientRef ?? null,
          destination: s.destination?.name ?? null,
          etaMin: inc.etaAt ? Math.max(0, Math.round((tsMs(inc.etaAt) - s.now) / 60000)) : null,
        }
      : null,
    record: s.record
      ? { name: s.record.name, birthDate: s.record.birthDate, allergies: s.record.allergies, medications: s.record.medications, conditions: s.record.conditions, codeStatus: s.record.codeStatus, source: s.record.source }
      : null,
    // A number only when the reading is valid: a scenario's HR 0 under 'no pulse' reaches the model as no reading.
    vitals: s.vitals ? { hr: s.vitals.valid ? s.vitals.hr ?? null : null, spo2: s.vitals.valid ? s.vitals.spo2 ?? null : null, tempC: s.vitals.tempC ?? null, status: s.vitals.status, valid: s.vitals.valid, simulated: s.vitals.simulated, ageS: Math.round(s.vitals.ageS) } : null,
    cpr: s.cpr ? { rate: s.cpr.rate ?? null, compressing: s.cpr.compressing, count: s.cpr.count - s.cpr.countBase, longestPauseS: Math.round(s.cpr.longestPauseS), source: s.cpr.source, fresh: s.cpr.fresh } : null,
    timers: s.timers.map(t => ({ kind: t.kind, state: t.state, dueInS: Math.round((tsMs(t.dueAt) - s.now) / 1000) })),
    events: s.events.slice(-20).map(e => ({ id: Number(e.id), time: hhmm(e.ts), kind: e.kind, label: e.label, status: e.status, chips: [...new Set(e.sources.map(x => x.kind))] })),
    pendingCallouts: s.pending.map(c => ({ id: Number(c.id), text: c.text, priority: c.priority })),
    summary: summarize(s),
  };
}
