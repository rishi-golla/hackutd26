import { SenderError } from 'spacetimedb/server';
import type { Ctx } from './schema';
import { beginIncident, parseJson, recordEvent, RECORDED_UNIT, touchDevice } from './helpers';

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

/** Encounter readings are patient history. Only unassigned preview readings expire. */
export function shouldPruneVitals(incidentId: bigint, ageSeconds: number) {
  return incidentId === 0n && ageSeconds > 1800;
}
