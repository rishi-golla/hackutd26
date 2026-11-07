import math

import pytest

from lib import dsp

FS = 100.0


def run_pulse(bpm, seconds=20.0, finger=lambda t: t >= 2.5, **kw):
    sim = dsp.PpgSimulator(fs=FS, bpm=bpm, finger=finger, **kw)
    proc = dsp.PulseProcessor(fs=FS)
    beats = 0
    for _ in range(int(seconds * FS)):
        beats += proc.add(*sim.sample())
    return proc, beats


# -- Biquad / BandPass -----------------------------------------------------------

@pytest.mark.parametrize("f0", [0, -1, 50, 60])
def test_biquad_invalid_cutoff(f0):
    with pytest.raises(ValueError):
        dsp.Biquad.lowpass(FS, f0)
    with pytest.raises(ValueError):
        dsp.Biquad.highpass(FS, f0)


def test_biquad_half_power_at_cutoff():
    assert dsp.Biquad.lowpass(FS, 4.0).gain_at(4.0, FS) == pytest.approx(math.sqrt(0.5), abs=1e-6)
    assert dsp.Biquad.highpass(FS, 0.5).gain_at(0.5, FS) == pytest.approx(math.sqrt(0.5), abs=1e-6)


def test_biquad_process_matches_gain_at():
    lp = dsp.Biquad.lowpass(FS, 4.0)
    f = 2.0
    out = [lp.process(math.sin(2 * math.pi * f * i / FS)) for i in range(1000)]
    assert max(out[500:]) == pytest.approx(lp.gain_at(f, FS), rel=0.02)


def test_bandpass_primed_with_dc_is_silent():
    bp = dsp.BandPass(FS, 0.5, 4.0)
    for dc in (0.0, 100000.0, 262143.0):
        bp.reset(dc)
        assert max(abs(bp.process(dc)) for _ in range(500)) < 1e-6


def test_bandpass_unprimed_has_transient():
    bp = dsp.BandPass(FS, 0.5, 4.0)
    assert abs(bp.process(100000.0)) > 1000   # shows why priming matters


# -- peaks and rates ---------------------------------------------------------------

def bump(sig, c, h, half=5):
    for i in range(-half, half + 1):
        sig[c + i] = max(sig[c + i], h * (1 - abs(i) / (half + 1)))


def test_peak_min_prominence():
    sig = [0.0] * 400
    bump(sig, 100, 0.4)
    bump(sig, 250, 1.0)
    assert dsp.detect_peaks(sig, FS) == [100, 250]
    assert dsp.detect_peaks(sig, FS, min_prominence=0.5) == [250]


def test_peak_threshold_frac_rejects_small_after_big():
    sig = [0.0] * 600
    bump(sig, 100, 1.0)
    bump(sig, 200, 0.2)   # < 0.5 * envelope (~0.6 after 1 s)
    bump(sig, 400, 1.0)
    assert dsp.detect_peaks(sig, FS) == [100, 400]


@pytest.mark.parametrize("gap, expected", [(20, 1), (29, 1), (31, 2), (40, 2)])
def test_peak_refractory_boundary(gap, expected):
    # equal-height bumps `gap` samples apart, refractory 0.3 s = 30 samples:
    # the second counts only if it is still rising after the refractory window
    sig = [0.0] * 300
    bump(sig, 100, 1.0, half=3)
    bump(sig, 100 + gap, 1.0, half=3)
    assert len(dsp.detect_peaks(sig, FS, refractory_s=0.3)) == expected


def test_peak_reported_after_drop_and_empty_input():
    # Confirmed once the signal has fallen by half the prominence (3 samples
    # after the top of this bump), at the interpolated peak position.
    sig = [0.0] * 200
    bump(sig, 100, 1.0)
    det = dsp.PeakDetector(FS, refractory_s=0.3)
    reported = [(i, p) for i, p in ((i, det.process(x)) for i, x in enumerate(sig)) if p is not None]
    assert reported == [(103, 100.0)]
    assert dsp.detect_peaks([], FS) == []
    assert dsp.detect_peaks([1.0] * 50, FS) == []


