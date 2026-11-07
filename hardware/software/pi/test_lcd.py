#!/usr/bin/env python3
"""Show a short demo on the optional I2C LCD1602 (relay add-on).

    python3 test_lcd.py                  # finds the LCD at 0x27 or 0x3F
    python3 test_lcd.py --address 0x3F   # force an address
Exit code 0 when the LCD answers, 1 otherwise.
"""

import argparse
import sys
import time

from lib import lcd1602


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--address", type=lambda s: int(s, 0), default=None,
                    help="I2C address, e.g. 0x27 (default: find it)")
    ap.add_argument("--seconds", type=float, default=10.0, help="how long to run (default 10)")
    args = ap.parse_args()

    print("HANDOFF relay - LCD1602 test")
    try:
        lcd, address = lcd1602.open_lcd(args.address)
    except lcd1602.LcdError as e:
        print(f"ERROR: {e}\n  -> {e.hint}")
        return 1

    print(f"LCD found at 0x{address:02X}. Showing a demo for {args.seconds:g} s (Ctrl-C to stop early)...")
    try:
        lcd.show("HANDOFF RELAY", f"LCD OK  0x{address:02X}")
        time.sleep(min(2.0, args.seconds))
        start, n = time.monotonic(), 0
        while time.monotonic() - start < args.seconds - 2.0:
            hr = 60 + (n * 7) % 30              # fake heart rate 60-89, changes each second
            lcd.show(*lcd1602.vitals_lines(hr, 97, "pulse", "connected"))
            n += 1
            time.sleep(1.0)
    except KeyboardInterrupt:
        pass
    finally:
        lcd.close()
    print("Done. Screen cleared and backlight off.")
    print("You should have seen HANDOFF RELAY, then 'HR nn  SpO2  97' with a changing number.")
    print("Backlight on but no letters? Turn the small blue screw on the back (contrast).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
