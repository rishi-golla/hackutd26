// CPR assistance on the chest phone (spec decision 18). Wires the pieces together:
//   DeviceMotion → CompressionDetector → BeatSync ← Metronome     (one clock: performance.now)
//   Coach (every 250 ms): mode, metronome on/off, one cue → speak()
//   push_cpr + push_cpr_assist every 500 ms → SpacetimeDB (dashboard, rules, report)
// It starts on its own: when the incident goes into arrest (the voice gate's confirmed "starting CPR", or the demo
// control) and the finger sensor is on. It needs one tap first (start()) so the browser allows sound and motion.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, type DbConnection } from '../module_bindings';
import { CompressionDetector } from './dsp';
import { BeatSync } from './beatSync';
import { Coach, type Mode } from './coach';
import { Metronome } from './metronome';
import { isSpeaking, onSpeakingChange, speak, warmUpSpeech } from './speech';

const BPM = 110;
const TICK_MS = 250;
const PUSH_MS = 500;
const VITALS_FRESH_MS = 5000;
const CALIBRATE_MS = 10_000;
const OFFSET_KEY = 'handoff.cpr.offsetMs';

export type CprView = {
  started: boolean;
  error: string | null;
  mode: Mode;
  rate: number | null;
  compressions: number;
  onBeatPct: number | null;
  meanErrMs: number | null;
  lastCue: string | null;
  fingerDetected: boolean;
  inArrest: boolean;
  calibrating: boolean;
  offsetMs: number;
  sensorHz: number | null;
};

