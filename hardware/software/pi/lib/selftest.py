"""Offline self-test of the pure parts of lib/ with synthetic signals.

Run from software/pi on any computer (no Pi, no sensor, no extra packages):

    python3 -m lib.selftest

Prints one PASS/FAIL line per check and exits 1 if anything failed.
"""

from __future__ import annotations

import itertools
import math
import sys
import traceback

from . import dsp, i2cscan, max30101 as mx, pihealth, wires
from .simbus import SimulatedMax30101Bus

CHECKS = []


def check(fn):
    CHECKS.append(fn)
    return fn


def approx(a, b, tol):
    return a is not None and abs(a - b) <= tol


# -- filters ------------------------------------------------------------------

@check
def biquad_dc_and_band():
    """band-pass 0.5-4 Hz: passes 1.2 Hz, blocks DC and 20 Hz"""
    fs = 100.0
    bp = dsp.BandPass(fs, 0.5, 4.0)
    assert bp.gain_at(1e-6, fs) < 1e-3, "DC must be blocked"
    assert bp.gain_at(1.2, fs) > 0.85, f"1.2 Hz gain {bp.gain_at(1.2, fs):.2f}"
    assert bp.gain_at(20.0, fs) < 0.05, f"20 Hz gain {bp.gain_at(20.0, fs):.3f}"
    assert abs(dsp.Biquad.lowpass(fs, 4.0).dc_gain() - 1.0) < 1e-9
    assert abs(dsp.Biquad.highpass(fs, 0.5).dc_gain()) < 1e-9


@check
def biquad_primed_no_transient():
    """priming with the first sample: no start-up transient on a 100k DC level"""
    bp = dsp.BandPass(100.0, 0.5, 4.0)
    bp.reset(100000.0)
    out = [bp.process(100000.0) for _ in range(200)]
    assert max(abs(v) for v in out) < 1e-6


# -- peaks and rates ----------------------------------------------------------

@check
def peaks_on_sine():
    """peak detector finds every cycle of a 1.5 Hz sine"""
    fs = 100.0
    sig = [math.sin(2 * math.pi * 1.5 * i / fs) for i in range(int(20 * fs))]
    peaks = dsp.detect_peaks(sig, fs, refractory_s=0.3)
    assert len(peaks) == 30, f"found {len(peaks)} peaks, expected 30"


@check
def peaks_refractory_merges_double_bump():
    """two bumps 0.15 s apart count once (refractory 0.3 s)"""
    fs = 100.0
    sig = [0.0] * 300
    for c, h in ((100, 0.8), (115, 1.0)):
        for i in range(-5, 6):
            sig[c + i] = max(sig[c + i], h * (1 - abs(i) / 6))
    peaks = dsp.detect_peaks(sig, fs, refractory_s=0.3)
    assert peaks == [100], peaks


@check
def rate_ignores_outlier_intervals():
    """rate_per_minute uses the median and drops impossible intervals"""
    times = [0, 1.0, 2.0, 2.05, 3.0, 4.0, 7.5, 8.5]
    assert approx(dsp.rate_per_minute(times), 60.0, 0.01)
    assert dsp.rate_per_minute([0, 1, 2]) is None, "needs 3 intervals"


def _run_pulse(bpm, seconds=20.0, **sim_kwargs):
    fs = 100.0
    sim = dsp.PpgSimulator(fs=fs, bpm=bpm, finger=lambda t: t >= 2.5, **sim_kwargs)
    proc = dsp.PulseProcessor(fs=fs)
    for _ in range(int(seconds * fs)):
        proc.add(*sim.sample())
    return proc


@check
def heart_rate_across_range():
    """heart rate within 3 bpm for 45-180 bpm, no missed beats (notch, wander, HRV)"""
    for bpm in (45, 60, 72, 100, 140, 180):
        proc = _run_pulse(bpm)
        hr = proc.heart_rate()
        assert approx(hr, bpm, 3.0), f"{bpm} bpm -> {hr}"
        t = list(proc.peak_times)
        longest = max(b - a for a, b in zip(t, t[1:]))
        assert longest < 1.5 * 60 / bpm, f"{bpm} bpm: a beat was missed ({longest:.2f} s gap)"


