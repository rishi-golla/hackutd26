// Live Operations: every call the ER can see, what's coming in next, and the latest activity across calls.
// Real data only: the counts come from the incident and event tables; no capacity or ETA trends are invented.
import { go } from './HospitalApp';
import { LiveView } from './PatientPage';
import { Card, Icon, StatusPill, patientLine, time } from './ui';
import { etaMinutes } from './vitals';
import type { HospitalData } from './useHospital';

export default function OpsPage({ data }: { data: HospitalData }) {
  const { calls, now } = data;
  const active = calls.filter(c => c.incident.status !== 'closed');
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const today = calls.filter(c => Number(c.incident.startedAt.microsSinceUnixEpoch / 1000n) >= midnight);
  const flagged = active.reduce((n, c) => n + c.flagged, 0);
  const incoming = active.filter(c => c.incident.status === 'en_route' && c.incident.etaAt).sort((a, b) => Number(a.incident.etaAt!.microsSinceUnixEpoch - b.incident.etaAt!.microsSinceUnixEpoch))[0];
  const featured = incoming ?? active[0];
  const etaOf = (c: (typeof calls)[number]) =>
    etaMinutes(c.incident.status, c.incident.etaAt, now);

  return (
    <>
      <header className="page__head">
        <div>
          <h1>Live Operations</h1>
        </div>
        <span className={`conn${data.isActive ? ' is-on' : ''}`}>{data.isActive ? 'Live' : 'Connecting…'}</span>
      </header>

      <div className="stats">
        <Stat tone="violet" icon="ambulance" label="Active calls" value={String(active.length)} note={active.length === 1 ? active[0].incident.unit : undefined} />
        <Stat tone="green" icon="clock" label="Next arrival" value={incoming ? `${etaOf(incoming)} min` : '—'} note={incoming?.incident.unit} />
        <Stat tone="amber" icon="flag" label="Pending read-backs" value={String(flagged)} />
        <Stat tone="blue" icon="calendar" label="Calls today" value={String(today.length)} />
      </div>

      <div className="ops">
        <Card title="Live ambulance view" icon="trace" right={<span className="small muted">{active[0]?.incident.unit ?? 'No active call'}</span>} className="ops__scene">
          <LiveView available={data.hasLiveCall} />
        </Card>

        <Card title={incoming ? 'Next arrival' : 'Current patient'} icon="user" className="ops__incoming">
          {featured ? (
            <div className="incoming">
              <p className="incoming__eta">{incoming ? <>{etaOf(incoming)}<span>min</span></> : <StatusPill status={featured.incident.status} />}</p>
              <p className="incoming__who">{patientLine(featured.record) ?? 'Patient not identified'}</p>
              <p className="incoming__where">{featured.incident.unit}{featured.destination ? ` · ${featured.destination.name}` : ''}</p>
              {featured.record?.allergies.length ? <p className="incoming__allergy">Allergy: {featured.record.allergies.join(', ')}</p> : null}
              <button type="button" className="action action--soft" onClick={() => go('/hospital/patient', featured.incident.id)}>View patient</button>
            </div>
          ) : <div className="incoming"><p className="incoming__eta">—</p><p className="incoming__where">No active patient</p><p className="muted small">Recent calls remain available below.</p></div>}
        </Card>

        <Card title="Active & recent calls" icon="ambulance" right={<span className="count">{calls.length}</span>} className="ops__calls">
          {calls.length === 0 ? <p className="empty">No calls yet. One starts when a bodycam goes on scene.</p> : (
            <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Unit</th><th>Status</th><th>ETA</th><th>Patient</th><th>Latest update</th></tr></thead>
              <tbody>
                {calls.map(c => {
                  const eta = etaOf(c);
                  return (
                    <tr key={String(c.incident.id)} onClick={() => go('/hospital/patient', c.incident.id)} tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && go('/hospital/patient', c.incident.id)}>
                      <td><a href={`/hospital/patient?incident=${c.incident.id}`} onClick={e => { e.preventDefault(); e.stopPropagation(); go('/hospital/patient', c.incident.id); }} className="unit"><Icon name="ambulance" size={16} />{c.incident.unit}</a></td>
                      <td><StatusPill status={c.incident.status} /></td>
                      <td>{eta !== undefined ? `${eta} min` : '—'}</td>
                      <td>{patientLine(c.record) ?? <span className="muted">Not identified</span>}</td>
                      <td className="ellipsis" title={c.latest?.label}>{c.latest ? c.latest.label : <span className="muted">—</span>}{c.flagged > 0 && <span className="tag tag--amber">{c.flagged} awaiting</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </Card>

        <Card title="Activity Feed" icon="pulse" className="ops__feed">
          {data.activity.length === 0 ? <p className="empty">No activity yet.</p> : (
            <ol className="feed">
              {data.activity.map(a => (
                <li key={a.key} className={a.flagged ? 'is-alarm' : undefined}>
                  <span className="feed__dot" />
                  <span className="feed__time">{time(a.t)}</span>
                  <span className="feed__text">{data.unitOf(a.incidentId) && <b>{data.unitOf(a.incidentId)} · </b>}{a.text}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({ tone, icon, label, value, note }: { tone: string; icon: string; label: string; value: string; note?: string }) {
  return (
    <div className={`stat stat--${tone}`}>
      <span className="stat__icon"><Icon name={icon} /></span>
      <p className="stat__label">{label}</p>
      <p className="stat__value">{value}</p>
      {note && <p className="stat__note">{note}</p>}
    </div>
  );
}
