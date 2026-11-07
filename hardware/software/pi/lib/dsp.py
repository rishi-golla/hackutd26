"""Signal processing for the pulse sensor (pure Python, no numpy).

Nothing in this module touches hardware, so all of it can be checked on any
machine with `python3 -m lib.selftest`.

Pipeline used by the scripts (PulseProcessor wraps it):

    raw IR ──> finger detector (DC level vs. a calibrated no-finger level)
           └─> band-pass 0.5–4 Hz ──> invert ──> peak detector ──> heart rate
    per-beat red/IR amplitudes ──> ratio of ratios ──> SpO2 (EXPERIMENTAL, uncalibrated)

The IR signal is inverted before peak picking because more blood in the
fingertip absorbs more light: the systolic pulse is a dip in the raw reading.
"""

from __future__ import annotations

import cmath
import math
import random
from collections import deque
from statistics import median

SQRT_HALF = math.sqrt(0.5)  # Q of a 2nd-order Butterworth section


# --------------------------------------------------------------------------
# Filters
# --------------------------------------------------------------------------

class Biquad:
    """One second-order IIR section, Direct Form I.

    Coefficients follow R. Bristow-Johnson's "Audio EQ Cookbook", normalised
    so that a0 = 1:  y = b0*x + b1*x1 + b2*x2 - a1*y1 - a2*y2
    """

    def __init__(self, b0, b1, b2, a1, a2):
        self.b0, self.b1, self.b2, self.a1, self.a2 = b0, b1, b2, a1, a2
        self.reset()

    @classmethod
    def lowpass(cls, fs, f0, q=SQRT_HALF):
        return cls._design("lowpass", fs, f0, q)

    @classmethod
    def highpass(cls, fs, f0, q=SQRT_HALF):
        return cls._design("highpass", fs, f0, q)

    @classmethod
    def _design(cls, kind, fs, f0, q):
        if not 0 < f0 < fs / 2:
            raise ValueError(f"cut-off {f0} Hz must be between 0 and fs/2 ({fs / 2} Hz)")
        w0 = 2 * math.pi * f0 / fs
        cw = math.cos(w0)
        alpha = math.sin(w0) / (2 * q)
        if kind == "lowpass":
            b0, b1 = (1 - cw) / 2, 1 - cw
        else:
            b0, b1 = (1 + cw) / 2, -(1 + cw)
        a0 = 1 + alpha
        return cls(b0 / a0, b1 / a0, b0 / a0, -2 * cw / a0, (1 - alpha) / a0)

    def dc_gain(self):
        return (self.b0 + self.b1 + self.b2) / (1 + self.a1 + self.a2)

    def reset(self, x0=0.0):
        """Set the state as if `x0` had been the input forever.

        Priming with the first sample avoids the large start-up transient a
        high-pass filter would otherwise produce on a 100 000-count DC level.
        """
        self.x1 = self.x2 = x0
        self.y1 = self.y2 = self.dc_gain() * x0

    def process(self, x):
        y = (self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
             - self.a1 * self.y1 - self.a2 * self.y2)
        self.x2, self.x1 = self.x1, x
        self.y2, self.y1 = self.y1, y
        return y

    def gain_at(self, f, fs):
        """Magnitude response at frequency f (analytic, for tests)."""
        z = cmath.exp(-2j * math.pi * f / fs)
        num = self.b0 + self.b1 * z + self.b2 * z * z
        den = 1 + self.a1 * z + self.a2 * z * z
        return abs(num / den)


class BandPass:
    """Butterworth high-pass followed by low-pass (two cascaded biquads)."""

    def __init__(self, fs, low_hz, high_hz):
        self.hp = Biquad.highpass(fs, low_hz)
        self.lp = Biquad.lowpass(fs, high_hz)

    def reset(self, x0=0.0):
        self.hp.reset(x0)
        self.lp.reset(0.0)  # the high-pass output of a steady DC level is 0

    def process(self, x):
        return self.lp.process(self.hp.process(x))

    def gain_at(self, f, fs):
        return self.hp.gain_at(f, fs) * self.lp.gain_at(f, fs)


# --------------------------------------------------------------------------
# Peak detection and rates
# --------------------------------------------------------------------------