@check
def heart_rate_noisy_signal():
    """heart rate within 4 bpm with 4x the noise and a strong dicrotic bump"""
    for bpm in (60, 110):
        proc = _run_pulse(bpm, noise=160.0, dicrotic=0.6, seed=7)
        hr = proc.heart_rate()
        assert approx(hr, bpm, 4.0), f"{bpm} bpm -> {hr}"


@check
def heart_rate_slow_pulse_and_amplitude_changes():
    """heart rate at 40 bpm (slow upstroke) and with +/-30 % pulse-size changes"""
    for seed in (1, 2, 3):
        for noise in (40.0, 100.0):
            hr = _run_pulse(40, seed=seed, noise=noise).heart_rate()
            assert approx(hr, 40, 3.0), f"40 bpm seed {seed} noise {noise} -> {hr}"
    for bpm in (50, 90, 150):
        proc = _run_pulse(bpm, amp_var=0.3, seed=4)
        assert approx(proc.heart_rate(), bpm, 3.0), f"{bpm} bpm -> {proc.heart_rate()}"
        t = list(proc.peak_times)
        assert max(b - a for a, b in zip(t, t[1:])) < 1.5 * 60 / bpm, f"{bpm} bpm: missed beat"


@check
def stale_values_expire():
    """HR/SpO2 go null: flat signal within 5 s, saturation and lost samples at once"""
    for tail, limit_s in (((80000, 110000), 5.0), ((262143, 262143), 0.01)):
        proc = _run_pulse(72, seconds=20, seed=1)
        assert proc.heart_rate() and proc.spo2() and proc.status() == "pulse"
        last_beat = proc.peak_times[-1]
        for _ in range(int(limit_s * 100) + 100):
            proc.add(*tail)
            if proc.heart_rate() is None and proc.spo2() is None:
                break
        waited = proc.time - max(last_beat, 20.0)
        assert proc.heart_rate() is None and proc.spo2() is None, f"stale after {tail}"
        assert waited <= limit_s + 0.01, f"{tail}: took {waited:.2f} s"
        assert proc.status() == ("acquiring" if tail[0] < 200000 else "saturated")
    proc = _run_pulse(72, seconds=20, seed=1)
    proc.discontinuity()
    assert proc.heart_rate() is None and proc.spo2() is None


@check
def no_heart_rate_without_finger():
    """no finger -> not present, no heart rate, no SpO2"""
    fs = 100.0
    sim = dsp.PpgSimulator(fs=fs, finger=lambda t: False)
    proc = dsp.PulseProcessor(fs=fs)
    for _ in range(int(10 * fs)):
        proc.add(*sim.sample())
    assert not proc.present and proc.heart_rate() is None and proc.spo2() is None
    assert proc.status() == "no finger"


# -- finger detection ---------------------------------------------------------

@check
def finger_detector_calibrated_hysteresis():
    """finger detector: threshold from calibration, on/off with hysteresis"""
    fd = dsp.FingerDetector(full_scale=262143, fs=100.0)
    warnings = fd.calibrate([3000 + (i % 7) for i in range(200)])
    assert warnings == [], warnings
    assert 3000 < fd.off_level < fd.on_level < 30000
    states = [fd.update(3000) for _ in range(50)]
    assert not any(states)
    states = [fd.update(110000) for _ in range(50)]
    assert states[-1], "finger should be detected"
    # Drop to between the off and on levels: stays present (hysteresis).
    mid = (fd.off_level + fd.on_level) / 2
    assert all(fd.update(mid) for _ in range(100))
    assert not [fd.update(3000) for _ in range(100)][-1], "finger should be gone"


@check
def finger_detector_heals_bad_calibration():
    """calibrating with a finger on: warns, then heals when the finger lifts"""
    fd = dsp.FingerDetector(full_scale=262143, fs=100.0)
    warnings = fd.calibrate([110000 + 500 * math.sin(i / 10) for i in range(200)])
    assert warnings and "already high" in warnings[0]
    for _ in range(300):
        fd.update(2500)                       # finger lifted
    assert fd.baseline < 5000
    assert [fd.update(110000) for _ in range(50)][-1], "finger detected after healing"


