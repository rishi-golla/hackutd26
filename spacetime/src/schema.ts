// Handoff SpacetimeDB schema (spec §22). Owned by the hospital lane; ask before changing.
import { schema, table, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** One emergency. The active incident is the newest one whose status is not 'closed'. */
const incident = table(
  { name: 'incident', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    unit: t.string(),
    /** standby | on_scene | arrest | rosc | en_route | arrived | closed */
    status: t.string(),
    startedAt: t.timestamp(),
    updatedAt: t.timestamp(),
    arrestStartedAt: t.option(t.timestamp()),
    destinationId: t.option(t.u64()),
    etaAt: t.option(t.timestamp()),
    patientRef: t.option(t.string()),
    /** DEMO TIMING: epi every 45 s, CPR cycle 30 s (spec §7). */
    demoMode: t.bool(),
  }
);

/** Who is connected and when they were last seen. */
const device = table(
  { name: 'device', public: true },
  {
    id: t.string().primaryKey(),
    kind: t.string(),
    lastSeen: t.timestamp(),
  }
);

/** HR / SpO2 / temperature, about once a second. Empty value = no valid reading (spec R4). */
const vitals = table(
  { name: 'vitals', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index('btree'),
    ts: t.timestamp(),
    device: t.string(),
    hr: t.option(t.f32()),
    /** Experimental. Always label it in the UI. */
    spo2: t.option(t.f32()),
    tempC: t.option(t.f32()),
    /** Relay status: calibrating | no finger | saturated | acquiring | pulse */
    status: t.string(),
    simulated: t.bool(),
  }
);

/** Pulse waveform batches (about 5 per second). Only the last 30 s are kept. */
const waveform = table(
  { name: 'waveform', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64(),
    ts: t.timestamp(),
    device: t.string(),
    samples: t.array(t.f32()),
    rateHz: t.f32(),
    simulated: t.bool(),
  }
);

/** Latest CPR state per incident, from the bodycam motion detector (or a demo override). */
const cprState = table(
  { name: 'cpr_state', public: true },
  {
    incidentId: t.u64().primaryKey(),
    rate: t.option(t.f32()),
    count: t.u32(),
    sinceLastS: t.f32(),
    paused: t.bool(),
    compressing: t.bool(),
    /** motion | override */
    source: t.string(),
    updatedAt: t.timestamp(),
    cycleStartedAt: t.option(t.timestamp()),
    /** phone count when the current arrest started; compressions this arrest = count - countBase */
    countBase: t.u32(),
    rateSum: t.f64(),
    rateSamples: t.u32(),
    longestPauseS: t.f32(),
    /** The phone's CPR assistance is running (metronome + its own cues); the server's CPR callouts stay quiet. */
    assist: t.bool().default(false),
    /** Metronome tempo (/min); 0 = no metronome. */
    bpm: t.f32().default(0),
    /** % of the last ~8 compressions within 120 ms of the beat; undefined = no data (not compressing yet). */
    onBeatPct: t.option(t.f32()).default(undefined),
    /** Mean signed timing error vs the beat (ms; + = late); undefined = no data. */
    phaseErrMs: t.option(t.f32()).default(undefined),
    /** Running totals over the current arrest, for the report (average % on the beat). */
    onBeatSum: t.f64().default(0),
    onBeatSamples: t.u32().default(0),
    /** Last push_cpr_assist: `assist` only counts while this is fresh, so a phone that went away can't mute the server. */
    assistAt: t.option(t.timestamp()).default(undefined),
  }
);

/** One row per spoken sentence from the bodycam. */
const transcript = table(
  { name: 'transcript', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index('btree'),
    ts: t.timestamp(),
    text: t.string(),
  }
);

/** WebRTC handshake messages between bodycam and hospital. Live video only, never snapshots. */
const rtcSignal = table(
  { name: 'rtc_signal', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    ts: t.timestamp(),
    sessionId: t.string(),
    /** bodycam | hospital */
    sender: t.string(),
    /** offer | answer | ice */
    kind: t.string(),
    /** JSON string (SDP or ICE candidate) */
    payload: t.string(),
  }
);

/** Where a timeline event came from. Shown as a chip. */
const Source = t.object('Source', {
  /** voice | read-back | label | tap | MARK | motion | callout | EHR | ID card | agent | relay | demo */
  kind: t.string(),
  detail: t.string(),
  ts: t.timestamp(),
});

/** The timeline. Same-kind reports close together merge into one event with several sources (spec §18). */
const event = table(
  { name: 'event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index('btree'),
    ts: t.timestamp(),
    /** e.g. med_epinephrine, med_amiodarone, shock, airway, mark, patient_identified, status_arrest */
    kind: t.string(),
    label: t.string(),
    sources: t.array(Source),
    mergedCount: t.u32(),
    /** logged | flagged | confirmed | cancelled */
    status: t.string(),
  }
);

/** Epi and CPR-cycle timers. */
const timer = table(
  { name: 'timer', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index('btree'),
    /** epi | cycle */
    kind: t.string(),
    dueAt: t.timestamp(),
    /** running | due | cancelled */
    state: t.string(),
  }
);

/** What the bodycam should say. The bodycam speaks unspoken rows and calls callout_spoken. */
const callout = table(
  { name: 'callout', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64(),
    text: t.string(),
    /** 0 = read-back, 1 = urgent, 2 = normal, 3 = low (spec §15) */
    priority: t.u8(),
    createdAt: t.timestamp(),
    spokenAt: t.option(t.timestamp()),
  }
);

/** Messages to the ER (pre-arrival alert). Display-only; no Acknowledge (AGENTS.md section 0). */
const erMessage = table(
  { name: 'er_message', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64(),
    /** to_er | from_er */
    direction: t.string(),
    text: t.string(),
    ts: t.timestamp(),
  }
);

/** The agent trace: trigger → plan → tool → result, in plain language. */
const agentStepTable = table(
  { name: 'agent_step', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64(),
    ts: t.timestamp(),
    workflow: t.string(),
    tool: t.string(),
    summary: t.string(),
  }
);

/** Fictional hospitals (seed data). */
const hospital = table(
  { name: 'hospital', public: true },
  {
    id: t.u64().primaryKey(),
    name: t.string(),
    /** comma-separated, e.g. "ed,cath_lab" */
    capabilities: t.string(),
    driveMin: t.u32(),
    bedsFree: t.u32(),
  }
);

/** The record pulled from the mock EHR for this incident. Every field is "from EHR" (or "cached"). */
const patientRecord = table(
  { name: 'patient_record', public: true },
  {
    incidentId: t.u64().primaryKey(),
    patientRef: t.string(),
    name: t.string(),
    birthDate: t.string(),
    allergies: t.array(t.string()),
    medications: t.array(t.string()),
    conditions: t.array(t.string()),
    codeStatus: t.string(),
    /** EHR | cached */
    source: t.string(),
    updatedAt: t.timestamp(),
  }
);

/** The handoff report. Generate Handoff sets 'requested'; the agent (W4) saves 'ready'. */
const report = table(
  { name: 'report', public: true },
  {
    incidentId: t.u64().primaryKey(),
    /** requested | ready | failed */
    status: t.string(),
    requestedAt: t.timestamp(),
    readyAt: t.option(t.timestamp()),
    /** JSON produced by the agent (MIST lines with source ids) */
    contentJson: t.string(),
  }
);

/**
 * A synthetic scenario overriding the relay's sensor data (synthesize_seizure). A row means it's on.
 * While on, real relay vitals and waveform are not stored; tick_rules writes the scenario's rows instead.
 */
const vitalsOverride = table(
  { name: 'vitals_override', public: true },
  {
    /** always 'vitals' (one override at a time) */
    key: t.string().primaryKey(),
    /** e.g. 'seizure' */
    scenario: t.string(),
    startedAt: t.timestamp(),
  }
);

/** Private bookkeeping for the callout rules (hold timers, last fired). */
const ruleState = table(
  { name: 'rule_state' },
  {
    key: t.string().primaryKey(),
    since: t.option(t.timestamp()),
    lastFiredAt: t.option(t.timestamp()),
  }
);

/** Drives tick_rules once a second. */
const tickSchedule = table(
  { name: 'tick_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const spacetimedb = schema({
  incident,
  device,
  vitals,
  waveform,
  cprState,
  transcript,
  rtcSignal,
  event,
  timer,
  callout,
  erMessage,
  agentStep: agentStepTable,
  hospital,
  patientRecord,
  report,
  vitalsOverride,
  ruleState,
  tickSchedule,
});
export default spacetimedb;

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
export { Source };


export { tickSchedule };
