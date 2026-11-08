// Hospital dashboard (hospital lane, spec §14 H1–H7, H9). One action: Generate Handoff.
// Honesty rules: a missing or stale reading shows "no data"; SpO₂ is experimental; simulated data says so.
//
// One screen, one focal point. Left: the status and the one number that matters now (CPR during an arrest,
// heart rate otherwise), then one activity feed (timeline + agent steps + pre-arrival alert).
// Right, a dark band: the live video, what the bodycam just said, and the patient in three lines.
// Look: teenage engineering's "industrial catalogue" (Refero Styles), adapted: ruled bands, zero radius,
// one font, red only for alarm, the amber triangle only for honesty notes.
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, type DbConnection } from '../../module_bindings';
import type { CprState, Event as TimelineEvent, Incident, PatientRecord, Timer, Vitals } from '../../module_bindings/types';
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
const TREND_GAP_MS = 5000; // rows come ~1/s; a longer silence is a break in the line, not a slope
const PULSE_MS = 6000;
const ROW_NEW_MS = 2000;

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
const byOldest = <T extends { id: bigint }>(a: T, b: T) => -byNewest(a, b);

/** Expand or minimize with a view transition where the browser has one (the thumbnail morphs into place). */
function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === 'function') doc.startViewTransition(() => flushSync(update));
  else update();
}

