"""MAX30101 pulse-oximeter: register map, FIFO parsing and a small I2C driver.

Board: SparkFun Qwiic MAX30101 (SEN-16474), I2C address 0x57.

Register addresses and bit fields below are taken from the Maxim Integrated
(now Analog Devices) MAX30101 datasheet, table "Register Maps and
Descriptions" and the register descriptions that follow it. The datasheet
section is named next to each value so it can be checked against the PDF.

The pure helpers at the top (encoders, fifo_available, parse_fifo) have no
hardware dependency and are covered by `python3 -m lib.selftest`.
"""

from __future__ import annotations

import threading
import time
from collections import deque

I2C_ADDRESS = 0x57          # datasheet: "Slave ID" 0xAE write / 0xAF read = 0x57 7-bit

# --- Register map (datasheet "Register Maps and Descriptions") -------------
REG_INTR_STATUS_1 = 0x00    # A_FULL[7] PPG_RDY[6] ALC_OVF[5] PWR_RDY[0]; cleared on read
REG_INTR_STATUS_2 = 0x01    # DIE_TEMP_RDY[1]; cleared on read
REG_INTR_ENABLE_1 = 0x02    # A_FULL_EN[7] PPG_RDY_EN[6] ALC_OVF_EN[5]
REG_INTR_ENABLE_2 = 0x03    # DIE_TEMP_RDY_EN[1]
REG_FIFO_WR_PTR = 0x04      # FIFO_WR_PTR[4:0]  next slot the sensor will write
REG_OVF_COUNTER = 0x05      # OVF_COUNTER[4:0]  samples lost while FIFO full (saturates at 0x1F)
REG_FIFO_RD_PTR = 0x06      # FIFO_RD_PTR[4:0]  next slot to be read
REG_FIFO_DATA = 0x07        # FIFO_DATA[7:0]    read port; address does NOT auto-increment
REG_FIFO_CONFIG = 0x08      # SMP_AVE[7:5] FIFO_ROLLOVER_EN[4] FIFO_A_FULL[3:0]
REG_MODE_CONFIG = 0x09      # SHDN[7] RESET[6] MODE[2:0]
REG_SPO2_CONFIG = 0x0A      # SPO2_ADC_RGE[6:5] SPO2_SR[4:2] LED_PW[1:0]
REG_LED1_PA = 0x0C          # LED Pulse Amplitude, LED1 = red
REG_LED2_PA = 0x0D          # LED Pulse Amplitude, LED2 = IR
REG_TEMP_INT = 0x1F         # Die Temperature Integer TINT[7:0], two's complement, 1 degC
REG_TEMP_FRAC = 0x20        # Die Temperature Fraction TFRAC[3:0], 0.0625 degC steps
REG_TEMP_CONFIG = 0x21      # TEMP_EN[0], self-clearing when the conversion is done
REG_REV_ID = 0xFE           # Revision ID (silicon revision, varies)
REG_PART_ID = 0xFF          # Part ID

PART_ID = 0x15              # datasheet "Part ID (0xFF)": always 0x15 for MAX30101

MODE_CONFIG_SHDN = 0x80     # Mode Configuration bit 7: power-save, LEDs off
MODE_CONFIG_RESET = 0x40    # Mode Configuration bit 6: reset, self-clearing
MODE_HEART_RATE = 0b010     # MODE[2:0]: red LED only
MODE_SPO2 = 0b011           # MODE[2:0]: red + IR  <- used here
MODE_MULTI_LED = 0b111      # MODE[2:0]: red, IR, green in programmable slots

FIFO_DEPTH = 32             # "FIFO Description": 32 samples
BYTES_PER_CHANNEL = 3       # "FIFO Data Register": 3 bytes per LED channel
DATA_MASK = 0x3FFFF         # data is left-justified in 18 bits; bits 23:18 are don't-care
FULL_SCALE = DATA_MASK      # largest possible reading (any pulse width)

# SpO2 Configuration field values (datasheet "SpO2 Configuration (0x0A)").
ADC_RANGES_NA = {2048: 0b00, 4096: 0b01, 8192: 0b10, 16384: 0b11}   # full scale, nA
SAMPLE_RATES = {50: 0b000, 100: 0b001, 200: 0b010, 400: 0b011,
                800: 0b100, 1000: 0b101, 1600: 0b110, 3200: 0b111}   # samples/s
PULSE_WIDTHS_US = {69: 0b00, 118: 0b01, 215: 0b10, 411: 0b11}       # 15/16/17/18-bit ADC
# FIFO Configuration SMP_AVE (datasheet "FIFO Configuration (0x08)").
SAMPLE_AVERAGES = {1: 0b000, 2: 0b001, 4: 0b010, 8: 0b011, 16: 0b100, 32: 0b101}
# LED Pulse Amplitude: about 0.2 mA per step (datasheet table: 0x1F = 6.2 mA,
# 0x7F = 25.4 mA). Note that the allowed sample rate depends on the pulse
# width in SpO2 mode (datasheet SpO2 mode table); 100 samples/s works with all.
LED_MA_PER_STEP = 0.2


