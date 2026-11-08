#!/usr/bin/env python3
"""Finger sensor service on the Pi (cmx-oximeter.service, starts at boot).

It reads the MAX30102 every 40 ms and works out the heart rate every 0.25 s. It sends the rate to the Chromatic as
a standard Bluetooth heart-rate sensor named "PI-HRM", and sends the rate plus the reason for any missing reading
(state) to the hub, with an experimental SpO2 while a rate is shown.

Each 0.25 s the handheld gets flags 0x04 with rate 0 when there is no finger, flags 0x06 with rate 0 while measuring,
and flags 0x06 with the rate once a reading is trusted. The first reading needs 3 estimates in a row that agree
within 10 %, so noise never shows as a rate. It appears about 3 s after a firm, still finger.
The LED current is fixed, because changing it mid-reading restarts the signal (0x18-0x3C all worked in the trials).
Logs go to /home/cmx/vitals.jsonl and journalctl -u cmx-oximeter.
"""
import json, os, queue, signal, sys, threading, time, urllib.request
import dbus, dbus.mainloop.glib
import RPi.GPIO as GPIO
from gi.repository import GLib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from max30102 import Max30102, estimate, shown, spo2, steady_spo2, FS, WIN   # noqa: E402
from pi_hr_sensor import Adv, App, Chr, Svc, BUS, PROPS, GATT_MGR, ADV_MGR   # noqa: E402

VLOG = open("/home/cmx/vitals.jsonl", "a")
LED = 0x24
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


_sent = {}                                          # what -> (value, when it was last queued)


def hub(what, value):
    """Queue a message for the hub when the value changes, else at most once a second: each message wakes every
    viewer, and the repeat is enough for viewers to notice a source that went quiet."""
    now = time.monotonic()
    last = _sent.get(what)
    if last and last[0] == value and now - last[1] < 1:
        return
    _sent[what] = (value, now)
    item = (now, json.dumps({"from": "pi", "what": what, "value": value}).encode())
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
    app.svcs = [hr]
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
    st = {"m": None, "err": 0, "got_at": time.time(), "R": [], "I": [], "o2": [], "finger": False, "base": 15000.0, "ac_ok": [],
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
                new = st["m"].read()
                if st["m"].lost:                           # samples were dropped: the window would have a gap
                    st["R"], st["I"] = [], []
                if new:
                    st["R"] = (st["R"] + [r for r, _ in new])[-WIN:]
                    st["I"], st["got_at"], st["err"] = (st["I"] + [i for _, i in new])[-WIN:], time.time(), 0
        except OSError as e:                               # unplugged / I2C glitch
            if not st["err"]:
                say(True, ev="sensor_error", e=str(e))
            st["err"] += 1
            st["m"], st["R"], st["I"] = None, [], []
        pressed = GPIO.input(17) == 0                      # polled every 40 ms, which also debounces
        if pressed and not st["btn"]:
            st["marks"] += 1
            say(True, ev="mark", n=st["marks"])
            hub("mark", st["marks"])
        st["btn"] = pressed
        return True

    def state(s, **k):
        if s != st["state"]:
            st["state"] = s
            say(True, ev="state", state=s, **k)
        hub("state", s)                                    # repeated each second, so a lost update heals itself

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
        """Returns (state, rate). The rate is 0 with a reason as the state until a reading is trusted (see shown()).
        A trusted rate is held through up to 3 s of noise, never through movement or saturation."""
        e = estimate(st["I"])
        hr = shown(st["recent"], st["hist"], e["hr"])
        if hr:
            st["ac_ok"] = (st["ac_ok"] + [e["ac"]])[-20:]          # this person's clean pulse swing
            st["last_ok"] = now
            return "live", hr
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
            if not hr:
                st["o2"] = []
            o2 = steady_spo2(st["o2"], spo2(st["R"], st["I"])) if hr else None
        except Exception as e:                             # never let a bug freeze the last value on screen
            say(True, ev="tick_error", e=repr(e))
            s, hr, o2 = "sensor_error", 0, None
        if hr != st["hr"] and hr:
            say(True, hr=hr)
        st["hr"] = hr
        state(s)
        try:
            # the handheld gets nothing while the sensor is unreadable (it then shows signal lost), else every tick
            linked = st["linked"]
            if st["finger"] is not None:
                linked = meas.notify(bytes([0x06 if st["finger"] else 0x04, min(hr, 250)]))
            hub("finger", {None: "error", False: "off", True: "on"}[st["finger"]])
            hub("hr", hr or None)                          # None = no valid reading (never a stale number)
            hub("spo2", o2)
            if linked != st["linked"]:
                st["linked"] = linked
                say(True, ev="handheld", subscribed=bool(linked))
                if linked:
                    st["unsub_at"] = None
            # a handheld connected for over 6 s without subscribing is stuck: drop it so it reconnects
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
