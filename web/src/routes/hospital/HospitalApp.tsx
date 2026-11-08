// Hospital dashboard (hospital lane, spec §14, decision 25): pages behind one top navigation bar.
//   /hospital           Live Operations: every call, what's coming in, the activity feed
//   /hospital/patients  patient encounters: choose a call to view its patient details
//   /hospital/patient   one patient: live view, vitals, record, care timeline, ER messages, the handoff report
//   /hospital/tracing   one session: live view, status phases, events, transcript, the agents' decision log
//   /hospital/logs      selected patient's care events, transcript and agent activity (not in the navigation; "All logs" on Live Operations)
// ?incident=<id> picks the call; without it, the newest. Only real data: nothing is invented to fill a panel.
import { useEffect, useState } from 'react';
import OpsPage from './OpsPage';
import PatientPage from './PatientPage';
import PatientsPage from './PatientsPage';
import LogsPage from './LogsPage';
import TracingPage from './TracingPage';
import { Icon } from './ui';
import { selectedIncidentId, useHospital } from './useHospital';
import handoffMark from './handoff-mark.svg';
import './hospital.css';

type Page = 'ops' | 'patients' | 'patient' | 'tracing' | 'logs';
const PAGES: { page: Page; path: string; label: string; icon: string }[] = [
  { page: 'ops', path: '/hospital', label: 'Live Operations', icon: 'grid' },
  { page: 'patients', path: '/hospital/patients', label: 'Patients', icon: 'user' },
  { page: 'tracing', path: '/hospital/tracing', label: 'Tracing', icon: 'pulse' },
];

const pageOf = (path: string): Page => (path.endsWith('/patients') ? 'patients' : path.endsWith('/patient') ? 'patient' : path.endsWith('/tracing') ? 'tracing' : path.endsWith('/logs') ? 'logs' : 'ops');

/** Client-side navigation: the pages share one SpacetimeDB connection, so they never reload. */
export function go(path: string, incident?: bigint | null) {
  const url = incident !== undefined ? `${path}?incident=${incident}` : path;
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function HospitalApp() {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname.replace(/\/+$/, ''), incident: selectedIncidentId() }));
  const [dark, setDark] = useState(() => localStorage.getItem('handoff.hospital.dark') === '1');
  useEffect(() => {
    const onPop = () => setLoc({ path: window.location.pathname.replace(/\/+$/, ''), incident: selectedIncidentId() });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => localStorage.setItem('handoff.hospital.dark', dark ? '1' : '0'), [dark]);

  const page = pageOf(loc.path);
  const data = useHospital(loc.incident, page === 'ops');
  // Tracing stays on the selected call; Patients always returns to the list.
  const keep = loc.incident;

  return (
    <div className={`ha ha--${page}${dark ? ' ha--dark' : ''}`}>
      <div className="shell">
      <header className="top">
        <div className="brand">
          <img className="brand__mark" src={handoffMark} alt="" width="32" height="32" />
          <span className="brand__name">Handoff</span>
        </div>
        <nav className="nav" aria-label="Main menu">
          {PAGES.map(p => {
            const selected = p.page === 'tracing' ? keep : undefined;
            return (
            <a key={p.page} href={selected !== undefined ? `${p.path}?incident=${selected}` : p.path} className={`nav__item${page === p.page || (p.page === 'patients' && page === 'patient') ? ' is-on' : ''}`}
              onClick={e => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                go(p.path, selected);
              }}>
              <Icon name={p.icon} />{p.label}
            </a>
          ); })}
        </nav>
        <div className="top__end">
          <span className="top__note">Demo · synthetic patient data</span>
          <a className="round" href="/hospital/classic" title="Classic dashboard" aria-label="Classic dashboard"><Icon name="monitor" /></a>
          <div className="theme" role="group" aria-label="Theme">
            <button type="button" aria-pressed={!dark} aria-label="Light mode" onClick={() => setDark(false)}><Icon name="sun" /></button>
            <button type="button" aria-pressed={dark} aria-label="Dark mode" onClick={() => setDark(true)}><Icon name="moon" /></button>
          </div>
        </div>
      </header>
      <main className="main">
        {page === 'ops' && <OpsPage data={data} />}
        {page === 'patients' && <PatientsPage data={data} />}
        {page === 'patient' && <PatientPage data={data} />}
        {page === 'tracing' && <TracingPage data={data} />}
        {page === 'logs' && <LogsPage data={data} />}
      </main>
      </div>
    </div>
  );
}
