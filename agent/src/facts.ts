// Facts about one incident, read from SpacetimeDB. Each fact has an id the report can cite.
// The agent may only use these (spec §19 agent rules): no vitals, times, names or doses from anywhere else.
import type { Timestamp } from 'spacetimedb';
import type { Conn } from './db';
import { CONFIG } from './config';

export type Fact = {
  /** citable id, e.g. ev:12, ehr, cpr, vitals:340, tx:7, er:3, incident */
  id: string;
  /** "HH:MM" in DISPLAY_TZ, when the fact has a time */
  time?: string;
  /** chips shown in the report (source kinds) */
  chips: string[];
  text: string;
};

export const tsMs = (ts: Timestamp) => Number(ts.microsSinceUnixEpoch / 1000n);

export function hhmm(ts: Timestamp): string {
  return hhmmMs(tsMs(ts));
}

export function hhmmMs(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: CONFIG.timeZone,
  });
}

export function ageOn(birthDate: string, now = new Date()): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  return age;
}

const byId = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Everything the workflows know about one incident. */
export function snapshot(conn: Conn, incidentId: bigint) {
  const incident = [...conn.db.incident.iter()].find(i => i.id === incidentId);
  const hospitals = [...conn.db.hospital.iter()];
  const destination = hospitals.find(h => h.id === incident?.destinationId);
  const record = [...conn.db.patientRecord.iter()].find(r => r.incidentId === incidentId);
  const events = [...conn.db.event.iter()]
    .filter(e => e.incidentId === incidentId && e.status !== 'cancelled')
    .sort(byId);
  const cpr = [...conn.db.cprState.iter()].find(c => c.incidentId === incidentId);
  const vitals = [...conn.db.vitals.iter()].filter(v => v.incidentId === incidentId).sort(byId);
  const latestValid = [...vitals].reverse().find(v => v.status === 'pulse' && v.hr !== undefined);
  const transcript = [...conn.db.transcript.iter()].filter(t => t.incidentId === incidentId).sort(byId);
  const alerts = [...conn.db.erMessage.iter()]
    // "Handoff report ready…" is W4's E4 summary, not a pre-arrival alert.
    .filter(m => m.incidentId === incidentId && m.direction === 'to_er' && !m.text.startsWith('Handoff report ready'))
    .sort(byId);
  return { incident, hospitals, destination, record, events, cpr, latestValid, transcript, alerts };
}

export type Snapshot = ReturnType<typeof snapshot>;

const TREATMENT_KINDS = /^(med_|shock|airway|procedure)/;
export const isTreatment = (kind: string) => TREATMENT_KINDS.test(kind);

/** Facts for the report (W4), in a stable order. */
export function buildFacts(s: Snapshot): Fact[] {
  const facts: Fact[] = [];
  const inc = s.incident;
  if (!inc) return facts;

  facts.push({
    id: 'incident',
    time: hhmm(inc.startedAt),
    chips: ['incident'],
    text:
      `Unit ${inc.unit}; incident started ${hhmm(inc.startedAt)}; status ${inc.status}` +
      (s.destination ? `; destination ${s.destination.name}` : '; destination not set') +
      (inc.etaAt ? `; ETA ${hhmm(inc.etaAt)}` : ''),
  });

  if (s.record) {
    const r = s.record;
    const age = ageOn(r.birthDate);
    facts.push({
      id: 'ehr',
      chips: [r.source === 'cached' ? 'EHR (cached)' : 'EHR'],
      text:
        `Patient record from the ${r.source === 'cached' ? 'cached EHR copy' : 'EHR'}: ${r.name}, born ${r.birthDate}` +
        (age !== undefined ? ` (age ${age})` : '') +
        `; allergies: ${r.allergies.length ? r.allergies.join(', ') : 'none recorded'}` +
        `; medications: ${r.medications.length ? r.medications.join(', ') : 'none recorded'}` +
        `; conditions: ${r.conditions.length ? r.conditions.join(', ') : 'none recorded'}` +
        `; code status: ${r.codeStatus || 'not recorded'}`,
    });
  }

  for (const e of s.events) {
    const chips = [...new Set(e.sources.map(src => src.kind))];
    const evidence = e.sources
      .filter(src => src.detail && src.detail !== e.kind)
      .map(src => `${src.kind}: "${src.detail.slice(0, 120)}"`)
      .join('; ');
    facts.push({
      id: `ev:${e.id}`,
      time: hhmm(e.ts),
      chips,
      text:
        `${hhmm(e.ts)} ${e.label}` +
        (e.status === 'flagged' ? ' [FLAGGED]' : e.status === 'confirmed' ? ' [confirmed]' : '') +
        (evidence ? ` (${evidence})` : ''),
    });
  }

  const c = s.cpr;
  if (c && (c.rateSamples > 0 || c.count > c.countBase)) {
    const avg = c.rateSamples > 0 ? Math.round(c.rateSum / c.rateSamples) : undefined;
    const override = c.source === 'override';
    facts.push({
      id: 'cpr',
      chips: [override ? 'demo override' : 'bodycam motion'],
      text:
        `CPR measured by ${override ? 'a demo override (simulated)' : 'the bodycam motion sensor'}` +
        (inc.arrestStartedAt ? ` since the arrest at ${hhmm(inc.arrestStartedAt)}` : '') +
        (avg !== undefined ? `: average rate ${avg}/min` : '') +
        `, longest pause ${Math.round(c.longestPauseS)} s, ${c.count - c.countBase} compressions`,
    });
  }

  const v = s.latestValid;
  if (v) {
    const parts = [
      v.hr !== undefined ? `HR ${Math.round(v.hr)}` : undefined,
      v.spo2 !== undefined ? `SpO₂ ${Math.round(v.spo2)} (experimental)` : undefined,
      v.tempC !== undefined ? `temperature ${v.tempC.toFixed(1)} °C` : undefined,
    ].filter(Boolean);
    facts.push({
      id: `vitals:${v.id}`,
      time: hhmm(v.ts),
      chips: [v.simulated ? 'simulated' : 'relay'],
      text: `Latest valid vitals at ${hhmm(v.ts)}: ${parts.join(', ')}${v.simulated ? ' (simulated)' : ''}`,
    });
  }

  for (const t of s.transcript.slice(-15)) {
    facts.push({ id: `tx:${t.id}`, time: hhmm(t.ts), chips: ['voice'], text: `${hhmm(t.ts)} medic said: "${t.text}"` });
  }

  for (const a of s.alerts.slice(-2)) {
    facts.push({ id: `er:${a.id}`, time: hhmm(a.ts), chips: ['agent'], text: `${hhmm(a.ts)} pre-arrival alert: ${a.text}` });
  }
  return facts;
}