class PeakDetector:
    """Streaming peak picker for a band-passed signal.

    Peaks are judged by *prominence*: height above the lowest point since the
    previous peak. That ignores slow baseline wander (breathing, a shifting
    finger) which would push whole beats under a fixed threshold.

    A candidate starts on a rising sample more than max(`min_prominence`,
    `threshold_frac` x envelope) above that low point; the envelope is a
    decaying (time constant `envelope_tau_s`) max of recent prominences.
    While the signal keeps climbing the candidate moves up with it, so a
    wiggle on a slow upstroke is never a peak of its own. The candidate is
    confirmed once the signal has fallen back by `drop_frac` of its
    prominence (typically 0.1-0.2 s after the peak). No candidate may start
    within `refractory_s` of a confirmed peak, so a dicrotic notch or a jerky
    compression right after a peak is not counted twice.

    The returned index is refined with a parabola through the peak sample and
    its neighbours (a float), so rates are not quantised to whole samples.
    """

    def __init__(self, fs, refractory_s=0.3, threshold_frac=0.5,
                 envelope_tau_s=2.0, min_prominence=0.0, drop_frac=0.5):
        self.refractory = max(1, round(refractory_s * fs))
        self.threshold_frac = threshold_frac
        self.decay = math.exp(-1.0 / (envelope_tau_s * fs))
        self.min_prominence = min_prominence
        self.drop_frac = drop_frac
        self.reset()

    def reset(self):
        self.n = 0              # index of the next sample to arrive
        self.prev = None        # previous sample
        self.valley = math.inf  # lowest sample since the last confirmed peak
        self.envelope = 0.0     # decaying max of confirmed prominences
        self.candidate = None   # [index, value, sample before, sample after]
        self.last_peak = None   # index of the last reported peak

    def process(self, x):
        """Feed one sample. Returns the (fractional) index of a newly
        confirmed peak, or None."""
        i, prev = self.n, self.prev
        self.n += 1
        self.prev = x
        self.envelope *= self.decay
        c = self.candidate
        if c is None:
            self.valley = min(self.valley, x)
            if (prev is not None and x > prev
                    and (self.last_peak is None or i - self.last_peak >= self.refractory)
                    and x - self.valley > max(self.min_prominence,
                                              self.threshold_frac * self.envelope)):
                self.candidate = [i, x, prev, None]
            return None
        if x > c[1]:                    # still climbing: move the candidate up
            self.candidate = [i, x, prev, None]
            return None
        if c[3] is None:
            c[3] = x
        prominence = c[1] - self.valley
        if c[1] - x < self.drop_frac * prominence:
            return None
        self.envelope = max(self.envelope, prominence)
        self.last_peak = c[0]
        self.valley = x
        self.candidate = None
        before, peak, after = c[2], c[1], c[3]
        curvature = before - 2 * peak + after
        offset = 0.5 * (before - after) / curvature if curvature < 0 else 0.0
        return c[0] + max(-0.5, min(0.5, offset))


def detect_peaks(signal, fs, **kwargs):
    """Batch helper: indices of all peaks PeakDetector finds in `signal`."""
    det = PeakDetector(fs, **kwargs)
    return [i for i in (det.process(x) for x in signal) if i is not None]


def rate_per_minute(event_times, min_interval_s=0.3, max_interval_s=2.0, min_intervals=3):
    """Events per minute from the median interval between consecutive events.

    Intervals outside [min_interval_s, max_interval_s] (a missed or a doubled
    beat) are dropped. Returns None until `min_intervals` good intervals exist.
    """
    times = list(event_times)
    intervals = [b - a for a, b in zip(times, times[1:])
                 if min_interval_s <= b - a <= max_interval_s]
    if len(intervals) < min_intervals:
        return None
    return 60.0 / median(intervals)


# --------------------------------------------------------------------------
# SpO2 (EXPERIMENTAL)
# --------------------------------------------------------------------------

def ratio_of_ratios(red_ac, red_dc, ir_ac, ir_dc):
    """R = (AC_red / DC_red) / (AC_ir / DC_ir), or None if undefined."""
    if min(red_dc, ir_dc, ir_ac) <= 0 or red_ac <= 0:
        return None
    return (red_ac / red_dc) / (ir_ac / ir_dc)


