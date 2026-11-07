#!/usr/bin/env python3
"""Guided identification of the MARK button's 6 unlabelled wires.

Finds: the two switch wires, the light ring's common (+), and the red, green
and blue wires. You touch two probes to pairs of wires and type what lights.

It only ever uses:
  pin 17 (3.3 V) THROUGH a 220 ohm resistor  -> the "+ probe"
  pin 9  (GND)                               -> the "- probe"
  pin 11 (GPIO17) as an INPUT, in the last step only
No pin is ever set as an output, and the 3.3 V probe always goes through the
resistor, so no probe position can short anything (worst case 15 mA).

    python3 identify_wires.py
    python3 identify_wires.py --names red black white yellow green blue
"""

import argparse
import sys
import time

from lib import wires

ANSWERS = {"r": "red", "g": "green", "b": "blue", "n": wires.NONE, "": None, "?": None}

INTRO = """
SAFETY RULES
  1. Pin 17 (3.3 V) only ever connects to the resistor - never straight to a wire.
  2. Do not press the button during the LED steps.
  3. Touching the two probes together is harmless (the resistor limits it), but avoid it.

PREPARE (Pi can stay on)
  a. Label the 6 loose wire ends 1-6 with tape (or use their colours as names).
  b. "+ probe": female jumper on pin 17 (3.3 V) -> 220 ohm resistor -> a second jumper.
     The loose end of that second jumper is the + probe. (On the breadboard: resistor
     between two rows, one jumper from pin 17 into the first row.)
  c. "- probe": female jumper on pin 9 (GND). Its loose end is the - probe.
  d. To "touch" a wire: push its bare end into the probe's socket, or hold them together.
  Green and blue are dim through 220 ohm at 3.3 V: shade the button with your hand.
"""


def ask_colour(step, plus, minus):
    while True:
        print(f"\nStep {step}: + probe -> wire {plus}    - probe -> wire {minus}")
        reply = input("  What lights on the ring? [r]ed [g]reen [b]lue [n]othing "
                      "(or ? to look again): ").strip().lower()
        if reply in ANSWERS and ANSWERS[reply]:
            return ANSWERS[reply]
        if reply == "w":
            print("  White is not possible with one colour wire - look again; shade the button.")
        else:
            print("  Look again (shade the button), then type r, g, b or n.")


def confirm_switch(sw_a, sw_b):
    print("\nLAST STEP - confirm the switch with GPIO17 as an INPUT (pull-up on):")
    print(f"  Remove both probes. Connect wire {sw_a} to pin 11 (GPIO17) and wire {sw_b} to pin 9 (GND).")
    print("  (Either way round works; the switch has no polarity.)")
    input("  Press Enter when connected, then press the button 3 times within 30 s...")
    try:
        from gpiozero import Button
        button = Button(17, pull_up=True, bounce_time=0.03)
    except Exception as e:
        print(f"  Skipped: can't open GPIO17 here ({type(e).__name__}: {e}).")
        print("  Run test_button.py on the Pi after wiring instead.")
        return None
    presses = 0
    try:
        if button.is_pressed:
            print("  It reads PRESSED without touching it: wrong wires on pin 11/9? Check and re-run.")
            return False
        deadline = time.monotonic() + 30
        while presses < 3 and time.monotonic() < deadline:
            if button.wait_for_press(timeout=max(0.0, deadline - time.monotonic())):
                presses += 1
                print(f"  press {presses} seen")
                button.wait_for_release(timeout=5)
    except KeyboardInterrupt:
        pass
    finally:
        button.close()
    if presses >= 3:
        print("  Switch confirmed.")
        return True
    print(f"  Only {presses} press(es) seen. Check the two wires are firmly on pins 11 and 9.")
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--names", nargs=6, metavar="NAME", default=list("123456"),
                    help="your names for the 6 wires (default 1 2 3 4 5 6)")
    ap.add_argument("--no-gpio", action="store_true", help="skip the final GPIO17 switch check")
    args = ap.parse_args()

    print("HANDOFF relay - MARK button wire identification")
    print(INTRO)
    input("Press Enter when both probes are ready...")

    gen = wires.identify(args.names)
    step = 1
    try:
        probe = next(gen)
        while True:
            probe = gen.send(ask_colour(step, *probe))
            step += 1
    except StopIteration as stop:
        result = stop.value
    except wires.WireError as e:
        print(f"\nCould not finish: {e}")
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nStopped.")
        return 1

    sw_a, sw_b = result["switch"]
    print("\n" + "=" * 64)
    print(f"RESULT ({result['polarity']}, found in {step} steps)")
    print(f"  switch      : wires {sw_a} and {sw_b}")
    print(f"  ring common : wire {result['common']}")
    print(f"  red         : wire {result['red']}")
    print(f"  green       : wire {result['green']}")
    print(f"  blue        : wire {result['blue']}")
    print("=" * 64)

    if result["polarity"] != "common anode":
        print("\nIMPORTANT: this ring is COMMON CATHODE, not common anode as the listing says.")
        print("Do NOT use the spec wiring. Tell the coordinator: the common wire must go to a")
        print("GND pin (e.g. pin 14) instead of 3.3 V, and the code must use active_high=True.")
        return 2

    print("\nWire it like this (build spec section 3), with the Pi OFF:")
    print(f"  wire {sw_a:<6} -> pin 11 (GPIO17)")
    print(f"  wire {sw_b:<6} -> pin 9  (GND)")
    print(f"  wire {result['common']:<6} -> pin 17 (3.3 V)   ring common +")
    print(f"  wire {result['red']:<6} -> 220 ohm -> pin 15 (GPIO22)   red")
    print(f"  wire {result['green']:<6} -> 220 ohm -> pin 16 (GPIO23)   green")
    print(f"  wire {result['blue']:<6} -> 220 ohm -> pin 18 (GPIO24)   blue")

    if not args.no_gpio:
        try:
            confirm_switch(sw_a, sw_b)
        except (KeyboardInterrupt, EOFError):
            print()
    print("\nNext: wire everything as above, then run: python3 test_button.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