def test_rate_per_minute_edges():
    assert dsp.rate_per_minute([]) is None
    assert dsp.rate_per_minute([0, 0.5, 1.0, 1.5]) == pytest.approx(120.0)
    assert dsp.rate_per_minute([0, 0.2, 0.4, 0.6, 0.8]) is None      # all too short
    assert dsp.rate_per_minute([0, 3, 6, 9, 12]) is None             # all too long
    assert dsp.rate_per_minute([0, 0.3, 0.6, 0.9], min_intervals=3) == pytest.approx(200.0, abs=0.5)
    assert dsp.rate_per_minute([0, 1, 2, 3], min_intervals=4) is None


# -- SpO2 ---------------------------------------------------------------------------

def test_ratio_of_ratios():
    assert dsp.ratio_of_ratios(1, 100, 2, 100) == pytest.approx(0.5)
    for args in [(0, 100, 2, 100), (1, 0, 2, 100), (1, 100, 0, 100), (1, 100, 2, 0), (-1, 100, 2, 100)]:
        assert dsp.ratio_of_ratios(*args) is None


def test_spo2_bounds():
    assert dsp.spo2_from_ratio(None) is None
    assert dsp.spo2_from_ratio(0.19) is None and dsp.spo2_from_ratio(1.81) is None
    assert dsp.spo2_from_ratio(0.2) == pytest.approx(-45.06 * 0.04 + 30.354 * 0.2 + 94.845)
    assert all(0.0 <= dsp.spo2_from_ratio(0.2 + 0.01 * i) <= 100.0 for i in range(161))
    assert dsp.spo2_from_ratio(0.34) == pytest.approx(99.95, abs=0.02)   # quadratic's peak


# -- FingerDetector -----------------------------------------------------------------

def test_finger_margin_rules():
    fd = dsp.FingerDetector(full_scale=262143, fs=FS)
    fd.calibrate([2500.0] * 100)                       # no noise: 5 % FS dominates
    assert fd.margin == pytest.approx(0.05 * 262143)
    fd.calibrate([100000.0 + (-1) ** i for i in range(100)])
    assert fd.margin == pytest.approx(50000.0 + 0, abs=1)   # 0.5 * baseline dominates
    noisy = [2500 + (3000 if i % 2 else -3000) for i in range(100)]
    fd.calibrate(noisy)
    assert fd.margin == pytest.approx(10 * 3000)       # 10 sigma dominates


def test_finger_calibrate_warnings_and_errors():
    fd = dsp.FingerDetector()
    with pytest.raises(ValueError):
        fd.calibrate([])
    with pytest.raises(RuntimeError):
        fd.update(1000)
    assert "saturated" in fd.calibrate([262143] * 10)[0]
    assert fd.calibrate([1000] * 10) == []


def test_finger_baseline_follows_down_only_without_finger():
    fd = dsp.FingerDetector(fs=FS)
    fd.calibrate([5000.0] * 100)
    for _ in range(300):
        fd.update(2000)
    assert fd.baseline < 2100
    base = fd.baseline
    for _ in range(100):
        fd.update(150000)
    assert fd.present and fd.baseline == base


# -- PulseProcessor -----------------------------------------------------------------

@pytest.mark.parametrize("bpm", [55, 80, 120, 160, 180])
@pytest.mark.parametrize("seed", [2, 3])
def test_heart_rate_accuracy(bpm, seed):
    proc, _ = run_pulse(bpm, seed=seed, noise=100.0)
    assert proc.heart_rate() == pytest.approx(bpm, abs=3.0)


# Regression: a noise wiggle on the slow upstroke at 40-50 bpm used to count as an
# extra beat (fixed by confirming peaks only after the signal falls back).
@pytest.mark.parametrize("bpm, seed, noise", [(40, 1, 40.0), (40, 2, 40.0), (45, 2, 100.0),
                                              (40, 3, 100.0), (50, 1, 100.0)])
def test_heart_rate_slow_pulse(bpm, seed, noise):
    proc, _ = run_pulse(bpm, seed=seed, noise=noise)
    assert proc.heart_rate() == pytest.approx(bpm, abs=3.0)


def test_no_double_counting_strong_dicrotic():
    bpm = 75
    proc, beats = run_pulse(bpm, seconds=30, dicrotic=0.8, hrv=0.0)
    expected = (30 - 2.5) * bpm / 60
    assert abs(beats - expected) <= 3, (beats, expected)
    assert proc.heart_rate() == pytest.approx(bpm, abs=3.0)


