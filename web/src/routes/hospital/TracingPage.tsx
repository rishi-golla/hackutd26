// Tracing: one session, reviewed. The live view, the status phases over time, the session's events, and three
// tabs: what was said on scene, an overview, and the agents' decision log. There is no recording to scrub: the
// bodycam streams live frames only, so the video is live and the phase bar is drawn from the status events.
import { useState } from 'react';
import { SessionVideo } from './PatientPage';
import { Card, Icon, SpokenTranscript, StatusPill, Timeline, hhmm, patientLine, time } from './ui';
import type { HospitalData } from './useHospital';
import { mmss, STATUS_TEXT, statusPhases, statusTone } from './vitals';

const ms = (ts: { microsSinceUnixEpoch: bigint }) => Number(ts.microsSinceUnixEpoch / 1000n);

export default function TracingPage({ data }: { data: HospitalData }) {
  const { incident, record, now } = data;
  const [tab, setTab] = useState<'transcript' | 'overview' | 'logs'>('transcript');
  const start = incident ? ms(incident.startedAt) : now;
  const end = incident && !data.open ? ms(incident.updatedAt) : now;
  const phases = incident ? statusPhases(start, end, data.events) : [];
  const span = Math.max(1, end - start);
  const ticks = Array.from({ length: 5 }, (_, i) => start + (span * i) / 4);
  const events = [...data.events].sort((a, b) => ms(b.ts) - ms(a.ts));
  const meds = data.events.filter(e => e.kind.startsWith('med_') || e.kind === 'shock');
  const said = data.spoken.filter(l => l.who === 'medic').length;
  const spokenBack = data.spoken.filter(l => l.who === 'handoff' && !l.queued).length;

  return (
    <>
      <header className="page__head">
        <div>
          <h1>Tracing</h1>
          <p className="sub">Live view, transcript, and session logs</p>
        </div>
      </header>

      <section className="card session">
        <span className="session__avatar"><Icon name="user" size={22} /></span>
        <div className="session__who">
          <b>{patientLine(record) ?? data.recording?.label ?? 'Patient not identified'}</b>
          <span className="muted">{record ? record.patientRef : incident ? `Incident ${incident.id}` : 'No incident'}</span>
        </div>
        <dl className="head-facts">
          <div><dt>Session</dt><dd>{incident ? <span className={`pill pill--${data.open ? 'green' : 'grey'}`}>{data.open ? 'In progress' : 'Closed'}</span> : '—'}</dd></div>
          {data.open && <div><dt>Status</dt><dd><StatusPill status={incident?.status} /></dd></div>}
          <div><dt>{data.recordingOnly ? 'Source' : 'Unit'}</dt><dd><b>{incident?.unit ?? '—'}</b></dd></div>
          <div><dt>{data.recordingOnly ? 'Imported' : 'Started'}</dt><dd><b>{incident ? hhmm(start) : '—'}</b></dd></div>
          <div><dt>{data.open ? 'Elapsed' : 'Duration'}</dt><dd><b>{incident && !data.recordingOnly ? mmss(data.elapsedS) : '—'}</b></dd></div>
        </dl>
      </section>

      <div className="tracing">
        <div className="col">
          <section className="card card--video card--bare"><SessionVideo data={data} /></section>
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
          <Card title="Session events" icon="list" className="card--grow">
            {events.length === 0 ? <p className="empty">No events yet.</p> : (
              <ol className="events">
                {events.map(e => (
                  <li key={String(e.id)} className={e.status === 'flagged' ? 'is-alarm' : undefined}>
                    <span className="events__time">{time(ms(e.ts))}</span>
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
            {([['transcript', 'Transcript', 'message'], ['overview', 'Overview', 'chart'], ['logs', 'Logs', 'layers']] as const).map(([id, label, icon]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : undefined} onClick={() => setTab(id)}>
                <Icon name={icon} size={16} />{label}
              </button>
            ))}
          </div>
          <div className="tabs__body">
            {tab === 'transcript' && <SpokenTranscript lines={data.spoken} />}
            {tab === 'overview' && (
              <div className="overview">
                <div className="overview__grid">
                  <div><span>Lines heard</span><b>{said}</b></div>
                  <div><span>Spoken back</span><b>{spokenBack}</b></div>
                  <div><span>Events</span><b>{data.events.length}</b></div>
                  <div><span>Medications and shocks</span><b>{meds.length}</b></div>
                  <div><span>Agent decisions</span><b>{data.thoughts.length}</b></div>
                  <div><span>Report</span><b>{data.reportReady ? 'Ready' : data.writing ? 'Writing' : 'Not yet'}</b></div>
                </div>
                <h3>Medications and shocks</h3>
                {meds.length === 0 ? <p className="muted">None logged.</p> : meds.map(m => (
                  <p key={String(m.id)} className="overview__row"><span>{time(ms(m.ts))}</span>{m.label}<span className={`tag tag--${m.status === 'confirmed' ? 'green' : m.status === 'flagged' ? 'amber' : 'grey'}`}>{m.status === 'flagged' ? 'awaiting confirmation' : m.status}</span></p>
                ))}
                {data.destination && <><h3>Destination</h3><p>{data.destination.name}{data.etaMin !== undefined && ` · ETA ${data.etaMin} min`}</p></>}
              </div>
            )}
            {tab === 'logs' && <Timeline data={data} />}
          </div>
        </section>
      </div>
    </>
  );
}
