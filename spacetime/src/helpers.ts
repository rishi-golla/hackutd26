// Helpers shared by reducers and rules. Not reducers themselves.
import { SenderError } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import type { Ctx } from './schema';
import { SCENARIOS, SEIZURE_WAVEFORM_RATE_HZ, scenarioFrame, syntheticDevice } from './scenarios';


const STATUSES = ['standby', 'on_scene', 'arrest', 'rosc', 'en_route', 'arrived', 'closed'];
const SEC = 1_000_000n;

export function plusSeconds(ts: Timestamp, seconds: number): Timestamp {
  return new Timestamp(ts.microsSinceUnixEpoch + BigInt(Math.round(seconds * 1_000_000)));
}

/** The newest incident that is not closed, or undefined. */
export function activeIncident(ctx: Ctx) {
  let best: ReturnType<typeof ctx.db.incident.id.find> = null;
  for (const row of ctx.db.incident.iter()) {
    if (row.status !== 'closed' && (!best || row.id > best.id)) best = row;
  }
  return best ?? undefined;
}

/** Reserved source label for closed, video-only imports; not a clinical unit. */
export const RECORDED_UNIT = 'Recorded session';

/** The newest clinical incident, closed or not. Imported videos cannot redirect clinical workflows. */
export function latestIncident(ctx: Ctx) {
  let best: ReturnType<typeof ctx.db.incident.id.find> = null;
  for (const row of ctx.db.incident.iter()) {
    if (row.status === 'closed' && row.unit === RECORDED_UNIT) continue;
    if (!best || row.id > best.id) best = row;
  }
  return best ?? undefined;
}

export function activeIncidentId(ctx: Ctx): bigint {
  return activeIncident(ctx)?.id ?? 0n;
}

