#!/usr/bin/env python3
"""MAX30101 test: part ID, raw red/IR, finger detection, heart rate, SpO2.

Starts with a 2-second calibration with NO finger on the sensor, then prints
one line per second. Heart rate is recomputed every 2 s from IR pulse peaks.
SpO2 is EXPERIMENTAL (uncalibrated; never use it on a patient).

    python3 test_max30101.py               # Ctrl-C to stop
    python3 test_max30101.py --oled        # also show HR + waveform on the OLED
    python3 test_max30101.py --lcd         # also show HR, SpO2 and status on the LCD1602
    python3 test_max30101.py --simulate    # no sensor needed (fake finger)
"""

import argparse
import sys
import time

from lib import max30101 as mx
from lib.dsp import PulseProcessor


def fmt(v, width=7):
    return f"{v:>{width},}" if v is not None else f"{'--':>{width}}"


def open_display(enabled):
    if not enabled:
        return None
    from lib import oled
    try:
        device, address = oled.open_oled()
    except oled.OledError as e:
        print(f"(OLED not used: {e}. {e.hint})")
        return None
    print(f"OLED at 0x{address:02X} shows heart rate and waveform.")
    return device


def draw_display(device, fonts, proc, wave):
    from PIL import Image, ImageDraw

    from lib import oled
    img = Image.new("1", (oled.WIDTH, oled.HEIGHT))
    draw = ImageDraw.Draw(img)
    hr = proc.heart_rate()      # None (shown as --) unless the pulse is fresh
    oled.draw_vitals(draw, fonts, "HANDOFF RELAY", f"{hr:.0f}" if hr else "--",
                     f"bpm\n{oled.STATUS_LABELS[proc.status()]}", wave)
    device.display(img)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--oled", action="store_true", help="show HR and waveform on the OLED")
    ap.add_argument("--lcd", action="store_true", help="show HR, SpO2 and status on the LCD1602")
    ap.add_argument("--simulate", action="store_true", help="use a simulated sensor")
    ap.add_argument("--seconds", type=float, default=0, help="stop after N seconds (default: Ctrl-C)")
    ap.add_argument("--led-ma", type=float, default=6.2,
                    help="LED current in mA for red and IR (default 6.2; 0-51)")
    args = ap.parse_args()

    print(f"HANDOFF relay - MAX30101 test (bus 1, address 0x{mx.I2C_ADDRESS:02X})"
          + ("  [SIMULATED SENSOR]" if args.simulate else ""))
    try:
        if args.simulate:
            from lib.simbus import SimulatedMax30101Bus
            sensor = mx.Max30101(SimulatedMax30101Bus())
        else:
            sensor = mx.Max30101(1)
        pid = sensor.check_part_id()
        rev = sensor.revision()
        sensor.reset()
        temp = sensor.read_temperature()
        print(f"PART_ID 0x{pid:02X} - MAX30101 OK (revision 0x{rev:02X})"
              + (f", die temperature {temp:.1f} C" if temp is not None else ""))
        fs = sensor.setup_spo2(sample_rate=100, sample_avg=1, pulse_width_us=411,
                               adc_range_na=4096, red_ma=args.led_ma, ir_ma=args.led_ma)
    except mx.SensorError as e:
        print(f"ERROR: {e}\n  -> {e.hint}")
        return 1
    amp = mx.led_amplitude_byte(args.led_ma) * mx.LED_MA_PER_STEP
    print(f"Config: SpO2 mode (red + IR), {fs:g} samples/s, 411 us pulses (18-bit), "
          f"ADC range 4096 nA, LED current {amp:.1f} mA")

    device = open_display(args.oled)
    fonts = None
    if device:
        from lib import oled
        fonts = (oled.load_font(10), oled.load_font(24))
    lcd = None
    if args.lcd:
        from lib import lcd1602
        try:
            lcd, address = lcd1602.open_lcd()
            print(f"LCD at 0x{address:02X} shows heart rate, oxygen and status.")
        except lcd1602.LcdError as e:
            print(f"(LCD not used: {e}. {e.hint})")
    next_lcd = 0.0

    proc = PulseProcessor(fs=fs)
    reader = mx.SensorReader(sensor)
    reader.start()
    print("Calibrating: keep your finger OFF the sensor for 2 s ...")

    wave = []
    k = 0
    hr = spo2 = None
    calibrated_shown = False
    start = time.monotonic()
    next_print = start + 1.0
    next_hr = start + 2.0
    next_draw = start
    no_pulse_since = None
    try:
        while not args.seconds or time.monotonic() - start < args.seconds:
            time.sleep(0.05)
            if reader.error:
                raise reader.error
            for sample in reader.drain():
                if sample is reader.GAP:        # FIFO overflowed: samples are missing
                    proc.discontinuity()
                    continue
                proc.add(*sample)
                k += 1
                if k % 4 == 0:
                    wave.append(proc.wave)
            wave = wave[-128:]

            if not proc.calibrating and not calibrated_shown:
                calibrated_shown = True
                fd = proc.finger
                print(f"  no-finger IR level {fd.baseline:,.0f} (noise {fd.noise:,.0f}); "
                      f"finger threshold {fd.on_level:,.0f}")
                for w in proc.calibration_warnings:
                    print(f"  WARNING: {w}")
                print("Now rest your fingertip on the sensor window. Keep still. Ctrl-C to stop.\n")
                print("    time       IR      red  finger     HR  SpO2*")

            now = time.monotonic()
            if now >= next_hr:
                next_hr += 2.0
                hr, spo2 = proc.heart_rate(), proc.spo2()
                if proc.present and hr is None:
                    no_pulse_since = no_pulse_since or now
                else:
                    no_pulse_since = None
            if now >= next_print:
                next_print += 1.0
                if calibrated_shown:
                    finger = "SAT" if proc.saturated else ("YES" if proc.present else "no")
                    fresh = proc.status() == "pulse"    # never show a value after its pulse is gone
                    print(f"{now - start:>6.1f} s {fmt(proc.ir, 8)} {fmt(proc.red, 8)} {finger:>7} "
                          f"{fmt(round(hr) if hr and fresh else None, 6)} "
                          f"{fmt(round(spo2) if spo2 and fresh else None, 5)}")
                    if proc.saturated:
                        print("  WARNING: reading saturated - lower --led-ma (e.g. 3)")
                    if no_pulse_since and now - no_pulse_since > 8:
                        print("  (no clear pulse: keep still and press lightly - pressing hard "
                              "squeezes the blood out)")
                        no_pulse_since = now
            if device and now >= next_draw:
                next_draw = now + 0.15
                draw_display(device, fonts, proc, wave)
            if lcd and now >= next_lcd:
                next_lcd = now + 0.5
                from lib import lcd1602
                lcd.show(*lcd1602.vitals_lines(proc.heart_rate(), proc.spo2(), proc.status()))
    except KeyboardInterrupt:
        pass
    except OSError as e:
        print(f"\nERROR: I2C read failed ({e}).\n  -> Re-seat the Qwiic cables and run i2c_scan.py.")
    finally:
        reader.stop()
        sensor.shutdown()
        sensor.close()
        if device:
            device.clear()
        if lcd:
            try:
                lcd.close()
            except OSError:
                pass
    elapsed = time.monotonic() - start
    print("\n* SpO2 is EXPERIMENTAL: uncalibrated, not a medical measurement.")
    print(f"Stopped after {elapsed:.1f} s: {reader.total:,} samples ({reader.total / elapsed:.1f}/s), "
          f"{reader.lost} lost to FIFO overflow. Sensor LEDs off.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
