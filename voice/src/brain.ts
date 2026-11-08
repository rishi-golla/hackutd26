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
import { ECHO_PREFIXES, normalizeTranscript, parseControl, parseIdentity, parseReadback, recognizeDrug, type ReadbackMatch, type Route, type Unit } from './readback';
import { checkAllergy, checkDoseRange, composeReadback, type DoseVerdict } from './checks';
import { cachedMatch, fetchRecord, searchPatients, spokenRecordSummary } from './ehr';
import { readState, summarize, tsMs } from './state';
import type { Policy } from './policy';
import type { Speaker } from './speaker';
import { runTool, toolsFor, type ToolContext } from './tools';
import { spoken, spokenUnit } from './spoken';
import { seenEvent, type SeenFinding } from './seen';
import type { Event, Incident, Transcript } from './module_bindings/types';

/** "Correction" / "confirm" apply to the last read-back for 10 s (spec RB3); a flagged one stays open. */
const CONTROL_WINDOW_MS = 10_000;
/** A bare dose after "Saw epinephrine. What dose?" is accepted for this long (spec RB9: 30 s). */
const PENDING_DOSE_MS = 30_000;
/** How long the brain remembers a line it wrote, so the row coming back is recognised as its own. */
const OWN_LINE_MS = 60_000;
const PROACTIVE_EVERY_MS = 20_000;
/** Nemotron turns per minute at most (NVIDIA free tier is about 40 requests/min for the whole key). */
const LLM_TURNS_PER_MIN = 20;
/**
 * The mic hears the room. A line goes to Nemotron only if it is a question, addresses Handoff, or carries clinical
 * vocabulary; side conversations ("that's why like I like what you said") are never worth a model call.
 */
const RELEVANT = /\?|\b(handoff|what|where|when|how|did we|do we|have we|should|pulse|pulseless|arrest|rosc|cpr|compressions?|compress|airway|i-?gel|intubat\w*|tube|iv|io|access|line in|bleeding|breathing|breaths?|resp\w*|oxygen|sat|sats|spo2|heart|rate|pressure|bp|glucose|sugar|pupils?|gcs|unresponsive|conscious|seiz\w*|stroke|chest pain|allerg\w*|meds?|medication|record|history|patient|transport\w*|en route|hospital|eta|shock|defib\w*|pads|epi|epinephrine|amio\w*|narcan|naloxone|nitro|aspirin|dose|milligram|microgram|mark|note|found|pill|bottle)\b/i;

const SYSTEM = `You are Handoff, the voice assistant riding along with a paramedic. Prototype; all data is synthetic.
You hear what the medic just said and see the live state. Decide what, if anything, to do, using the tools:
- If the medic asks you something, answer with "speak": facts and times from the state and tools only, at most 15 words. If the state doesn't have it, say so ("Not documented yet").
- If the medic states a procedure or finding (airway placed, IV or IO access, pulse check result, something found at the scene, a MARK note), call log_event. Medications and shocks are logged automatically by the read-back system: never log them and never repeat them back.
- If the medic plainly states a status change (no pulse / cardiac arrest / starting CPR → arrest; pulse is back → rosc; transporting / loading / en route → en_route), call set_status.
- If the medic gives the patient's full name AND birth date, call search_ehr; one match → pull_record; several → ask which with "speak"; none → say no record found. Never guess.
- Otherwise reply with the single word SILENT. Partial sentences, the medic talking to the patient or a partner, and small talk need nothing.
- Speech-to-text garbles words. If a word is not a drug, device or procedure you recognise (e.g. "FEO", "FPIO"), do nothing: never log it, never guess what it was.
Rules: never invent vitals, times, names, doses or findings. Never give orders; advisory protocol wording only. Never mention compression depth. Doses and allergies are judged only by the check tools.`;

