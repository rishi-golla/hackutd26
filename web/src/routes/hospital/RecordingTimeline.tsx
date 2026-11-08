// What happened in a recorded video, laid out along its length under the player. Marks are the offline analyzer's
// rows (spacetime recording_trace): what it saw, what the medic said it did, and each scene description. Scenes split
// the video into chapters; seen and said moments are flags above them. Clicking a flag or a chapter plays the video
// from there; the player reports its position back on `recording-time`.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HospitalData } from './useHospital';

const ms = (ts: { microsSinceUnixEpoch: bigint }) => Number(ts.microsSinceUnixEpoch / 1000n);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const seek = (s: number) => window.dispatchEvent(new CustomEvent('recording-seek', { detail: s }));
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Mark = { key: string; t: number; label: string; kind: 'seen' | 'said' | 'scene' };
type Player = { t: number; duration: number };
type Chapter = { start: number; end: number; label?: string };
type Place = { row: number; end: boolean; max?: number };

const GAP = 16;
const ROWS = [0, 1, 2];
const ROW_U = 34;
const FLAG_U = 46;

/**
 * Right to left, each flag takes the lowest row (0 sits on the bar) where its whole label fits, no label overlaps
 * another in that row, and no flag's line runs through a label. A label flips to the left of its line only near
 * the right edge and only if no other flag sits under it; failing both, it is shortened in the row with most room.
 */
function placeFlags(xs: number[], widths: number[], width: number): Place[] {
  const labels: { row: number; a: number; b: number }[] = [];
  const lines: { row: number; x: number }[] = [];
  const out: Place[] = [];
  for (let i = xs.length - 1; i >= 0; i--) {
    const x = xs[i], w = widths[i];
    const crossed = (row: number) => labels.some(l => l.row < row && x >= l.a - GAP && x <= l.b + GAP);
    const fits = (row: number, a: number, b: number) => !crossed(row)
      && lines.every(l => l.row <= row || l.x < a - GAP || l.x > b + GAP)
      && labels.every(l => l.row !== row || b + GAP <= l.a || a >= l.b + GAP);
    const room = (row: number) => crossed(row) ? -1 : Math.min(width,
      ...labels.filter(l => l.row === row && l.a > x).map(l => l.a - GAP),
      ...lines.filter(l => l.row > row && l.x > x).map(l => l.x - GAP)) - x;
    let place: Place | undefined;
    let a = x, b = x + w;
    const startRow = b <= width ? ROWS.find(row => fits(row, x, x + w)) : undefined;
    if (startRow !== undefined) place = { row: startRow, end: false };
    else if (x - w >= 0 && xs.every((o, j) => j === i || o < x - w || o > x)) {
      const endRow = ROWS.find(row => fits(row, x - w, x));
      if (endRow !== undefined) { place = { row: endRow, end: true }; a = x - w; b = x; }
    }
    if (!place) {
      const [row, space] = ROWS.map(r => [r, room(r)] as const).reduce((best, r) => r[1] > best[1] ? r : best);
      place = { row, end: false, max: Math.max(24, space) };
      b = x + place.max!;
    }
    labels.push({ row: place.row, a, b });
    lines.push({ row: place.row, x });
    out[i] = place;
  }
  return out;
}

