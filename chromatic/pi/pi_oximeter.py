#!/usr/bin/env python3
"""MVP, Raspberry Pi side (runs at boot as cmx-oximeter.service; no Mac needed).

finger on the MAX30102 -> heart rate (beat by beat) -> standard BLE Heart Rate (0x180D) sensor "PI-HRM" -> the
Chromatic connects by itself and shows it. Also sent to the hub. SpO2 is not reported until the sensor is calibrated.

Sent to the handheld every 0.25 s while connected (so it always knows the state):
  HR flags 0x04 + HR 0   -> no finger on the sensor
  HR flags 0x06 + HR 0   -> finger on, measuring / hold still (no valid reading yet)
  HR flags 0x06 + HR n   -> live heart rate (median of the last estimates; held through <= 3 s glitches)
Latency: finger seen within 0.25 s; heart rate (HeartPy) ~3 s after the finger is still. A reading is shown only when
two estimates in a row agree within 10 %, so noise (which HeartPy also turns into a "rate") never shows.
LED current is fixed: changing it mid-reading restarts the signal, and 0x18-0x3C were all 100 % valid in the trials.
Log: /home/cmx/vitals.jsonl (state changes + readings), journalctl -u cmx-oximeter.
"""
import json, os, queue, signal, sys, threading, time, urllib.request
import dbus, dbus.mainloop.glib
import RPi.GPIO as GPIO
from gi.repository import GLib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from max30102 import Max30102, estimate, FS          # noqa: E402
from pi_hr_sensor import Adv, App, Chr, Svc, BUS, PROPS, GATT_MGR, ADV_MGR   # noqa: E402

VLOG = open("/home/cmx/vitals.jsonl", "a")
LED = 0x24
WIN = int(FS * 4)                          # analysis window
HOLD_S = 3.0                               # keep showing the last good HR through short glitches


# Hub (hub.py on this Pi): every reading also goes there, so the phone and dashboard see it. Never blocks the sensor.
HUB = os.environ.get("HUB_URL", "http://127.0.0.1:8000/send")
_hubq = queue.Queue(maxsize=50)


def _hub_worker():
    up = None
    while True:
        at, body = _hubq.get()
        if time.monotonic() - at > 1:
            continue                                # never deliver an old reading as if it were current
        try:
            urllib.request.urlopen(urllib.request.Request(HUB, body, {"Content-Type": "application/json"}),
                                   timeout=1).read()
            ok, err = True, None
        except Exception as e:                      # hub down: the handheld still gets everything over BLE
            ok, err = False, str(e)
        if ok != up:
            up = ok
            say(True, ev="hub_up" if ok else "hub_down", e=err)


threading.Thread(target=_hub_worker, daemon=True).start()


def hub(what, value):
    item = (time.monotonic(), json.dumps({"from": "pi", "what": what, "value": value}).encode())
    while True:
        try:
            return _hubq.put_nowait(item)
        except queue.Full:                          # keep the newest: drop the oldest
            try:
                _hubq.get_nowait()
            except queue.Empty:
                pass


def say(log, **k):
    k.setdefault("t", round(time.time(), 3))
    line = json.dumps(k)
    print(line, flush=True)
    if log:
        try:
            VLOG.write(line + "\n"); VLOG.flush()
        except OSError:
            pass                                    # a full disk must not stop the sensor


