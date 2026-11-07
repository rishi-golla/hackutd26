import itertools

import pytest

from lib import i2cscan, oled, pihealth, wires


# -- i2cscan -----------------------------------------------------------------------

HDR = "     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f\n"


def i2c_row(row, cells):
    return f"{row:02x}: " + " ".join(cells.get(c, "--") for c in range(16)) + "\n"


def test_parse_i2cdetect_cells():
    text = (HDR + "00:                         -- -- -- -- -- -- -- --\n"
            + i2c_row(0x30, {0: "30", 15: "3f"}) + i2c_row(0x50, {7: "57"})
            + i2c_row(0x60, {8: "UU"}) + i2c_row(0x70, {7: "77"}))
    assert i2cscan.parse_i2cdetect(text) == [0x30, 0x3F, 0x57, 0x68, 0x77]


def test_parse_i2cdetect_empty_and_garbage():
    assert i2cscan.parse_i2cdetect("") == []
    assert i2cscan.parse_i2cdetect(HDR + "Error: Could not open file\n") == []
    assert i2cscan.parse_i2cdetect(HDR + i2c_row(0x10, {})) == []


def test_diagnose_cases():
    assert i2cscan.diagnose([0x3C, 0x57])[0] and i2cscan.diagnose([0x3D, 0x57])[0]
    ok, lines = i2cscan.diagnose([0x3C, 0x3D, 0x57])
    assert not ok and "Both" in " ".join(lines)
    ok, lines = i2cscan.diagnose([0x57])
    assert ok and lines == []                                # OLED is optional
    ok, lines = i2cscan.diagnose([0x20])
    assert not ok and "MAX30101 missing" in " ".join(lines) and "SHIM" in " ".join(lines)
    ok, lines = i2cscan.diagnose([0x3D, 0x57, 0x20])
    assert ok and "0x20" in " ".join(lines)
    ok, lines = i2cscan.diagnose(list(range(0x08, 0x08 + 21)))
    assert not ok and "shorted" in " ".join(lines)


@pytest.mark.parametrize("found, ok, must_have, must_not_have", [
    ([0x57], True, [], ["missing", "Nothing answered"]),
    ([0x3D, 0x57], True, [], ["missing", "Both"]),
    ([0x3C, 0x57], True, [], ["missing", "Both"]),
    ([0x3C, 0x3D, 0x57], False, ["Both 0x3C and 0x3D"], ["missing"]),
    ([0x3D], False, ["MAX30101 missing", "OLED answers", "500 mm cable"], ["Nothing answered"]),
    ([], False, ["Nothing answered", "SHIM", "500 mm cable"], ["MAX30101 missing"]),
    ([0x20], False, ["MAX30101 missing", "500 mm cable", "0x20"], ["OLED answers"]),
    ([0x57, 0x20], True, ["Unexpected device(s): 0x20"], ["missing"]),
])
def test_diagnose_optional_oled(found, ok, must_have, must_not_have):
    got_ok, lines = i2cscan.diagnose(found)
    text = " ".join(lines)
    assert got_ok is ok
    for s in must_have:
        assert s in text
    for s in must_not_have:
        assert s not in text


# -- i2c_scan.py main() ------------------------------------------------------------

def run_i2c_scan(monkeypatch, capsys, found):
    import i2c_scan
    monkeypatch.setattr(i2cscan, "scan", lambda bus=1: found)
    monkeypatch.setattr("sys.argv", ["i2c_scan.py"])
    code = i2c_scan.main()
    return code, capsys.readouterr().out


def test_i2c_scan_main_sensor_ok(monkeypatch, capsys):
    code, out = run_i2c_scan(monkeypatch, capsys, [0x57])
    assert code == 0
    assert "RESULT: OK - the sensor answers." in out
    assert "0x57" in out and "MAX30101" in out


def test_i2c_scan_main_nothing_found(monkeypatch, capsys):
    code, out = run_i2c_scan(monkeypatch, capsys, [])
    assert code == 1
    assert "RESULT: PROBLEM" in out and "RESULT: OK" not in out
    assert "Found no devices." in out


# -- pihealth ----------------------------------------------------------------------