def spo2_from_ratio(r):
    """EXPERIMENTAL SpO2 % from R. NOT calibrated, NOT for medical use.

    Uses the quadratic from Maxim's MAXREFDES117 reference code
    (-45.060 R^2 + 30.354 R + 94.845). It was fitted for a different sensor
    and enclosure, so treat the number as a demo, not a measurement.
    """
    if r is None or not 0.2 <= r <= 1.8:
        return None
    return max(0.0, min(100.0, -45.060 * r * r + 30.354 * r + 94.845))


# --------------------------------------------------------------------------
# Finger detection
# --------------------------------------------------------------------------

class FingerDetector:
    """Decides "finger on the sensor" from the smoothed IR level.

    `calibrate()` is fed ~2 s of readings taken with NO finger on the sensor.
    The no-finger level (LED light bouncing off the clip) and its noise set
    the threshold, so nothing is tied to one enclosure:

        margin   = max(10 x noise, 0.5 x no-finger level, 5 % of full scale)
        finger ON  when level > no-finger + margin
        finger OFF when level < no-finger + margin / 2   (hysteresis)

    The no-finger level also follows the reading down whenever no finger is
    present, so a calibration accidentally done with a finger on heals
    itself the first time the finger is lifted.
    """

    def __init__(self, full_scale=262143, fs=100.0, smooth_s=0.1):
        self.full_scale = full_scale
        self.alpha = 1.0 - math.exp(-1.0 / (smooth_s * fs))
        self.baseline = None
        self.noise = 0.0
        self.level = None
        self.present = False

    @property
    def calibrated(self):
        return self.baseline is not None

    @property
    def margin(self):
        return max(10 * self.noise, 0.5 * self.baseline, 0.05 * self.full_scale)

    @property
    def on_level(self):
        return self.baseline + self.margin

    @property
    def off_level(self):
        return self.baseline + 0.5 * self.margin

    def calibrate(self, ir_samples):
        """Set the no-finger level. Returns a list of warnings (may be empty)."""
        samples = list(ir_samples)
        if not samples:
            raise ValueError("calibration needs at least one sample")
        mean = sum(samples) / len(samples)
        self.noise = math.sqrt(sum((s - mean) ** 2 for s in samples) / len(samples))
        self.baseline = mean
        self.level = mean
        self.present = False
        warnings = []
        if max(samples) >= 0.97 * self.full_scale:
            warnings.append("IR is saturated: lower the LED current (--led-ma).")
        elif mean > 0.25 * self.full_scale:
            warnings.append("IR was already high during calibration - was a finger on "
                            "the sensor? It will re-calibrate when the finger is lifted.")
        return warnings

    def update(self, ir):
        """Feed one raw IR sample; returns True while a finger is present."""
        if not self.calibrated:
            raise RuntimeError("call calibrate() first")
        self.level += self.alpha * (ir - self.level)
        if self.present:
            self.present = self.level >= self.off_level
        else:
            self.present = self.level > self.on_level
        if not self.present and self.level < self.baseline:
            self.baseline = self.level
        return self.present


# --------------------------------------------------------------------------
# Whole pulse pipeline
# --------------------------------------------------------------------------

