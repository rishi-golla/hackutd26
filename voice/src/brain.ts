// The brain (spec §19 voice agent): what happens with each thing the medic says and each change in the tables.
// Deterministic first (read-back, corrections, spoken identity, camera-seen drugs, W6), Nemotron for judgement.
//
// Every utterance is processed exactly once, from its `transcript` row: the ear's lines are written with
// add_transcript and handled when the row comes back (so a slow database can't make us handle one twice), and
// lines the bodycam wrote itself in degraded mode are recognised as such. Slow work (an EHR pull, a model turn)
// is bound to an incident "generation" and dropped if the incident was reset or closed meanwhile.
import type { Conn } from './db';
import { activeIncident, step } from './db';
import { CONFIG, llmConfigured } from './config';
import { chat, modelInUse, type ChatMessage } from './llm';
import { ECHO_PREFIXES, medParts, normalizeTranscript, parseAnswer, parseControl, parseIdentity, type MedParts, parseReadback, recognizeDrug, type ReadbackMatch, type Route, type Unit } from './readback';
import { checkAllergy, checkDoseRange, composeReadback, type DoseVerdict } from './checks';
import { cachedMatch, fetchRecord, searchPatients, spokenRecordSummary } from './ehr';
import { readState, summarize, tsMs } from './state';
import type { Policy } from './policy';
import type { Speaker } from './speaker';
import { runTool, STATUS_WORDS, toolsFor, type ToolContext } from './tools';
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

const SYSTEM = `You are Handoff, the voice assistant riding along with a paramedic. Prototype; all data is synthetic.
You hear everything said near the medic's chest: the medic talking to you, to a partner or the patient, and room noise. Each turn you get one new line, the recent conversation, and the live state. Do two separate jobs:
1. DOCUMENT, whether or not the line was said to you. If it states something clinical about the patient or the scene, call log_event once per distinct fact (two facts in one line are two calls), with a short timeline label: a procedure the medic did or is doing (IV or IO access, suction, splint, pulse check result, monitor or pads applied), an airway device placed, or a finding (breathing, skin, pupils, bleeding, pain, injuries, mental status, what the patient or a bystander reports, medications or pill bottles found, scene hazards, a MARK note). Asking a partner to fetch something is not a procedure. Skip facts already in EVENTS. Questions or requests to you are never findings. Procedures and airway devices are read back to the medic and confirmed automatically, and findings are logged quietly: never acknowledge either out loud ("Noted", "Logged"). Medications given and shocks are read back and logged automatically by the read-back system: never log them and never repeat them back.
2. REPLY only if the line is meant for you: it says "Handoff", asks you something, asks you to do something, or answers or follows up on something you just said (see the conversation). Then answer with "speak" like a calm, capable partner: one or two short spoken sentences, under 25 words; summarise, never list everything. You may talk about anything, including what you can do and small talk, but facts about the patient and the incident come only from the state and tools; if the state doesn't have it, say "Not documented yet". If the line is not meant for you (the medic talking to the patient or a partner, thinking aloud, background chatter), don't speak.
- What you can do: read back and check doses and allergies, pull the patient's record (name and birth date, or "Handoff, look" at an ID card), document what you hear, mark moments ("Handoff, mark"), track CPR and timers, answer questions about the case, brief the hospital.
- The live state below is current: act on it directly. Make all the log_event calls for a line in one reply.
- Never ask the medic about a medication's drug, dose or route, and never comment on a dose: the read-back system collects and checks those on its own.
- If the medic plainly states a status change (no pulse / cardiac arrest → arrest; pulse is back → rosc; transporting / loading / en route → en_route), call set_status.
- If the medic says CPR or compressions are starting ("starting CPR", "starting compressions"), call log_event with kind cpr_started and label "CPR started". That starts the CPR clock (and sets the arrest if it isn't one yet). Arrest alone never means CPR has started.
- If the medic gives the patient's full name AND birth date, call search_ehr; one match → pull_record; several → ask which with "speak"; none → say no record found. Never guess.
- Speech-to-text garbles words. If you can't tell what a word or line means (e.g. "FEO", "FPIO"), never log it and never guess what it was; if it was meant for you, ask "Say again?".
- When you have nothing to say, end with the single word SILENT.
Rules: never invent vitals, times, names, doses or findings. Never give orders; advisory protocol wording only. Never mention compression depth. Doses and allergies are judged only by the check tools.`;

