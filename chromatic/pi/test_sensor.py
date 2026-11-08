#!/usr/bin/env python3
"""Replays real recordings (testdata/) through the same logic as pi_oximeter.py and fails if the sensor got worse.
Run it on the Pi with `python3 test_sensor.py`. deploy.sh runs it before restarting anything.

The reference rate is the dominant frequency over 8 s, used only where it is unambiguous, so it is independent of
the method under test. Results on 2026-11-07: strapped first reading 4.0 s, mean error 1.1 bpm (strapped) and
1.4 bpm (live), noise shown on 1 of 1200 ticks.
"""
import json, os, sys
import numpy as np
from scipy.signal import butter, filtfilt
from max30102 import estimate, shown, spo2, steady_spo2, FS, WIN

HERE = os.path.dirname(os.path.abspath(__file__))


def service(R, I):
    """pi_oximeter's loop: every 0.25 s an estimate on the last 4 s, turned into a shown rate by the same rule, and
    SpO2 while a rate is shown. Returns (time, rate, spo2) per tick."""
    recent, hist, o2s, out = [], [], [], []
    for end in range(25, len(I) + 1, 25):
        hr = None
        if np.mean(I[end - 10:end]) >= 40000:
            hr = shown(recent, hist, estimate(I[max(0, end - WIN):end])["hr"])
        else:
            recent, hist = [], []
        if not hr:
            o2s = []
        o2 = steady_spo2(o2s, spo2(R[max(0, end - WIN):end], I[max(0, end - WIN):end])) if hr else None
        out.append((end / FS, hr, o2))
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
    cond = bool(cond)
    print(("PASS " if cond else "FAIL ") + name + ": " + detail)
    return cond


ok = True
for fname, max_first, max_err in (("strapped.json", 4.5, 3.0), ("placements_live.json", None, 3.0)):
    d = json.load(open(os.path.join(HERE, "testdata", fname)))
    R, I = np.asarray(d["red"], float), np.asarray(d["ir"], float)
    res, ref = service(R, I), reference(I)
    err = [abs(v - ref[t]) for t, v, _ in res if v and t in ref]
    o2 = [o for _, _, o in res if o]
    ok &= check(f"{fname} SpO2", all(o >= 95 for o in o2) and (o2 or fname == "strapped.json"),
                f"{len(o2)} readings, range {min(o2, default=None)}-{max(o2, default=None)} (healthy at rest: 95-100)")
    ok &= check(f"{fname} accuracy", err and np.mean(err) <= max_err,
                f"mean error {np.mean(err):.1f} bpm over {len(err)} ticks (limit {max_err})")
    if max_first:
        first = next((t for t, v, _ in res if v), None)
        ok &= check(f"{fname} latency", first is not None and first <= max_first,
                    f"first reading at {first} s (limit {max_first})")
rng = np.random.default_rng(7)
runs = [service(110000 + rng.normal(0, s, 1000), 130000 + rng.normal(0, s, 1000)) for s in (5, 15, 40) * 10]
noise = sum(1 for r in runs for _, v, _ in r if v)
noise_o2 = sum(1 for r in runs for _, _, o in r if o)
ok &= check("pure noise", noise <= 3 and noise_o2 == 0,
            f"heart rate shown on {noise} of 1200 ticks (limit 3), SpO2 on {noise_o2} (limit 0)")
sys.exit(0 if ok else 1)
