// The speaker: forwards the next unspoken callout to the connected "mouth" (the Pipecat worker or the terminal
// bodycam) over the local WebSocket and marks it spoken when the mouth reports it finished. One queue for rule
// callouts and agent speech (voice/README.md "One speech queue"). With no mouth connected nothing is marked, so
// the bodycam page speaks the rows itself (degraded mode, spec §23 B11).
import type { WebSocket } from 'ws';
import type { Conn } from './db';
import { tsMs } from './state';
import type { Callout } from './module_bindings/types';

/** If the mouth never acks, drop the attempt (not the callout) so the queue can't stall. */
const ACK_TIMEOUT_MS = 15_000;
/** How long after the mouth finished the echo guard treats the words as "just said" (spec RB5: 0.7 s, plus STT delay). */
const ECHO_WINDOW_S = 2;
/** Two failed playbacks in a row and the audio link is treated as down: the bodycam takes over (B11). */
const MAX_PLAYBACK_ERRORS = 2;
/** Never talk over the medic, unless "speaking" has been continuous this long (hall noise): then P0/P1 go through. */
const STUCK_SPEAKING_MS = 10_000;
/** After a barge-in, wait this long once the medic stops before saying anything: their words ("correction") must
 *  reach the brain first, or the interrupted read-back replays over the cancel (seen live, Sat 21:54). */
const BARGE_IN_HOLD_MS = 1_500;

type MouthMessage =
  | { type: 'spoken'; id: string; interrupted?: boolean; error?: string }
  | { type: 'user_speaking'; active: boolean };

export class Speaker {
  private mouth?: WebSocket;
  /** The callout the mouth is playing (or whose callout_spoken is still committing). */
  private inFlight?: { callout: Callout; sentAt: number; acking: boolean };
  private userSpeaking = false;
  private userSpeakingSince = 0;
  private holdUntil = 0;
  private interruptedDuringSpeech = false;
  private timer?: NodeJS.Timeout;
  private playbackErrors = 0;
  /** Callouts the medic talked over once; they get one more try (spec §15: never cut off, so say it again). */
  private retried = new Set<bigint>();
  /** While a question ("Log it?") waits for its answer, P2/P3 rows wait too: the demo-timing "Two minutes…" rule
   *  landing right after the question kept swallowing the medic's yes / no (live Sun ~06:00). P0/P1 still go. */
  private lowHoldUntil = 0;

  constructor(private conn: Conn) {
    conn.db.callout.onInsert(() => this.tick());
    conn.db.callout.onUpdate((_ctx, _old, row) => {
      // Somebody else (the bodycam) spoke it, or our own ack committed: it is no longer ours to play.
      if (this.inFlight && this.inFlight.callout.id === row.id && row.spokenAt !== undefined) this.inFlight = undefined;
      this.tick();
    });
    conn.db.callout.onDelete((_ctx, row) => {
      if (this.inFlight && this.inFlight.callout.id === row.id) this.inFlight = undefined; // pruned by the server
      this.tick();
    });
    this.timer = setInterval(() => this.tick(), 500);
  }

  get connected() {
    return !!this.mouth;
  }

  /** A new mouth replaces the old one (one at a time). */
  attach(ws: WebSocket) {
    if (this.mouth && this.mouth !== ws) this.mouth.close(1000, 'replaced by a new mouth');
    this.mouth = ws;
    this.inFlight = undefined;
    this.userSpeaking = false;
    this.playbackErrors = 0;
    console.log('[voice] mouth connected');
    ws.on('message', data => {
      if (this.mouth !== ws) return; // a stale mouth's messages never count
      let msg: MouthMessage | undefined;
      try {
        msg = JSON.parse(String(data)) as MouthMessage;
      } catch {
        return;
      }
      if (msg.type === 'spoken') this.onSpoken(msg);
      else if (msg.type === 'user_speaking') {
        if (msg.active && !this.userSpeaking) this.userSpeakingSince = Date.now();
        this.userSpeaking = msg.active;
        if (!msg.active) {
          if (this.interruptedDuringSpeech) {
            this.holdUntil = Date.now() + BARGE_IN_HOLD_MS;
            this.interruptedDuringSpeech = false;
          }
          this.tick();
        }
      }
    });
    ws.on('close', () => {
      if (this.mouth === ws) {
        this.mouth = undefined;
        this.inFlight = undefined; // the callout stays unspoken: the bodycam or the next mouth gets it
        console.log('[voice] mouth disconnected; the bodycam speaks callouts itself until one reconnects');
      }
    });
    this.tick();
  }