function readOffset(): number {
  try {
    const v = Number(localStorage.getItem(OFFSET_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function useCprAssist() {
  const { getConnection } = useSpacetimeDB();
  const [incidents] = useTable(tables.incident);
  const [vitals] = useTable(tables.vitals);
  const [cprRows] = useTable(tables.cprState);

  // Inputs from the database, read by the tick through refs (the tick runs outside React's render).
  const incident = useMemo(
    () => [...incidents].filter(i => i.status !== 'closed').sort((a, b) => (a.id < b.id ? 1 : -1))[0],
    [incidents]
  );
  const latestVitals = useMemo(() => [...vitals].sort((a, b) => (a.id < b.id ? 1 : -1))[0], [vitals]);
  const inArrestRef = useRef(false);
  const vitalsRef = useRef<{ status: string; atMs: number } | null>(null);
  const overrideRef = useRef(false);
  inArrestRef.current = incident?.status === 'arrest';
  // The demo's "CPR slow / CPR good" control: the server speaks from it, the phone keeps only the beat.
  overrideRef.current = !!incident && cprRows.some(c => c.incidentId === incident.id && c.source === 'override');
  vitalsRef.current = latestVitals ? { status: latestVitals.status, atMs: Number(latestVitals.ts.microsSinceUnixEpoch / 1000n) } : null;

  const det = useRef(new CompressionDetector());
  const sync = useRef(new BeatSync(readOffset()));
  const coach = useRef(new Coach());
  const metronome = useRef<Metronome | null>(null);
  const startedAt = useRef(0);
  const lastPush = useRef(0);
  const calibrateUntil = useRef(0);
  const lastMode = useRef<Mode>('idle');
  /** Detector count when assistance became active: the panel shows compressions since then. */
  const countAtActive = useRef(0);
  const [beatAt, setBeatAt] = useState(0);
  const [view, setView] = useState<CprView>({
    started: false,
    error: null,
    mode: 'idle',
    rate: null,
    compressions: 0,
    onBeatPct: null,
    meanErrMs: null,
    lastCue: null,
    fingerDetected: false,
    inArrest: false,
    calibrating: false,
    offsetMs: sync.current.offsetMs,
    sensorHz: null,
  });

  const fingerDetected = () => {
    const v = vitalsRef.current;
    return !!v && Date.now() - v.atMs < VITALS_FRESH_MS && v.status !== 'no finger';
  };

  const onMotion = useCallback((e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const pt = det.current.process(e.timeStamp / 1000, a.x, a.y, a.z);
    if (pt !== null && metronome.current?.running) sync.current.addCompression(pt);
  }, []);

  const tick = useCallback(() => {
    const now = performance.now() / 1000;
    const st = det.current.state(now);
    const override = overrideRef.current;
    const out = coach.current.step({
      now,
      inArrest: inArrestRef.current,
      fingerDetected: fingerDetected(),
      rate: st.rate,
      compressing: st.compressing,
      sinceLast: st.sinceLast,
      onBeatPct: sync.current.stats().onBeatPct,
      beatN: sync.current.stats().n,
      speaking: isSpeaking(),
      override,
    });
    const prev = lastMode.current;
    lastMode.current = out.mode;
    if ((prev === 'idle' || prev === 'waiting_for_sensor') && out.mode === 'active') countAtActive.current = st.count;
    // A pause ends the old rhythm: the next on-beat % only counts compressions after it.
    if (prev !== 'paused' && out.mode === 'paused') sync.current.reset();
    const bs = sync.current.stats();
    // Timing data only while compressing on the real motion data; otherwise "no data", never a fake 0 %.
    const beatData = st.compressing && !override && bs.n > 0;

    const m = metronome.current;
    if (m && out.metronome && !m.running) m.start(BPM);
    if (m && !out.metronome && m.running) {
      m.stop();
      sync.current.clearGrid();
    }
    if (out.cue) speak(out.cue.text, out.cue.priority);

    // Calibration window: after 10 s of compressing with the beat, learn the rescuer's offset.
    let calibrating = calibrateUntil.current > 0;
    if (calibrating && Date.now() >= calibrateUntil.current) {
      calibrateUntil.current = 0;
      calibrating = false;
      const offset = sync.current.calibrate(8);
      if (offset !== null) {
        try {
          localStorage.setItem(OFFSET_KEY, String(Math.round(offset)));
        } catch {
          // private mode: the offset lasts for this session only
        }
      }
    }

    const assist = out.mode === 'active' || out.mode === 'paused';
    if (now * 1000 - lastPush.current >= PUSH_MS) {
      lastPush.current = now * 1000;
      const conn = getConnection() as DbConnection | null;
      if (conn) {
        // One connection keeps call order, so push_cpr (which creates the row) always lands first.
        void conn.reducers
          .pushCpr({
            rate: st.rate ?? undefined,
            count: st.count,
            // Before the first compression: seconds since the page started (SPEC §22.4); the server caps it.
            sinceLastS: st.sinceLast ?? now - startedAt.current,
            paused: st.paused,
            compressing: st.compressing,
          })
          .catch(() => {});
        void conn.reducers
          .pushCprAssist({
            assist,
            bpm: m?.running ? BPM : 0,
            onBeatPct: beatData ? bs.onBeatPct! : undefined,
            phaseErrMs: beatData ? bs.meanErrMs! : undefined,
          })
          .catch(() => {});
      }
    }

    setView(v => ({
      ...v,
      mode: out.mode,
      rate: st.rate,
      compressions: assist ? Math.max(0, st.count - countAtActive.current) : 0,
      onBeatPct: beatData ? bs.onBeatPct : null,
      meanErrMs: beatData ? bs.meanErrMs : null,
      lastCue: out.cue ? out.cue.text : v.lastCue,
      fingerDetected: fingerDetected(),
      inArrest: inArrestRef.current,
      calibrating,
      offsetMs: sync.current.offsetMs,
      sensorHz: st.fs,
    }));
  }, [getConnection]);

  /** Must run inside a tap: unlocks audio, motion and speech on mobile browsers. */
  const start = useCallback(async () => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ latencyHint: 'interactive' });
      await ctx.resume();
      const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof DME.requestPermission === 'function' && (await DME.requestPermission()) !== 'granted') {
        throw new Error('Motion sensor permission was denied');
      }
      warmUpSpeech();
      const m = new Metronome(ctx);
      m.onBeat = beatPerfS => {
        // Re-anchor on every beat, so audio-clock drift against performance.now never builds up.
        sync.current.setGrid(beatPerfS, BPM);
        const delay = beatPerfS * 1000 - performance.now();
        setTimeout(() => setBeatAt(performance.now()), Math.max(0, delay));
      };
      metronome.current = m;
      startedAt.current = performance.now() / 1000;
      window.addEventListener('devicemotion', onMotion);
      // The browser drops the wake lock whenever the page is hidden; ask again each time it's shown.
      const lock = () =>
        (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock
          ?.request('screen')
          .catch(() => {}); // no wake lock: the screen may dim, the beat keeps going while the page is visible
      await lock();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void lock();
      });
      setView(v => ({ ...v, started: true, error: null }));
    } catch (err) {
      setView(v => ({ ...v, error: (err as Error).message }));
    }
  }, [onMotion]);

  /** Compress with the beat for 10 s; then the rescuer's natural timing becomes "on the beat". */
  const calibrate = useCallback(() => {
    sync.current.reset();
    calibrateUntil.current = Date.now() + CALIBRATE_MS;
  }, []);

  useEffect(() => {
    if (!view.started) return;
    const id = setInterval(tick, TICK_MS);
    const unduck = onSpeakingChange(s => metronome.current?.duck(s));
    return () => {
      clearInterval(id);
      unduck();
    };
  }, [view.started, tick]);

  useEffect(
    () => () => {
      window.removeEventListener('devicemotion', onMotion);
      metronome.current?.stop();
    },
    [onMotion]
  );

  return { view, beatAt, start, calibrate };
}
