// Hospital dashboard (hospital lane, spec §14). One action: Generate Handoff.
// Honesty rules: a missing or stale reading shows "—" (no data), never a number; SpO₂ carries no "experimental"
// label here (decision 10, Sun ~01:30) but the caveat is still said if asked (§24.1);
// the patient record says whether it came from the EHR or a cached copy.
//
// Five panels (Alan's sketch): live view and event timeline on the left; overall status (coloured by status),
// the vitals and the patient on the right. The report opens in the live-view panel when it's ready.
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, type DbConnection } from '../../module_bindings';
import type { Incident, PatientRecord, Timer, Vitals } from '../../module_bindings/types';
import { tsMs } from '../../db/time';
import LiveVideo from './LiveVideo';
import ReportView from './ReportView';
import './hospital.css';

const VITALS_STALE_MS = 5000;
// A dropout shorter than this (finger shifts, one noisy second) keeps the last good number, dimmed.
const HOLD_MS = 6000;
// Relay statuses that mean "finger on, sensor still settling" (bridge/hub_bridge.py maps measuring, settling,
// moving, weak and noisy to acquiring).
const MEASURING_STATUS = new Set(['acquiring', 'calibrating']);
const CPR_STALE_MS = 3000;
const REPORT_SLOW_MS = 30000;

function useNow(intervalMs = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ageOn(birthDate: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return undefined;
  const now = new Date();
  let age = now.getFullYear() - Number(m[1]);
  if (now.getMonth() + 1 < Number(m[2]) || (now.getMonth() + 1 === Number(m[2]) && now.getDate() < Number(m[3]))) age -= 1;
  return age;
}

const STATUS_TEXT: Record<string, string> = {
  standby: 'Standby',
  on_scene: 'On scene',
  arrest: 'Arrest',
  rosc: 'ROSC',
  en_route: 'En route',
  arrived: 'Arrived',
  closed: 'Closed',
};

const byNewest = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? 1 : -1);

/** Expand or minimize with a view transition where the browser has one (the thumbnail morphs into place). */
function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === 'function') doc.startViewTransition(() => flushSync(update));
  else update();
}

