// Row times. A video-only import's rows come from the offline recording analyzer (spacetime recording_trace) and are
// stored at import time + seconds into the video, so they read as m:ss into the video and seek the player.
const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** A row's time. On a recorded video it is the time into the video, and clicking plays the video from there. */
export function Stamp({ t, videoStart }: { t: number; videoStart?: number }) {
  if (videoStart === undefined) return <>{clockTime(t)}</>;
  const s = Math.max(0, (t - videoStart) / 1000);
  const label = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return <button type="button" className="stamp" title={`Play the video from ${label}`}
    onClick={() => window.dispatchEvent(new CustomEvent('recording-seek', { detail: s }))}>{label}</button>;
}

/** Says that rows on a recorded video were derived from the footage, not entered during care. */
export function FromRecording({ videoStart }: { videoStart?: number }) {
  return videoStart === undefined ? null : <span className="muted small">Previous session · video time</span>;
}
