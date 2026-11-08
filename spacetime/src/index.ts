// Handoff SpacetimeDB module: reducers. Owned by the hospital lane (see AGENTS.md "Lanes").
// Other lanes: ask before changing anything here. Contract and examples: spacetime/README.md.
// Spec references: tables and reducers §22, lifecycle §9, callout rules §15.
// Edge devices (the Pi relay) call reducers over plain HTTP, so their reducers take
// (device: string, json: string) as in spec §22. Browser clients use typed arguments.
//
// This entry file exports only the schema (default) and reducers/lifecycle hooks.

import { t, SenderError } from 'spacetimedb/server';
import spacetimedb, { tickSchedule } from './schema';
import {
  activeIncident,
  activeIncidentId,
  latestIncident,
  applyStatus,
  beginIncident,
  cancelTimers,
  deleteAll,
  ensureSeedAndTick,
  num,
  parseJson,
  plusSeconds,
  queueCallout,
  recordEvent,
  secondsBetween,
  setCprOverride,
  setTimer,
  str,
  touchDevice,
  endVitalsOverride,
  startVitalsOverride,
  startCpr,
  vitalsOverrideRow,
  writeSyntheticFrame,
} from './helpers';
import { runRules } from './rules';
import { attachRecording, importRecording, shouldPruneVitals, startCameraSession } from './sessions';

export default spacetimedb;

/** Every relay message must say whether it is simulated, so fake vitals can never pass as real (spec R4/R7). */
function requireSimulatedFlag(d: Record<string, unknown>): boolean {
  const flag = d.simulated ?? d.simulate;
  if (typeof flag !== 'boolean') throw new SenderError('json must include "simulated": true|false');
  return flag;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const init = spacetimedb.init(ctx => {
  ensureSeedAndTick(ctx);
});

export const onConnect = spacetimedb.clientConnected(_ctx => {});
export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {});

// ---------------------------------------------------------------------------
// Scheduled: once a second
// ---------------------------------------------------------------------------

export const tickRules = spacetimedb.reducer(
  { onSchedule: tickSchedule },
  { timer: tickSchedule.rowType },
  ctx => {
    const now = ctx.timestamp;
    // Encounter vitals are retained until explicit reset. Only unassigned preview vitals expire after 30 min.
    for (const r of [...ctx.db.waveform.iter()]) {
      if (secondsBetween(r.ts, now) > 30) ctx.db.waveform.id.delete(r.id);
    }
    for (const r of [...ctx.db.vitals.iter()]) {
      if (shouldPruneVitals(r.incidentId, secondsBetween(r.ts, now))) ctx.db.vitals.id.delete(r.id);
    }
    for (const r of [...ctx.db.rtcSignal.iter()]) {
      if (secondsBetween(r.ts, now) > 600) ctx.db.rtcSignal.id.delete(r.id);
    }
    for (const r of [...ctx.db.callout.iter()]) {
      if (r.spokenAt === undefined && secondsBetween(r.createdAt, now) > 20) ctx.db.callout.id.delete(r.id);
    }

    // A synthetic scenario (synthesize_seizure) replaces the relay's data, one row per second.
    const override = vitalsOverrideRow(ctx);
    if (override) writeSyntheticFrame(ctx, override.scenario, override.startedAt);

    const inc = activeIncident(ctx);
    if (inc) runRules(ctx, inc);
  }
);

// ---------------------------------------------------------------------------
// Relay (HTTP). Arguments: [device, json]. See README for curl examples.
// ---------------------------------------------------------------------------

/** json: {"hr":72.1,"spo2":97.5,"temp_c":36.4,"status":"pulse","simulated":false}. Use null for no reading. */
export const pushVitals = spacetimedb.reducer(
  { device: t.string(), json: t.string() },
  (ctx, { device, json }) => {
    const d = parseJson(json);
    const simulated = requireSimulatedFlag(d);
    touchDevice(ctx, device, 'relay');
    if (vitalsOverrideRow(ctx)) return; // synthesize_seizure is on: its rows replace the relay's
    const status = str(d.status, 'unknown');
    // Only 'pulse' means hr/spo2 are valid. Never store a stale or made-up number (spec R4).
    const valid = status === 'pulse';
    ctx.db.vitals.insert({
      id: 0n,
      incidentId: activeIncidentId(ctx),
      ts: ctx.timestamp,
      device,
      hr: valid ? num(d.hr) : undefined,
      spo2: valid ? num(d.spo2 ?? d.spo2_exp) : undefined,
      tempC: num(d.temp_c),
      status,
      simulated,
    });
  }
);

