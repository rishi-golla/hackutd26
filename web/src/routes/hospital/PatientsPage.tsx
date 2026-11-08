import { useEffect, useRef, useState } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import type { DbConnection } from '../../module_bindings';
import { go } from './HospitalApp';
import { Icon, StatusPill, patientLine, recordSource } from './ui';
import type { HospitalData } from './useHospital';
import { tsMs } from '../../db/time';
import { SESSION_VIDEO_LABEL, unitLabel } from './recordings';

const SHOWN_RECORDING = 'Joshua Kim';

/** One row per encounter: repeated calls for the same patient keep their own clinical records. */
export default function PatientsPage({ data }: { data: HospitalData }) {
  const { getConnection } = useSpacetimeDB();
  // The Joshua Kim session, and every call with its own recorded session video.
  const calls = data.calls.filter(call => call.recordingOnly ? call.recording?.label === SHOWN_RECORDING : call.recording?.label === SESSION_VIDEO_LABEL);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [createdRequest, setCreatedRequest] = useState<string>();
  const pending = useRef<{ requestId: string; expectedIncidentId: string }>();
  // Wait for subscription delivery rather than assuming the reducer promise includes its table updates.
  useEffect(() => {
    if (!createdRequest) return;
    const conn = getConnection() as DbConnection | null;
    const event = conn && [...conn.db.event.iter()].find(row => row.kind === 'status_on_scene'
      && row.sources.some(source => source.kind === 'manual' && source.detail === createdRequest));
    if (event) go('/hospital/patient', event.incidentId);
  }, [createdRequest, data.calls, getConnection]);
  const start = async () => {
    const conn = getConnection() as DbConnection | null;
    if (!conn?.isActive || starting || createdRequest) return;
    const current = data.calls.find(call => call.incident.status !== 'closed');
    if (!pending.current) {
      if (current && !window.confirm(`End the current encounter (${patientLine(current.record) ?? current.incident.unit}, call ${current.incident.id}) and start a new patient? Existing records will stay saved.`)) return;
      pending.current = { requestId: crypto.randomUUID(), expectedIncidentId: current ? String(current.incident.id) : '' };
    }
    const request = pending.current;
    setStarting(true);
    setError(undefined);
    try {
      await conn.reducers.demoControl({ action: 'new_patient', arg: JSON.stringify(request) });
      pending.current = undefined;
      setCreatedRequest(request.requestId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not start the patient. Please try again.';
      // A stale confirmation needs a fresh confirmation. Transport failures retry the same idempotent request.
      const changed = message.includes('PATIENT_CHANGED:');
      if (changed) pending.current = undefined;
      setError(changed ? 'The active patient changed. Please try again.' : message);
    } finally {
      setStarting(false);
    }
  };
  return (
    <>
      <header className="page__head">
        <h1>Patients</h1>
        <div className="page__actions">
          <span className="muted small">{calls.length} {calls.length === 1 ? 'encounter' : 'encounters'}</span>
          <button type="button" className="action" onClick={() => void start()} disabled={!data.isActive || starting || !!createdRequest} aria-busy={starting || !!createdRequest}>
            {starting ? 'Starting…' : createdRequest ? 'Opening patient…' : pending.current ? 'Retry new patient' : 'New patient'}
          </button>
        </div>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="card patient-directory" aria-label="Patient encounters">
        <div className="patient-directory__columns" aria-hidden="true">
          <span>Patient</span><span>Unit / source</span><span>Status</span><span>Encounter date</span><span />
        </div>
        {calls.length === 0 ? (
          <p className="empty">{data.isActive ? 'No patients yet. They will appear when a call starts.' : 'Connecting to patient records…'}</p>
        ) : (
          <ul className="patient-directory__list">
            {calls.map(({ incident, record, recording, recordingOnly }) => {
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
                        <b>{patientLine(record) ?? (recordingOnly ? recording?.label : undefined) ?? 'Not identified'}</b>
                        <small>{`Call ${incident.id}${record ? ` · ${recordSource(record)}` : recordingOnly ? '' : ' · Awaiting identification'}`}</small>
                      </div>
                    </div>
                    <span className="patient-directory__unit">{unitLabel(incident)}</span>
                    <StatusPill status={incident.status} />
                    <time dateTime={started.toISOString()} className="patient-directory__date">
                      {started.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      <small>{started.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>
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