/** One line of the activity feed: a timeline event, an agent step or a message to the ER. */
type Item = {
  key: string;
  t: number;
  who?: string;
  text: string;
  chips: { label: string; title: string }[];
  tone?: 'flagged' | 'cancelled' | 'alert';
};

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
  const timeline = [...events].filter(e => e.incidentId === incId).sort(byNewest);
  const lastCallout = [...callouts].filter(c => c.incidentId === incId && c.spokenAt !== undefined).sort(byNewest)[0];

  // H4 + H5 + H6 in one feed, newest first: events, the agent's steps, and what it told the ER.
  const feed: Item[] = [
    ...timeline.map(e => ({
      key: `e${e.id}`,
      t: tsMs(e.ts),
      text: e.label,
      chips: e.sources.map(s => ({ label: s.kind, title: `${clock(s.ts)} · ${s.detail}` })),
      tone: e.status === 'flagged' ? ('flagged' as const) : e.status === 'cancelled' ? ('cancelled' as const) : undefined,
    })),
    ...steps
      .filter(s => s.incidentId === incId)
      .map(s => ({ key: `s${s.id}`, t: tsMs(s.ts), who: `agent ${s.workflow}`, text: s.tool ? `${s.tool} · ${s.summary}` : s.summary, chips: [] })),
    ...messages
      // The agent's "Handoff report ready" summary (E4) is not the pre-arrival alert.
      .filter(m => m.incidentId === incId && m.direction === 'to_er' && !m.text.startsWith('Handoff report ready'))
      .map(m => ({ key: `m${m.id}`, t: tsMs(m.ts), who: 'alert to ER', text: m.text, chips: [], tone: 'alert' as const })),
  ].sort((a, b) => b.t - a.t);

  const latestVitals: Vitals | undefined = [...vitalsRows].sort(byNewest)[0];
  const vitalsFresh = latestVitals !== undefined && now - tsMs(latestVitals.ts) < VITALS_STALE_MS;
  const v = vitalsFresh ? latestVitals : undefined;
  const inArrest = incident?.status === 'arrest';
  // H3: trends and the pulse waveform, this incident only, nothing while the live numbers are stale.
  const history = vitalsFresh
    ? [...vitalsRows].filter(r => r.incidentId === incId && now - tsMs(r.ts) < TREND_MS).sort(byOldest)
    : [];
  const pulse = vitalsFresh
    ? [...waveRows]
        .filter(w => w.incidentId === incId && now - tsMs(w.ts) < PULSE_MS)
        .sort(byOldest)
        .flatMap(w => w.samples)
    : [];

  const cpr = cprRows.find(c => c.incidentId === incId);
  const cprFresh = cpr !== undefined && (cpr.source === 'override' || now - tsMs(cpr.updatedAt) < CPR_STALE_MS);
  const running = (kind: string): Timer | undefined =>
    timers.find(t => t.incidentId === incId && t.kind === kind && t.state !== 'cancelled');

  const elapsed = incident ? (now - tsMs(incident.startedAt)) / 1000 : 0;
  const reportReady = report?.status === 'ready' && !!report.contentJson;
  const writing = report?.status === 'requested';

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

  const calloutAge = lastCallout?.spokenAt ? now - tsMs(lastCallout.spokenAt) : undefined;
  const statusLine = (
    <div className={`status status--${incident?.status ?? 'none'}`}>
      <span className="status__word">{incident ? STATUS_TEXT[incident.status] ?? incident.status : 'No incident'}</span>
      {incident && incident.status !== 'closed' && <span className="status__clock">{mmss(elapsed)}</span>}
    </div>
  );
  const demo = incident?.demoMode ?? false;

  return (
    <div className="hd">
      <header className="hd__header">
        <div className="hd__route">
          {incident?.unit ?? 'No unit'}
          <span className="hd__arrow" aria-hidden="true">→</span>
          <span className={destination ? '' : 'muted'}>{destination?.name ?? 'destination not set'}</span>
        </div>
        <Eta incident={incident} now={now} />
        <span className="hd__spacer" />
        <span className="hd__note">prototype · synthetic data</span>
        {/* Only a problem is worth showing; a working connection is the normal case. */}
        {!isActive && (
          <span className="hd__conn" role="status">
            connecting to the database…
          </span>
        )}
        <span className={`hd__report${report?.status === 'failed' ? ' is-failed' : ''}`} role="status">
          {reportReady && `report ready ${report.readyAt ? clock(report.readyAt).slice(0, 5) : ''}`}
          {report?.status === 'failed' && 'report failed, try again'}
          {/* H7 promises a report within 30 s; past that, say so rather than look busy forever. */}
          {writing && now - tsMs(report.requestedAt) > REPORT_SLOW_MS && 'no reply from the agent yet'}
        </span>
        <button
          type="button"
          className="hd__action"
          onClick={generate}
          aria-busy={writing}
          // One report per incident: disabled while it's being written and once it's ready.
          disabled={!isActive || !incident || writing || reportReady}
        >
          {writing ? 'Writing report…' : 'Generate Handoff'}
        </button>
      </header>

      <main className="hd__main" aria-label={reportReady ? 'Handoff report' : 'Status and activity'}>
        {reportReady ? (
          <>
            {/* H1: the status stays on screen while the report has the left side. */}
            <section className="hero hero--slim" aria-label="Status">
              {statusLine}
            </section>
            <ReportView contentJson={report.contentJson} />
          </>
        ) : (
          <>
            <section className="hero" aria-label="Status">
              {statusLine}
              {inArrest ? (
                <ArrestHero
                  cpr={cprFresh ? cpr : undefined}
                  epi={running('epi')}
                  cycle={running('cycle')}
                  now={now}
                  v={v}
                  demo={demo}
                />
              ) : (
                <VitalsHero
                  v={v}
                  stale={!vitalsFresh}
                  lastStatus={latestVitals?.status}
                  history={history}
                  pulse={pulse}
                  arrests={arrestWindows(timeline)}
                  now={now}
                />
              )}
            </section>
            <section className="feed" aria-label="Activity">
              <h2 className="label">activity</h2>
              {feed.length === 0 ? (
                <p className="muted feed__empty">Nothing yet. Events, agent steps and the pre-arrival alert land here.</p>
              ) : (
                <ol className="feed__list">
                  {feed.map(item => (
                    <FeedRow key={item.key} item={item} isNew={now - item.t < ROW_NEW_MS} />
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </main>

      <aside className="band" aria-label="Live video, bodycam and patient">
        <div className="video-slot">
          {videoExpanded && <span className="video-slot__note">showing large · Esc to minimize</span>}
          <LiveVideo expanded={videoExpanded} onToggle={toggleVideo} />
        </div>
        <section className={`said${calloutAge !== undefined && calloutAge < CALLOUT_FRESH_MS ? ' is-fresh' : ''}`} aria-label="Bodycam said">
          <h2 className="label">
            bodycam said{calloutAge !== undefined && ` · ${Math.max(0, Math.round(calloutAge / 1000))} s ago`}
          </h2>
          {lastCallout ? (
            <p className="said__text" role="status">
              “{lastCallout.text}”
            </p>
          ) : (
            <p className="said__text said__text--empty">Nothing spoken yet.</p>
          )}
        </section>
        <PatientPanel record={record} patientRef={incident?.patientRef} />
      </aside>

      {videoExpanded && <div className="video-backdrop" onClick={toggleVideo} aria-hidden="true" />}
    </div>
  );
}

function Eta({ incident, now }: { incident?: Incident; now: number }) {
  if (incident?.status === 'arrived' || incident?.status === 'closed') return null; // no ETA once there
  if (!incident?.etaAt) return <span className="hd__eta muted">eta —</span>;
  const minutes = Math.max(0, Math.ceil((tsMs(incident.etaAt) - now) / 60000));
  return (
    <span className="hd__eta">
      eta <strong>{minutes} min</strong>
      <span className="muted"> · arrives {clock(incident.etaAt).slice(0, 5)}</span>
    </span>
  );
}

/** A missing reading: a full-size grey dash, like a bedside monitor; the note under it says "no data". */
function Dash() {
  return (
    <span className="dash" aria-label="no data">
      —
    </span>
  );
}

function NoDataNote({ note }: { note?: string }) {
  return <span className="readout__note">no data{note ? ` · ${note}` : ''}</span>;
}

/** The amber triangle: the one honesty mark (simulated, demo timing, cached, experimental). */
function Caution({ children }: { children: React.ReactNode }) {
  return (
    <span className="caution">
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 22 20H2Z" fill="currentColor" />
      </svg>
      {children}
    </span>
  );
}

function TimerReadout({ label, timer, now, demo }: { label: string; timer?: Timer; now: number; demo: boolean }) {
  const remaining = timer ? (tsMs(timer.dueAt) - now) / 1000 : undefined;
  const due = !!timer && (timer.state === 'due' || (remaining !== undefined && remaining <= 0));
  return (
    <div className={`readout${due ? ' is-alarm' : ''}`}>
      <span className="label">
        {label}
        {/* D5: every demo timer says so. */}
        {demo && timer && <Caution>demo timing</Caution>}
      </span>
      <span className="readout__value">{!timer ? <Dash /> : due ? 'Due' : mmss(remaining ?? 0)}</span>
      <span className="readout__note">{!timer ? 'not running' : due ? 'due now' : 'remaining'}</span>
    </div>
  );
}

/** During an arrest: CPR rate is the focal number, then the two timers, then one line for everything else. */
function ArrestHero(props: { cpr?: CprState; epi?: Timer; cycle?: Timer; now: number; v?: Vitals; demo: boolean }) {
  const { cpr, epi, cycle, now, v, demo } = props;
  const rate = cpr?.compressing ? cpr.rate : undefined;
  const alarm = rate !== undefined && (rate < 100 || rate > 120);
  return (
    <>
      <div className="hero__grid">
        <div className={`focal${alarm ? ' is-alarm' : ''}`}>
          <div className="focal__label">
            <span className="label">cpr rate · target 100–120 /min</span>
            {cpr?.source === 'override' && <Caution>simulated</Caution>}
          </div>
          <div className="focal__value">{rate !== undefined ? Math.round(rate) : <Dash />}</div>
          <CprBand rate={rate} alarm={alarm} />
          <p className="focal__note">
            {!cpr
              ? 'no data from the bodycam'
              : `${rate === undefined ? 'no data · ' : ''}${cpr.count - cpr.countBase} compressions · pause ${cpr.compressing ? 0 : Math.round(cpr.sinceLastS)} s`}
          </p>
        </div>
        <div className="readouts">
          <TimerReadout label="next epi" timer={epi} now={now} demo={demo} />
          <TimerReadout label="cpr cycle" timer={cycle} now={now} demo={demo} />
        </div>
      </div>
      <p className="aside-line">
        heart rate — no pulse expected during CPR · SpO₂ hidden during arrest · temperature{' '}
        {v?.tempC !== undefined ? `${v.tempC.toFixed(1)} °C` : 'no data'}
        {v?.simulated && v.tempC !== undefined && (
          <>
            {' '}
            <Caution>simulated</Caution>
          </>
        )}
      </p>
    </>
  );
}

/** Not in an arrest: heart rate is the focal number (with the live pulse), SpO₂ and temperature beside it. */
function VitalsHero(props: {
  v?: Vitals;
  stale: boolean;
  lastStatus?: string;
  history: Vitals[];
  pulse: number[];
  arrests: [number, number][];
  now: number;
}) {
  const { v, stale, lastStatus, history, pulse, arrests, now } = props;
  const note = stale ? 'relay offline' : lastStatus !== 'pulse' ? lastStatus : undefined;
  const hrAlarm = v?.hr !== undefined && (v.hr < 50 || v.hr > 150);
  const spo2Alarm = v?.spo2 !== undefined && v.spo2 < 90;
  // A row with no reading stays in as a gap; `hide` drops readings that were hidden live (SpO₂ in an arrest).
  const series = (pick: (r: Vitals) => number | undefined, hide: [number, number][] = []): Point[] =>
    history.map(r => {
      const t = tsMs(r.ts);
      return { t, v: hide.some(([a, b]) => t >= a && t < b) ? undefined : pick(r) };
    });
  return (
    <div className="hero__grid">
      <div className={`focal${hrAlarm ? ' is-alarm' : ''}`}>
        <div className="focal__label">
          <span className="label">heart rate /min</span>
          {v?.simulated && v.hr !== undefined && <Caution>simulated</Caution>}
        </div>
        <div className="focal__value">{v?.hr !== undefined ? Math.round(v.hr) : <Dash />}</div>
        {v?.hr !== undefined && pulse.length > 1 ? <Pulse samples={pulse} /> : <div className="pulse-slot" />}
        <p className="focal__note">{v?.hr === undefined ? `no data${note ? ` · ${note}` : ''}` : note ?? 'pulse waveform, last 6 s'}</p>
      </div>
      <div className="readouts">
        <div className={`readout${spo2Alarm ? ' is-alarm' : ''}`}>
          <span className="label">
            SpO₂ % <Caution>experimental</Caution>
          </span>
          <span className="readout__value">{v?.spo2 !== undefined ? Math.round(v.spo2) : <Dash />}</span>
          {v?.spo2 !== undefined ? <Trend points={series(r => r.spo2, arrests)} now={now} label="SpO₂" /> : <NoDataNote note={note} />}
        </div>
        <div className="readout">
          <span className="label">temperature °C</span>
          <span className="readout__value">{v?.tempC !== undefined ? v.tempC.toFixed(1) : <Dash />}</span>
          {v?.tempC !== undefined ? <Trend points={series(r => r.tempC)} now={now} label="Temperature" /> : <NoDataNote note={note} />}
        </div>
      </div>
    </div>
  );
}

type Point = { t: number; v: number | undefined };

function Line({ segments, label }: { segments: { x: number; v: number }[][]; label: string }) {
  const values = segments.flat().map(p => p.v);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  return (
    <svg className="line" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={label}>
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
function Pulse({ samples }: { samples: number[] }) {
  return <Line segments={[samples.map((v, i) => ({ x: (i / (samples.length - 1)) * 100, v }))]} label="Pulse waveform, last 6 s" />;
}

/** 5-minute trend (H3) on a real time axis, broken where readings are missing, with its range. */
function Trend({ points, now, label }: { points: Point[]; now: number; label: string }) {
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
    <span className="trend">
      <Line segments={segments} label={`${label}, last 5 min`} />
      <span className="readout__note">
        5 min · {fmt(Math.min(...values))}–{fmt(Math.max(...values))}
      </span>
    </span>
  );
}

/** [start, end) of each arrest, from the status events; an arrest still running ends at +∞. */
function arrestWindows(events: TimelineEvent[]): [number, number][] {
  const windows: [number, number][] = [];
  let open: number | undefined;
  for (const e of [...events].sort(byOldest)) {
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

/** CPR rate on a 60–160 ruler with the 100–120 target marked: where the medic is, at a glance. */
function CprBand({ rate, alarm }: { rate?: number; alarm: boolean }) {
  return (
    <div className="ruler" aria-hidden="true">
      <span className="ruler__target" style={{ left: bandPct(100), width: `${(20 / (BAND_MAX - BAND_MIN)) * 100}%` }} />
      {[60, 80, 100, 120, 140, 160].map(x => (
        <span key={x} className="ruler__tick" style={{ left: bandPct(x) }}>
          {x}
        </span>
      ))}
      {rate !== undefined && <span className={`ruler__needle${alarm ? ' is-alarm' : ''}`} style={{ left: bandPct(rate) }} />}
    </div>
  );
}

function FeedRow({ item, isNew }: { item: Item; isNew: boolean }) {
  return (
    <li className={`feed__row${item.tone ? ` is-${item.tone}` : ''}${isNew ? ' is-new' : ''}`}>
      <span className="feed__time">{new Date(item.t).toLocaleTimeString([], { hour12: false })}</span>
      <span className="feed__text">
        {item.who && <span className="feed__who">{item.who}</span>}
        {item.tone === 'flagged' && <span className="feed__flag">flagged</span>}
        {item.text}
      </span>
      <span className="feed__chips">
        {item.chips.map((c, i) => (
          <span key={i} className="chip" title={c.title}>
            {c.label}
          </span>
        ))}
      </span>
    </li>
  );
}

function PatientPanel({ record, patientRef }: { record?: PatientRecord; patientRef?: string }) {
  // The skeleton gives way to plain text if the record doesn't come (EHR down and no cached copy, §23).
  const [slow, setSlow] = useState(false);
  const waiting = !record && !!patientRef;
  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const id = setTimeout(() => setSlow(true), RECORD_SLOW_MS);
    return () => clearTimeout(id);
  }, [waiting, patientRef]);

  if (!record) {
    return (
      <section className="patient" aria-label="Patient" aria-busy={waiting && !slow}>
        <h2 className="label">patient</h2>
        {waiting && !slow ? (
          <>
            <span className="skeleton skeleton--name" />
            <span className="skeleton" />
            <p className="patient__more">identified as {patientRef} · pulling the record</p>
          </>
        ) : (
          <p className="patient__name muted">
            {waiting ? `Identified as ${patientRef} · record not available yet` : 'Not identified yet'}
          </p>
        )}
      </section>
    );
  }
  const age = ageOn(record.birthDate);
  // H9: every field shows, and an empty one says so rather than disappearing.
  const more = [
    record.codeStatus || 'code status not recorded',
    record.medications.join(', ') || 'no medications recorded',
    record.conditions.join(', ') || 'no history recorded',
  ].join(' · ');
  return (
    <section className="patient" aria-label="Patient record">
      <h2 className="label">
        patient · {record.source === 'cached' ? <Caution>cached copy</Caution> : 'from EHR'}
      </h2>
      <p className="patient__name">
        {record.name}
        {age !== undefined && <span className="patient__age"> {age}</span>}
      </p>
      <p className={`patient__allergy${record.allergies.length ? ' has-allergy' : ''}`}>
        {record.allergies.length ? `Allergy: ${record.allergies.join(', ')}` : 'No allergies recorded'}
      </p>
      <p className="patient__more" title={`born ${record.birthDate} · ${record.patientRef}`}>
        {more}
      </p>
    </section>
  );
}
