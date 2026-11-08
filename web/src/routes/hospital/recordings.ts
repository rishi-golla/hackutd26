import type { Event, Incident } from '../../module_bindings/types';

export type Recording = { url: string; label: string };

/** Mirrors the module's reserved source marker; these encounters never participate in live care. */
export function isRecordedEncounter(incident?: Pick<Incident, 'unit' | 'status'>) {
  return incident?.status === 'closed' && incident.unit === 'Recorded session';
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
    const label = typeof value.label === 'string' && value.label.trim() ? value.label : 'Session recording';
    const url = parseRecordingUrl(value.url);
    return url ? { url, label } : undefined;
  } catch { return undefined; }
}
