// Demo controls (spec D1, H8; §5 "Demo controls on a phone"). A hidden page for the demo operator's phone: no
// other page links to it. Every button writes to SpacetimeDB on Maincloud, the one source of truth, through the
// existing reducers (`demo_control`, `synthesize_seizure`); the dashboard, bodycam and agent react to the rows,
// so a beat can be forced when a sensor misfires. The top card reads back what the database holds right now.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, type DbConnection } from '../../module_bindings';
import type { Incident } from '../../module_bindings/types';
import { tsMs } from '../../db/time';
import './controls.css';

/** The five synthetic patients in the mock EHR (ehr/README.md). */
const PATIENTS = [
  { id: 'pt-0001', name: 'Jordan Avery, 1968 (demo patient)' },
  { id: 'pt-0002', name: 'Jordan Avery, 1991' },
  { id: 'pt-0003', name: 'Maria Delgado' },
  { id: 'pt-0004', name: 'Samuel Okafor' },
  { id: 'pt-0005', name: 'Priya Raman' },
];

const STATUS_TEXT: Record<string, string> = {
  standby: 'Standby',
  on_scene: 'On scene',
  arrest: 'Arrest',
  rosc: 'ROSC',
  en_route: 'En route',
  arrived: 'Arrived',
  closed: 'Closed',
};

const RESET_CONFIRM_MS = 4000;

const byNewest = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? 1 : -1);

function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** §5: the page keeps the phone's screen awake while it's open (re-acquired when the tab comes back). */
function useWakeLock() {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return;
    let lock: { release: () => Promise<void> } | undefined;
    const acquire = () => {
      if (document.visibilityState === 'visible') nav.wakeLock!.request('screen').then(l => (lock = l), () => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => {});
    };
  }, []);
}

type Feedback = { label: string; state: 'sending' | 'done' | 'failed'; detail?: string };

