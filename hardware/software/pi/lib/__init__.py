"""Shared helpers for the Handoff relay bring-up scripts.

Modules
-------
dsp        pure signal processing (filters, peak detection, heart rate, SpO2)
max30101   MAX30101 register map, FIFO parsing and a small I2C driver
simbus     a pretend I2C bus with a MAX30101 on it (for --simulate and tests)
i2cscan    I2C bus scan and plain-English diagnosis
oled       SSD1306 OLED helpers (luma.oled)
hw         MARK button and RGB light ring (gpiozero)
wires      the guided wire-identification logic
pihealth   CPU temperature, throttling flags, Wi-Fi
selftest   offline checks for all of the above:  python3 -m lib.selftest

Hardware libraries (smbus2, luma.oled, gpiozero) are imported lazily, so the
pure parts work on any computer with plain Python 3.
"""
