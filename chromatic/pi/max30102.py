#!/usr/bin/env python3
"""MAX30102 finger sensor on the Pi's I2C bus 1 (address 0x57): raw red/IR samples at 100 Hz, plus a simple
heart-rate (peak intervals on the IR pulse wave) and SpO2 estimate (ratio of ratios, UNCALIBRATED: hobby sensor,
textbook curve 110 - 25 R). Finger presence = IR DC level. numpy only.

  python3 max30102.py [seconds]     prints one JSON line per second
"""
import json, sys, time
import numpy as np
import smbus

ADDR = 0x57
FS = 100.0                      # 400 Hz sampling, 4-sample averaging


class Max30102:
    def __init__(self, bus=1, led=0x24):
        self.b = smbus.SMBus(bus)
        if self.b.read_byte_data(ADDR, 0xFF) != 0x15:
            raise IOError("MAX30102 not found at 0x57")
        self.w(0x09, 0x40)                      # reset
        time.sleep(0.05)
        self.w(0x02, 0x00); self.w(0x03, 0x00)  # no interrupts
        self.w(0x04, 0); self.w(0x05, 0); self.w(0x06, 0)
        self.w(0x08, 0x5F)                      # SMP_AVE=4, rollover on, almost-full 15
        self.w(0x0A, 0x2F)                      # ADC 4096 nA, 400 sps, 411 us (18 bit)
        self.w(0x0C, led); self.w(0x0D, led)    # red / IR LED current (~7 mA)
        self.w(0x09, 0x03)                      # SpO2 mode (red + IR)

    def w(self, r, v):
        self.b.write_byte_data(ADDR, r, v)

    def read(self):
        """All samples waiting in the FIFO -> list of (red, ir)."""
        wr = self.b.read_byte_data(ADDR, 0x04); rd = self.b.read_byte_data(ADDR, 0x06)
        n = (wr - rd) & 0x1F
        out = []
        while n > 0:
            k = min(n, 5)
            d = self.b.read_i2c_block_data(ADDR, 0x07, 6 * k)
            for i in range(k):
                s = d[6 * i:6 * i + 6]
                red = ((s[0] << 16) | (s[1] << 8) | s[2]) & 0x3FFFF
                ir = ((s[3] << 16) | (s[4] << 8) | s[5]) & 0x3FFFF
                out.append((red, ir))
            n -= k
        return out

    def close(self):
        try:
            self.w(0x09, 0x80)                  # shutdown (LEDs off)
        except OSError:
            pass


# Band-pass 0.6-3.3 Hz (2nd-order Butterworth at 100 Hz, coefficients from scipy.signal.butter), zero-phase.
_B = np.array([0.0064121937, 0.0, -0.0128243875, 0.0, 0.0064121937])
_A = np.array([1.0, -3.7463240505, 5.2810708561, -3.3213905511, 0.7866981284])


def _lfilter(x):
    y = np.zeros_like(x)
    for n in range(len(x)):
        acc = 0.0
        for k in range(5):
            if n - k >= 0:
                acc += _B[k] * x[n - k]
                if k:
                    acc -= _A[k] * y[n - k]
        y[n] = acc
    return y


def bandpass(x):
    x = np.asarray(x, float)
    x = x - x.mean()
    pad = min(len(x) - 2, 150)
    xp = np.concatenate([2 * x[0] - x[pad:0:-1], x, 2 * x[-1] - x[-2:-pad - 2:-1]])   # odd reflection, like filtfilt
    y = _lfilter(_lfilter(xp)[::-1])[::-1]
    return y[pad:pad + len(x)]


def estimate(red, ir, finger_dc=30000):
    """red, ir: last ~8 s of samples. Heart rate from the autocorrelation of the band-passed IR pulse wave (robust to
    single missed/extra beats); SpO2 from the ratio of ratios (AC = std of the band-passed signal) on Maxim's curve,
    UNCALIBRATED. Windows with motion / finger settling (IR swing > 8 % of DC) are rejected."""
    red = np.asarray(red, float); ir = np.asarray(ir, float)
    finger = bool(len(ir) >= 50 and ir[-50:].mean() > finger_dc)
    out = {"finger": finger, "hr": None, "spo2": None, "q": 0}
    if not finger or len(ir) < FS * 5:
        return out
    if (ir.max() - ir.min()) > 0.08 * ir.mean():
        out["q"] = -1                                        # motion / settling
        return out
    xi, xr = bandpass(ir), bandpass(red)
    s = xi - xi.mean()
    ac = np.correlate(s, s, "full")[len(s) - 1:]
    if ac[0] <= 0:
        return out
    ac = ac / ac[0]
    lo, hi = int(FS * 0.33), int(FS * 1.5)                   # 40-180 bpm
    seg = ac[lo:hi]
    peaks = [i for i in range(1, len(seg) - 1) if seg[i] >= seg[i - 1] and seg[i] > seg[i + 1]]
    if not peaks:
        return out
    best = max(seg[i] for i in peaks)
    if best <= 0:
        return out
    k =lo + min(i for i in peaks if seg[i] >= 0.85 * best)   # first strong peak = one beat (not two)
    out["q"] = round(float(ac[k]), 2)
    if ac[k] >= 0.45:
        out["hr"] = int(round(60.0 * FS / k))
        R = (np.std(xr) / red.mean()) / (np.std(xi) / ir.mean())
        out["spo2"] = int(round(min(100.0, max(70.0, -45.06 * R * R + 30.354 * R + 94.845))))
    return out


if __name__ == "__main__":
    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 20
    m = Max30102()
    R, I = [], []
    end, nxt = time.time() + secs, time.time() + 1
    try:
        while time.time() < end:
            for r, i in m.read():
                R.append(r); I.append(i)
            R, I = R[-800:], I[-800:]
            if time.time() >= nxt:
                nxt += 1
                e = estimate(R, I)
                e.update(ir_dc=int(np.mean(I[-100:])) if I else 0, red_dc=int(np.mean(R[-100:])) if R else 0, n=len(I))
                print(json.dumps(e), flush=True)
            time.sleep(0.02)
    finally:
        m.close()
