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
/** The trend window: valid readings this long back, so a seizure's 30 s slide shows as one movement. */
export const TREND_WINDOW_S = 60;
/** A worsening trend worth one spoken note: SpO₂ down this much, or HR up this much, inside the window. */
export const TREND_SPO2_DROP = 6;
export const TREND_HR_RISE = 40;

/**
 * How the valid readings moved over the last TREND_WINDOW_S (spec §19 "What it sees"; the seizure beat, decision 15).
 * Built from the rows, never extrapolated: `from` is the oldest valid reading in the window, `to` the newest.
 */
export type Trend = {
  windowS: number;
  hr?: { from: number; to: number };
  spo2?: { from: number; to: number };
  /** SpO₂ fell TREND_SPO2_DROP or more, or HR rose TREND_HR_RISE or more: a worsening trend worth a note. */
  worsening: boolean;
  /** Coarse words for fingerprints and the summary: "SpO2 falling fast", "HR rising fast", "steady". */
  words: string;
};

/** What the camera sees right now (the vision sampler's scene sentence, decision 24); memory only. */
export type CameraScene = { text: string; at: number };
const CAMERA_FRESH_S = 60;

export type State = {
  now: number;
  incident?: Incident;
  destination?: Hospital;
  record?: PatientRecord;
  /** The newest vitals row and whether it is a fresh, valid reading. */
  vitals?: Vitals & { ageS: number; valid: boolean };
  /** How the valid readings moved lately; undefined with fewer than two valid readings in the window. */
  trend?: Trend;
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
  const allVitals = pick(conn.db.vitals.iter()).sort(byId);
  const v = allVitals.at(-1);
  const vitals = v ? { ...v, ageS: (now - tsMs(v.ts)) / 1000, valid: v.status === 'pulse' && (now - tsMs(v.ts)) / 1000 < VITALS_FRESH_S } : undefined;
  const trend = vitals?.valid ? vitalsTrend(allVitals, now) : undefined;
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
  return { now, incident, destination, record, vitals, trend, cpr, timers, events, transcript, recentSpeech, pending };
}

/**
 * The movement of the valid readings over the last TREND_WINDOW_S: oldest valid reading in the window → newest.
 * Only rows with status pulse count (a scenario's HR 0 under "no pulse" is not a trend). Needs two readings at
 * least 5 s apart, so one odd sample never makes a trend. Exported for the tests.
 */
export function vitalsTrend(rows: Vitals[], now = Date.now()): Trend | undefined {
  const valid = rows
    .filter(r => r.status === 'pulse' && now - tsMs(r.ts) <= TREND_WINDOW_S * 1000 && (r.hr !== undefined || r.spo2 !== undefined))
    .sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
  if (valid.length < 2) return undefined;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const windowS = Math.round((tsMs(last.ts) - tsMs(first.ts)) / 1000);
  if (windowS < 5) return undefined;
  const pair = (key: 'hr' | 'spo2') => {
    const from = valid.find(r => r[key] !== undefined)?.[key];
    const to = [...valid].reverse().find(r => r[key] !== undefined)?.[key];
    return from !== undefined && to !== undefined ? { from: Math.round(from), to: Math.round(to) } : undefined;
  };
  const hr = pair('hr');
  const spo2 = pair('spo2');
  const spo2Drop = spo2 ? spo2.from - spo2.to : 0;
  const hrRise = hr ? hr.to - hr.from : 0;
  // A heart rate climbing back from under 50 is a recovery (the ROSC scenario goes 38 → 104), not a worsening
  // trend: only a rise that starts from a normal rate counts (decision 24).
  const hrWorsening = !!hr && hr.from >= 50 && hrRise >= TREND_HR_RISE;
  const words = [
    spo2Drop >= TREND_SPO2_DROP ? 'SpO2 falling fast' : spo2Drop >= 3 ? 'SpO2 falling' : spo2Drop <= -3 ? 'SpO2 rising' : undefined,
    hrWorsening ? 'HR rising fast' : hrRise >= 15 ? 'HR rising' : hrRise <= -15 ? 'HR falling' : undefined,
  ].filter(Boolean);
  return { windowS, hr, spo2, worsening: spo2Drop >= TREND_SPO2_DROP || hrWorsening, words: words.join(', ') || 'steady' };
}

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/**
 * The text block the model reads. About 200–300 tokens. `camera` is what the vision sampler last saw (the brain
 * keeps it in memory, decision 24): one line, only while it is under a minute old.
 */
export function summarize(s: State, camera?: CameraScene): string {
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
  // The trend line only when the readings moved: a steady patient costs no tokens.
  const t = s.trend;
  if (t && t.words !== 'steady') {
    const move = (label: string, p?: { from: number; to: number }) => (p && p.from !== p.to ? `${label} ${p.from} → ${p.to}` : undefined);
    lines.push(`TREND (last ${t.windowS} s) ${[move('SpO2', t.spo2), move('HR', t.hr)].filter(Boolean).join(' · ')} · ${t.words}${t.worsening ? ' · WORSENING' : ''}`);
  }
  if (camera && (s.now - camera.at) / 1000 < CAMERA_FRESH_S) {
    lines.push(`CAMERA (${Math.round((s.now - camera.at) / 1000)} s ago) ${camera.text}`);
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
    trend: s.trend ? { windowS: s.trend.windowS, hr: s.trend.hr ?? null, spo2: s.trend.spo2 ?? null, worsening: s.trend.worsening, words: s.trend.words } : null,
    cpr: s.cpr ? { rate: s.cpr.rate ?? null, compressing: s.cpr.compressing, count: s.cpr.count - s.cpr.countBase, longestPauseS: Math.round(s.cpr.longestPauseS), source: s.cpr.source, fresh: s.cpr.fresh } : null,
    timers: s.timers.map(t => ({ kind: t.kind, state: t.state, dueInS: Math.round((tsMs(t.dueAt) - s.now) / 1000) })),
    events: s.events.slice(-20).map(e => ({ id: Number(e.id), time: hhmm(e.ts), kind: e.kind, label: e.label, status: e.status, chips: [...new Set(e.sources.map(x => x.kind))] })),
    pendingCallouts: s.pending.map(c => ({ id: Number(c.id), text: c.text, priority: c.priority })),
    summary: summarize(s),
  };
}
