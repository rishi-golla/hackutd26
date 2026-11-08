// Agent reasoning in the event timeline (spec §14, H5). Pure helpers, no React.
// The agents write one `agent_step` row per tool call (voice/, voice/pipecat/vision.py through the brain, agent/ W1
// and W4). Here those rows become "thoughts": consecutive steps of one agent, a few seconds apart. A live thought
// is one quiet line at the top of the timeline; a finished one is one timeline row that expands to its steps.
import type { AgentStep } from '../../module_bindings/types';
import { tsMs } from '../../db/time';

/** Steps of one agent less than this far apart are one thought; a thought is live until its last step is this old. */
export const THOUGHT_GAP_MS = 4000;

/** Steps that start a long model call (W1 plan, W4 drafting, a voice turn): the thought stays live while it waits. */
const HOLD_MS: Record<string, number> = { decision: 20000, plan: 20000, gather: 20000, nemotron: 8000, proactive: 8000 };

/** A thought this long is cut, so a camera that keeps seeing something still lands rows in the timeline. */
const MAX_THOUGHT_MS = 60000;

/** What each tool is doing, said plainly: `now` while live, `done` once the thought has finished. */
const TOOL_TEXT: Record<string, { now: string; done: string }> = {
  // voice/ (brain and Nemotron's tools)
  read_back: { now: 'Medication read-back', done: 'Medication read-back' },
  nemotron: { now: 'Thinking about what the medic said', done: 'Thought about what the medic said' },
  nemotron_readback: { now: 'Wording the read-back', done: 'Worded the read-back' },
  check_allergy: { now: 'Checking allergies in the EHR record', done: 'Checked allergies in the EHR record' },
  check_dose_range: { now: 'Checking the dose range', done: 'Checked the dose range' },
  search_ehr: { now: 'Searching the EHR', done: 'Searched the EHR' },
  ehr_get_record: { now: 'Patient record request', done: 'Patient record request' },
  save_patient_record: { now: 'Saving the patient record', done: 'Saved the patient record' },
  identify_patient: { now: 'Identifying the patient', done: 'Identified the patient' },
  seen: { now: 'Camera observation', done: 'Camera observation' },
  look: { now: 'Camera check requested', done: 'Camera check requested' },
  log_event: { now: 'Logging an event', done: 'Logged an event' },
  set_status: { now: 'Updating the status', done: 'Updated the status' },
  set_event_status: { now: 'Updating an event', done: 'Updated an event' },
  control: { now: "Applying the medic's correction", done: "Applied the medic's correction" },
  mark: { now: 'Marking the moment', done: 'Marked the moment' },
  speak: { now: 'Queueing speech', done: 'Queued speech' },
  proactive: { now: 'Considering an advisory', done: 'Considered an advisory' },
  trend: { now: 'Watching the vitals trend', done: 'Watched the vitals trend' },
  get_state: { now: 'Reading the live state', done: 'Read the live state' },
  get_recent_transcript: { now: 'Reading the transcript', done: 'Read the transcript' },
  get_timeline: { now: 'Reading the timeline', done: 'Read the timeline' },
  // voice/pipecat/vision.py
  vision: { now: 'Looking through the bodycam', done: 'Looked through the bodycam' },
  // voice/pipecat/analyze_recording.py (recorded videos)
  asr: { now: 'Transcribing the session', done: 'Transcribed the session' },
  transcript_events: { now: 'Reading the transcript for actions', done: 'Read the transcript for actions' },
  // agent/ W1 and W4
  plan: { now: 'Hospital workflow plan', done: 'Hospital workflow plan' },
  get_incident: { now: 'Reading the incident', done: 'Read the incident' },
  list_hospitals: { now: 'Comparing hospitals', done: 'Compared hospitals' },
  choose_hospital: { now: 'Choosing a hospital', done: 'Chose a hospital' },
  set_destination: { now: 'Setting the destination', done: 'Set the destination' },
  post_er_message: { now: 'Alerting the ER', done: 'Alerted the ER' },
  self_check: { now: 'Checking its own work', done: 'Checked its own work' },
  fallback: { now: 'Falling back to the rules', done: 'Fell back to the rules' },
  gather: { now: 'Gathering the facts', done: 'Gathered the facts' },
  draft: { now: 'Drafting the report', done: 'Drafted the report' },
  save_report: { now: 'Saving the report', done: 'Saved the report' },
};

/** Which step names a finished thought: the highest ranked tool in it (the latest one on a tie). */
const HEADLINE_RANK: Record<string, number> = {
  post_er_message: 9,
  save_report: 9,
  set_destination: 8,
  read_back: 8,
  nemotron_readback: 9,
  save_patient_record: 7,
  identify_patient: 6,
  speak: 5,
  set_status: 4,
  log_event: 4,
  set_event_status: 4,
  control: 4,
  seen: 3,
  choose_hospital: 3,
  draft: 3,
};

