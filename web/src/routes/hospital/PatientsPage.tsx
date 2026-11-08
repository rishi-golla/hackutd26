import { go } from './HospitalApp';
import { Icon, StatusPill, patientLine } from './ui';
import type { HospitalData } from './useHospital';
import { tsMs } from '../../db/time';

/** One row per encounter: repeated calls for the same patient keep their own clinical records. */
export default function PatientsPage({ data }: { data: HospitalData }) {
  return (
    <>
      <header className="page__head">
        <h1>Patients</h1>
        <span className="muted small">{data.calls.length} {data.calls.length === 1 ? 'encounter' : 'encounters'}</span>
      </header>
      <section className="card patient-directory" aria-label="Patient encounters">
        <div className="patient-directory__columns" aria-hidden="true">
          <span>Patient</span><span>Unit / source</span><span>Status</span><span>Encounter date</span><span />
        </div>
        {data.calls.length === 0 ? (
          <p className="empty">{data.isActive ? 'No patients yet. They will appear when a call starts.' : 'Connecting to patient records…'}</p>
        ) : (
          <ul className="patient-directory__list">
            {data.calls.map(({ incident, record, recording, recordingOnly }) => {
              const started = new Date(tsMs(incident.startedAt));
              const href = `/hospital/patient?incident=${incident.id}`;
              return (
                <li key={String(incident.id)}>
                  <a className="patient-directory__row" href={href} onClick={e => {
                    // Preserve the browser's open-in-new-tab and keyboard link behavior.
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    go('/hospital/patient', incident.id);
                  }}>
                    <div className="patient-directory__identity">
                      <span className="patient-directory__avatar"><Icon name="user" /></span>
                      <div>
                        <b>{patientLine(record) ?? recording?.label ?? 'Not identified'}</b>
                        <small>{recordingOnly ? 'Recorded video · patient not identified' : `Call ${incident.id}${record ? ` · ${record.source === 'cached' ? 'Cached copy' : 'From EHR'}` : ' · Awaiting identification'}`}</small>
                      </div>
                    </div>
                    <span className="patient-directory__unit">{incident.unit}</span>
                    <StatusPill status={incident.status} />
                    <time dateTime={started.toISOString()} className="patient-directory__date">
                      {started.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      <small>{recordingOnly ? 'Imported ' : ''}{started.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>
                    </time>
                    <Icon name="arrow" size={16} />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
