// SpacetimeDB connection for the agent: connect, subscribe to what the workflows read, wait until applied.
import { DbConnection, tables } from './module_bindings';
import { CONFIG } from './config';

export type Conn = DbConnection;

export function connect(): Promise<Conn> {
  return new Promise((resolve, reject) => {
    let settled = false;
    DbConnection.builder()
      .withUri(CONFIG.spacetimeHost)
      .withDatabaseName(CONFIG.dbName)
      .withAutomaticReconnect()
      .onConnect((conn, identity) => {
        console.log(`[agent] connected to ${CONFIG.dbName} as ${identity.toHexString().slice(0, 12)}`);
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
            tables.hospital,
            tables.vitals,
            tables.cprState,
            tables.transcript,
            tables.event,
            tables.erMessage,
            tables.patientRecord,
            tables.report,
          ]);
      })
      .onConnectError((_ctx, err) => {
        if (!settled) reject(err);
        else console.error('[agent] connection error', err);
      })
      .build();
  });
}

/** Write one trace step (H5). Steps attach to the active incident. Never throws. */
export async function step(conn: Conn, workflow: string, tool: string, summary: string) {
  console.log(`[${workflow}] ${tool ? `${tool}: ` : ''}${summary}`);
  try {
    await conn.reducers.logAgentStep({ workflow, tool, summary: summary.slice(0, 300) });
  } catch (err) {
    console.error('[agent] log_agent_step failed', err);
  }
}
