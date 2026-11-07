"""I2C bus 1 scan with plain-English diagnosis.

Expected on the relay: 0x57 MAX30101, plugged straight into the SHIM with the
500 mm Qwiic cable. The OLED (0x3D or 0x3C) is optional; if fitted it sits in
the chain as SHIM -> OLED -> MAX30101.
"""

from __future__ import annotations

import errno
import importlib.util
import os
import shutil
import subprocess

MAX30101_ADDRESS = 0x57
OLED_ADDRESSES = (0x3D, 0x3C)   # Adafruit 938: 0x3D default, 0x3C with the address jumper
LCD_ADDRESSES = (0x27, 0x3F)    # I2C LCD1602 backpack: PCF8574 = 0x27, PCF8574A = 0x3F

KNOWN_DEVICES = {
    0x57: "MAX30101 pulse sensor (finger clip)",
    0x3D: "OLED screen, SSD1306 (default address)",
    0x3C: "OLED screen, SSD1306 (address jumper set)",
    0x27: "LCD1602 screen (I2C backpack, PCF8574)",
    0x3F: "LCD1602 screen (I2C backpack, PCF8574A)",
}

EREMOTEIO = getattr(errno, "EREMOTEIO", 121)   # Linux "no ACK"; missing on macOS
_NO_DEVICE_ERRNOS = {EREMOTEIO, errno.ENXIO, errno.EIO}


class I2CError(Exception):
    def __init__(self, message, hint=""):
        super().__init__(message)
        self.hint = hint


def open_bus(bus_number=1):
    """Open /dev/i2c-N with smbus2, turning the usual failures into hints."""
    path = f"/dev/i2c-{bus_number}"
    if not os.path.exists(path):
        raise I2CError(f"{path} does not exist",
                       "I2C is switched off. Run setup_pi.sh (it runs "
                       "'sudo raspi-config nonint do_i2c 0'), then reboot.")
    try:
        from smbus2 import SMBus
    except ImportError:
        raise I2CError("smbus2 is not installed",
                       "Activate the venv first: source ~/handoff-venv/bin/activate "
                       "(or run setup_pi.sh).") from None
    try:
        return SMBus(bus_number)
    except PermissionError:
        raise I2CError(f"no permission to open {path}",
                       "Add yourself to the i2c group: sudo usermod -aG i2c $USER, "
                       "then log out and back in.") from None


def probe(bus, addr):
    """True if a device ACKs `addr`. Mirrors i2cdetect's default method:
    a read for 0x30-0x37 and 0x50-0x5F (where EEPROMs live), otherwise a
    zero-length 'quick write'. Falls back to a read if quick is unsupported."""
    try:
        if 0x30 <= addr <= 0x37 or 0x50 <= addr <= 0x5F:
            bus.read_byte(addr)
        else:
            try:
                bus.write_quick(addr)
            except OSError as e:
                if e.errno not in (errno.EOPNOTSUPP, errno.ENOTSUP):
                    raise
                bus.read_byte(addr)
        return True
    except OSError as e:
        if e.errno in _NO_DEVICE_ERRNOS:
            return False
        if e.errno == errno.ETIMEDOUT:
            raise I2CError("I2C bus timed out",
                           "A wire is shorted or a device is holding the bus. Power off, "
                           "re-seat every Qwiic cable, check the SHIM is on pins 1-6.") from None
        return False


def scan(bus_number=1, bus=None):
    """Sorted list of addresses (0x08-0x77) that answer on the bus."""
    if bus is None and not os.path.exists(f"/dev/i2c-{bus_number}"):
        open_bus(bus_number)    # raises the friendly "I2C is off" error
    if bus is None:
        if importlib.util.find_spec("smbus2") is None:
            return scan_with_i2cdetect(bus_number)
        bus = open_bus(bus_number)
        try:
            return [a for a in range(0x08, 0x78) if probe(bus, a)]
        finally:
            bus.close()
    return [a for a in range(0x08, 0x78) if probe(bus, a)]


def scan_with_i2cdetect(bus_number=1):
    """Fallback when smbus2 is missing: run `i2cdetect -y N` and parse it."""
    exe = shutil.which("i2cdetect") or "/usr/sbin/i2cdetect"
    if not os.path.exists(exe):
        raise I2CError("neither smbus2 nor i2cdetect is available",
                       "Run setup_pi.sh to install i2c-tools and the venv.")
    out = subprocess.run([exe, "-y", str(bus_number)], capture_output=True, text=True)
    if out.returncode != 0:
        raise I2CError(f"i2cdetect failed: {out.stderr.strip()}",
                       "Check the user is in the i2c group (groups) and I2C is enabled.")
    return parse_i2cdetect(out.stdout)


def parse_i2cdetect(text):
    """Addresses shown in `i2cdetect -y` output ('UU' = in use by a driver).

    Each row is 'NN:' followed by 16 three-character cells, so cells are
    read by position (empty cells at the start of row 00 are blanks).
    """
    found = []
    for line in text.splitlines():
        if len(line) < 4 or line[2] != ":":
            continue
        try:
            row = int(line[:2], 16)
        except ValueError:
            continue
        for col in range(16):
            cell = line[4 + 3 * col: 6 + 3 * col].strip().lower()
            if cell == "uu":
                found.append(row + col)
            elif cell and cell != "--":
                try:
                    found.append(int(cell, 16))
                except ValueError:
                    pass
    return sorted(found)


def describe(addr):
    return KNOWN_DEVICES.get(addr, "unknown device")


def diagnose(found):
    """(ok, lines): what is missing from `found` and the most likely cause."""
    found = sorted(found)
    lines = []
    if len(found) > 20:
        return False, [
            f"{len(found)} addresses answered - that is not real devices.",
            "Most likely: SDA or SCL is shorted to GND (bus stuck). Power off, unplug the",
            "Qwiic cables one by one, and check the SHIM sits flat on pins 1-6.",
        ]
    has_max = MAX30101_ADDRESS in found
    oleds = [a for a in OLED_ADDRESSES if a in found]
    unknown = [a for a in found
               if a != MAX30101_ADDRESS and a not in OLED_ADDRESSES and a not in LCD_ADDRESSES]

    if not found:
        lines += [
            "Nothing answered on I2C bus 1.",
            "Most likely, in this order:",
            "  1. The Qwiic SHIM is not pressed fully onto header pins 1-6, or is on the",
            "     wrong pins. Its square pad goes over pin 1, at the microSD-card end of",
            "     the header (type 'pinout' for a diagram of the header).",
            "  2. The 500 mm cable is not clicked into the SHIM or the sensor.",
            "  3. The cable goes into the wrong socket (use the Qwiic sockets only).",
        ]
    else:
        if not has_max:
            if oleds:
                lines += [
                    "MAX30101 missing (expected 0x57), but the OLED answers.",
                    "Most likely: the 500 mm cable from the OLED's second socket to the sensor",
                    "is loose. Re-seat both ends until they click; try a short cable to rule",
                    "out a damaged long one.",
                ]
            else:
                lines += [
                    "MAX30101 missing (expected 0x57).",
                    "Most likely: the 500 mm cable is loose at the SHIM or at the sensor.",
                    "Re-seat both ends until they click.",
                ]
        if len(oleds) == 2:
            lines.append("Both 0x3C and 0x3D answer: two OLEDs, or another board at one of them.")
    if unknown:
        lines.append("Unexpected device(s): " + ", ".join(f"0x{a:02X}" for a in unknown)
                     + " - fine if you plugged in something extra, otherwise check wiring.")
    ok = has_max and len(oleds) <= 1
    return ok, lines