# -- SpO2 ---------------------------------------------------------------------

@check
def spo2_formula_and_pipeline():
    """SpO2 (EXPERIMENTAL): formula values and R=0.5 from the pipeline -> ~98.8 %"""
    assert approx(dsp.spo2_from_ratio(0.5), 98.76, 0.05)
    assert approx(dsp.spo2_from_ratio(1.0), 80.14, 0.05)
    assert dsp.spo2_from_ratio(3.0) is None
    proc = _run_pulse(72, r_ratio=0.5)
    assert approx(proc.spo2(), 98.8, 1.5), proc.spo2()


# -- MAX30101 helpers ---------------------------------------------------------

@check
def max30101_register_encoders():
    """register encoders: SpO2 config, FIFO config, LED current"""
    # SPO2_ADC_RGE=01 (4096 nA), SPO2_SR=001 (100/s), LED_PW=11 (411 us) -> 0b0_01_001_11
    assert mx.spo2_config_byte(4096, 100, 411) == 0x27
    # SMP_AVE=000, FIFO_ROLLOVER_EN=1, FIFO_A_FULL=0xF -> 0b000_1_1111
    assert mx.fifo_config_byte(1, True, 0x0F) == 0x1F
    assert mx.fifo_config_byte(4, False, 0) == 0x40
    assert mx.led_amplitude_byte(6.2) == 0x1F and mx.led_amplitude_byte(25.4) == 0x7F
    assert mx.led_amplitude_byte(99) == 0xFF and mx.led_amplitude_byte(-1) == 0


@check
def max30101_fifo_pointer_math():
    """FIFO pointers: wrap-around, empty, and full (overflow counter set)"""
    assert mx.fifo_available(5, 2, 0) == 3
    assert mx.fifo_available(1, 30, 0) == 3          # wrapped
    assert mx.fifo_available(7, 7, 0) == 0           # empty
    assert mx.fifo_available(7, 7, 4) == 32          # full, 4 lost


@check
def max30101_fifo_parse_18bit():
    """FIFO parsing: 3 bytes per channel, MSB first, bits 23:18 masked"""
    data = bytes([0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x01,     # red=0x3FFFF, ir=1
                  0xC1, 0x23, 0x45, 0x02, 0x00, 0x00,     # red=0x12345, ir=0x20000
                  0x01, 0x02])                            # partial sample, ignored
    assert mx.parse_fifo(data, 2) == [(0x3FFFF, 1), (0x12345, 0x20000)]


@check
def max30101_driver_on_simulated_bus():
    """driver on a simulated bus: part ID, setup, 100/s, overflow and recovery"""
    t = [0.0]
    sim = dsp.PpgSimulator(fs=100.0, finger=lambda s: True)
    bus = SimulatedMax30101Bus(simulator=sim, clock=lambda: t[0])
    s = mx.Max30101(bus)
    assert s.check_part_id() == 0x15
    assert s.setup_spo2() == 100
    assert bus.regs[mx.REG_SPO2_CONFIG] == 0x27 and bus.regs[mx.REG_MODE_CONFIG] == 0x03
    t[0] += 0.1                                      # 10 samples
    got, lost = s.read_fifo()
    assert len(got) == 10 and lost == 0, (len(got), lost)
    assert all(0 < v <= mx.FULL_SCALE for pair in got for v in pair), "junk bits not masked"
    t[0] += 0.45                                     # 45 samples > 32: overflow
    got, lost = s.read_fifo()
    assert len(got) == 32 and lost == 13, (len(got), lost)
    t[0] += 0.05
    got, lost = s.read_fifo()
    assert len(got) == 5 and lost == 0, (len(got), lost)
    assert s.read_temperature() == 30.25
    s.shutdown()
    t[0] += 1.0
    assert s.read_fifo()[0] == [], "no samples in shutdown"


