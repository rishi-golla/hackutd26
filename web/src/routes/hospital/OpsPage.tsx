import { go } from './HospitalApp';
import { LiveView } from './PatientPage';
import { Card, Icon, PatientFacts, patientLine, SessionVitals, SpokenTranscript, StatusPill } from './ui';
import { CareLog } from './CareLog';
import { mmss } from './vitals';
import type { HospitalData } from './useHospital';

/** The harness demonstration: actual camera, current relay readings, and the care being documented. */
export default function OpsPage({ data }: { data: HospitalData }) {
  const current = data.open ? data.incident : undefined;
  const sensorNote = !data.isActive ? 'Connecting to the database…' : ({
    pulse: 'Receiving sensor readings',
    acquiring: 'Measuring…',
    calibrating: 'Calibrating…',
    'no finger': 'No finger detected',
    saturated: 'Sensor saturated',
    'sensor error': 'Sensor error',
  } as Record<string, string>)[data.sensorStatus ?? ''] ?? (data.sensorStatus || 'Waiting for fresh relay readings');
  return (
    <>
      <header className="page__head"><h1>Live Operations</h1></header>
      <div className="capture-session">
        <span className="capture-session__icon"><Icon name="user" /></span>
        <div className="capture-session__identity">
          <b>{current ? patientLine(data.record) ?? 'Unidentified patient' : 'Ready for the next session'}</b>
          <span>{current ? `${current.unit} · Encounter ${current.id}` : 'Camera preview · no active encounter'}</span>
        </div>
        {current && <><span className="capture-session__duration">{mmss(data.elapsedS)}</span><StatusPill status={current.status} />
          <button className="action action--soft" type="button" onClick={() => go('/hospital/patient', current.id)}>Patient details <Icon name="arrow" size={14} /></button></>}
      </div>
      <div className="capture">
        <Card title="Bodycam" icon="video" className="capture__camera">
          <LiveView />
          <p className="capture__caption">Camera from the harness</p>
        </Card>
        <div className="capture__side">
          <Card title={data.vitalsSimulated ? 'Simulated vitals' : 'Relay vitals'} icon="pulse">
            <SessionVitals data={data} />
            <p className="sensor-note">{sensorNote}</p>
            {!current && <p className="sensor-note sensor-note--secondary">Hardware preview · not attached to a patient</p>}
          </Card>
          <Card title="Patient" icon="user" right={data.record && <span className="small muted">{data.record.source === 'cached' ? 'Cached copy' : 'From EHR'}</span>}>
            {current ? <PatientFacts record={data.record} patientRef={current.patientRef} /> : <p className="empty">No patient identified yet.</p>}
          </Card>
        </div>
        <Card title="Care timeline" icon="clipboard" className="capture__documentation"
          right={current && <a className="text-link" href={`/hospital/logs?incident=${current.id}`} onClick={e => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
            e.preventDefault(); go('/hospital/logs', current.id);
          }}>All logs <Icon name="arrow" size={14} /></a>}>
          <CareLog events={current ? data.timeline.filter(row => row.kind === 'event') : []} compact />
        </Card>
        <Card title="Latest conversation" icon="message" className="capture__conversation">
          <SpokenTranscript lines={current ? data.spoken.slice(-4) : []} />
        </Card>
      </div>
    </>
  );
}