class PulseProcessor:
    """Feeds raw (red, IR) samples through calibration, finger detection,
    band-pass filtering, peak detection, heart rate and SpO2.

    Time is counted in samples (`n / fs`), which is steadier than wall-clock
    time because the sensor samples on its own clock.

    Freshness: heart_rate() and spo2() return None unless a beat was
    confirmed in the last `stale_s` seconds, so a value never outlives the
    pulse it came from. Saturated readings, a lifted finger and lost samples
    (call discontinuity()) all forget the stored beats; the filters restart
    from the next good sample. status() says which state applies.
    """

    STATUSES = ("calibrating", "no finger", "saturated", "acquiring", "pulse")

    def __init__(self, fs=100.0, calibrate_s=2.0, full_scale=262143,
                 hr_window_s=10.0, holdoff_s=1.0, buffer_s=4.0, stale_s=5.0):
        self.fs = fs
        self.bp_ir = BandPass(fs, 0.5, 4.0)
        self.bp_red = BandPass(fs, 0.5, 4.0)
        # 0.6: tested best with +/-30 % beat-to-beat amplitude change and a strong
        # dicrotic notch (no missed beats, few extra ones; HR uses the median anyway).
        self.peaks = PeakDetector(fs, refractory_s=0.3, threshold_frac=0.6)
        self.finger = FingerDetector(full_scale, fs)
        self.full_scale = full_scale
        self.calib_n = max(1, int(calibrate_s * fs))
        self.calib = []
        self.calibration_warnings = []
        self.hr_window_s = hr_window_s
        self.stale_s = stale_s
        self.holdoff_n = int(holdoff_s * fs)
        self.window = deque(maxlen=int(buffer_s * fs))   # (red, ir, red_ac, ir_ac)
        self.peak_times = deque(maxlen=64)
        self.beat_ratios = deque(maxlen=8)               # (time, R)
        self.last_peak = None  # absolute sample index of the previous beat
        self.n = 0
        self.peak_base = 0     # absolute index of the peak detector's sample 0
        self.restart = True    # restart the filters at the next good sample
        self.present = False
        self.saturated = False
        self.wave = 0.0        # latest band-passed, inverted IR (for plots)
        self.red = self.ir = 0

    @property
    def calibrating(self):
        return not self.finger.calibrated

    @property
    def time(self):
        return self.n / self.fs

    def discontinuity(self):
        """The sample stream has a gap (e.g. FIFO overflow): forget the beats
        and restart the filters, as no beat may span the gap."""
        self.peak_times.clear()
        self.beat_ratios.clear()
        self.last_peak = None
        self.restart = True

    def add(self, red, ir):
        """Feed one sample. Returns True when a new heartbeat is confirmed."""
        self.n += 1
        self.red, self.ir = red, ir
        self.saturated = ir >= 0.97 * self.full_scale or red >= 0.97 * self.full_scale
        if self.calibrating:
            self.calib.append(ir)
            if len(self.calib) >= self.calib_n:
                self.calibration_warnings = self.finger.calibrate(self.calib)
                self.calib = []
            return False

        self.present = self.finger.update(ir)
        if not self.present or self.saturated:
            self.wave = 0.0
            self.discontinuity()
            return False
        if self.restart:
            # Finger just arrived, or the signal came back after a gap:
            # restart the filters from this level.
            self.bp_ir.reset(ir)
            self.bp_red.reset(red)
            self.peaks.reset()
            self.peak_base = self.n - 1
            self.window.clear()
            self.restart = False

        ir_ac = -self.bp_ir.process(ir)
        red_ac = -self.bp_red.process(red)
        self.wave = ir_ac
        self.window.append((red, ir, red_ac, ir_ac))
        idx = self.peaks.process(ir_ac)
        if idx is None or idx < self.holdoff_n:
            return False
        peak = self.peak_base + idx
        if self.last_peak is not None:
            self._add_beat_ratio(self.last_peak, peak)
        self.last_peak = peak
        self.peak_times.append(peak / self.fs)
        return True

    def _add_beat_ratio(self, start, end):
        """SpO2 ratio R for one beat: peak-to-valley amplitude of the
        filtered signals over the mean raw level. Per-beat amplitudes are
        far less affected by breathing wander than a windowed RMS."""
        newest = self.n - 1
        i0 = len(self.window) - 1 - (newest - round(start))
        i1 = len(self.window) - 1 - (newest - round(end))
        if i0 < 0 or i1 <= i0:
            return
        beat = [self.window[i] for i in range(i0, i1 + 1)]
        valley = min(range(len(beat)), key=lambda k: beat[k][3])
        r = ratio_of_ratios(beat[-1][2] - beat[valley][2],
                            sum(b[0] for b in beat) / len(beat),
                            beat[-1][3] - beat[valley][3],
                            sum(b[1] for b in beat) / len(beat))
        if r is not None:
            self.beat_ratios.append((end / self.fs, r))

    def _fresh(self):
        """A finger, no saturation, and a beat within the last stale_s."""
        return (self.present and not self.saturated and bool(self.peak_times)
                and self.time - self.peak_times[-1] <= self.stale_s)

    def heart_rate(self):
        """Beats per minute over the last `hr_window_s`, or None if not fresh."""
        if not self._fresh():
            return None
        now = self.time
        recent = [t for t in self.peak_times if now - t <= self.hr_window_s]
        return rate_per_minute(recent, 0.3, 2.0, 3)

    def spo2(self):
        """EXPERIMENTAL SpO2 % from the median R of recent beats, or None."""
        if not self._fresh():
            return None
        now = self.time
        recent = [r for t, r in self.beat_ratios if now - t <= self.hr_window_s]
        if len(recent) < 3:
            return None
        return spo2_from_ratio(median(recent))

    def status(self):
        """One of STATUSES: 'pulse' means heart_rate() has a fresh value."""
        if self.calibrating:
            return "calibrating"
        if self.saturated:
            return "saturated"
        if not self.present:
            return "no finger"
        return "pulse" if self.heart_rate() is not None else "acquiring"


