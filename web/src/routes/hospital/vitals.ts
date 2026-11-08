// Pure helpers for the hospital pages (spec §14): the vitals honesty rules (H3), timers, ages and status phases.
// No React here, so web/test can check them directly.
import type { Timestamp } from 'spacetimedb';

/** Structural shapes of the rows these helpers read (the generated row types carry more fields). */
type VitalsRow = { ts: Timestamp; device: string; status: string; hr?: number; spo2?: number };
type TimerRow = { state: string; dueAt: Timestamp };
type EventRow = { ts: Timestamp; kind: string };

const tsMs = (ts: Timestamp) => Number(ts.microsSinceUnixEpoch / 1000n);

export const VITALS_STALE_MS = 5000;
/** A dropout shorter than this (finger shifts, one noisy second) keeps the last good number, dimmed. */
export const HOLD_MS = 6000;
/** Relay statuses that mean "finger on, sensor still settling" (bridge/hub_bridge.py maps measuring, settling,
 *  moving, weak and noisy to acquiring). */
export const MEASURING_STATUS = new Set(['acquiring', 'calibrating']);
export const CPR_STALE_MS = 3000;
export const REPORT_SLOW_MS = 30000;

export const STATUS_TEXT: Record<string, string> = {
  standby: 'Standby',
  on_scene: 'On scene',
  arrest: 'Arrest',
  rosc: 'ROSC',
  en_route: 'En route',
  arrived: 'Arrived',
  closed: 'Closed',
};

/** The colour family of a status: red for an arrest, green for ROSC and arrival, blue while working, grey closed. */
export function statusTone(status: string | undefined): 'red' | 'green' | 'blue' | 'grey' {
  if (status === 'arrest') return 'red';
  if (status === 'rosc' || status === 'arrived') return 'green';
  if (status === 'on_scene' || status === 'en_route' || status === 'standby') return 'blue';
  return 'grey';
}

export function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ageOn(birthDate: string, now = new Date()): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return undefined;
  let age = now.getFullYear() - Number(m[1]);
  if (now.getMonth() + 1 < Number(m[2]) || (now.getMonth() + 1 === Number(m[2]) && now.getDate() < Number(m[3]))) age -= 1;
  return age;
}

export function isDue(timer: TimerRow | undefined, now: number) {
  return !!timer && (timer.state === 'due' || tsMs(timer.dueAt) <= now);
}

export function epiText(timer: TimerRow | undefined, now: number) {
  if (!timer) return undefined;
  return isDue(timer, now) ? 'Due now' : mmss((tsMs(timer.dueAt) - now) / 1000);
}

/** A destination's retained ETA stops being an arrival estimate after arrival or close. */
export function etaMinutes(status: string, etaAt: Timestamp | undefined, now: number): number | undefined {
  return etaAt && status !== 'arrived' && status !== 'closed'
    ? Math.max(0, Math.round((tsMs(etaAt) - now) / 60000))
    : undefined;
}

export type Reading = { kind: 'live' | 'held' | 'measuring' | 'none'; value?: number };
export const NONE: Reading = { kind: 'none' };

/** Explicit scope: incident 0 is the live hardware preview, never a historical patient's measurements. */
export function selectVitals<R extends { id: bigint; incidentId: bigint }>(rows: readonly R[], incidentId: bigint | undefined): R[] {
  if (incidentId === undefined) return [];
  return rows.filter(row => row.incidentId === incidentId).sort((a, b) => a.id > b.id ? -1 : 1);
}

/**
 * What a pulse-oximeter metric shows, from the vitals rows (newest first):
 * live — the newest row carries it; held — it dropped out less than HOLD_MS ago, so the last good number stays
 * (dimmed); measuring — finger on and the sensor still settling, or HR is reading and this one hasn't come yet;
 * none — finger off, a sensor fault, or the relay silent.
 */
export function readingOf<R extends VitalsRow>(rows: R[], pick: (r: R) => number | undefined, now: number): Reading {
  const latest = rows[0];
  const fresh = latest !== undefined && now - tsMs(latest.ts) < VITALS_STALE_MS;
  // The module keeps the relay's hr/spo2 only on 'pulse' rows; a scenario's numbers (the arrest's HR 0) are kept as written.
  const good = rows.find(r => pick(r) !== undefined);
  if (good && fresh && good === latest) return { kind: 'live', value: pick(good) };
  // Hold only bridges a gap in one source: a scenario taking over from the real clip (or ending) never carries
  // the other's number across.
  if (good && good.device === latest?.device && now - tsMs(good.ts) < HOLD_MS) return { kind: 'held', value: pick(good) };
  if (fresh && (MEASURING_STATUS.has(latest.status) || latest.status === 'pulse')) return { kind: 'measuring' };
  return NONE;
}

export type Phase = { status: string; startMs: number; endMs: number };

/**
 * The incident's status over time, from its `status_<name>` events (oldest first), for the Tracing page's phase
 * bar. Starts at the incident's start; the last phase runs to `endMs` (now, or when it closed).
 */
export function statusPhases(startMs: number, endMs: number, events: EventRow[]): Phase[] {
  const changes = events
    .filter(e => e.kind.startsWith('status_'))
    .map(e => ({ status: e.kind.slice('status_'.length), at: tsMs(e.ts) }))
    .filter(c => c.at >= startMs && c.at <= endMs)
    .sort((a, b) => a.at - b.at);
  const phases: Phase[] = [];
  let current = { status: 'on_scene', at: startMs };
  for (const c of changes) {
    if (c.status === current.status) continue;
    if (c.at > current.at) phases.push({ status: current.status, startMs: current.at, endMs: c.at });
    current = c;
  }
  if (endMs > current.at && current.status !== 'closed') phases.push({ status: current.status, startMs: current.at, endMs });
  return phases;
}
