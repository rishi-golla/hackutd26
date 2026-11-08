// Hospital dashboard (hospital lane, spec §14 H1–H5, H7, H9). One action: Generate Handoff.
// Honesty rules: a missing or stale reading shows "no data"; SpO₂ is experimental; simulated data says so.
//
// Layout, in the order the ER needs it:
//   header (who, where, status, ETA, Generate Handoff) → comms strip (pre-arrival alert, what the bodycam said)
//   → patient band (allergy first) → vitals (CPR first during an arrest) + timeline | live video thumbnail + trace
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, type DbConnection } from '../../module_bindings';
import type {
  AgentStep,
  CprState,
  Event as TimelineEvent,
  Incident,
  PatientRecord,
  Timer,
  Vitals,
} from '../../module_bindings/types';
import { clock, tsMs } from '../../db/time';
import LiveVideo from './LiveVideo';
import ReportView from './ReportView';
import './hospital.css';

const VITALS_STALE_MS = 5000;
const CPR_STALE_MS = 3000;
const CALLOUT_FRESH_MS = 8000;
const REPORT_SLOW_MS = 30000;
const RECORD_SLOW_MS = 15000;
const TREND_MS = 5 * 60_000;
const PULSE_MS = 6000;
const ROW_NEW_MS = 2400;

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

  const [incidents] = useTable(tables.incident);
  const [hospitals] = useTable(tables.hospital);
  const [vitalsRows] = useTable(tables.vitals);
  const [waveRows] = useTable(tables.waveform);
  const [cprRows] = useTable(tables.cprState);
  const [events] = useTable(tables.event);
  const [timers] = useTable(tables.timer);
  const [callouts] = useTable(tables.callout);
  const [messages] = useTable(tables.erMessage);
  const [steps] = useTable(tables.agentStep);
  const [records] = useTable(tables.patientRecord);
  const [reports] = useTable(tables.report);

  // The newest incident, closed or not, so the dashboard still shows a finished run.
  const incident: Incident | undefined = useMemo(() => [...incidents].sort(byNewest)[0], [incidents]);
  const incId = incident?.id;
  const destination = hospitals.find(h => h.id === incident?.destinationId);
  const record = records.find(r => r.incidentId === incId);
  const report = reports.find(r => r.incidentId === incId);
  const alert = [...messages]
    // The agent's "Handoff report ready" summary (E4) is not the pre-arrival alert.
    .filter(m => m.incidentId === incId && m.direction === 'to_er' && !m.text.startsWith('Handoff report ready'))
    .sort(byNewest)[0];
  const timeline = [...events].filter(e => e.incidentId === incId).sort(byNewest);
  // Trace reads top to bottom, oldest first, like the workflow ran.
  const trace = [...steps].filter(s => s.incidentId === incId).sort((a, b) => -byNewest(a, b));
  const lastCallout = [...callouts].filter(c => c.incidentId === incId && c.spokenAt !== undefined).sort(byNewest)[0];
  const calloutAge = lastCallout?.spokenAt ? now - tsMs(lastCallout.spokenAt) : undefined;

  const latestVitals: Vitals | undefined = [...vitalsRows].sort(byNewest)[0];
  const vitalsFresh = latestVitals !== undefined && now - tsMs(latestVitals.ts) < VITALS_STALE_MS;
  const inArrest = incident?.status === 'arrest';
  // H3: 5-minute trend lines and the pulse waveform (the table keeps 30 s of it; we draw the last 6 s).
  // This incident's rows only, and nothing at all while the live numbers are stale.
  const vitalsHistory = vitalsFresh
    ? [...vitalsRows].filter(r => r.incidentId === incId && now - tsMs(r.ts) < TREND_MS).sort((a, b) => -byNewest(a, b))
    : [];
  const pulse = vitalsFresh
    ? [...waveRows]
        .filter(w => w.incidentId === incId && now - tsMs(w.ts) < PULSE_MS)
        .sort((a, b) => -byNewest(a, b))
        .flatMap(w => w.samples)
    : [];
  // SpO₂ is hidden during an arrest, so its trend must not bring those readings back after ROSC.
  const arrests = arrestWindows(timeline);

  const cpr = cprRows.find(c => c.incidentId === incId);
  const cprFresh = cpr !== undefined && (cpr.source === 'override' || now - tsMs(cpr.updatedAt) < CPR_STALE_MS);

  const running = (kind: string): Timer | undefined =>
    timers.find(t => t.incidentId === incId && t.kind === kind && t.state !== 'cancelled');

  const elapsed = incident ? (now - tsMs(incident.startedAt)) / 1000 : 0;
  const reportReady = report?.status === 'ready' && !!report.contentJson;
  const writing = report?.status === 'requested';

  const toggleVideo = () => withViewTransition(() => setVideoExpanded(v => !v));
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

  // During an arrest, CPR and the timers are what matter; otherwise the vitals. The lead row gets the big numbers.
  const vitals = (
    <VitalsRow
      key="vitals"
      lead={!inArrest}
      v={vitalsFresh ? latestVitals : undefined}
      history={vitalsHistory}
      pulse={pulse}
      arrests={arrests}
      now={now}
      stale={!vitalsFresh}
      lastStatus={latestVitals?.status}
      inArrest={inArrest}
    />
  );
  const resus = (
    <ResusRow
      key="resus"
      lead={inArrest}
      cpr={cprFresh ? cpr : undefined}
      inArrest={inArrest}
      epi={running('epi')}
      cycle={running('cycle')}
      now={now}
      demo={incident?.demoMode ?? false}
    />
  );

  return (
    <div className="hd">
      <header className="hd__header">
        <div className="hd__route">
          <strong>{incident?.unit ?? 'No unit'}</strong>
          <span className="hd__arrow" aria-hidden="true">→</span>
          <strong className={destination ? '' : 'muted'}>{destination?.name ?? 'Destination not set'}</strong>
        </div>
        <span className={`hd__status hd__status--${incident?.status ?? 'none'}`}>
          {incident ? STATUS_TEXT[incident.status] ?? incident.status : 'No incident'}
          {incident && incident.status !== 'closed' && <span className="hd__elapsed">{mmss(elapsed)}</span>}
        </span>
        <Eta incident={incident} now={now} />
        {incident?.demoMode && <span className="note note--caution">Demo timing</span>}
        <span className="hd__spacer" />
        <span className="note">Prototype · synthetic data</span>
        {/* Only a problem is worth showing; a working connection is the normal case. */}
        {!isActive && (
          <span className="hd__conn" role="status">
            Connecting to the database…
          </span>
        )}
        <div className="handoff">
          <span className={`handoff__status${report?.status === 'failed' ? ' handoff__status--failed' : ''}`} role="status">
            {reportReady && `Report ready ${report.readyAt ? clock(report.readyAt).slice(0, 5) : ''}`}
            {report?.status === 'failed' && 'Report failed. Try again.'}
            {/* H7 promises a report within 30 s; past that, say so rather than look busy forever. */}
            {writing && now - tsMs(report.requestedAt) > REPORT_SLOW_MS && 'No reply from the agent yet'}
          </span>
          <button
            type="button"
            className="handoff__button"
            onClick={generate}
            aria-busy={writing}
            // One report per incident: disabled while it's being written and once it's ready.
            disabled={!isActive || !incident || writing || reportReady}
          >
            {writing ? 'Writing report…' : 'Generate Handoff'}
          </button>
        </div>
      </header>

      <section className="comms" aria-label="Messages">
        <div className="comms__item comms__item--alert">
          <span className="comms__label">Pre-arrival alert</span>
          {alert ? (
            <p className="comms__text comms__text--clamp" title={alert.text}>
              <span className="comms__time">{clock(alert.ts)}</span> {alert.text}
            </p>
          ) : (
            <p className="comms__text muted">No alert yet. The agent posts one at arrest or transport.</p>
          )}
        </div>
        <div className={`comms__item comms__item--voice${calloutAge !== undefined && calloutAge < CALLOUT_FRESH_MS ? ' is-fresh' : ''}`}>
          <span className="comms__label">Bodycam said</span>
          {calloutAge !== undefined && calloutAge < CALLOUT_FRESH_MS && (
            // Drains over the time the callout counts as fresh; a page opened mid-way starts part-drained.
            <span key={String(lastCallout?.id)} className="comms__drain" style={{ animationDelay: `-${calloutAge}ms` }} aria-hidden="true" />
          )}
          {lastCallout?.spokenAt ? (
            <p className="comms__text comms__text--voice" role="status">
              “{lastCallout.text}”
              <span className="comms__time"> {Math.max(0, Math.round((now - tsMs(lastCallout.spokenAt)) / 1000))} s ago</span>
            </p>
          ) : (
            <p className="comms__text muted">Nothing spoken yet.</p>
          )}
        </div>
      </section>

      <PatientBand record={record} patientRef={incident?.patientRef} />

      <main className="hd__grid">
        <section className="hd__main" aria-label={reportReady ? 'Handoff report' : 'Vitals and timeline'}>
          {reportReady ? (
            <ReportView contentJson={report.contentJson} />
          ) : (
            <>
              {inArrest ? [resus, vitals] : [vitals, resus]}
              <Panel title="Timeline" grow>
                {timeline.length === 0 ? (
                  <p className="muted">No events yet.</p>
                ) : (
                  <ol className="timeline">
                    {timeline.map(e => (
                      <TimelineRow key={String(e.id)} event={e} isNew={now - tsMs(e.ts) < ROW_NEW_MS} />
                    ))}
                  </ol>
                )}
              </Panel>
            </>
          )}
        </section>

        <aside className="hd__side" aria-label="Live video and agent">
          <div className="video-slot">
            {videoExpanded && <span className="video-slot__note">Showing large · Esc to minimize</span>}
            <LiveVideo expanded={videoExpanded} onToggle={toggleVideo} />
          </div>
          <Panel title="Agent trace" grow>
            <Trace steps={trace} />
          </Panel>
        </aside>
      </main>

      {videoExpanded && <div className="video-backdrop" onClick={toggleVideo} aria-hidden="true" />}
    </div>
  );
}

