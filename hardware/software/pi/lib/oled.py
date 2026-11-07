"""Helpers for the Adafruit 1.3" 128x64 OLED (SSD1306, I2C 0x3D or 0x3C).

Environment switches (no code edits needed):
  HANDOFF_OLED=dummy          draw into memory instead of the screen (no OLED attached)
  HANDOFF_OLED_DRIVER=sh1106  for look-alike 1.3" screens with an SH1106 controller
                              (symptom: picture shifted, noise band down one side)
"""

from __future__ import annotations

import os

from .i2cscan import OLED_ADDRESSES, I2CError, open_bus, probe

WIDTH, HEIGHT = 128, 64
# Short forms of PulseProcessor.status() that fit beside the big heart-rate digits.
STATUS_LABELS = {"calibrating": "calib", "no finger": "no finger", "saturated": "SAT",
                 "acquiring": "wait", "pulse": "pulse"}
_FONT_FILES = ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
               "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")


class OledError(Exception):
    def __init__(self, message, hint=""):
        super().__init__(message)
        self.hint = hint


def find_oled_address(bus_number=1):
    """0x3D or 0x3C, whichever answers first, else None."""
    bus = open_bus(bus_number)
    try:
        for addr in OLED_ADDRESSES:
            if probe(bus, addr):
                return addr
        return None
    finally:
        bus.close()


def open_oled(address=None, bus_number=1):
    """Return (device, address) for the SSD1306, or raise OledError."""
    if os.environ.get("HANDOFF_OLED") == "dummy":
        from luma.core.device import dummy
        return dummy(width=WIDTH, height=HEIGHT, mode="1"), address or OLED_ADDRESSES[0]
    try:
        from luma.core.interface.serial import i2c
        from luma.oled.device import sh1106, ssd1306
    except ImportError:
        raise OledError("luma.oled is not installed",
                        "Activate the venv: source ~/handoff-venv/bin/activate "
                        "(or run setup_pi.sh).") from None
    if address is None:
        try:
            address = find_oled_address(bus_number)
        except I2CError as e:
            raise OledError(str(e), e.hint) from None
        if address is None:
            raise OledError("no OLED answers at 0x3D or 0x3C",
                            "Run i2c_scan.py; re-seat the Qwiic cable between the SHIM and the OLED.")
    driver = sh1106 if os.environ.get("HANDOFF_OLED_DRIVER", "").lower() == "sh1106" else ssd1306
    try:
        device = driver(i2c(port=bus_number, address=address), width=WIDTH, height=HEIGHT)
    except Exception as e:  # luma raises its own DeviceNotFoundError etc.
        raise OledError(f"could not start the OLED at 0x{address:02X}: {e}",
                        "Run i2c_scan.py; power-cycle the Pi if the OLED stopped answering.") from None
    return device, address


def load_font(size=10):
    """A TrueType font if one is installed, else Pillow's built-in font."""
    from PIL import ImageFont
    for path in _FONT_FILES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    try:
        return ImageFont.load_default(size=size)   # Pillow >= 10.1
    except TypeError:
        return ImageFont.load_default()


def scale_wave(values, left, top, right, bottom):
    """Map the newest (right - left + 1) values to pixel points inside the box.

    Auto-scales to the min/max of what is shown; a flat signal draws a
    centred line. Pure function (no drawing) so it can be tested.
    """
    width = right - left + 1
    shown = list(values)[-width:]
    if not shown:
        return []
    lo, hi = min(shown), max(shown)
    span = hi - lo
    mid = (top + bottom) / 2
    x0 = right - len(shown) + 1
    points = []
    for i, v in enumerate(shown):
        y = mid if span <= 1e-9 else bottom - (v - lo) / span * (bottom - top)
        points.append((x0 + i, int(round(y))))
    return points


def draw_vitals(draw, fonts, title, hr_text, sub_text, wave, status=""):
    """Common screen layout: title bar, big heart rate, a line of text, waveform.

    `fonts` is (small, big) from load_font(). `wave` is a sequence of numbers.
    """
    small, big = fonts
    draw.text((0, 0), title, font=small, fill="white")
    if status:
        w = draw.textlength(status, font=small) if hasattr(draw, "textlength") else 6 * len(status)
        draw.text((WIDTH - w, 0), status, font=small, fill="white")
    draw.line((0, 12, WIDTH - 1, 12), fill="white")
    draw.text((0, 14), hr_text, font=big, fill="white")
    draw.text((72, 16), sub_text, font=small, fill="white")
    pts = scale_wave(wave, 0, 40, WIDTH - 1, HEIGHT - 1)
    if len(pts) > 1:
        draw.line(pts, fill="white")