export default function HospitalPage() {
  const { isActive, getConnection } = useSpacetimeDB();
  const now = useNow();
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const [incidents] = useTable(tables.incident);
  const [vitalsRows] = useTable(tables.vitals);
  const [cprRows] = useTable(tables.cprState);
  const [events] = useTable(tables.event);
  const [timers] = useTable(tables.timer);
  const [messages] = useTable(tables.erMessage);
  const [records] = useTable(tables.patientRecord);
  const [reports] = useTable(tables.report);

  // The newest incident, closed or not, so the dashboard still shows a finished run.
  const incident: Incident | undefined = useMemo(() => [...incidents].sort(byNewest)[0], [incidents]);
  const incId = incident?.id;
  const record = records.find(r => r.incidentId === incId);
  const report = reports.find(r => r.incidentId === incId);

  // Event timeline, newest first: what happened, and the alert the agent sent the ER.
  const timeline = [
    ...events
      .filter(e => e.incidentId === incId && e.status !== 'cancelled')
      .map(e => ({ key: `e${e.id}`, t: tsMs(e.ts), text: e.label, flagged: e.status === 'flagged' })),
    ...messages
      // The agent's "Handoff report ready" summary (E4) is not the pre-arrival alert.
      .filter(m => m.incidentId === incId && m.direction === 'to_er' && !m.text.startsWith('Handoff report ready'))
      .map(m => ({ key: `m${m.id}`, t: tsMs(m.ts), text: `Alert to ER: ${m.text}`, flagged: false })),
  ].sort((a, b) => b.t - a.t);

  const vitalsNewest = [...vitalsRows].sort(byNewest);
  const latestVitals: Vitals | undefined = vitalsNewest[0];
  const v = latestVitals !== undefined && now - tsMs(latestVitals.ts) < VITALS_STALE_MS ? latestVitals : undefined;
  const hr = readingOf(vitalsNewest, r => r.hr, now);
  const blankInArrest = incident?.status === 'arrest' && !v?.simulated;
  const spo2 = readingOf(vitalsNewest, r => r.spo2, now);
  const inArrest = incident?.status === 'arrest';
  const cpr = cprRows.find(c => c.incidentId === incId);
  const cprFresh = cpr !== undefined && (cpr.source === 'override' || now - tsMs(cpr.updatedAt) < CPR_STALE_MS);
  const rate = inArrest && cprFresh && cpr.compressing ? cpr.rate : undefined;
  const epi = timers.find(t => t.incidentId === incId && t.kind === 'epi' && t.state !== 'cancelled');

  const elapsed = incident ? (now - tsMs(incident.startedAt)) / 1000 : 0;
  const reportReady = report?.status === 'ready' && !!report.contentJson;
  const writing = report?.status === 'requested';

  // H7: when the report lands, show it.
  useEffect(() => {
    if (reportReady) setShowReport(true);
  }, [reportReady]);

  const toggleVideo = () => withViewTransition(() => setVideoExpanded(x => !x));
  useEffect(() => {
    if (!videoExpanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && withViewTransition(() => setVideoExpanded(false));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [videoExpanded]);

  const generate = () => {
    const conn = getConnection() as DbConnection | null;
    if (!conn) return;
    void conn.reducers.requestReport({}).catch(err => console.error('Generate Handoff failed', err));
  };

  const problem = !isActive
    ? 'Connecting…'
    : report?.status === 'failed'
      ? 'Report failed'
      : // H7 promises a report within 30 s; past that, say so rather than look busy forever.
        writing && now - tsMs(report.requestedAt) > REPORT_SLOW_MS
        ? 'No reply from the agent'
        : undefined;

  return (
    <div className="hd">
      <section className="panel panel--live" aria-label={showReport && reportReady ? 'Handoff report' : 'Live view'}>
        {reportReady && (
          <div className="switch" role="tablist">
            <button type="button" role="tab" aria-selected={!showReport} onClick={() => setShowReport(false)}>
              Live view
            </button>
            <button type="button" role="tab" aria-selected={showReport} onClick={() => setShowReport(true)}>
              Report
            </button>
          </div>
        )}
        {showReport && reportReady ? (
          <ReportView contentJson={report.contentJson} />
        ) : (
          <div className="video-slot">
            {videoExpanded && <span className="video-slot__note">Esc to minimize</span>}
            <LiveVideo expanded={videoExpanded} onToggle={toggleVideo} />
          </div>
        )}
      </section>

      <section className={`panel panel--status status--${incident?.status ?? 'none'}`} aria-label="Status">
        <div className="status__main">
          <p className="status__word">{incident ? STATUS_TEXT[incident.status] ?? incident.status : 'No incident'}</p>
        </div>
      </section>

      <section className="panel panel--data" aria-label="Vitals">
        {/* The real finger clip reads nothing useful through chest compressions, so HR and SpO₂ stay blank in an
            arrest (§9) unless a simulated scenario is playing (the demo's arrest: HR 0, no SpO₂). No alarm colour in
            an arrest: the §15 vitals alarms don't apply then. CPR rate and the epi timer only exist during one. */}
        <Metric
          label="Heart rate"
          unit="bpm"
          reading={blankInArrest ? NONE : hr}
          alarm={!inArrest && hr.value !== undefined && (hr.value < 50 || hr.value > 150)}
        />
        <Metric
          label="SpO₂"
          unit="%"
          reading={blankInArrest ? NONE : spo2}
          alarm={!inArrest && spo2.value !== undefined && spo2.value < 90}
        />
        <Metric label="Temperature" unit="°C" digits={1} value={v?.tempC} />
        <Metric label="CPR rate" unit="/min" value={rate} alarm={rate !== undefined && (rate < 100 || rate > 120)} />
        <Metric label="Next epi" text={inArrest ? epiText(epi, now) : undefined} alarm={inArrest && isDue(epi, now)} />
        <Metric label="Elapsed" text={incident && incident.status !== 'closed' ? mmss(elapsed) : undefined} />
      </section>

      <section className="panel panel--timeline" aria-label="Event timeline">
        <div className="panel__head">
          <h2 className="panel__title">Event timeline</h2>
          {problem && <span className="panel__problem">{problem}</span>}
          <button
            type="button"
            className="action"
            onClick={generate}
            aria-busy={writing}
            // One report per incident: disabled while it's being written and once it's ready.
            disabled={!isActive || !incident || writing || reportReady}
          >
            {writing ? 'Writing report…' : reportReady ? 'Report ready' : 'Generate Handoff'}
          </button>
        </div>
        {timeline.length === 0 ? (
          <p className="empty">No events yet.</p>
        ) : (
          <ol className="timeline">
            {timeline.map(e => (
              <li key={e.key} className={e.flagged ? 'is-alarm' : undefined}>
                <span className="timeline__time">{new Date(e.t).toLocaleTimeString([], { hour12: false })}</span>
                <span className="timeline__text">{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel panel--patient" aria-label="Patient">
        {/* X7: a cached record must not pass for a live one. */}
        <h2 className="panel__title">Patient{record && (record.source === 'cached' ? ' · cached copy' : ' · from EHR')}</h2>
        <PatientData record={record} patientRef={incident?.patientRef} />
      </section>

      {videoExpanded && <div className="video-backdrop" onClick={toggleVideo} aria-hidden="true" />}
    </div>
  );
}

function isDue(timer: Timer | undefined, now: number) {
  return !!timer && (timer.state === 'due' || tsMs(timer.dueAt) <= now);
}

function epiText(timer: Timer | undefined, now: number) {
  if (!timer) return undefined;
  return isDue(timer, now) ? 'Due now' : mmss((tsMs(timer.dueAt) - now) / 1000);
}

type Reading = { kind: 'live' | 'held' | 'measuring' | 'none'; value?: number };
const NONE: Reading = { kind: 'none' };

/**
 * What a pulse-oximeter metric shows, from the vitals rows (newest first):
 * live — the newest row carries it; held — it dropped out less than HOLD_MS ago, so the last good number stays
 * (dimmed); measuring — finger on and the sensor still settling, or HR is reading and this one hasn't come yet;
 * none — finger off, a sensor fault, or the relay silent.
 */
function readingOf(rows: Vitals[], pick: (r: Vitals) => number | undefined, now: number): Reading {
  const latest = rows[0];
  const fresh = latest !== undefined && now - tsMs(latest.ts) < VITALS_STALE_MS;
  // The module keeps the relay's hr/spo2 only on 'pulse' rows; a scenario's numbers (the arrest's HR 0) are kept as written.
  const good = rows.find(r => pick(r) !== undefined);
  if (good && fresh && good === latest) return { kind: 'live', value: pick(good) };
  // Hold only bridges a gap in one source: a scenario taking over from the real clip (or ending) never carries
  // the other's number across.
  if (good && good.device === latest?.device && now - tsMs(good.ts) < HOLD_MS) return { kind: 'held', value: pick(good) };
  if (fresh && (MEASURING_STATUS.has(latest.status) || latest.status === 'pulse')) return { kind: 'measuring' };
  return NONE;
}

/** One live metric. A missing reading shows a dash, never a stale number (a held one is dimmed and brief). */
function Metric(props: {
  label: string;
  unit?: string;
  value?: number;
  reading?: Reading;
  digits?: number;
  text?: string;
  alarm?: boolean;
}) {
  const { label, unit, digits = 0, text, alarm } = props;
  const reading: Reading = props.reading ?? (props.value !== undefined ? { kind: 'live', value: props.value } : NONE);
  const shown = text ?? (reading.value !== undefined ? reading.value.toFixed(digits) : undefined);
  return (
    <div className={`metric${alarm ? ' is-alarm' : ''}`}>
      <p className="metric__label">{label}</p>
      {reading.kind === 'measuring' && text === undefined ? (
        <p className="metric__value" aria-label="measuring">
          <span className="measuring" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
      ) : (
        <p className={`metric__value${shown === undefined ? ' metric__value--none' : ''}${reading.kind === 'held' ? ' is-held' : ''}`}>
          {shown ?? '—'}
          {shown !== undefined && unit && <span className="metric__unit">{unit}</span>}
        </p>
      )}
    </div>
  );
}

function PatientData({ record, patientRef }: { record?: PatientRecord; patientRef?: string }) {
  if (!record) return <p className="empty">{patientRef ? 'Pulling the record…' : 'Not identified yet'}</p>;
  const age = ageOn(record.birthDate);
  return (
    <>
      <p className="patient__name">
        {record.name}
        {age !== undefined && <span className="patient__age">, {age}</span>}
      </p>
      {record.allergies.length > 0 ? (
        <p className="patient__allergy">Allergy: {record.allergies.join(', ')}</p>
      ) : (
        <p className="patient__line">No known allergies</p>
      )}
      <dl className="patient__facts">
        <dt>Code status</dt>
        <dd>{record.codeStatus || 'not recorded'}</dd>
        <dt>Medications</dt>
        <dd>{record.medications.join(', ') || 'none recorded'}</dd>
        <dt>History</dt>
        <dd>{record.conditions.join(', ') || 'none recorded'}</dd>
      </dl>
    </>
  );
}
