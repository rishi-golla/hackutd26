// GENERATED from web/src/cpr/ by 'cd web && npm run build:hub-cpr'. Don't edit by hand (SPEC decision 21).
"use strict";
var HandoffCpr = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/cpr/phone.ts
  var phone_exports = {};
  __export(phone_exports, {
    hubMessage: () => hubMessage,
    start: () => start
  });

  // src/cpr/dsp.ts
  var SQRT_HALF = Math.SQRT1_2;
  var Biquad = class _Biquad {
    constructor(b0, b1, b2, a1, a2) {
      __publicField(this, "b0", b0);
      __publicField(this, "b1", b1);
      __publicField(this, "b2", b2);
      __publicField(this, "a1", a1);
      __publicField(this, "a2", a2);
      __publicField(this, "x1", 0);
      __publicField(this, "x2", 0);
      __publicField(this, "y1", 0);
      __publicField(this, "y2", 0);
      this.reset(0);
    }
    static design(kind, fs, f0, q = SQRT_HALF) {
      if (!(f0 > 0 && f0 < fs / 2)) throw new Error(`cut-off ${f0} Hz outside 0..fs/2`);
      const w0 = 2 * Math.PI * f0 / fs;
      const cw = Math.cos(w0);
      const alpha = Math.sin(w0) / (2 * q);
      const b0 = kind === "lowpass" ? (1 - cw) / 2 : (1 + cw) / 2;
      const b1 = kind === "lowpass" ? 1 - cw : -(1 + cw);
      const a0 = 1 + alpha;
      return new _Biquad(b0 / a0, b1 / a0, b0 / a0, -2 * cw / a0, (1 - alpha) / a0);
    }
    dcGain() {
      return (this.b0 + this.b1 + this.b2) / (1 + this.a1 + this.a2);
    }
    /** State as if x0 had been the input forever: no start-up transient. */
    reset(x0) {
      this.x1 = this.x2 = x0;
      this.y1 = this.y2 = this.dcGain() * x0;
    }
    process(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = x;
      this.y2 = this.y1;
      this.y1 = y;
      return y;
    }
    gainAt(f, fs) {
      const w = 2 * Math.PI * f / fs;
      const c1 = Math.cos(w), s1 = -Math.sin(w), c2 = Math.cos(2 * w), s2 = -Math.sin(2 * w);
      const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = this.b1 * s1 + this.b2 * s2;
      const dr = 1 + this.a1 * c1 + this.a2 * c2, di = this.a1 * s1 + this.a2 * s2;
      return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
  };
  var BandPass = class {
    constructor(fs, lowHz, highHz) {
      __publicField(this, "hp");
      __publicField(this, "lp");
      this.hp = Biquad.design("highpass", fs, lowHz);
      this.lp = Biquad.design("lowpass", fs, highHz);
    }
    reset(x0) {
      this.hp.reset(x0);
      this.lp.reset(0);
    }
    process(x) {
      return this.lp.process(this.hp.process(x));
    }
    gainAt(f, fs) {
      return this.hp.gainAt(f, fs) * this.lp.gainAt(f, fs);
    }
  };
  var PeakDetector = class {
    constructor(fs, opts = {}) {
      __publicField(this, "n", 0);
      __publicField(this, "refractory");
      __publicField(this, "thresholdFrac");
      __publicField(this, "decay");
      __publicField(this, "minProminence");
      __publicField(this, "dropFrac");
      __publicField(this, "prev", null);
      __publicField(this, "valley", Infinity);
      __publicField(this, "envelope", 0);
      __publicField(this, "candidate", null);
      __publicField(this, "lastPeak", null);
      this.refractory = Math.max(1, Math.round((opts.refractoryS || 0.3) * fs));
      this.thresholdFrac = opts.thresholdFrac === void 0 ? 0.5 : opts.thresholdFrac;
      this.decay = Math.exp(-1 / ((opts.envelopeTauS || 2) * fs));
      this.minProminence = opts.minProminence || 0;
      this.dropFrac = opts.dropFrac === void 0 ? 0.5 : opts.dropFrac;
      this.reset();
    }
    reset() {
      this.n = 0;
      this.prev = null;
      this.valley = Infinity;
      this.envelope = 0;
      this.candidate = null;
      this.lastPeak = null;
    }
    /** Feed one sample; returns the index of a newly confirmed peak, or null. */
    process(x) {
      const i = this.n++;
      const prev = this.prev;
      const c = this.candidate;
      this.prev = x;
      this.envelope *= this.decay;
      if (!c) {
        this.valley = Math.min(this.valley, x);
        if (prev !== null && x > prev && (this.lastPeak === null || i - this.lastPeak >= this.refractory) && x - this.valley > Math.max(this.minProminence, this.thresholdFrac * this.envelope)) {
          this.candidate = { i, v: x };
        }
        return null;
      }
      if (x > c.v) {
        c.i = i;
        c.v = x;
        return null;
      }
      const prominence = c.v - this.valley;
      if (c.v - x < this.dropFrac * prominence) return null;
      this.envelope = Math.max(this.envelope, prominence);
      this.lastPeak = c.i;
      this.valley = x;
      this.candidate = null;
      return c.i;
    }
  };
  function ratePerMinute(times, minI, maxI, minN) {
    const iv = [];
    for (let k = 1; k < times.length; k++) {
      const d = times[k] - times[k - 1];
      if (d >= minI && d <= maxI) iv.push(d);
    }
    if (iv.length < minN) return null;
    iv.sort((a, b) => a - b);
    const m = iv.length % 2 ? iv[(iv.length - 1) / 2] : (iv[iv.length / 2 - 1] + iv[iv.length / 2]) / 2;
    return 60 / m;
  }
  var CompressionDetector = class {
    constructor(opts = {}) {
      __publicField(this, "count", 0);
      __publicField(this, "lastPeakT", null);
      /** Times (s) of the last 12 compressions. */
      __publicField(this, "peakTimes", []);
      __publicField(this, "vertical", 0);
      __publicField(this, "y", 0);
      __publicField(this, "fs", null);
      __publicField(this, "gravityTauS");
      __publicField(this, "minProminence");
      __publicField(this, "pauseS");
      __publicField(this, "n", 0);
      __publicField(this, "lastT", null);
      __publicField(this, "dtAvg", null);
      __publicField(this, "g", null);
      __publicField(this, "bp", null);
      __publicField(this, "det", null);
      __publicField(this, "times", new Array(256));
      this.gravityTauS = opts.gravityTauS || 1.5;
      this.minProminence = opts.minProminence === void 0 ? 0.4 : opts.minProminence;
      this.pauseS = opts.pauseS || 10;
    }
    reset() {
      this.n = 0;
      this.lastT = null;
      this.dtAvg = null;
      this.g = null;
      this.fs = null;
      this.bp = null;
      this.det = null;
      this.times = new Array(256);
      this.peakTimes = [];
      this.count = 0;
      this.lastPeakT = null;
      this.y = 0;
      this.vertical = 0;
    }
    /** t in seconds; ax, ay, az in m/s² (including gravity). Returns the time of a new compression, or null. */
    process(t, ax, ay, az) {
      const dt = this.lastT === null ? 0 : t - this.lastT;
      if (this.lastT !== null && (dt <= 0 || dt > 0.5)) {
        this.lastT = t;
        return null;
      }
      this.lastT = t;
      if (dt > 0) this.dtAvg = this.dtAvg === null ? dt : 0.95 * this.dtAvg + 0.05 * dt;
      if (!this.g) this.g = [ax, ay, az];
      else {
        const a = dt / (this.gravityTauS + dt);
        this.g[0] += a * (ax - this.g[0]);
        this.g[1] += a * (ay - this.g[1]);
        this.g[2] += a * (az - this.g[2]);
      }
      const gn = Math.hypot(this.g[0], this.g[1], this.g[2]);
      if (gn < 1) return null;
      const v = ((ax - this.g[0]) * this.g[0] + (ay - this.g[1]) * this.g[1] + (az - this.g[2]) * this.g[2]) / gn;
      this.vertical = v;
      if (this.dtAvg === null || this.n < 10 && !this.bp) {
        this.n++;
        return null;
      }
      const fs = 1 / this.dtAvg;
      if (!this.bp || !this.fs || Math.abs(fs - this.fs) / this.fs > 0.2) {
        this.fs = fs;
        this.bp = new BandPass(fs, 0.7, Math.min(4, fs * 0.45));
        this.bp.reset(v);
        this.det = new PeakDetector(fs, { refractoryS: 0.25, thresholdFrac: 0.5, minProminence: this.minProminence });
      }
      this.y = this.bp.process(v);
      const k = this.det.n;
      this.times[k % this.times.length] = t;
      const idx = this.det.process(this.y);
      this.n++;
      if (idx === null) return null;
      const pt = this.times[idx % this.times.length];
      this.peakTimes.push(pt);
      if (this.peakTimes.length > 12) this.peakTimes.shift();
      this.count++;
      this.lastPeakT = pt;
      return pt;
    }
    /** `now` in the same clock as process(). */
    state(now) {
      const since = this.lastPeakT === null ? null : now - this.lastPeakT;
      const compressing = since !== null && since < 2.5;
      const recent = this.peakTimes.slice(-6);
      return {
        rate: compressing ? ratePerMinute(recent, 0.25, 1.5, 3) : null,
        count: this.count,
        sinceLast: since,
        compressing,
        paused: since !== null && since > this.pauseS,
        fs: this.fs
      };
    }
  };

  // src/cpr/beatSync.ts
  var ON_BEAT_MS = 120;
  var DEFAULT_OFFSET_MS = 0;
  var MAX_CALIBRATION_IQR_MS = 150;
  var MAX_OFFSET_MS = 200;
  function wrap(ms, periodMs) {
    let e = ms % periodMs;
    if (e > periodMs / 2) e -= periodMs;
    if (e <= -periodMs / 2) e += periodMs;
    return e;
  }
  var BeatSync = class {
    constructor(offsetMs = DEFAULT_OFFSET_MS, windowSize = 8, onBeatMs = ON_BEAT_MS) {
      __publicField(this, "offsetMs", offsetMs);
      __publicField(this, "windowSize", windowSize);
      __publicField(this, "onBeatMs", onBeatMs);
      __publicField(this, "grid", null);
      /** Corrected signed errors of the last `windowSize` compressions (ms). */
      __publicField(this, "window", []);
      /** Uncorrected errors, for calibration (ms). */
      __publicField(this, "raw", []);
    }
    /** The metronome's beats: t0 = time of any beat (s, compression clock), at `bpm`. */
    setGrid(t0, bpm) {
      const periodS = 60 / bpm;
      if (!this.grid || Math.abs(this.grid.periodS - periodS) > 1e-6) {
        this.window = [];
        this.raw = [];
      }
      this.grid = { t0, periodS };
    }
    clearGrid() {
      this.grid = null;
      this.window = [];
      this.raw = [];
    }
    /** Signed error (ms) of a compression at t against the nearest beat, after the offset; null without a beat. */
    addCompression(t) {
      if (!this.grid) return null;
      const periodMs = this.grid.periodS * 1e3;
      const raw = wrap((t - this.grid.t0) * 1e3, periodMs);
      this.raw.push(raw);
      if (this.raw.length > 40) this.raw.shift();
      const errorMs = wrap(raw - this.offsetMs, periodMs);
      this.window.push(errorMs);
      if (this.window.length > this.windowSize) this.window.shift();
      return { errorMs, onBeat: Math.abs(errorMs) <= this.onBeatMs };
    }
    stats() {
      const n = this.window.length;
      if (n === 0) return { n, onBeatPct: null, meanErrMs: null };
      const on = this.window.filter((e) => Math.abs(e) <= this.onBeatMs).length;
      const mean = this.window.reduce((a, b) => a + b, 0) / n;
      return { n, onBeatPct: 100 * on / n, meanErrMs: mean };
    }
    /**
     * Learn the rescuer's natural offset: the median uncorrected error of the last `minN`+ compressions made while
     * following the beat. Returns the new offset (ms), or null with too few compressions.
     */
    calibrate(minN = 8) {
      if (this.raw.length < minN) return null;
      const sorted = [...this.raw].sort((a, b) => a - b);
      const q = (f) => sorted[Math.min(sorted.length - 1, Math.round(f * (sorted.length - 1)))];
      const median = q(0.5);
      if (q(0.75) - q(0.25) > MAX_CALIBRATION_IQR_MS || Math.abs(median) > MAX_OFFSET_MS) return null;
      this.offsetMs = median;
      this.window = [];
      return this.offsetMs;
    }
    reset() {
      this.window = [];
      this.raw = [];
    }
  };

  // src/cpr/coach.ts
  var PAUSE_S = 10;
  var Coach = class {
    constructor() {
      __publicField(this, "mode", "idle");
      __publicField(this, "activeSince", 0);
    }
    step(i) {
      if (!i.inArrest) {
        this.mode = "idle";
        return { mode: "idle", metronome: false };
      }
      if (this.mode === "idle" || this.mode === "waiting_for_sensor") {
        if (!i.fingerDetected) {
          this.mode = "waiting_for_sensor";
          return { mode: this.mode, metronome: false };
        }
        this.activeSince = i.now;
      }
      const noCompressionS = Math.min(i.sinceLast ?? Infinity, i.now - this.activeSince);
      this.mode = noCompressionS >= PAUSE_S ? "paused" : "active";
      return { mode: this.mode, metronome: true };
    }
  };

  // src/cpr/metronome.ts
  var LOOKAHEAD_S = 0.1;
  var TICK_MS = 25;
  var Metronome = class {
    constructor(ctx) {
      __publicField(this, "ctx", ctx);
      __publicField(this, "bpm", 110);
      /** Called when a beat is scheduled: its output time (s, performance.now clock) and index. */
      __publicField(this, "onBeat");
      __publicField(this, "master");
      __publicField(this, "timer", null);
      __publicField(this, "nextBeatCtx", 0);
      __publicField(this, "index", 0);
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    }
    get running() {
      return this.timer !== null;
    }
    start(bpm = this.bpm) {
      if (this.running) return;
      this.bpm = bpm;
      this.index = 0;
      this.nextBeatCtx = this.ctx.currentTime + 0.15;
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.tick();
    }
    stop() {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
    }
    /** AudioContext time → performance.now() seconds at which that sound leaves the speaker. */
    toPerfSeconds(ctxTime) {
      const ts = this.ctx.getOutputTimestamp?.();
      if (ts && typeof ts.contextTime === "number" && typeof ts.performanceTime === "number" && ts.performanceTime > 0) {
        return ts.performanceTime / 1e3 + (ctxTime - ts.contextTime);
      }
      const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
      return performance.now() / 1e3 + (ctxTime - this.ctx.currentTime) + latency;
    }
    tick() {
      while (this.nextBeatCtx < this.ctx.currentTime + LOOKAHEAD_S) {
        this.click(this.nextBeatCtx);
        this.onBeat?.(this.toPerfSeconds(this.nextBeatCtx), this.index++);
        this.nextBeatCtx += 60 / this.bpm;
      }
    }
    /** A 40 ms 1.5 kHz click with a fast attack: sharp enough to compress to, short enough not to mask speech. */
    click(t) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.frequency.value = 1500;
      env.gain.setValueAtTime(1e-4, t);
      env.gain.exponentialRampToValueAtTime(0.9, t + 2e-3);
      env.gain.exponentialRampToValueAtTime(1e-4, t + 0.04);
      osc.connect(env).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.05);
    }
  };

  // src/cpr/stdbHttp.ts
  var some = (v) => v === void 0 || v === null ? { none: [] } : { some: v };
  var SpacetimeHttp = class {
    constructor(base, db2) {
      __publicField(this, "base", base);
      __publicField(this, "db", db2);
      __publicField(this, "token", null);
      __publicField(this, "key");
      this.base = base.replace(/\/$/, "");
      this.key = `handoff.stdb.token:${this.base}/${db2}`;
      try {
        this.token = localStorage.getItem(this.key);
      } catch {
      }
    }
    /** Calls a reducer. Throws on a network error or a non-2xx answer (the module's error text is in the message). */
    async call(reducer, args) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(`${this.base}/v1/database/${this.db}/call/${reducer}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${await this.identity()}`, "Content-Type": "application/json" },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(5e3)
        });
        if (r.ok) return;
        if (r.status === 401 && attempt === 0) {
          this.forget();
          continue;
        }
        throw new Error(`${reducer}: ${r.status} ${(await r.text()).slice(0, 200)}`);
      }
    }
    /** Runs one SQL query on public tables; returns its rows (each row is an array in column order). */
    async rows(query) {
      const r = await fetch(`${this.base}/v1/database/${this.db}/sql`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: query,
        signal: AbortSignal.timeout(5e3)
      });
      if (!r.ok) throw new Error(`sql: ${r.status}`);
      const out = await r.json();
      return out[0]?.rows ?? [];
    }
    async identity() {
      if (this.token) return this.token;
      const r = await fetch(`${this.base}/v1/identity`, { method: "POST", signal: AbortSignal.timeout(5e3) });
      if (!r.ok) throw new Error(`identity: ${r.status}`);
      this.token = (await r.json()).token;
      try {
        localStorage.setItem(this.key, this.token);
      } catch {
      }
      return this.token;
    }
    forget() {
      this.token = null;
      try {
        localStorage.removeItem(this.key);
      } catch {
      }
    }
  };

  // src/cpr/phone.ts
  var BPM = 110;
  var TICK_MS2 = 250;
  var PUSH_MS = 500;
  var STATUS_MS = 1e3;
  var FINGER_FRESH_MS = 4e3;
  var NO_FINGER = /* @__PURE__ */ new Set(["no_finger", "sensor_error"]);
  var params = new URLSearchParams(location.search);
  var db = new SpacetimeHttp(params.get("stdb") ?? "https://maincloud.spacetimedb.com", params.get("db") ?? "handoff-hackutd26");
  var det = new CompressionDetector();
  var sync = new BeatSync();
  var coach = new Coach();
  var metronome = null;
  var finger = { state: "", at: 0 };
  var inArrest = false;
  var statusOk = false;
  var pushOk = false;
  var mode = "idle";
  var countAtActive = 0;
  var activeAt = 0;
  var assistSent = false;
  var startedAt = 0;
  var lastPush = 0;
  var pushing = false;
  var $ = (id) => document.getElementById(id);
  function hubMessage(m, age) {
    if (m.what === "state" && age <= 4) finger = { state: String(m.value), at: Date.now() };
  }
  async function start() {
    if (metronome) return;
    try {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      const ctx = new Ctx({ latencyHint: "interactive" });
      const resumed = ctx.resume();
      const DME = DeviceMotionEvent;
      if (typeof DME.requestPermission === "function" && await DME.requestPermission() !== "granted") {
        throw new Error("Motion sensor blocked: CPR can\u2019t be measured");
      }
      await resumed;
      metronome = new Metronome(ctx);
      metronome.onBeat = (beatPerfS) => {
        sync.setGrid(beatPerfS, BPM);
        setTimeout(() => flash(), Math.max(0, beatPerfS * 1e3 - performance.now()));
      };
      startedAt = performance.now() / 1e3;
      window.addEventListener("devicemotion", onMotion);
      setInterval(tick, TICK_MS2);
      void pollStatus();
    } catch (err) {
      show({ error: err.message });
    }
  }
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const pt = det.process(e.timeStamp / 1e3, a.x, a.y, a.z);
    if (pt !== null && metronome?.running) sync.addCompression(pt);
  }
  async function pollStatus() {
    for (; ; ) {
      try {
        const rows = await db.rows("SELECT id, status FROM incident WHERE status != 'closed'");
        const newest = rows.sort((a, b) => Number(b[0]) - Number(a[0]))[0];
        inArrest = newest?.[1] === "arrest";
        statusOk = true;
      } catch {
        statusOk = false;
      }
      await new Promise((r) => setTimeout(r, STATUS_MS));
    }
  }
  function tick() {
    const now = performance.now() / 1e3;
    const st = det.state(now);
    const fingerOn = Date.now() - finger.at < FINGER_FRESH_MS && !NO_FINGER.has(finger.state);
    const prev = mode;
    const out = coach.step({ now, inArrest, fingerDetected: fingerOn, sinceLast: st.sinceLast });
    mode = out.mode;
    if ((prev === "idle" || prev === "waiting_for_sensor") && mode === "active") {
      countAtActive = st.count;
      activeAt = now;
    }
    if (prev !== "paused" && mode === "paused") sync.reset();
    const m = metronome;
    if (out.metronome && !m.running) m.start(BPM);
    if (!out.metronome && m.running) {
      m.stop();
      sync.clearGrid();
    }
    const bs = sync.stats();
    const onBeatPct = st.compressing && bs.n > 0 ? bs.onBeatPct : null;
    const assist = mode === "active" || mode === "paused";
    if (!pushing && now * 1e3 - lastPush >= PUSH_MS) {
      lastPush = now * 1e3;
      pushing = true;
      const sendAssist = mode !== "idle" || assistSent;
      db.call("push_cpr", [some(st.rate), st.count, st.sinceLast ?? now - startedAt, st.paused, st.compressing]).then(
        () => sendAssist ? db.call("push_cpr_assist", [assist, m.running ? BPM : 0, some(onBeatPct), some(onBeatPct === null ? null : bs.meanErrMs)]) : void 0
      ).then(
        () => {
          pushOk = true;
          if (sendAssist) assistSent = assist;
        },
        () => pushOk = false
      ).finally(() => pushing = false);
    }
    show({
      mode,
      rate: st.compressing ? st.rate : null,
      onBeatPct,
      meanErrMs: onBeatPct === null ? null : bs.meanErrMs,
      compressions: assist ? Math.max(0, st.count - countAtActive) : 0,
      // Capped at the time since the beat started, like the coach and the server (walking before CPR never counts).
      pausedS: mode === "paused" ? Math.min(st.sinceLast ?? Infinity, now - activeAt) : null
    });
  }
  var MODE_TEXT = {
    idle: "",
    waiting_for_sensor: "Place the finger sensor",
    active: "Compress with the beat",
    paused: "Paused"
  };
  function show(v) {
    const card = $("cpr");
    if (!card) return;
    if (v.error) {
      card.hidden = false;
      $("cprMode").textContent = v.error;
      return;
    }
    card.hidden = v.mode === "idle";
    const paused = v.pausedS != null ? ` ${Math.round(v.pausedS)} s` : "";
    $("cprMode").textContent = MODE_TEXT[v.mode] + paused + (statusOk && pushOk ? "" : " \xB7 offline");
    $("cprRate").textContent = v.rate != null ? String(Math.round(v.rate)) : "\u2014";
    $("cprRate").classList.toggle("bad", v.rate != null && (v.rate < 100 || v.rate > 120));
    const timing = v.onBeatPct == null ? "" : `${Math.round(v.onBeatPct)}% on the beat` + (v.meanErrMs != null && Math.abs(v.meanErrMs) >= 40 ? ` \xB7 ${Math.abs(Math.round(v.meanErrMs))} ms ${v.meanErrMs > 0 ? "late" : "early"}` : "");
    $("cprBeat").textContent = [timing, v.compressions ? `${v.compressions} compressions` : ""].filter(Boolean).join(" \xB7 ");
  }
  function flash() {
    const dot = $("cprDot");
    if (!dot) return;
    dot.classList.add("on");
    setTimeout(() => dot.classList.remove("on"), 120);
  }
  return __toCommonJS(phone_exports);
})();
