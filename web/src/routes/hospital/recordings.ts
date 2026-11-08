import type { Event, Incident } from '../../module_bindings/types';

export type Recording = { url: string; label: string };

/** The label the voice worker gives the phone's own recording of a call (voice/src/recording.ts). */
export const SESSION_VIDEO_LABEL = 'Session video';

/** Display names for imported sessions, keyed by the label they were imported with. */
const SESSION_NAMES: Record<string, string> = { 'Recorded patient 01': 'Joshua Kim' };

/** Mirrors the module's reserved source marker; these encounters never participate in live care. */
export function isRecordedEncounter(incident?: Pick<Incident, 'unit' | 'status'>) {
  return incident?.status === 'closed' && incident.unit === 'Recorded session';
}

/** The import's own bookkeeping rows (video attached, session imported) are not care and never show as events. */
export function isCareEvent(event: Pick<Event, 'kind'>) {
  return event.kind !== 'session_recording' && event.kind !== 'recording_imported';
}

/** What the dashboard calls an encounter's unit: imported sessions read as a previous session. */
export function unitLabel(incident?: Pick<Incident, 'unit' | 'status'>) {
  return isRecordedEncounter(incident) ? 'Previous session' : incident?.unit;
}

export function parseRecordingUrl(value: string): string | undefined {
  if (/^\/recordings\/[a-zA-Z0-9_-]+\.(mp4|webm)$/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** Recording links are metadata, never inferred from a frame or patient's name. */
export function recordingFor(events: readonly Event[]): Recording | undefined {
  const row = events.filter(e => e.kind === 'session_recording' && e.status !== 'cancelled')
    .sort((a, b) => a.id > b.id ? -1 : 1)[0];
  if (!row) return undefined;
  const source = row.sources.find(s => s.kind === 'recording');
  try {
    const value = JSON.parse(source?.detail ?? '');
    if (typeof value.url !== 'string' || !value.url) return undefined;
    const raw = typeof value.label === 'string' && value.label.trim() ? value.label : 'Previous session';
    const label = SESSION_NAMES[raw] ?? raw;
    const url = parseRecordingUrl(value.url);
    return url ? { url, label } : undefined;
  } catch { return undefined; }
}
