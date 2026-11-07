#!/usr/bin/env python3
"""OLED test: finds the screen at 0x3D/0x3C and shows a fake heart-rate demo.

Draws "HANDOFF RELAY", a made-up heart rate and a moving pulse waveform for
10 seconds, then clears the screen.

    python3 test_oled.py                # auto-detect the address
    python3 test_oled.py --address 0x3C
"""

import argparse
import random
import sys
import time

from PIL import Image, ImageDraw

from lib import oled
from lib.dsp import BandPass, PpgSimulator


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--address", type=lambda s: int(s, 0), help="force 0x3D or 0x3C")
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--snapshot", metavar="PNG", help="also save the last frame as a PNG")
    args = ap.parse_args()

    print("HANDOFF relay - OLED test")
    try:
        device, address = oled.open_oled(args.address)
    except oled.OledError as e:
        print(f"ERROR: {e}\n  -> {e.hint}")
        return 1
    print(f"OLED found at 0x{address:02X}. Drawing for {args.seconds:g} s (Ctrl-C to stop early)...")

    fonts = (oled.load_font(10), oled.load_font(24))
    fs = 100.0
    sim = PpgSimulator(fs=fs, bpm=72, finger=lambda t: True)
    bp = BandPass(fs, 0.5, 4.0)
    bp.reset(sim.sample()[1])
    wave = []
    hr = 72
    frames = 0
    k = 0
    pending = 0.0
    img = Image.new("1", (oled.WIDTH, oled.HEIGHT))
    start = last = time.monotonic()
    next_hr = start + 1.0
    try:
        while time.monotonic() - start < args.seconds:
            now = time.monotonic()
            # Advance the fake pulse by the real time that passed; keep every
            # 4th sample, so the 128-pixel-wide plot shows about 5 seconds.
            pending += (now - last) * fs
            last = now
            while pending >= 1.0:
                pending -= 1.0
                v = -bp.process(sim.sample()[1])
                k += 1
                if k % 4 == 0:
                    wave.append(v)
            wave = wave[-oled.WIDTH:]
            if now >= next_hr:
                hr = max(60, min(90, hr + random.choice((-1, 0, 1))))
                next_hr += 1.0
            img.paste(0, (0, 0, oled.WIDTH, oled.HEIGHT))
            draw = ImageDraw.Draw(img)
            oled.draw_vitals(draw, fonts, "HANDOFF RELAY", f"{hr}", "bpm\n(fake)", wave,
                             status=f"0x{address:02X}")
            device.display(img)
            frames += 1
            time.sleep(max(0.0, 1 / 15 - (time.monotonic() - now)))   # at most 15 frames/s
    except KeyboardInterrupt:
        print("\nStopped early.")
    elapsed = time.monotonic() - start
    if args.snapshot:
        img.save(args.snapshot)
        print(f"Saved the last frame to {args.snapshot}")
    device.clear()
    print(f"Done: {frames} frames in {elapsed:.1f} s ({frames / elapsed:.1f} frames/s). Screen cleared.")
    print('You should have seen "HANDOFF RELAY", a heart rate and a moving wave.')
    return 0


if __name__ == "__main__":
    sys.exit(main())