/** json: {"samples":[109876, ...],"rate_hz":25,"simulated":false}. Up to 200 samples per batch. */
export const pushWaveform = spacetimedb.reducer(
  { device: t.string(), json: t.string() },
  (ctx, { device, json }) => {
    const d = parseJson(json);
    const simulated = requireSimulatedFlag(d);
    touchDevice(ctx, device, 'relay');
    if (vitalsOverrideRow(ctx)) return; // synthesize_seizure is on: its rows replace the relay's
    const samples = Array.isArray(d.samples) ? d.samples.filter(v => typeof v === 'number').slice(0, 200) : [];
    if (samples.length === 0) return;
    ctx.db.waveform.insert({
      id: 0n,
      incidentId: activeIncidentId(ctx),
      ts: ctx.timestamp,
      device,
      samples: samples as number[],
      rateHz: num(d.rate_hz) ?? 25,
      simulated,
    });
  }
);

/** MARK. json: {} or {"note":"pill bottle by the bed","source":"voice"}. Relay default source: MARK. */
export const mark = spacetimedb.reducer(
  { device: t.string(), json: t.string() },
  (ctx, { device, json }) => {
    const d = parseJson(json);
    const inc = activeIncident(ctx);
    if (!inc) return;
    const note = str(d.note);
    const sourceKind = str(d.source, device.startsWith('relay') ? 'MARK' : 'voice');
    recordEvent(ctx, inc.id, 'mark', note ? `MARK: "${note}"` : 'MARK', sourceKind, note || device);
  }
);

/** Relay button hold: starts an incident if none is active, otherwise closes the active one. */
export const toggleIncident = spacetimedb.reducer({ device: t.string() }, (ctx, { device }) => {
  if (activeIncident(ctx)) applyStatus(ctx, 'closed', 'MARK', 'relay hold');
  else beginIncident(ctx, 'Medic 12', 'MARK');
  touchDevice(ctx, device, 'relay');
});

// ---------------------------------------------------------------------------
// Synthetic scenarios (/controls; agent or hotkey callers not decided yet, §28)
// ---------------------------------------------------------------------------

/**
 * active = true: override the relay's sensor data with the hardcoded seizure scenario
 * (spacetime/src/scenarios.ts), one row per second, stored with simulated = true. Replaces another scenario
 * (arrest, rosc) if one is on; a no-op if the seizure is already on.
 * active = false: stop the seizure; the relay's real data flows again. Leaves an arrest/rosc scenario alone.
 */
export const synthesizeSeizure = spacetimedb.reducer({ active: t.bool() }, (ctx, { active }) => {
  if (active) {
    startVitalsOverride(ctx, 'seizure', 'synthesize_seizure');
  } else if (vitalsOverrideRow(ctx)?.scenario === 'seizure') {
    endVitalsOverride(ctx, activeIncident(ctx)?.id, 'synthesize_seizure');
  }
});

// ---------------------------------------------------------------------------
// Incident lifecycle (any client)
// ---------------------------------------------------------------------------

export const startIncident = spacetimedb.reducer(
  { unit: t.string() },
  (ctx, { unit }) => {
    beginIncident(ctx, unit, 'tap');
  }
);

/** The bridge calls this after receiving actual frames from a new harness session, not on dashboard visits. */
export const startBodycamSession = spacetimedb.reducer(
  { device: t.string(), sessionId: t.string(), unit: t.string() },
  (ctx, { device, sessionId, unit }) => startCameraSession(ctx, device, sessionId, unit)
);

/**
 * status: on_scene | arrest | rosc | en_route | arrived | closed
 * sourceKind/sourceDetail = the chip and evidence, e.g. ("voice", "her heart stopped") or ("tap", "monitor").
 */
export const setStatus = spacetimedb.reducer(
  { status: t.string(), sourceKind: t.string(), sourceDetail: t.string() },
  (ctx, { status, sourceKind, sourceDetail }) => {
    applyStatus(ctx, status, sourceKind || 'tap', sourceDetail);
  }
);

export const heartbeat = spacetimedb.reducer({ device: t.string(), kind: t.string() }, (ctx, { device, kind }) => {
  touchDevice(ctx, device, kind);
});

// ---------------------------------------------------------------------------
// Bodycam
// ---------------------------------------------------------------------------

