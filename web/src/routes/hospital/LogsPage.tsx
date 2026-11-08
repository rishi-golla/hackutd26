import { useState } from 'react';
import { go } from './HospitalApp';
import { Icon, patientLine, SpokenTranscript, StatusPill, Timeline } from './ui';
import type { HospitalData } from './useHospital';
import { CareLog, VitalsLog } from './CareLog';
import { unitLabel } from './recordings';

type LogCategory = 'care' | 'vitals' | 'transcript' | 'agent';

export default function LogsPage({ data }: { data: HospitalData }) {
  const [category, setCategory] = useState<LogCategory>('care');
  const categories = [
    { id: 'care', name: 'Care events', icon: 'list' },
    { id: 'vitals', name: 'Vitals', icon: 'pulse' },
    { id: 'transcript', name: 'Transcript', icon: 'message' },
    { id: 'agent', name: 'Agent activity', icon: 'layers' },
  ] as const;
  const timelineData = {
    ...data,
    timeline: data.timeline.filter(row => category === 'agent' ? row.kind === 'thought' : row.kind === 'event'),
    live: category === 'agent' ? data.live : [],
  };

  return (
    <>
      <header className="page__head">
        <h1>Logs</h1>
        {data.incident && <StatusPill status={data.incident.status} />}
      </header>
      <div className="patient-log-picker">
        <label htmlFor="log-patient">Patient</label>
        <select id="log-patient" value={data.incident ? String(data.incident.id) : ''} disabled={!data.calls.length}
          onChange={e => go('/hospital/logs', BigInt(e.target.value))}>
          <option value="" disabled>{data.calls.length ? 'Select a patient' : 'No patients yet'}</option>
          {data.calls.map(({ incident, record, recording, recordingOnly }) => (
            <option key={String(incident.id)} value={String(incident.id)}>
              {patientLine(record) ?? (recordingOnly ? recording?.label : undefined) ?? 'Not identified'} · {unitLabel(incident)} · Call {String(incident.id)}
            </option>
          ))}
        </select>
        {data.incident && <a href={`/hospital/patient?incident=${data.incident.id}`} onClick={e => {
          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          go('/hospital/patient', data.incident!.id);
        }}>View patient <Icon name="arrow" size={14} /></a>}
      </div>
      <section className="card patient-logs" aria-label="Selected patient logs">
        <div className="tabs" role="tablist" aria-label="Log category">
          {categories.map(({ id, name, icon }) => (
            <button key={id} type="button" role="tab" id={`log-tab-${id}`} aria-controls="patient-log-panel"
              aria-selected={category === id} className={category === id ? 'is-on' : undefined}
              tabIndex={category === id ? 0 : -1}
              onKeyDown={e => {
                const index = categories.findIndex(tab => tab.id === id);
                const next = e.key === 'ArrowRight' ? (index + 1) % categories.length
                  : e.key === 'ArrowLeft' ? (index + categories.length - 1) % categories.length
                    : e.key === 'Home' ? 0 : e.key === 'End' ? categories.length - 1 : undefined;
                if (next === undefined) return;
                e.preventDefault();
                setCategory(categories[next].id);
                document.getElementById(`log-tab-${categories[next].id}`)?.focus();
              }}
              onClick={() => setCategory(id)}>
              <Icon name={icon} size={16} />{name}
            </button>
          ))}
        </div>
        <div id="patient-log-panel" className="tabs__body" role="tabpanel" tabIndex={0} aria-labelledby={`log-tab-${category}`}>
          {!data.incident ? <p className="empty">{!data.isActive ? 'Connecting to patient logs…' : new URLSearchParams(window.location.search).has('incident') ? 'Patient encounter not found. Choose a patient above.' : 'Choose a patient to view their logs.'}</p>
            : category === 'care' ? <CareLog key={String(data.incident.id)} events={data.timeline.filter(row => row.kind === 'event')} />
              : category === 'vitals' ? <VitalsLog key={String(data.incident.id)} rows={data.recordedVitals} />
            : category === 'transcript' ? <SpokenTranscript lines={data.spoken} videoStart={data.videoStart} />
              : !timelineData.timeline.length && !timelineData.live.length ? <p className="empty">{category === 'agent' ? 'No agent activity recorded for this call.' : 'No care events recorded for this call.'}</p>
                : <Timeline key={String(data.incident.id)} data={timelineData} />}
        </div>
      </section>
    </>
  );
}
