import type { Event } from '../../module_bindings/types';

export type Recording = { url: string; label: string };

/** Recording links are metadata, never inferred from a frame or patient's name. */
export function recordingFor(events: readonly Event[]): Recording | undefined {
  const row = events.filter(e => e.kind === 'session_recording' && e.status !== 'cancelled')
    .sort((a, b) => a.id > b.id ? -1 : 1)[0];
  if (!row) return undefined;
  const source = row.sources.find(s => s.kind === 'recording');
  try {
    const value = JSON.parse(source?.detail ?? '');
    if (typeof value.url !== 'string' || !value.url) return undefined;
    const url = new URL(value.url);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return { url: url.href, label: typeof value.label === 'string' && value.label.trim() ? value.label : 'Session recording' };
  } catch { return undefined; }
}
