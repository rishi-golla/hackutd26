import { SenderError } from 'spacetimedb/server';
import type { Ctx } from './schema';
import { activeIncident, applyStatus, beginIncident, latestIncident, parseJson, plusSeconds, recordEvent, RECORDED_UNIT, touchDevice } from './helpers';

/** Explicit patient turnover, atomic and retry-safe. The confirmation must refer to the current encounter. */
export function startNewPatient(ctx: Ctx, json: string) {
  const data = parseJson(json);
  if (typeof data.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.requestId)) {
    throw new SenderError('a valid requestId is required');
  }
  if (typeof data.expectedIncidentId !== 'string' || !/^\d*$/.test(data.expectedIncidentId)) {
    throw new SenderError('expectedIncidentId must identify the confirmed encounter, or be empty');
  }
  const key = `patient_start:${data.requestId}`;
  if (ctx.db.ruleState.key.find(key)) return;
  const current = activeIncident(ctx);
  if (String(current?.id ?? '') !== data.expectedIncidentId) {
    throw new SenderError('PATIENT_CHANGED: The active patient changed. Please try again.');
  }
  const previous = current ?? latestIncident(ctx);
  const unit = previous?.unit ?? 'Medic 12';
  if (current) applyStatus(ctx, 'closed', 'manual', 'New patient');
  const incident = beginIncident(ctx, unit, 'manual');
  if (previous) ctx.db.incident.id.update({ ...incident, demoMode: previous.demoMode });
  recordEvent(ctx, incident.id, 'status_on_scene', 'On scene', 'manual', data.requestId);
  ctx.db.ruleState.insert({ key, since: ctx.timestamp, lastFiredAt: ctx.timestamp });
}

/** Persisted deduplication makes bridge reconnects safe, including after a call has closed. */
export function startCameraSession(ctx: Ctx, device: string, sessionId: string, unit: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new SenderError('invalid camera session ID');
  if (!device || device.length > 128) throw new SenderError('invalid device');
  const key = `bodycam_session:${sessionId}`;
  touchDevice(ctx, device, 'bodycam');
  if (ctx.db.ruleState.key.find(key)) return;
  const incident = beginIncident(ctx, unit.slice(0, 80) || 'Medic 12', 'bodycam');
  recordEvent(ctx, incident.id, 'bodycam_started', 'Harness camera session started', 'bodycam', sessionId);
  ctx.db.ruleState.insert({ key, since: ctx.timestamp, lastFiredAt: ctx.timestamp });
}