/** The phone detector output {rate, count, sinceLast, paused, compressing} (AGENTS.md 4.3). */
export const pushCpr = spacetimedb.reducer(
  {
    rate: t.option(t.f32()),
    count: t.u32(),
    sinceLastS: t.f32(),
    paused: t.bool(),
    compressing: t.bool(),
  },
  (ctx, { rate, count, sinceLastS, paused, compressing }) => {
    touchDevice(ctx, 'bodycam', 'bodycam');
    const inc = activeIncident(ctx);
    const incidentId = inc?.id ?? 0n;
    const existing = ctx.db.cprState.incidentId.find(incidentId);
    if (existing?.source === 'override') return; // demo control wins until cleared

    const inArrest = inc?.status === 'arrest';
    const countRate = inArrest && compressing && rate !== undefined;
    const row = {
      incidentId,
      rate,
      count,
      sinceLastS,
      paused,
      compressing,
      source: 'motion',
      updatedAt: ctx.timestamp,
      cycleStartedAt: existing?.cycleStartedAt ?? inc?.arrestStartedAt,
      rateSum: (existing?.rateSum ?? 0) + (countRate ? rate : 0),
      rateSamples: (existing?.rateSamples ?? 0) + (countRate ? 1 : 0),
      countBase: existing && count >= existing.countBase ? existing.countBase : count,
      // A pause can't be longer than the arrest so far.
      longestPauseS: Math.max(
        existing?.longestPauseS ?? 0,
        inArrest && inc?.arrestStartedAt ? Math.min(sinceLastS, secondsBetween(inc.arrestStartedAt, ctx.timestamp)) : 0
      ),
    };
    if (existing) ctx.db.cprState.incidentId.update(row);
    else ctx.db.cprState.insert(row);
  }
);

export const addTranscript = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  const clean = text.trim().slice(0, 500);
  if (!clean) return;
  ctx.db.transcript.insert({ id: 0n, incidentId: activeIncidentId(ctx), ts: ctx.timestamp, text: clean });
});

/** sender: bodycam | hospital; kind: offer | answer | ice; payload: JSON string. */
export const sendRtcSignal = spacetimedb.reducer(
  { sessionId: t.string(), sender: t.string(), kind: t.string(), payload: t.string() },
  (ctx, { sessionId, sender, kind, payload }) => {
    ctx.db.rtcSignal.insert({ id: 0n, ts: ctx.timestamp, sessionId, sender, kind, payload });
  }
);

/** method: "ID card" | "voice" | "manual". The bodycam's W6 then pulls the record. */
export const identifyPatient = spacetimedb.reducer(
  { patientRef: t.string(), method: t.string() },
  (ctx, { patientRef, method }) => {
    const inc = activeIncident(ctx);
    if (!inc) throw new SenderError('no active incident');
    ctx.db.incident.id.update({ ...inc, patientRef, updatedAt: ctx.timestamp });
    recordEvent(ctx, inc.id, 'patient_identified', `Patient identified (${patientRef})`, method, patientRef);
  }
);

/**
 * Generic timeline write (read-backs, findings, procedures).
 * kind: med_<drug> (e.g. med_epinephrine), shock, airway, mark, finding, ...
 * sourceKind: voice | read-back | label | tap | ...
 */
export const logEvent = spacetimedb.reducer(
  { kind: t.string(), label: t.string(), sourceKind: t.string(), sourceDetail: t.string() },
  (ctx, { kind, label, sourceKind, sourceDetail }) => {
    const inc = activeIncident(ctx);
    if (!inc) throw new SenderError('no active incident');
    // The medic saying CPR is starting (voice agent) starts CPR: the cycle timer, fresh stats, one timeline row.
    if (kind === 'cpr_started') return startCpr(ctx, sourceKind, sourceDetail);
    recordEvent(ctx, inc.id, kind, label, sourceKind, sourceDetail);
  }
);

/** status: logged | flagged | confirmed | cancelled (e.g. "Correction" within 10 s). */
export const setEventStatus = spacetimedb.reducer(
  { eventId: t.u64(), status: t.string() },
  (ctx, { eventId, status }) => {
    const row = ctx.db.event.id.find(eventId);
    if (!row) throw new SenderError('no such event');
    if (ctx.db.incident.id.find(row.incidentId)?.status === 'closed') throw new SenderError('incident is closed (read-only)');
    ctx.db.event.id.update({ ...row, status });
    if (status === 'cancelled' && row.kind === 'med_epinephrine') cancelTimers(ctx, row.incidentId, 'epi');
  }
);

export const calloutSpoken = spacetimedb.reducer({ calloutId: t.u64() }, (ctx, { calloutId }) => {
  const row = ctx.db.callout.id.find(calloutId);
  if (row && row.spokenAt === undefined) ctx.db.callout.id.update({ ...row, spokenAt: ctx.timestamp });
});

