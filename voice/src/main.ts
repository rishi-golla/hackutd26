// Handoff voice agent worker (spec §19): the Nemotron brain behind the bodycam's voice.
// Run ONE instance per database. Never runs W1 or W4 (those are agent/).
//   cd voice && npm install && npm start
import { connect } from './db';
import { CONFIG } from './config';
import { Brain } from './brain';
import { Policy } from './policy';
import { Speaker } from './speaker';
import { startApi } from './api';

async function main() {
  console.log(`[voice] ${CONFIG.dbName} @ ${CONFIG.spacetimeHost} · EHR ${CONFIG.ehrBaseUrl}`);
  const conn = await connect('voice');
  const speaker = new Speaker(conn);
  const policy = new Policy(conn);
  const brain = new Brain(conn, speaker, policy);
  brain.start();
  startApi(conn, brain, speaker);

  // Show up in the device table (connection dots).
  const beat = () => conn.reducers.heartbeat({ device: 'voice', kind: 'voice' }).catch(() => {});
  void beat();
  setInterval(beat, 10_000);

  const shutdown = () => {
    brain.stop();
    speaker.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[voice] fatal', err);
  process.exit(1);
});
