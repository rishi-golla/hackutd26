// One patient on the way in: who they are (H9), the live view (H2), live vitals (H3), the care timeline with the
// agents' decisions (H4, H5), the messages exchanged with the ER (H6) and the handoff report (H7).
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import LiveVideo from './LiveVideo';
import ReportView from './ReportView';
import { go } from './HospitalApp';
import { Card, HandoffButton, Icon, Metric, PatientFacts, StatusPill, Timeline, time } from './ui';
import type { HospitalData } from './useHospital';
import type { Recording } from './recordings';
import { ageOn, epiText, isDue, mmss } from './vitals';

/** Expand or minimize with a view transition where the browser has one (the thumbnail morphs into place). */
export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === 'function') doc.startViewTransition(() => flushSync(update));
  else update();
}

/** The live view with click-to-enlarge (Esc or a click on the backdrop minimizes). */
export function LiveView({ available = true }: { available?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => withViewTransition(() => setExpanded(x => !x));
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && withViewTransition(() => setExpanded(false));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);
  return (
    <div className="video-slot">
      {!available ? <div className="no-recording"><Icon name="video" /><p>No live session</p><span>Video is not recorded.</span></div> : <>
      {expanded && <span className="video-slot__note">Esc to minimize</span>}
      <LiveVideo expanded={expanded} onToggle={toggle} />
      {expanded && <div className="video-backdrop" onClick={toggle} aria-hidden="true" />}
      </>}
    </div>
  );
}

/** Playback is explicitly separate from current frames and never writes clinical values. */
export function SessionVideo({ data }: { data: HospitalData }) {
  const [preferRecording, setPreferRecording] = useState(false);
  const [failed, setFailed] = useState(false);
  const recording: Recording | undefined = data.recording;
  useEffect(() => { setPreferRecording(false); setFailed(false); }, [data.incident?.id, recording?.url]);
  const recorded = !!recording && (!data.canShowLive || preferRecording);
  return <div className="session-media">
    {recording && <div className="session-media__head">
      <span>{recorded ? `Recorded video${recording.url.startsWith('/') ? ' · demo laptop' : ''}` : 'Live camera'}</span>
      {data.canShowLive && <button type="button" onClick={() => setPreferRecording(value => !value)}>{recorded ? 'Show live camera' : 'Watch recording'}</button>}
    </div>}
    {recorded && recording ? <div className="video-slot recorded-video">
      <video key={recording.url} src={recording.url} controls playsInline preload="metadata" aria-label={`Recorded video: ${recording.label}`} onError={() => setFailed(true)} />
      {failed && <p className="recorded-video__error">This recording could not be loaded. Check that the link is a playable video.</p>}
    </div> : <LiveView available={data.canShowLive} />}
  </div>;
}

