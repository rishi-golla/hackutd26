#!/usr/bin/env python3
"""Relay health check: CPU temperature, power/throttling, Wi-Fi, I2C devices.

    python3 health_check.py
Exit code 0 when everything is fine, 1 if anything needs attention.
"""

import socket
import sys
import time

from lib import i2cscan, pihealth


def main():
    problems = []
    print(f"HANDOFF relay health check  ({socket.gethostname()}, {time.strftime('%Y-%m-%d %H:%M:%S')})")
    print("-" * 66)
    print(f"Model       : {pihealth.model() or 'unknown (not a Pi?)'}")

    temp = pihealth.cpu_temperature()
    if temp is None:
        print("CPU temp    : unknown")
    else:
        verdict = "OK" if temp < 70 else ("WARM" if temp < 80 else "HOT - throttling")
        print(f"CPU temp    : {temp:.1f} C   {verdict}")
        if temp >= 70:
            problems.append("CPU is warm: check heatsinks and that the box vents are clear.")

    value = pihealth.throttled()
    if value is None:
        print("Power/clock : unknown (vcgencmd not found)")
    elif value == 0:
        print("Power/clock : throttled=0x0   OK - no under-voltage or throttling since boot")
    else:
        print(f"Power/clock : throttled=0x{value:X}")
        for flag in pihealth.decode_throttled(value):
            print(f"              - {flag}")
        problems.append(pihealth.throttle_advice(value) or "See the throttling flags above.")

    ssid, signal = pihealth.wifi()
    ips = pihealth.ip_addresses() or {}
    if ssid:
        print(f"Wi-Fi       : connected to \"{ssid}\"" + (f", signal {signal}%" if signal is not None else ""))
        if signal is not None and signal < 40:
            problems.append("Weak Wi-Fi: move the hotspot phone closer to the relay.")
    else:
        print("Wi-Fi       : not connected")
        problems.append("No Wi-Fi: check the hotspot is on (iPhone: Maximize Compatibility), "
                        "then: nmcli dev wifi list")
    if ips:
        print("IP address  : " + ", ".join(f"{ip} ({iface})" for iface, ip in ips.items()))
    else:
        print("IP address  : none")
    print(f"Name        : {socket.gethostname()}.local")

    try:
        found = i2cscan.scan(1)
        ok, lines = i2cscan.diagnose(found)
        names = ", ".join(f"0x{a:02X}" for a in found) or "none"
        print(f"I2C bus 1   : {names}   {'OK' if ok else 'PROBLEM'}")
        if not ok:
            problems.append(f"I2C: {lines[0] if lines else 'unexpected devices'} "
                            "Run i2c_scan.py for the likely cause.")
    except i2cscan.I2CError as e:
        print(f"I2C bus 1   : {e}")
        problems.append(e.hint)

    print("-" * 66)
    if not problems:
        print("RESULT: all good")
        return 0
    print("RESULT: needs attention")
    for p in problems:
        print(f"  - {p}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