export function RecordingTimeline({ data }: { data: HospitalData }) {
  const start = data.videoStart;
  const [player, setPlayer] = useState<Player>();
  const [width, setWidth] = useState(0);
  const [fonts, setFonts] = useState(0);
  const [places, setPlaces] = useState<Place[]>([]);
  const flagsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onTime = (e: Event) => setPlayer((e as CustomEvent<Player>).detail);
    window.addEventListener('recording-time', onTime);
    return () => window.removeEventListener('recording-time', onTime);
  }, []);
  useEffect(() => setPlayer(undefined), [data.incident?.id]);
  useEffect(() => { void document.fonts?.ready.then(() => setFonts(n => n + 1)); }, []);
  useEffect(() => {
    const el = flagsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  });

  const marks: Mark[] = start === undefined ? [] : data.events
    .filter(e => e.sources.some(s => s.kind === 'recording_analysis'))
    .map((e): Mark => ({
      key: String(e.id),
      t: Math.max(0, (ms(e.ts) - start) / 1000),
      label: sentence(e.label.replace(/^(Seen|Said): /, '')),
      kind: e.kind === 'seen_scene' ? 'scene' : e.kind.startsWith('said_') ? 'said' : 'seen',
    }))
    .sort((a, b) => a.t - b.t);
  const lines = start === undefined ? [] : data.spoken.filter(l => l.who === 'medic').map(l => Math.max(0, (l.t - start) / 1000));
  const last = Math.max(0, ...marks.map(m => m.t), ...lines);
  const duration = player && Number.isFinite(player.duration) && player.duration > 0 ? player.duration : Math.ceil(last) + 1;
  const flags = marks.filter(m => m.kind !== 'scene' && m.t < duration);
  const flagKey = flags.map(f => `${f.key}@${f.t}`).join(',');

  useLayoutEffect(() => {
    const el = flagsRef.current;
    if (!el || !width) return;
    const widths = [...el.querySelectorAll<HTMLElement>('.chapters__flag')]
      .map(f => {
        const pad = parseFloat(getComputedStyle(f).paddingLeft) + parseFloat(getComputedStyle(f).paddingRight) + 2;
        return Math.ceil(Math.max(...[...f.children].map(c => {
          const el = c as HTMLElement;
          const clipped = el.style.maxWidth;
          el.style.maxWidth = 'none';
          const w = el.getBoundingClientRect().width;
          el.style.maxWidth = clipped;
          return w;
        })) + pad);
      });
    const next = placeFlags(flags.map(f => (f.t / duration) * width), widths, width);
    setPlaces(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagKey, width, duration, fonts]);

  if (start === undefined || (!marks.length && !lines.length)) return null;

  // Chapters start at each scene description; a scene stamped with (almost) the same time replaces the previous one.
  const chapters: Chapter[] = [];
  for (const s of marks.filter(m => m.kind === 'scene' && m.t < duration)) {
    const prev = chapters[chapters.length - 1];
    if (prev && s.t - prev.start < 0.5) prev.label = s.label;
    else chapters.push({ start: s.t, end: duration, label: s.label });
  }
  if (!chapters.length || chapters[0].start > 0.5) chapters.unshift({ start: 0, end: duration });
  chapters.forEach((c, i) => { c.end = chapters[i + 1]?.start ?? duration; });

  const t = Math.min(player?.t ?? 0, duration);
  const now = chapters.find(c => t >= c.start && t < c.end) ?? chapters[chapters.length - 1];
  const pct = (s: number) => `${Math.min(100, (s / duration) * 100)}%`;
  const ticks = Array.from({ length: 5 }, (_, i) => (duration * i) / 4);
  const rows = Math.max(0, ...places.map(p => p?.row ?? 0));
  const tall = (row: number) => `calc(${FLAG_U + ROW_U * row} * var(--u))`;

  return (
    <div className="chapters" aria-label="What happened in the video">
      <div ref={flagsRef} className="chapters__flags" style={{ height: tall(rows) }}>
        {flags.map((f, i) => {
          const p = places[i];
          return (
            <button key={f.key} type="button" title={`${mmss(f.t)} · ${f.label}`} aria-label={`${mmss(f.t)}: ${f.label}`}
              className={`chapters__flag chapters__flag--${f.kind}${p?.end ? ' chapters__flag--end' : ''}`}
              style={{ left: pct(f.t), height: tall(p?.row ?? 0), maxWidth: p?.max }} onClick={() => seek(f.t)}>
              <b>{f.label}</b><span>{mmss(f.t)}</span>
            </button>
          );
        })}
      </div>
      <div className="chapters__bar">
        {chapters.map(c => {
          const state = c === now ? 'is-now' : c.end <= t ? 'is-played' : '';
          const progress = c === now ? ((t - c.start) / Math.max(0.001, c.end - c.start)) * 100 : 0;
          return (
            <button key={c.start} type="button" className={`chapters__seg ${state}`} style={{ flexGrow: c.end - c.start }}
              title={`${mmss(c.start)} – ${mmss(c.end)}${c.label ? ` · ${c.label}` : ''}`} aria-label={`Play from ${mmss(c.start)}`}
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect();
                seek(c.start + ((e.clientX - r.left) / r.width) * (c.end - c.start));
              }}>
              {c === now && <span className="chapters__fill" style={{ width: `${progress}%` }} />}
            </button>
          );
        })}
      </div>
      <div className="chapters__ticks">{ticks.map(s => <span key={s}>{mmss(s)}</span>)}</div>
      {now.label && (
        <div className="chapters__now">
          <span className="chapters__chip">{mmss(now.start)} – {mmss(now.end)}</span>
          <div><small>On screen now</small><p>{now.label}</p></div>
        </div>
      )}
    </div>
  );
}
