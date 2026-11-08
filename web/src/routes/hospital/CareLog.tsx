import { useState } from 'react';
import type { Vitals } from '../../module_bindings/types';
import { tsMs } from '../../db/time';
import type { TimelineRow } from './useHospital';
import { Icon, time } from './ui';

type CareEvent = Extract<TimelineRow, { kind: 'event' }>;

function presentation(kind: string) {
  if (kind === 'medication' || kind.startsWith('med_')) return { label: 'Medication', icon: 'pill', tone: 'accent' };
  if (kind.startsWith('cpr_') || kind === 'shock') return { label: 'Resuscitation', icon: 'heart', tone: 'green' };
  if (kind.startsWith('sim_')) return { label: 'Simulation', icon: 'monitor', tone: 'grey' };
  if (kind === 'bodycam_started') return { label: 'Harness', icon: 'video', tone: 'blue' };
  if (kind.startsWith('status_')) return { label: 'Session', icon: 'pulse', tone: 'blue' };
  if (kind === 'patient_identified') return { label: 'Patient', icon: 'user', tone: 'green' };
  if (kind === 'er_alert') return { label: 'Communication', icon: 'message', tone: 'blue' };
  if (kind === 'session_recording' || kind === 'recording_imported') return { label: 'Recording', icon: 'video', tone: 'grey' };
  if (kind.includes('alarm')) return { label: 'Alert', icon: 'alert', tone: 'amber' };
  return { label: 'Care event', icon: 'clipboard', tone: 'grey' };
}

/** Clinical activity stays separate from agent progress. Newest entries come first. */
export function CareLog({ events, compact = false }: { events: CareEvent[]; compact?: boolean }) {
  const [limit, setLimit] = useState(60);
  if (!events.length) return <p className="empty">Documented care will appear here.</p>;
  const rows = events.slice(0, compact ? 5 : limit);
  return <div className={`care-log${compact ? ' care-log--compact' : ''}`}>
    {rows.map((event, index) => {
      const day = new Date(event.t).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
      const previousDay = index ? new Date(rows[index - 1].t).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : '';
      const style = presentation(event.eventKind);
      return <div key={event.key}>
        {!compact && day !== previousDay && <h3 className="care-log__day">{day}</h3>}
        <article className={`care-log__entry care-log__entry--${style.tone}`}>
          <time dateTime={new Date(event.t).toISOString()}>{time(event.t)}</time>
          <span className="care-log__marker"><Icon name={style.icon} /></span>
          <div className="care-log__content">
            <div className="care-log__meta"><span>{style.label}</span>{event.flagged && <span className="tag tag--amber">Awaiting confirmation</span>}</div>
            <p>{event.text}</p>
          </div>
        </article>
      </div>;
    })}
    {!compact && events.length > limit && <button type="button" className="action action--soft" onClick={() => setLimit(n => n + 60)}>Earlier events</button>}
  </div>;
}

export function VitalsLog({ rows }: { rows: Vitals[] }) {
  const [limit, setLimit] = useState(100);
  const hasTemperature = rows.some(row => row.tempC !== undefined);
  if (!rows.length) return <p className="empty">No saved vitals for this encounter.</p>;
  return <>
    <p className="log-caption">Recorded readings · newest first. A dash means no reading was captured.</p>
    <div className="vitals-history">
      <table>
        <thead><tr><th>Captured</th><th>Heart rate</th><th>SpO₂ <small>experimental</small></th>{hasTemperature && <th>Temperature</th>}<th>Source</th></tr></thead>
        <tbody>{rows.slice(0, limit).map(row => <tr key={String(row.id)}>
          <td><time dateTime={new Date(tsMs(row.ts)).toISOString()}>{new Date(tsMs(row.ts)).toLocaleDateString([], { month: 'short', day: 'numeric' })}<small>{time(tsMs(row.ts))}</small></time></td>
          <td>{row.hr === undefined ? '—' : `${Math.round(row.hr)} bpm`}</td>
          <td>{row.spo2 === undefined ? '—' : `${Math.round(row.spo2)}%`}</td>
          {hasTemperature && <td>{row.tempC === undefined ? '—' : `${row.tempC.toFixed(1)} °C`}</td>}
          <td><span className={`tag tag--${row.simulated ? 'amber' : 'grey'}`}>{row.simulated ? 'Simulated' : 'Relay'}</span><small>{row.status}</small></td>
        </tr>)}</tbody>
      </table>
    </div>
    {rows.length > limit && <button type="button" className="action action--soft" onClick={() => setLimit(n => n + 100)}>Earlier readings</button>}
  </>;
}
