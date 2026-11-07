#!/usr/bin/env python3
"""Stream test: sensor readings -> JSON over WebSocket to the Mac at 25 Hz.

Start software/mac/receiver.py on the Mac first, then on the Pi:

    python3 stream_test.py 192.168.1.23              # the Mac's IP address
    python3 stream_test.py 192.168.1.23 --simulate   # no sensor needed

Messages (one JSON object per WebSocket text message):
  {"type": "hello", "device": "handoff-relay", "fs": 100, "rate_hz": 25, "simulate": false, "v": 1}
  {"type": "vitals", "seq": 17, "ts": 1234.567, "ir": 109876, "red": 79123,
   "hr": 72.1, "finger": true, "spo2_exp": 98.4, "status": "pulse", "n": 4}
  {"type": "button", "seq": 18, "ts": 1234.612, "event": "press" | "release" | "hold",
   "held_s": 0.21}
`ts` is device time: the Pi's monotonic clock in seconds. `ir`/`red` are the
mean of the `n` raw samples since the previous message. `hr` and `spo2_exp`
(EXPERIMENTAL) are null unless a beat was seen in the last 5 s; `status` says
why: "calibrating", "no finger", "saturated", "acquiring" (finger on, no fresh
pulse yet or any more) or "pulse" (hr is valid).

Link status is shown on the OLED and on the ring:
  blue pulsing = connecting, green = connected, 3 red flashes = error (then retry).
The connection is retried forever (1 s, 2 s, 4 s, then every 5 s).
"""

import argparse
import asyncio
import json
import socket
import sys
import time
from collections import deque

from lib import hw
from lib import max30101 as mx
from lib.dsp import PulseProcessor

try:
    from websockets.asyncio.client import connect      # websockets >= 13
except ImportError:
    try:
        from websockets import connect                  # older releases
    except ImportError:
        connect = None


class Link:
    """Shared state between the tasks."""

    def __init__(self, url):
        self.url = url
        self.ws = None
        self.status = "connecting"
        self.error = ""
        self.sent = 0
        self.seq = 0
        self.events = deque(maxlen=50)     # button events waiting to be sent
        self.wave = deque(maxlen=128)      # pulse waveform for the OLED, one point per tick
        self.stopping = False

    def next_seq(self):
        self.seq += 1
        return self.seq


def short(e):
    text = str(e) or type(e).__name__
    return text if len(text) < 90 else text[:87] + "..."


