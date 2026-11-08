// Handoff workflow agent: W1 destination + pre-arrival alert, W4 handoff report, W6 patient record (EHR pull).
// Run ONE instance for the shared database, or workflows run twice.
//   cd agent && npm install && npm start
import { connect, type Conn } from './db';
import { CONFIG, llmConfigured } from './config';
import { runW1 } from './w1';
import { runW4 } from './w4';
import { claimPull, IDENTITY_HINT, runW6Pull, runW6Transcript } from './w6';
import type { Incident, Report, Transcript } from './module_bindings/types';

const running = new Set<string>();
const arrivalRequested = new Set<bigint>();
const done = new Set<string>();

/** Run a workflow at most once per key, never twice at the same time. */
function once(key: string, fn: () => Promise<void>) {
  if (running.has(key) || done.has(key)) return;
  // One W4 per incident at a time: a second request while it runs is covered by the report it's writing.
  const w4Prefix = key.match(/^W4:\d+:/)?.[0];
  if (w4Prefix && [...running].some(k => k.startsWith(w4Prefix))) return;
  running.add(key);
  fn()
    .catch(err => console.error(`[agent] ${key} failed`, err))
    .finally(() => {
      running.delete(key);
      done.add(key);
    });
}

function onIncident(conn: Conn, inc: Incident) {
  // W1: arrest or en route, and no destination yet.
  if ((inc.status === 'arrest' || inc.status === 'en_route') && inc.destinationId === undefined) {
    once(`W1:${inc.id}`, () => runW1(conn, inc.id, inc.status));
  }
  // W4 also runs when the incident arrives and nobody pressed Generate Handoff.
  if (inc.status === 'arrived') {
    const hasReport = [...conn.db.report.iter()].some(r => r.incidentId === inc.id);
    if (!hasReport) {
      once(`arrived:${inc.id}`, async () => {
        console.log(`[agent] incident ${inc.id} arrived: requesting the report`);
        arrivalRequested.add(inc.id);
        await conn.reducers.requestReport({});
      });
    }
  }

  // W6: a patient was identified and this incident has no record for them yet.
  const ref = inc.patientRef;
  if (ref && inc.status !== 'closed') {
    const rec = [...conn.db.patientRecord.iter()].find(r => r.incidentId === inc.id);
    if (rec?.patientRef !== ref && claimPull(inc.id, ref)) once(`W6:${inc.id}:${ref}`, () => runW6Pull(conn, inc.id, ref));
  }
}

/** One transcript check per incident at a time; lines that arrive meanwhile get one more check after it. */
const w6Busy = new Set<bigint>();
const w6Again = new Set<bigint>();

function onTranscript(conn: Conn, line: Transcript) {
  if (!IDENTITY_HINT.test(line.text)) return;
  const inc = conn.db.incident.id.find(line.incidentId);
  if (!inc || inc.status === 'closed' || inc.patientRef) return;
  if ([...conn.db.patientRecord.iter()].some(r => r.incidentId === inc.id)) return;
  if (w6Busy.has(inc.id)) {
    w6Again.add(inc.id);
    return;
  }
  w6Busy.add(inc.id);
  runW6Transcript(conn, inc.id)
    .catch(err => console.error(`[agent] W6 transcript ${inc.id} failed`, err))
    .finally(() => {
      w6Busy.delete(inc.id);
      if (w6Again.delete(inc.id)) onTranscript(conn, line);
    });
}

function onReport(conn: Conn, report: Report) {
  if (report.status !== 'requested') return;
  // A new request (a second Generate Handoff click) has a new requestedAt, so it runs again.
  const trigger = arrivalRequested.has(report.incidentId) ? 'status ARRIVED' : 'Generate Handoff';
  once(`W4:${report.incidentId}:${report.requestedAt.microsSinceUnixEpoch}`, () => runW4(conn, report.incidentId, trigger));
}

async function main() {
  console.log(
    `[agent] ${CONFIG.dbName} · Nemotron ${llmConfigured() ? `on (${CONFIG.model})` : 'OFF: no NVIDIA_API_KEY, template fallback only'}`
  );
  const conn = await connect();

  conn.db.incident.onInsert((_ctx, row) => onIncident(conn, row));
  conn.db.incident.onUpdate((_ctx, _old, row) => onIncident(conn, row));
  conn.db.report.onInsert((_ctx, row) => onReport(conn, row));
  conn.db.report.onUpdate((_ctx, _old, row) => onReport(conn, row));
  conn.db.transcript.onInsert((_ctx, row) => onTranscript(conn, row));

  // Catch up on anything already waiting when the agent starts.
  for (const inc of conn.db.incident.iter()) onIncident(conn, inc);
  for (const r of conn.db.report.iter()) onReport(conn, r);

  // Show up in the device table (connection dots).
  const beat = () => conn.reducers.heartbeat({ device: 'agent', kind: 'agent' }).catch(() => {});
  void beat();
  setInterval(beat, 10_000);
  console.log('[agent] watching for: status arrest / en_route (W1), Generate Handoff or arrived (W4), patient identified or name + birth date said (W6)');
}

main().catch(err => {
  console.error('[agent] fatal', err);
  process.exit(1);
});
