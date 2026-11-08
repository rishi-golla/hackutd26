// SpacetimeDB connection for the voice worker: connect, subscribe to the state it summarizes, wait until applied.
// Reads everything the brain and the mocks need; writes only through existing reducers (spec §22.6).
import { DbConnection, tables } from './module_bindings';
import type { Incident } from './module_bindings/types';
import { CONFIG } from './config';

export type Conn = DbConnection;

export const WORKFLOW = 'voice';

export function connect(label = 'voice'): Promise<Conn> {
  return new Promise((resolve, reject) => {
    let settled = false;
    DbConnection.builder()
      .withUri(CONFIG.spacetimeHost)
      .withDatabaseName(CONFIG.dbName)
      .withAutomaticReconnect()
      .onConnect((conn, identity) => {
        console.log(`[${label}] connected to ${CONFIG.dbName} as ${identity.toHexString().slice(0, 12)}`);
        if (settled) return; // reconnects replay subscriptions on their own
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            settled = true;
            resolve(conn);
          })
          .onError(ctx => reject(ctx.event ?? new Error('subscription failed')))
          .subscribe([
            tables.incident,
            tables.device,
            tables.hospital,
            tables.vitals,
            tables.cprState,
            tables.transcript,
            tables.event,
            tables.timer,
            tables.callout,
            tables.erMessage,
            tables.agentStep,
            tables.patientRecord,
            tables.report,
            tables.vitalsOverride,
          ]);
      })
      .onConnectError((_ctx, err) => {
        if (!settled) reject(err);
        else console.error(`[${label}] connection error`, err);
      })
      .build();
  });
}

/** Write one trace step (H5) under workflow "voice". Attaches to the active incident. Never throws. */
export async function step(conn: Conn, tool: string, summary: string) {
  console.log(`[voice] ${tool ? `${tool}: ` : ''}${summary}`);
  try {
    await conn.reducers.logAgentStep({ workflow: WORKFLOW, tool, summary: summary.slice(0, 300) });
  } catch (err) {
    console.error('[voice] log_agent_step failed', err);
  }
}

/** The newest incident that is not closed, or undefined (same rule as the module's activeIncident). */
export function activeIncident(conn: Conn): Incident | undefined {
  let best: Incident | undefined;
  for (const row of conn.db.incident.iter()) {
    if (row.status !== 'closed' && (!best || row.id > best.id)) best = row;
  }
  return best;
}