export function parseJson(json: string): Record<string, unknown> {
  if (!json || !json.trim()) return {};
  try {
    const value = JSON.parse(json);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new SenderError('json must be a JSON object string');
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function touchDevice(ctx: Ctx, id: string, kind: string) {
  const existing = ctx.db.device.id.find(id);
  if (existing) ctx.db.device.id.update({ ...existing, kind, lastSeen: ctx.timestamp });
  else ctx.db.device.insert({ id, kind, lastSeen: ctx.timestamp });
}

/** Seconds between two timestamps (b - a). */
export function secondsBetween(a: Timestamp, b: Timestamp): number {
  return Number(b.microsSinceUnixEpoch - a.microsSinceUnixEpoch) / 1_000_000;
}

export function setTimer(ctx: Ctx, incidentId: bigint, kind: string, dueAt: Timestamp) {
  cancelTimers(ctx, incidentId, kind);
  ctx.db.timer.insert({ id: 0n, incidentId, kind, dueAt, state: 'running' });
}

export function cancelTimers(ctx: Ctx, incidentId: bigint, kind?: string) {
  for (const row of [...ctx.db.timer.incidentId.filter(incidentId)]) {
    if ((kind === undefined || row.kind === kind) && row.state !== 'cancelled') {
      ctx.db.timer.id.update({ ...row, state: 'cancelled' });
    }
  }
}

/** Epi every 4 min (45 s in DEMO TIMING); CPR cycle 2 min (30 s in DEMO TIMING). Spec §7, §15. */
export function intervalSeconds(demoMode: boolean, kind: 'epi' | 'cycle'): number {
  if (kind === 'epi') return demoMode ? 45 : 240;
  return demoMode ? 30 : 120;
}

/**
 * Log a timeline event, merging it into a recent event of the same kind (spec §18).
 * Merge window: 60 s, or 20 s in DEMO TIMING so two demo epi doses 45 s apart stay separate.
 * Returns the event row and whether it is new.
 */
export function recordEvent(
  ctx: Ctx,
  incidentId: bigint,
  kind: string,
  label: string,
  sourceKind: string,
  sourceDetail: string
) {
  const inc = ctx.db.incident.id.find(incidentId);
  const windowS = inc?.demoMode ? 20 : 60;
  const source = { kind: sourceKind, detail: sourceDetail, ts: ctx.timestamp };

  let recent: ReturnType<typeof ctx.db.event.id.find> = null;
  for (const row of ctx.db.event.incidentId.filter(incidentId)) {
    if (row.kind !== kind || row.status === 'cancelled') continue;
    if (secondsBetween(row.ts, ctx.timestamp) > windowS) continue;
    if (!recent || row.ts.microsSinceUnixEpoch > recent.ts.microsSinceUnixEpoch) recent = row;
  }

  if (recent) {
    // Keep the more specific label: "Epinephrine 1 mg IO" (read-back) beats "Epinephrine (tap)",
    // and a MARK with a spoken note beats a bare "MARK".
    const merged = {
      ...recent,
      // Vitals alarms: always the newest number. Otherwise keep the more specific label.
      label: kind.startsWith('vitals_alarm') || label.length > recent.label.length ? label : recent.label,
      sources: [...recent.sources, source],
      mergedCount: recent.mergedCount + 1,
    };
    ctx.db.event.id.update(merged);
    return { row: merged, isNew: false };
  }

  const row = ctx.db.event.insert({
    id: 0n,
    incidentId,
    ts: ctx.timestamp,
    kind,
    label,
    sources: [source],
    mergedCount: 1,
    status: 'logged',
  });

  // A new epinephrine dose starts (or restarts) the epi timer.
  if (kind === 'med_epinephrine' && inc) {
    setTimer(ctx, incidentId, 'epi', plusSeconds(ctx.timestamp, intervalSeconds(inc.demoMode, 'epi')));
  }
  return { row, isNew: true };
}

/** Insert a callout unless the same words are already waiting to be spoken (spec §15). */
export function queueCallout(ctx: Ctx, incidentId: bigint, text: string, priority: number): boolean {
  for (const row of ctx.db.callout.iter()) {
    if (row.spokenAt === undefined && row.text === text) return false;
  }
  ctx.db.callout.insert({
    id: 0n,
    incidentId,
    text,
    priority,
    createdAt: ctx.timestamp,
    spokenAt: undefined,
  });
  return true;
}

const STATUS_LABELS: Record<string, string> = {
  standby: 'Standby',
  on_scene: 'On scene',
  arrest: 'Cardiac arrest recognised',
  rosc: 'ROSC: pulse returned',
  en_route: 'Transporting',
  arrived: 'Arrived at hospital',
  closed: 'Incident closed',
};

/** Demo controls may force any transition, so transitions are not restricted (spec §9 lists the normal ones). */
export function applyStatus(ctx: Ctx, status: string, sourceKind: string, sourceDetail: string) {
  if (!STATUSES.includes(status)) throw new SenderError(`unknown status '${status}'`);
  const inc = activeIncident(ctx);
  if (!inc) throw new SenderError('no active incident; call start_incident first');
  if (inc.status === status) return;

  let arrestStartedAt = inc.arrestStartedAt;
  if (status === 'arrest') {
    // The heart has stopped; CPR hasn't necessarily started. startCpr does that (Start CPR on /controls, a CPR
    // override, or the medic saying so).
    arrestStartedAt = ctx.timestamp;
  } else {
    // CPR rules and timers only run during an arrest (spec §9).
    cancelTimers(ctx, inc.id);
  }

  ctx.db.incident.id.update({ ...inc, status, arrestStartedAt, updatedAt: ctx.timestamp });
  recordEvent(ctx, inc.id, `status_${status}`, STATUS_LABELS[status] ?? status, sourceKind, sourceDetail || status);
  if (status === 'closed') endVitalsOverride(ctx, inc.id, 'incident closed');
  // However the arrest ends (demo control, voice, the agent), its no-pulse scenario mustn't outlive it: ROSC
  // switches to the recovery scenario, anything else ends it.
  else if (status !== 'arrest' && ctx.db.vitalsOverride.key.find('vitals')?.scenario === 'arrest') {
    if (status === 'rosc') startVitalsOverride(ctx, 'rosc', sourceDetail || 'rosc');
    else endVitalsOverride(ctx, inc.id, `status ${status}`);
  }
}

/** CPR has started in this arrest: its 2-minute cycle timer is running (startCpr sets it; other statuses cancel it). */
export function cprStarted(ctx: Ctx, incidentId: bigint): boolean {
  return [...ctx.db.timer.incidentId.filter(incidentId)].some(t => t.kind === 'cycle' && t.state !== 'cancelled');
}

/**
 * CPR starts: from /controls (Start CPR, or a CPR override) or the medic saying so (voice: log_event cpr_started).
 * CPR means an arrest, so it sets that first if needed. Starts the 2-minute cycle timer, gives this arrest fresh
 * CPR stats and puts "CPR started" on the timeline. A no-op if CPR is already going.
 */
export function startCpr(ctx: Ctx, sourceKind: string, sourceDetail: string) {
  let inc = activeIncident(ctx);
  if (!inc) throw new SenderError('no active incident; call start_incident first');
  if (inc.status !== 'arrest') {
    applyStatus(ctx, 'arrest', sourceKind, sourceDetail);
    inc = activeIncident(ctx)!;
  }
  if (cprStarted(ctx, inc.id)) return;
  setTimer(ctx, inc.id, 'cycle', plusSeconds(ctx.timestamp, intervalSeconds(inc.demoMode, 'cycle')));
  // Fresh CPR stats for this arrest (the phone's count keeps running across arrests and judges).
  const cpr = ctx.db.cprState.incidentId.find(inc.id);
  if (cpr) {
    ctx.db.cprState.incidentId.update({
      ...cpr,
      cycleStartedAt: ctx.timestamp,
      countBase: cpr.count,
      rateSum: 0,
      rateSamples: 0,
      longestPauseS: 0,
    });
  }
  recordEvent(ctx, inc.id, 'cpr_started', 'CPR started', sourceKind, sourceDetail || 'CPR started');
}

export function beginIncident(ctx: Ctx, unit: string, sourceKind: string) {
  if (unit === RECORDED_UNIT) throw new SenderError('Recorded session is reserved for video imports');
  const existing = activeIncident(ctx);
  if (existing) return existing;
  const row = ctx.db.incident.insert({
    id: 0n,
    unit: unit || 'Medic 12',
    status: 'on_scene',
    startedAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
    arrestStartedAt: undefined,
    destinationId: undefined,
    etaAt: undefined,
    patientRef: undefined,
    demoMode: true,
  });
  recordEvent(ctx, row.id, 'status_on_scene', STATUS_LABELS.on_scene, sourceKind, 'incident started');
  return row;
}

export function setCprOverride(ctx: Ctx, rate: number | undefined) {
  const incidentId = activeIncidentId(ctx);
  const existing = ctx.db.cprState.incidentId.find(incidentId);
  const base = existing ?? {
    incidentId,
    rate: undefined,
    count: 0,
    sinceLastS: 0,
    paused: false,
    compressing: false,
    source: 'motion',
    updatedAt: ctx.timestamp,
    cycleStartedAt: undefined,
    countBase: 0,
    rateSum: 0,
    rateSamples: 0,
    longestPauseS: 0,
  };
  const row =
    rate === undefined
      ? { ...base, source: 'motion', updatedAt: ctx.timestamp }
      : { ...base, rate, compressing: true, paused: false, sinceLastS: 0, source: 'override', updatedAt: ctx.timestamp };
  if (existing) ctx.db.cprState.incidentId.update(row);
  else ctx.db.cprState.insert(row);
}

/** Stop a synthetic override (if on) and note it on the timeline. */
export function endVitalsOverride(ctx: Ctx, incidentId: bigint | undefined, why: string) {
  const row = ctx.db.vitalsOverride.key.find('vitals');
  if (!row) return;
  ctx.db.vitalsOverride.key.delete('vitals');
  const label = SCENARIOS[row.scenario]?.label ?? row.scenario;
  // One kind per scenario, so back-to-back scenarios don't merge into one timeline row (§18).
  if (incidentId !== undefined) recordEvent(ctx, incidentId, `simulation_end_${row.scenario}`, `Simulated ${label} stopped`, 'demo', why);
}

/**
 * Start a synthetic scenario (scenarios.ts), replacing any other that's on, and note it on the timeline.
 * While it's on, tick_rules writes its rows and the relay's are ignored. A no-op if it's already running.
 */
export function startVitalsOverride(ctx: Ctx, scenario: string, why: string) {
  const existing = ctx.db.vitalsOverride.key.find('vitals');
  if (existing?.scenario === scenario) return;
  if (existing) ctx.db.vitalsOverride.key.delete('vitals');
  ctx.db.vitalsOverride.insert({ key: 'vitals', scenario, startedAt: ctx.timestamp });
  const inc = activeIncident(ctx);
  if (inc) recordEvent(ctx, inc.id, `simulation_${scenario}`, `Simulated vitals: ${SCENARIOS[scenario]?.label ?? scenario}`, 'demo', why);
}

/** The active synthetic override, if any. */
export function vitalsOverrideRow(ctx: Ctx) {
  return ctx.db.vitalsOverride.key.find('vitals') ?? undefined;
}

/** Write this second's synthetic vitals + waveform (called by tick_rules while an override is on). */
export function writeSyntheticFrame(ctx: Ctx, scenario: string, startedAt: Timestamp) {
  const second = Math.floor(secondsBetween(startedAt, ctx.timestamp));
  const { vitals, waveform } = scenarioFrame(scenario, second);
  const device = syntheticDevice(scenario);
  const incidentId = activeIncidentId(ctx);
  ctx.db.vitals.insert({
    id: 0n,
    incidentId,
    ts: ctx.timestamp,
    device,
    // The scenario table is the truth here, so its numbers are kept as written (the arrest's HR 0 with
    // 'no pulse' included); readers still only trust hr/spo2 when the status is 'pulse'.
    hr: vitals.hr,
    spo2: vitals.spo2,
    tempC: vitals.tempC,
    status: vitals.status,
    simulated: true,
  });
  ctx.db.waveform.insert({
    id: 0n,
    incidentId,
    ts: ctx.timestamp,
    device,
    samples: waveform,
    rateHz: SEIZURE_WAVEFORM_RATE_HZ,
    simulated: true,
  });
}

export function deleteAll(ctx: Ctx) {
  for (const r of [...ctx.db.vitals.iter()]) ctx.db.vitals.id.delete(r.id);
  for (const r of [...ctx.db.waveform.iter()]) ctx.db.waveform.id.delete(r.id);
  for (const r of [...ctx.db.cprState.iter()]) ctx.db.cprState.incidentId.delete(r.incidentId);
  for (const r of [...ctx.db.transcript.iter()]) ctx.db.transcript.id.delete(r.id);
  for (const r of [...ctx.db.rtcSignal.iter()]) ctx.db.rtcSignal.id.delete(r.id);
  for (const r of [...ctx.db.event.iter()]) ctx.db.event.id.delete(r.id);
  for (const r of [...ctx.db.timer.iter()]) ctx.db.timer.id.delete(r.id);
  for (const r of [...ctx.db.callout.iter()]) ctx.db.callout.id.delete(r.id);
  for (const r of [...ctx.db.erMessage.iter()]) ctx.db.erMessage.id.delete(r.id);
  for (const r of [...ctx.db.agentStep.iter()]) ctx.db.agentStep.id.delete(r.id);
  for (const r of [...ctx.db.patientRecord.iter()]) ctx.db.patientRecord.incidentId.delete(r.incidentId);
  for (const r of [...ctx.db.report.iter()]) ctx.db.report.incidentId.delete(r.incidentId);
  for (const r of [...ctx.db.ruleState.iter()]) ctx.db.ruleState.key.delete(r.key);
  for (const r of [...ctx.db.vitalsOverride.iter()]) ctx.db.vitalsOverride.key.delete(r.key);
  for (const r of [...ctx.db.incident.iter()]) ctx.db.incident.id.delete(r.id);
}

const HOSPITALS = [
  { id: 1n, name: 'Avon General', capabilities: 'ed', driveMin: 6, bedsFree: 4 },
  { id: 2n, name: 'Avon Heart Institute', capabilities: 'ed,cath_lab', driveMin: 9, bedsFree: 2 },
  { id: 3n, name: 'Northside Community', capabilities: 'ed', driveMin: 12, bedsFree: 6 },
];

export function ensureSeedAndTick(ctx: Ctx) {
  for (const h of HOSPITALS) {
    if (!ctx.db.hospital.id.find(h.id)) ctx.db.hospital.insert(h);
  }
  if ([...ctx.db.tickSchedule.iter()].length === 0) {
    ctx.db.tickSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(SEC) });
  }
}
