import { lazy, Suspense, StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { makeConnectionBuilder } from './db/connection';
const HospitalApp = lazy(() => import('./routes/hospital/HospitalApp'));
const ClassicHospitalPage = lazy(() => import('./routes/hospital/HospitalPage'));
import BodycamPage from './routes/bodycam/BodycamPage';
import ControlsPage from './routes/controls/ControlsPage';
import './styles.css';

// Plain path routing: /hospital and its pages (hospital lane), /bodycam (camera lane), /controls (demo controls;
// hidden, so the index doesn't link it).
function Route() {
  const [path, setPath] = useState(() => window.location.pathname.replace(/\/+$/, ''));
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname.replace(/\/+$/, ''));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  if (path === '/bodycam') return <BodycamPage />;
  if (path === '/controls') return <ControlsPage />;
  if (path === '/hospital/classic') return <ClassicHospitalPage />;
  if (['/hospital', '/hospital/patients', '/hospital/patient', '/hospital/tracing', '/hospital/logs'].includes(path)) return <HospitalApp />;
  return (
    <main className="index">
      <h1>Handoff</h1>
      <p>Prototype · synthetic data · not a medical device</p>
      <ul>
        <li><a href="/hospital">/hospital</a> — hospital dashboard</li>
        <li><a href="/bodycam">/bodycam</a> — chest bodycam</li>
      </ul>
    </main>
  );
}

function Root() {
  const connectionBuilder = useMemo(() => makeConnectionBuilder(), []);
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <Suspense fallback={<main className="placeholder">Loading dashboard…</main>}><Route /></Suspense>
    </SpacetimeDBProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