/** For W6 and the agent: queue words for the bodycam. priority 0–3 (spec §15). */
export const addCallout = spacetimedb.reducer({ text: t.string(), priority: t.u8() }, (ctx, { text, priority }) => {
  queueCallout(ctx, activeIncidentId(ctx), text, priority);
});

/** For W6: save the record pulled from the mock EHR. source: EHR | cached. */
export const savePatientRecord = spacetimedb.reducer(
  {
    patientRef: t.string(),
    name: t.string(),
    birthDate: t.string(),
    allergies: t.array(t.string()),
    medications: t.array(t.string()),
    conditions: t.array(t.string()),
    codeStatus: t.string(),
    source: t.string(),
  },
  (ctx, args) => {
    const incidentId = activeIncidentId(ctx);
    const row = { incidentId, ...args, updatedAt: ctx.timestamp };
    if (ctx.db.patientRecord.incidentId.find(incidentId)) ctx.db.patientRecord.incidentId.update(row);
    else ctx.db.patientRecord.insert(row);
  }
);

/** Agent trace step (W1, W4, W6). */
export const logAgentStep = spacetimedb.reducer(
  { workflow: t.string(), tool: t.string(), summary: t.string() },
  (ctx, { workflow, tool, summary }) => {
    ctx.db.agentStep.insert({ id: 0n, incidentId: activeIncidentId(ctx), ts: ctx.timestamp, workflow, tool, summary });
  }
);

// ---------------------------------------------------------------------------
// Monitor tablet
// ---------------------------------------------------------------------------

const TAPS: Record<string, { kind: string; label: string }> = {
  // A tap carries no dose; the read-back (voice) supplies it when the events merge.
  EPI: { kind: 'med_epinephrine', label: 'Epinephrine (tap)' },
  AMIO: { kind: 'med_amiodarone', label: 'Amiodarone (tap)' },
  SHOCK: { kind: 'shock', label: 'Shock delivered' },
  AIRWAY: { kind: 'airway', label: 'Airway placed' },
  MARK: { kind: 'mark', label: 'MARK' },
};

/** button: EPI | AMIO | SHOCK | AIRWAY | ROSC | MARK. Undo = set_event_status(id, "cancelled"). */
export const monitorTap = spacetimedb.reducer({ button: t.string() }, (ctx, { button }) => {
  if (button === 'ROSC') return applyStatus(ctx, 'rosc', 'tap', 'monitor');
  const tap = TAPS[button];
  if (!tap) throw new SenderError(`unknown button '${button}'`);
  const inc = activeIncident(ctx);
  if (!inc) throw new SenderError('no active incident');
  recordEvent(ctx, inc.id, tap.kind, tap.label, 'tap', 'monitor');
});

/**
 * Hidden demo controls (D1). action:
 *  start | arrest | rosc | en_route | arrived | close | reset |
 *  cpr_start | cpr_slow | cpr_good | cpr_clear | epi_due_now | identify (arg = patient id) | demo_timing (arg = on|off)
 * Arrest doesn't start CPR: cpr_start does (so do cpr_slow / cpr_good during an arrest, and the medic saying so).
 */
