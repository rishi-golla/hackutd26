#!/usr/bin/env python3
"""Replays real recordings (testdata/) through the same logic as pi_oximeter.py and fails if the sensor got worse.
Run on the Pi (numpy/scipy/heartpy):  python3 test_sensor.py     deploy.sh runs it before restarting anything.

Reference heart rate = the dominant frequency over 8 s, only where it is unambiguous (an independent method).
Measured 2026-11-07 with HeartPy: strapped first reading 4.0 s, mean error 1.3 bpm; live 1.9 bpm; noise 1/1200 ticks.
"""
import json, os, sys
import numpy as np
from scipy.signal import butter, filtfilt
from max30102 import estimate, FS

HERE = os.path.dirname(os.path.abspath(__file__))


def service(I):
    """pi_oximeter's tick logic: 0.25 s ticks, 4 s window, first value needs 3 agreeing estimates, then 2, median of 8."""
    recent, hist, out = [], [], []
    for end in range(25, len(I) + 1, 25):
        if np.mean(I[end - 10:end]) < 40000:
            recent, hist = [], []
            out.append((end / FS, None))
            continue
        e = estimate(I[max(0, end - 400):end])
        recent = (recent + [e["hr"]])[-3:]
        need = recent if not hist else recent[-2:]
        ok = all(need) and len(need) >= (2 if hist else 3) and max(need) - min(need) <= 0.1 * min(need)
        hist = (hist + [e["hr"]])[-8:] if ok else hist
        out.append((end / FS, sorted(hist)[len(hist) // 2] if ok else None))
    return out


def reference(I):
    b, a = butter(2, [0.7, 3.5], btype="band", fs=FS)
    f = np.fft.rfftfreq(8192, 1 / FS)
    band = (f >= 0.7) & (f <= 3.5)
    ref = {}
    for end in range(800, len(I) + 1, 25):
        x = np.asarray(I[end - 800:end], float)
        if x.min() < 40000:
            continue
        p = np.abs(np.fft.rfft(filtfilt(b, a, x) * np.hanning(800), 8192)) ** 2
        if p[band].max() > 20 * np.median(p[band]):
            ref[end / FS] = f[band][np.argmax(p[band])] * 60
    # drop single-tick reference glitches (the FFT itself can flip to half rate for one window)
    ts = sorted(ref)
    return {t: ref[t] for i, t in enumerate(ts)
            if 0 < i < len(ts) - 1 and abs(ref[t] - ref[ts[i - 1]]) < 8 and abs(ref[t] - ref[ts[i + 1]]) < 8}


def check(name, cond, detail):
    print(("PASS " if cond else "FAIL ") + name + ": " + detail)
    return cond


ok = True
for fname, max_first, max_err in (("strapped.json", 4.5, 3.0), ("placements_live.json", None, 3.0)):
    I = np.asarray(json.load(open(os.path.join(HERE, "testdata", fname)))["ir"], float)
    res, ref = service(I), reference(I)
    err = [abs(v - ref[t]) for t, v in res if v and t in ref]
    ok &= check(f"{fname} accuracy", err and np.mean(err) <= max_err,
                f"mean error {np.mean(err):.1f} bpm over {len(err)} ticks (limit {max_err})")
    if max_first:
        first = next((t for t, v in res if v), None)
        ok &= check(f"{fname} latency", first is not None and first <= max_first,
                    f"first reading at {first} s (limit {max_first})")
rng = np.random.default_rng(7)
noise = sum(sum(1 for _, v in service(130000 + rng.normal(0, s, 1000)) if v) for s in (5, 15, 40) * 10)
ok &= check("pure noise", noise <= 3, f"heart rate shown on {noise} of 1200 ticks (limit 3)")
sys.exit(0 if ok else 1)
