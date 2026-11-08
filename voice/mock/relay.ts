// Fake sensor using the relay HTTP contract (spec §22.2a).
import { CONFIG } from '../src/config';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[i + 1];
};
const scenario = option('--scenario', 'normal');
const device = option('--device', 'relay-mock');
const hz = Number(option('--hz', '1'));
if (!['normal', 'deteriorate', 'arrest', 'nofinger', 'seizure'].includes(scenario) || !Number.isFinite(hz) || hz <= 0) {
  throw new Error('Usage: --scenario normal|deteriorate|arrest|seizure|nofinger --device NAME --hz POSITIVE');
}
const base = CONFIG.spacetimeHttp.replace(/\/$/, '');
const identity = await fetch(`${base}/v1/identity`, { method: 'POST' });
if (!identity.ok) throw new Error(`identity ${identity.status}: ${await identity.text()}`);
const { token } = await identity.json() as { token: string };
if (!token) throw new Error('identity response did not include a token');
async function call(name: string, body: unknown[]) {
  try {
    const response = await fetch(`${base}/v1/database/${encodeURIComponent(CONFIG.dbName)}/call/${name}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) console.error(`${name} ${response.status}: ${await response.text()}`);
    return response.ok;
  } catch (error) { console.error(`${name}:`, error); return false; }
}
const start = Date.now();
let hr = 72;
let sampleIndex = 0;
let lastStatus = 0;
if (scenario === 'seizure') {
  if (await call('synthesize_seizure', [true])) console.log('Seizure override enabled; server now generates the sensor rows.');
}
const sendVitals = () => {
  const progress = Math.min(1, (Date.now() - start) / 60000);
  const noFinger = scenario === 'arrest' || scenario === 'nofinger';
  hr = scenario === 'deteriorate' ? 96 + 74 * progress : 72 + (Math.random() * 6 - 3);
  const spo2 = scenario === 'deteriorate' ? 97 - 17 * progress : 97 + (Math.random() * 2 - 1);
  const data = { hr: noFinger ? null : Math.round(hr), spo2: noFinger ? null : Math.round(spo2 * 10) / 10,
    temp_c: 36.4, status: noFinger ? 'no finger' : 'pulse', simulated: true };
  void call('push_vitals', [device, JSON.stringify(data)]);
  if (Date.now() - lastStatus >= 1000) {
    lastStatus = Date.now();
    console.log(`[${scenario}] ${data.status} HR ${data.hr ?? '—'} SpO2 (experimental) ${data.spo2 ?? '—'} temp ${data.temp_c} °C`);
  }
};
const sendWaveform = () => {
  const samples = Array.from({ length: 5 }, () => Math.round(110000 + 2000 * Math.sin(2 * Math.PI * (hr / 60) * sampleIndex++ / 25)));
  void call('push_waveform', [device, JSON.stringify({ samples, rate_hz: 25, simulated: true })]);
};
sendVitals(); sendWaveform();
const vitalsTimer = setInterval(sendVitals, 1000 / hz);
const waveformTimer = setInterval(sendWaveform, 200);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  clearInterval(vitalsTimer); clearInterval(waveformTimer);
  if (scenario === 'seizure') await call('synthesize_seizure', [false]);
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