async def link_task(link, ring, hello):
    backoff = 1
    while True:
        link.status, link.error = "connecting", ""
        ring.pulse("blue")
        print(f"[link] connecting to {link.url} ...")
        try:
            async with connect(link.url, open_timeout=5, ping_interval=5, ping_timeout=5) as ws:
                await ws.send(json.dumps(hello))
                link.ws, link.status = ws, "connected"
                ring.set("green")
                backoff = 1
                print("[link] connected")
                async for _ in ws:      # the Mac sends nothing; this waits for a close
                    pass
                if link.stopping:
                    return
                raise ConnectionError("the Mac closed the connection")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            if link.stopping:
                return
            link.ws, link.status, link.error = None, "error", short(e)
            ring.blink("red", times=3)
            print(f"[link] error: {link.error} - retrying in {backoff} s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 5)


async def ticker_task(link, reader, proc, rate_hz, start):
    """At rate_hz: process new samples, then send button events and one vitals message."""
    loop = asyncio.get_running_loop()
    period = 1.0 / rate_hz
    next_t = loop.time()
    last_status = time.monotonic()
    calibrated_shown = False
    sent_at_status = 0
    while True:
        next_t += period
        delay = next_t - loop.time()
        if delay < -1.0:
            next_t = loop.time()        # fell far behind: don't burst to catch up
        await asyncio.sleep(max(0.0, delay))
        if reader.error:
            raise reader.error

        samples = []
        for sample in reader.drain():
            if sample is reader.GAP:        # FIFO overflowed: samples are missing
                proc.discontinuity()
            else:
                proc.add(*sample)
                samples.append(sample)
        link.wave.append(proc.wave)
        if not proc.calibrating and not calibrated_shown:
            calibrated_shown = True
            fd = proc.finger
            print(f"Calibrated: no-finger IR {fd.baseline:,.0f}, finger threshold {fd.on_level:,.0f}. "
                  "Put your finger on now.")
            for w in proc.calibration_warnings:
                print(f"  WARNING: {w}")
        now = time.monotonic()
        # Re-read every tick: both are None as soon as the pulse is not fresh.
        hr, spo2, status = proc.heart_rate(), proc.spo2(), proc.status()

        ws = link.ws
        if ws is None or link.stopping:
            continue
        msg = {
            "type": "vitals", "seq": link.next_seq(), "ts": round(now, 3),
            "ir": round(sum(s[1] for s in samples) / len(samples)) if samples else proc.ir,
            "red": round(sum(s[0] for s in samples) / len(samples)) if samples else proc.red,
            "hr": round(hr, 1) if hr else None,
            "finger": proc.present,
            "spo2_exp": round(spo2, 1) if spo2 else None,
            "status": status,
            "n": len(samples),
        }
        try:
            while link.events:
                await ws.send(json.dumps(link.events.popleft()))
            await ws.send(json.dumps(msg))
            link.sent += 1
        except Exception as e:      # ConnectionClosed etc.; link_task reconnects
            link.ws = None
            if not link.stopping:
                print(f"[link] send failed: {short(e)}")

        if now - last_status >= 5.0:
            rate = (link.sent - sent_at_status) / (now - last_status)
            sent_at_status, last_status = link.sent, now
            print(f"[{now - start:6.1f} s] {link.status} | sent {link.sent} msgs ({rate:.1f}/s) | "
                  f"{status} | HR {f'{hr:.0f}' if hr else '--'} | IR {msg['ir']:,}")


async def oled_task(device, link, proc, mac):
    from PIL import Image, ImageDraw

    from lib import oled
    small = oled.load_font(10)
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(0.3)
        img = Image.new("1", (oled.WIDTH, oled.HEIGHT))
        d = ImageDraw.Draw(img)
        d.text((0, 0), "HANDOFF STREAM", font=small, fill="white")
        status = {"connected": f"LINK  OK  #{link.sent}", "connecting": "LINK  connecting",
                  "error": "LINK  ERROR"}[link.status]
        d.text((0, 12), status, font=small, fill="white")
        d.text((0, 24), f"-> {mac}", font=small, fill="white")
        hr = proc.heart_rate()
        d.text((0, 36), f"HR {f'{hr:.0f}' if hr else '--'}  {proc.status()}",
               font=small, fill="white")
        pts = oled.scale_wave(list(link.wave), 0, 50, oled.WIDTH - 1, oled.HEIGHT - 1)
        if len(pts) > 1:
            d.line(pts, fill="white")
        await loop.run_in_executor(None, device.display, img)


async def lcd_task(lcd, link, proc):
    """Heart rate, oxygen, sensor status and link status on the optional LCD1602."""
    from lib import lcd1602
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(0.5)
        lines = lcd1602.vitals_lines(proc.heart_rate(), proc.spo2(), proc.status(), link.status)
        await loop.run_in_executor(None, lcd.show, *lines)


async def fake_button_task(link):
    """--simulate without a real button: a press every 12 s, every third one held."""
    k = 0
    while True:
        await asyncio.sleep(12)
        k += 1
        held = 2.0 if k % 3 == 0 else 0.3
        t0 = time.monotonic()
        link.events.append({"type": "button", "seq": link.next_seq(), "ts": round(t0, 3),
                            "event": "press", "sim": True})
        if held >= hw.HOLD_S:
            await asyncio.sleep(hw.HOLD_S)
            link.events.append({"type": "button", "seq": link.next_seq(),
                                "ts": round(time.monotonic(), 3), "event": "hold", "sim": True})
        await asyncio.sleep(held - (hw.HOLD_S if held >= hw.HOLD_S else 0))
        link.events.append({"type": "button", "seq": link.next_seq(), "ts": round(time.monotonic(), 3),
                            "event": "release", "held_s": round(time.monotonic() - t0, 2), "sim": True})
        print(f"[button] simulated {'hold' if held >= hw.HOLD_S else 'press'}")


def make_button(link, ring):
    pressed_at = [None]

    def show_link():
        if link.status == "connected":
            ring.set("green")
        else:
            ring.pulse("blue")

    def event(name, **extra):
        ev = {"type": "button", "seq": link.next_seq(), "ts": round(time.monotonic(), 3),
              "event": name, **extra}
        link.events.append(ev)          # deque.append is thread-safe
        print(f"[button] {name}" + (f" ({extra['held_s']} s)" if extra else ""))

    def on_press():
        pressed_at[0] = time.monotonic()
        ring.set("white")
        event("press")

    def on_held():
        event("hold")

    def on_release():
        held = round(time.monotonic() - pressed_at[0], 2) if pressed_at[0] else 0.0
        event("release", held_s=held)
        show_link()

    button, err = hw.open_button(on_press, on_release, on_held)
    return button, err


async def main_async(args):
    url = f"ws://{args.mac}:{args.port}"
    print(f"HANDOFF relay - stream test -> {url}"
          + ("  [SIMULATED SENSOR]" if args.simulate else ""))

    if args.simulate:
        from lib.simbus import SimulatedMax30101Bus
        sensor = mx.Max30101(SimulatedMax30101Bus())
    else:
        sensor = mx.Max30101(1)
    sensor.check_part_id()
    fs = sensor.setup_spo2(sample_rate=100, sample_avg=1, pulse_width_us=411,
                           adc_range_na=4096, red_ma=args.led_ma, ir_ma=args.led_ma)
    proc = PulseProcessor(fs=fs)
    reader = mx.SensorReader(sensor)
    reader.start()
    print("Keep your finger OFF the sensor for 2 s (calibrating) ...")

    link = Link(url)
    ring = hw.Ring(enabled=not args.no_gpio)
    button = None
    tasks = []
    device = None
    lcd = None
    try:
        if not args.no_gpio:
            button, err = make_button(link, ring)
            if not ring.ok or button is None:
                print(f"(ring/button not used: {ring.error or err})")
        if not args.no_oled:
            from lib import oled
            try:
                device, address = oled.open_oled()
                print(f"OLED at 0x{address:02X} shows the link status.")
            except (oled.OledError, ImportError) as e:
                print(f"(No OLED - fine, the screen is optional: {e})")
        if not args.no_lcd:
            from lib import lcd1602
            try:
                lcd, address = lcd1602.open_lcd()
                print(f"LCD at 0x{address:02X} shows heart rate, oxygen and the link status.")
            except lcd1602.LcdError as e:
                print(f"(No LCD - fine, the screen is optional: {e})")

        hello = {"type": "hello", "device": socket.gethostname(), "fs": fs,
                 "rate_hz": args.rate, "simulate": args.simulate, "v": 1}
        start = time.monotonic()
        tasks = [asyncio.create_task(link_task(link, ring, hello)),
                 asyncio.create_task(ticker_task(link, reader, proc, args.rate, start))]
        if device:
            tasks.append(asyncio.create_task(oled_task(device, link, proc, args.mac)))
        if lcd:
            tasks.append(asyncio.create_task(lcd_task(lcd, link, proc)))
        if args.simulate and button is None:
            print("(no real button: sending a simulated MARK press every 12 s)")
            tasks.append(asyncio.create_task(fake_button_task(link)))
        done, _ = await asyncio.wait(tasks, timeout=args.seconds or None,
                                     return_when=asyncio.FIRST_EXCEPTION)
        for t in done:
            t.result()      # re-raise a crashed task's error
    finally:
        link.stopping = True
        if link.ws is not None:         # close cleanly (code 1000) before cancelling
            try:
                await asyncio.wait_for(link.ws.close(), 2.0)
            except Exception:
                pass
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        reader.stop()
        sensor.shutdown()
        sensor.close()
        if button:
            button.close()
        ring.close()
        if device:
            device.clear()
        if lcd:
            try:
                lcd.close()
            except OSError:
                pass
        print(f"Stopped. Sent {link.sent} vitals messages. Sensor LEDs and ring off.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("mac", help="the Mac's IP address (receiver.py prints it)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--rate", type=float, default=25.0, help="messages per second (default 25)")
    ap.add_argument("--simulate", action="store_true", help="use a simulated sensor")
    ap.add_argument("--no-oled", action="store_true", help="don't use the OLED")
    ap.add_argument("--no-lcd", action="store_true", help="don't use the LCD1602")
    ap.add_argument("--no-gpio", action="store_true", help="don't use the button or ring")
    ap.add_argument("--led-ma", type=float, default=6.2, help="LED current in mA (default 6.2)")
    ap.add_argument("--seconds", type=float, default=0, help="stop after N seconds (default: Ctrl-C)")
    args = ap.parse_args()

    if connect is None:
        print("ERROR: the 'websockets' package is missing.\n"
              "  -> source ~/handoff-venv/bin/activate (or run setup_pi.sh)")
        return 1
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass
    except mx.SensorError as e:
        print(f"ERROR: {e}\n  -> {e.hint}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
