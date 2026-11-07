import type { Timestamp } from 'spacetimedb';

/** SpacetimeDB Timestamp → milliseconds since epoch. */
export function tsMs(ts: Timestamp): number {
  return Number(ts.microsSinceUnixEpoch / 1000n);
}

export function clock(ts: Timestamp): string {
  return new Date(tsMs(ts)).toLocaleTimeString([], { hour12: false });
}
