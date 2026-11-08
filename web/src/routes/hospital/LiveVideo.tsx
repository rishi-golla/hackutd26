// Live video from the bodycam over WebRTC. Live stream only, never snapshots (AGENTS.md section 0).
// Signaling goes through the rtc_signal table; protocol in spacetime/README.md.
import { useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, type DbConnection } from '../../module_bindings';
import type { RtcSignal } from '../../module_bindings/types';

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const STALE_MS = 3000; // H2: "stale" after 3 s without video
const REREQUEST_MS = 10000;

type VideoState = 'connecting' | 'live' | 'stale';

/**
 * The live video. Small by default; `expanded` makes it large. The same <video> element is moved, never
 * remounted, so the stream keeps playing.
 */
export default function LiveVideo({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { getConnection, isActive } = useSpacetimeDB();
  const [signals] = useTable(tables.rtcSignal);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionRef = useRef<string | null>(null);
  const handled = useRef(new Set<bigint>());
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const lastFrameAt = useRef(0);
  const lastRequestAt = useRef(0);
  const [state, setState] = useState<VideoState>('connecting');

  const send = (sessionId: string, kind: string, payload: string) => {
    const conn = getConnection() as DbConnection | null;
    if (!conn) return;
    void conn.reducers.sendRtcSignal({ sessionId, sender: 'hospital', kind, payload }).catch(console.error);
  };

  const requestOffer = () => {
    lastRequestAt.current = Date.now();
    send('', 'request', '');
  };

  // Ask the bodycam for a fresh offer when we (re)connect to the database.
  useEffect(() => {
    if (isActive) requestOffer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // Handle new signaling rows in id order.
  useEffect(() => {
    const rows = [...signals]
      .filter(r => r.sender === 'bodycam' && !handled.current.has(r.id))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (rows.length === 0) return;

    // Only the newest offer matters; older ones are from dead sessions.
    const offers = rows.filter(r => r.kind === 'offer');
    const newest = offers[offers.length - 1];
    if (newest) void acceptOffer(newest);

    for (const row of rows) {
      handled.current.add(row.id);
      if (row.kind === 'ice' && row.sessionId === sessionRef.current) addIce(row);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals]);

  async function acceptOffer(offer: RtcSignal) {
    pcRef.current?.close();
    pendingIce.current = [];
    sessionRef.current = offer.sessionId;
    setState('connecting');

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    pc.ontrack = ev => {
      const video = videoRef.current;
      if (video && ev.streams[0]) video.srcObject = ev.streams[0];
    };
    pc.onicecandidate = ev => {
      if (ev.candidate) send(offer.sessionId, 'ice', JSON.stringify(ev.candidate.toJSON()));
    };

    try {
      await pc.setRemoteDescription(JSON.parse(offer.payload));
      for (const c of pendingIce.current) await pc.addIceCandidate(c);
      pendingIce.current = [];
      // ICE rows for this session that arrived before the offer was handled.
      for (const r of signals) {
        if (r.sender === 'bodycam' && r.kind === 'ice' && r.sessionId === offer.sessionId) {
          await pc.addIceCandidate(JSON.parse(r.payload)).catch(() => {});
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send(offer.sessionId, 'answer', JSON.stringify(pc.localDescription));
    } catch (err) {
      console.error('WebRTC answer failed', err);
    }
  }

  function addIce(row: RtcSignal) {
    const pc = pcRef.current;
    const candidate = JSON.parse(row.payload) as RTCIceCandidateInit;
    if (!pc || !pc.remoteDescription) {
      pendingIce.current.push(candidate);
      return;
    }
    pc.addIceCandidate(candidate).catch(err => console.warn('ICE candidate rejected', err));
  }

  // Frame watchdog: live while frames arrive, stale after 3 s without one, re-request every 10 s.
  useEffect(() => {
    const video = videoRef.current;
    let lastTime = -1;
    const id = setInterval(() => {
      if (video && video.currentTime !== lastTime && !video.paused) {
        lastTime = video.currentTime;
        lastFrameAt.current = Date.now();
      }
      const sinceFrame = Date.now() - lastFrameAt.current;
      if (lastFrameAt.current === 0) setState('connecting');
      else setState(sinceFrame > STALE_MS ? 'stale' : 'live');
      if ((lastFrameAt.current === 0 || sinceFrame > STALE_MS) && Date.now() - lastRequestAt.current > REREQUEST_MS) {
        requestOffer();
      }
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => pcRef.current?.close(), []);

  return (
    <button
      type="button"
      className={`video video--${state}${expanded ? ' video--expanded' : ''}`}
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? 'Minimize live video' : 'Expand live video'}
    >
      <video ref={videoRef} autoPlay playsInline muted />
      <span className="video__badge">
        {state === 'live' ? 'Live' : state === 'stale' ? 'Stale' : 'Connecting…'}
      </span>
      <span className="video__toggle" aria-hidden="true">
        {expanded ? <MinimizeIcon /> : <ExpandIcon />}
      </span>
    </button>
  );
}

// Lucide "maximize-2" and "minimize-2" (ISC), the one icon set used on the dashboard.
function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}
