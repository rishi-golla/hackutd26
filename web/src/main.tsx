import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { makeConnectionBuilder } from './db/connection';
import HospitalPage from './routes/hospital/HospitalPage';
import BodycamPage from './routes/bodycam/BodycamPage';
import ControlsPage from './routes/controls/ControlsPage';
import './styles.css';

// Plain path routing: /hospital (hospital lane), /bodycam (camera lane), /controls (demo controls; hidden, so
// the index doesn't link it).
function Route() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/bodycam') return <BodycamPage />;
  if (path === '/controls') return <ControlsPage />;
  if (path === '/hospital') return <HospitalPage />;
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
      <Route />
    </SpacetimeDBProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
