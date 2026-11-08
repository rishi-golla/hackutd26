// Hospital dashboard (hospital lane, spec §14, decision 25): three pages behind one sidebar.
//   /hospital           Live Operations: every call, what's coming in, the activity feed
//   /hospital/patient   one patient: live view, vitals, record, care timeline, ER messages, the handoff report
//   /hospital/tracing   one session: live view, status phases, events, transcript, the agents' decision log
// ?incident=<id> picks the call; without it, the newest. Only real data: nothing is invented to fill a panel.
import { useEffect, useState } from 'react';
import OpsPage from './OpsPage';
import PatientPage from './PatientPage';
import TracingPage from './TracingPage';
import { Icon } from './ui';
import { selectedIncidentId, useHospital } from './useHospital';
import './hospital.css';

type Page = 'ops' | 'patient' | 'tracing';
const PAGES: { page: Page; path: string; label: string; icon: string }[] = [
  { page: 'ops', path: '/hospital', label: 'Live Operations', icon: 'grid' },
  { page: 'patient', path: '/hospital/patient', label: 'Patient', icon: 'user' },
  { page: 'tracing', path: '/hospital/tracing', label: 'Tracing', icon: 'trace' },
];

const pageOf = (path: string): Page => (path.endsWith('/patient') ? 'patient' : path.endsWith('/tracing') ? 'tracing' : 'ops');

/** Client-side navigation: the pages share one SpacetimeDB connection, so they never reload. */
export function go(path: string, incident?: bigint) {
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
  const data = useHospital(loc.incident);
  // Patient and Tracing stay on the call being viewed when switching pages.
  const keep = loc.incident ?? undefined;

  return (
    <div className={`ha ha--${page}${dark ? ' ha--dark' : ''}`}>
      <aside className="side">
        <div className="brand">
          <span className="brand__mark"><svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M11 3h6v8h8v6h-8v8h-6v-8H3v-6h8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M14 7v14M7 14h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".25" /></svg></span>
          <span className="brand__name">Handoff<small>Hospital</small></span>
        </div>
        <nav className="nav">
          <p className="nav__label">Main Menu</p>
          {PAGES.map(p => (
            <a key={p.page} href={p.path} className={`nav__item${page === p.page ? ' is-on' : ''}`}
              onClick={e => { e.preventDefault(); go(p.path, p.page === 'ops' ? undefined : keep); }}>
              <Icon name={p.icon} />{p.label}
            </a>
          ))}
        </nav>
        <div className="side__foot">
          <a className="nav__item classic-link" href="/hospital/classic"><Icon name="monitor" />Classic dashboard</a>
          <button type="button" className="dark" onClick={() => setDark(d => !d)} aria-pressed={dark}>
            <Icon name="moon" />Dark mode<span className={`switch${dark ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
          <p className="side__note">Demo · synthetic patient data</p>
        </div>
      </aside>
      <main className="main">
        {page === 'ops' && <OpsPage data={data} />}
        {page === 'patient' && <PatientPage data={data} />}
        {page === 'tracing' && <TracingPage data={data} />}
      </main>
    </div>
  );
}
