// Hospital dashboard (hospital lane, spec §14 H1–H5, H7, H9). One page, one button: Generate Handoff.
// Honesty rules: a missing or stale reading shows "no data"; SpO₂ is experimental; simulated data says so.
import { useEffect, useMemo, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, type DbConnection } from '../../module_bindings';
import type { Event as TimelineEvent, Incident, Timer, Vitals } from '../../module_bindings/types';
import { clock, tsMs } from '../../db/time';
import LiveVideo from './LiveVideo';
import ReportView from './ReportView';
import './hospital.css';

const VITALS_STALE_MS = 5000;
const CPR_STALE_MS = 3000;

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

const STATUS_TEXT: Record<string, string> = {
  standby: 'STANDBY',
  on_scene: 'ON SCENE',
  arrest: 'ARREST',
  rosc: 'ROSC',
  en_route: 'EN ROUTE',
  arrived: 'ARRIVED',
  closed: 'CLOSED',
};

export default function HospitalPage() {
  const { isActive, getConnection } = useSpacetimeDB();
  const now = useNow();

  const [incidents] = useTable(tables.incident);
  const [hospitals] = useTable(tables.hospital);
  const [vitalsRows] = useTable(tables.vitals);
  const [cprRows] = useTable(tables.cprState);
  const [events] = useTable(tables.event);
  const [timers] = useTable(tables.timer);
  const [callouts] = useTable(tables.callout);
  const [messages] = useTable(tables.erMessage);
  const [steps] = useTable(tables.agentStep);
  const [records] = useTable(tables.patientRecord);
  const [reports] = useTable(tables.report);

  // The newest incident, closed or not, so the dashboard still shows a finished run.
  const incident: Incident | undefined = useMemo(
    () => [...incidents].sort((a, b) => (a.id < b.id ? 1 : -1))[0],
    [incidents]
  );
  const incId = incident?.id;
  const destination = hospitals.find(h => h.id === incident?.destinationId);
  const record = records.find(r => r.incidentId === incId);
  const report = reports.find(r => r.incidentId === incId);
  const alert = [...messages]
    // The agent's "Handoff report ready" summary (E4) is not the pre-arrival alert.
    .filter(m => m.incidentId === incId && m.direction === 'to_er' && !m.text.startsWith('Handoff report ready'))
    .sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const timeline = [...events].filter(e => e.incidentId === incId).sort((a, b) => (a.id < b.id ? 1 : -1));
  const trace = [...steps].filter(s => s.incidentId === incId).sort((a, b) => (a.id < b.id ? 1 : -1));
  const lastCallout = [...callouts]
    .filter(c => c.spokenAt !== undefined)
    .sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const showCallout = lastCallout?.spokenAt && now - tsMs(lastCallout.spokenAt) < 8000;

  const latestVitals: Vitals | undefined = [...vitalsRows].sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const vitalsFresh = latestVitals !== undefined && now - tsMs(latestVitals.ts) < VITALS_STALE_MS;
  const inArrest = incident?.status === 'arrest';

  const cpr = cprRows.find(c => c.incidentId === incId);
  const cprFresh = cpr !== undefined && (cpr.source === 'override' || now - tsMs(cpr.updatedAt) < CPR_STALE_MS);

  const running = (kind: string): Timer | undefined =>
    timers.find(t => t.incidentId === incId && t.kind === kind && t.state !== 'cancelled');
  const epi = running('epi');
  const cycle = running('cycle');

  const eta = incident?.etaAt ? Math.ceil((tsMs(incident.etaAt) - now) / 60000) : undefined;
  const elapsed = incident ? (now - tsMs(incident.startedAt)) / 1000 : 0;

  const generate = () => {
    const conn = getConnection() as DbConnection | null;
    if (!conn) return;
    void conn.reducers.requestReport({}).catch(err => console.error('Generate Handoff failed', err));
  };

  return (
    <div className="hd">
      <header className="hd__header">
        <div className="hd__route">
          <strong>{incident?.unit ?? 'No unit'}</strong>
          <span className="hd__arrow">→</span>
          <strong>{destination?.name ?? 'destination not set'}</strong>
        </div>
        <span className={`hd__status hd__status--${incident?.status ?? 'none'}`}>
          {incident ? STATUS_TEXT[incident.status] ?? incident.status : 'NO INCIDENT'}
          {incident && incident.status !== 'closed' ? ` ${mmss(elapsed)}` : ''}
        </span>
        <span className="hd__meta">{eta !== undefined ? `ETA ${Math.max(0, eta)} min` : 'ETA —'}</span>
        {incident?.demoMode && <span className="tag tag--demo">DEMO TIMING</span>}
        <span className="hd__spacer" />
        <span className="tag">Prototype · synthetic data</span>
        <span className={`dot ${isActive ? 'dot--on' : ''}`} title={isActive ? 'connected' : 'connecting'} />
      </header>

      {showCallout && (
        <div className="hd__callout" role="status">
          Bodycam said: “{lastCallout.text}”
        </div>
      )}

      <main className="hd__grid">
        <section className="hd__left">
          {report?.status === 'ready' && report.contentJson ? (
            <ReportView contentJson={report.contentJson} />
          ) : (
          <>
          <LiveVideo />

          <div className="tiles">
            <Tile
              label="HR"
              unit="bpm"
              value={inArrest ? undefined : vitalsFresh ? latestVitals.hr : undefined}
              note={inArrest ? 'no pulse expected during CPR' : sensorNote(latestVitals, vitalsFresh)}
              simulated={vitalsFresh && latestVitals.simulated}
            />
            <Tile
              label="SpO₂ · experimental"
              unit="%"
              value={inArrest ? undefined : vitalsFresh ? latestVitals.spo2 : undefined}
              note={inArrest ? '—' : sensorNote(latestVitals, vitalsFresh)}
              simulated={vitalsFresh && latestVitals.simulated}
            />
            <Tile
              label="Temp"
              unit="°C"
              digits={1}
              value={vitalsFresh ? latestVitals.tempC : undefined}
              simulated={vitalsFresh && latestVitals.simulated}
            />
            <Tile
              label="CPR · target 100–120"
              unit="/min"
              value={inArrest && cprFresh && cpr.compressing ? cpr.rate : undefined}
              alarm={inArrest && cprFresh && cpr.rate !== undefined && (cpr.rate < 100 || cpr.rate > 120)}
              simulated={cpr?.source === 'override'}
              note={
                !inArrest
                  ? 'not in arrest'
                  : !cprFresh
                    ? 'no data from bodycam'
                    : `${cpr.count - cpr.countBase} compressions · pause ${cpr.compressing ? 0 : Math.round(cpr.sinceLastS)} s${cpr.source === 'override' ? ' · demo override' : ''}`
              }
            />
            <TimerTile label="Next epi" timer={epi} now={now} demo={incident?.demoMode} />
            <TimerTile label="Cycle" timer={cycle} now={now} demo={incident?.demoMode} />
          </div>
          </>
          )}
        </section>

        <section className="hd__right">
          <Panel title="Patient record" badge={record ? (record.source === 'cached' ? 'cached' : 'from EHR') : undefined}>
            {record ? (
              <div className="record">
                <p className="record__name">
                  {record.name}
                  <span className="muted"> · born {record.birthDate} · {record.patientRef}</span>
                </p>
                <p className={record.allergies.length ? 'record__allergy' : ''}>
                  Allergies: {record.allergies.length ? record.allergies.join(', ') : 'none recorded'}
                </p>
                <p>Medications: {record.medications.join(', ') || 'none recorded'}</p>
                <p>History: {record.conditions.join(', ') || 'none recorded'}</p>
                <p>Code status: {record.codeStatus || 'not recorded'}</p>
              </div>
            ) : (
              <p className="muted">
                {incident?.patientRef ? `Identified as ${incident.patientRef}; pulling the record…` : 'Patient not identified yet.'}
              </p>
            )}
          </Panel>

          <Panel title="Pre-arrival alert">
            {alert ? (
              <p>
                <span className="muted">{clock(alert.ts)} </span>
                {alert.text}
              </p>
            ) : (
              <p className="muted">No alert yet.</p>
            )}
          </Panel>

          <Panel title="Timeline" grow>
            {timeline.length === 0 ? (
              <p className="muted">No events yet.</p>
            ) : (
              <ol className="timeline">
                {timeline.map(e => (
                  <TimelineRow key={String(e.id)} event={e} />
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Agent trace">
            {trace.length === 0 ? (
              <p className="muted">The agent hasn't run yet.</p>
            ) : (
              <ol className="trace">
                {trace.slice(0, 8).map(s => (
                  <li key={String(s.id)}>
                    <span className="muted">{clock(s.ts)}</span> <code>{s.workflow}</code> {s.tool && <code>{s.tool}</code>} {s.summary}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <div className="handoff">
            {/* One report per incident: disabled while it's being written and once it's ready. */}
            <button
              className="handoff__button"
              onClick={generate}
              disabled={!isActive || !incident || report?.status === 'requested' || report?.status === 'ready'}
            >
              Generate Handoff
            </button>
            <span className="muted">
              {report?.status === 'requested' && 'Requested · waiting for the agent'}
              {report?.status === 'ready' && `Report ready ${report.readyAt ? clock(report.readyAt) : ''}`}
              {report?.status === 'failed' && 'Report failed'}
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}

function sensorNote(v: Vitals | undefined, fresh: boolean): string | undefined {
  if (!v || !fresh) return 'relay offline';
  if (v.status !== 'pulse') return v.status;
  return undefined;
}

function Tile(props: {
  label: string;
  unit: string;
  value: number | undefined;
  digits?: number;
  note?: string;
  alarm?: boolean;
  simulated?: boolean;
}) {
  const { label, unit, value, digits = 0, note, alarm, simulated } = props;
  return (
    <div className={`tile ${alarm ? 'tile--alarm' : ''}`}>
      <div className="tile__label">
        {label}
        {simulated && value !== undefined && <span className="tag tag--sim">SIMULATED</span>}
      </div>
      <div className="tile__value">
        {value !== undefined ? (
          <>
            {value.toFixed(digits)}
            <span className="tile__unit">{unit}</span>
          </>
        ) : (
          <span className="tile__nodata">no data</span>
        )}
      </div>
      {note && <div className="tile__note">{note}</div>}
    </div>
  );
}

function TimerTile({ label, timer, now, demo }: { label: string; timer?: Timer; now: number; demo?: boolean }) {
  const remaining = timer ? (tsMs(timer.dueAt) - now) / 1000 : undefined;
  const due = timer && (timer.state === 'due' || (remaining !== undefined && remaining <= 0));
  return (
    <div className={`tile ${due ? 'tile--alarm' : ''}`}>
      <div className="tile__label">
        {label}
        {demo && timer && <span className="tag tag--demo">DEMO TIMING</span>}
      </div>
      <div className="tile__value">
        {!timer ? <span className="tile__nodata">—</span> : due ? 'DUE' : mmss(remaining ?? 0)}
      </div>
    </div>
  );
}

function Panel(props: { title: string; badge?: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <div className={`panel ${props.grow ? 'panel--grow' : ''}`}>
      <h2 className="panel__title">
        {props.title}
        {props.badge && <span className="tag">{props.badge}</span>}
      </h2>
      <div className="panel__body">{props.children}</div>
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  return (
    <li className={`timeline__row timeline__row--${event.status}`}>
      <span className="timeline__time">{clock(event.ts)}</span>
      <span className="timeline__label">
        {event.status === 'flagged' && <span className="tag tag--alarm">FLAG</span>}
        {event.label}
      </span>
      <span className="timeline__chips">
        {event.sources.map((s, i) => (
          <span key={i} className="chip" title={`${clock(s.ts)} · ${s.detail}`}>
            {s.kind}
          </span>
        ))}
      </span>
    </li>
  );
}
