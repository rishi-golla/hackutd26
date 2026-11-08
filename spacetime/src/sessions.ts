import { SenderError } from 'spacetimedb/server';
import type { Ctx } from './schema';
import { beginIncident, parseJson, recordEvent, touchDevice } from './helpers';

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

/** Keep large video files on their HTTPS host. The encounter stores only a recording-reference event. */
export function attachRecording(ctx: Ctx, json: string) {
  const data = parseJson(json);
  if (typeof data.incidentId !== 'string' || !/^\d+$/.test(data.incidentId)) throw new SenderError('incidentId is required');
  const incidentId = BigInt(data.incidentId);
  if (!ctx.db.incident.id.find(incidentId)) throw new SenderError('incident not found');
  if (typeof data.url !== 'string') throw new SenderError('url must be a string');
  const url = data.url.trim();
  if (url && (url.length > 4096 || !/^https:\/\/[^/\s?#@]+(?:[/?#][^\s]*)?$/.test(url))) {
    throw new SenderError('use a direct HTTPS video URL without credentials');
  }
  const label = (typeof data.label === 'string' ? data.label.trim().slice(0, 120) : '') || 'Session recording';
  // Always insert: a newer row replaces (or removes) the previous reference without clinical-event merging.
  ctx.db.event.insert({
    id: 0n, incidentId, ts: ctx.timestamp, kind: 'session_recording',
    label: url ? 'Recorded video attached' : 'Recorded video removed',
    sources: [{ kind: 'recording', detail: JSON.stringify({ url, label }), ts: ctx.timestamp }],
    status: 'logged', mergedCount: 1,
  });
}

/** Encounter readings are patient history. Only unassigned preview readings expire. */
export function shouldPruneVitals(incidentId: bigint, ageSeconds: number) {
  return incidentId === 0n && ageSeconds > 1800;
}
