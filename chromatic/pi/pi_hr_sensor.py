#!/usr/bin/env python3
"""BlueZ D-Bus GATT building blocks (python3-dbus only) for pi_oximeter.py: advertisement, service,
characteristic with notify, and the application object. The handheld connects to these as a standard BLE sensor.
"""
import json, time
import dbus, dbus.service

BUS = "org.bluez"
GATT_MGR, ADV_MGR = "org.bluez.GattManager1", "org.bluez.LEAdvertisingManager1"
OM, PROPS = "org.freedesktop.DBus.ObjectManager", "org.freedesktop.DBus.Properties"
SVC_IF, CHR_IF, ADV_IF = "org.bluez.GattService1", "org.bluez.GattCharacteristic1", "org.bluez.LEAdvertisement1"


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


