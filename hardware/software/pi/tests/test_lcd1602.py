import pytest

from lib import i2cscan, lcd1602

ADDR = 0x27
EN, RS, BL = 0x04, 0x01, 0x08


# -- fit ---------------------------------------------------------------------------

def test_fit_pads_and_truncates():
    assert lcd1602.fit("hi") == "hi" + " " * 14
    assert lcd1602.fit("") == " " * 16
    assert lcd1602.fit("x" * 40) == "x" * 16
    assert lcd1602.fit("abcdef", 4) == "abcd"


def test_fit_non_ascii_becomes_question_mark():
    assert lcd1602.fit("café ❤\n\x7f") == "caf? ???".ljust(16)


# -- vitals_lines ------------------------------------------------------------------

@pytest.mark.parametrize("status", list(lcd1602.STATUS_SHORT) + ["something odd"])
@pytest.mark.parametrize("link", [None, *lcd1602.LINK_SHORT, "weird"])
def test_vitals_lines_always_16_chars(status, link):
    l1, l2 = lcd1602.vitals_lines(72, 98, status, link)
    assert len(l1) == 16 and len(l2) == 16


@pytest.mark.parametrize("hr,spo2,expect", [
    (None, None, "HR  --  SpO2  --"),
    (0, 0, "HR  --  SpO2  --"),
    (72, 0, "HR  72  SpO2  --"),
    (0, 97, "HR  --  SpO2  97"),
    (101.6, 96.4, "HR 102  SpO2  96"),
    (60, 100, "HR  60  SpO2 100"),
])
def test_vitals_line1(hr, spo2, expect):
    assert lcd1602.vitals_lines(hr, spo2, "pulse")[0] == expect


def test_vitals_status_text():
    for status, short in lcd1602.STATUS_SHORT.items():
        l2 = lcd1602.vitals_lines(70, 98, status)[1]
        assert l2 == short.ljust(16)
    assert lcd1602.vitals_lines(70, 98, "unknown")[1] == "unknown".ljust(16)


def test_vitals_link_states():
    for link, short in lcd1602.LINK_SHORT.items():
        l2 = lcd1602.vitals_lines(70, 98, "pulse", link)[1]
        assert l2.startswith("pulse")
        assert l2.rstrip().endswith(short)
    # every status combined with a link still keeps the link text visible
    for status in lcd1602.STATUS_SHORT:
        assert "LINK OK" in lcd1602.vitals_lines(70, 98, status, "connected")[1]


# -- Lcd with a fake bus -----------------------------------------------------------

class FakeBus:
    def __init__(self, with_close=True):
        self.writes = []
        self.closed = False
        if with_close:
            self.close = self._close

    def write_byte(self, addr, value):
        self.writes.append((addr, value))

    def _close(self):
        self.closed = True

    def values(self):
        return [v for _, v in self.writes]


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(lcd1602.time, "sleep", lambda s: None)


def decode(values):
    """Bytes sent to the HD44780: [(rs, byte)], from EN falling edges."""
    nibbles, prev = [], 0
    for v in values:
        if prev & EN and not v & EN:
            nibbles.append((prev & RS, prev & 0xF0))
        prev = v
    assert len(nibbles) % 2 == 0
    return [(hi[0], hi[1] | lo[1] >> 4) for hi, lo in zip(nibbles[::2], nibbles[1::2])]


def test_init_writes_to_given_address_with_backlight():
    bus = FakeBus()
    lcd1602.Lcd(bus, 0x3F)
    assert bus.writes
    assert {a for a, _ in bus.writes} == {0x3F}
    assert all(v & BL for v in bus.values())


def test_init_sequence_decodes():
    bus = FakeBus()
    lcd1602.Lcd(bus, ADDR)
    cmds = [b for rs, b in decode(bus.values()) if rs == 0]
    # 8-bit reset nibbles decode as pairs, so just check the tail: function set, display on, entry mode, clear
    assert cmds[-4:] == [0x28, 0x0C, 0x06, 0x01]


