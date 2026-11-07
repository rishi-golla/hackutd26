"""Driver for a 16x2 character LCD (HD44780) on a PCF8574 I2C backpack, the "I2C LCD1602".

Optional add-on for the relay box. Address 0x27 (PCF8574) or 0x3F (PCF8574A).

Wiring, through the mini breadboard (female end on the LCD pin, male end in the hole):
  VCC -> d7   (row 7 is 3.3 V from pin 17). NEVER 5 V: the backpack pulls SDA/SCL up
              to its VCC, and the Pi's pins are not 5 V tolerant.
  GND -> d5   (row 5 is ground from pin 9)
  SDA -> h16, with a second jumper from Pi pin 3 -> g16
  SCL -> h17, with a second jumper from Pi pin 5 -> g17
At 3.3 V some LCD1602s look faint: turn the blue contrast screw on the back.

Environment switch (no code edits needed):
  HANDOFF_LCD=dummy   keep the text in memory instead of a screen (no LCD attached)
"""

from __future__ import annotations

import os
import time

from .i2cscan import LCD_ADDRESSES, I2CError, open_bus, probe

COLS, ROWS = 16, 2

# Bit layout of the common PCF8574 backpacks: P0 RS, P1 RW, P2 EN, P3 backlight, P4-P7 D4-D7.
_RS = 0x01
_EN = 0x04
_BACKLIGHT = 0x08

# HD44780 commands
_CLEAR = 0x01
_ENTRY_LEFT = 0x06          # cursor moves right, no display shift
_DISPLAY_ON = 0x0C          # display on, cursor off, blink off
_FUNCTION_4BIT_2LINE = 0x28
_ROW_ADDR = (0x80, 0xC0)    # DDRAM address of each row's first column

# Short forms of PulseProcessor.status() and the link states that fit a 16-column line.
STATUS_SHORT = {"calibrating": "calib", "no finger": "finger?", "saturated": "SAT",
                "acquiring": "wait", "pulse": "pulse"}
LINK_SHORT = {"connected": "LINK OK", "connecting": "linking", "error": "NO LINK"}


class LcdError(Exception):
    def __init__(self, message, hint=""):
        super().__init__(message)
        self.hint = hint


def fit(text, width=COLS):
    """Pad or cut a line to exactly `width` characters; anything outside printable ASCII becomes '?'."""
    s = "".join(c if 32 <= ord(c) < 127 else "?" for c in str(text))
    return s[:width].ljust(width)


def vitals_lines(hr, spo2, status, link=None):
    """The two 16-character lines for the relay screen.

    Line 1: heart rate and oxygen, '--' when not measured yet.
    Line 2: sensor status, plus the link status when streaming to the Mac.
    """
    hr_s = f"{hr:.0f}" if hr else "--"
    sp_s = f"{spo2:.0f}" if spo2 else "--"
    line1 = f"HR {hr_s:>3}  SpO2 {sp_s:>3}"
    st = STATUS_SHORT.get(status, str(status))
    if link is None:
        line2 = st
    else:
        line2 = f"{st[:8]:<8} {LINK_SHORT.get(link, str(link))[:7]:>7}"
    return fit(line1), fit(line2)


class Lcd:
    """A real LCD1602 on an smbus2-style bus (anything with write_byte(addr, value))."""

    def __init__(self, bus, address):
        self.bus = bus
        self.address = address
        self.backlight = _BACKLIGHT
        self.lines = [""] * ROWS          # what is on the screen now, for skipping redundant writes
        self._init()

    def _write(self, value):
        self.bus.write_byte(self.address, value | self.backlight)

    def _nibble(self, high_bits, mode):
        b = (high_bits & 0xF0) | mode
        self._write(b | _EN)
        time.sleep(0.0005)
        self._write(b)
        time.sleep(0.0001)

    def _send(self, value, mode=0):
        self._nibble(value & 0xF0, mode)
        self._nibble((value << 4) & 0xF0, mode)

    def _init(self):
        time.sleep(0.05)                 # power-up settle
        for _ in range(3):               # force 8-bit mode three times (HD44780 reset sequence)
            self._nibble(0x30, 0)
            time.sleep(0.005)
        self._nibble(0x20, 0)            # then switch to 4-bit
        for cmd in (_FUNCTION_4BIT_2LINE, _DISPLAY_ON, _ENTRY_LEFT):
            self._send(cmd)
        self.clear()

    def clear(self):
        self._send(_CLEAR)
        time.sleep(0.002)
        self.lines = [" " * COLS] * ROWS

    def show(self, line1, line2=""):
        """Write both lines; only rows whose text changed are sent."""
        for row, text in enumerate((line1, line2)):
            t = fit(text)
            if t == self.lines[row]:
                continue
            self._send(_ROW_ADDR[row])
            for ch in t:
                self._send(ord(ch), _RS)
            self.lines[row] = t

    def close(self, backlight_off=True):
        try:
            self.clear()
            if backlight_off:
                self.backlight = 0
                self._write(0)
        finally:
            close = getattr(self.bus, "close", None)
            if close:
                close()


class DummyLcd:
    """Stand-in that keeps the text in memory (HANDOFF_LCD=dummy, or tests)."""

    def __init__(self):
        self.lines = [" " * COLS] * ROWS

    def show(self, line1, line2=""):
        self.lines = [fit(line1), fit(line2)]

    def clear(self):
        self.lines = [" " * COLS] * ROWS

    def close(self, backlight_off=True):
        self.clear()


def find_lcd_address(bus_number=1):
    """0x27 or 0x3F, whichever answers first, else None."""
    bus = open_bus(bus_number)
    try:
        for addr in LCD_ADDRESSES:
            if probe(bus, addr):
                return addr
        return None
    finally:
        bus.close()


def open_lcd(address=None, bus_number=1):
    """Return (lcd, address), or raise LcdError with a plain-English hint."""
    if os.environ.get("HANDOFF_LCD") == "dummy":
        return DummyLcd(), address or LCD_ADDRESSES[0]
    try:
        if address is None:
            address = find_lcd_address(bus_number)
        if address is None:
            raise LcdError("no LCD answers at 0x27 or 0x3F",
                           "Power off, then check the wires: LCD VCC -> d7, GND -> d5, SDA -> h16, "
                           "SCL -> h17, and Pi pin 3 -> g16, pin 5 -> g17. "
                           "Run i2c_scan.py to see what answers.")
        bus = open_bus(bus_number)
    except I2CError as e:
        raise LcdError(str(e), e.hint) from None
    try:
        return Lcd(bus, address), address
    except OSError as e:
        bus.close()
        raise LcdError(f"LCD at 0x{address:02X} stopped answering: {e}",
                       "Power off and re-seat the SDA and SCL jumpers (pins 3 and 5, rows 16 and 17).") from None