def test_finger_lift_resets_heart_rate_and_replace_recovers():
    sim = dsp.PpgSimulator(fs=FS, bpm=80, finger=lambda t: t >= 2.5 and not 20 <= t < 25)
    proc = dsp.PulseProcessor(fs=FS)
    seen = {}
    for n in range(int(40 * FS)):
        proc.add(*sim.sample())
        t = (n + 1) / FS
        if t in (19.99, 24.99):
            seen[round(t)] = proc.heart_rate()
        if 21 < t < 22.0 and n % 100 == 0:
            seen["lifted"] = proc.heart_rate()
    assert seen[20] == pytest.approx(80, abs=3)
    assert seen["lifted"] is None and seen[25] is None
    assert proc.status() == "pulse"
    assert proc.heart_rate() == pytest.approx(80, abs=3)
    t = list(proc.peak_times)
    assert min(t) > 25     # beats from before the lift were forgotten


def test_hr_window_drops_old_beats():
    proc, _ = run_pulse(75, seconds=20)
    assert proc.heart_rate() is not None
    for _ in range(int(11 * FS)):            # time passes, but no new beats arrive
        proc.n += 1
    assert proc.heart_rate() is None


# -- stale values (review finding: SpO2 outlived its pulse) --------------------------

def _valid_then(tail, tail_s):
    proc, _ = run_pulse(72, seconds=20, seed=1, finger=lambda t: t >= 3)
    assert proc.status() == "pulse" and proc.heart_rate() and proc.spo2()
    last_beat = proc.peak_times[-1]
    for _ in range(int(tail_s * FS)):
        proc.add(*tail)
    return proc, last_beat


def test_flat_signal_expires_hr_and_spo2_within_stale_window():
    proc, last_beat = _valid_then((80000, 110000), 0.0)
    while proc.time - last_beat < proc.stale_s - 0.05:        # inside the window: kept
        proc.add(80000, 110000)
    assert proc.heart_rate() is not None
    for _ in range(int(0.1 * FS)):                            # just past it: gone
        proc.add(80000, 110000)
    assert proc.heart_rate() is None and proc.spo2() is None
    assert proc.present and proc.status() == "acquiring"


def test_saturation_clears_hr_and_spo2_at_once_and_recovers():
    proc, _ = _valid_then((262143, 262143), 0.01)
    assert proc.heart_rate() is None and proc.spo2() is None
    assert proc.status() == "saturated" and not proc.peak_times and not proc.beat_ratios
    for _ in range(int(30 * FS)):
        proc.add(262143, 262143)
    assert proc.heart_rate() is None and proc.spo2() is None
    sim = dsp.PpgSimulator(fs=FS, bpm=90, seed=2, finger=lambda t: True)
    for _ in range(int(10 * FS)):                             # good signal again
        proc.add(*sim.sample())
    assert proc.status() == "pulse"
    assert proc.heart_rate() == pytest.approx(90, abs=3)


def test_discontinuity_forgets_beats_and_recovers():
    sim = dsp.PpgSimulator(fs=FS, bpm=72, seed=3, finger=lambda t: t >= 2.5)
    proc = dsp.PulseProcessor(fs=FS)
    for _ in range(int(20 * FS)):
        proc.add(*sim.sample())
    assert proc.heart_rate() is not None
    proc.discontinuity()                                      # e.g. FIFO overflow
    assert proc.heart_rate() is None and proc.spo2() is None
    assert proc.status() == "acquiring"
    for _ in range(int(8 * FS)):
        proc.add(*sim.sample())
    assert proc.heart_rate() == pytest.approx(72, abs=3)
    assert min(proc.peak_times) > 20                          # nothing from before the gap


def test_status_progression():
    proc = dsp.PulseProcessor(fs=FS)
    assert proc.status() == "calibrating"
    sim = dsp.PpgSimulator(fs=FS, finger=lambda t: False)
    for _ in range(int(3 * FS)):
        proc.add(*sim.sample())
    assert proc.status() == "no finger"
    proc.add(262143, 262143)
    assert proc.status() == "saturated"


def test_simulator_deterministic_and_in_range():
    a = dsp.synth_ppg(FS, 5, seed=4, finger=lambda t: True)
    b = dsp.synth_ppg(FS, 5, seed=4, finger=lambda t: True)
    assert a == b and len(a[0]) == 500
    assert all(0 <= v <= 262143 for ch in a for v in ch)
