// CPR assistance panel for the chest phone. One tap arms it (browsers need a tap for sound and motion); after
// that it runs on its own when the incident goes into arrest and the finger sensor is on.
import { useEffect, useState } from 'react';
import { useCprAssist } from './useCprAssist';
import { TARGET_MAX, TARGET_MIN } from './coach';
import './cpr.css';

const MODE_TEXT = {
  idle: 'Armed. Starts when CPR is confirmed.',
  waiting_for_sensor: 'Place the finger sensor',
  active: 'Compress with the beat',
  paused: 'Paused: resume compressions',
} as const;

export default function CprPanel() {
  const { view, beatAt, start, calibrate } = useCprAssist();
  const [flash, setFlash] = useState(false);

  // The dot lights for 120 ms on every beat (beatAt is set when the click leaves the speaker).
  useEffect(() => {
    if (!beatAt) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 120);
    return () => clearTimeout(id);
  }, [beatAt]);

  if (!view.started) {
    return (
      <section className="cpr cpr--start">
        <button type="button" className="cpr__start" onClick={start}>
          Tap to arm CPR assistance
        </button>
        <p className="cpr__hint">Allows the beat, the motion sensor and spoken cues. Keep this page open.</p>
        {view.error && <p className="cpr__error">{view.error}</p>}
      </section>
    );
  }

  const running = view.mode === 'active' || view.mode === 'paused';
  const rateOk = view.rate !== null && view.rate >= TARGET_MIN && view.rate <= TARGET_MAX;
  const late = view.meanErrMs !== null && view.meanErrMs > 0;

  return (
    <section className={`cpr cpr--${view.mode}`} aria-live="polite">
      <div className="cpr__state">
        <span className={`cpr__beat${flash && running ? ' is-on' : ''}`} aria-hidden="true" />
        <strong>{MODE_TEXT[view.mode]}</strong>
      </div>

      <div className="cpr__numbers">
        <div className={`cpr__big${view.rate !== null && !rateOk ? ' is-off' : ''}`}>
          {view.rate !== null ? Math.round(view.rate) : '—'}
          <span>/min · target {TARGET_MIN}–{TARGET_MAX}</span>
        </div>
        <div className="cpr__row">
          <span>
            On the beat <b>{view.onBeatPct !== null ? `${Math.round(view.onBeatPct)} %` : '—'}</b>
            {view.meanErrMs !== null && Math.abs(view.meanErrMs) > 60 && (
              <em> ({late ? 'late' : 'early'} {Math.round(Math.abs(view.meanErrMs))} ms)</em>
            )}
          </span>
          <span>
            Compressions <b>{view.compressions}</b>
          </span>
        </div>
        {view.lastCue && <p className="cpr__cue">Last cue: “{view.lastCue}”</p>}
      </div>

      <div className="cpr__foot">
        <span className={view.fingerDetected ? 'cpr__ok' : 'cpr__warn'}>
          Finger sensor {view.fingerDetected ? 'on' : 'not detected'}
        </span>
        <span>Arrest {view.inArrest ? 'yes' : 'no'}</span>
        <span>Sensor {view.sensorHz ? `${Math.round(view.sensorHz)} Hz` : '—'}</span>
        <button type="button" className="cpr__calibrate" onClick={calibrate} disabled={!running || view.calibrating}>
          {view.calibrating ? 'Calibrating… compress with the beat' : `Calibrate timing (offset ${Math.round(view.offsetMs)} ms)`}
        </button>
      </div>
    </section>
  );
}
