// Everything the hospital pages show, from the SpacetimeDB tables, for one selected incident (spec §14).
// Honesty rules live here once: a missing or stale reading is "no data", never a number; a cached record says so.
import { useEffect, useMemo, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, type DbConnection } from '../../module_bindings';
import type { AgentStep, ErMessage, Event, Hospital, Incident, PatientRecord, Report, Timer, Vitals } from '../../module_bindings/types';
import { tsMs } from '../../db/time';
import { groupThoughts, liveThoughts, type Thought } from './thoughts';
import { CPR_STALE_MS, etaMinutes, NONE, readingOf, REPORT_SLOW_MS, VITALS_STALE_MS, type Reading } from './vitals';

export function useNow(intervalMs = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const byNewest = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? 1 : -1);

export type TimelineRow =
  | { kind: 'event'; key: string; t: number; text: string; flagged: boolean; eventKind: string }
  | { kind: 'thought'; key: string; t: number; thought: Thought };

export type SpokenLine = { key: string; t: number; who: 'medic' | 'handoff'; text: string; queued: boolean };

export type CallSummary = {
  incident: Incident;
  record?: PatientRecord;
  destination?: Hospital;
  latest?: Event;
  flagged: number;
};

/** The selected incident from ?incident=<id>; without one, the newest incident (closed or not). */
export function selectedIncidentId(): bigint | undefined {
  const raw = new URLSearchParams(window.location.search).get('incident');
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : undefined;
}