/** What a `speak` row said it was: "P1 answer: …" → "answer" (voice/src/policy.ts writes the kind). */
function speechKind(s: AgentStep): string | undefined {
  return s.tool === 'speak' ? /^P\d (\w+):/.exec(s.summary.trim())?.[1] : undefined;
}

/**
 * Steps Nemotron itself took in voice/: a turn on what the medic said, an unprompted advisory, its wording of a
 * read-back, and what it chose to say. Everything else the brain writes (the parser's read-back, the dose and
 * allergy checks, the record pull, what the camera saw, the standard read-back) is fixed logic. The two never share
 * a thought, even when they run at the same time, so a label never credits Nemotron with fixed logic (§0.1
 * decisions 13, 18 and 21).
 */
function isModelStep(s: AgentStep): boolean {
  if (s.tool === 'nemotron' || s.tool === 'proactive') return true;
  if (s.tool === 'nemotron_readback') return s.summary.trim().startsWith('Nemotron read it back');
  const kind = speechKind(s);
  return kind === 'answer' || kind === 'advisory';
}

export type DecisionUpdate = { v: 1; id: string; phase: 'progress' | 'complete' | 'error'; text: string };

export function decisionUpdate(s: AgentStep): DecisionUpdate | undefined {
  if (s.workflow !== 'voice' || s.tool !== 'decision') return undefined;
  try {
    const d = JSON.parse(s.summary);
    if (d?.v === 1 && typeof d.id === 'string' && d.id && ['progress', 'complete', 'error'].includes(d.phase) && typeof d.text === 'string' && d.text.trim()) return d;
  } catch { /* An incomplete or old row stays readable as a plain trace entry. */ }
  return undefined;
}

/** Steps that end a model turn: it spoke, it chose silence, or the turn failed or was dropped. */
function endsModelTurn(s: AgentStep): boolean {
  const kind = speechKind(s);
  if (kind === 'answer' || kind === 'advisory' || s.tool === 'nemotron_readback') return true;
  const t = s.summary.trim();
  if (s.tool === 'nemotron') return t === 'SILENT' || /^(stopped|dropped)|staying silent/i.test(t);
  return s.tool === 'proactive' && /nothing needs saying/.test(t);
}

/** Bookkeeping, not reasoning: lines the speech policy dropped, our own words echoed back, turns never taken. */
export function isNoise(s: AgentStep): boolean {
  if (s.tool === 'policy' || s.tool === 'echo_guard') return true;
  if (s.tool === 'nemotron') {
    const t = s.summary.trim();
    return t.startsWith('Skipped') || t === 'SILENT';
  }
  return !s.summary.trim() && !TOOL_TEXT[s.tool];
}

/** The agent behind a step. The vision sampler writes and speaks through the brain (workflow voice). */
function agentOf(s: AgentStep): string {
  if (s.tool === 'vision' || s.workflow.toLowerCase() === 'vision' || speechKind(s) === 'vision') return 'vision';
  return s.workflow;
}

export type Thought = {
  key: string;
  agent: string;
  steps: AgentStep[];
  startMs: number;
  lastMs: number;
  /** Nemotron's own steps in voice/ (isModelStep), so "Nemotron" is the honest name for it. */
  model: boolean;
  /** No more steps join: a model turn that ended, or a newer thought of the same agent began. */
  closed: boolean;
};

