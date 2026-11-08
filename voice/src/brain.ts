// The brain (spec §19 voice agent): what happens with each thing the medic says and each change in the tables.
// Deterministic first (read-back, corrections, spoken identity, camera-seen drugs, W6), Nemotron for judgement.
//
// Every utterance is handled exactly once. The ear's lines are decided first and stored after (decision 21): kept
// lines are written with add_transcript once handled (the row coming back is recognised as ours and skipped),
// dropped ones are written nowhere. Lines the bodycam wrote itself in degraded mode are handled from their row. Slow work (an EHR pull, a model turn)
// is bound to an incident "generation" and dropped if the incident was reset or closed meanwhile.
import type { Conn } from './db';
import { activeIncident, step } from './db';
import { CONFIG, llmConfigured } from './config';
import { chat, modelInUse, type ChatMessage } from './llm';
import { advisoryDecision, DecisionLog, publicSummaries, toolProgress, ungroundedTerm } from './decision-log';
import { ECHO_PREFIXES, medParts, normalizeTranscript, parseAnswer, parseControl, parseIdentity, type MedParts, parseReadback, recognizeDrug, type ReadbackMatch, type Route, type Unit } from './readback';
import { checkAllergy, checkDoseRange, composeReadback, type DoseVerdict } from './checks';
import { cachedMatch, fetchRecord, searchPatients, spokenRecordSummary } from './ehr';
import { readState, summarize, TREND_SPO2_DROP, tsMs, type CameraScene, type State } from './state';
import type { Policy } from './policy';
import { looksLikeSpeech } from './speech';
import type { Speaker } from './speaker';
import { CPR_START, logCprStarted, NOT_PLAIN, runTool, STATUS_PLAIN, toolsFor, type ToolContext } from './tools';
import { spoken, spokenUnit } from './spoken';
import { seenEvent, type SeenFinding } from './seen';
import type { Event, Incident, Transcript } from './module_bindings/types';

/** "Correction" / "confirm" apply to the last read-back for 10 s (spec RB3); a flagged one stays open. */
const CONTROL_WINDOW_MS = 10_000;
/** A bare dose after "Saw epinephrine. What dose?" is accepted for this long (spec RB9: 30 s). */
const PENDING_DOSE_MS = 30_000;
/** How long the brain remembers a line it wrote, so the row coming back is recognised as its own. */
const OWN_LINE_MS = 60_000;
const PROACTIVE_EVERY_MS = 10_000;
/** Nemotron turns per minute at most (NVIDIA free tier is about 40 requests/min for the whole key). */
const LLM_TURNS_PER_MIN = 20;
/** Lines made only of these words carry nothing to document or answer, so they never cost a model call. */
const FILLER = /^(?:\s*\b(?:yeah|yep|yes|no|nope|ok|okay|right|alright|all right|sure|cool|so|like|um|uh|hmm|mm|mhm|oh|ah|well|and|but|wait|huh|got it|nice|thanks|thank you)\b[\s,.!]*)+$/i;
/** Exchanges kept as conversation memory for the next Nemotron turn (spec §19: follow-ups make sense). */
const HISTORY_TURNS = 8;
const HISTORY_MS = 5 * 60_000;
/** A line this soon after Handoff answered something is a follow-up, so it is meant for Handoff. */
const FOLLOW_UP_MS = 5_000;
const HANDOFF_NAME = /\bhand\s?-?\s?off\b/i;
/**
 * A request to the assistant even without its name or a question mark ("Pull up his record", "What's his
 * allergy"). Not a bare "can you" / "could you": "Hey can you pass me the tape" is for a partner (live Sun ~04:55).
 */
const DIRECT_REQUEST = /\b(?:look up|pull up|pull (?:the|his|her|their) record|search (?:for|the)|check (?:the|his|her|their) (?:record|allergies|meds|medications|history)|tell me|what(?:['’]s| is| are| was| did)|how (?:long|many|much)|when (?:did|was)|any allergies|read (?:it|that )?back)\b/i;
/** The vitals-trend check when Nemotron advisories are off (no key, or VOICE_PROACTIVE=off). */
const TREND_EVERY_MS = 5_000;
/** A trend note the policy dropped (spacing, another callout) is tried again after this long, not every tick. */
const TREND_RETRY_MS = 10_000;
/** An advisory about the vitals trend, for the one-note-per-episode rule. */
const TREND_WORDS = /\b(?:oxygen|saturation|spo2|sats?|desaturat\w*|heart rate|tachycard\w*|bradycard\w*)\b/i;
/** How long a spoken callout counts as "just said" for the restatement check. */
const RESTATE_WINDOW_S = 30;
/** Words that carry no clinical content when two sentences share them. */
const RESTATE_STOP = new Set(['consider', 'warning', 'record', 'patient', 'present', 'before', 'during', 'please', 'should', 'anyway', 'hundred', 'milligram', 'milligrams', 'minutes', 'seconds', 'protocol', 'confirm', 'confirmed', 'logged', 'current', 'without', 'reading']);

/**
 * The callout spoken in the last 30 s that the advisory restates (two or more clinical words in common), or
 * undefined. "Note: amiodarone allergy confirmed. Warfarin present." right after "…lists an amiodarone allergy…".
 */
export function restatesRecentSpeech(advisory: string, s: State): string | undefined {
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z][a-z-]{5,}/g)?.filter(w => !RESTATE_STOP.has(w)) ?? []);
  const mine = words(advisory);
  for (const c of s.recentSpeech) {
    if (!c.spokenAt || (s.now - tsMs(c.spokenAt)) / 1000 > RESTATE_WINDOW_S) continue;
    const shared = [...words(c.text)].filter(w => mine.has(w));
    if (shared.length >= 2) return c.text;
  }
  return undefined;
}

const SYSTEM = `You are Handoff, the voice assistant riding along with a paramedic. Prototype; all data is synthetic.
You hear every line the chest mic picks up: the medic talking to you, to a partner or to the patient, and room noise (bystanders, other conversations nearby, people who are not on this call). Each turn you get one NEW LINE, the VOICE LOG (the last lines heard, each marked kept or dropped), the recent conversation with you, and the live state.
FIRST decide KEEP or DROP. Keep the line only if it is about this patient's care (something done to or found on this patient, the scene, the patient's identity, history or medications, the plan) or it is meant for you (it says "Handoff", asks you something, or answers or follows up on something you said). Use the voice log for context: a short line that continues a kept line is kept; a line that continues a dropped side conversation is dropped. Anything else (small talk, other people's conversations, talk about the equipment, the demo or the hackathon, anything not about this patient) is DROP: reply with the single word DROP and call no tools. A dropped line is saved nowhere. When unsure, DROP.
If you keep it, do two separate jobs:
1. DOCUMENT. If the line states something clinical about this patient or the scene, call log_event once per distinct fact (two facts in one line are two calls), with a short timeline label: a procedure the medic did or is doing (IV or IO access, suction, splint, pulse check result, monitor or pads applied), an airway device placed, or a finding (breathing, skin, pupils, bleeding, pain, injuries, mental status, what the patient or a bystander reports, medications or pill bottles found, scene hazards, a MARK note). Asking a partner to fetch something is not a procedure. Skip facts already in EVENTS. Questions or requests to you are never findings. Procedures and airway devices are read back to the medic and confirmed automatically, and findings are logged quietly: never acknowledge either out loud ("Noted", "Logged"). Medications given and shocks are read back and logged automatically by the read-back system: never log them and never repeat them back.
2. REPLY only if the line is meant for you: it asks you something, asks you to do something other than documenting, or answers or follows up on something you just said (see the conversation). Your name alone is not a reason to reply: "Handoff, IO access in the right tibia" is documented, not answered. Then answer with "speak" like a calm, capable partner: one or two short spoken sentences, under 25 words; summarise, never list everything. You may talk about anything, including what you can do and small talk, but facts about the patient and the incident come only from the state and tools; if the state doesn't have it, say "Not documented yet". If the line is not meant for you (the medic talking to the patient or a partner, thinking aloud, background chatter), don't speak.
- What you can do: read back and check doses and allergies, pull the patient's record (name and birth date, or "Handoff, look" at an ID card), document what you hear, mark moments ("Handoff, mark"), track CPR and timers, answer questions about the case, brief the hospital.
- The live state below is current: act on it directly. Make all the log_event calls for a line in one reply.
- CAMERA is what the bodycam sees right now; use it as context (e.g. hands on the chest, a syringe, an ID card), never as a logged fact on its own.
- Never write out your reasoning: anything you write that is not a tool call may be read aloud.
- Never ask the medic about a medication's drug, dose or route, and never comment on a dose: the read-back system collects and checks those on its own.
- If the medic plainly states a status change (no pulse / cardiac arrest → arrest; pulse is back → rosc; transporting / loading / en route → en_route), call set_status.
- If the medic says CPR or compressions are starting ("starting CPR", "starting compressions"), call log_event with kind cpr_started and label "CPR started". That starts the CPR clock (and sets the arrest if it isn't one yet). Arrest alone never means CPR has started.
- If the medic gives the patient's full name AND birth date, call search_ehr; one match → pull_record; several → ask which with "speak"; none → say no record found. Never guess.
- Speech-to-text garbles words. If you can't tell what a word or line means (e.g. "FEO", "FPIO"), never log it and never guess what it was; if it was meant for you, ask "Say again?".
- When you keep the line but have nothing to say, end with the single word SILENT. When you drop it, reply only DROP.
Rules: never invent vitals, times, names, doses or findings. Never give orders; advisory protocol wording only. Never mention compression depth. Doses and allergies are judged only by the check tools.`;

