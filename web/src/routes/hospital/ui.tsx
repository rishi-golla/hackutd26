// Small building blocks shared by the hospital pages.
import { useState, type ReactNode } from 'react';
import type { PatientRecord } from '../../module_bindings/types';
import { FromRecording, Stamp } from './Stamp';
import { LiveThought, ThoughtRow } from './ThoughtRows';
import type { HospitalData, SpokenLine } from './useHospital';

export { FromRecording, Stamp };
import { ageOn, epiText, isDue, STATUS_TEXT, statusTone, type Reading } from './vitals';

// Lucide icons (ISC), the one icon set on the dashboard.
const PATHS: Record<string, string> = {
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  monitor: 'M3 4h18v13H3zM8 21h8M12 17v4',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  trace: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  ambulance: 'M10 17h4M3 17V6a1 1 0 0 1 1-1h10v12M14 9h4l3 4v4h-2M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 9h4M8 7v4',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  calendar: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18',
  pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
  heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z',
  clipboard: 'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  layers: 'M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7zM8.5 8.5l7 7',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
  thermo: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z',
  lungs: 'M6.1 8C3.5 9.4 2 12.5 2 16c0 2.8 1.2 4 3 4 1.6 0 3-.9 3-3V7M18 8c2.6 1.4 4 4.5 4 8 0 2.8-1.2 4-3 4-1.6 0-3-.9-3-3V7M12 4v8M9 12l3-2 3 2',
  arrow: 'M9 18l6-6-6-6',
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Card({ title, icon, right, children, className = '' }: { title?: string; icon?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`} aria-label={title}>
      {title && (
        <header className="card__head">
          {icon && <span className="card__icon"><Icon name={icon} /></span>}
          <h2 className="card__title">{title}</h2>
          {right && <div className="card__right">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatusPill({ status }: { status?: string }) {
  if (!status) return <span className="pill pill--grey">No incident</span>;
  return <span className={`pill pill--${statusTone(status)}`}>{STATUS_TEXT[status] ?? status}</span>;
}

export const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** One live metric. A missing reading shows a dash, never a stale number (a held one is dimmed and brief). */
export function Metric(props: { label: string; icon?: string; unit?: string; value?: number; reading?: Reading; digits?: number; text?: string; alarm?: boolean }) {
  const { label, icon, unit, digits = 0, text, alarm } = props;
  const reading: Reading = props.reading ?? (props.value !== undefined ? { kind: 'live', value: props.value } : { kind: 'none' });
  const shown = text ?? (reading.value !== undefined ? reading.value.toFixed(digits) : undefined);
  return (
    <div className={`metric${alarm ? ' is-alarm' : ''}`}>
      <p className="metric__label">{icon && <Icon name={icon} size={16} />}{label}</p>
      {reading.kind === 'measuring' && text === undefined ? (
        <p className="metric__value" aria-label="measuring"><span className="measuring" aria-hidden="true"><i /><i /><i /></span></p>
      ) : (
        <p className={`metric__value${shown === undefined ? ' metric__value--none' : ''}${reading.kind === 'held' ? ' is-held' : ''}`}>
          {shown ?? '—'}
          {shown !== undefined && unit && <span className="metric__unit">{unit}</span>}
        </p>
      )}
    </div>
  );
}

export function patientLine(record?: PatientRecord) {
  if (!record) return undefined;
  const age = ageOn(record.birthDate);
  return `${record.name}${age !== undefined ? `, ${age}` : ''}`;
}

export function SessionVitals({ data }: { data: HospitalData }) {
  const careTiming = data.cprRate !== undefined || (data.inArrest && !!data.epi);
  return <><div className="vitals">
    <Metric label="Heart rate" icon="heart" unit="bpm" reading={data.hr} alarm={!data.inArrest && data.hr.value !== undefined && (data.hr.value < 50 || data.hr.value > 150)} />
    <Metric label="SpO₂ · experimental" icon="lungs" unit="%" reading={data.spo2} alarm={!data.inArrest && data.spo2.value !== undefined && data.spo2.value < 90} />
  </div>
    {careTiming && <div className="care-timing">
      <h3>Care timing</h3>
      <div className="vitals">
        {data.cprRate !== undefined && <Metric label={data.cprSimulated ? 'CPR rate · simulated' : 'CPR rate'} icon="pulse" unit="/min" value={data.cprRate} alarm={data.cprRate < 100 || data.cprRate > 120} />}
        {data.inArrest && data.epi && <Metric label="Next epi" icon="clock" text={epiText(data.epi, data.now)} alarm={isDue(data.epi, data.now)} />}
      </div>
    </div>}
  </>;
}

/** The record's facts (H9): allergy first and highlighted, then code status, medications, history. */
export function PatientFacts({ record, patientRef }: { record?: PatientRecord; patientRef?: string }) {
  if (!record) return <p className="empty">{patientRef ? 'Pulling the record…' : 'Not identified yet. The medic says the name and birth date, or shows the ID card.'}</p>;
  return (
    <dl className="facts">
      <dt><Icon name="alert" size={16} />Allergies</dt>
      <dd>{record.allergies.length ? record.allergies.map(a => <span key={a} className="tag tag--red">{a}</span>) : 'None known'}</dd>
      <dt><Icon name="pill" size={16} />Medications</dt>
      <dd>{record.medications.join(', ') || 'None recorded'}</dd>
      <dt><Icon name="history" size={16} />History</dt>
      <dd>{record.conditions.join(', ') || 'None recorded'}</dd>
      <dt><Icon name="heart" size={16} />Code status</dt>
      <dd>{record.codeStatus || 'Not recorded'}</dd>
    </dl>
  );
}

export function SpokenTranscript({ lines, videoStart }: { lines: SpokenLine[]; videoStart?: number }) {
  if (!lines.length) return <p className="empty">No transcript recorded for this call.</p>;
  return (
    <>
      {videoStart !== undefined && <p className="said__source"><FromRecording videoStart={videoStart} /></p>}
    <ol className="said">
      {lines.map(line => (
        <li key={line.key} className={line.who === 'handoff' ? 'said--agent' : undefined}>
          <span className="said__time"><Stamp t={line.t} videoStart={videoStart} /></span>
          <div><b>{line.who === 'medic' ? 'Paramedic' : 'Handoff'}</b><p>{line.text}{line.queued && <span className="muted"> (queued, not spoken yet)</span>}</p></div>
        </li>
      ))}
    </ol>
    </>
  );
}

/** Events and the agents' decisions, newest first (H4, H5). */
export function Timeline({ data, limit }: { data: HospitalData; limit?: number }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) => setOpen(prev => {
    const next = new Set(prev);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const rows = limit ? data.timeline.slice(0, limit) : data.timeline;
  if (!rows.length && !data.live.length) return <p className="empty">No events yet.</p>;
  return (
    <ol className="timeline">
      {data.live.map(t => <LiveThought key={t.key} thought={t} />)}
      {rows.map(e => e.kind === 'thought' ? (
        <ThoughtRow key={e.key} thought={e.thought} active={data.liveSet.has(e.thought)} open={open.has(e.key)} onToggle={() => toggle(e.key)} videoStart={data.videoStart} />
      ) : (
        <li key={e.key} className={e.flagged ? 'is-alarm' : undefined}>
          <span className="timeline__time"><Stamp t={e.t} videoStart={data.videoStart} /></span>
          <span className="timeline__text">{e.text}{e.flagged && <span className="tag tag--amber">awaiting confirmation</span>}</span>
        </li>
      ))}
    </ol>
  );
}

/** Generate Handoff (H7), the dashboard's one action, with its honest states. */
export function HandoffButton({ data }: { data: HospitalData }) {
  return (
    <button type="button" className="action" onClick={data.generate} aria-busy={data.writing}
      disabled={!data.canGenerate || data.writing || data.reportReady}>
      {data.writing ? (data.reportProblem ? 'Report pending' : 'Writing report…') : data.reportReady ? 'Report ready' : 'Generate Handoff'}
    </button>
  );
}