export default function ControlsPage() {
  const { isActive, getConnection } = useSpacetimeDB();
  const now = useNow();
  useWakeLock();

  const [incidents] = useTable(tables.incident);
  const [cprRows] = useTable(tables.cprState);
  const [overrides] = useTable(tables.vitalsOverride);
  const [records] = useTable(tables.patientRecord);

  const [feedback, setFeedback] = useState<Feedback>();
  const [busy, setBusy] = useState<string>();
  const [patient, setPatient] = useState(PATIENTS[0].id);
  const [armReset, setArmReset] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout>>();

  // The open incident (the backend's "active" one), else the newest so a closed run still reads back.
  const active: Incident | undefined = useMemo(() => [...incidents].filter(i => i.status !== 'closed').sort(byNewest)[0], [incidents]);
  const latest: Incident | undefined = useMemo(() => [...incidents].sort(byNewest)[0], [incidents]);
  const shown = active ?? latest;
  const cpr = cprRows.find(c => c.incidentId === active?.id);
  const cprOverride = cpr?.source === 'override' ? cpr.rate : undefined;
  const seizureOn = overrides.length > 0;
  const record = records.find(r => r.incidentId === active?.id);

  /** Send one reducer call and report how it went. Only one call is in flight at a time. */
  const send = (key: string, label: string, call: (conn: DbConnection) => Promise<unknown>) => {
    const conn = getConnection() as DbConnection | null;
    if (!conn) return;
    setBusy(key);
    setFeedback({ label, state: 'sending' });
    call(conn)
      .then(() => setFeedback({ label, state: 'done' }))
      .catch((err: unknown) => setFeedback({ label, state: 'failed', detail: err instanceof Error ? err.message : String(err) }))
      .finally(() => setBusy(undefined));
  };
  const demo = (action: string, label: string, arg = '') => send(action, label, conn => conn.reducers.demoControl({ action, arg }));

  // Reset needs a second tap within a few seconds: it wipes every incident for everyone.
  const reset = () => {
    if (!armReset) {
      setArmReset(true);
      armTimer.current = setTimeout(() => setArmReset(false), RESET_CONFIRM_MS);
      return;
    }
    clearTimeout(armTimer.current);
    setArmReset(false);
    demo('reset', 'Reset for the next judge');
  };
  useEffect(() => () => clearTimeout(armTimer.current), []);

  const off = !isActive || busy !== undefined;
  const noIncident = !active;

  return (
    <main className="ctl">
      <header className="ctl__head">
        <h1 className="ctl__title">Demo controls</h1>
        <span className={`ctl__conn${isActive ? ' is-on' : ''}`}>{isActive ? 'Maincloud connected' : 'Connecting…'}</span>
      </header>

      <section className={`ctl__state state--${shown?.status ?? 'none'}`} aria-label="What the database holds now" aria-live="polite">
        <div className="ctl__state-main">
          <p className="ctl__status">{active ? STATUS_TEXT[active.status] ?? active.status : shown ? 'Closed' : 'No incident'}</p>
          {active && <p className="ctl__clock">{mmss((now - tsMs(active.startedAt)) / 1000)}</p>}
        </div>
        <dl className="ctl__facts">
          <dt>Patient</dt>
          <dd>{record ? record.name : active?.patientRef ? `${active.patientRef} · pulling record` : 'not identified'}</dd>
          <dt>CPR</dt>
          <dd>{cprOverride !== undefined ? `forced ${Math.round(cprOverride)}/min` : 'from the bodycam'}</dd>
          <dt>Vitals</dt>
          <dd>{seizureOn ? 'simulated seizure' : 'from the relay'}</dd>
          <dt>Timers</dt>
          <dd>{active ? (active.demoMode ? 'demo timing (epi 45 s)' : 'real timing (epi 4 min)') : '—'}</dd>
        </dl>
      </section>

      <p className={`ctl__feedback${feedback ? ` is-${feedback.state}` : ''}`} role="status">
        {feedback
          ? feedback.state === 'sending'
            ? `${feedback.label}…`
            : feedback.state === 'done'
              ? `${feedback.label}: done`
              : `${feedback.label} failed: ${feedback.detail}`
          : ' '}
      </p>

      <Group title="Incident">
        <Btn onClick={() => demo('start', 'Start incident')} disabled={off || !noIncident} primary>
          Start
        </Btn>
        <Btn onClick={() => demo('arrest', 'Cardiac arrest')} disabled={off || noIncident || active?.status === 'arrest'}>
          Arrest
        </Btn>
        <Btn onClick={() => demo('rosc', 'ROSC')} disabled={off || noIncident || active?.status === 'rosc'}>
          ROSC
        </Btn>
        <Btn onClick={() => demo('en_route', 'En route')} disabled={off || noIncident || active?.status === 'en_route'}>
          En route
        </Btn>
        <Btn onClick={() => demo('arrived', 'Arrived')} disabled={off || noIncident || active?.status === 'arrived'}>
          Arrived
        </Btn>
        <Btn onClick={() => demo('close', 'Close incident')} disabled={off || noIncident}>
          Close
        </Btn>
      </Group>

      <Group title="Overrides">
        <Btn onClick={() => demo('cpr_slow', 'CPR slow (90/min)')} disabled={off || noIncident} pressed={cprOverride === 90}>
          CPR slow
        </Btn>
        <Btn onClick={() => demo('cpr_good', 'CPR good (110/min)')} disabled={off || noIncident} pressed={cprOverride === 110}>
          CPR good
        </Btn>
        <Btn onClick={() => demo('cpr_clear', 'CPR back to the bodycam')} disabled={off || cprOverride === undefined}>
          CPR live
        </Btn>
        <Btn onClick={() => demo('epi_due_now', 'Epi due now')} disabled={off || noIncident}>
          Epi due now
        </Btn>
        <Btn
          onClick={() => send('seizure', seizureOn ? 'Stop simulated seizure' : 'Simulated seizure', conn => conn.reducers.synthesizeSeizure({ active: !seizureOn }))}
          // Off is always allowed; on only during an incident, like the other overrides.
          disabled={off || (noIncident && !seizureOn)}
          pressed={seizureOn}
        >
          {seizureOn ? 'Stop seizure' : 'Seizure'}
        </Btn>
        <Btn
          onClick={() => demo('demo_timing', active?.demoMode ? 'Real timing' : 'Demo timing', active?.demoMode ? 'off' : 'on')}
          disabled={off || noIncident}
          pressed={!!active?.demoMode}
        >
          Demo timing
        </Btn>
      </Group>

      <Group title="Identify patient" single>
        <select className="ctl__select" value={patient} onChange={e => setPatient(e.target.value)} aria-label="Patient">
          {PATIENTS.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Btn onClick={() => demo('identify', `Identify ${patient}`, patient)} disabled={off || noIncident}>
          Identify
        </Btn>
      </Group>

      <section className="ctl__reset">
        <button type="button" className={`ctl__danger${armReset ? ' is-armed' : ''}`} onClick={reset} disabled={off}>
          {armReset ? 'Tap again to wipe everything' : 'Reset for the next judge'}
        </button>
        <p className="ctl__hint">Deletes every incident and its data on Maincloud. Devices stay connected.</p>
      </section>
    </main>
  );
}

function Group({ title, single, children }: { title: string; single?: boolean; children: React.ReactNode }) {
  return (
    <section className="ctl__group" aria-label={title}>
      <h2 className="ctl__group-title">{title}</h2>
      <div className={`ctl__grid${single ? ' ctl__grid--single' : ''}`}>{children}</div>
    </section>
  );
}

function Btn(props: { onClick: () => void; disabled?: boolean; primary?: boolean; pressed?: boolean; children: React.ReactNode }) {
  const { onClick, disabled, primary, pressed, children } = props;
  return (
    <button
      type="button"
      className={`ctl__btn${primary ? ' ctl__btn--primary' : ''}${pressed ? ' is-on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
}
