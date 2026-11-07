#!/usr/bin/env python3
"""MAX30102 finger sensor on the Pi's I2C bus 1 (address 0x57): raw red/IR samples at 100 Hz, and heart rate from the
IR pulse wave using HeartPy (github.com/paulvangentcom/heartrate_analysis_python). Finger presence = IR DC level.
SpO2 is not reported: the sensor is uncalibrated and its ratio-of-ratios swung 85-100 % on one still recording.

  python3 max30102.py [seconds]     prints one JSON line per second
"""
import json, sys, time, warnings
import heartpy as hp
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


def bandpass(x):
    return hp.filter_signal(np.asarray(x, float), cutoff=[0.7, 3.5], sample_rate=FS, order=3, filtertype="bandpass")


def estimate(ir):
    """Heart rate from the last 3-4 s of IR (finger on) -> {"hr": bpm or None, "why": reason or None, "ac": swing}.
    why: saturated (press lighter) | settling (finger placed/moved < 3 s ago) | noisy (no clear pulse).
    ac = pulse swing (std of the band-passed signal), so the caller can tell "moving" from "too weak" for this person.
    A rate needs (1) a pulse that clearly stands out: spectral peak >= 9x the median power. This is a ratio, so it
    holds for any LED current, skin or sensor; firm still fingers measured 9-42x, light/moving fingers and pure noise
    2-8x (2026-11-07). (2) two independent methods that agree within 15 %: HeartPy's beats and the strongest frequency."""
    ir = np.asarray(ir, float)
    if len(ir) and ir[-25:].max() > 0.95 * 0x3FFFF:             # 18-bit ADC full scale
        return {"hr": None, "why": "saturated", "ac": 0.0}
    jump = np.nonzero(np.abs(ir[10:] - ir[:-10]) > 0.01 * ir[-25:].mean())[0]   # > 1 % within 0.1 s
    x = (ir[jump[-1] + 11:] if len(jump) else ir)[-int(FS * 4):]
    if len(x) < FS * 3:
        return {"hr": None, "why": "settling", "ac": 0.0}
    y = bandpass(x)
    out = {"hr": None, "why": "noisy", "ac": float(y.std())}
    f = np.fft.rfftfreq(1024, 1 / FS)
    p = np.abs(np.fft.rfft(y * np.hanning(len(y)), 1024)) ** 2
    band = (f >= 0.7) & (f <= 3.5)
    if p[band].max() < 9 * np.median(p[band]):
        return out
    peak = f[band][np.argmax(p[band])] * 60
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            bpm = hp.process(hp.scale_data(y), sample_rate=FS)[1]["bpm"]
    except Exception:                                            # HeartPy raises when it finds no usable beats
        return out
    if 30 <= bpm <= 220 and abs(bpm - peak) <= 0.15 * peak:      # also false for NaN
        out.update(hr=int(round(bpm)), why=None)
    return out


if __name__ == "__main__":
    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 20
    m = Max30102()
    I = []
    end, nxt = time.time() + secs, time.time() + 1
    try:
        while time.time() < end:
            I = (I + [i for _, i in m.read()])[-600:]
            if time.time() >= nxt:
                nxt += 1
                print(json.dumps(dict(estimate(I), ir_dc=int(np.mean(I[-100:])) if I else 0)), flush=True)
            time.sleep(0.02)
    finally:
        m.close()
