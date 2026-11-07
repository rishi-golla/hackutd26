#!/usr/bin/env python3
"""Raspberry Pi side: a standard BLE Heart Rate sensor (0x180D / 0x2A37) + Pulse Oximeter (0x1822 / 0x2A5F),
built on BlueZ's D-Bus GATT API (python3-dbus + gi only). Plays a scripted patient and prints one JSON line per
notification sent.  sudo python3 pi_hr_sensor.py <seconds> [steady|deteriorate]
"""
import json, math, sys, time
import dbus, dbus.exceptions, dbus.mainloop.glib, dbus.service
from gi.repository import GLib

BUS = "org.bluez"
GATT_MGR, ADV_MGR = "org.bluez.GattManager1", "org.bluez.LEAdvertisingManager1"
OM, PROPS = "org.freedesktop.DBus.ObjectManager", "org.freedesktop.DBus.Properties"
SVC_IF, CHR_IF, ADV_IF = "org.bluez.GattService1", "org.bluez.GattCharacteristic1", "org.bluez.LEAdvertisement1"
SECS = float(sys.argv[1]) if len(sys.argv) > 1 else 60
TRACE = sys.argv[2] if len(sys.argv) > 2 else "deteriorate"


def hr_at(t):
    if TRACE == "steady" or t < 10:
        return 72 + int(round(2 * math.sin(t / 3)))
    if t < 22:
        return int(72 + (140 - 72) * min(1, (t - 10) / 6))
    if t < 32:
        return 38
    return 80


def spo2_at(t):
    return 98 if (TRACE == "steady" or t < 10) else 97 if t < 22 else 86 if t < 32 else 95


class Adv(dbus.service.Object):
    PATH = "/cmx/adv0"

    def __init__(self, bus):
        super().__init__(bus, self.PATH)

    @dbus.service.method(PROPS, in_signature="s", out_signature="a{sv}")
    def GetAll(self, iface):
        return {"Type": "peripheral", "ServiceUUIDs": dbus.Array(["180D"], signature="s"),
                "LocalName": "PI-HRM", "Includes": dbus.Array(["tx-power"], signature="s")}

    @dbus.service.method(ADV_IF, in_signature="", out_signature="")
    def Release(self):
        pass


class Chr(dbus.service.Object):
    def __init__(self, bus, path, uuid, svc, flags, value=b""):
        super().__init__(bus, path)
        self.path, self.uuid, self.svc, self.flags, self.value, self.notifying = path, uuid, svc, flags, value, False

    def props(self):
        return {CHR_IF: {"Service": dbus.ObjectPath(self.svc), "UUID": self.uuid,
                         "Flags": dbus.Array(self.flags, signature="s")}}

    @dbus.service.method(PROPS, in_signature="s", out_signature="a{sv}")
    def GetAll(self, iface):
        return self.props()[CHR_IF]

    @dbus.service.method(CHR_IF, in_signature="a{sv}", out_signature="ay")
    def ReadValue(self, opts):
        return dbus.Array(self.value, signature="y")

    @dbus.service.method(CHR_IF)
    def StartNotify(self):
        self.notifying = True
        print(json.dumps({"ev": "subscribed", "uuid": self.uuid, "t": time.time()}), flush=True)

    @dbus.service.method(CHR_IF)
    def StopNotify(self):
        self.notifying = False

    @dbus.service.signal(PROPS, signature="sa{sv}as")
    def PropertiesChanged(self, iface, changed, invalidated):
        pass

    def notify(self, data):
        self.value = data
        if self.notifying:
            self.PropertiesChanged(CHR_IF, {"Value": dbus.Array(data, signature="y")}, [])
        return self.notifying


class Svc(dbus.service.Object):
    def __init__(self, bus, path, uuid):
        super().__init__(bus, path)
        self.path, self.uuid, self.chrs = path, uuid, []

    @dbus.service.method(PROPS, in_signature="s", out_signature="a{sv}")
    def GetAll(self, iface):
        return {"UUID": self.uuid, "Primary": True}


class App(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, "/cmx")
        self.svcs = []

    @dbus.service.method(OM, out_signature="a{oa{sa{sv}}}")
    def GetManagedObjects(self):
        out = {}
        for s in self.svcs:
            out[dbus.ObjectPath(s.path)] = {SVC_IF: {"UUID": s.uuid, "Primary": True}}
            for c in s.chrs:
                out[dbus.ObjectPath(c.path)] = c.props()
        return out


def main():
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    adapter = "/org/bluez/hci0"
    ap = dbus.Interface(bus.get_object(BUS, adapter), PROPS)
    ap.Set("org.bluez.Adapter1", "Powered", dbus.Boolean(1))
    app = App(bus)
    hr = Svc(bus, "/cmx/s0", "180D")
    meas = Chr(bus, "/cmx/s0/c0", "2A37", hr.path, ["notify"])
    loc = Chr(bus, "/cmx/s0/c1", "2A38", hr.path, ["read"], b"\x01")
    hr.chrs = [meas, loc]
    plx = Svc(bus, "/cmx/s1", "1822")
    cont = Chr(bus, "/cmx/s1/c0", "2A5F", plx.path, ["notify"])
    feat = Chr(bus, "/cmx/s1/c1", "2A60", plx.path, ["read"], b"\x00\x00")
    plx.chrs = [cont, feat]
    app.svcs = [hr, plx]
    adv = Adv(bus)
    loop = GLib.MainLoop()
    gm = dbus.Interface(bus.get_object(BUS, adapter), GATT_MGR)
    am = dbus.Interface(bus.get_object(BUS, adapter), ADV_MGR)
    gm.RegisterApplication("/cmx", {},
                           reply_handler=lambda: print(json.dumps({"ev": "gatt_registered"}), flush=True),
                           error_handler=lambda e: (print(json.dumps({"ev": "gatt_error", "e": str(e)}), flush=True), loop.quit()))
    am.RegisterAdvertisement(Adv.PATH, {},
                             reply_handler=lambda: print(json.dumps({"ev": "advertising", "name": "PI-HRM"}), flush=True),
                             error_handler=lambda e: (print(json.dumps({"ev": "adv_error", "e": str(e)}), flush=True), loop.quit()))
    st = {"start": None, "end": time.time() + SECS}

    def tick():
        if time.time() > st["end"]:
            loop.quit()
            return False
        if not meas.notifying:
            return True
        if st["start"] is None:
            st["start"] = time.time()
        t = time.time() - st["start"]
        bpm, sp = hr_at(t), spo2_at(t)
        meas.notify(bytes([0x00, bpm]))
        cont.notify(bytes([0x00]) + sp.to_bytes(2, "little") + bpm.to_bytes(2, "little"))
        print(json.dumps({"t": time.time(), "rel": round(t, 2), "bpm": bpm, "spo2": sp, "plx_sub": cont.notifying}), flush=True)
        return True

    GLib.timeout_add(1000, tick)
    loop.run()
    try:
        am.UnregisterAdvertisement(Adv.PATH)
        gm.UnregisterApplication("/cmx")
    except dbus.exceptions.DBusException:
        pass
    print(json.dumps({"ev": "done"}), flush=True)


if __name__ == "__main__":
    main()
