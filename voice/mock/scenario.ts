// Automated storyboard using the same terminal mouth and CPR source (spec §7).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect, activeIncident } from '../src/db';
import { Cpr, Mouth, sleep, transcript } from './lib';

const fast = process.argv.includes('--fast');
const delay = (seconds: number) => sleep(seconds * 1000 * (fast ? 0.5 : 1));
const heard: { time: string; text: string; priority: number }[] = [];
const conn = await connect('scenario');
const cpr = new Cpr(conn);
const mouth = new Mouth(!process.argv.includes('--no-say'), message => heard.push({ time: new Date().toISOString(), text: message.text, priority: message.priority }));
const relay = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./relay.ts', import.meta.url)), '--scenario', 'normal'], { stdio: 'inherit' });
relay.on('error', error => console.error('relay:', error));
const heartbeat = () => void conn.reducers.heartbeat({ device: 'bodycam', kind: 'bodycam' }).catch(error => console.error('heartbeat:', error));
heartbeat();
const heartbeatTimer = setInterval(heartbeat, 10000);
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true; clearInterval(heartbeatTimer); cpr.close(); mouth.close(); relay.kill('SIGTERM'); conn.disconnect();
}
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });
const control = async (action: string) => { console.log(`> /${action}`); await conn.reducers.demoControl({ action, arg: '' }); };
const speak = async (text: string) => { console.log(`> ${text}`); await transcript(text); };
try {
  await control('reset');
  await conn.reducers.startIncident({ unit: 'Medic 12' });
  await delay(3);
  const incident = activeIncident(conn);
  if (!incident) throw new Error('started incident did not appear');
  await speak('Patient is Jordan Avery, born March 14, 1968');
  await delay(6); await control('arrest');
  cpr.set(90); await delay(15); cpr.set(110); await delay(10);
  cpr.set('pause'); await delay(12); cpr.set(110);
  await speak('Administering one milligram of epi IO');
  await delay(8); await speak('Giving three hundred milligrams of amiodarone');
  await delay(6); await speak('Correction');
  await delay(5); await control('en_route');
  await delay(5); await control('arrived');
  await delay(3); await conn.reducers.requestReport({});
  const deadline = Date.now() + 30000;
  let report = [...conn.db.report.iter()].find(row => row.incidentId === incident.id && row.status === 'ready');
  while (!report && Date.now() < deadline) {
    await sleep(250);
    report = [...conn.db.report.iter()].find(row => row.incidentId === incident.id && row.status === 'ready');
  }
  if (!report) throw new Error('report did not become ready within 30 seconds');
  const content = JSON.parse(report.contentJson) as { sections?: { key: string; title?: string; lines?: unknown[] }[] };
  console.log('\nCallouts heard:');
  for (const item of heard) console.log(`${item.time} [P${item.priority}] ${item.text}`);
  if (!heard.length) console.log('(none)');
  console.log('\nReport section line counts:');
  if (!Array.isArray(content.sections)) throw new Error('ready report has no sections array');
  for (const section of content.sections) console.log(`${section.title ?? section.key}: ${section.lines?.length ?? 0}`);
} catch (error) {
  console.error('scenario:', error); process.exitCode = 1;
} finally {
  cleanup();
}