function Eta({ incident, now }: { incident?: Incident; now: number }) {
  if (incident?.status === 'arrived' || incident?.status === 'closed') return null; // no ETA once there
  if (!incident?.etaAt) return <span className="hd__eta muted">ETA —</span>;
  const minutes = Math.max(0, Math.ceil((tsMs(incident.etaAt) - now) / 60000));
  return (
    <span className="hd__eta">
      ETA <strong>{minutes} min</strong>
      <span className="muted"> · arrives {clock(incident.etaAt).slice(0, 5)}</span>
    </span>
  );
}

function PatientBand({ record, patientRef }: { record?: PatientRecord; patientRef?: string }) {
  // The skeleton gives way to plain text if the record doesn't come (EHR down and no cached copy, §23).
  const [slow, setSlow] = useState(false);
  const waiting = !record && !!patientRef;
  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const id = setTimeout(() => setSlow(true), RECORD_SLOW_MS);
    return () => clearTimeout(id);
  }, [waiting, patientRef]);

  if (waiting && slow) {
    return (
      <section className="patient" aria-label="Patient">
        <span className="patient__name muted">Identified as {patientRef} · record not available yet</span>
      </section>
    );
  }
  if (waiting) {
    // Identified, record on its way: a skeleton in the band's shape.
    return (
      <section className="patient" aria-label="Patient" aria-busy="true">
        <div className="patient__who">
          <span className="skeleton skeleton--name" />
          <span className="patient__meta">Identified as {patientRef} · pulling the record</span>
        </div>
        <span className="skeleton" style={{ width: 160 }} />
        <span className="skeleton" style={{ width: 200 }} />
        <span className="skeleton" style={{ width: 200 }} />
      </section>
    );
  }
  if (!record) {
    return (
      <section className="patient" aria-label="Patient">
        <span className="patient__name muted">Patient not identified yet</span>
      </section>
    );
  }
  const age = ageOn(record.birthDate);
  return (
    <section className="patient" aria-label="Patient record">
      <div className="patient__who">
        <span className="patient__name">
          {record.name}
          {age !== undefined && <span className="patient__age">, {age}</span>}
        </span>
        <span className="patient__meta">
          born {record.birthDate} · {record.patientRef}
        </span>
      </div>
      <div className={`patient__allergy${record.allergies.length ? ' has-allergy' : ''}`}>
        {/* The icon says "allergy" without relying on red alone. */}
        {record.allergies.length > 0 && <AlertIcon />}
        <div>
          <span className="patient__label">Allergies</span>
          <strong>{record.allergies.length ? record.allergies.join(', ') : 'None recorded'}</strong>
        </div>
      </div>
      <Fact label="Medications" value={record.medications.join(', ') || 'None recorded'} />
      <Fact label="History" value={record.conditions.join(', ') || 'None recorded'} />
      <Fact label="Code status" value={record.codeStatus || 'Not recorded'} />
      <span className={`note patient__source${record.source === 'cached' ? ' note--caution' : ''}`}>
        {record.source === 'cached' ? 'Cached copy' : 'From EHR'}
      </span>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="patient__fact">
      <span className="patient__label">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function VitalsRow(props: {
  lead: boolean;
  v?: Vitals;
  history: Vitals[];
  pulse: number[];
  arrests: [number, number][];
  now: number;
  stale: boolean;
  lastStatus?: string;
  inArrest: boolean;
}) {
  const { lead, v, history, pulse, arrests, now, stale, lastStatus, inArrest } = props;
  const note = stale ? 'relay offline' : lastStatus !== 'pulse' ? lastStatus : undefined;
  const hr = inArrest ? undefined : v?.hr;
  const spo2 = inArrest ? undefined : v?.spo2;
  const hrAlarm = hr !== undefined && (hr < 50 || hr > 150);
  const spo2Alarm = spo2 !== undefined && spo2 < 90;
  // Lines only beside a number we show: none when stale, none for HR/SpO₂ during an arrest.
  // A row with no reading stays in as a gap, so the line breaks instead of bridging it.
  const series = (pick: (r: Vitals) => number | undefined, hide: [number, number][] = []): Point[] =>
    history.map(r => {
      const t = tsMs(r.ts);
      return { t, v: hide.some(([a, b]) => t >= a && t < b) ? undefined : pick(r) };
    });
  return (
    <div className={`tiles${lead ? ' tiles--lead' : ''}`} role="group" aria-label="Vitals">
      <Tile
        label="Heart rate"
        unit="bpm"
        value={hr}
        alarm={hrAlarm}
        note={inArrest ? 'no pulse expected during CPR' : note}
        simulated={v?.simulated}
        viz={hr !== undefined && pulse.length > 1 && <Pulse samples={pulse} alarm={hrAlarm} />}
      />
      <Tile
        label="SpO₂ · experimental"
        unit="%"
        value={spo2}
        alarm={spo2Alarm}
        note={inArrest ? 'hidden during arrest' : note}
        simulated={v?.simulated}
        viz={spo2 !== undefined && <Trend points={series(r => r.spo2, arrests)} now={now} alarm={spo2Alarm} label="SpO₂" />}
      />
      <Tile
        label="Temperature"
        unit="°C"
        digits={1}
        value={v?.tempC}
        note={stale ? 'relay offline' : undefined}
        simulated={v?.simulated}
        viz={v?.tempC !== undefined && <Trend points={series(r => r.tempC)} now={now} label="Temperature" />}
      />
    </div>
  );
}

function ResusRow(props: {
  lead: boolean;
  cpr?: CprState;
  inArrest: boolean;
  epi?: Timer;
  cycle?: Timer;
  now: number;
  demo: boolean;
}) {
  const { lead, cpr, inArrest, epi, cycle, now, demo } = props;
  const rate = inArrest && cpr?.compressing ? cpr.rate : undefined;
  const rateAlarm = rate !== undefined && (rate < 100 || rate > 120);
  return (
    <div className={`tiles${lead ? ' tiles--lead' : ''}`} role="group" aria-label="Resuscitation">
      <Tile
        label="CPR rate · target 100–120"
        unit="/min"
        value={rate}
        alarm={rateAlarm}
        simulated={cpr?.source === 'override'}
        note={
          !inArrest
            ? 'not in arrest'
            : !cpr
              ? 'no data from bodycam'
              : `${cpr.count - cpr.countBase} compressions · pause ${cpr.compressing ? 0 : Math.round(cpr.sinceLastS)} s`
        }
        viz={inArrest && <CprBand rate={rate} alarm={rateAlarm} />}
      />
      <TimerTile label="Next epi" kind="epi" timer={epi} now={now} demo={demo} />
      <TimerTile label="CPR cycle" kind="cycle" timer={cycle} now={now} demo={demo} />
    </div>
  );
}

function Tile(props: {
  label: string;
  unit: string;
  value: number | undefined;
  digits?: number;
  note?: string;
  alarm?: boolean;
  simulated?: boolean;
  viz?: React.ReactNode;
}) {
  const { label, unit, value, digits = 0, note, alarm, simulated, viz } = props;
  return (
    <div className={`tile${alarm ? ' tile--alarm' : ''}`}>
      <div className="tile__label">
        {label}
        {simulated && value !== undefined && <span className="note note--caution">Simulated</span>}
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
      <div className="tile__note">{note ?? '\u00a0'}</div>
      {viz && <div className="tile__viz">{viz}</div>}
    </div>
  );
}

/** Full interval per timer, to draw how much is left. Mirrors spacetime/src/helpers.ts (epi 4 min, cycle 2 min; demo 45 s / 30 s). */
const TIMER_S: Record<string, { normal: number; demo: number }> = {
  epi: { normal: 240, demo: 45 },
  cycle: { normal: 120, demo: 30 },
};

function TimerTile(props: { label: string; kind: string; timer?: Timer; now: number; demo: boolean }) {
  const { label, kind, timer, now, demo } = props;
  const remaining = timer ? (tsMs(timer.dueAt) - now) / 1000 : undefined;
  const due = !!timer && (timer.state === 'due' || (remaining !== undefined && remaining <= 0));
  const total = demo ? TIMER_S[kind].demo : TIMER_S[kind].normal;
  const left = due || remaining === undefined ? 0 : Math.min(1, remaining / total);
  return (
    <div className={`tile${due ? ' tile--alarm' : ''}`}>
      <div className="tile__label">
        {label}
        {demo && timer && <span className="note note--caution">Demo timing</span>}
      </div>
      <div className="tile__body">
        <div className="tile__value">{!timer ? <span className="tile__nodata">—</span> : due ? 'Due' : mmss(remaining ?? 0)}</div>
        {timer && <Ring left={due ? 1 : left} due={due} />}
      </div>
      <div className="tile__note">{!timer ? 'not running' : due ? 'due now' : 'remaining'}</div>
    </div>
  );
}

type Point = { t: number; v: number | undefined };
const TREND_GAP_MS = 5000; // rows come ~1/s; a longer silence is a break in the line, not a slope

/** Line segments (x 0–100) scaled to their own min–max. `pulse` draws the live waveform brighter than a trend. */
function Sparkline(props: { segments: { x: number; v: number }[][]; alarm?: boolean; pulse?: boolean; label: string }) {
  const { segments, alarm, pulse, label } = props;
  const values = segments.flat().map(p => p.v);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  return (
    <svg
      className={`spark${pulse ? ' spark--pulse' : ''}${alarm ? ' spark--alarm' : ''}`}
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {segments.map((seg, i) => (
        <polyline
          key={i}
          points={seg.map(p => `${p.x.toFixed(2)},${(22 - ((p.v - min) / span) * 20).toFixed(2)}`).join(' ')}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/** The live pulse waveform: contiguous samples, evenly spaced. */
function Pulse({ samples, alarm }: { samples: number[]; alarm: boolean }) {
  const seg = samples.map((v, i) => ({ x: (i / (samples.length - 1)) * 100, v }));
  return <Sparkline segments={[seg]} pulse alarm={alarm} label="Pulse waveform, last 6 s" />;
}

/** 5-minute trend (H3) on a real time axis, broken where readings are missing, with its range as a caption. */
function Trend({ points, now, alarm, label }: { points: Point[]; now: number; alarm?: boolean; label: string }) {
  const segments: { x: number; v: number }[][] = [];
  let last = -Infinity;
  for (const p of points) {
    if (p.v === undefined) {
      last = -Infinity;
      continue;
    }
    if (p.t - last > TREND_GAP_MS) segments.push([]);
    segments[segments.length - 1].push({ x: (1 - (now - p.t) / TREND_MS) * 100, v: p.v });
    last = p.t;
  }
  const values = segments.flat().map(p => p.v);
  if (values.length < 2) return null;
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  return (
    <>
      <Sparkline segments={segments} alarm={alarm} label={`${label}, last 5 min`} />
      <div className="spark__caption">
        <span>5 min</span>
        <span>
          {fmt(Math.min(...values))}–{fmt(Math.max(...values))}
        </span>
      </div>
    </>
  );
}

/** [start, end) of each arrest, from the status events; an arrest still running ends at +∞. */
function arrestWindows(events: TimelineEvent[]): [number, number][] {
  const windows: [number, number][] = [];
  let open: number | undefined;
  for (const e of [...events].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!e.kind.startsWith('status_')) continue;
    const t = tsMs(e.ts);
    if (e.kind === 'status_arrest') open ??= t;
    else if (open !== undefined) {
      windows.push([open, t]);
      open = undefined;
    }
  }
  if (open !== undefined) windows.push([open, Infinity]);
  return windows;
}

const BAND_MIN = 60;
const BAND_MAX = 160;
const bandPct = (x: number) => `${(Math.min(1, Math.max(0, (x - BAND_MIN) / (BAND_MAX - BAND_MIN))) * 100).toFixed(1)}%`;

/** CPR rate on a 60–160 scale with the 100–120 target band: where the medic is, at a glance. */
function CprBand({ rate, alarm }: { rate?: number; alarm: boolean }) {
  return (
    <div role="img" aria-label={rate !== undefined ? `CPR rate ${Math.round(rate)} per minute, target 100 to 120` : 'CPR target 100 to 120 per minute'}>
      <div className="band">
        <span className="band__target" style={{ left: bandPct(100), width: `${(20 / (BAND_MAX - BAND_MIN)) * 100}%` }} />
        {rate !== undefined && <span className={`band__marker${alarm ? ' is-alarm' : ''}`} style={{ left: bandPct(rate) }} />}
      </div>
      <div className="band__ticks" aria-hidden="true">
        <span style={{ left: bandPct(100) }}>100</span>
        <span style={{ left: bandPct(120) }}>120</span>
      </div>
    </div>
  );
}

/** How much of the interval is left, as a ring that drains. */
function Ring({ left, due }: { left: number; due: boolean }) {
  const c = 2 * Math.PI * 18;
  return (
    <svg className={`ring${due ? ' ring--due' : ''}`} viewBox="0 0 44 44" aria-hidden="true">
      <circle className="ring__track" cx="22" cy="22" r="18" />
      <circle className="ring__fill" cx="22" cy="22" r="18" strokeDasharray={c} strokeDashoffset={c * (1 - left)} />
    </svg>
  );
}

function Panel(props: { title: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <section className={`panel${props.grow ? ' panel--grow' : ''}`}>
      <h2 className="panel__title">{props.title}</h2>
      <div className="panel__body">{props.children}</div>
    </section>
  );
}

function TimelineRow({ event, isNew }: { event: TimelineEvent; isNew: boolean }) {
  return (
    <li className={`timeline__row timeline__row--${event.status}${isNew ? ' is-new' : ''}`}>
      <span className="timeline__time">{clock(event.ts)}</span>
      <span className="timeline__label">
        {event.status === 'flagged' && <span className="timeline__flag">Flagged</span>}
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

function Trace({ steps }: { steps: AgentStep[] }) {
  // Chronological, and it follows the newest step so W4 stays in view at the Generate Handoff beat.
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [steps.length]);
  if (steps.length === 0) return <p className="muted">The agent hasn't run yet.</p>;
  return (
    <ol className="trace">
      {steps.map(s => (
        <li key={String(s.id)}>
          <span className="trace__time">{clock(s.ts)}</span>
          <span>
            <span className="trace__step">{s.workflow}</span>
            {s.tool && <code className="trace__tool">{s.tool}</code>}
            {s.summary}
          </span>
        </li>
      ))}
      <li ref={end} className="trace__end" aria-hidden="true" />
    </ol>
  );
}

/** Lucide "triangle-alert" (ISC), the one icon set used on this page. */
function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
