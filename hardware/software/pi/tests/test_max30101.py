import pytest

from lib import max30101 as mx
from lib.simbus import SimulatedMax30101Bus


# -- pure helpers ------------------------------------------------------------------

def test_spo2_config_byte_fields():
    assert mx.spo2_config_byte() == 0x27
    assert mx.spo2_config_byte(16384, 3200, 69) == (0b11 << 5) | (0b111 << 2) | 0b00
    assert mx.spo2_config_byte(2048, 50, 118) == 0b01
    for bad in [dict(adc_range_na=1), dict(sample_rate=123), dict(pulse_width_us=100)]:
        with pytest.raises(ValueError):
            mx.spo2_config_byte(**bad)


def test_fifo_config_byte():
    assert mx.fifo_config_byte(32, True, 0x0F) == (0b101 << 5) | 0x10 | 0x0F
    assert mx.fifo_config_byte(1, False, 0x1F) == 0x0F       # almost_full masked to 4 bits
    with pytest.raises(ValueError):
        mx.fifo_config_byte(3)


def test_led_amplitude_byte_clamps():
    assert mx.led_amplitude_byte(0) == 0
    assert mx.led_amplitude_byte(0.1) in (0, 1)
    assert mx.led_amplitude_byte(51) == 255 and mx.led_amplitude_byte(1000) == 255
    assert mx.led_amplitude_byte(-5) == 0


def test_fifo_available_full_table():
    for wr in range(32):
        for rd in range(32):
            expected = (wr - rd) % 32
            assert mx.fifo_available(wr, rd, 0) == expected
            assert mx.fifo_available(wr, rd, 3) == (32 if wr == rd else expected)
    assert mx.fifo_available(0, 31, 0) == 1


def test_parse_fifo():
    assert mx.parse_fifo(b"") == []
    assert mx.parse_fifo(bytes(5)) == []                    # less than one sample
    assert mx.parse_fifo(bytes([0x01, 0x02, 0x03]), channels=1) == [(0x010203,)]
    assert mx.parse_fifo(bytes([0xFF, 0xFF, 0xFF, 0, 0, 1]), 1) == [(0x3FFFF,), (1,)]
    assert mx.parse_fifo(bytes([0xFC, 0, 0]), 1) == [(0,)]                 # bits 23:18 masked
    assert mx.parse_fifo(bytes([0x03, 0xFF, 0xFF, 0xAB]), 1) == [(0x3FFFF,)]  # trailing byte ignored
    assert mx.parse_fifo(bytes(range(9)), channels=3) == [(0x000102, 0x030405, 0x060708 & 0x3FFFF)]


# -- driver on the simulated bus -----------------------------------------------------

class Counter:
    """Simulator stand-in: sample k is (k, k + 1000), so loss/reorder is visible."""
    fs = 100.0

    def __init__(self):
        self.k = 0

    def sample(self):
        self.k += 1
        return self.k - 1, self.k - 1 + 1000


def make(junk_bits=0b101010):
    t = [0.0]
    sim = Counter()
    bus = SimulatedMax30101Bus(simulator=sim, clock=lambda: t[0], junk_bits=junk_bits)
    s = mx.Max30101(bus)
    s.setup_spo2()
    return s, t, sim


def test_driver_pointer_wraparound_many_reads():
    s, t, sim = make()
    got_all = []
    for _ in range(200):                       # 200 x 0.07 s = 1400 samples, > 40 FIFO wraps
        t[0] += 0.07
        got, lost = s.read_fifo()
        assert lost == 0
        got_all += got
    assert got_all == [(i, i + 1000) for i in range(len(got_all))]   # contiguous, in order
    assert abs(len(got_all) - 1400) <= 1


def test_driver_overflow_loses_oldest_and_counts():
    s, t, sim = make()
    t[0] += 0.5                                # 50 samples into a 32-deep FIFO
    got, lost = s.read_fifo()
    assert len(got) == 32 and lost == 18
    assert got[0][0] == 18 and got[-1][0] == 49           # rollover keeps the newest
    t[0] += 0.1001
    got, lost = s.read_fifo()
    assert lost == 0 and got[0][0] == 50 and len(got) == 10


def test_driver_exactly_full_fifo():
    # Exactly 32 unread samples: WR_PTR == RD_PTR and OVF_COUNTER == 0, which the
    # chip cannot tell apart from empty (see fifo_available). The read returns
    # nothing; one sample later OVF is set and all 32 come back with lost == 1.
    s, t, _ = make()
    t[0] += 0.3201
    assert s.read_fifo() == ([], 0)
    t[0] += 0.01
    got, lost = s.read_fifo()
    assert len(got) == 32 and lost == 1


def test_driver_empty_read():
    s, t, _ = make()
    assert s.read_fifo() == ([], 0)


def test_driver_masks_junk_bits():
    s, t, _ = make(junk_bits=0b111111)
    t[0] += 0.2
    got, _ = s.read_fifo()
    assert got == [(i, i + 1000) for i in range(20)]


def test_sensor_reader_marks_lost_samples_with_gap():
    class ScriptedSensor:
        reads = [([(1, 2)], 0), ([(3, 4), (5, 6)], 7)]

        def read_fifo(self):
            if not self.reads:
                raise EOFError("script finished")      # ends the reader thread
            return self.reads.pop(0)

    reader = mx.SensorReader(ScriptedSensor(), poll_s=0.0)
    reader.start()
    reader.join(timeout=2)
    assert isinstance(reader.error, EOFError)
    assert reader.drain() == [(1, 2), mx.SensorReader.GAP, (3, 4), (5, 6)]
    assert reader.lost == 7 and reader.total == 3
