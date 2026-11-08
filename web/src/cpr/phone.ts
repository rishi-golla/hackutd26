// CPR assistance on the chest phone (SPEC decision 21), for hub/phone.html. Built into hub/cpr.js with
// `npm run build:hub-cpr`; the page loads it and exposes it as `HandoffCpr`.
//
//   hub "state" (finger sensor) ─┐
//   Maincloud incident status ───┼▶ Coach (every 250 ms): mode, metronome on/off
//   DeviceMotion → CompressionDetector → BeatSync ◀ Metronome   (one clock: performance.now)
//   push_cpr + push_cpr_assist every 500 ms → Maincloud (dashboard, §15 rules, report)
//
// The phone plays the beat and measures. It speaks nothing: the §15 rules turn the data into callouts ("Push
// faster", "Follow the beat", "Place the finger sensor") and the voice worker speaks them, one voice for everything.
// The page calls hubMessage() for each hub message and start() inside the Start tap (sound and motion need a tap).
// Testing against another database: ?stdb=http://127.0.0.1:3000&db=handoff-local
import { CompressionDetector } from './dsp';
import { BeatSync } from './beatSync';
import { Coach, type Mode } from './coach';
import { Metronome } from './metronome';
import { SpacetimeHttp, some } from './stdbHttp';

const BPM = 110;
const TICK_MS = 250;
const PUSH_MS = 500;
const STATUS_MS = 1000;
/** The sensor repeats its state every second; older than this = no sensor. */
const FINGER_FRESH_MS = 4000;
const NO_FINGER = new Set(['no_finger', 'sensor_error']);

const params = new URLSearchParams(location.search);
const db = new SpacetimeHttp(params.get('stdb') ?? 'https://maincloud.spacetimedb.com', params.get('db') ?? 'handoff-hackutd26');

const det = new CompressionDetector();
const sync = new BeatSync();
const coach = new Coach();
let metronome: Metronome | null = null;
let finger = { state: '', at: 0 };
let inArrest = false;
let statusOk = false;
let pushOk = false;
let mode: Mode = 'idle';
let countAtActive = 0;
let activeAt = 0;
/** Last `assist` sent: after going idle, one more push says assist=false, then nothing until the next arrest. */
let assistSent = false;
let startedAt = 0;
let lastPush = 0;
let pushing = false;

const $ = (id: string) => document.getElementById(id);

/** Every hub message: the finger sensor's state (repeated each second by the sensor). */
export function hubMessage(m: { what: string; value: unknown }, age: number): void {
  if (m.what === 'state' && age <= 4) finger = { state: String(m.value), at: Date.now() };
}

/** Call inside the Start tap, before anything is awaited: unlocks sound and asks for motion where needed (iOS). */
export async function start(): Promise<void> {
  if (metronome) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    const resumed = ctx.resume();
    const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DME.requestPermission === 'function' && (await DME.requestPermission()) !== 'granted') {
      throw new Error('Motion sensor blocked: CPR can’t be measured');
    }
    await resumed;
    metronome = new Metronome(ctx);
    metronome.onBeat = beatPerfS => {
      sync.setGrid(beatPerfS, BPM); // re-anchor on every beat: no drift between the audio and motion clocks
      setTimeout(() => flash(), Math.max(0, beatPerfS * 1000 - performance.now()));
    };
    startedAt = performance.now() / 1000;
    window.addEventListener('devicemotion', onMotion);
    setInterval(tick, TICK_MS);
    void pollStatus();
  } catch (err) {
    show({ error: (err as Error).message });
  }
}

function onMotion(e: DeviceMotionEvent): void {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x === null || a.y === null || a.z === null) return;
  const pt = det.process(e.timeStamp / 1000, a.x, a.y, a.z);
  if (pt !== null && metronome?.running) sync.addCompression(pt);
}

/** Is the incident in arrest? Asked once a second; on a failed query the last answer stands. */
async function pollStatus(): Promise<void> {
  for (;;) {
    try {
      const rows = await db.rows("SELECT id, status FROM incident WHERE status != 'closed'");
      const newest = rows.sort((a, b) => Number(b[0]) - Number(a[0]))[0];
      inArrest = newest?.[1] === 'arrest';
      statusOk = true;
    } catch {
      statusOk = false;
    }
    await new Promise(r => setTimeout(r, STATUS_MS));
  }
}

