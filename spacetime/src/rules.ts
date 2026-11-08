// Callout rules (spec §15), run by tick_rules once a second for the active incident.
// Plain rules, no AI: instant and never flaky. Thresholds are the spec's defaults; tune on the manikin.
//
// Across all rules (spec §15):
// - at most one callout every 4 s (read-backs run on the phone and are exempt)
// - the most urgent (lowest priority number) goes first; the rest wait for the next free slot
// - the same words are never queued twice (queueCallout)
// - "ER acknowledged" is dropped (AGENTS.md section 0)
import type { Timestamp } from 'spacetimedb';
import type { Ctx } from './schema';
import {
  applyStatus,
  intervalSeconds,
  plusSeconds,
  queueCallout,
  recordEvent,
  secondsBetween,
  setTimer,
} from './helpers';

type IncidentRow = NonNullable<ReturnType<Ctx['db']['incident']['id']['find']>>;

const SPACING_S = 4;
const CPR_FRESH_S = 3;
const VITALS_FRESH_S = 5;

type Candidate = {
  key: string;
  text: string;
  priority: number;
  repeatS: number;
  onFire?: () => void;
  /** Log the event but don't queue the words: the phone's CPR assistance is already coaching (one voice). */
  silent?: boolean;
};

export function runRules(ctx: Ctx, inc: IncidentRow): void {
  const now = ctx.timestamp;
  const inArrest = inc.status === 'arrest';
  const vitalsActive = inc.status === 'on_scene' || inc.status === 'rosc' || inc.status === 'en_route';
  const candidates: Candidate[] = [];

  // ---- §9: en_route → arrived when the ETA reaches 0
  if (inc.status === 'en_route' && inc.etaAt && inc.etaAt.microsSinceUnixEpoch <= now.microsSinceUnixEpoch) {
    applyStatus(ctx, 'arrived', 'agent', 'ETA reached 0');
    return;
  }

  // ---- CPR (arrest only). Uses the bodycam's motion data, or the demo override.
  const cpr = ctx.db.cprState.incidentId.find(inc.id);
  const cprFresh = !!cpr && (cpr.source === 'override' || secondsBetween(cpr.updatedAt, now) < CPR_FRESH_S);
  const rate = cprFresh && cpr!.compressing ? cpr!.rate : undefined;
  // The phone's CPR assistance speaks its own cues (Faster / Slower / Resume compressions); the server still logs
  // the events for the timeline and the report but stays quiet, so the medic hears one voice. Under the demo
  // override the phone keeps only the beat, so the server speaks the rate and pause cues as usual.
  const phoneCoaching =
    cprFresh &&
    cpr!.assist &&
    cpr!.source !== 'override' &&
    !!cpr!.assistAt &&
    secondsBetween(cpr!.assistAt, now) < CPR_FRESH_S;

  if (held(ctx, inc, 'cpr_slow', inArrest && rate !== undefined && rate < 100, 5)) {
    candidates.push({
      key: 'cpr_slow',
      text: 'Push faster',
      priority: 1,
      repeatS: 10,
      silent: phoneCoaching,
      onFire: () => cprEvent(ctx, inc, `CPR rate low (${Math.round(rate!)}/min), coached`, rate!, 'Push faster', cpr!.source, phoneCoaching),
    });
  }
  if (held(ctx, inc, 'cpr_fast', inArrest && rate !== undefined && rate > 120, 5)) {
    candidates.push({
      key: 'cpr_fast',
      text: 'Slow down',
      priority: 2,
      repeatS: 10,
      silent: phoneCoaching,
      onFire: () => cprEvent(ctx, inc, `CPR rate high (${Math.round(rate!)}/min), coached`, rate!, 'Slow down', cpr!.source, phoneCoaching),
    });
  }
  // No compressions for 10 s. Only when the bodycam is actually reporting (no data = no claim).
  // The pause can't be longer than the arrest so far (the phone was idle before it).
  const pauseS =
    cpr && inc.arrestStartedAt ? Math.min(cpr.sinceLastS, secondsBetween(inc.arrestStartedAt, now)) : 0;
  const paused = inArrest && cprFresh && !cpr!.compressing && pauseS >= 10;
  if (held(ctx, inc, 'cpr_pause', paused, 0)) {
    candidates.push({
      key: 'cpr_pause',
      text: 'Resume compressions',
      priority: 1,
      repeatS: 10,
      silent: phoneCoaching,
      onFire: () => {
        const s = Math.round(pauseS);
        recordEvent(ctx, inc.id, 'cpr_paused', `Compressions paused ${s} s`, 'motion', `no compressions for ${s} s`);
        recordEvent(ctx, inc.id, 'cpr_paused', `Compressions paused ${s} s`, ...coachChip(phoneCoaching, 'Resume compressions'));
      },
    });
  }

  // ---- Timers (arrest only; other statuses cancel them in applyStatus)
  if (inArrest) {
    for (const timer of [...ctx.db.timer.incidentId.filter(inc.id)]) {
      if (timer.state === 'cancelled') continue;
      const due = timer.dueAt.microsSinceUnixEpoch <= now.microsSinceUnixEpoch;
      if (!due) continue;

      if (timer.kind === 'cycle' && timer.state === 'running') {
        // Once per cycle; the next cycle starts when the prompt is spoken.
        candidates.push({
          key: 'cycle',
          text: 'Two minutes. Rhythm check, switch compressors.',
          priority: 2,
          repeatS: 0,
          onFire: () => {
            setTimer(ctx, inc.id, 'cycle', plusSeconds(now, intervalSeconds(inc.demoMode, 'cycle')));
            const c = ctx.db.cprState.incidentId.find(inc.id);
            if (c) ctx.db.cprState.incidentId.update({ ...c, cycleStartedAt: now });
          },
        });
      }
      if (timer.kind === 'epi') {
        // Stays 'due' (repeating every 60 s) until the next epinephrine dose restarts the timer.
        if (timer.state === 'running') ctx.db.timer.id.update({ ...timer, state: 'due' });
        candidates.push({ key: 'epi_due', text: 'Epi due', priority: 2, repeatS: 60 });
      }
    }
  }

  // ---- Vitals alarms (on scene, after ROSC, en route). Only valid, fresh relay readings count.
  const v = latestVitals(ctx, inc.id, now);
  const pulse = v && v.status === 'pulse' ? v : undefined;
  if (pulse) markHadPulse(ctx, inc);

  const spo2 = pulse?.spo2;
  if (held(ctx, inc, 'spo2_low', vitalsActive && spo2 !== undefined && spo2 < 90, 10)) {
    const n = Math.round(spo2!);
    candidates.push({
      key: 'spo2_low',
      text: `Oxygen saturation ${spoken(n)}`,
      priority: 2,
      repeatS: 30,
      onFire: () => vitalsEvent(ctx, inc, 'vitals_alarm_spo2', `SpO₂ ${n}% (experimental), called out`, `SpO₂ ${n}`, pulse!.simulated),
    });
  }
  const hr = pulse?.hr;
  if (held(ctx, inc, 'hr_out', vitalsActive && hr !== undefined && (hr < 50 || hr > 150), 10)) {
    const n = Math.round(hr!);
    candidates.push({
      key: 'hr_out',
      text: `Heart rate ${spoken(n)}`,
      priority: 2,
      repeatS: 30,
      onFire: () => vitalsEvent(ctx, inc, 'vitals_alarm_hr', `Heart rate ${n}, called out`, `HR ${n}`, pulse!.simulated),
    });
  }
  const fingerOff = vitalsActive && !!v && v.status === 'no finger' && hadPulse(ctx, inc);
  if (held(ctx, inc, 'finger_off', fingerOff, 5)) {
    candidates.push({ key: 'finger_off', text: 'Check finger sensor', priority: 3, repeatS: 60 });
  }

  // ---- Silent candidates (the phone is coaching): log the event on the usual repeat, queue no words.
  for (const c of candidates) {
    if (c.silent && canRepeat(ctx, inc, c.key, c.repeatS, now)) {
      setLastFired(ctx, inc, c.key, now);
      c.onFire?.();
    }
  }

  // ---- Pick at most one callout this tick.
  const ready = candidates
    .filter(c => !c.silent && canRepeat(ctx, inc, c.key, c.repeatS, now))
    .sort((a, b) => a.priority - b.priority);
  if (ready.length === 0 || !spacingFree(ctx, now)) return;

  const chosen = ready[0];
  queueCallout(ctx, inc.id, chosen.text, chosen.priority);
  setLastFired(ctx, inc, chosen.key, now);
  chosen.onFire?.();
}

