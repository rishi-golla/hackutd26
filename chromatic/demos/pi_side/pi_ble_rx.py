#!/usr/bin/env python3
"""Raspberry Pi side: passive BLE receiver (raw HCI, no extra packages). Prints one JSON line per advert that
carries manufacturer data or a name matching --name. Run as root: sudo python3 pi_ble_rx.py <seconds> [--name CMX]

The LE scan is enabled with `hcitool lescan --passive --duplicates`; this script only reads the HCI event stream.
"""
import json, socket, struct, subprocess, sys, time

secs = float(sys.argv[1]) if len(sys.argv) > 1 else 30
want = sys.argv[sys.argv.index("--name") + 1] if "--name" in sys.argv else None

subprocess.run(["hciconfig", "hci0", "up"], check=False)
s = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_RAW, socket.BTPROTO_HCI)
s.bind((0,))
# HCI filter: event packets (type 4), LE meta event 0x3E
flt = struct.pack("<IQH", 1 << 4, 1 << 0x3E, 0)
s.setsockopt(socket.SOL_HCI, socket.HCI_FILTER, flt)
s.settimeout(0.5)
scan = subprocess.Popen(["hcitool", "lescan", "--passive", "--duplicates"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ad_fields(d):
    i, out = 0, {}
    while i < len(d):
        ln = d[i]
        if ln == 0 or i + 1 >= len(d):
            break
        t = d[i + 1]
        v = d[i + 2:i + 1 + ln]
        out.setdefault(t, v)
        i += 1 + ln
    return out


end = time.time() + secs
print(json.dumps({"ev": "listening", "secs": secs}), flush=True)
try:
    while time.time() < end:
        try:
            pkt = s.recv(300)
        except socket.timeout:
            continue
        if len(pkt) < 4 or pkt[0] != 4 or pkt[1] != 0x3E or pkt[3] != 0x02:
            continue
        n, p = pkt[4], 5
        for _ in range(n):
            if p + 9 > len(pkt):
                break
            addr = ":".join(f"{b:02X}" for b in reversed(pkt[p + 2:p + 8]))
            dl = pkt[p + 8]
            data = pkt[p + 9:p + 9 + dl]
            rssi = struct.unpack("b", pkt[p + 9 + dl:p + 10 + dl])[0] if p + 9 + dl < len(pkt) else None
            p += 10 + dl
            f = ad_fields(data)
            name = (f.get(0x09) or f.get(0x08) or b"").decode("utf-8", "replace")
            mfg = f.get(0xFF)
            if want and want not in name:
                continue
            if mfg is None and not want:
                continue
            print(json.dumps({"t": time.time(), "addr": addr, "rssi": rssi, "name": name,
                              "mfg": mfg.hex() if mfg else None}), flush=True)
finally:
    scan.terminate()
