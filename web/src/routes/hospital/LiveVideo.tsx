// Live video from the bodycam. Two sources, whichever is live:
// - the Pi hub's frame feed (SPEC decision 22): the phone uploads ~10 JPEG frames a second to the hub; this tile
//   long-polls /hub/frame.jpg (passed through to the hub by the dev server, vite.config.ts) and shows each one as
//   it arrives, the same feed as the hub's own /dash. The hub never serves a frame older than 3 s.
// - WebRTC, if a bodycam ever sends an offer through the rtc_signal table (protocol in spacetime/README.md).
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, type DbConnection } from '../../module_bindings';
import type { RtcSignal } from '../../module_bindings/types';

// Loaded on demand so three.js stays out of the bundle every other page (bodycam, controls) downloads.
const HeartPlaceholder = lazy(() => import('./HeartPlaceholder'));

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
  const imgRef = useRef<HTMLImageElement>(null);
  const lastJpegAt = useRef(0);
  const [showJpeg, setShowJpeg] = useState(false);
  const lastRequestAt = useRef(0);
  const [state, setState] = useState<VideoState>('connecting');
  // Whether any frame has ever arrived. The placeholder heart is only for before that, never over a frozen frame.
  const [hadFrame, setHadFrame] = useState(false);

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

  // The hub's frame feed: ask for the next frame as soon as the last one arrives (204 = none newer in 5 s).
  useEffect(() => {
    let stop = false;
    let seq = 0;
    let url = '';
    void (async () => {
      while (!stop) {
        try {
          const r = await fetch(`/hub/frame.jpg?after=${seq}`, { cache: 'no-store', signal: AbortSignal.timeout(9000) });
          if (r.status !== 200) {
            if (r.status !== 204) await new Promise(res => setTimeout(res, 1000));
            continue;
          }
          seq = Number(r.headers.get('X-Seq')) || seq;
          const next = URL.createObjectURL(await r.blob());
          if (imgRef.current) imgRef.current.src = next;
          if (url) URL.revokeObjectURL(url);
          url = next;
          lastJpegAt.current = Date.now();
        } catch {
          await new Promise(res => setTimeout(res, 1000)); // hub unreachable: try again
        }
      }
    })();
    return () => {
      stop = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  // Frame watchdog: live while frames arrive (either source), stale after 3 s without one, re-request every 10 s.
  useEffect(() => {
    const video = videoRef.current;
    let lastTime = -1;
    let lastVideoAt = 0;
    const id = setInterval(() => {
      if (video && video.currentTime !== lastTime && !video.paused) {
        lastTime = video.currentTime;
        lastVideoAt = Date.now();
      }
      // WebRTC wins while it plays; otherwise the hub's frames.
      const videoLive = Date.now() - lastVideoAt < STALE_MS;
      setShowJpeg(!videoLive && lastJpegAt.current > 0);
      lastFrameAt.current = Math.max(lastVideoAt, lastJpegAt.current);
      const sinceFrame = Date.now() - lastFrameAt.current;
      if (lastFrameAt.current !== 0) setHadFrame(true);
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
      <video ref={videoRef} autoPlay playsInline muted hidden={showJpeg} />
      <img ref={imgRef} className="video__frame" alt="Bodycam" hidden={!showJpeg} />
      {/* Before the first frame ever arrives. On stale the last frame stays up, under the Stale badge (H2). */}
      {!hadFrame && (
        <Suspense fallback={null}>
          <HeartPlaceholder />
        </Suspense>
      )}
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
