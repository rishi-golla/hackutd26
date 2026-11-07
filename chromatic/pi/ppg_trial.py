#!/usr/bin/env python3
"""Sensor reliability trials (Pi). Stops nothing itself: run with the cmx-oximeter service stopped.

  python3 ppg_trial.py sweep [settle=3] [secs=12]      LED current sweep with the finger held still
  python3 ppg_trial.py watch <secs> [led=0x24] [label]  record one condition (e.g. light / firm pressure)

Per condition it prints: IR/red DC (ADC counts, 18-bit full scale 262143), perfusion index PI = AC/DC % (pulse
strength), autocorrelation quality q (0..1; >= 0.45 is usable), the % of 1-s updates that produced a heart rate,
the HR values, and saves the raw samples to ~/trial_<label>.json for offline analysis.
"""
import json, sys, time
import numpy as np
from max30102 import Max30102, estimate, bandpass, FS


def record(m, secs):
    R, I = [], []
    end = time.time() + secs
    while time.time() < end:
        for r, i in m.read():
            R.append(r); I.append(i)
        time.sleep(0.02)
    return np.array(R, float), np.array(I, float)


def score(R, I, label, led):
    res = {"label": label, "led": hex(led), "n": len(I)}
    if len(I) < FS * 6:
        res["err"] = "too few samples"; return res
    res["ir_dc"], res["red_dc"] = int(I.mean()), int(R.mean())
    res["sat"] = bool(I.max() > 250000 or R.max() > 250000)
    xi = bandpass(I)
    res["pi_ir_%"] = round(100 * float(np.std(xi)) * 2.83 / I.mean(), 3)     # ~p2p of a sine from std
    hrs, qs = [], []
    for end in range(int(FS * 5), len(I) + 1, int(FS)):                      # replay 1-s updates on 8-s windows
        e = estimate(R[max(0, end - 800):end], I[max(0, end - 800):end])
        qs.append(e["q"]); hrs.append(e["hr"])
    ok = [h for h in hrs if h]
    res["valid_%"] = round(100 * len(ok) / max(1, len(hrs)))
    res["q_med"] = round(float(np.median(qs)), 2) if qs else None
    res["hr"] = ok
    res["hr_spread"] = (max(ok) - min(ok)) if ok else None
    return res


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "sweep"
    m = Max30102()
    try:
        if mode == "sweep":
            settle = float(sys.argv[2]) if len(sys.argv) > 2 else 3
            secs = float(sys.argv[3]) if len(sys.argv) > 3 else 12
            out = []
            for led in (0x0C, 0x18, 0x24, 0x3C, 0x5A, 0x7F):                # ~2.4 .. 25 mA
                m.w(0x0C, led); m.w(0x0D, led)
                record(m, settle)                                           # let the AGC-less front end settle
                R, I = record(m, secs)
                r = score(R, I, f"led{led:02x}", led)
                json.dump({"red": R.tolist(), "ir": I.tolist(), "led": led}, open(f"/home/cmx/trial_led{led:02x}.json", "w"))
                print(json.dumps(r), flush=True)
                out.append(r)
            best = max(out, key=lambda r: (r.get("valid_%", 0), r.get("q_med") or 0, -(r.get("hr_spread") or 99)))
            print(json.dumps({"best": best["led"], "valid_%": best.get("valid_%"), "q_med": best.get("q_med")}), flush=True)
        else:
            secs = float(sys.argv[2]); led = int(sys.argv[3], 16) if len(sys.argv) > 3 else 0x24
            label = sys.argv[4] if len(sys.argv) > 4 else "watch"
            m.w(0x0C, led); m.w(0x0D, led)
            R, I = record(m, secs)
            json.dump({"red": R.tolist(), "ir": I.tolist(), "led": led}, open(f"/home/cmx/trial_{label}.json", "w"))
            print(json.dumps(score(R, I, label, led)), flush=True)
    finally:
        m.close()


if __name__ == "__main__":
    main()