def test_throttled():
    assert pihealth.decode_throttled(1 << 3) == ["soft temperature limit active NOW"]
    assert len(pihealth.decode_throttled(0xF000F)) == 8
    assert pihealth.decode_throttled(0x20) == []                 # undefined bit
    assert pihealth.parse_throttled("throttled=0x0") == 0
    assert pihealth.parse_throttled("") is None and pihealth.parse_throttled(None) is None
    assert pihealth.parse_throttled("nonsense") is None
    assert "Power supply" in pihealth.throttle_advice(0x1)
    assert pihealth.throttle_advice(0) == ""


def test_nmcli_edge_cases():
    assert pihealth.parse_nmcli_wifi("") == (None, None)
    assert pihealth.parse_nmcli_wifi(None) == (None, None)
    assert pihealth.parse_nmcli_wifi("yes:Home:55") == ("Home", 55)
    assert pihealth.parse_nmcli_wifi("yes:a\\:b\\:c:7\n") == ("a:b:c", 7)
    assert pihealth.parse_nmcli_wifi("yes:Home:\n") == ("Home", None)
    assert pihealth.parse_nmcli_wifi("yes::40") == ("", 40)


def test_parse_ip_addr():
    text = ("2: eth0    inet 10.0.0.5/24 brd 10.0.0.255 scope global eth0\n"
            "3: wlan0    inet 192.168.1.9/24 scope global wlan0\n"
            "3: wlan0    inet 192.168.1.10/24 scope global secondary wlan0\n")
    assert pihealth.parse_ip_addr(text) == {"eth0": "10.0.0.5", "wlan0": "192.168.1.9"}
    assert pihealth.parse_ip_addr("") == {} and pihealth.parse_ip_addr(None) == {}


# -- wires -------------------------------------------------------------------------

LABELS = list("abcdef")
ROLES = ["common", "red", "green", "blue", "sw", "sw"]


def solve(truth, labels=LABELS):
    gen = wires.identify(labels)
    probe = next(gen)
    try:
        while True:
            probe = gen.send(wires.simulate_answer(truth, *probe))
    except StopIteration as stop:
        return stop.value


@pytest.mark.parametrize("polarity", ["anode", "cathode"])
def test_wires_all_permutations(polarity):
    for perm in set(itertools.permutations(ROLES)):
        truth = dict(zip(LABELS, perm), _polarity=polarity)
        res = solve(truth)
        assert res["polarity"] == f"common {polarity}"
        for role in ("common", "red", "green", "blue"):
            assert truth[res[role]] == role
        assert sorted(truth[w] for w in res["switch"]) == ["sw", "sw"]


def test_wires_bad_labels():
    for labels in (list("abcde"), list("aabcde")):
        with pytest.raises(wires.WireError):
            next(wires.identify(labels))


def test_wires_nothing_ever_lights():
    gen = wires.identify(LABELS)
    next(gen)
    with pytest.raises(wires.WireError):
        while True:
            gen.send("none")


def test_wires_inconsistent_answers():
    truth = dict(zip(LABELS, ROLES), _polarity="anode")
    gen = wires.identify(LABELS)
    probe = next(gen)
    with pytest.raises(wires.WireError):      # red reported for every probe
        while True:
            seen = "red" if wires.simulate_answer(truth, *probe) != "none" else "none"
            if seen == "none":
                seen = "red" if probe[0] == "a" and probe[1] != "b" else "none"
            probe = gen.send(seen)
    gen = wires.identify(LABELS)
    next(gen)
    with pytest.raises(wires.WireError):      # always lit: first colour repeats in step 2
        for _ in range(20):
            gen.send("red")


# -- oled.scale_wave -----------------------------------------------------------------

def test_scale_wave():
    assert oled.scale_wave([], 0, 0, 9, 9) == []
    assert oled.scale_wave([5, 5, 5], 0, 10, 9, 30) == [(7, 20), (8, 20), (9, 20)]   # flat -> centred
    pts = oled.scale_wave([0, 1, 2], 0, 0, 9, 10)
    assert pts == [(7, 10), (8, 5), (9, 0)]                  # max at top, min at bottom, right-aligned
    pts = oled.scale_wave(list(range(100)), 10, 0, 19, 8)
    assert len(pts) == 10 and pts[0][0] == 10 and pts[-1][0] == 19
    assert min(p[1] for p in pts) == 0 and max(p[1] for p in pts) == 8
    assert all(0 <= y <= 8 for _, y in pts)
