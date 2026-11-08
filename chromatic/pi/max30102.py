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
WIN = int(FS * 4)               # samples analysed per estimate


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
        """Returns every sample waiting in the FIFO as a list of (red, ir)."""
        wr = self.b.read_byte_data(ADDR, 0x04); rd = self.b.read_byte_data(ADDR, 0x06)
        self.lost = self.b.read_byte_data(ADDR, 0x05)    # samples dropped: we read later than the 32-sample FIFO lasts
        n = (wr - rd) & 0x1F or (32 if self.lost else 0)
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
    """Heart rate from the last 3-4 s of IR with a finger on. Returns {"hr", "why", "ac"}.
    hr is the rate or None. why is None or the reason there is no rate: "saturated" (press lighter), "settling"
    (the finger moved less than 3 s ago) or "noisy" (no clear pulse). ac is the pulse swing, which lets the caller
    tell a moving finger from a weak one for this person.
    A rate needs a pulse whose spectral peak is at least 9x the median power. That is a ratio, so it holds for any
    LED current, skin or sensor: firm, still fingers measured 9-42x, light or moving fingers and pure noise 2-8x.
    HeartPy's beat count and the strongest frequency must also agree within 15 %."""
    ir = np.asarray(ir, float)
    if len(ir) and ir[-25:].max() > 0.95 * 0x3FFFF:             # 18-bit ADC full scale
        return {"hr": None, "why": "saturated", "ac": 0.0}
    jump = np.nonzero(np.abs(ir[10:] - ir[:-10]) > 0.01 * ir[-25:].mean())[0]   # > 1 % within 0.1 s
    x = (ir[jump[-1] + 11:] if len(jump) else ir)[-WIN:]
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


def shown(recent, hist, hr):
    """The number to display from one estimate per 0.25 s tick, or None while it is not trusted yet.
    The caller keeps the two lists: the first value needs 3 estimates in a row agreeing within 10 %, then 2;
    the value shown is the median of the last 8 accepted (2 s). Used by pi_oximeter.py and test_sensor.py."""
    recent[:] = (recent + [hr])[-3:]
    need = recent if not hist else recent[-2:]
    if not (all(need) and len(need) >= (2 if hist else 3) and max(need) - min(need) <= 0.1 * min(need)):
        return None
    hist[:] = (hist + [hr])[-8:]
    return sorted(hist)[len(hist) // 2]


if __name__ == "__main__":
    # python3 max30102.py [secs]               one estimate per second
    # python3 max30102.py record SECS FILE     raw red/IR samples for test_sensor.py's testdata/ (stop the service first)
    rec = sys.argv[1:2] == ["record"]
    secs = float(sys.argv[2 if rec else 1]) if len(sys.argv) > (2 if rec else 1) else 20
    m = Max30102()
    R, I = [], []
    end, nxt = time.time() + secs, time.time() + 1
    try:
        while time.time() < end:
            for r, i in m.read():
                R.append(r); I.append(i)
            if not rec and time.time() >= nxt:
                nxt += 1
                print(json.dumps(dict(estimate(I[-600:]), ir_dc=int(np.mean(I[-100:])) if I else 0)), flush=True)
            time.sleep(0.02)
    finally:
        m.close()
    if rec:
        json.dump({"red": R, "ir": I}, open(sys.argv[3], "w"))
        print(f"saved {len(I)} samples to {sys.argv[3]}")