def spo2_config_byte(adc_range_na=4096, sample_rate=100, pulse_width_us=411):
    """Value for REG_SPO2_CONFIG."""
    try:
        return ((ADC_RANGES_NA[adc_range_na] << 5)
                | (SAMPLE_RATES[sample_rate] << 2)
                | PULSE_WIDTHS_US[pulse_width_us])
    except KeyError as e:
        raise ValueError(f"unsupported SpO2 setting: {e}") from None


def fifo_config_byte(sample_avg=1, rollover=True, almost_full=0x0F):
    """Value for REG_FIFO_CONFIG."""
    if sample_avg not in SAMPLE_AVERAGES:
        raise ValueError(f"sample_avg must be one of {sorted(SAMPLE_AVERAGES)}")
    return (SAMPLE_AVERAGES[sample_avg] << 5) | (int(bool(rollover)) << 4) | (almost_full & 0x0F)


def led_amplitude_byte(milliamps):
    """LED Pulse Amplitude register value for a current in mA (0 to 51)."""
    return max(0, min(255, round(milliamps / LED_MA_PER_STEP)))


def fifo_available(wr_ptr, rd_ptr, ovf_counter):
    """Unread samples in the FIFO.

    Datasheet ("FIFO Write/Read Pointer", pseudo-code under "FIFO Data
    Register"): available = WR_PTR - RD_PTR, allowing for the 5-bit wrap.
    Equal pointers mean empty, unless OVF_COUNTER > 0, which means full.
    Exactly 32 unread samples with nothing lost yet also has equal pointers
    and OVF_COUNTER = 0, so it reads as empty; one sample later the counter
    is set and all 32 are returned (with 1 lost). Polling every 30 ms
    against a 320 ms FIFO never gets there unless the reader stalls.
    """
    n = (wr_ptr - rd_ptr) % FIFO_DEPTH
    if n == 0 and ovf_counter:
        return FIFO_DEPTH
    return n


def parse_fifo(data, channels=2):
    """Split raw FIFO bytes into samples.

    Each sample is `channels` words of 3 bytes, MSB first, in LED order
    (SpO2 mode: LED1 red, then LED2 IR). Only bits 17:0 are data.
    Returns a list of tuples, e.g. [(red, ir), ...]. A trailing partial
    sample is ignored.
    """
    step = channels * BYTES_PER_CHANNEL
    out = []
    for base in range(0, len(data) - step + 1, step):
        sample = []
        for ch in range(channels):
            b = data[base + ch * 3: base + ch * 3 + 3]
            sample.append(((b[0] << 16) | (b[1] << 8) | b[2]) & DATA_MASK)
        out.append(tuple(sample))
    return out


class SensorError(Exception):
    """A MAX30101 problem with a plain-English hint for the user."""

    def __init__(self, message, hint=""):
        super().__init__(message)
        self.hint = hint