def main():
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    ad = "/org/bluez/hci0"
    dbus.Interface(bus.get_object(BUS, ad), PROPS).Set("org.bluez.Adapter1", "Powered", dbus.Boolean(1))
    app = App(bus)
    hr = Svc(bus, "/cmx/s0", "180D")
    meas = Chr(bus, "/cmx/s0/c0", "2A37", hr.path, ["notify"])
    hr.chrs = [meas, Chr(bus, "/cmx/s0/c1", "2A38", hr.path, ["read"], b"\x03")]      # body location: finger
    plx = Svc(bus, "/cmx/s1", "1822")
    cont = Chr(bus, "/cmx/s1/c0", "2A5F", plx.path, ["notify"])
    plx.chrs = [cont, Chr(bus, "/cmx/s1/c1", "2A60", plx.path, ["read"], b"\x00\x00")]
    app.svcs = [hr, plx]
    Adv(bus)
    loop = GLib.MainLoop()
    gm = dbus.Interface(bus.get_object(BUS, ad), GATT_MGR)
    am = dbus.Interface(bus.get_object(BUS, ad), ADV_MGR)
    gm.RegisterApplication("/cmx", {}, reply_handler=lambda: say(False, ev="gatt_registered"),
                           error_handler=lambda e: (say(True, ev="gatt_error", e=str(e)), loop.quit()))
    am.RegisterAdvertisement(Adv.PATH, {}, reply_handler=lambda: say(False, ev="advertising", name="PI-HRM"),
                             error_handler=lambda e: (say(True, ev="adv_error", e=str(e)), loop.quit()))

    om = dbus.Interface(bus.get_object(BUS, "/"), "org.freedesktop.DBus.ObjectManager")

    def connected_devices():
        try:
            objs = om.GetManagedObjects(timeout=2)     # runs on the main loop: never block it for long
        except dbus.DBusException as e:
            say(False, ev="dbus_error", e=str(e))
            return []
        return [p for p, ifs in objs.items()
                if ifs.get("org.bluez.Device1", {}).get("Connected") and str(p).startswith(ad)]

    def drop(path, why):
        try:
            dbus.Interface(bus.get_object(BUS, path), "org.bluez.Device1").Disconnect(timeout=2)
            say(True, ev="dropped_link", dev=str(path).split("dev_")[-1], why=why)
        except dbus.DBusException as e:
            say(True, ev="drop_failed", e=str(e))

    # A handheld still connected from before this process started is subscribed to GATT objects that no longer
    # exist: it would get no data ("SIGNAL LOST"). Drop it so it reconnects and subscribes to us.
    for p in connected_devices():
        drop(p, "stale link from before restart")

    GPIO.setmode(GPIO.BCM)
    GPIO.setup(17, GPIO.IN, pull_up_down=GPIO.PUD_UP)    # MARK button: pin 11 to ground (pin 9)
    st = {"m": None, "err": 0, "got_at": time.time(), "I": [], "finger": False, "base": 15000.0, "ac_ok": [],
          "hist": [], "recent": [], "last_ok": 0.0, "hr": 0, "state": None, "linked": False, "btn": False,
          "marks": 0, "unsub_at": None, "dev_at": 0.0}
    # base: no-finger IR level, first guess 15k (11-16k measured), then learned from this sensor and room

    def sample():
        try:
            if st["m"] is None and st["err"] % 25:         # after an error, retry the sensor about once a second
                st["err"] += 1
            else:
                if st["m"] is None:
                    st["m"] = Max30102(led=LED)
                    say(True, ev="sensor_ready")
                new = [i for _, i in st["m"].read()]
                if st["m"].lost:                           # samples were dropped: the window would have a gap
                    st["I"] = []
                if new:
                    st["I"], st["got_at"], st["err"] = (st["I"] + new)[-WIN:], time.time(), 0
        except OSError as e:                               # unplugged / I2C glitch
            if not st["err"]:
                say(True, ev="sensor_error", e=str(e))
            st["err"] += 1
            st["m"], st["I"] = None, []
        try:
            pressed = GPIO.input(17) == 0                  # polled every 40 ms, which also debounces
            if pressed and not st["btn"]:
                st["marks"] += 1
                say(True, ev="mark", n=st["marks"])
                hub("mark", st["marks"])
            st["btn"] = pressed
        except Exception as e:
            say(False, ev="button_error", e=str(e))
        return True

    def state(s, **k):
        if s != st["state"]:
            st["state"] = s
            say(True, ev="state", state=s, **k)
        hub("state", s)                                    # every tick, so a lost update heals itself

    def read_finger(now):
        """None = sensor not readable, False = no finger, True = finger. Thresholds follow the learned no-finger
        level, so ambient light and different sensors don't matter."""
        if st["err"] or now - st["got_at"] > 0.5:          # error, or the sensor silently stopped sending
            return None
        I = st["I"]
        if len(I) < 10:
            return st["finger"] or False
        dc = sum(I[-10:]) / 10
        if not st["finger"]:
            if dc < 1.3 * st["base"]:                      # learn only from readings that look like no finger
                st["base"] = min(max(dc if dc < st["base"] else st["base"] + 0.01 * (dc - st["base"]), 3000), 30000)
            return dc > 2 * st["base"]
        return dc > 1.6 * st["base"]

    def reading(now):
        """-> (state, hr). A number only after 3 agreeing estimates (then 2), median of the last 2 s; otherwise
        the reason. A value is held through up to 3 s of noise only, never through movement or saturation."""
        e = estimate(st["I"])
        st["recent"] = r = (st["recent"] + [e["hr"]])[-3:]
        need = r if not st["hist"] else r[-2:]
        if all(need) and len(need) >= (2 if st["hist"] else 3) and max(need) - min(need) <= 0.1 * min(need):
            st["hist"] = (st["hist"] + [e["hr"]])[-8:]
            st["ac_ok"] = (st["ac_ok"] + [e["ac"]])[-20:]          # this person's clean pulse swing
            st["last_ok"] = now
            return "live", sorted(st["hist"])[len(st["hist"]) // 2]
        if e["why"] in ("noisy", None) and now - st["last_ok"] <= HOLD_S and st["hr"]:
            return "live", st["hr"]
        st["hist"] = []
        ref = sorted(st["ac_ok"])[len(st["ac_ok"]) // 2] if st["ac_ok"] else None
        if e["why"] == "noisy" and ref:
            return ("moving" if e["ac"] > 3 * ref else "weak"), 0
        return e["why"] or "measuring", 0

    def tick():
        now = time.time()
        try:
            finger = read_finger(now)
            if finger and not st["finger"]:
                st["hist"], st["recent"], st["ac_ok"], st["last_ok"] = [], [], [], 0.0
            st["finger"] = finger
            if finger is None:
                s, hr = "sensor_error", 0
            elif not finger:
                s, hr = "no_finger", 0
            else:
                s, hr = reading(now)
        except Exception as e:                             # never let a bug freeze the last value on screen
            say(True, ev="tick_error", e=repr(e))
            s, hr = "sensor_error", 0
        if hr != st["hr"] and hr:
            say(True, hr=hr)
        st["hr"] = hr
        state(s)
        try:
            # handheld: nothing while the sensor is unreadable (it shows signal lost), else every tick
            linked = st["linked"] if st["finger"] is None else meas.notify(bytes([0x06 if st["finger"] else 0x04, min(hr, 250)]))
            hub("finger", {None: "error", False: "off", True: "on"}[st["finger"]])
            hub("hr", hr or None)                          # None = no valid reading (never a stale number)
            if linked != st["linked"]:
                st["linked"] = linked
                say(True, ev="handheld", subscribed=bool(linked))
                if linked:
                    st["unsub_at"] = None
            # watchdog: connected but nobody subscribed for > 6 s -> drop the link so the handheld starts over
            if not linked and now - st["dev_at"] >= 1:
                st["dev_at"] = now
                devs = connected_devices()
                if not devs:
                    st["unsub_at"] = None
                elif not st["unsub_at"]:
                    st["unsub_at"] = now
                elif now - st["unsub_at"] > 6:
                    for p in devs:
                        drop(p, "connected but not subscribed")
                    st["unsub_at"] = None
        except Exception as e:
            say(True, ev="link_error", e=repr(e))
        return True

    GLib.timeout_add(40, sample)
    GLib.timeout_add(250, tick)
    GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGTERM, loop.quit)   # systemd stop: still turn the LEDs off
    say(True, ev="ready")
    try:
        loop.run()
    finally:
        if st["m"]:
            st["m"].close()


if __name__ == "__main__":
    main()