const SYSTEM_NO_W6 = SYSTEM.replace(/- If the medic gives the patient's full name AND birth date.*\n/, '');

const PROACTIVE = `You are Handoff, the voice assistant riding along with a paramedic. Prototype; all data is synthetic.
Nothing was said. Look at the live state and decide whether ONE short advisory would help right now (for example after ROSC, a timer that is due, or a flagged medication). The rules already say "Push faster", "Resume compressions", "Epi due" and the vitals alarms, so never repeat those.
Reply with the single word SILENT, or with the advisory: 8 words or fewer, protocol wording ("Consider…"), never an order, no numbers unless they are in the state.`;

type Pending = {
  eventId: bigint;
  at: number;
  flagged: boolean;
  /** why it is flagged; missing_dose means "confirm" is not enough, a dose is needed */
  reason?: 'allergy' | 'dose' | 'missing_dose' | 'unconfirmed';
  drug?: string;
};

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
  /** After "Say again the drug.": the dose we heard, waiting for the drug name (15 s). */
  private pendingDrug?: { dose: number; unit: Unit; route?: Route; at: number };

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
    if (control) return phoneHandled ? undefined : this.handleControl(control);

    // RB5 echo guard: our own words coming back through the mic (while speaking and shortly after).
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const mine = norm(text);
    const said = this.speaker.recentlySaid().map(norm);
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
    // The answer to "Say again the drug.": just the drug name, combined with the dose we already heard.
    if (!rb && this.pendingDrug && Date.now() - this.pendingDrug.at < 15_000) {
      const drug = recognizeDrug(text);
      if (drug) {
        const p = this.pendingDrug;
        const combined = parseReadback(`giving ${drug} ${p.dose} ${p.unit}${p.route ? ` ${p.route}` : ''}`);
        if (combined && combined.kind === 'medication') {
          text = `${text} (dose heard earlier: ${p.dose} ${p.unit})`;
          rb = combined;
        }
      }
      this.pendingDrug = undefined;
    }
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
    if (rb) {
      if (rb.kind === 'missing_dose' || rb.kind === 'missing_drug') {
        if (rb.kind === 'missing_drug' && rb.dose !== undefined && rb.unit) {
          const pending = { dose: rb.dose, unit: rb.unit, route: rb.route, at: Date.now() };
          this.pendingDrug = pending;
          // "giving three hundred milligrams of" | "amiodarone": STT closed the line before the drug. Give the
          // next line 2 s to bring it before asking (seen live, Sat 22:12).
          if (/\b(of|the|some|a|an)\s*[.,]?$/i.test(text)) {
            await step(this.conn, 'read_back', `dose heard, line ends before the drug: waiting 2 s for "${text.slice(-30)}"`);
            setTimeout(() => {
              if (this.pendingDrug === pending) void this.policy.say(rb.spoken, 0, 'readback');
            }, 2000);
            return;
          }
        }
        await step(this.conn, 'read_back', rb.kind === 'missing_dose' ? `${rb.drug} without a dose` : `dose heard, drug not recognised: "${text.slice(0, 60)}"`);
        await this.policy.say(rb.spoken, 0, 'readback');
        return;
      }
      this.pendingDrug = undefined; // a full statement supersedes any half we were waiting on
      return this.handleReadback(rb, text, gen);
    }

    // X1: "Patient is Jordan Avery, born March 14, 1968"
    const who = parseIdentity(text);
    if (who && CONFIG.w6) return this.identifyFromNameAndDob(who.name, who.birthDate, gen, 'voice');

    if (!llmConfigured()) {
      await step(this.conn, 'nemotron', `Skipped (no NVIDIA_API_KEY): "${text.slice(0, 60)}"`);
      return;
    }
    // Room chatter: a fragment of one or two words is never a question or a statement worth a model call.
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 3 && !/\?/.test(text)) {
      this.lastFragment = { text, at: Date.now() };
      await step(this.conn, 'nemotron', `Skipped fragment: "${text.slice(0, 60)}"`);
      return;
    }
    if (!RELEVANT.test(text)) {
      await step(this.conn, 'nemotron', `Skipped (not about the patient): "${text.slice(0, 60)}"`);
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

  private async handleReadback(rb: ReadbackMatch, text: string, gen: number) {
    const s = readState(this.conn);
    const dose: DoseVerdict = rb.drug ? checkDoseRange(rb.drug, rb.dose, rb.unit) : { verdict: 'no_range' };
    const allergy = rb.drug ? checkAllergy(rb.drug, s.record?.allergies ?? []) : { allergic: false };
    const out = composeReadback(rb, dose, allergy);
    await step(this.conn, 'read_back', `${rb.label}${out.flagged ? ` FLAGGED (${out.reason})` : ''}${!s.record && rb.drug ? ' · no record yet, allergy not checked' : ''}`);
    // Speak first (RB2 latency), then log.
    await this.policy.say(out.spoken, 0, 'readback');

    const inc = s.incident;
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
    if (out.flagged && ev.status !== 'flagged') {
      await this.conn.reducers.setEventStatus({ eventId: ev.id, status: 'flagged' });
    } else if (!out.flagged && ev.status === 'flagged' && ev.sources.some(x => x.kind === 'seen')) {
      // RB9: a spoken dose merged into a drug the camera saw confirms it.
      await this.conn.reducers.setEventStatus({ eventId: ev.id, status: 'confirmed' });
      await step(this.conn, 'set_event_status', `${rb.label}: confirmed (seen by the camera, dose spoken)`);
    }
    this.lastReadback = { eventId: ev.id, at: Date.now(), flagged: out.flagged, reason: out.reason, drug: rb.drug };
  }

  /** The newest event of this kind for the incident (the one log_event just wrote or merged into). */
  private async findEvent(incidentId: bigint, kind: string): Promise<Event | undefined> {
    for (let i = 0; i < 6; i++) {
      const ev = [...this.conn.db.event.iter()]
        .filter(e => e.incidentId === incidentId && e.kind === kind && e.status !== 'cancelled')
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
    await this.policy.say(word === 'correction' ? 'Cancelled.' : 'Confirmed.', 0, 'control');
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
  }

  // ---- RB8–RB10: drugs the camera sees ----------------------------------------------------------------------

  private async onEvent(ev: Event) {
    // The camera lane only calls log_event with source "seen" (§0.1 decision 18); the row arrives as "logged".
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
    return { conn: this.conn, policy: this.policy, corpus: [], pullRecord: (ref, method) => this.pullRecord(ref, method), valid, utterance };
  }

  private async nemotronTurn(text: string, source: string, gen: number) {
    const deadline = Date.now() + CONFIG.llmTimeoutMs;
    const incidentId = activeIncident(this.conn)?.id;
    const valid = () => !this.stale(gen, incidentId);
    const ctx = this.toolContext(valid, text);
    const summary = summarize(readState(this.conn));
    ctx.corpus.push(summary, text);
    const messages: ChatMessage[] = [
      { role: 'system', content: `${CONFIG.w6 ? SYSTEM : SYSTEM_NO_W6}\n\nLIVE STATE\n${summary}` },
      { role: 'user', content: `The medic just said: "${text}"` },
    ];
    const tools = toolsFor(CONFIG.w6);
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
          const content = reply.content.trim().replace(/^speak\s*[:(]\s*/i, '').replace(/^["']|["')]+$/g, '').trim();
          if (!content || /^silent\b/i.test(content)) {
            await step(this.conn, 'nemotron', 'SILENT');
          } else {
            await this.policy.say(content, 1, 'answer', ctx.corpus.join('\n'), valid);
          }
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
          const result = await runTool(call.function.name, args, ctx);
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
      }
      await step(this.conn, 'nemotron', 'stopped after 3 tool rounds');
    } catch (err) {
      await step(this.conn, 'nemotron', `${(err as Error).message.slice(0, 100)}; staying silent (rules are the safety net)`);
    }
  }

  /** Unprompted advisories (VOICE_PROACTIVE=on): one model call when the state changed, every 20 s at most. */
  private async proactiveTick() {
    const s = readState(this.conn);
    if (!s.incident) return;
    const fingerprint = `${s.incident.status}|${s.events.length}|${s.timers.map(t => `${t.kind}:${t.state}`).join(',')}|${s.events.filter(e => e.status === 'flagged').length}`;
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    const gen = this.gen;
    const summary = summarize(s);
    try {
      const reply = await chat(
        [
          { role: 'system', content: `${PROACTIVE}\n\nLIVE STATE\n${summary}` },
          { role: 'user', content: 'Advisory now? SILENT or 8 words.' },
        ],
        { timeoutMs: CONFIG.llmTimeoutMs, maxTokens: 60 }
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