def test_show_sends_ddram_addresses_and_padded_text():
    bus = FakeBus()
    lcd = lcd1602.Lcd(bus, ADDR)
    bus.writes.clear()
    lcd.show("HELLO", "WORLD")
    assert {a for a, _ in bus.writes} == {ADDR}
    assert all(v & BL for v in bus.values())
    sent = decode(bus.values())
    assert sent[0] == (0, 0x80)
    assert sent[1:17] == [(1, ord(c)) for c in "HELLO".ljust(16)]
    assert sent[17] == (0, 0xC0)
    assert sent[18:] == [(1, ord(c)) for c in "WORLD".ljust(16)]


def test_show_only_sends_changed_rows():
    bus = FakeBus()
    lcd = lcd1602.Lcd(bus, ADDR)
    lcd.show("HELLO", "WORLD")
    bus.writes.clear()
    lcd.show("HELLO", "WORLD")
    assert bus.writes == []
    lcd.show("HELLO", "THERE")
    sent = decode(bus.values())
    assert sent[0] == (0, 0xC0) and len(sent) == 17
    bus.writes.clear()
    lcd.show("HELLO ", "THERE")   # same after padding
    assert bus.writes == []


def test_close_turns_backlight_off_and_closes_bus():
    bus = FakeBus()
    lcd = lcd1602.Lcd(bus, ADDR)
    lcd.close()
    assert bus.values()[-1] == 0x00
    assert bus.closed


def test_close_without_bus_close_and_keep_backlight():
    bus = FakeBus(with_close=False)
    lcd = lcd1602.Lcd(bus, ADDR)
    lcd.close(backlight_off=False)
    assert bus.values()[-1] & BL


# -- open_lcd ----------------------------------------------------------------------

def test_open_lcd_dummy(monkeypatch):
    monkeypatch.setenv("HANDOFF_LCD", "dummy")
    lcd, addr = lcd1602.open_lcd()
    assert isinstance(lcd, lcd1602.DummyLcd)
    assert addr == 0x27
    lcd.show("a", "b")
    assert lcd.lines == [lcd1602.fit("a"), lcd1602.fit("b")]


# -- i2cscan -----------------------------------------------------------------------

def test_diagnose_with_lcd_is_ok_and_not_unexpected():
    ok, lines = i2cscan.diagnose([0x57, 0x27])
    assert ok
    assert not any("Unexpected device" in l for l in lines)


def test_diagnose_lcd_alone_means_sensor_missing():
    ok, lines = i2cscan.diagnose([0x27])
    assert not ok
    assert any("MAX30101 missing" in l for l in lines)


def test_describe_lcd():
    assert "LCD1602" in i2cscan.describe(0x3F)
    assert "LCD1602" in i2cscan.describe(0x27)


# -- test_lcd.main -----------------------------------------------------------------

def test_lcd_script_main_dummy(monkeypatch, capsys):
    import test_lcd
    monkeypatch.setenv("HANDOFF_LCD", "dummy")
    monkeypatch.setattr("sys.argv", ["test_lcd.py", "--seconds", "0"])
    monkeypatch.setattr(test_lcd.time, "sleep", lambda s: None)
    assert test_lcd.main() == 0
    assert "LCD found at 0x27" in capsys.readouterr().out


def test_lcd_script_main_error_prints_hint(monkeypatch, capsys):
    import test_lcd

    def boom(address=None, bus_number=1):
        raise lcd1602.LcdError("no LCD", "check the wires")

    monkeypatch.setattr(test_lcd.lcd1602, "open_lcd", boom)
    monkeypatch.setattr("sys.argv", ["test_lcd.py", "--seconds", "0"])
    assert test_lcd.main() == 1
    out = capsys.readouterr().out
    assert "ERROR: no LCD" in out and "check the wires" in out