# -- I2C scan, Pi health ------------------------------------------------------

I2CDETECT_SAMPLE = """\
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:                         -- -- -- -- -- -- -- --
10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
20: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
30: -- -- -- -- -- -- -- -- -- -- -- -- -- 3d -- --
40: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
50: -- -- -- -- -- -- -- 57 -- -- -- -- -- -- -- --
60: -- -- -- -- -- -- -- -- UU -- -- -- -- -- -- --
70: -- -- -- -- -- -- -- --
"""


@check
def i2cdetect_parse_and_diagnose():
    """i2cdetect parsing and diagnosis of missing devices"""
    assert i2cscan.parse_i2cdetect(I2CDETECT_SAMPLE) == [0x3D, 0x57, 0x68]
    assert i2cscan.diagnose([0x3D, 0x57])[0]
    assert i2cscan.diagnose([0x3C, 0x57])[0]
    assert i2cscan.diagnose([0x57])[0]                       # no OLED: still OK
    ok, lines = i2cscan.diagnose([0x3D])
    assert not ok and "500 mm cable" in " ".join(lines)
    ok, lines = i2cscan.diagnose([])
    assert not ok and "SHIM" in " ".join(lines)
    ok, lines = i2cscan.diagnose(list(range(0x08, 0x78)))
    assert not ok and "shorted" in " ".join(lines)


@check
def throttled_decode():
    """vcgencmd get_throttled decoding"""
    assert pihealth.parse_throttled("throttled=0x50005\n") == 0x50005
    flags = pihealth.decode_throttled(0x50005)
    assert flags == ["under-voltage detected NOW", "throttled NOW",
                     "under-voltage has occurred since boot",
                     "throttling has occurred since boot"], flags
    assert pihealth.decode_throttled(0) == []


@check
def nmcli_and_ip_parse():
    """nmcli Wi-Fi and `ip addr` parsing"""
    text = "no:Neighbour:40\nyes:Dino\\:s iPhone:78\n"
    assert pihealth.parse_nmcli_wifi(text) == ("Dino:s iPhone", 78)
    assert pihealth.parse_nmcli_wifi("no:x:10\n") == (None, None)
    ip = ("1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever\n"
          "3: wlan0    inet 172.20.10.3/28 brd 172.20.10.15 scope global wlan0\n")
    assert pihealth.parse_ip_addr(ip) == {"wlan0": "172.20.10.3"}


# -- wire identification ------------------------------------------------------

def _solve(truth, labels):
    gen = wires.identify(labels)
    probes = 0
    try:
        probe = next(gen)
        while True:
            probes += 1
            probe = gen.send(wires.simulate_answer(truth, *probe))
    except StopIteration as stop:
        return stop.value, probes


@check
def wire_identification_all_orders():
    """wire identification: all 720 orders, common anode and common cathode"""
    labels = list("123456")
    roles = ["common", "red", "green", "blue", "sw", "sw"]
    worst = {}
    for polarity in ("anode", "cathode"):
        worst[polarity] = 0
        for perm in set(itertools.permutations(roles)):
            truth = dict(zip(labels, perm), _polarity=polarity)
            result, probes = _solve(truth, labels)
            worst[polarity] = max(worst[polarity], probes)
            assert result["polarity"] == f"common {polarity}"
            for role in ("common", "red", "green", "blue"):
                assert truth[result[role]] == role
            assert sorted(truth[w] for w in result["switch"]) == ["sw", "sw"]
    # Common anode (expected): at most 3 dark rounds of 5, one lit round, 4 more.
    assert worst["anode"] <= 24, worst


# -- runner -------------------------------------------------------------------

def main():
    failed = 0
    for fn in CHECKS:
        name = (fn.__doc__ or fn.__name__).strip().splitlines()[0]
        try:
            fn()
            print(f"PASS  {name}")
        except Exception as e:
            failed += 1
            print(f"FAIL  {name}\n      {type(e).__name__}: {e}")
            if "-v" in sys.argv:
                traceback.print_exc()
    print(f"\n{len(CHECKS) - failed}/{len(CHECKS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