function recordingInput(json: string) {
  const data = parseJson(json);
  if (typeof data.url !== 'string') throw new SenderError('url must be a string');
  const url = data.url.trim();
  const local = /^\/recordings\/[a-zA-Z0-9_-]+\.(mp4|webm)$/.test(url);
  if (url && !local && (url.length > 4096 || !/^https:\/\/[^/\s?#@]+(?:[/?#][^\s]*)?$/.test(url))) {
    throw new SenderError('use HTTPS or /recordings/<filename>.mp4|webm');
  }
  const label = (typeof data.label === 'string' ? data.label.trim().slice(0, 120) : '') || 'Session recording';
  return { data, url, label };
}

/** Keep video bytes outside the database. Store only an HTTPS or strictly scoped same-origin reference. */
export function attachRecording(ctx: Ctx, json: string) {
  const { data, url, label } = recordingInput(json);
  if (typeof data.incidentId !== 'string' || !/^\d+$/.test(data.incidentId)) throw new SenderError('incidentId is required');
  const incidentId = BigInt(data.incidentId);
  if (!ctx.db.incident.id.find(incidentId)) throw new SenderError('incident not found');
  // Always insert: a newer row replaces (or removes) the previous reference without clinical-event merging.
  ctx.db.event.insert({
    id: 0n, incidentId, ts: ctx.timestamp, kind: 'session_recording',
    label: url ? 'Recorded video attached' : 'Recorded video removed',
    sources: [{ kind: 'recording', detail: JSON.stringify({ url, label }), ts: ctx.timestamp }],
    status: 'logged', mergedCount: 1,
  });
}

/** Import directly as closed: never create a live call, trigger EHR lookup, or fabricate a clinical event. */
export function importRecording(ctx: Ctx, json: string) {
  const { url, label } = recordingInput(json);
  if (!url) throw new SenderError('a recording URL is required');
  // Retrying the same import must not create duplicate patients.
  for (const event of ctx.db.event.iter()) {
    if (event.kind === 'recording_imported' && event.sources.some(source => source.detail === url)
      && ctx.db.incident.id.find(event.incidentId)) return;
  }
  const incident = ctx.db.incident.insert({
    id: 0n, unit: RECORDED_UNIT, status: 'closed',
    startedAt: ctx.timestamp, updatedAt: ctx.timestamp,
    arrestStartedAt: undefined, destinationId: undefined, etaAt: undefined, patientRef: undefined, demoMode: false,
  });
  recordEvent(ctx, incident.id, 'recording_imported', 'Recorded session imported; capture time not supplied', 'recording', url);
  attachRecording(ctx, JSON.stringify({ incidentId: String(incident.id), url, label }));
}

/** Source kind of every row the recording analyzer writes; a new analysis replaces only these. */
export const RECORDING_ANALYSIS = 'recording_analysis';
const MAX_TRACE_ROWS = 500;

function traceRows(value: unknown, name: string) {
  if (!Array.isArray(value)) throw new SenderError(`${name} must be a list`);
  if (value.length > MAX_TRACE_ROWS) throw new SenderError(`${name} has more than ${MAX_TRACE_ROWS} rows`);
  return value.map(row => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const t = Number(r.t);
    if (!Number.isFinite(t) || t < 0 || t > 6 * 3600) throw new SenderError(`${name}: t must be seconds into the video`);
    return { t, r };
  });
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function recordedIncidentFor(ctx: Ctx, data: Record<string, unknown>) {
  if (typeof data.incidentId === 'string' && /^\d+$/.test(data.incidentId)) return ctx.db.incident.id.find(BigInt(data.incidentId)) ?? undefined;
  if (typeof data.url !== 'string' || !data.url) throw new SenderError('incidentId or url is required');
  for (const event of ctx.db.event.iter()) {
    if (event.kind === 'recording_imported' && event.sources.some(source => source.detail === data.url)) {
      return ctx.db.incident.id.find(event.incidentId) ?? undefined;
    }
  }
  return undefined;
}

/**
 * What a recorded video shows, from the offline analyzer (voice/pipecat/analyze_recording.py): transcript lines,
 * seen_* / said_* events and analyzer steps, each at `t` seconds into the video (stored as import time + t).
 * Only video-only imports accept it, and a rerun replaces the previous analysis. Never touches live care.
 */
export function writeRecordingTrace(ctx: Ctx, json: string) {
  const data = parseJson(json);
  const incident = recordedIncidentFor(ctx, data);
  if (!incident || incident.status !== 'closed' || incident.unit !== RECORDED_UNIT) {
    throw new SenderError('only a recorded-video import can take a recording trace');
  }
  const lines = traceRows(data.transcript ?? [], 'transcript');
  const seen = traceRows(data.events ?? [], 'events');
  const steps = traceRows(data.steps ?? [], 'steps');
  for (const { r } of seen) {
    if (!/^(seen|said)_[a-z_]{1,40}$/.test(text(r.kind, 50)) || !text(r.label, 200)) {
      throw new SenderError('events need a seen_* or said_* kind and a label');
    }
  }
  const id = incident.id;
  for (const row of [...ctx.db.transcript.incidentId.filter(id)]) ctx.db.transcript.id.delete(row.id);
  for (const row of [...ctx.db.event.incidentId.filter(id)]) {
    if (row.sources.some(source => source.kind === RECORDING_ANALYSIS)) ctx.db.event.id.delete(row.id);
  }
  for (const row of [...ctx.db.agentStep.iter()]) {
    if (row.incidentId === id && row.workflow === 'recording') ctx.db.agentStep.id.delete(row.id);
  }
  const at = (t: number) => plusSeconds(incident.startedAt, t);
  for (const { t, r } of lines) {
    const said = text(r.text, 500);
    if (said) ctx.db.transcript.insert({ id: 0n, incidentId: id, ts: at(t), text: said });
  }
  for (const { t, r } of seen) {
    ctx.db.event.insert({
      id: 0n, incidentId: id, ts: at(t), kind: text(r.kind, 50), label: text(r.label, 200),
      sources: [{ kind: RECORDING_ANALYSIS, detail: text(r.detail, 300) || 'recording analyzer', ts: ctx.timestamp }],
      status: 'logged', mergedCount: 1,
    });
  }
  for (const { t, r } of steps) {
    const tool = text(r.tool, 60);
    const summary = text(r.summary, 300);
    if (tool && summary) ctx.db.agentStep.insert({ id: 0n, incidentId: id, ts: at(t), workflow: 'recording', tool, summary });
  }
}

/** Encounter readings are patient history. Only unassigned preview readings expire. */
export function shouldPruneVitals(incidentId: bigint, ageSeconds: number) {
  return incidentId === 0n && ageSeconds > 1800;
}
