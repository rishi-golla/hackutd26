#!/usr/bin/env python3
"""MARK button + light ring test (gpiozero).

Wiring (build spec section 3):
  button:  pin 11 (GPIO17) <-> switch <-> pin 9 (GND), internal pull-up
  ring:    + (common anode) on pin 17 (3.3 V); R/G/B -> 220 ohm -> pins 15/16/18
           (GPIO22/23/24). A colour lights when its pin goes LOW.

Part 1 cycles red, green, blue, white, amber (2 s each) so you can judge
brightness. Part 2 reports press / release / hold (>= 1.5 s) until Ctrl-C.
The ring is always left OFF on exit.

    python3 test_button.py
    python3 test_button.py --skip-colours
"""

import argparse
import sys
import time

from lib import hw


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--rounds", type=int, default=2, help="colour-cycle rounds (default 2)")
    ap.add_argument("--skip-colours", action="store_true", help="go straight to the button part")
    ap.add_argument("--seconds", type=float, default=0, help="end part 2 after N seconds")
    args = ap.parse_args()

    print("HANDOFF relay - MARK button + light ring test")
    ring = hw.Ring()
    if not ring.ok:
        print(f"ERROR: could not open the ring LED pins: {ring.error}")
        print("  -> Run this on the Pi with the venv active (source ~/handoff-venv/bin/activate);")
        print("     make sure no other script is running (it would hold the pins).")
        return 1

    start = time.monotonic()
    pressed_at = [None]

    def stamp():
        return f"[{time.monotonic() - start:7.2f} s]"

    def on_press():
        pressed_at[0] = time.monotonic()
        ring.set("green")
        print(f"{stamp()} PRESS")

    def on_held():
        ring.set("blue")
        print(f"{stamp()} HOLD (held >= {hw.HOLD_S} s)")

    def on_release():
        ring.off()
        held = time.monotonic() - pressed_at[0] if pressed_at[0] else 0.0
        print(f"{stamp()} RELEASE after {held:.2f} s")

    button = None
    try:
        if not args.skip_colours:
            print("\nPart 1 - colours, 2 s each. Note how bright each one looks:")
            for r in range(args.rounds):
                for name in ("red", "green", "blue", "white", "amber"):
                    print(f"  round {r + 1}: {name}")
                    ring.set(name)
                    time.sleep(2.0)
            ring.off()
            print("  If green and blue are much dimmer than red: expected with 220 ohm at 3.3 V.")
            print("  Fix: add a second 220 ohm resistor in parallel with the green one and the blue one")
            print("  (side by side across the same two breadboard rows, e.g. e11-f11 and d11-g11)")
            print("  to get 110 ohm - never a direct wire.")
            print("  If a colour never lit, or the wrong one did: check that wire (identify_wires.py).")

        button, err = hw.open_button(on_press, on_release, on_held)
        if button is None:
            print(f"ERROR: could not open the button on GPIO17: {err}")
            return 1
        print("\nPart 2 - button. Press, release, and hold for 1.5 s.")
        print("  Ring: green while pressed, blue once held. Ctrl-C to finish.")
        if button.is_pressed:
            print("  WARNING: the button reads PRESSED before you touch it - a switch wire is on")
            print("  the wrong pin, or pin 11 is shorted to GND.")
        quiet_since = time.monotonic()
        while not args.seconds or time.monotonic() - start < args.seconds:
            time.sleep(0.2)
            if pressed_at[0] and pressed_at[0] > quiet_since:
                quiet_since = pressed_at[0]
            if time.monotonic() - quiet_since > 20:
                print("  (no press seen for 20 s - check the switch wires on pin 11 and pin 9)")
                quiet_since = time.monotonic()
    except KeyboardInterrupt:
        print()
    finally:
        if button:
            button.close()
        ring.close()
        print("Ring off. Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