class Max30101:
    """Minimal MAX30101 driver in SpO2 mode (red + IR), polled, no interrupts.

    `bus` is an I2C bus number (opens smbus2.SMBus) or any object with the
    smbus2 methods read_byte_data / write_byte_data / read_i2c_block_data,
    e.g. lib.simbus.SimulatedMax30101Bus.
    """

    CHUNK_SAMPLES = 5   # 5 x 6 bytes = 30 bytes, under the 32-byte SMBus block limit

    def __init__(self, bus=1, address=I2C_ADDRESS):
        self.address = address
        self._own_bus = isinstance(bus, int)
        if self._own_bus:
            try:
                from smbus2 import SMBus
            except ImportError:
                raise SensorError("smbus2 is not installed",
                                  "Run setup_pi.sh, then: source ~/handoff-venv/bin/activate") from None
            try:
                bus = SMBus(bus)
            except FileNotFoundError:
                raise SensorError("/dev/i2c-1 does not exist",
                                  "I2C is off. Run setup_pi.sh (or: sudo raspi-config nonint do_i2c 0) "
                                  "and reboot.") from None
            except PermissionError:
                raise SensorError("no permission to open /dev/i2c-1",
                                  "Add yourself to the i2c group: sudo usermod -aG i2c $USER, "
                                  "then log out and back in.") from None
        self.bus = bus
        self.sample_rate = None
        self.channels = 2

    # -- register access -----------------------------------------------------
    def _read(self, reg):
        return self.bus.read_byte_data(self.address, reg)

    def _write(self, reg, value):
        self.bus.write_byte_data(self.address, reg, value & 0xFF)

    def part_id(self):
        try:
            return self._read(REG_PART_ID)
        except OSError as e:
            raise SensorError(f"no answer from 0x{self.address:02X} ({e})",
                              "The sensor is not on the bus: run i2c_scan.py and re-seat the "
                              "500 mm Qwiic cable at both ends.") from None

    def revision(self):
        return self._read(REG_REV_ID)

    def check_part_id(self):
        pid = self.part_id()
        if pid != PART_ID:
            raise SensorError(f"PART_ID is 0x{pid:02X}, expected 0x{PART_ID:02X}",
                              "Something else answers at 0x57 - is this really a MAX30101?")
        return pid

    def reset(self, timeout_s=1.0):
        """Soft reset (Mode Configuration RESET bit) and wait for it to clear."""
        self._write(REG_MODE_CONFIG, MODE_CONFIG_RESET)
        deadline = time.monotonic() + timeout_s
        while self._read(REG_MODE_CONFIG) & MODE_CONFIG_RESET:
            if time.monotonic() > deadline:
                raise SensorError("reset did not complete", "Power-cycle the Pi and try again.")
            time.sleep(0.005)
        self._read(REG_INTR_STATUS_1)   # clears PWR_RDY
        self._read(REG_INTR_STATUS_2)

    def setup_spo2(self, sample_rate=100, sample_avg=1, pulse_width_us=411,
                   adc_range_na=4096, red_ma=6.2, ir_ma=6.2):
        """Reset, then start SpO2 mode. Output rate = sample_rate / sample_avg."""
        self.reset()
        self._write(REG_INTR_ENABLE_1, 0x00)    # polled: no interrupts
        self._write(REG_INTR_ENABLE_2, 0x00)
        self._write(REG_FIFO_CONFIG, fifo_config_byte(sample_avg, rollover=True))
        self._write(REG_SPO2_CONFIG, spo2_config_byte(adc_range_na, sample_rate, pulse_width_us))
        self._write(REG_LED1_PA, led_amplitude_byte(red_ma))
        self._write(REG_LED2_PA, led_amplitude_byte(ir_ma))
        self.clear_fifo()
        self._write(REG_MODE_CONFIG, MODE_SPO2)
        self.sample_rate = sample_rate / sample_avg
        return self.sample_rate

    def clear_fifo(self):
        """Zero the FIFO pointers and overflow counter (datasheet recommends
        this before starting a new conversion)."""
        self._write(REG_FIFO_WR_PTR, 0)
        self._write(REG_OVF_COUNTER, 0)
        self._write(REG_FIFO_RD_PTR, 0)

    def read_fifo(self):
        """Read every unread sample. Returns ([(red, ir), ...], samples_lost).

        Reading FIFO_DATA advances FIFO_RD_PTR by itself, so the read pointer
        is never written back. Bytes come in 30-byte block reads of 0x07 (the
        register address stays on 0x07, so each read continues the stream).
        """
        wr, ovf, rd = self.bus.read_i2c_block_data(self.address, REG_FIFO_WR_PTR, 3)
        wr, ovf, rd = wr & 0x1F, ovf & 0x1F, rd & 0x1F
        remaining = fifo_available(wr, rd, ovf)
        step = self.channels * BYTES_PER_CHANNEL
        data = bytearray()
        while remaining:
            k = min(remaining, self.CHUNK_SAMPLES)
            data += bytes(self.bus.read_i2c_block_data(self.address, REG_FIFO_DATA, k * step))
            remaining -= k
        return parse_fifo(data, self.channels), ovf

    def read_temperature(self, timeout_s=0.2):
        """Die temperature in degC (datasheet "Temperature Data")."""
        self._write(REG_TEMP_CONFIG, 0x01)
        deadline = time.monotonic() + timeout_s
        while self._read(REG_TEMP_CONFIG) & 0x01:
            if time.monotonic() > deadline:
                return None
            time.sleep(0.005)
        tint = self._read(REG_TEMP_INT)
        if tint > 127:
            tint -= 256
        return tint + (self._read(REG_TEMP_FRAC) & 0x0F) * 0.0625

    def shutdown(self):
        """Power-save mode: LEDs off, registers kept."""
        try:
            self._write(REG_MODE_CONFIG, self._read(REG_MODE_CONFIG) | MODE_CONFIG_SHDN)
        except OSError:
            pass

    def close(self):
        if self._own_bus:
            self.bus.close()


class SensorReader(threading.Thread):
    """Background thread that empties the FIFO every `poll_s` seconds.

    The FIFO holds 32 samples (0.32 s at 100 samples/s); a slow OLED update
    on the main thread must not make it overflow, hence the thread.
    Use drain() from the main thread to collect samples. If samples were
    lost (FIFO overflow), a GAP marker (None) is placed where they are
    missing, so the consumer can call PulseProcessor.discontinuity().
    """

    GAP = None

    def __init__(self, sensor, poll_s=0.03):
        super().__init__(daemon=True)
        self.sensor = sensor
        self.poll_s = poll_s
        self.samples = deque(maxlen=4096)
        self.total = 0
        self.lost = 0
        self.error = None
        self._halt = threading.Event()

    def run(self):
        try:
            while not self._halt.is_set():
                got, lost = self.sensor.read_fifo()
                if lost:
                    self.samples.append(self.GAP)   # the oldest samples were overwritten
                self.samples.extend(got)
                self.total += len(got)
                self.lost += lost
                self._halt.wait(self.poll_s)
        except Exception as e:     # reported to the main thread via .error
            self.error = e

    def drain(self):
        """Everything collected so far: (red, ir) tuples and GAP markers."""
        out = []
        pop = self.samples.popleft
        try:
            while True:
                out.append(pop())
        except IndexError:
            return out

    def stop(self):
        self._halt.set()
        if self.is_alive():
            self.join(timeout=1.0)