const SYSTEM_NO_W6 = SYSTEM.replace(/- If the medic gives the patient's full name AND birth date.*\n/, '');

const PROACTIVE = `You are Handoff, the voice assistant riding along with a paramedic. Prototype; all data is synthetic.
The live state just changed (CHANGED says what). Nobody asked you anything. Think like an experienced partner watching over the medic's shoulder: is there ONE thing worth saying right now that the medic may have missed? Good reasons to speak:
- a safety link between facts: a recorded allergy against a drug just given or likely next; a home medication that matters now (a blood thinner and bleeding or a head injury; a beta blocker and a low heart rate); a do-not-resuscitate code status during an arrest
- a flagged event the medic has left unanswered for over a minute
- a clear trend in valid vitals (heart rate or SpO2 steadily worse) or a change in status (ROSC: post-arrest checks; en route: the hospital has the record)
- a worsening trend in the TREND line (SpO2 falling fast, HR rising fast): one short note, e.g. "Note: oxygen saturation falling fast. Consider airway and oxygen."
- something the handoff report will need and nobody has documented yet (patient identity, allergies checked, a pulse check after ROSC)
The rules already say "Push faster", "Resume compressions", "Epi due", "Two minutes" and the vitals alarms, and RECENT SPEECH shows what was said lately: never repeat any of those, and never restate a read-back, question or warning Handoff just spoke. A missing or invalid reading ("no valid reading", "no finger", "acquiring") is the sensor, not the patient: never an advisory, never a reason to suggest airway or oxygen. If nothing would clearly help, stay silent; silence is the usual answer.
Return JSON only: {"advisory": null, "summary": "Reviewed the latest update; continuing to monitor."} or {"advisory": "Consider…", "summary": "A brief explanation of the advisory."}.
The summary is a public dashboard status, not internal reasoning. Copy exactly one sentence from ALLOWED DASHBOARD SUMMARIES below; do not write a new clinical claim. Do not claim the patient is stable, infer an improvement or deterioration from a single snapshot, diagnose, or say no treatment is needed. If data is missing or stale, say that rather than assuming improvement. An advisory is 15 words or fewer, protocol wording ("Consider…", "Note:"), never an order, no numbers unless they are in the state.`;

/** A line in the voice log; kept is null while it is still being decided. */
type VoiceLine = { text: string; at: number; kept: boolean | null };

type Pending = {
  eventId: bigint;
  at: number;
  flagged: boolean;
  /** why it is flagged; missing_dose means "confirm" is not enough, a dose is needed */
  reason?: 'allergy' | 'dose' | 'missing_dose' | 'unconfirmed';
  drug?: string;
  /** When Handoff asked "Log it?" about this event; a bare yes / no answers it for ASK_WINDOW_MS. */
  askedAt?: number;
};

/** How long a bare "yes" / "no" counts as the answer to "Log it?". */
const ASK_WINDOW_MS = 30_000;
/** P2/P3 callouts (rule timers, notes) wait this long after a question so the answer isn't talked over (live Sun ~06:00). */
const ASK_HOLD_MS = 8_000;
/** The voice log Nemotron sees to judge a new line: the last lines heard, kept or dropped. */
const VOICE_LOG_LINES = 10;
const VOICE_LOG_MS = 2 * 60_000;

/** The pieces of a medication statement heard so far ("one milligram of" … "epinephrine"). */
type PendingMed = { drug?: string; dose?: number; unit?: Unit; route?: Route; at: number; heard: string[]; asked?: { what: 'drug' | 'dose'; at: number } };
/** A half-heard medication stays open this long after its last piece. */
const PENDING_MED_MS = 20_000;

const DOSE_IN_LABEL = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|mL|units?|J)\b/i;
/** A patient identified from the card or the spoken name with no EHR match: a record that is not a record. */
const CARD_ONLY = 'ID card';
const NO_EHR = 'unknown (no EHR record)';
/** "MG", "ml", "unit" → the Unit the checks and spoken units use. */
function normUnit(raw: string): Unit {
  const u = raw.toLowerCase();
  return u === 'mcg' ? 'mcg' : u === 'g' ? 'g' : u === 'ml' ? 'mL' : u.startsWith('unit') ? 'units' : u === 'j' ? 'J' : 'mg';
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class Brain {
  private processed = new Set<bigint>();
  private ownLines: { text: string; at: number; source: string }[] = [];
  private lastReadback?: Pending;
  private askedSeen = new Set<bigint>();
  private pulling = new Set<string>();
  private incidentId?: bigint;
  /** Bumps on reset/close; slow work compares it before writing (review finding: stale pulls). */
  private gen = 0;
  private proactiveTimer?: NodeJS.Timeout;
  private lastFingerprint = '';
  private proactiveInFlight = false;
  private llmTurnTimes: number[] = [];
  /** A one- or two-word line we skipped ("Administering"); the next line may be its other half. */
  private lastFragment?: { text: string; at: number };
  /** A medication statement heard in pieces, waiting for the rest (PENDING_MED_MS after the last piece). */
  private pendingMed?: PendingMed;
  /** Every line heard lately and whether it was kept: context for Nemotron's keep/drop decision. Memory only. */
  private voiceLog: VoiceLine[] = [];
  /** Recent Nemotron turns: what the medic said and what Handoff did about it. Cleared with the incident. */
  private history: { heard: string; did: string; at: number }[] = [];
  /** What the bodycam sees right now (POST /seen type scene): context in every summary, never a row. Memory only. */
  private camera?: CameraScene;
  /** Runs the vitals-trend check when the proactive timer doesn't (no key, or VOICE_PROACTIVE=off). */
  private trendTimer?: NodeJS.Timeout;
  /** When a note about the current worsening trend was queued; one per episode, cleared once the trend eases. */
  private trendNotedAt?: number;
  /** The last attempt at the fixed trend note, so a dropped one is retried slowly, never every tick. */
  private trendTriedAt = 0;

  constructor(private conn: Conn, private speaker: Speaker, private policy: Policy) {}

  start() {
    const { conn } = this;
    // Lines already in the table when the brain starts were handled by whoever ran before; don't replay them.
    for (const t of conn.db.transcript.iter()) this.processed.add(t.id);
    conn.db.transcript.onInsert((_ctx, row) => void this.onTranscriptRow(row));
    conn.db.incident.onInsert((_ctx, row) => void this.onIncident(row));
    conn.db.incident.onUpdate((_ctx, _old, row) => void this.onIncident(row));
    conn.db.incident.onDelete((_ctx, row) => {
      if (this.incidentId === row.id) this.resetIncident();
    });
    conn.db.event.onInsert((_ctx, row) => void this.onEvent(row));
    conn.db.event.onUpdate((_ctx, _old, row) => void this.onEvent(row));
    const inc = activeIncident(conn);
    if (inc) void this.onIncident(inc);
    if (CONFIG.proactive && llmConfigured()) this.proactiveTimer = setInterval(() => void this.proactiveTick(), PROACTIVE_EVERY_MS);
    // Without the advisory review a worsening trend still gets its one fixed note (the seizure beat, decision 15).
    else this.trendTimer = setInterval(() => void this.trendTick(), TREND_EVERY_MS);
    // The subscription keeps the worker alive; the timers alone must not (tests start brains without stopping them).
    this.proactiveTimer?.unref();
    this.trendTimer?.unref();
    console.log(`[voice] brain ready · Nemotron ${llmConfigured() ? `on (${modelInUse()})` : 'OFF: no NVIDIA_API_KEY, deterministic paths only'} · W6 ${CONFIG.w6 ? 'on' : 'off'} · proactive ${CONFIG.proactive ? 'on' : 'off'}`);
  }

  stop() {
    if (this.proactiveTimer) clearInterval(this.proactiveTimer);
    if (this.trendTimer) clearInterval(this.trendTimer);
    this.proactiveTimer = this.trendTimer = undefined;
  }

  /** True when the incident this work started under is gone (reset, closed, replaced). */
  private stale(gen: number, incidentId?: bigint): boolean {
    if (gen !== this.gen) return true;
    if (incidentId !== undefined && activeIncident(this.conn)?.id !== incidentId) return true;
    return false;
  }

  // ---- input -----------------------------------------------------------------------------------------------

  /**
   * A final utterance from the ear (Pipecat or the terminal bodycam). Decided first, stored after (decision 21):
   * a line that is acted on (a read-back, an answer, a status, a record lookup, or Nemotron keeping it) is written
   * to `transcript`; a dropped line's words are not stored. Model reviews publish only generic status (decision 24).
   */
  async handleUtterance(text: string, source: string) {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!clean) return;
    // The incident the line was said in: a kept line is stored there or nowhere, never under the next incident.
    const gen = this.gen;
    const incidentId = activeIncident(this.conn)?.id;
    const line = this.hear(clean);
    const stored = await this.processLine(clean, source, line);
    line.kept = stored !== null;
    if (stored === null) return;
    if (this.stale(gen, incidentId)) {
      console.log(`[voice] not stored (the incident changed while it was handled): "${stored.slice(0, 60)}"`);
      return;
    }
    // The row coming back is ours and already handled.
    const own = { text: stored.slice(0, 500), at: Date.now(), source };
    this.ownLines = [...this.ownLines.filter(l => Date.now() - l.at < OWN_LINE_MS), own];
    try {
      await this.conn.reducers.addTranscript({ text: own.text });
    } catch (err) {
      console.error('[voice] add_transcript failed', err);
      this.ownLines = this.ownLines.filter(l => l !== own);
    }
  }

  /** Transcript rows: our own (already handled before they were stored) are skipped; the bodycam's (degraded mode) are handled once. */
  private async onTranscriptRow(row: Transcript) {
    if (this.processed.has(row.id)) return;
    this.processed.add(row.id);
    const mine = this.ownLines.findIndex(l => l.text === row.text);
    if (mine >= 0) {
      this.ownLines.splice(mine, 1);
      return;
    }
    const line = this.hear(row.text);
    line.kept = (await this.processLine(row.text, 'transcript', line)) !== null;
  }

  /** Into the voice log as soon as it is heard (pending), so a quick follow-up is judged with it. */
  private hear(text: string): VoiceLine {
    const line: VoiceLine = { text, at: Date.now(), kept: null };
    this.voiceLog = [...this.voiceLog.filter(l => Date.now() - l.at < VOICE_LOG_MS), line].slice(-VOICE_LOG_LINES);
    return line;
  }

  /**
   * Acts on one line. Returns the text to store (the line, or both halves of a stitched one), or null when dropped.
   * Dropped: our own words, filler, and what Nemotron answers DROP. A line nobody could judge (no API key, the rate
   * budget, a model error) is stored, so nothing clinical is lost.
   */
  private async processLine(text: string, source: string, self?: VoiceLine): Promise<string | null> {
    // eslint-disable-next-line no-param-reassign -- a stitched fragment may extend the line below
    const gen = this.gen;
    const lower = text.toLowerCase();
    // Early drops (filler/echoes) leave no trace in the database (decision 21), only in the worker's console;
    // model reviews have generic status rows only (decision 24).
    const drop = (why: string): null => {
      console.log(`[voice] dropped (${why}): "${text.slice(0, 60)}"`);
      return null;
    };
    // A transcript row the bodycam wrote itself means the phone is in degraded mode (B11): its parser already
    // spoke the read-back and logged the event, and it handles its own corrections. Don't do it twice.
    const phoneHandled = source === 'transcript';

    // RB3: correction / confirm first; they are also the only words heard inside the echo guard.
    const control = parseControl(text);
    if (control === 'correction' && this.pendingMed && !phoneHandled) {
      this.pendingMed = undefined;
      await step(this.conn, 'control', 'half-heard medication dropped (medic said "correction")');
      await this.policy.say('Cancelled.', 0, 'control');
      return text;
    }
    if (control) {
      if (!phoneHandled) await this.handleControl(control);
      return text;
    }
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const mine = norm(text);
    const said = this.speaker.recentlySaid().map(norm);
    // The answer to "Log it?": only right after asking, so a "yes" in conversation still reaches Nemotron. Our
    // own "…Log it?" heard back through the mic must never answer itself.
    const asked = this.lastReadback?.askedAt;
    const answer = asked && Date.now() - asked < ASK_WINDOW_MS ? parseAnswer(text) : undefined;
    if (answer && said.some(s => s === mine || s.endsWith(` ${mine}`))) return drop('our own words, not an answer');
    // "No" while a medication is half-heard drops the half (with or without an earlier "Log it?").
    if (parseAnswer(text) === 'no' && this.pendingMed && Date.now() - this.pendingMed.at < PENDING_MED_MS && !phoneHandled) {
      this.pendingMed = undefined;
      await step(this.conn, 'control', 'half-heard medication dropped (medic said "no")');
      await this.policy.say('Cancelled.', 0, 'control');
      return text;
    }
    if (answer && !phoneHandled) {
      await this.handleControl(answer === 'yes' ? 'confirm' : 'correction');
      return text;
    }

    // RB5 echo guard: our own words coming back through the mic (while speaking and shortly after).
    if (ECHO_PREFIXES.some(p => lower.startsWith(p)) || said.some(s => s === mine || (mine.split(' ').length >= 3 && s.startsWith(mine)))) {
      return drop('our own words');
    }

    // RB1–RB7: the read-back fast path, no model call.
    let rb = parseReadback(text);
    // STT split the sentence at a pause ("Administering" | "one milligram of epi IO"): try the two halves together.
    if ((!rb || rb.kind !== 'medication') && this.lastFragment && Date.now() - this.lastFragment.at < 4_000) {
      const stitched = parseReadback(`${this.lastFragment.text} ${text}`);
      if (stitched && stitched.kind === 'medication') {
        text = `${this.lastFragment.text} ${text}`;
        rb = stitched;
      }
    }
    this.lastFragment = undefined;
    // RB9: a bare dose ("one milligram") after "Saw epinephrine. What dose?" belongs to that drug.
    const pending = this.lastReadback;
    if (!rb && pending?.reason === 'missing_dose' && pending.drug && Date.now() - pending.at < PENDING_DOSE_MS && /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|point|hundred|fifty|twenty|thirty|forty)\b/i.test(text)) {
      const asDose = parseReadback(`giving ${pending.drug} ${text}`);
      if (asDose && asDose.kind === 'medication') rb = asDose;
    }
    if (rb && phoneHandled) {
      await step(this.conn, 'read_back', `Phone (degraded mode) already read back: "${text.slice(0, 60)}"`);
      return text;
    }
    if (rb?.kind === 'medication' || rb?.kind === 'shock') {
      this.pendingMed = undefined; // a full statement supersedes any half we were collecting
      await this.handleReadback(rb, text, gen);
      return text;
    }

    // A medication heard in pieces: the drug, the dose and the route can come in any order over several lines,
    // with misheard or unrelated lines in between. Each piece is kept until the statement is complete.
    if (!phoneHandled) {
      const open = this.pendingMed && Date.now() - this.pendingMed.at < PENDING_MED_MS ? this.pendingMed : undefined;
      if (!open) this.pendingMed = undefined;
      const parts = medParts(text);
      const words = text.split(/\s+/).filter(Boolean).length;
      let med: [PendingMed, MedParts] | undefined;
      if (open && (parts.drug || parts.dose !== undefined)) med = [open, parts];
      else if (rb?.kind === 'missing_dose') med = [{ at: Date.now(), heard: [] }, { drug: rb.drug }];
      else if (rb?.kind === 'missing_drug') med = [{ at: Date.now(), heard: [] }, { dose: rb.dose, unit: rb.unit, route: rb.route }];
      else {
        // "One milligram of" (the drug fell into the next line) or a lone "Epinephrine" (the dose comes next).
        const bareDose = !parts.drug && parts.dose !== undefined && parts.unit !== undefined && parts.unit !== 'J' && words <= 6;
        const loneDrug = !parts.dose && words <= 3 && recognizeDrug(text, false);
        if (bareDose || loneDrug) med = [{ at: Date.now(), heard: [] }, loneDrug ? { drug: loneDrug } : parts];
      }
      if (med) {
        await this.fillMedication(med[0], med[1], text, gen);
        return text;
      }
    }

    // X1: "Patient is Jordan Avery, born March 14, 1968"
    const who = parseIdentity(text);
    if (who && CONFIG.w6) {
      await this.identifyFromNameAndDob(who.name, who.birthDate, gen, 'voice');
      return text;
    }

    // B6 shortcuts, deterministic (no model call, one answer): "Handoff, look" is the vision sampler's job (it
    // sees the same transcript and speaks the result); "Handoff, mark" is a MARK on the timeline.
    const shortcut = /^\s*(?:hey\s+)?hand\s?-?\s?off[,.!]?\s+(look|mark)\b/i.exec(text)?.[1]?.toLowerCase();
    if (shortcut === 'look') {
      await step(this.conn, 'look', 'the camera check is the vision sampler\'s; no model turn');
      return text;
    }
    if (shortcut === 'mark') {
      const inc = activeIncident(this.conn);
      if (!inc) {
        await step(this.conn, 'mark', 'no active incident; not logged');
        return text;
      }
      try {
        await this.conn.reducers.logEvent({ kind: 'mark', label: 'MARK (voice)', sourceKind: 'voice', sourceDetail: text.slice(0, 200) });
        await step(this.conn, 'log_event', 'mark: MARK (voice)');
      } catch (err) {
        await step(this.conn, 'log_event', `mark failed: ${(err as Error).message.slice(0, 80)}`);
      }
      await this.policy.say('Marked.', 1, 'control');
      return text;
    }

    // Status changes the medic states plainly are set here, at once, with no model turn ("cardiac arrest" went
    // unhandled when Nemotron ran out of tool rounds, Sun ~02:00). Questions, history ("had an arrest") and
    // conditionals ("in case he arrests") don't count.
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const inc = activeIncident(this.conn);
    const plain = !!inc && !phoneHandled && !/\?\s*$/.test(text) && !/\b(?:history of|previous|prior|had an?|last)\b/i.test(text) && !NOT_PLAIN.test(text);
    let acted = false;
    // "Starting compressions" starts CPR (and the arrest if needed) through log_event('cpr_started'); never a status.
    if (plain && CPR_START.test(text)) {
      acted = true;
      try {
        if (await logCprStarted(this.conn, text)) await this.policy.say('Copy, CPR started.', 1, 'control');
      } catch (err) {
        await step(this.conn, 'log_event', `cpr_started failed: ${(err as Error).message.slice(0, 80)}`);
      }
      if (wordCount <= 6) return text;
    }
    const status = plain ? (['arrest', 'rosc', 'en_route'] as const).find(s => STATUS_PLAIN[s].test(text)) : undefined;
    if (inc && status && inc.status !== status) {
      acted = true;
      try {
        await this.conn.reducers.setStatus({ status, sourceKind: 'voice', sourceDetail: text.slice(0, 200) });
        await step(this.conn, 'set_status', `${inc.status} → ${status} (medic said so)`);
        await this.policy.say({ arrest: 'Copy, cardiac arrest.', rosc: 'Copy, ROSC.', en_route: 'Copy, en route.' }[status], 1, 'control');
      } catch (err) {
        await step(this.conn, 'set_status', `failed: ${(err as Error).message.slice(0, 80)}`);
      }
      if (wordCount <= 6) return text;
    }

    // Everything else: Nemotron reads the line with the voice log and decides to keep it (document, reply) or drop
    // it. Pure filler ("Yeah.", "Okay, so") and lone words are dropped without a model call, to save the budget.
    if (!llmConfigured()) return text; // nobody to judge it: stored, so nothing clinical is lost
    // A one- or two-word line may be the first half of a split read-back ("Administering"); keep it for stitching.
    if (wordCount < 3) this.lastFragment = { text, at: Date.now() };
    if (FILLER.test(text) || (wordCount < 2 && !/\?/.test(text))) return acted ? text : drop('filler');
    const now = Date.now();
    this.llmTurnTimes = this.llmTurnTimes.filter(t => now - t < 60_000);
    if (this.llmTurnTimes.length >= LLM_TURNS_PER_MIN) {
      console.log(`[voice] stored undecided (rate budget: ${LLM_TURNS_PER_MIN} model turns in the last minute): "${text.slice(0, 60)}"`);
      return text;
    }
    this.llmTurnTimes.push(now);
    return (await this.nemotronTurn(normalizeTranscript(text), source, gen, self)) || acted ? text : null;
  }

  // ---- read-back ------------------------------------------------------------------------------------------

  /**
   * Add this line's pieces to the medication being collected. Complete (drug and dose) → the normal read-back.
   * Still missing something → ask for that piece only, and not again while the medic is still answering.
   */
  private async fillMedication(open: PendingMed, parts: MedParts, text: string, gen: number) {
    const med: PendingMed = {
      ...open,
      ...(parts.drug ? { drug: parts.drug } : {}),
      ...(parts.dose !== undefined ? { dose: parts.dose, unit: parts.unit ?? open.unit } : {}),
      ...(parts.route ? { route: parts.route } : {}),
      at: Date.now(),
      heard: [...open.heard, text],
    };
    if (med.drug && med.dose !== undefined) {
      this.pendingMed = undefined;
      const rb = parseReadback(`giving ${med.drug} ${med.dose}${med.unit ? ` ${med.unit}` : ''}${med.route ? ` ${med.route}` : ''}`);
      if (rb?.kind === 'medication') {
        await step(this.conn, 'read_back', `completed from ${med.heard.length} lines: ${med.heard.map(h => `"${h.slice(0, 30)}"`).join(' + ')}`);
        return this.handleReadback(rb, med.heard.join(' | '), gen);
      }
    }
    this.pendingMed = med;
    const what = med.drug ? 'dose' : 'drug';
    await step(this.conn, 'read_back', `collecting: ${med.drug ?? '?'} ${med.dose ?? '?'} ${med.unit ?? ''}${med.route ? ` ${med.route}` : ''} · need the ${what}`);
    // Asked for this already and the medic is mid-answer: wait instead of talking over the next piece.
    if (med.asked?.what === what && Date.now() - med.asked.at < 6_000) return;
    const ask = () => {
      if (this.pendingMed !== med) return;
      med.asked = { what, at: Date.now() };
      void this.policy.say(med.drug ? `${cap(med.drug)}. What dose?` : 'Which drug?', 0, 'readback');
    };
    // "Giving three hundred milligrams of" | "amiodarone": the line closed before the drug; give it 2 s to come.
    if (what === 'drug' && /\b(of|the|some|a|an)\s*[.,]?$/i.test(text)) {
      setTimeout(ask, 2000);
      return;
    }
    ask();
  }

  private async handleReadback(rb: ReadbackMatch, text: string, gen: number) {
    const s = readState(this.conn);
    const dose: DoseVerdict = rb.drug ? checkDoseRange(rb.drug, rb.dose, rb.unit) : { verdict: 'no_range' };
    const ehr = s.record && s.record.source !== CARD_ONLY ? s.record : undefined;
    const allergy = rb.drug ? checkAllergy(rb.drug, ehr?.allergies ?? []) : { allergic: false };
    const out = composeReadback(rb, dose, allergy);
    const inc = s.incident;
    // RB9: a spoken dose for a drug the camera just saw merges into that event and confirms it: nothing to ask.
    const seenWaiting = !!inc && !out.flagged && [...this.conn.db.event.iter()].some(e =>
      e.incidentId === inc.id && e.kind === rb.eventKind && e.status === 'flagged' && e.sources.some(x => x.kind === 'seen') && Date.now() - tsMs(e.ts) < PENDING_DOSE_MS);
    const spokenText = seenWaiting ? rb.spoken : out.spoken;
    await step(this.conn, 'read_back', `${rb.label}${out.flagged ? ` FLAGGED (${out.reason})` : seenWaiting ? ' (camera saw it: confirms)' : ' · asked "Log it?"'}${!ehr && rb.drug ? ' · no EHR record, allergy not checked' : ''}`);
    // Speak first (RB2 latency), then log.
    await this.policy.say(spokenText, 0, 'readback');

    if (!inc) {
      await step(this.conn, 'log_event', 'No active incident: read back but not logged');
      return;
    }
    if (this.stale(gen, inc.id)) return;
    try {
      await this.conn.reducers.logEvent({ kind: rb.eventKind, label: rb.label, sourceKind: 'read-back', sourceDetail: text.slice(0, 200) });
    } catch (err) {
      await step(this.conn, 'log_event', `failed: ${(err as Error).message.slice(0, 80)}`);
      return;
    }
    const ev = await this.findEvent(inc.id, rb.eventKind);
    if (!ev || this.stale(gen, inc.id)) return;
    if (seenWaiting) {
      await this.conn.reducers.setEventStatus({ eventId: ev.id, status: 'confirmed' });
      await step(this.conn, 'set_event_status', `${rb.label}: confirmed (seen by the camera, dose spoken)`);
      this.lastReadback = { eventId: ev.id, at: Date.now(), flagged: false, drug: rb.drug };
      return;
    }
    // Written now so nothing is lost if the medic is too busy to answer. Only a warning (allergy, dose) is flagged:
    // the dashboard and the handoff report show `flagged` as a problem ("not confirmed as given"), so an unanswered
    // routine dose stays `logged`. "Yes" → confirmed, "no" → cancelled.
    if (out.flagged && ev.status !== 'flagged') await this.conn.reducers.setEventStatus({ eventId: ev.id, status: 'flagged' });
    this.lastReadback = { eventId: ev.id, at: Date.now(), flagged: out.flagged, reason: out.reason, drug: rb.drug, askedAt: Date.now() };
    this.speaker.holdLow?.(ASK_HOLD_MS);
  }

  /**
   * An action Nemotron logged (procedure or airway): read it back and ask, like a medication. The event is
   * already written and stays `logged` until the medic answers (yes → confirmed, no → cancelled).
   */
  async confirmAction(kind: string, label: string, valid: () => boolean, turnStartedAt = Date.now()): Promise<void> {
    const inc = activeIncident(this.conn);
    if (!inc) return;
    const ev = await this.findEvent(inc.id, kind, label);
    if (!ev || !valid()) return;
    // A newer read-back asked its own "Log it?" while this turn ran: don't take over its answer. This one stays logged.
    if (this.lastReadback && this.lastReadback.at > turnStartedAt) {
      await step(this.conn, 'read_back', `${label} · logged, not asked (a newer read-back is waiting for its answer)`);
      return;
    }
    this.lastReadback = { eventId: ev.id, at: Date.now(), flagged: false, askedAt: Date.now() };
    this.speaker.holdLow?.(ASK_HOLD_MS);
    await step(this.conn, 'read_back', `${label} · asked "Log it?"`);
    await this.policy.say(`Copy. ${label}. Log it?`, 0, 'readback', undefined, valid);
  }

  /** The newest event of this kind (and label) for the incident (the one log_event just wrote or merged into). */
  private async findEvent(incidentId: bigint, kind: string, label?: string): Promise<Event | undefined> {
    for (let i = 0; i < 6; i++) {
      const ev = [...this.conn.db.event.iter()]
        .filter(e => e.incidentId === incidentId && e.kind === kind && e.status !== 'cancelled' && (label === undefined || e.label === label))
        .sort((a, b) => Number(b.id - a.id))[0];
      if (ev) return ev;
      await new Promise(r => setTimeout(r, 250));
    }
    return undefined;
  }

  private async handleControl(word: 'correction' | 'confirm') {
    const last = this.lastReadback;
    // A read-back that asked "Log it?" takes its answer for ASK_WINDOW_MS; "correction" alone, CONTROL_WINDOW_MS.
    const open = last && (last.flagged || Date.now() - last.at < (last.askedAt ? ASK_WINDOW_MS : CONTROL_WINDOW_MS));
    if (!last || !open) {
      await step(this.conn, 'control', `"${word}" with nothing to apply it to`);
      return;
    }
    // The read-back the medic talked over must not play again after their answer.
    await this.speaker.dropUnspokenReadbacks();
    if (word === 'confirm' && last.reason === 'missing_dose') {
      // RB9: a drug the camera saw stays flagged until a dose is spoken; "confirm" can't invent one.
      await step(this.conn, 'control', `"confirm" on ${last.drug} without a dose: still need the dose`);
      await this.policy.say(`${cap(last.drug ?? 'That')} needs a dose. Say the dose.`, 1, 'ask');
      return;
    }
    if (word === 'confirm' && last.reason === 'allergy') {
      // A camera-seen drug with an allergy warning and no readable dose: the allergy is acknowledged, but the
      // event still has no dose, so it stays flagged for that reason (RB9).
      const ev = [...this.conn.db.event.iter()].find(e => e.id === last.eventId);
      if (ev && ev.sources.some(x => x.kind === 'seen') && !ev.sources.some(x => x.kind === 'read-back') && !DOSE_IN_LABEL.test(ev.label)) {
        this.lastReadback = { ...last, reason: 'missing_dose', at: Date.now() };
        await step(this.conn, 'control', `allergy acknowledged for ${last.drug}; still flagged, no dose`);
        await this.policy.say('Confirmed. Say the dose.', 0, 'readback');
        return;
      }
    }
    const status = word === 'correction' ? 'cancelled' : 'confirmed';
    try {
      await this.conn.reducers.setEventStatus({ eventId: last.eventId, status });
      await step(this.conn, 'set_event_status', `event ${last.eventId} ${status} (medic said "${word}")`);
    } catch (err) {
      await step(this.conn, 'set_event_status', `failed: ${(err as Error).message.slice(0, 80)}`);
    }
    await this.policy.say(word === 'correction' ? 'Cancelled.' : 'Logged.', 0, 'control');
    this.lastReadback = undefined;
    this.speaker.releaseLow?.();
  }

  // ---- W6: who is the patient -------------------------------------------------------------------------------

  /** X1: the medic said the name and birth date ("voice"), or the camera read them off the ID card ("ID card"). */
  private async identifyFromNameAndDob(name: string, birthDate: string, gen: number, method: 'voice' | 'ID card') {
    const inc = activeIncident(this.conn);
    await step(this.conn, 'search_ehr', `${method === 'voice' ? 'heard' : 'ID card read'} "${name}, born ${birthDate}"`);
    let matches;
    try {
      matches = await searchPatients(name, birthDate);
    } catch (err) {
      // X7: the EHR is down. The cached synthetic record is used only for exactly this name and birth date.
      const cached = cachedMatch(name, birthDate);
      await step(this.conn, 'search_ehr', `EHR unavailable: ${(err as Error).message.slice(0, 80)}${cached ? `; cached copy matches ${cached.patientRef}` : ''}`);
      if (!cached) {
        await this.policy.say('Record lookup unavailable.', 1, 'ask');
        return;
      }
      matches = [{ id: cached.patientRef, name: cached.name, birthDate: cached.birthDate }];
    }
    if (this.stale(gen, inc?.id)) return;
    if (matches.length === 0) {
      await step(this.conn, 'search_ehr', 'no match');
      // The identity still counts (Alan, Sun ~06:45): the hospital sees the name and birth date from the card or the
      // medic's words, marked as having no EHR record. Allergies, medications and code status are "unknown", never
      // "none": the checks treat this record as no record.
      if (inc) await this.saveCardOnlyRecord(inc, name, birthDate, method, gen);
      await this.policy.say(`No EHR record for ${name}. Identified from the ${method === 'voice' ? 'spoken name' : 'ID card'}.`, 1, 'ask', undefined, () => !this.stale(gen, inc?.id));
      return;
    }
    if (matches.length > 1) {
      // X8: never guess.
      await step(this.conn, 'search_ehr', `${matches.length} matches; asking`);
      await this.policy.say(`${matches.length === 2 ? 'Two' : 'Several'} patients named ${name}. Say the birth date.`, 1, 'ask', undefined, () => !this.stale(gen, inc?.id));
      return;
    }
    if (!inc) {
      await step(this.conn, 'identify_patient', 'No active incident; record not pulled');
      return;
    }
    if (inc.patientRef === matches[0].id && [...this.conn.db.patientRecord.iter()].some(r => r.incidentId === inc.id && r.patientRef === inc.patientRef)) {
      // The card stays in view for a while: the same patient again is not news.
      await step(this.conn, 'identify_patient', `${matches[0].id} already identified (${method}); nothing to do`);
      return;
    }
    try {
      await this.conn.reducers.identifyPatient({ patientRef: matches[0].id, method });
    } catch (err) {
      await step(this.conn, 'identify_patient', `failed: ${(err as Error).message.slice(0, 80)}`);
    }
    await this.pullRecord(matches[0].id, method);
  }

  /**
   * POST /say: fixed words from the ear-and-eyes worker (the answer to "Handoff, look"), through the policy and
   * the shared queue like everything else. Only the two reply kinds; never read-backs or advisories.
   */
  say(text: string, priority: number, kind: 'ask' | 'vision'): Promise<boolean> {
    const p = Math.min(3, Math.max(1, Math.round(priority)));
    return this.policy.say(text, p, kind);
  }

  // ---- what the camera saw (POST /seen from voice/pipecat/vision.py) -------------------------------------------

  /**
   * One vision finding. An ID card runs the W6 search with method "ID card"; a drug being given is logged with
   * source "seen" (the printed dose in the label, never a guessed one) and then handled by onEvent like any
   * camera-seen drug (RB9/RB10); AED pads, airway and IV/IO become procedure rows. Returns a short trace note.
   */
  async handleSeen(f: SeenFinding): Promise<string> {
    const gen = this.gen;
    const inc = activeIncident(this.conn);
    // What is in view right now: context for the next turns (CAMERA line), one trace row, no event or transcript.
    if (f.type === 'scene') {
      this.camera = { text: f.text, at: Date.now() };
      await step(this.conn, 'vision', `Camera: ${f.text}`);
      return 'scene';
    }
    const conf = f.confidence !== undefined ? ` (confidence ${f.confidence.toFixed(2)})` : '';
    if (f.type === 'id_card') {
      if (!CONFIG.w6) {
        await step(this.conn, 'seen', `ID card ${f.name}, ${f.birthDate}${conf}: VOICE_W6 is off, the bodycam lane identifies`);
        return 'w6 off';
      }
      if (!inc) {
        await step(this.conn, 'seen', `ID card ${f.name}, ${f.birthDate}${conf}: no active incident`);
        return 'no active incident';
      }
      await step(this.conn, 'seen', `ID card: ${f.name}, born ${f.birthDate}${conf}${f.detail ? ` · ${f.detail}` : ''}`);
      await this.identifyFromNameAndDob(f.name, f.birthDate, gen, 'ID card');
      return 'identified';
    }
    const ev = seenEvent(f);
    if (!ev) {
      await step(this.conn, 'seen', `camera saw a drug it can't name ("${f.type === 'medication' ? f.drug : f.type}"); not logged`);
      return 'unknown drug';
    }
    if (!inc) {
      await step(this.conn, 'seen', `camera saw ${ev.label}${conf}: no active incident, not logged`);
      return 'no active incident';
    }
    try {
      // The row comes back through onEvent (status "logged", source "seen"), which asks for or checks the dose.
      await this.conn.reducers.logEvent({ kind: ev.kind, label: ev.label, sourceKind: 'seen', sourceDetail: (f.detail ?? 'vision frame').slice(0, 200) });
    } catch (err) {
      await step(this.conn, 'log_event', `seen ${ev.label}: failed: ${(err as Error).message.slice(0, 80)}`);
      return 'log_event failed';
    }
    if (!this.stale(gen, inc.id)) await step(this.conn, 'log_event', `${ev.kind}: ${ev.label} (seen${conf})`);
    return 'logged';
  }

  /**
   * A patient with a name and birth date but no EHR match: saved as a record from the card (source `ID card`,
   * patientRef `card:<name>-<date>`), so the dashboard and the report show who it is, with every clinical field
   * "unknown (no EHR record)". `identify_patient` then points the incident at it. Done once per incident.
   */
  private async saveCardOnlyRecord(inc: Incident, name: string, birthDate: string, method: 'voice' | 'ID card', gen: number) {
    const patientRef = `card:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${birthDate}`;
    if ([...this.conn.db.patientRecord.iter()].some(r => r.incidentId === inc.id && r.patientRef === patientRef)) return;
    if (this.stale(gen, inc.id)) return;
    try {
      await this.conn.reducers.savePatientRecord({
        patientRef, name, birthDate,
        allergies: [NO_EHR], medications: [NO_EHR], conditions: [], codeStatus: NO_EHR, source: CARD_ONLY,
      });
      await step(this.conn, 'save_patient_record', `${name}, born ${birthDate}: no EHR record; identity from the ${method} saved as "${CARD_ONLY}"`);
      if (inc.patientRef !== patientRef) await this.conn.reducers.identifyPatient({ patientRef, method });
    } catch (err) {
      await step(this.conn, 'save_patient_record', `card-only record failed: ${(err as Error).message.slice(0, 80)}`);
    }
  }

  /**
   * Pull and save the record once per incident, then speak the summary (X3, X4, X7). Returns the spoken text.
   * Bound to the incident it started under: a reset, a close or a different patient chosen meanwhile drops it.
   */
  async pullRecord(patientRef: string, method: string): Promise<string> {
    const inc = activeIncident(this.conn);
    if (!inc) throw new Error('no active incident');
    const gen = this.gen;
    const key = `${inc.id}:${patientRef}`;
    const existing = [...this.conn.db.patientRecord.iter()].find(r => r.incidentId === inc.id);
    if (existing?.patientRef === patientRef) return spokenRecordSummary(existing);
    if (this.pulling.has(key)) return 'record already being pulled';
    this.pulling.add(key);
    try {
      await step(this.conn, 'ehr_get_record', `${patientRef} (${method})`);
      const rec = await fetchRecord(patientRef);
      const now = activeIncident(this.conn);
      if (this.stale(gen, inc.id) || (now?.patientRef !== undefined && now.patientRef !== patientRef)) {
        await step(this.conn, 'ehr_get_record', `${patientRef}: dropped, the incident or the patient changed meanwhile`);
        return '';
      }
      if (now?.patientRef !== patientRef) {
        try {
          await this.conn.reducers.identifyPatient({ patientRef, method });
        } catch {
          // already identified by someone else; the record still saves
        }
      }
      await this.conn.reducers.savePatientRecord({
        patientRef: rec.patientRef,
        name: rec.name,
        birthDate: rec.birthDate,
        allergies: rec.allergies,
        medications: rec.medications,
        conditions: rec.conditions,
        codeStatus: rec.codeStatus,
        source: rec.source,
      });
      await step(this.conn, 'save_patient_record', `${rec.name}: ${rec.allergies.length} allergies, ${rec.medications.length} meds, ${rec.conditions.length} conditions (${rec.source})`);
      const summary = spokenRecordSummary(rec);
      await this.policy.say(summary, 2, 'record', undefined, () => !this.stale(gen, inc.id));
      return summary;
    } finally {
      this.pulling.delete(key);
    }
  }

  private async onIncident(inc: Incident) {
    if (inc.status === 'closed') {
      if (this.incidentId === inc.id) this.resetIncident();
      return;
    }
    if (this.incidentId !== inc.id) {
      this.resetIncident();
      this.incidentId = inc.id;
      // The first look at an incident is the baseline, not a change: a cold start that reviewed "everything
      // changed" made the model invent "Consider checking pulse post-shock" with no shock anywhere (live Sun ~04:47).
      this.lastFingerprint = JSON.stringify(this.fingerprint(readState(this.conn)));
    }
    // W6 trigger: patientRef set by anyone (ID card, voice, /controls) and no record yet (spec §17).
    if (CONFIG.w6 && inc.patientRef) {
      const has = [...this.conn.db.patientRecord.iter()].some(r => r.incidentId === inc.id && r.patientRef === inc.patientRef);
      if (!has) {
        const method = [...this.conn.db.event.iter()].filter(e => e.incidentId === inc.id && e.kind === 'patient_identified').at(-1)?.sources[0]?.kind ?? 'manual';
        this.pullRecord(inc.patientRef, method).catch(err => step(this.conn, 'ehr_get_record', `failed: ${(err as Error).message.slice(0, 80)}`));
      }
    }
  }

  private resetIncident() {
    this.gen++;
    this.lastReadback = undefined;
    this.askedSeen.clear();
    this.pulling.clear();
    this.lastFingerprint = '';
    this.incidentId = undefined;
    this.history = [];
    this.pendingMed = undefined;
    this.voiceLog = [];
    this.camera = undefined;
    this.trendNotedAt = undefined;
    this.trendTriedAt = 0;
  }

  // ---- RB8–RB10: drugs the camera sees ----------------------------------------------------------------------

  private async onEvent(ev: Event) {
    // A camera-seen drug arrives as a row with source "seen" and status "logged", whether it came from this
    // worker's vision sampler (POST /seen, decision 20) or from any other client calling log_event.
    if (!ev.kind.startsWith('med_') || this.askedSeen.has(ev.id)) return;
    if (ev.status !== 'logged' && ev.status !== 'flagged') return;
    if (!ev.sources.some(x => x.kind === 'seen')) return;
    if (ev.sources.some(x => x.kind === 'read-back')) return; // seen and said: the read-back path owns it
    this.askedSeen.add(ev.id);
    const gen = this.gen;
    const drug = ev.kind.slice(4).replace(/_/g, ' ');
    const s = readState(this.conn);
    const allergy = checkAllergy(drug, s.record && s.record.source !== CARD_ONLY ? s.record.allergies : []);
    // The label carries the printed dose when the camera could read one ("Epinephrine 1 mg"); never a guess.
    const printed = DOSE_IN_LABEL.exec(ev.label);
    const unit = printed ? normUnit(printed[2]) : undefined;
    const dose = printed && unit ? checkDoseRange(drug, Number(printed[1]), unit) : undefined;
    const doseWords = printed && unit ? `, ${spoken(Number(printed[1]))} ${spokenUnit(unit, Number(printed[1]))}` : '';
    const an = /^[aeiou]/i.test(drug) ? 'an' : 'a';

    const flag = async (reason: Pending['reason']) => {
      // askedAt: a bare "yes" / "no" answers the spoken "Confirm?" / "What dose?" like any read-back question.
      // "Confirm?" takes a bare yes / no; "What dose?" (missing_dose) doesn't: a stray "no" must not cancel what the
      // camera saw (RB9 keeps it flagged until a dose is spoken).
      this.lastReadback = { eventId: ev.id, at: Date.now(), flagged: true, reason, drug, askedAt: reason === 'missing_dose' ? undefined : Date.now() };
      if (ev.status !== 'flagged' && !this.stale(gen, ev.incidentId)) {
        try {
          await this.conn.reducers.setEventStatus({ eventId: ev.id, status: 'flagged' });
        } catch (err) {
          await step(this.conn, 'set_event_status', `failed: ${(err as Error).message.slice(0, 80)}`);
        }
      }
    };

    if (allergy.allergic) {
      // RB10: the same deterministic warning as a spoken dose, with no words spoken. Read-back class (P0).
      await flag('allergy');
      await step(this.conn, 'check_allergy', `camera saw ${drug}: ALLERGY (${allergy.match})`);
      await this.policy.say(`Saw ${drug}${doseWords}. Warning: the record lists ${an} ${drug} allergy. Say confirm or correction.`, 0, 'readback', undefined, () => !this.stale(gen, ev.incidentId));
      return;
    }
    if (dose?.verdict === 'out_of_range') {
      // RB10: the printed dose gets the same range check as a spoken one.
      await flag('dose');
      await step(this.conn, 'check_dose_range', `camera saw ${drug} ${printed![1]} ${unit}: out of range (${dose.range})`);
      await this.policy.say(`Saw ${drug}${doseWords}. Outside the protocol range. Say confirm or correction.`, 0, 'readback', undefined, () => !this.stale(gen, ev.incidentId));
      return;
    }
    if (printed) {
      // Seen with a readable dose, in range (or no range on file), no allergy. Still seen-but-not-said, so it
      // stays flagged (RB9) until the medic confirms or speaks the dose; the read-back of what was seen asks.
      await flag('unconfirmed');
      await step(this.conn, 'seen', `camera saw ${drug} ${printed[1]} ${unit} given${dose?.verdict === 'in_range' ? ' (in range)' : ''}; awaiting confirm`);
      await this.policy.say(`Saw ${drug}${doseWords}. Confirm?`, 2, 'ask', undefined, () => !this.stale(gen, ev.incidentId));
      return;
    }
    // RB9: seen but not said: flagged until a dose is spoken; ask once. A dose within 30 s merges and confirms.
    await flag('missing_dose');
    await step(this.conn, 'seen', `camera saw ${drug} given, no dose spoken yet`);
    await this.policy.say(`Saw ${drug}. What dose?`, 2, 'ask', undefined, () => !this.stale(gen, ev.incidentId));
  }

  // ---- Nemotron ---------------------------------------------------------------------------------------------

  private toolContext(valid: () => boolean, utterance: string, addressed: boolean, startedAt = Date.now()): ToolContext {
    return { conn: this.conn, policy: this.policy, corpus: [], pullRecord: (ref, method) => this.pullRecord(ref, method), valid, utterance, addressed, confirmAction: (kind, label) => this.confirmAction(kind, label, valid, startedAt) };
  }

  /**
   * Is the line meant for Handoff? A question, its name, a direct request ("Can you pull up his record"), or a
   * follow-up within 5 s of Handoff answering. Only such a line may be answered out loud (§19, decision 21).
   */
  private isAddressed(text: string): boolean {
    if (/\?\s*$/.test(text) || HANDOFF_NAME.test(text) || DIRECT_REQUEST.test(text)) return true;
    const last = this.history.at(-1);
    return !!last && Date.now() - last.at < FOLLOW_UP_MS && /\bsaid "/.test(last.did);
  }

  /** One Nemotron turn on a line. Returns whether it kept the line (acted, replied or SILENT) or dropped it (DROP). */
  private async nemotronTurn(text: string, source: string, gen: number, self?: VoiceLine): Promise<boolean> {
    const startedAt = Date.now();
    const deadline = startedAt + CONFIG.llmTimeoutMs;
    const incidentId = activeIncident(this.conn)?.id;
    const valid = () => !this.stale(gen, incidentId);
    // Decided once, before the history moves: gates `speak` and any free text the model writes.
    const addressed = this.isAddressed(text);
    const ctx = this.toolContext(valid, text, addressed, startedAt);
    const state = readState(this.conn);
    const summary = summarize(state, this.camera);
    this.history = this.history.filter(h => Date.now() - h.at < HISTORY_MS).slice(-HISTORY_TURNS);
    // The number check (policy) is grounded in the tables, not the camera: a number the vision model wrote into
    // the scene sentence is never a fact the model may speak.
    ctx.corpus.push(summarize(state), text, ...this.history.map(h => h.heard));
    // Memory goes in as plain text, not as past assistant turns: the model copied that format into its replies.
    const conversation = this.history.map(h => `- heard "${h.heard}" → you: ${h.did}`).join('\n');
    // The voice log: what was heard lately and what was kept, so a follow-up is judged with its context.
    const voiceLog = this.voiceLog
      .filter(l => l !== self)
      .map(l => `- [${l.kept === null ? 'being handled' : l.kept ? 'kept' : 'dropped'}] "${l.text}"`)
      .join('\n');
    const messages: ChatMessage[] = [
      { role: 'system', content: `${CONFIG.w6 ? SYSTEM : SYSTEM_NO_W6}\n\nLIVE STATE\n${summary}` },
      {
        role: 'user',
        content:
          `${voiceLog ? `VOICE LOG (oldest first)\n${voiceLog}\n\n` : ''}` +
          `${conversation ? `RECENT CONVERSATION WITH YOU (oldest first)\n${conversation}\n\n` : ''}NEW LINE: "${text}"`,
      },
    ];
    // The state is already in the prompt, so get_state only burned tool rounds (live, Sun ~02:00). A question is
    // answered, not documented: without log_event the model can't spend the turn re-logging.
    const question = /\?\s*$/.test(text);
    const tools = toolsFor(CONFIG.w6).filter(t => t.function.name !== 'get_state' && !(question && t.function.name === 'log_event'));
    const did: string[] = [];
    let spoke = false;
    const decision = new DecisionLog(this.conn, valid);
    let toolFailed = false;
    // Once any tool ran (a record pull, a lookup, a refused call), the line is kept: DROP only counts as the first,
    // tool-free answer. A whole-reply "DROP" only: "Drop in heart rate since ROSC" is an answer, not a decision.
    let toolsRan = false;
    // The model wrote something that was not said (its notes, or an answer to a line not meant for Handoff).
    let withheld = false;
    const isDrop = (c: string) => /^\W*drop\W*$/i.test(c);
    const kept = async () => {
      const recorded = did.some(d => /^(logged|set status)/.test(d));
      const queued = did.some(d => d.startsWith('said'));
      await decision.write(toolFailed ? 'error' : 'complete', toolFailed
        ? 'Review finished with an unsuccessful request; check the recorded tool results.'
        : recorded && queued ? 'Recorded the clinical update and queued a reply for the medic.'
        : recorded ? 'Recorded the clinical update; no additional reply needed.'
        : queued ? 'Queued a reply for the medic.'
        : withheld ? 'Reviewed the clinical update; nothing to say aloud.'
        : 'Reviewed the clinical update; continuing to monitor without an additional reply.');
      this.remember(text, did);
      return true;
    };
    await decision.write('progress', 'Reviewing the incoming audio and latest patient state.');
    try {
      for (let turn = 0; turn < 3; turn++) {
        const remaining = deadline - Date.now();
        if (remaining < 800) throw new Error('voice turn deadline reached');
        const reply = await chat(messages, { tools, timeoutMs: remaining });
        if (this.stale(gen, incidentId)) {
          console.log(`[voice] stopped (the incident changed during the turn): "${text.slice(0, 60)}"`);
          return toolsRan || did.length > 0;
        }
        if (reply.toolCalls.length === 0) {
          // Lightning sometimes answers in text as `speak: …` instead of calling the tool; same meaning.
          if (!reply.content.trim()) throw new Error('Empty model decision');
          const content = reply.content.trim().replace(/^(?:speak|said)\s*[:(]\s*/i, '').replace(/^["']|["')]+$/g, '').trim();
          // DROP: not about this patient and not for Handoff. Nothing was done, so nothing is stored: no transcript
          // or event, only a generic outcome without the dropped words (decision 24).
          if (!toolsRan && !spoke && !did.length && isDrop(content)) {
            // Only a line that names Handoff or is a question overrules the model's DROP ("Handoff, what have we
            // given so far?" came back DROP, live Sun ~04:48). A softer cue (a request, a follow-up) still lets the
            // model answer, but its DROP stands: "Hey can you pass me the tape" is for a partner (live Sun ~04:55).
            if (!(HANDOFF_NAME.test(text) || question)) {
              console.log(`[voice] dropped (Nemotron): "${text.slice(0, 60)}"`);
              await decision.write('complete', 'Ignored unrelated audio; continuing to monitor.');
              return false;
            }
            console.log(`[voice] DROP overruled, the line was meant for Handoff: "${text.slice(0, 60)}"`);
            break;
          }
          if (!content || /^silent\b/i.test(content) || /\bSILENT\.?$/.test(content) || isDrop(content) || spoke) {
            // kept, nothing to say
          } else if (/^(?:logged|set status|stayed silent|heard)\b/i.test(content)) {
            // An action note is not evidence that a tool succeeded; the log uses actual tool results below.
          } else if (!addressed || !looksLikeSpeech(content)) {
            // Free text is said only as a reply to the medic, and only when it reads like speech: never the model's
            // reasoning, and never an answer to background talk. The note stays in the console, not in agent_step
            // (decision 24: no raw model words); the dashboard gets the generic outcome from kept().
            console.log(`[voice] not spoken (${addressed ? 'not speech' : 'line not meant for Handoff'}): "${content.replace(/\s+/g, ' ').slice(0, 160)}"`);
            withheld = true;
          } else {
            await decision.write('progress', 'Preparing a reply for the medic.');
            if (await this.policy.say(content, 1, 'answer', ctx.corpus.join('\n'), valid)) did.push(`said "${content}"`);
            else toolFailed = true;
          }
          return kept();
        }
        messages.push({ role: 'assistant', content: reply.content || null, tool_calls: reply.toolCalls });
        for (const call of reply.toolCalls) {
          if (this.stale(gen, incidentId)) {
            console.log(`[voice] stopped (the incident changed during the tool calls): "${text.slice(0, 60)}"`);
            return toolsRan || did.length > 0;
          }
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            // the tool reports what's missing
          }
          // `speak` on a line not meant for Handoff is refused by runTool: a policy decision (stay silent), not a
          // failed request, so it neither says "Preparing a reply" nor ends the review as an error, and it is not
          // a tool that "ran" (a DROP after it still drops the line, decision 21).
          const refusedSpeak = call.function.name === 'speak' && !addressed;
          if (refusedSpeak) withheld = true;
          else {
            toolsRan = true;
            await decision.write('progress', toolProgress(call.function.name));
          }
          // One spoken answer per line: a second speak in the same turn would talk at the medic twice.
          const result = spoke && call.function.name === 'speak'
            ? JSON.stringify({ error: 'you already answered this line; stop' })
            : await runTool(call.function.name, args, ctx);
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
          // Tools can return facts as plain text or arrays as well as JSON objects.
          try {
            const payload: unknown = JSON.parse(result);
            // A guardrail refusal (a medication the model tried to log, a status the medic didn't state) is the
            // brain deciding, not a failed request: the review still completes.
            if (payload && typeof payload === 'object' && 'error' in payload && !('refused' in payload) && !refusedSpeak) toolFailed = true;
          } catch { /* A plain state summary is a valid tool result. */ }
          if (!result.includes('"ok":true')) continue;
          if (call.function.name === 'speak') {
            spoke = true;
            did.push(`said "${String(args.text ?? '')}"`);
          } else if (call.function.name === 'log_event') did.push(`logged ${args.kind} "${args.label}"`);
          else if (call.function.name === 'set_status') did.push(`set status ${args.status}`);
        }
      }
      if (toolsRan) did.push('stopped after 3 tool rounds');
      // Spoken to and still no answer: one last call with no tools, so a question is never met with silence.
      if (addressed && !spoke && deadline - Date.now() > 800) {
        const last = await chat([...messages, { role: 'user', content: 'Answer the medic now in one or two short sentences, from the state and the tool results above. No tools.' }], { timeoutMs: deadline - Date.now() });
        const content = last.content.trim().replace(/^(?:speak|said)\s*[:(]\s*/i, '').replace(/^["']|["')]+$/g, '').trim();
        if (content && !/^silent\b/i.test(content) && !isDrop(content)) {
          // The same gate as free text above: never read the model's notes aloud.
          if (!looksLikeSpeech(content)) {
            console.log(`[voice] not spoken (not speech): "${content.replace(/\s+/g, ' ').slice(0, 160)}"`);
            withheld = true;
          } else if (valid() && await this.policy.say(content, 1, 'answer', ctx.corpus.join('\n'), valid)) did.push(`said "${content}"`);
        }
      }
      // Running out of tool rounds is a failure only when nothing came of the turn: a question answered after three
      // rounds of reading the timeline is a completed review (live Sun ~04:58), not an unsuccessful request.
      if (toolsRan && !did.some(d => /^(?:said|logged|set status)/.test(d))) toolFailed = true;
      return kept();
    } catch (err) {
      // No decision (timeout, API error): the line is stored undecided so nothing clinical is lost; the rules are the
      // safety net for anything that needed saying. The failure is visible as a failure on the dashboard, with no
      // exception text or room talk in the row (decision 24).
      console.log(`[voice] Nemotron failed on "${text.slice(0, 60)}": ${(err as Error).message.slice(0, 100)}; line stored undecided`);
      await decision.write('error', 'Could not finish the review; the line was kept undecided. Rule callouts remain active.');
      if (did.length) this.remember(text, did);
      return true;
    }
  }

  private remember(heard: string, did: string[]) {
    this.history.push({ heard, did: did.join('; ') || 'stayed silent', at: Date.now() });
    this.history = this.history.slice(-HISTORY_TURNS);
  }

  /**
   * Unprompted advisories (VOICE_PROACTIVE, on by default): one model call when something that matters changed
   * (status, events, flags, timers, the record, vitals bands, CPR), every 10 s at most, inside the rate budget.
   */
  /**
   * What a state change means for the advisory review. Not the event count: a new event is a read-back or a rule
   * that has just spoken, and reviewing right after it only restated it ("Note: Epinephrine administered", live
   * Sun ~04:48). Flags, the record, status, timers, vitals bands, CPR and the trend are what an advisory can add to.
   */
  private fingerprint(s: State): Record<string, string> {
    const v = s.vitals;
    return {
      status: s.incident?.status ?? 'none',
      flagged: String(s.events.filter(e => e.status === 'flagged').length),
      // Only a timer that is DUE is news; one that just started is the dose that was read back a moment ago (the
      // review after it produced "Consider: epinephrine running", live Sun ~05:03).
      timers: s.timers.filter(t => t.state === 'due').map(t => `${t.kind}:due`).join(','),
      record: s.record ? `${s.record.name} (${s.record.allergies.length} allergies)` : 'none',
      vitals: v?.valid ? `HR ~${Math.round((v.hr ?? 0) / 10) * 10} SpO2 ~${Math.round((v.spo2 ?? 0) / 3) * 3}` : v ? `no valid reading (${v.status})` : 'none',
      cpr: s.cpr?.fresh ? (s.cpr.compressing ? 'compressing' : 'paused') : 'none',
      // Coarse words ("SpO2 falling fast, HR rising fast"), so a movement is one change, not one per second.
      trend: s.trend?.words ?? 'none',
    };
  }

  private async proactiveTick() {
    const s = readState(this.conn);
    if (!s.incident || this.proactiveInFlight) return;
    this.trackTrendEpisode(s);
    const parts = this.fingerprint(s);
    const fingerprint = JSON.stringify(parts);
    // Nothing new for the model; a trend note the policy dropped earlier is still retried (no model call).
    if (fingerprint === this.lastFingerprint) return this.trendNote(s);
    const before: Record<string, string> = this.lastFingerprint ? JSON.parse(this.lastFingerprint) : {};
    const changed = Object.keys(parts).filter(k => before[k] !== parts[k]).map(k => `${k}: ${before[k] ?? 'n/a'} → ${parts[k]}`);
    const now = Date.now();
    this.llmTurnTimes = this.llmTurnTimes.filter(t => now - t < 60_000);
    if (this.llmTurnTimes.length >= LLM_TURNS_PER_MIN) return this.trendNote(s);
    this.llmTurnTimes.push(now);
    this.lastFingerprint = fingerprint;
    this.proactiveInFlight = true;
    try {
      // The fixed trend note follows any review that queued nothing: silence, a dropped advisory or a failure.
      if (!(await this.adviseOnce(s, changed))) await this.trendNote(s);
    } finally {
      this.proactiveInFlight = false;
    }
  }

  /** One advisory review by Nemotron. Returns true when an advisory was queued. */
  private async adviseOnce(s: State, changed: string[]): Promise<boolean> {
    const gen = this.gen;
    const valid = () => !this.stale(gen, s.incident!.id);
    const decision = new DecisionLog(this.conn, valid);
    const summary = summarize(s, this.camera);
    try {
      await decision.write('progress', 'Reviewing the latest state change for an advisory.');
      const reply = await chat(
        [
          { role: 'system', content: `${PROACTIVE}\n\nLIVE STATE\n${summary}\n\nALLOWED DASHBOARD SUMMARIES\n${publicSummaries(summary).map(text => `- ${text}`).join('\n')}` },
          { role: 'user', content: `CHANGED\n${changed.join('\n')}\n\nReturn the advisory decision JSON, including a brief public summary even when continuing to monitor.` },
        ],
        { timeoutMs: CONFIG.llmTimeoutMs, maxTokens: 180 }
      );
      if (!valid()) return false;
      const result = advisoryDecision(reply.content, summary);
      if (!result.advisory) {
        await decision.write('complete', result.summary);
        return false;
      }
      // Facts only (§19): an advisory about a shock, a drug, a seizure or a record the state doesn't hold is the
      // model inventing ("Consider checking pulse post-shock" on scene with no shock, live Sun ~04:47).
      const invented = ungroundedTerm(result.advisory, summary);
      if (invented) {
        await step(this.conn, 'policy', `Dropped advisory: "${invented}" is not in the state`);
        await decision.write('complete', 'Reviewed the state; the advisory referred to something not in the state and was not spoken.');
        return false;
      }
      // Never restate what Handoff just said (§19, decision 21): "Note: amiodarone allergy confirmed" right after the
      // allergy warning was spoken (live Sun ~04:59) shares its clinical words with that callout.
      const restated = restatesRecentSpeech(result.advisory, s);
      if (restated) {
        await step(this.conn, 'policy', `Dropped advisory: restates what was just said ("${restated.slice(0, 60)}")`);
        await decision.write('complete', 'Reviewed the state; the advisory repeated a callout just spoken and was not said again.');
        return false;
      }
      // One note per worsening episode, whoever says it: once the trend has been noted, another advisory about the
      // oxygen saturation or heart rate is a repeat (the model said "oxygen saturation falling fast" twice, 20 s apart).
      const trendNow = readState(this.conn).trend;
      if (this.trendNotedAt !== undefined && trendNow?.worsening && TREND_WORDS.test(result.advisory)) {
        await decision.write('complete', 'Reviewed the vitals trend; it was already noted to the medic.');
        return false;
      }
      await decision.write('progress', 'Preparing an advisory for the medic.');
      // Numbers are checked against the tables (no CAMERA line): the vision model's words are not facts to speak.
      const queued = await this.policy.say(result.advisory, 2, 'advisory', summarize(s), valid);
      // Spoken during a worsening trend (as it stands now, not when the review began), the model's advisory is this
      // episode's note: no fixed note after it.
      if (queued && (s.trend?.worsening || trendNow?.worsening)) this.trendNotedAt = Date.now();
      await decision.write(queued ? 'complete' : 'error', queued
        ? `Queued advisory: ${result.advisory}`
        : 'Reviewed the state; the speech policy did not queue the advisory.');
      return queued;
    } catch {
      await decision.write('error', 'Could not finish the advisory review; no decision was made. Rule callouts remain active.');
      return false;
    }
  }

  // ---- vitals trend: one spoken note per worsening episode (the seizure beat) -----------------------------------

  /**
   * An episode ends when valid readings show the trend is no longer worsening; the next worsening trend gets a
   * new note. A dropped reading (no trend at all: the clip slipped) does not end it, or one slip would mean a
   * second note for the same slide.
   */
  private trackTrendEpisode(s: State) {
    if (s.trend && !s.trend.worsening) this.trendNotedAt = undefined;
  }

  /** The vitals-trend check on its own timer, when the proactive review doesn't run (no key, VOICE_PROACTIVE=off). */
  private async trendTick() {
    const s = readState(this.conn);
    if (!s.incident) return;
    this.trackTrendEpisode(s);
    await this.trendNote(s);
  }

  /**
   * The fixed note for a worsening trend nobody has spoken about this episode: SpO2 first, else heart rate. The
   * numbers come from the TREND line (the policy checks them against it and says them in words). Fixed code, not
   * the model, so its rows are plain `trend` steps (the dashboard labels them "Agent", never "Nemotron") and its
   * speech kind is `trend`, not `advisory`. A note the policy drops is retried after TREND_RETRY_MS.
   */
  private async trendNote(s: State) {
    const t = s.trend;
    if (!s.incident || !t?.worsening || this.trendNotedAt !== undefined) return;
    if (Date.now() - this.trendTriedAt < TREND_RETRY_MS) return;
    this.trendTriedAt = Date.now();
    const gen = this.gen;
    const incidentId = s.incident.id;
    const valid = () => !this.stale(gen, incidentId);
    if (!valid()) return;
    const text = t.spo2 && t.spo2.from - t.spo2.to >= TREND_SPO2_DROP
      ? `Note: oxygen saturation falling, ${t.spo2.from} to ${t.spo2.to}.`
      : t.hr ? `Note: heart rate rising, ${t.hr.from} to ${t.hr.to}.` : undefined;
    if (!text) return;
    await step(this.conn, 'trend', `Worsening vitals trend (${t.words}); no advisory was queued, so the fixed note is next`);
    const queued = await this.policy.say(text, 2, 'trend', summarize(s), valid);
    if (queued) this.trendNotedAt = Date.now();
    else await step(this.conn, 'trend', 'The speech policy did not queue the trend note; trying again later');
  }
}

export { tsMs };
