#!/usr/bin/env python3
"""Scan I2C bus 1, name what answers, and explain anything missing.

Expected: 0x57 MAX30101. An optional LCD1602 answers at 0x27 or 0x3F (OLED: 0x3D or 0x3C).

    python3 i2c_scan.py
Exit code 0 when the sensor answers, 1 otherwise.
"""

import argparse
import sys

from lib import i2cscan


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--bus", type=int, default=1, help="I2C bus number (default 1)")
    args = ap.parse_args()

    print(f"HANDOFF relay - I2C scan of bus {args.bus}")
    try:
        found = i2cscan.scan(args.bus)
    except i2cscan.I2CError as e:
        print(f"ERROR: {e}\n  -> {e.hint}")
        return 1

    if found:
        print(f"Found {len(found)} device(s):")
        for addr in found:
            print(f"  0x{addr:02X}  {i2cscan.describe(addr)}")
    else:
        print("Found no devices.")
    print("Expected: 0x57 (sensor). 0x27 / 0x3F if you fitted the LCD1602 add-on.")

    ok, lines = i2cscan.diagnose(found)
    print()
    print("RESULT: OK - the sensor answers." if ok else "RESULT: PROBLEM")
    for line in lines:
        print(f"  {line}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
