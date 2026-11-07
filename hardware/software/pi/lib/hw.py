"""MARK button and RGB light ring (gpiozero), wired per build spec section 3.

    Button: pin 11 (GPIO17) <-> switch <-> pin 9 (GND); internal pull-up,
            so pressed = LOW.
    Ring:   common anode (+) on pin 17 (3.3 V); R/G/B cathodes through 220 ohm
            to pins 15/16/18 (GPIO22/23/24). A colour lights when its pin is
            LOW, hence RGBLED(active_high=False).

Everything degrades to a no-op when gpiozero (or the Pi) is missing, so the
stream test can run with --simulate on a laptop.
"""

from __future__ import annotations

import warnings

BUTTON_PIN = 17
RED_PIN, GREEN_PIN, BLUE_PIN = 22, 23, 24
HOLD_S = 1.5

COLOURS = {
    "off": (0, 0, 0),
    "red": (1, 0, 0),
    "green": (0, 1, 0),
    "blue": (0, 0, 1),
    "white": (1, 1, 1),
    "amber": (1, 0.35, 0),
}


def _rgb(colour):
    return COLOURS[colour] if isinstance(colour, str) else tuple(colour)


class Ring:
    """The light ring. `ok` is False (and every call does nothing) if the
    LED could not be opened; `error` then says why."""

    def __init__(self, enabled=True):
        self.led = None
        self.error = None
        if not enabled:
            self.error = "disabled"
            return
        try:
            from gpiozero import RGBLED
            with warnings.catch_warnings():     # off-Pi fallback chatter; errors still raise
                warnings.simplefilter("ignore")
                self.led = RGBLED(RED_PIN, GREEN_PIN, BLUE_PIN, active_high=False)
        except Exception as e:      # ImportError off-Pi, BadPinFactory, pin busy ...
            self.error = f"{type(e).__name__}: {e}"

    @property
    def ok(self):
        return self.led is not None

    def set(self, colour):
        if self.led:
            self.led.color = _rgb(colour)

    def pulse(self, colour, period_s=1.6):
        if self.led:
            half = period_s / 2
            self.led.pulse(fade_in_time=half, fade_out_time=half,
                           on_color=_rgb(colour), off_color=(0, 0, 0))

    def blink(self, colour, times=None, on_s=0.15, off_s=0.15):
        if self.led:
            self.led.blink(on_time=on_s, off_time=off_s, on_color=_rgb(colour),
                           off_color=(0, 0, 0), n=times, background=True)

    def off(self):
        if self.led:
            self.led.off()

    def close(self):
        if self.led:
            self.led.off()
            self.led.close()
            self.led = None


def open_button(on_press=None, on_release=None, on_held=None, hold_s=HOLD_S):
    """gpiozero Button on GPIO17 with the internal pull-up, or None + reason."""
    try:
        from gpiozero import Button
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            btn = Button(BUTTON_PIN, pull_up=True, bounce_time=0.03, hold_time=hold_s)
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"
    btn.when_pressed = on_press
    btn.when_released = on_release
    btn.when_held = on_held
    return btn, None
