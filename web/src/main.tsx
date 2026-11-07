import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { makeConnectionBuilder } from './db/connection';
import HospitalPage from './routes/hospital/HospitalPage';
import BodycamPage from './routes/bodycam/BodycamPage';
import MonitorPage from './routes/monitor/MonitorPage';
import './styles.css';

// Plain path routing: /hospital (hospital lane), /bodycam (camera lane), /monitor (unassigned).
function Route() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/bodycam') return <BodycamPage />;
  if (path === '/monitor') return <MonitorPage />;
  if (path === '/hospital') return <HospitalPage />;
  return (
    <main className="index">
      <h1>Handoff</h1>
      <p>Prototype · synthetic data · not a medical device</p>
      <ul>
        <li><a href="/hospital">/hospital</a> — hospital dashboard</li>
        <li><a href="/bodycam">/bodycam</a> — chest bodycam</li>
        <li><a href="/monitor">/monitor</a> — monitor tablet</li>
      </ul>
    </main>
  );
}

function Root() {
  const connectionBuilder = useMemo(() => makeConnectionBuilder(), []);
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <Route />
    </SpacetimeDBProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