export default function PatientPage({ data }: { data: HospitalData }) {
  const { incident, record, now } = data;
  const [showReport, setShowReport] = useState(false);
  const age = record ? ageOn(record.birthDate) : undefined;
  const heard = data.spoken.filter(l => l.who === 'medic').slice(-2);
  useEffect(() => setShowReport(false), [incident?.id]);

  return (
    <>
      <header className="page__head page__head--patient">
        <div>
          <p className="crumbs"><a href="/hospital/patients" onClick={e => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            go('/hospital/patients');
          }}>Back to patients</a><Icon name="arrow" size={14} />{record?.name ?? (data.recordingOnly ? 'Recorded video' : 'Patient')}</p>
          <h1>{record?.name ?? data.recording?.label ?? (incident?.patientRef ? 'Pulling the record…' : 'Patient not identified')}</h1>
          <p className="sub">{record ? `${age !== undefined ? `${age} years · ` : ''}born ${record.birthDate} · ${record.patientRef}` : incident ? `${incident.unit} · incident ${incident.id}` : 'No incident yet'}</p>
        </div>
        <dl className="head-facts">
          <div><dt>ETA</dt><dd>{data.etaMin !== undefined ? <b>{data.etaMin} min</b> : '—'}{data.destination && <small>{data.destination.name}</small>}</dd></div>
          <div><dt>{data.recordingOnly ? 'Source' : 'Unit'}</dt><dd><b>{incident?.unit ?? '—'}</b></dd></div>
          <div><dt>Status</dt><dd><StatusPill status={incident?.status} /></dd></div>
        </dl>
      </header>

      <div className="patient">
        <div className="col">
          <Card title="Session video" icon="video" className="card--video"
            right={data.reportReady && (
              <div className="seg" role="tablist">
                <button type="button" role="tab" aria-selected={!showReport} onClick={() => setShowReport(false)}>Live</button>
                <button type="button" role="tab" aria-selected={showReport} onClick={() => setShowReport(true)}>Report</button>
              </div>
            )}>
            {showReport && data.reportReady ? <div className="report-slot"><ReportView contentJson={data.report!.contentJson} /></div> : <SessionVideo data={data} />}
            <div className="heard">
              <p className="heard__title">Latest transcript <span className="muted">(Voice → Text)</span></p>
              {heard.length ? heard.map(l => <p key={l.key} className="heard__line"><span>{time(l.t)}</span>{l.text}</p>) : <p className="muted">Nothing said yet.</p>}
            </div>
          </Card>
          <Card title="Care Timeline" icon="layers" className="card--grow">
            <Timeline data={data} />
          </Card>
        </div>

        <div className="col">
          <Card title="Vital Signs" icon="pulse" right={<span className="muted small">{data.vitalsAt ? `Updated ${time(data.vitalsAt)}` : 'No live readings'}</span>}>
            <div className="vitals">
              <Metric label="Heart rate" icon="heart" unit="bpm" reading={data.hr} alarm={!data.inArrest && data.hr.value !== undefined && (data.hr.value < 50 || data.hr.value > 150)} />
              <Metric label="SpO₂" icon="lungs" unit="%" reading={data.spo2} alarm={!data.inArrest && data.spo2.value !== undefined && data.spo2.value < 90} />
              <Metric label="Temperature" icon="thermo" unit="°C" digits={1} value={data.tempC} />
              <Metric label="CPR rate" icon="pulse" unit="/min" value={data.cprRate} alarm={data.cprRate !== undefined && (data.cprRate < 100 || data.cprRate > 120)} />
              <Metric label="Next epi" icon="clock" text={data.inArrest ? epiText(data.epi, now) : undefined} alarm={data.inArrest && isDue(data.epi, now)} />
              <Metric label="Elapsed" icon="clock" text={incident && data.open ? mmss(data.elapsedS) : undefined} />
            </div>
          </Card>
          <Card title="Clinical Details" icon="clipboard" right={record && <span className="small muted">{record.source === 'cached' ? 'Cached copy' : 'From EHR'}</span>}>
            {data.recordingOnly && !record ? <p className="empty">No patient identity or clinical record was supplied with this video.</p>
              : <PatientFacts record={record} patientRef={incident?.patientRef} />}
          </Card>
        </div>

        <div className="col">
          <Card title="Communication Log" icon="message" className="card--grow card--messages">
            {data.messages.length === 0 ? <p className="empty">No messages yet. The pre-arrival alert lands here.</p> : (
              <ol className="msgs">
                {data.messages.map(m => (
                  <li key={String(m.id)} className={m.direction === 'to_er' ? 'msgs__in' : 'msgs__out'}>
                    <span className="msgs__dot" />
                    <span className="msgs__time">{time(Number(m.ts.microsSinceUnixEpoch / 1000n))}</span>
                    <b>{m.direction === 'to_er' ? `${incident?.unit ?? 'Unit'} → ED` : `ED → ${incident?.unit ?? 'Unit'}`}</b>
                    <p>{m.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card title="Handoff Report" icon="clipboard">
            <div className="handoff">
              <p className="muted">{data.reportReady ? 'MIST report with supporting sources.' : data.reportProblem ?? (!data.canGenerate ? 'Report generation is available for the latest call.' : data.writing ? 'Preparing the handoff…' : 'Create the handoff from documented care.')}</p>
              {data.reportReady ? <button type="button" className="action action--soft" onClick={() => setShowReport(true)}>View report</button> : <HandoffButton data={data} />}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
