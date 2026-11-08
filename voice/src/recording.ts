// The session video (decision 28): the phone records its camera and mic in clips and uploads them in chunks to the
// worker (voice/pipecat/recording.py), which saves them under web/public/recordings and asks here what to do with
// each chunk. One clip belongs to one call: it is attached to the open call (attach_recording) as soon as there is
// one, and the phone starts a new clip when that call ends or another one starts. A clip that never found a call
// within a minute is thrown away, so footage between calls does not pile up on the laptop.
import type { Conn } from './db';
import { activeIncident, step } from './db';

export const SESSION_VIDEO_LABEL = 'Session video';
/** Chunks (about 4 s each) a clip may run without an open call before it is discarded. */
export const UNATTACHED_CHUNKS = 15;

export type ClipReply = { incident: string | null; restart: boolean; discard: boolean };

const CLIP = /^[a-zA-Z0-9_-]{8,80}$/;
const URL_OK = /^\/recordings\/[a-zA-Z0-9_-]+\.(webm|mp4)$/;

export class SessionRecorder {
  private clips = new Map<string, { incidentId?: bigint }>();

  constructor(private conn: Conn) {}

  /** One uploaded chunk of `clip` (served at `url`); the reply tells the phone whether to start a new clip. */
  async chunk(clip: string, url: string, seq: number): Promise<ClipReply> {
    if (!CLIP.test(clip) || !URL_OK.test(url) || !Number.isInteger(seq) || seq < 0) throw new Error('bad clip');
    const inc = activeIncident(this.conn);
    let state = this.clips.get(clip);
    if (!state) {
      state = {};
      this.clips.set(clip, state);
    }
    if (state.incidentId !== undefined) {
      if (inc?.id === state.incidentId) return { incident: String(inc.id), restart: false, discard: false };
      this.clips.delete(clip);
      return { incident: inc ? String(inc.id) : null, restart: true, discard: false };
    }
    if (!inc) {
      if (seq + 1 < UNATTACHED_CHUNKS) return { incident: null, restart: false, discard: false };
      this.clips.delete(clip);
      return { incident: null, restart: true, discard: true };
    }
    try {
      await this.conn.reducers.demoControl({
        action: 'attach_recording',
        arg: JSON.stringify({ incidentId: String(inc.id), url, label: SESSION_VIDEO_LABEL }),
      });
      state.incidentId = inc.id;
      await step(this.conn, 'session_video', `Recording the session video for call ${inc.id} (${url})`);
    } catch (err) {
      await step(this.conn, 'session_video', `attach failed: ${(err as Error).message.slice(0, 80)}`);
    }
    return { incident: String(inc.id), restart: false, discard: false };
  }
}