# --------------------------------------------------------------------------
# Synthetic signals (self-tests, --simulate, OLED demo)
# --------------------------------------------------------------------------

def _gauss(x, mu, sigma):
    return math.exp(-0.5 * ((x - mu) / sigma) ** 2)


def pulse_shape(phase, dicrotic=0.35):
    """Blood-volume pulse for one beat, phase in [0, 1). Peak value ~1.

    A systolic bump plus a smaller, later dicrotic bump; neighbouring beats
    are summed so the waveform is continuous across beat boundaries.
    """
    v = 0.0
    for k in (-1.0, 0.0, 1.0):
        p = phase + k
        v += _gauss(p, 0.18, 0.07) + dicrotic * _gauss(p, 0.50, 0.10)
    return v


class PpgSimulator:
    """Makes realistic-looking raw (red, IR) readings, one sample at a time.

    `finger(t)` says whether a finger is on the sensor at time t (seconds);
    the default is: off for the first 3 s (so calibration sees no finger),
    then on, lifted for 5 s every minute.
    """

    def __init__(self, fs=100.0, bpm=72.0, seed=1, ir_dc=110000.0, ir_ac=1200.0,
                 red_dc=80000.0, r_ratio=0.5, noise=40.0, no_finger_level=2500.0,
                 dicrotic=0.35, hrv=0.03, amp_var=0.0, finger=None, full_scale=262143):
        self.fs = fs
        self.bpm = bpm
        self.rng = random.Random(seed)
        self.ir_dc, self.ir_ac = ir_dc, ir_ac
        self.red_dc = red_dc
        self.red_ac = r_ratio * (ir_ac / ir_dc) * red_dc
        self.noise = noise
        self.no_finger_level = no_finger_level
        self.dicrotic = dicrotic
        self.hrv = hrv
        self.amp_var = amp_var     # beat-to-beat pulse-size variation, +/- fraction
        self.amp = 1.0
        self.finger = finger or (lambda t: t >= 3.0 and (t % 60.0) < 55.0)
        self.full_scale = full_scale
        self.t = 0.0
        self.phase = 0.0
        self.ibi = self._next_ibi()

    def _next_ibi(self):
        return 60.0 / self.bpm * (1.0 + self.rng.uniform(-self.hrv, self.hrv))

    def sample(self):
        """Next (red, ir) reading as integers in the 18-bit ADC range."""
        t = self.t
        self.t += 1.0 / self.fs
        self.phase += 1.0 / (self.fs * self.ibi)
        if self.phase >= 1.0:
            self.phase -= 1.0
            self.ibi = self._next_ibi()
            self.amp = 1.0 + self.rng.uniform(-self.amp_var, self.amp_var)
        if not self.finger(t):
            ir = self.no_finger_level + self.rng.gauss(0, self.noise)
            red = 0.7 * self.no_finger_level + self.rng.gauss(0, self.noise)
        else:
            v = self.amp * pulse_shape(self.phase, self.dicrotic)
            breath = 1.0 + 0.01 * math.sin(2 * math.pi * 0.25 * t)
            ir = self.ir_dc * breath - self.ir_ac * v + self.rng.gauss(0, self.noise)
            red = self.red_dc * breath - self.red_ac * v + self.rng.gauss(0, self.noise)
        clamp = lambda x: int(max(0, min(self.full_scale, round(x))))  # noqa: E731
        return clamp(red), clamp(ir)


def synth_ppg(fs, seconds, **kwargs):
    """Batch helper: lists (red, ir) of `seconds` of simulated readings."""
    sim = PpgSimulator(fs=fs, **kwargs)
    samples = [sim.sample() for _ in range(int(seconds * fs))]
    return [s[0] for s in samples], [s[1] for s in samples]
