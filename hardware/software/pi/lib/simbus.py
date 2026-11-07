"""A pretend I2C bus with a MAX30101 on it, at register level.

The real Max30101 driver runs unchanged on top of it, so `--simulate` and the
self-tests exercise the same reset / configuration / FIFO-pointer code as the
hardware does. Samples appear in a 32-deep FIFO in real time (or on an
injected clock) at the rate the driver configured.

This is a test double, not a model of every datasheet detail: the revision
ID and die temperature are made-up values.
"""

from __future__ import annotations

import errno
import time

from . import max30101 as mx
from .dsp import PpgSimulator

_RATES = [50, 100, 200, 400, 800, 1000, 1600, 3200]   # SPO2_SR codes 0..7
_AVERAGES = [1, 2, 4, 8, 16, 32, 32, 32]               # SMP_AVE codes 0..7
_SIM_REV_ID = 0x00                                     # made up
_SIM_TEMP = (30, 4)                                    # 30.25 degC, made up


class SimulatedMax30101Bus:
    def __init__(self, simulator=None, clock=time.monotonic, address=mx.I2C_ADDRESS,
                 junk_bits=0b101010):
        self.address = address
        self.clock = clock
        self.sim = simulator or PpgSimulator()
        self.junk_bits = junk_bits & 0x3F    # fills FIFO bits 23:18 to prove they are masked
        self._por()

    # -- internal model --------------------------------------------------------
    def _por(self):
        self.regs = [0] * 256
        self.regs[mx.REG_PART_ID] = mx.PART_ID
        self.regs[mx.REG_REV_ID] = _SIM_REV_ID
        self.regs[mx.REG_INTR_STATUS_1] = 0x01   # PWR_RDY
        self.fifo = [None] * mx.FIFO_DEPTH
        self.wr = self.rd = self.ovf = self.count = 0
        self.byte_cursor = 0
        self.t_last = self.clock()
        self.pending = 0.0

    def _rate(self):
        mode = self.regs[mx.REG_MODE_CONFIG]
        if mode & mx.MODE_CONFIG_SHDN or (mode & 0x07) != mx.MODE_SPO2:
            return 0.0
        sr = _RATES[(self.regs[mx.REG_SPO2_CONFIG] >> 2) & 0x07]
        avg = _AVERAGES[self.regs[mx.REG_FIFO_CONFIG] >> 5]
        return sr / avg

    def _advance(self):
        now = self.clock()
        dt, self.t_last = now - self.t_last, now
        rate = self._rate()
        if rate <= 0:
            self.pending = 0.0
            return
        self.sim.fs = rate
        self.pending += dt * rate
        n = int(self.pending)
        self.pending -= n
        red_scale = self.regs[mx.REG_LED1_PA] / 0x1F
        ir_scale = self.regs[mx.REG_LED2_PA] / 0x1F
        for _ in range(n):
            red, ir = self.sim.sample()
            self._push((min(mx.FULL_SCALE, int(red * red_scale)),
                        min(mx.FULL_SCALE, int(ir * ir_scale))))

    def _push(self, sample):
        rollover = self.regs[mx.REG_FIFO_CONFIG] & 0x10
        if self.count == mx.FIFO_DEPTH:
            self.ovf = min(0x1F, self.ovf + 1)
            if not rollover:
                return                      # new sample lost
            self.rd = (self.rd + 1) % mx.FIFO_DEPTH   # oldest overwritten
            self.count -= 1
            self.byte_cursor = 0
        self.fifo[self.wr] = sample
        self.wr = (self.wr + 1) % mx.FIFO_DEPTH
        self.count += 1

    def _fifo_byte(self):
        if self.count == 0:
            return 0
        word = self.fifo[self.rd][self.byte_cursor // 3]
        word |= self.junk_bits << 18
        byte = (word >> (8 * (2 - self.byte_cursor % 3))) & 0xFF
        self.byte_cursor += 1
        if self.byte_cursor == 6:            # whole sample popped
            self.byte_cursor = 0
            self.rd = (self.rd + 1) % mx.FIFO_DEPTH
            self.count -= 1
            self.ovf = 0
        return byte

    def _check(self, addr):
        if addr != self.address:
            raise OSError(getattr(errno, "EREMOTEIO", 121), "Remote I/O error")

    def _get(self, reg):
        if reg == mx.REG_FIFO_DATA:
            return self._fifo_byte()
        if reg == mx.REG_FIFO_WR_PTR:
            return self.wr
        if reg == mx.REG_OVF_COUNTER:
            return self.ovf
        if reg == mx.REG_FIFO_RD_PTR:
            return self.rd
        value = self.regs[reg]
        if reg in (mx.REG_INTR_STATUS_1, mx.REG_INTR_STATUS_2):
            self.regs[reg] = 0               # cleared on read
        return value

    # -- smbus2-compatible surface ---------------------------------------------
    def read_byte_data(self, addr, reg):
        self._check(addr)
        self._advance()
        return self._get(reg)

    def read_i2c_block_data(self, addr, reg, length):
        self._check(addr)
        self._advance()
        if reg == mx.REG_FIFO_DATA:
            return [self._fifo_byte() for _ in range(length)]
        return [self._get((reg + i) & 0xFF) for i in range(length)]

    def write_byte_data(self, addr, reg, value):
        self._check(addr)
        self._advance()
        if reg == mx.REG_MODE_CONFIG and value & mx.MODE_CONFIG_RESET:
            self._por()
            self.regs[mx.REG_MODE_CONFIG] = 0    # reset bit self-clears
            return
        if reg == mx.REG_FIFO_WR_PTR:
            self.wr = value & 0x1F
        elif reg == mx.REG_OVF_COUNTER:
            self.ovf = value & 0x1F
        elif reg == mx.REG_FIFO_RD_PTR:
            self.rd = value & 0x1F
        elif reg == mx.REG_TEMP_CONFIG and value & 0x01:
            self.regs[mx.REG_TEMP_INT], self.regs[mx.REG_TEMP_FRAC] = _SIM_TEMP
            self.regs[mx.REG_INTR_STATUS_2] = 0x02
            return                               # TEMP_EN self-clears at once
        else:
            self.regs[reg] = value & 0xFF
        if reg in (mx.REG_FIFO_WR_PTR, mx.REG_FIFO_RD_PTR):
            self.count = (self.wr - self.rd) % mx.FIFO_DEPTH
            self.byte_cursor = 0

    def write_quick(self, addr):
        self._check(addr)

    def read_byte(self, addr):
        self._check(addr)
        return 0

    def close(self):
        pass