/** Group one incident's steps into thoughts, oldest first. Steps of different agents may interleave. */
export function groupThoughts(steps: AgentStep[]): Thought[] {
  const sorted = [...steps].sort((a, b) => (a.id < b.id ? -1 : 1));
  const thoughts: Thought[] = [];
  const decisions = new Map<string, Thought>();
  const open = new Map<string, Thought>();
  for (const s of sorted) {
    const update = decisionUpdate(s);
    if (update) {
      let thought = decisions.get(update.id);
      if (!thought) {
        thought = { key: `d${update.id}`, agent: 'voice', model: true, closed: false, steps: [], startMs: tsMs(s.ts), lastMs: tsMs(s.ts) };
        decisions.set(update.id, thought);
        thoughts.push(thought);
      }
      // Explicit correlation survives interleaving, long requests and reconnect replay.
      if (!thought.closed) {
        thought.steps.push(s);
        thought.lastMs = tsMs(s.ts);
        thought.closed = update.phase !== 'progress';
      }
      continue;
    }
    const agent = agentOf(s);
    const model = agent === 'voice' && isModelStep(s);
    // Nemotron's steps and the brain's fixed logic are grouped apart, even when they interleave in time.
    const group = model ? (s.tool === 'nemotron_readback' ? 'voice:readback' : 'voice:model') : agent;
    const t = tsMs(s.ts);
    let cur = open.get(group);
    // Noise never shows, but a model turn that chose silence still ends its thought.
    if (isNoise(s)) {
      if (cur?.model && endsModelTurn(s)) cur.closed = true;
      continue;
    }
    // A new turn, an advisory or Nemotron's read-back wording starts its own thought; it never joins one under way.
    const newTurn =
      model && (s.tool === 'nemotron_readback' || ((s.tool === 'nemotron' || s.tool === 'proactive') && /^(turn on|Noticed)/.test(s.summary.trim())));
    if (!cur || cur.closed || newTurn || t - cur.lastMs >= gapAfter(cur) || t - cur.startMs > MAX_THOUGHT_MS) {
      if (cur) cur.closed = true;
      cur = { key: `t${s.id}`, agent, steps: [], startMs: t, lastMs: t, model, closed: false };
      thoughts.push(cur);
      open.set(group, cur);
    }
    const prev = cur.steps[cur.steps.length - 1];
    // A step that only repeats the last one with new numbers (the camera seeing the same pads every second)
    // replaces it, so the live line doesn't churn and the row doesn't grow.
    if (prev && prev.tool === s.tool && sameWords(prev.summary, s.summary)) cur.steps[cur.steps.length - 1] = s;
    else cur.steps.push(s);
    cur.lastMs = t;
    if (cur.model && endsModelTurn(s)) cur.closed = true;
  }
  return thoughts;
}

function sameWords(a: string, b: string) {
  return a.replace(/\d+/g, '#') === b.replace(/\d+/g, '#');
}

function gapAfter(t: Thought): number {
  return HOLD_MS[t.steps[t.steps.length - 1].tool] ?? THOUGHT_GAP_MS;
}

/**
 * Live while its last step is fresh and it is still its group's newest thought. A model turn that has spoken stays
 * on the live line for the usual few seconds, so the spoken words can be read.
 */
export function liveThoughts(thoughts: Thought[], now: number): Set<Thought> {
  const newest = new Map<string, Thought>();
  const live = new Set<Thought>();
  for (const t of thoughts) {
    if (decisionUpdate(t.steps[0])) {
      if (!t.closed && now - t.lastMs > -1000 && now - t.lastMs < gapAfter(t)) live.add(t);
    } else newest.set(t.model ? `${t.agent}:model` : t.agent, t);
  }
  for (const t of newest.values()) if (now - t.lastMs > -1000 && now - t.lastMs < gapAfter(t)) live.add(t);
  return live;
}

/** Credit Nemotron only for explicit model operations or vision; legacy workflows stay labelled Agent. */
export function agentLabel(t: Thought): string {
  const usedModel =
    t.agent === 'vision' || t.model;
  return `${usedModel ? 'Nemotron' : 'Agent'} · ${t.agent === 'recording' ? 'session review' : t.agent}`;
}

/** One step as a sentence: the plain verb phrase and the step's own summary as the detail. */
export function stepSentence(s: AgentStep, tense: 'now' | 'done'): { phrase: string; detail: string } {
  const update = decisionUpdate(s);
  if (update) return update.phase === 'progress' && tense === 'done'
    ? { phrase: 'No completion received', detail: update.text }
    : { phrase: update.text, detail: '' };
  const text = TOOL_TEXT[s.tool];
  // The summary is the detail; the speech line's "P1 answer: " prefix is bookkeeping.
  const summary = s.workflow === 'recording' ? s.summary.replace(/\b(the )?recording\b/gi, 'the session') : s.summary;
  const detail = summary.trim().replace(/^P\d \w+: /, '');
  if (!text || /\b(?:failed|refused|unavailable|not logged|not pulled|not found|no active incident|dropped|stopped|skipped)\b/i.test(detail)) return { phrase: detail, detail: '' };
  // Historical guarded read-back fallback: the standard read-back played, not Nemotron's wording.
  if (s.tool === 'nemotron_readback' && !detail.startsWith('Nemotron read it back')) return { phrase: 'Used the standard read-back', detail: detail.replace(/^Used the standard read-back\s*/, '') };
  return { phrase: text.done, detail }; // Legacy steps describe actions already taken, not pending requests.
}

/** The step that names a finished thought. */
export function headline(t: Thought): AgentStep {
  // The explicit outcome always names a correlated decision; a pending request never implies success.
  if (decisionUpdate(t.steps[0])) return t.steps[t.steps.length - 1];
  let best = t.steps[t.steps.length - 1];
  let bestRank = HEADLINE_RANK[best.tool] ?? 0;
  for (const s of t.steps) {
    const r = HEADLINE_RANK[s.tool] ?? 0;
    if (r >= bestRank) {
      best = s;
      bestRank = r;
    }
  }
  return best;
}
