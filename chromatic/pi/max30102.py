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


def estimate(ir, finger_dc=30000):
    """Heart rate from the IR signal since the finger last moved (3-4 s), or None.
    q = how well the signal repeats at that rate (autocorrelation, 1 = perfect); -1 = finger just placed or moving.
    Pure noise also gives HeartPy a "rate", so a reading needs q >= 0.6 (real pulses 0.6-0.97 on the recording)."""
    ir = np.asarray(ir, float)
    out = {"hr": None, "q": 0}
    if len(ir) < 25 or ir[-25:].mean() < finger_dc:
        return out
    jump = np.nonzero(np.abs(ir[10:] - ir[:-10]) > 0.01 * ir[-25:].mean())[0]   # > 1 % within 0.1 s
    x = (ir[jump[-1] + 11:] if len(jump) else ir)[-int(FS * 4):]
    if len(x) < FS * 3:
        out["q"] = -1 if len(jump) else 0
        return out
    y = bandpass(x)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            bpm = hp.process(hp.scale_data(y), sample_rate=FS)[1]["bpm"]
    except Exception:                                   # HeartPy raises when it finds no usable beats
        return out
    if not 30 <= bpm <= 220:                            # also false for NaN
        return out
    lag, z = int(round(60 * FS / bpm)), y - y.mean()
    out["q"] = round(float(np.dot(z[:-lag], z[lag:]) / np.dot(z, z) * len(z) / (len(z) - lag)), 2)
    if out["q"] >= 0.6:
        out["hr"] = int(round(bpm))
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