// ---------------------------------------------------------------------------

function stateKey(inc: IncidentRow, key: string) {
  return `${inc.id}:${key}`;
}

/** True once `condition` has held for `holdS` seconds. Resets as soon as it goes false. */
function held(ctx: Ctx, inc: IncidentRow, key: string, condition: boolean, holdS: number): boolean {
  const k = stateKey(inc, key);
  const st = ctx.db.ruleState.key.find(k);
  if (!condition) {
    if (st?.since) ctx.db.ruleState.key.update({ ...st, since: undefined });
    return false;
  }
  if (!st) {
    ctx.db.ruleState.insert({ key: k, since: ctx.timestamp, lastFiredAt: undefined });
    return holdS <= 0;
  }
  if (!st.since) {
    ctx.db.ruleState.key.update({ ...st, since: ctx.timestamp });
    return holdS <= 0;
  }
  return secondsBetween(st.since, ctx.timestamp) >= holdS;
}

function canRepeat(ctx: Ctx, inc: IncidentRow, key: string, repeatS: number, now: Timestamp): boolean {
  const st = ctx.db.ruleState.key.find(stateKey(inc, key));
  if (!st?.lastFiredAt) return true;
  return repeatS > 0 && secondsBetween(st.lastFiredAt, now) >= repeatS;
}