const SYSTEM_NO_W6 = SYSTEM.replace(/- If the medic gives the patient's full name AND birth date.*\n/, '');

const PROACTIVE = `You are Handoff, the voice assistant riding along with a paramedic. Prototype; all data is synthetic.
The live state just changed (CHANGED says what). Nobody asked you anything. Think like an experienced partner watching over the medic's shoulder: is there ONE thing worth saying right now that the medic may have missed? Good reasons to speak:
- a safety link between facts: a recorded allergy against a drug just given or likely next; a home medication that matters now (a blood thinner and bleeding or a head injury; a beta blocker and a low heart rate); a do-not-resuscitate code status during an arrest
- a flagged event the medic has left unanswered for over a minute
- a clear trend in valid vitals (heart rate or SpO2 steadily worse) or a change in status (ROSC: post-arrest checks; en route: the hospital has the record)
- something the handoff report will need and nobody has documented yet (patient identity, allergies checked, a pulse check after ROSC)
The rules already say "Push faster", "Resume compressions", "Epi due", "Two minutes" and the vitals alarms, and RECENT SPEECH shows what was said lately: never repeat any of those, and never restate a read-back, question or warning Handoff just spoke. If nothing would clearly help, stay silent; silence is the usual answer.
Reply with the single word SILENT, or with the advisory: 15 words or fewer, protocol wording ("Consider…", "Note:"), never an order, no numbers unless they are in the state.`;

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

/** The pieces of a medication statement heard so far ("one milligram of" … "epinephrine"). */
type PendingMed = { drug?: string; dose?: number; unit?: Unit; route?: Route; at: number; heard: string[]; asked?: { what: 'drug' | 'dose'; at: number } };
/** A half-heard medication stays open this long after its last piece. */
const PENDING_MED_MS = 20_000;

const DOSE_IN_LABEL = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|mL|units?|J)\b/i;
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
  private llmTurnTimes: number[] = [];
  /** A one- or two-word line we skipped ("Administering"); the next line may be its other half. */
  private lastFragment?: { text: string; at: number };
  /** A medication statement heard in pieces, waiting for the rest (PENDING_MED_MS after the last piece). */
  private pendingMed?: PendingMed;
  /** Recent Nemotron turns: what the medic said and what Handoff did about it. Cleared with the incident. */
  private history: { heard: string; did: string; at: number }[] = [];

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
    console.log(`[voice] brain ready · Nemotron ${llmConfigured() ? `on (${modelInUse()})` : 'OFF: no NVIDIA_API_KEY, deterministic paths only'} · W6 ${CONFIG.w6 ? 'on' : 'off'} · proactive ${CONFIG.proactive ? 'on' : 'off'}`);
  }

  stop() {
    if (this.proactiveTimer) clearInterval(this.proactiveTimer);
  }

  /** True when the incident this work started under is gone (reset, closed, replaced). */
  private stale(gen: number, incidentId?: bigint): boolean {
    if (gen !== this.gen) return true;
    if (incidentId !== undefined && activeIncident(this.conn)?.id !== incidentId) return true;
    return false;
  }

  // ---- input -----------------------------------------------------------------------------------------------

  /** A final utterance from the ear (Pipecat or the terminal bodycam): store it; the row coming back is processed. */
  async handleUtterance(text: string, source: string) {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!clean) return;
    this.ownLines = this.ownLines.filter(l => Date.now() - l.at < OWN_LINE_MS);
    this.ownLines.push({ text: clean, at: Date.now(), source });
    try {
      await this.conn.reducers.addTranscript({ text: clean });
    } catch (err) {
      // Not stored: still act on it, once, right here.
      console.error('[voice] add_transcript failed', err);
      this.ownLines = this.ownLines.filter(l => l.text !== clean);
      await this.processLine(clean, source);
    }
  }

  /** Every transcript row, ours (from the ear) or the bodycam's (degraded mode), exactly once. */
  private async onTranscriptRow(row: Transcript) {
    if (this.processed.has(row.id)) return;
    this.processed.add(row.id);
    const mine = this.ownLines.findIndex(l => l.text === row.text);
    const source = mine >= 0 ? this.ownLines[mine].source : 'transcript';
    if (mine >= 0) this.ownLines.splice(mine, 1);
    await this.processLine(row.text, source);
  }

  private async processLine(text: string, source: string) {
    // eslint-disable-next-line no-param-reassign -- a stitched fragment may extend the line below
    const gen = this.gen;
    const lower = text.toLowerCase();
    // A transcript row the bodycam wrote itself means the phone is in degraded mode (B11): its parser already
    // spoke the read-back and logged the event, and it handles its own corrections. Don't do it twice.
    const phoneHandled = source === 'transcript';

    // RB3: correction / confirm first; they are also the only words heard inside the echo guard.
    const control = parseControl(text);
    if (control === 'correction' && this.pendingMed && !phoneHandled) {
      this.pendingMed = undefined;
      await step(this.conn, 'control', 'half-heard medication dropped (medic said "correction")');
      await this.policy.say('Cancelled.', 0, 'control');
      return;
    }
    if (control) return phoneHandled ? undefined : this.handleControl(control);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const mine = norm(text);
    const said = this.speaker.recentlySaid().map(norm);
    // The answer to "Log it?": only right after asking, so a "yes" in conversation still reaches Nemotron. Our
    // own "…Log it?" heard back through the mic must never answer itself.
    const asked = this.lastReadback?.askedAt;
    const answer = asked && Date.now() - asked < ASK_WINDOW_MS ? parseAnswer(text) : undefined;
    if (answer && said.some(s => s === mine || s.endsWith(` ${mine}`))) {
      await step(this.conn, 'echo_guard', `Ignored our own words as an answer: "${text.slice(0, 60)}"`);
      return;
    }
    if (answer && !phoneHandled) return this.handleControl(answer === 'yes' ? 'confirm' : 'correction');

    // RB5 echo guard: our own words coming back through the mic (while speaking and shortly after).
    if (ECHO_PREFIXES.some(p => lower.startsWith(p)) || said.some(s => s === mine || (mine.split(' ').length >= 3 && s.startsWith(mine)))) {
      await step(this.conn, 'echo_guard', `Ignored our own words: "${text.slice(0, 60)}"`);
      return;
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
      return;
    }
    if (rb?.kind === 'medication' || rb?.kind === 'shock') {
      this.pendingMed = undefined; // a full statement supersedes any half we were collecting
      return this.handleReadback(rb, text, gen);
    }

    // A medication heard in pieces: the drug, the dose and the route can come in any order over several lines,
    // with misheard or unrelated lines in between. Each piece is kept until the statement is complete.
    if (!phoneHandled) {
      const open = this.pendingMed && Date.now() - this.pendingMed.at < PENDING_MED_MS ? this.pendingMed : undefined;
      if (!open) this.pendingMed = undefined;
      const parts = medParts(text);
      const words = text.split(/\s+/).filter(Boolean).length;
      if (open && (parts.drug || parts.dose !== undefined)) return this.fillMedication(open, parts, text, gen);
      if (rb?.kind === 'missing_dose') return this.fillMedication({ at: Date.now(), heard: [] }, { drug: rb.drug }, text, gen);
      if (rb?.kind === 'missing_drug') return this.fillMedication({ at: Date.now(), heard: [] }, { dose: rb.dose, unit: rb.unit, route: rb.route }, text, gen);
      // "One milligram of" (the drug fell into the next line) or a lone "Epinephrine" (the dose comes next).
      const bareDose = !parts.drug && parts.dose !== undefined && parts.unit !== undefined && parts.unit !== 'J' && words <= 6;
      const loneDrug = !parts.dose && words <= 3 && recognizeDrug(text, false);
      if (bareDose || loneDrug) return this.fillMedication({ at: Date.now(), heard: [] }, loneDrug ? { drug: loneDrug } : parts, text, gen);
    }

    // X1: "Patient is Jordan Avery, born March 14, 1968"
    const who = parseIdentity(text);
    if (who && CONFIG.w6) return this.identifyFromNameAndDob(who.name, who.birthDate, gen, 'voice');

    // B6 shortcuts, deterministic (no model call, one answer): "Handoff, look" is the vision sampler's job (it
    // sees the same transcript and speaks the result); "Handoff, mark" is a MARK on the timeline.
    const shortcut = /^\s*(?:hey\s+)?hand\s?-?\s?off[,.!]?\s+(look|mark)\b/i.exec(text)?.[1]?.toLowerCase();
    if (shortcut === 'look') {
      await step(this.conn, 'look', 'the camera check is the vision sampler\'s; no model turn');
      return;
    }
    if (shortcut === 'mark') {
      const inc = activeIncident(this.conn);
      if (!inc) return step(this.conn, 'mark', 'no active incident; not logged');
      try {
        await this.conn.reducers.logEvent({ kind: 'mark', label: 'MARK (voice)', sourceKind: 'voice', sourceDetail: text.slice(0, 200) });
        await step(this.conn, 'log_event', 'mark: MARK (voice)');
      } catch (err) {
        await step(this.conn, 'log_event', `mark failed: ${(err as Error).message.slice(0, 80)}`);
      }
      await this.policy.say('Marked.', 1, 'control');
      return;
    }

    // Status changes the medic states plainly are set here, at once, with no model turn ("cardiac arrest" went
    // unhandled when Nemotron ran out of tool rounds, Sun ~02:00). Questions and history ("had an arrest") don't count.
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const inc = activeIncident(this.conn);
    const status = inc && !phoneHandled && !/\?\s*$/.test(text) && !/\b(?:history of|previous|prior|had an?|last)\b/i.test(text)
      ? (['arrest', 'rosc', 'en_route'] as const).find(s => STATUS_WORDS[s].test(text))
      : undefined;
    if (inc && status && inc.status !== status) {
      try {
        await this.conn.reducers.setStatus({ status, sourceKind: 'voice', sourceDetail: text.slice(0, 200) });
        await step(this.conn, 'set_status', `${inc.status} → ${status} (medic said so)`);
        await this.policy.say({ arrest: 'Copy, cardiac arrest.', rosc: 'Copy, ROSC.', en_route: 'Copy, en route.' }[status], 1, 'control');
      } catch (err) {
        await step(this.conn, 'set_status', `failed: ${(err as Error).message.slice(0, 80)}`);
      }
      if (wordCount <= 6) return;
    }

    if (!llmConfigured()) {
      await step(this.conn, 'nemotron', `Skipped (no NVIDIA_API_KEY): "${text.slice(0, 60)}"`);
      return;
    }
    // A one- or two-word line may be the first half of a split read-back ("Administering"); keep it for stitching.
    if (wordCount < 3) this.lastFragment = { text, at: Date.now() };
    // Everything else goes to Nemotron, which decides whether it is clinical and whether it was meant for Handoff.
    // Only pure filler ("Yeah.", "Okay, so") and lone words are skipped, to save the rate budget.
    if (FILLER.test(text) || (wordCount < 2 && !/\?/.test(text))) {
      await step(this.conn, 'nemotron', `Skipped filler: "${text.slice(0, 60)}"`);
      return;
    }
    const now = Date.now();
    this.llmTurnTimes = this.llmTurnTimes.filter(t => now - t < 60_000);
    if (this.llmTurnTimes.length >= LLM_TURNS_PER_MIN) {
      await step(this.conn, 'nemotron', `Skipped: ${LLM_TURNS_PER_MIN} turns in the last minute (rate budget)`);
      return;
    }
    this.llmTurnTimes.push(now);
    await this.nemotronTurn(normalizeTranscript(text), source, gen);
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
    const allergy = rb.drug ? checkAllergy(rb.drug, s.record?.allergies ?? []) : { allergic: false };
    const out = composeReadback(rb, dose, allergy);
    const inc = s.incident;
    // RB9: a spoken dose for a drug the camera just saw merges into that event and confirms it: nothing to ask.
    const seenWaiting = !!inc && !out.flagged && [...this.conn.db.event.iter()].some(e =>
      e.incidentId === inc.id && e.kind === rb.eventKind && e.status === 'flagged' && e.sources.some(x => x.kind === 'seen') && Date.now() - tsMs(e.ts) < PENDING_DOSE_MS);
    const spokenText = seenWaiting ? rb.spoken : out.spoken;
    await step(this.conn, 'read_back', `${rb.label}${out.flagged ? ` FLAGGED (${out.reason})` : seenWaiting ? ' (camera saw it: confirms)' : ' · asked "Log it?"'}${!s.record && rb.drug ? ' · no record yet, allergy not checked' : ''}`);
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
    // Written now so nothing is lost if the medic is too busy to answer; flagged until they say yes.
    if (ev.status !== 'flagged') await this.conn.reducers.setEventStatus({ eventId: ev.id, status: 'flagged' });
    this.lastReadback = { eventId: ev.id, at: Date.now(), flagged: true, reason: out.reason ?? 'unconfirmed', drug: rb.drug, askedAt: Date.now() };
  }

  /**
   * An action Nemotron logged (procedure or airway): read it back and ask, like a medication. The event is
   * already written; it stays flagged as unconfirmed until the medic says yes.
   */
  async confirmAction(kind: string, label: string, valid: () => boolean): Promise<void> {
    const inc = activeIncident(this.conn);
    if (!inc) return;
    const ev = await this.findEvent(inc.id, kind, label);
    if (!ev || !valid()) return;
    if (ev.status !== 'flagged') await this.conn.reducers.setEventStatus({ eventId: ev.id, status: 'flagged' });
    this.lastReadback = { eventId: ev.id, at: Date.now(), flagged: true, reason: 'unconfirmed', askedAt: Date.now() };
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
    const open = last && (last.flagged || Date.now() - last.at < CONTROL_WINDOW_MS);
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
      await this.policy.say(`No record found for ${name}.`, 1, 'ask', undefined, () => !this.stale(gen, inc?.id));
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
    const allergy = checkAllergy(drug, s.record?.allergies ?? []);
    // The label carries the printed dose when the camera could read one ("Epinephrine 1 mg"); never a guess.
    const printed = DOSE_IN_LABEL.exec(ev.label);
    const unit = printed ? normUnit(printed[2]) : undefined;
    const dose = printed && unit ? checkDoseRange(drug, Number(printed[1]), unit) : undefined;
    const doseWords = printed && unit ? `, ${spoken(Number(printed[1]))} ${spokenUnit(unit, Number(printed[1]))}` : '';
    const an = /^[aeiou]/i.test(drug) ? 'an' : 'a';

    const flag = async (reason: Pending['reason']) => {
      this.lastReadback = { eventId: ev.id, at: Date.now(), flagged: true, reason, drug };
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

  private toolContext(valid: () => boolean, utterance: string): ToolContext {
    return { conn: this.conn, policy: this.policy, corpus: [], pullRecord: (ref, method) => this.pullRecord(ref, method), valid, utterance, confirmAction: (kind, label) => this.confirmAction(kind, label, valid) };
  }

  private async nemotronTurn(text: string, source: string, gen: number) {
    const deadline = Date.now() + CONFIG.llmTimeoutMs;
    const incidentId = activeIncident(this.conn)?.id;
    const valid = () => !this.stale(gen, incidentId);
    const ctx = this.toolContext(valid, text);
    const summary = summarize(readState(this.conn));
    this.history = this.history.filter(h => Date.now() - h.at < HISTORY_MS).slice(-HISTORY_TURNS);
    ctx.corpus.push(summary, text, ...this.history.map(h => h.heard));
    // Memory goes in as plain text, not as past assistant turns: the model copied that format into its replies.
    const conversation = this.history.map(h => `- heard "${h.heard}" → you: ${h.did}`).join('\n');
    const messages: ChatMessage[] = [
      { role: 'system', content: `${CONFIG.w6 ? SYSTEM : SYSTEM_NO_W6}\n\nLIVE STATE\n${summary}` },
      { role: 'user', content: `${conversation ? `RECENT CONVERSATION (oldest first)\n${conversation}\n\n` : ''}NEW LINE: "${text}"` },
    ];
    // The state is already in the prompt, so get_state only burned tool rounds (live, Sun ~02:00). A question is
    // answered, not documented: without log_event the model can't spend the turn re-logging.
    const question = /\?\s*$/.test(text);
    const addressed = question || /\bhand\s?-?\s?off\b/i.test(text);
    const tools = toolsFor(CONFIG.w6).filter(t => t.function.name !== 'get_state' && !(question && t.function.name === 'log_event'));
    const did: string[] = [];
    let spoke = false;
    await step(this.conn, 'nemotron', `turn on "${text.slice(0, 60)}" (${source})`);
    try {
      for (let turn = 0; turn < 3; turn++) {
        const remaining = deadline - Date.now();
        if (remaining < 800) throw new Error('voice turn deadline reached');
        const reply = await chat(messages, { tools, timeoutMs: remaining });
        if (this.stale(gen, incidentId)) {
          await step(this.conn, 'nemotron', 'dropped: the incident changed during the turn');
          return;
        }
        if (reply.toolCalls.length === 0) {
          // Lightning sometimes answers in text as `speak: …` instead of calling the tool; same meaning.
          const content = reply.content.trim().replace(/^(?:speak|said)\s*[:(]\s*/i, '').replace(/^["']|["')]+$/g, '').trim();
          if (!content || /^silent\b/i.test(content) || /\bSILENT\.?$/.test(content) || spoke) {
            if (!spoke && !did.length) await step(this.conn, 'nemotron', 'SILENT');
          } else if (/^(?:logged|set status|stayed silent|heard)\b/i.test(content)) {
            await step(this.conn, 'nemotron', `Not spoken (an action note, not speech): "${content.slice(0, 60)}"`);
          } else if (await this.policy.say(content, 1, 'answer', ctx.corpus.join('\n'), valid)) {
            did.push(`said "${content}"`);
          }
          this.remember(text, did);
          return;
        }
        messages.push({ role: 'assistant', content: reply.content || null, tool_calls: reply.toolCalls });
        for (const call of reply.toolCalls) {
          if (this.stale(gen, incidentId)) {
            await step(this.conn, 'nemotron', 'dropped: the incident changed during the tool calls');
            return;
          }
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            // the tool reports what's missing
          }
          // One spoken answer per line: a second speak in the same turn would talk at the medic twice.
          const result = spoke && call.function.name === 'speak'
            ? JSON.stringify({ error: 'you already answered this line; stop' })
            : await runTool(call.function.name, args, ctx);
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
          if (!result.includes('"ok":true')) continue;
          if (call.function.name === 'speak') {
            spoke = true;
            did.push(`said "${String(args.text ?? '')}"`);
          } else if (call.function.name === 'log_event') did.push(`logged ${args.kind} "${args.label}"`);
          else if (call.function.name === 'set_status') did.push(`set status ${args.status}`);
        }
      }
      await step(this.conn, 'nemotron', 'stopped after 3 tool rounds');
      // Spoken to and still no answer: one last call with no tools, so a question is never met with silence.
      if (addressed && !spoke && deadline - Date.now() > 800) {
        const last = await chat([...messages, { role: 'user', content: 'Answer the medic now in one or two short sentences, from the state and the tool results above. No tools.' }], { timeoutMs: deadline - Date.now() });
        const content = last.content.trim().replace(/^(?:speak|said)\s*[:(]\s*/i, '').replace(/^["']|["')]+$/g, '').trim();
        if (content && !/^silent\b/i.test(content) && valid() && await this.policy.say(content, 1, 'answer', ctx.corpus.join('\n'), valid)) did.push(`said "${content}"`);
      }
      this.remember(text, did);
    } catch (err) {
      await step(this.conn, 'nemotron', `${(err as Error).message.slice(0, 100)}; staying silent (rules are the safety net)`);
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
  private async proactiveTick() {
    const s = readState(this.conn);
    if (!s.incident) return;
    const v = s.vitals;
    const parts: Record<string, string> = {
      status: s.incident.status,
      events: `${s.events.length} ${s.events.at(-1)?.label ?? ''}`,
      flagged: String(s.events.filter(e => e.status === 'flagged').length),
      timers: s.timers.map(t => `${t.kind}:${t.state}`).join(','),
      record: s.record ? `${s.record.name} (${s.record.allergies.length} allergies)` : 'none',
      vitals: v?.valid ? `HR ~${Math.round((v.hr ?? 0) / 10) * 10} SpO2 ~${Math.round((v.spo2 ?? 0) / 3) * 3}` : v ? `no valid reading (${v.status})` : 'none',
      cpr: s.cpr?.fresh ? (s.cpr.compressing ? 'compressing' : 'paused') : 'none',
    };
    const fingerprint = JSON.stringify(parts);
    if (fingerprint === this.lastFingerprint) return;
    const before: Record<string, string> = this.lastFingerprint ? JSON.parse(this.lastFingerprint) : {};
    this.lastFingerprint = fingerprint;
    const changed = Object.keys(parts).filter(k => before[k] !== parts[k]).map(k => `${k}: ${before[k] ?? 'n/a'} → ${parts[k]}`);
    const now = Date.now();
    this.llmTurnTimes = this.llmTurnTimes.filter(t => now - t < 60_000);
    if (this.llmTurnTimes.length >= LLM_TURNS_PER_MIN) return;
    this.llmTurnTimes.push(now);
    const gen = this.gen;
    const summary = summarize(s);
    try {
      const reply = await chat(
        [
          { role: 'system', content: `${PROACTIVE}\n\nLIVE STATE\n${summary}` },
          { role: 'user', content: `CHANGED\n${changed.join('\n')}\n\nAdvisory now? SILENT or at most 15 words.` },
        ],
        { timeoutMs: CONFIG.llmTimeoutMs, maxTokens: 80 }
      );
      if (this.stale(gen, s.incident.id)) return;
      const content = reply.content.trim();
      if (!content || /^silent\b/i.test(content)) return;
      await step(this.conn, 'proactive', `"${content.slice(0, 60)}"`);
      await this.policy.say(content, 2, 'advisory', summary, () => !this.stale(gen, s.incident!.id));
    } catch (err) {
      await step(this.conn, 'proactive', `${(err as Error).message.slice(0, 80)}`);
    }
  }
}

export { tsMs };
