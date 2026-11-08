#!/usr/bin/env python3
"""Raspberry Pi side: the hospital/ED station. Finds the handheld's "CMX Record" BLE service (no pairing), pulls
the full hash-chained run record, then writes a message to the crew and waits for the medic's "ACK <ms>".
BlueZ D-Bus only (python3-dbus + gi).   sudo python3 pi_ed_station.py [--msg "BAY 3: CT READY"] [--out rec.txt]
Prints JSON lines; the record text goes to --out.
"""
import hashlib, json, struct, sys, time
import dbus, dbus.mainloop.glib
from gi.repository import GLib

SVC = "9c4e0001-6b1d-4c2a-9a5e-c3d1f0a7e101"
U = {k: f"9c4e00{n}-6b1d-4c2a-9a5e-c3d1f0a7e101" for k, n in
     (("REC", "02"), ("CTRL", "03"), ("META", "04"), ("MSG", "05"), ("ACK", "06"))}
MSG_TEXT = sys.argv[sys.argv.index("--msg") + 1] if "--msg" in sys.argv else "BAY 3: CT READY, GO DIRECT"
OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "/home/cmx/record.txt"
BUS = "org.bluez"
P = "org.freedesktop.DBus.Properties"
dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SystemBus()
ctx = GLib.MainContext.default()
om = dbus.Interface(bus.get_object(BUS, "/"), "org.freedesktop.DBus.ObjectManager")
ad_path = "/org/bluez/hci0"
adapter = dbus.Interface(bus.get_object(BUS, ad_path), "org.bluez.Adapter1")


def say(**k):
    k.setdefault("t", round(time.time(), 3))
    print(json.dumps(k), flush=True)


def pump(sec, until=lambda: False):
    end = time.time() + sec
    while time.time() < end and not until():
        ctx.iteration(False)
        time.sleep(0.002)
    return until()


def find_dev():
    for path, ifs in om.GetManagedObjects().items():
        d = ifs.get("org.bluez.Device1")
        if d and SVC in [str(u).lower() for u in d.get("UUIDs", [])] and d.get("RSSI") is not None:
            return path, d
    return None, None


# fresh start: forget stale CMX devices (the handheld uses a new random address each boot)
for path, ifs in om.GetManagedObjects().items():
    d = ifs.get("org.bluez.Device1")
    if d and (SVC in [str(u).lower() for u in d.get("UUIDs", [])] or str(d.get("Name", "")).startswith("CMX")):
        try:
            adapter.RemoveDevice(path)
        except dbus.DBusException:
            pass
adapter.SetDiscoveryFilter({"Transport": "le", "UUIDs": dbus.Array([SVC], signature="s"), "DuplicateData": True})
t0 = time.time()
adapter.StartDiscovery()
found = {}
pump(25, lambda: found.update(zip(("p", "d"), find_dev())) or found.get("p") is not None)
if not found.get("p"):
    say(ev="not_found"); sys.exit(2)
dpath = found["p"]
say(ev="found", addr=str(found["d"].get("Address")), name=str(found["d"].get("Name", "")), scan_s=round(time.time() - t0, 2))
adapter.StopDiscovery()
dev = dbus.Interface(bus.get_object(BUS, dpath), "org.bluez.Device1")
dprops = dbus.Interface(bus.get_object(BUS, dpath), P)
t1 = time.time()
for attempt in range(3):
    try:
        dev.Connect(); break
    except dbus.DBusException as e:
        say(ev="connect_retry", e=str(e)); time.sleep(1)
pump(15, lambda: bool(dprops.Get("org.bluez.Device1", "ServicesResolved")))
chars = {}
for path, ifs in om.GetManagedObjects().items():
    ch = ifs.get("org.bluez.GattCharacteristic1")
    if ch and str(path).startswith(str(dpath)):
        for k, u in U.items():
            if str(ch["UUID"]).lower() == u:
                chars[k] = dbus.Interface(bus.get_object(BUS, path), "org.bluez.GattCharacteristic1")
                chars[k + "_path"] = path
say(ev="connected", connect_s=round(time.time() - t1, 2), chars=sorted(k for k in chars if not k.endswith("_path")))

meta = json.loads(bytes(chars["META"].ReadValue({})).decode())
say(ev="meta", **{k: meta[k] for k in ("len", "chunks", "sha256")})
chunks, end = {}, {}


def on_rec(iface, changed, inv, path=None):
    if "Value" not in changed:
        return
    b = bytes(changed["Value"])
    if len(b) < 2:
        return
    seq = b[0] | b[1] << 8
    if seq == 0xFFFF:
        end["len"] = struct.unpack("<I", b[2:6])[0] if len(b) >= 6 else None
        end["t"] = time.time()
    else:
        chunks.setdefault(seq, b[2:])
        end.setdefault("first", time.time())


acks = []
bus.add_signal_receiver(on_rec, "PropertiesChanged", P, BUS, chars["REC_path"])
bus.add_signal_receiver(lambda i, c, v: "Value" in c and acks.append((time.time(), bytes(c["Value"]).decode("utf-8", "replace"))),
                        "PropertiesChanged", P, BUS, chars["ACK_path"])
chars["REC"].StartNotify()
pump(20, lambda: "t" in end)
missing = [i for i in range(meta["chunks"]) if i not in chunks]
for i in missing:
    chars["CTRL"].WriteValue(dbus.Array(struct.pack("<H", i), signature="y"), {"type": "request"})
    r = bytes(chars["REC"].ReadValue({}))
    if len(r) >= 2 and (r[0] | r[1] << 8) == i:
        chunks[i] = r[2:]
chars["REC"].StopNotify()
text = b"".join(chunks[i] for i in sorted(chunks))
open(OUT, "wb").write(text)
sha = hashlib.sha256(text).hexdigest()
say(ev="record", bytes=len(text), chunks=len(chunks), refilled=len(missing), sha_ok=sha == meta["sha256"],
    stream_s=round(end.get("t", 0) - end.get("first", 0), 3), out=OUT)

chars["ACK"].StartNotify()
pump(0.3)
t_send = time.time()
chars["MSG"].WriteValue(dbus.Array(MSG_TEXT.encode(), signature="y"), {"type": "request"})
say(ev="msg_written", ms=round(1000 * (time.time() - t_send)), text=MSG_TEXT)
pump(20, lambda: bool(acks))
if acks:
    say(ev="ack", text=acks[0][1], t_ack=round(acks[0][0], 3), send_to_ack_s=round(acks[0][0] - t_send, 2))
else:
    say(ev="no_ack")
try:
    dev.Disconnect()
except dbus.DBusException:
    pass
