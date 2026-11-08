// Tracing: one session, reviewed. The live view, the status phases over time, the session's events, and two
// tabs: what was said on scene and the agents' decision log. There is no recording to scrub: the
// bodycam streams live frames only, so the video is live and the phase bar is drawn from the status events.
// A recorded video's rows come from the offline analyzer and show times into the video (click to play from there).
import { useState } from 'react';
import { SessionVideo } from './PatientPage';
import { RecordingTimeline } from './RecordingTimeline';
import { Card, FromRecording, Icon, SpokenTranscript, Stamp, StatusPill, Timeline, hhmm, patientLine } from './ui';
import type { HospitalData } from './useHospital';
import { unitLabel } from './recordings';
import { mmss, STATUS_TEXT, statusPhases, statusTone } from './vitals';

const ms = (ts: { microsSinceUnixEpoch: bigint }) => Number(ts.microsSinceUnixEpoch / 1000n);

export default function TracingPage({ data }: { data: HospitalData }) {
  const { incident, record, now } = data;
  const [tab, setTab] = useState<'transcript' | 'logs'>('transcript');
  const start = incident ? ms(incident.startedAt) : now;
  const end = incident && !data.open ? ms(incident.updatedAt) : now;
  const phases = incident ? statusPhases(start, end, data.events) : [];
  const span = Math.max(1, end - start);
  const ticks = Array.from({ length: 5 }, (_, i) => start + (span * i) / 4);
  const events = [...data.events].sort((a, b) => ms(b.ts) - ms(a.ts));

  return (
    <>
      <header className="page__head">
        <div>
          <h1>Tracing</h1>
        </div>
      </header>

      <section className="card session">
        <span className="session__avatar"><Icon name="user" size={22} /></span>
        <div className="session__who">
          <b>{patientLine(record) ?? (data.recordingOnly ? data.recording?.label : undefined) ?? 'Patient not identified'}</b>
          <span className="muted">{record ? record.patientRef : incident ? `Incident ${incident.id}` : 'No incident'}</span>
        </div>
        <dl className="head-facts">
          <div><dt>Session</dt><dd>{incident ? <span className={`pill pill--${data.open ? 'green' : 'grey'}`}>{data.open ? 'In progress' : 'Closed'}</span> : '—'}</dd></div>
          {data.open && <div><dt>Status</dt><dd><StatusPill status={incident?.status} /></dd></div>}
          <div><dt>{data.recordingOnly ? 'Source' : 'Unit'}</dt><dd><b>{unitLabel(incident) ?? '—'}</b></dd></div>
          <div><dt>Started</dt><dd><b>{incident ? hhmm(start) : '—'}</b></dd></div>
          <div><dt>{data.open ? 'Elapsed' : 'Duration'}</dt><dd><b>{incident && !data.recordingOnly ? mmss(data.elapsedS) : '—'}</b></dd></div>
        </dl>
      </section>

      <div className="tracing">
        <div className="col">
          <section className="card card--video card--bare"><SessionVideo data={data} /></section>
          {data.videoStart !== undefined && <RecordingTimeline data={data} />}
          {!data.recordingOnly && phases.length > 0 && (
            <div className="phases" aria-label="Status over time">
              <div className="phases__bar">
                {phases.map(p => (
                  <span key={p.startMs} className={`phases__seg tone--${statusTone(p.status)}`} style={{ left: `${((p.startMs - start) / span) * 100}%`, width: `${((p.endMs - p.startMs) / span) * 100}%` }}
                    title={`${STATUS_TEXT[p.status] ?? p.status} · ${hhmm(p.startMs)}–${hhmm(p.endMs)}`} />
                ))}
              </div>
              <div className="phases__ticks">{ticks.map(t => <span key={t}>{hhmm(t)}</span>)}</div>
              <div className="phases__legend">{[...new Set(phases.map(p => p.status))].map(s => <span key={s}><i className={`tone--${statusTone(s)}`} />{STATUS_TEXT[s] ?? s}</span>)}</div>
            </div>
          )}
          <Card title="Session events" icon="list" className="card--grow" right={<FromRecording videoStart={data.videoStart} />}>
            {events.length === 0 ? <p className="empty">No events yet.</p> : (
              <ol className="events">
                {events.map(e => (
                  <li key={String(e.id)} className={e.status === 'flagged' ? 'is-alarm' : undefined}>
                    <span className="events__time"><Stamp t={ms(e.ts)} videoStart={data.videoStart} /></span>
                    <span className="events__icon"><Icon name={e.kind.startsWith('med_') ? 'pill' : e.kind.startsWith('status_') ? 'pulse' : e.kind === 'patient_identified' ? 'user' : 'file'} size={15} /></span>
                    <span>{e.label}{e.status === 'flagged' && <span className="tag tag--amber">awaiting confirmation</span>}{e.status === 'confirmed' && <span className="tag tag--green">confirmed</span>}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <section className="card card--grow tabs-card">
          <div className="tabs" role="tablist">
            {([['transcript', 'Transcript', 'message'], ['logs', 'Logs', 'layers']] as const).map(([id, label, icon]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : undefined} onClick={() => setTab(id)}>
                <Icon name={icon} size={16} />{label}
              </button>
            ))}
          </div>
          <div className="tabs__body">
            {tab === 'transcript' && <SpokenTranscript lines={data.spoken} videoStart={data.videoStart} />}
            {tab === 'logs' && <Timeline data={data} />}
          </div>
        </section>
      </div>
    </>
  );
}