export const demoControl = spacetimedb.reducer({ action: t.string(), arg: t.string() }, (ctx, { action, arg }) => {
  switch (action) {
    case 'attach_recording':
      attachRecording(ctx, arg);
      return;
    case 'import_recording':
      importRecording(ctx, arg);
      return;
    case 'start':
      beginIncident(ctx, arg || 'Medic 12', 'demo');
      return;
    case 'normal':
      // Realistic normal vitals while the finger clip is off or unreliable (/controls "Normal vitals"). Same override
      // path as the seizure: the relay's rows are ignored until it's stopped, replaced, closed or reset.
      startVitalsOverride(ctx, 'normal', 'demo control');
      break;
    case 'sim_off':
      // Stop whatever synthetic scenario is on; the relay's real data flows again.
      endVitalsOverride(ctx, activeIncident(ctx)?.id, 'demo control');
      break;
    case 'arrest':
    case 'rosc':
      // The demo's arrest and ROSC also play their vitals (scenarios.ts), overriding the real finger clip, so
      // the dashboard and the agents see what an arrest looks like. Close and reset end it.
      applyStatus(ctx, action, 'demo', 'demo control');
      startVitalsOverride(ctx, action, 'demo control');
      return;
    case 'en_route':
    case 'arrived':
      applyStatus(ctx, action, 'demo', 'demo control');
      return;
    case 'close':
      applyStatus(ctx, 'closed', 'demo', 'demo control');
      return;
    case 'reset':
      deleteAll(ctx);
      ensureSeedAndTick(ctx);
      return;
    case 'cpr_start': {
      // From the demo controls with no arrest yet, CPR brings the demo's arrest look with it (the arrest scenario).
      const wasArrest = activeIncident(ctx)?.status === 'arrest';
      startCpr(ctx, 'demo', 'demo control');
      if (!wasArrest) startVitalsOverride(ctx, 'arrest', 'demo control');
      return;
    }
    case 'cpr_slow':
    case 'cpr_good':
      // Forcing a compression rate during an arrest means compressions are happening, so CPR starts too.
      setCprOverride(ctx, action === 'cpr_slow' ? 90 : 110);
      if (activeIncident(ctx)?.status === 'arrest') startCpr(ctx, 'demo', 'demo control');
      return;
    case 'cpr_clear':
      setCprOverride(ctx, undefined);
      return;
    case 'epi_due_now': {
      const inc = activeIncident(ctx);
      if (inc) setTimer(ctx, inc.id, 'epi', ctx.timestamp);
      return;
    }
    case 'identify': {
      const inc = activeIncident(ctx);
      if (!inc) throw new SenderError('no active incident');
      ctx.db.incident.id.update({ ...inc, patientRef: arg || 'pt-0001', updatedAt: ctx.timestamp });
      recordEvent(ctx, inc.id, 'patient_identified', `Patient identified (${arg || 'pt-0001'})`, 'manual', 'demo control');
      return;
    }
    case 'demo_timing': {
      const inc = activeIncident(ctx);
      if (inc) ctx.db.incident.id.update({ ...inc, demoMode: arg !== 'off', updatedAt: ctx.timestamp });
      return;
    }
    default:
      throw new SenderError(`unknown demo action '${action}'`);
  }
});

// ---------------------------------------------------------------------------
// Hospital + agent
// ---------------------------------------------------------------------------

/** W1: destination chosen by the agent. */
export const setDestination = spacetimedb.reducer(
  { hospitalId: t.u64(), etaMin: t.u32() },
  (ctx, { hospitalId, etaMin }) => {
    const inc = activeIncident(ctx);
    if (!inc) throw new SenderError('no active incident');
    const h = ctx.db.hospital.id.find(hospitalId);
    if (!h) throw new SenderError('no such hospital');
    ctx.db.incident.id.update({
      ...inc,
      destinationId: hospitalId,
      etaAt: plusSeconds(ctx.timestamp, etaMin * 60),
      updatedAt: ctx.timestamp,
    });
    recordEvent(ctx, inc.id, 'destination', `Destination: ${h.name}`, 'agent', `ETA ${etaMin} min`);
  }
);

/** W1: pre-arrival alert (display-only on the dashboard). */
export const erMessageOut = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  ctx.db.erMessage.insert({ id: 0n, incidentId: activeIncidentId(ctx), direction: 'to_er', text, ts: ctx.timestamp });
});

/** The Generate Handoff button. The agent (W4) picks up 'requested' rows. */
export const requestReport = spacetimedb.reducer(ctx => {
  const inc = latestIncident(ctx);
  if (!inc) throw new SenderError('no incident');
  const row = {
    incidentId: inc.id,
    status: 'requested',
    requestedAt: ctx.timestamp,
    readyAt: undefined,
    contentJson: '',
  };
  if (ctx.db.report.incidentId.find(inc.id)) ctx.db.report.incidentId.update(row);
  else ctx.db.report.insert(row);
});

/** W4: the finished report. */
export const saveReport = spacetimedb.reducer(
  { incidentId: t.u64(), contentJson: t.string() },
  (ctx, { incidentId, contentJson }) => {
    const existing = ctx.db.report.incidentId.find(incidentId);
    const row = {
      incidentId,
      status: 'ready',
      requestedAt: existing?.requestedAt ?? ctx.timestamp,
      readyAt: ctx.timestamp,
      contentJson,
    };
    if (existing) ctx.db.report.incidentId.update(row);
    else ctx.db.report.insert(row);
    // Spec §9: the incident closes when the report is generated; the record is read-only after that.
    const inc = ctx.db.incident.id.find(incidentId);
    if (inc && inc.status !== 'closed') {
      cancelTimers(ctx, incidentId);
      ctx.db.incident.id.update({ ...inc, status: 'closed', updatedAt: ctx.timestamp });
      recordEvent(ctx, incidentId, 'status_closed', 'Handoff report generated; incident closed', 'agent', 'save_report');
      endVitalsOverride(ctx, incidentId, 'incident closed');
    }
  }
);
