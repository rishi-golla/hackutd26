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
import json, os, queue, sys, threading, time, urllib.request
import dbus, dbus.mainloop.glib
import RPi.GPIO as GPIO
from gi.repository import GLib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from max30102 import Max30102, estimate, FS          # noqa: E402
from pi_hr_sensor import Adv, App, Chr, Svc, BUS, PROPS, GATT_MGR, ADV_MGR   # noqa: E402

VLOG = open("/home/cmx/vitals.jsonl", "a")
FINGER_ON, FINGER_OFF = 40000, 25000       # IR DC hysteresis (no finger ~11k, finger 70k-240k)
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
        if time.monotonic() - at > 2:
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
    try:
        _hubq.put_nowait((time.monotonic(), json.dumps({"from": "pi", "what": what, "value": value}).encode()))
    except queue.Full:
        pass


def say(log, **k):
    k.setdefault("t", round(time.time(), 3))
    line = json.dumps(k)
    print(line, flush=True)
    if log:
        VLOG.write(line + "\n"); VLOG.flush()


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
        out = []
        for path, ifs in om.GetManagedObjects().items():
            d = ifs.get("org.bluez.Device1")
            if d and d.get("Connected") and str(path).startswith(ad):
                out.append((path, str(d.get("Address"))))
        return out

    def drop(path, why):
        try:
            dbus.Interface(bus.get_object(BUS, path), "org.bluez.Device1").Disconnect()
            say(True, ev="dropped_link", dev=str(path).split("dev_")[-1], why=why)
        except dbus.DBusException as e:
            say(True, ev="drop_failed", e=str(e))

    # A handheld still connected from before this process started is subscribed to GATT objects that no longer
    # exist: it would get no data ("SIGNAL LOST"). Drop it so it reconnects and subscribes to us.
    for p, _ in connected_devices():
        drop(p, "stale link from before restart")

    m = Max30102(led=LED)
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(17, GPIO.IN, pull_up_down=GPIO.PUD_UP)    # MARK button: pin 11 to ground (pin 9)
    st = {"I": [], "finger": False, "hist": [], "prev": None, "last_ok": 0.0, "hr": 0, "state": None,
          "linked": False, "btn": False, "marks": 0, "unsub_at": None, "dev_at": 0.0}

    def sample():
        try:
            st["I"] = (st["I"] + [i for _, i in m.read()])[-WIN:]
        except OSError as e:
            say(True, ev="i2c_error", e=str(e))
        pressed = GPIO.input(17) == 0                     # polled every 40 ms, which also debounces
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
            hub("state", s)

    def tick():
        now = time.time()
        I = st["I"]
        dc = sum(I[-10:]) / max(1, len(I[-10:])) if I else 0
        # finger on/off with hysteresis
        if not st["finger"] and dc > FINGER_ON:
            st["finger"], st["hist"], st["prev"], st["last_ok"] = True, [], None, 0.0
            state("measuring", why="finger_on")
        elif st["finger"] and dc < FINGER_OFF:
            st["finger"], st["hist"], st["hr"] = False, [], 0
        # estimate
        if not st["finger"]:
            state("no_finger", dc=int(dc))
        else:
            e = estimate(st["I"], finger_dc=FINGER_OFF)
            agree = e["hr"] and st["prev"] and abs(e["hr"] - st["prev"]) <= 0.1 * st["prev"]
            st["prev"] = e["hr"]
            if agree:
                st["hist"] = (st["hist"] + [e["hr"]])[-5:]
                hr = sorted(st["hist"])[len(st["hist"]) // 2]
                st["last_ok"] = now
                state("live")
                if hr != st["hr"]:
                    say(True, hr=hr, raw=e["hr"], q=e["q"])
                st["hr"] = hr
            elif now - st["last_ok"] > HOLD_S:
                st["hr"], st["hist"] = 0, []
                state("measuring", why="motion" if e["q"] == -1 else "weak_signal")
        # tell the handheld (every tick, whatever the state)
        flags = 0x06 if st["finger"] else 0x04
        bpm = max(0, min(250, int(st["hr"]))) if st["finger"] else 0
        linked = meas.notify(bytes([flags, bpm]))
        hub("finger", "on" if st["finger"] else "off")
        hub("hr", bpm or None)                              # None = no valid reading (never a stale number)
        if linked != st["linked"]:
            st["linked"] = linked
            say(True, ev="handheld", subscribed=bool(linked))
        # watchdog: connected but nobody subscribed for > 6 s -> drop the link so the handheld starts over
        if linked:
            st["unsub_at"] = None
        if linked or now - st["dev_at"] < 1:                # D-Bus call blocks the loop: once a second is enough
            return True
        st["dev_at"] = now
        devs = connected_devices()
        if not devs:
            st["unsub_at"] = None
        elif not st["unsub_at"]:
            st["unsub_at"] = now
        elif now - st["unsub_at"] > 6:
            for p, _ in devs:
                drop(p, "connected but not subscribed")
            st["unsub_at"] = None
        return True

    GLib.timeout_add(40, sample)
    GLib.timeout_add(250, tick)
    say(True, ev="ready")
    try:
        loop.run()
    finally:
        m.close()


if __name__ == "__main__":
    main()