  private onSpoken(msg: { id: string; interrupted?: boolean; error?: string }) {
    const cur = this.inFlight;
    if (!cur || cur.acking || String(cur.callout.id) !== msg.id) return; // only the row we sent, once
    if (msg.error) {
      // The mouth could not play it: the words were not heard, so the row stays unspoken.
      this.playbackErrors++;
      console.warn(`[voice] mouth failed to play callout ${msg.id}: ${msg.error}`);
      this.inFlight = undefined;
      if (this.playbackErrors >= MAX_PLAYBACK_ERRORS && this.mouth) {
        console.warn('[voice] audio link failing; dropping the mouth so the bodycam speaks (B11)');
        this.mouth.close(1011, 'tts failing');
      }
      return;
    }
    this.playbackErrors = 0;
    // Only an urgent rule callout (P1) is said again after a barge-in. A read-back (P0) the medic talks over is
    // being answered ("correction"), and replaying it over the answer was the bug seen live (Sat 22:12).
    if (msg.interrupted && cur.callout.priority === 1 && !this.retried.has(cur.callout.id)) {
      // Barge-in on an urgent callout: leave it unspoken and say it once more when they stop, after a short hold
      // so what they said (maybe "correction") is processed first. Interrupted P2/P3 prompts are not repeated.
      this.retried.add(cur.callout.id);
      this.inFlight = undefined;
      this.interruptedDuringSpeech = true;
      this.holdUntil = Date.now() + BARGE_IN_HOLD_MS;
      this.tick();
      return;
    }
    void this.markSpoken(cur);
  }

  /** Send the next callout: lowest priority number first, then oldest. One at a time, never over the medic. */
  tick() {
    if (!this.mouth) return;
    if (this.inFlight) {
      if (!this.inFlight.acking && Date.now() - this.inFlight.sentAt > ACK_TIMEOUT_MS) {
        // Words the medic may never have heard are not recorded as spoken; the row stays until the server
        // prunes it (20 s) or the bodycam speaks it.
        console.warn(`[voice] mouth never acked callout ${this.inFlight.callout.id}; leaving it unspoken`);
        this.inFlight = undefined;
      }
      return;
    }
    const next = [...this.conn.db.callout.iter()]
      .filter(c => c.spokenAt === undefined)
      .sort((a, b) => a.priority - b.priority || Number(a.id - b.id))[0];
    if (!next) return;
    if (Date.now() < this.holdUntil) return;
    if (next.priority >= 2 && Date.now() < this.lowHoldUntil) return;
    if (this.userSpeaking && (next.priority > 1 || Date.now() - this.userSpeakingSince < STUCK_SPEAKING_MS)) return;
    this.inFlight = { callout: next, sentAt: Date.now(), acking: false };
    this.mouth.send(JSON.stringify({ type: 'speak', id: String(next.id), text: next.text, priority: next.priority }));
  }

  /** A question is waiting for the medic's answer: keep P2/P3 rows back for `ms` (the answer or `releaseLow` ends it early). */
  holdLow(ms: number) {
    this.lowHoldUntil = Math.max(this.lowHoldUntil, Date.now() + ms);
  }

  /** The question was answered (or dropped): low-priority rows may go again. */
  releaseLow() {
    this.lowHoldUntil = 0;
    this.tick();
  }

  /**
   * RB3: the medic said "correction" or "confirm", so a read-back they talked over must not play again.
   * Marks every unspoken read-back (P0) as spoken; the control word's own "Cancelled." is queued after this.
   */
  async dropUnspokenReadbacks() {
    const rows = [...this.conn.db.callout.iter()].filter(c => c.priority === 0 && c.spokenAt === undefined);
    for (const row of rows) {
      if (this.inFlight?.callout.id === row.id && !this.inFlight.acking) this.inFlight = undefined;
      try {
        await this.conn.reducers.calloutSpoken({ calloutId: row.id });
      } catch (err) {
        console.error('[voice] callout_spoken failed', err);
      }
    }
  }

  /** callout_spoken, holding the in-flight slot until the row is updated so the same words are never sent twice. */
  private async markSpoken(cur: NonNullable<Speaker['inFlight']>) {
    cur.acking = true;
    try {
      await this.conn.reducers.calloutSpoken({ calloutId: cur.callout.id });
    } catch (err) {
      console.error('[voice] callout_spoken failed', err);
    }
    if (this.inFlight === cur) this.inFlight = undefined;
    this.tick();
  }

  /** Words spoken in the last few seconds (plus the one playing now), for the echo guard (RB5). */
  recentlySaid(): string[] {
    const out = [...this.conn.db.callout.iter()]
      .filter(c => c.spokenAt !== undefined && (Date.now() - tsMs(c.spokenAt)) / 1000 < ECHO_WINDOW_S)
      .map(c => c.text);
    if (this.inFlight) out.push(this.inFlight.callout.text);
    return out;
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.mouth?.close();
  }
}