export function useHospital(selected?: bigint) {
  const { isActive, getConnection } = useSpacetimeDB();
  const now = useNow();
  const [incidents] = useTable(tables.incident);
  const [vitalsRows] = useTable(tables.vitals);
  const [cprRows] = useTable(tables.cprState);
  const [events] = useTable(tables.event);
  const [timers] = useTable(tables.timer);
  const [messages] = useTable(tables.erMessage);
  const [records] = useTable(tables.patientRecord);
  const [reports] = useTable(tables.report);
  const [steps] = useTable(tables.agentStep);
  const [hospitals] = useTable(tables.hospital);
  const [transcript] = useTable(tables.transcript);
  const [callouts] = useTable(tables.callout);

  const sorted = useMemo(() => [...incidents].sort(byNewest), [incidents]);
  const incident: Incident | undefined = selected !== undefined ? sorted.find(i => i.id === selected) : sorted[0];
  const incId = incident?.id;
  const open = !!incident && incident.status !== 'closed';
  const activeId = sorted.find(i => i.status !== 'closed')?.id;
  const canShowLive = isActive && open && incident?.id === activeId;
  const record = records.find(r => r.incidentId === incId);
  const report: Report | undefined = reports.find(r => r.incidentId === incId);
  const destination = hospitals.find(h => h.id === incident?.destinationId);

  // H5: the agents' steps grouped into thoughts; at most two live lines, newest first.
  const incSteps: AgentStep[] = useMemo(() => steps.filter(s => s.incidentId === incId), [steps, incId]);
  const thoughts = useMemo(() => groupThoughts(incSteps), [incSteps]);
  const liveSet = isActive && incident?.status !== 'closed' ? liveThoughts(thoughts, now) : new Set<Thought>();
  const live = thoughts.filter(t => liveSet.has(t)).reverse().slice(0, 2);

  const incEvents: Event[] = events.filter(e => e.incidentId === incId && e.status !== 'cancelled');
  const incMessages: ErMessage[] = messages.filter(m => m.incidentId === incId).sort((a, b) => tsMs(a.ts) - tsMs(b.ts));

  // The care timeline, newest first: events, the alert the agent sent the ER, and the agents' finished thoughts.
  const timeline: TimelineRow[] = [
    ...incEvents.map(e => ({ kind: 'event' as const, key: `e${e.id}`, t: tsMs(e.ts), text: e.label, flagged: e.status === 'flagged', eventKind: e.kind })),
    ...incMessages
      // The agent's "Handoff report ready" summary (E4) is not the pre-arrival alert.
      .filter(m => m.direction === 'to_er' && !m.text.startsWith('Handoff report ready'))
      .map(m => ({ kind: 'event' as const, key: `m${m.id}`, t: tsMs(m.ts), text: `Alert to ER: ${m.text}`, flagged: false, eventKind: 'er_alert' })),
    ...thoughts.filter(t => !live.includes(t)).map(t => ({ kind: 'thought' as const, key: t.key, t: t.startMs, thought: t })),
  ].sort((a, b) => b.t - a.t);

  // What was said on scene: the medic's lines and what Handoff said or has queued, oldest first.
  const spoken: SpokenLine[] = [
    ...transcript.filter(t => t.incidentId === incId).map(t => ({ key: `t${t.id}`, t: tsMs(t.ts), who: 'medic' as const, text: t.text, queued: false })),
    ...callouts.filter(c => c.incidentId === incId).map(c => ({ key: `c${c.id}`, t: tsMs(c.spokenAt ?? c.createdAt), who: 'handoff' as const, text: c.text, queued: c.spokenAt === undefined })),
  ].sort((a, b) => a.t - b.t);

  // Vitals (H3). The real finger clip reads nothing useful through compressions, so HR and SpO₂ stay blank in an
  // arrest (§9) unless a simulated scenario is playing (the demo's arrest: HR 0, no SpO₂).
  const vitalsNewest: Vitals[] = useMemo(() => open ? vitalsRows.filter(r => r.incidentId === incId).sort(byNewest) : [], [vitalsRows, incId, open]);
  const latestVitals = vitalsNewest[0];
  const v = latestVitals !== undefined && now - tsMs(latestVitals.ts) < VITALS_STALE_MS ? latestVitals : undefined;
  const inArrest = incident?.status === 'arrest';
  const blankInArrest = inArrest && !v?.simulated;
  const hr: Reading = blankInArrest ? NONE : readingOf(vitalsNewest, r => r.hr, now);
  const spo2: Reading = blankInArrest ? NONE : readingOf(vitalsNewest, r => r.spo2, now);
  const cpr = cprRows.find(c => c.incidentId === incId);
  const cprFresh = cpr !== undefined && (cpr.source === 'override' || now - tsMs(cpr.updatedAt) < CPR_STALE_MS);
  const cprRate = inArrest && cprFresh && cpr.compressing ? cpr.rate : undefined;
  const epi: Timer | undefined = timers.find(t => t.incidentId === incId && t.kind === 'epi' && t.state !== 'cancelled');
  const vitalsAt = latestVitals ? tsMs(latestVitals.ts) : undefined;

  const elapsedS = incident ? ((open ? now : tsMs(incident.updatedAt)) - tsMs(incident.startedAt)) / 1000 : 0;
  const etaMin = incident ? etaMinutes(incident.status, incident.etaAt, now) : undefined;

  // H7: one report per incident.
  const reportReady = report?.status === 'ready' && !!report.contentJson;
  const writing = report?.status === 'requested';
  // requestReport targets the newest incident; it has no incident argument. Never let an older call invoke it.
  const canGenerate = isActive && !!incident && incident.id === sorted[0]?.id;
  const [requestError, setRequestError] = useState<string>();
  useEffect(() => setRequestError(undefined), [incId, report?.status]);
  const generate = () => {
    const conn = getConnection() as DbConnection | null;
    if (!conn || !canGenerate || writing || reportReady) return;
    setRequestError(undefined);
    void conn.reducers.requestReport({}).catch(() => setRequestError('Could not request the report. Please try again.'));
  };
  const reportProblem = requestError ?? (report?.status === 'failed'
    ? 'Report failed'
    : // H7 promises a report within 30 s; past that, say so rather than look busy forever.
      writing && now - tsMs(report.requestedAt) > REPORT_SLOW_MS
      ? 'No reply from the agent'
      : undefined);

  // Every incident as a call, for Live Operations.
  const calls: CallSummary[] = sorted.map(i => {
    const evs = events.filter(e => e.incidentId === i.id && e.status !== 'cancelled');
    return {
      incident: i,
      record: records.find(r => r.incidentId === i.id),
      destination: hospitals.find(h => h.id === i.destinationId),
      latest: [...evs].sort(byNewest)[0],
      flagged: evs.filter(e => e.status === 'flagged').length,
    };
  });

  // The newest activity across every call, for the Live Operations feed.
  const activity = [
    ...events.filter(e => e.status !== 'cancelled').map(e => ({ key: `e${e.id}`, t: tsMs(e.ts), incidentId: e.incidentId, text: e.label, flagged: e.status === 'flagged' })),
    ...messages.filter(m => m.direction === 'to_er' && !m.text.startsWith('Handoff report ready')).map(m => ({ key: `m${m.id}`, t: tsMs(m.ts), incidentId: m.incidentId, text: `Alert to ER: ${m.text}`, flagged: false })),
  ].sort((a, b) => b.t - a.t).slice(0, 12);

  return {
    isActive, now, incident, open, canShowLive, hasLiveCall: isActive && activeId !== undefined, canGenerate, record, report, destination, thoughts, live, liveSet, timeline, spoken,
    events: incEvents, messages: incMessages, steps: incSteps,
    hr, spo2, tempC: v?.tempC, vitalsAt, cprRate, epi, inArrest, elapsedS, etaMin,
    reportReady, writing, generate, reportProblem, calls, activity, unitOf: (id: bigint) => sorted.find(i => i.id === id)?.unit,
  };
}

export type HospitalData = ReturnType<typeof useHospital>;
