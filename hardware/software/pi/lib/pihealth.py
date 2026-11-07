"""Pi health readings: CPU temperature, throttling flags, Wi-Fi, IP addresses.

The parsers are pure functions (tested by lib.selftest); the readers call
standard Pi OS tools and return None when a tool is missing.
"""

from __future__ import annotations

import re
import shutil
import subprocess

# Bits of `vcgencmd get_throttled` (Raspberry Pi documentation, "vcgencmd").
THROTTLE_BITS = {
    0: "under-voltage detected NOW",
    1: "ARM frequency capped NOW",
    2: "throttled NOW",
    3: "soft temperature limit active NOW",
    16: "under-voltage has occurred since boot",
    17: "ARM frequency capping has occurred since boot",
    18: "throttling has occurred since boot",
    19: "soft temperature limit has occurred since boot",
}


def decode_throttled(value):
    """List of plain-English flags set in a get_throttled value (int)."""
    return [text for bit, text in sorted(THROTTLE_BITS.items()) if value & (1 << bit)]


def parse_throttled(text):
    """'throttled=0x50005' -> 0x50005, or None."""
    m = re.search(r"throttled=(0x[0-9a-fA-F]+)", text or "")
    return int(m.group(1), 16) if m else None


def throttle_advice(value):
    if value & 0x1:
        return "Power supply is too weak right now: use the official 5.1 V 3 A supply or a short, thick USB-C cable."
    if value & 0x10000:
        return "Voltage dipped at some point since boot: check the supply/cable (the power bank must give 5 V 3 A)."
    if value & 0x4 or value & 0x40000:
        return "The CPU slowed down to protect itself: check heatsinks and box vents."
    return ""


def parse_nmcli_wifi(text):
    """(ssid, signal_percent) of the active network from
    `nmcli -t -f ACTIVE,SSID,SIGNAL dev wifi list --rescan no`, or (None, None).
    In terse mode nmcli escapes ':' inside fields as '\\:'."""
    for line in (text or "").splitlines():
        fields = re.split(r"(?<!\\):", line)
        if len(fields) >= 3 and fields[0] == "yes":
            ssid = ":".join(fields[1:-1]).replace("\\:", ":").replace("\\\\", "\\")
            try:
                return ssid, int(fields[-1])
            except ValueError:
                return ssid, None
    return None, None


def parse_ip_addr(text):
    """{iface: ipv4} from `ip -4 -o addr show`, skipping loopback."""
    out = {}
    for line in (text or "").splitlines():
        m = re.match(r"\d+:\s+(\S+)\s+inet\s+([\d.]+)/", line)
        if m and m.group(1) != "lo":
            out.setdefault(m.group(1), m.group(2))
    return out


def _run(cmd):
    exe = shutil.which(cmd[0]) or (f"/usr/bin/{cmd[0]}" if cmd[0] == "vcgencmd" else None)
    if not exe:
        return None
    try:
        res = subprocess.run([exe, *cmd[1:]], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return res.stdout if res.returncode == 0 else None


def cpu_temperature():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return int(f.read().strip()) / 1000.0
    except (OSError, ValueError):
        out = _run(["vcgencmd", "measure_temp"])
        m = re.search(r"temp=([\d.]+)", out or "")
        return float(m.group(1)) if m else None


def throttled():
    return parse_throttled(_run(["vcgencmd", "get_throttled"]))


def wifi():
    ssid, signal = parse_nmcli_wifi(_run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL",
                                          "dev", "wifi", "list", "--rescan", "no"]))
    if ssid is None:
        out = _run(["iwgetid", "-r"])
        ssid = out.strip() if out and out.strip() else None
    return ssid, signal


def ip_addresses():
    return parse_ip_addr(_run(["ip", "-4", "-o", "addr", "show"]))


def model():
    try:
        with open("/proc/device-tree/model") as f:
            return f.read().strip("\x00\n ")
    except OSError:
        return None