function setLastFired(ctx: Ctx, inc: IncidentRow, key: string, now: Timestamp) {
  const k = stateKey(inc, key);
  const st = ctx.db.ruleState.key.find(k);
  // The cycle prompt fires once per cycle: clear its marker so the next cycle can fire again.
  const lastFiredAt = key === 'cycle' ? undefined : now;
  if (st) ctx.db.ruleState.key.update({ ...st, lastFiredAt });
  else ctx.db.ruleState.insert({ key: k, since: undefined, lastFiredAt });
}

/** At most one callout every 4 s, counting callouts from any source except read-backs (priority 0). */
function spacingFree(ctx: Ctx, now: Timestamp): boolean {
  for (const c of ctx.db.callout.iter()) {
    if (c.priority > 0 && secondsBetween(c.createdAt, now) < SPACING_S) return false;
  }
  return true;
}

function latestVitals(ctx: Ctx, incidentId: bigint, now: Timestamp) {
  let best: ReturnType<Ctx['db']['vitals']['id']['find']> = null;
  for (const row of ctx.db.vitals.incidentId.filter(incidentId)) {
    if (!best || row.id > best.id) best = row;
  }
  return best && secondsBetween(best.ts, now) < VITALS_FRESH_S ? best : undefined;
}

function markHadPulse(ctx: Ctx, inc: IncidentRow) {
  const k = stateKey(inc, 'had_pulse');
  if (!ctx.db.ruleState.key.find(k)) ctx.db.ruleState.insert({ key: k, since: ctx.timestamp, lastFiredAt: undefined });
}

function hadPulse(ctx: Ctx, inc: IncidentRow) {
  return !!ctx.db.ruleState.key.find(stateKey(inc, 'had_pulse'));
}

function cprEvent(ctx: Ctx, inc: IncidentRow, label: string, rate: number, words: string, source: string, byPhone = false) {
  // A demo override is not a measurement: cite it as "demo" and mark the label SIMULATED.
  const override = source === 'override';
  const lbl = override ? `${label} (SIMULATED)` : label;
  recordEvent(ctx, inc.id, 'cpr_coached', lbl, override ? 'demo' : 'motion', `${Math.round(rate)}/min`);
  recordEvent(ctx, inc.id, 'cpr_coached', lbl, ...coachChip(byPhone, words));
}

/**
 * The chip names who coached (decision 18): the server's spoken callout, or the phone. The phone runs its own
 * timers, so the server doesn't claim which words the phone said, only that its own callout was muted.
 */
function coachChip(byPhone: boolean, words: string): [string, string] {
  return byPhone ? ['phone coaching', `server callout "${words}" muted`] : ['callout', words];
}

/** Each alarm has its own kind so an HR alarm and an SpO₂ alarm never merge into one event. */
function vitalsEvent(ctx: Ctx, inc: IncidentRow, kind: string, label: string, detail: string, simulated: boolean) {
  const lbl = simulated ? `${label} (SIMULATED)` : label;
  recordEvent(ctx, inc.id, kind, lbl, simulated ? 'demo' : 'relay', detail);
}

// ---- numbers in words, so "eighty-eight" is never misheard (spec §15, §16)

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  return n % 10 ? `${tens}-${ONES[n % 10]}` : tens;
}

/** 88 → "eighty-eight", 155 → "one fifty-five", 105 → "one oh five", 200 → "two hundred". */
export function spoken(n: number): string {
  if (n < 0 || n > 999) return String(n);
  if (n < 100) return twoDigits(n);
  const hundreds = ONES[Math.floor(n / 100)];
  const rest = n % 100;
  if (rest === 0) return `${hundreds} hundred`;
  if (rest < 10) return `${hundreds} oh ${ONES[rest]}`;
  return `${hundreds} ${twoDigits(rest)}`;
}