function tick(): void {
  const now = performance.now() / 1000;
  const st = det.state(now);
  const fingerOn = Date.now() - finger.at < FINGER_FRESH_MS && !NO_FINGER.has(finger.state);
  const prev = mode;
  const out = coach.step({ now, inArrest, fingerDetected: fingerOn, sinceLast: st.sinceLast });
  mode = out.mode;
  if ((prev === 'idle' || prev === 'waiting_for_sensor') && mode === 'active') {
    countAtActive = st.count;
    activeAt = now;
  }
  if (prev !== 'paused' && mode === 'paused') sync.reset(); // a pause ends the old rhythm

  const m = metronome!;
  if (out.metronome && !m.running) m.start(BPM);
  if (!out.metronome && m.running) {
    m.stop();
    sync.clearGrid();
  }

  const bs = sync.stats();
  // Timing only while compressing; otherwise "no data", never a fake 0 %.
  const onBeatPct = st.compressing && bs.n > 0 ? bs.onBeatPct : null;
  const assist = mode === 'active' || mode === 'paused';

  if (!pushing && now * 1000 - lastPush >= PUSH_MS) {
    lastPush = now * 1000;
    pushing = true;
    // push_cpr first: it creates the cpr_state row that push_cpr_assist updates. push_cpr_assist only goes out
    // while armed in an arrest (the server reads "armed, assist false" as waiting for the finger sensor), plus once
    // more after leaving it to say assist=false.
    const sendAssist = mode !== 'idle' || assistSent;
    db.call('push_cpr', [some(st.rate), st.count, st.sinceLast ?? now - startedAt, st.paused, st.compressing])
      .then(() =>
        sendAssist
          ? db.call('push_cpr_assist', [assist, m.running ? BPM : 0, some(onBeatPct), some(onBeatPct === null ? null : bs.meanErrMs)])
          : undefined
      )
      .then(
        () => {
          pushOk = true;
          if (sendAssist) assistSent = assist;
        },
        () => (pushOk = false)
      )
      .finally(() => (pushing = false));
  }

  show({
    mode,
    rate: st.compressing ? st.rate : null,
    onBeatPct,
    meanErrMs: onBeatPct === null ? null : bs.meanErrMs,
    compressions: assist ? Math.max(0, st.count - countAtActive) : 0,
    // Capped at the time since the beat started, like the coach and the server (walking before CPR never counts).
    pausedS: mode === 'paused' ? Math.min(st.sinceLast ?? Infinity, now - activeAt) : null,
  });
}

// ---- the CPR card in phone.html (ids cpr, cprMode, cprRate, cprBeat, cprDot)

const MODE_TEXT: Record<Mode, string> = {
  idle: '',
  waiting_for_sensor: 'Place the finger sensor',
  active: 'Compress with the beat',
  paused: 'Paused',
};

function show(v: {
  mode?: Mode;
  rate?: number | null;
  onBeatPct?: number | null;
  meanErrMs?: number | null;
  compressions?: number;
  pausedS?: number | null;
  error?: string;
}): void {
  const card = $('cpr');
  if (!card) return;
  if (v.error) {
    card.hidden = false;
    $('cprMode')!.textContent = v.error;
    return;
  }
  card.hidden = v.mode === 'idle';
  const paused = v.pausedS != null ? ` ${Math.round(v.pausedS)} s` : '';
  $('cprMode')!.textContent = MODE_TEXT[v.mode!] + paused + (statusOk && pushOk ? '' : ' · offline');
  $('cprRate')!.textContent = v.rate != null ? String(Math.round(v.rate)) : '—';
  $('cprRate')!.classList.toggle('bad', v.rate != null && (v.rate < 100 || v.rate > 120)); // §15 target 100–120
  const timing =
    v.onBeatPct == null
      ? ''
      : `${Math.round(v.onBeatPct)}% on the beat` +
        (v.meanErrMs != null && Math.abs(v.meanErrMs) >= 40 ? ` · ${Math.abs(Math.round(v.meanErrMs))} ms ${v.meanErrMs > 0 ? 'late' : 'early'}` : '');
  $('cprBeat')!.textContent = [timing, v.compressions ? `${v.compressions} compressions` : ''].filter(Boolean).join(' · ');
}

function flash(): void {
  const dot = $('cprDot');
  if (!dot) return;
  dot.classList.add('on');
  setTimeout(() => dot.classList.remove('on'), 120);
}
