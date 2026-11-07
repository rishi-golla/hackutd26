#!/usr/bin/env python3
"""Receiver for the relay stream test (software/pi/stream_test.py).

Listens on ws://0.0.0.0:8765 and prints, once a second per connected relay:
message rate, latest heart rate, pulse status and IR, missing messages, and
delivery timing measured on THIS Mac's clock:
  arrival gap  longest time between two messages arriving (last second)
  last ... ago time since the newest message arrived (a live stall shows here)
  sender gap   longest gap between the Pi's own timestamps (Pi-side cadence)
"<< STALL" marks an arrival gap or silence over 0.5 s. Button events are
printed the moment they arrive.

    python3 receiver.py
    python3 receiver.py --port 8765 --log stream.jsonl   # also save every message
"""

import argparse
import asyncio
import json
import socket
import subprocess
import sys
import time

try:
    from websockets.asyncio.server import serve       # websockets >= 13
except ImportError:
    try:
        from websockets import serve                   # older releases
    except ImportError:
        serve = None


def lan_ips():
    """The Mac's IPv4 addresses on Wi-Fi/Ethernet (en0, en1, ...)."""
    ips = []
    for i in range(8):
        try:
            out = subprocess.run(["ipconfig", "getifaddr", f"en{i}"],
                                 capture_output=True, text=True, timeout=2).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            break
        if out:
            ips.append((f"en{i}", out))
    if not ips:     # not macOS, or no enX address: ask the OS which address routes outward
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("10.255.255.255", 1))
                ips.append(("default", s.getsockname()[0]))
        except OSError:
            pass
    return ips


def stamp():
    return time.strftime("%H:%M:%S")


class Client:
    def __init__(self, peer):
        self.peer = peer
        self.name = peer
        self.connected_at = time.monotonic()
        self.count = 0
        self.vitals_this_second = 0
        self.rate = 0.0
        self.last = {}
        self.last_seq = None
        self.gaps = 0
        self.last_ts = None
        self.max_sender_gap = 0.0      # from the Pi's timestamps
        self.last_arrival = None       # this Mac's monotonic clock
        self.max_arrival_gap = 0.0     # since the last report line
        self.worst_arrival_gap = 0.0   # whole connection


async def run(args):
    clients = {}
    log = open(args.log, "a") if args.log else None

    async def handler(ws, path=None):
        peer = "%s:%s" % ws.remote_address[:2]
        c = clients[peer] = Client(peer)
        print(f"[{stamp()}] CONNECTED    {peer}  ({len(clients)} client(s))")
        try:
            async for raw in ws:
                arrived = time.monotonic()
                if c.last_arrival is not None:
                    gap = arrived - c.last_arrival
                    c.max_arrival_gap = max(c.max_arrival_gap, gap)
                    c.worst_arrival_gap = max(c.worst_arrival_gap, gap)
                c.last_arrival = arrived
                c.count += 1
                if log:
                    log.write(raw + "\n")
                try:
                    msg = json.loads(raw)
                except ValueError:
                    print(f"[{stamp()}] {c.name}: not JSON: {raw[:60]!r}")
                    continue
                seq = msg.get("seq")
                if isinstance(seq, int):
                    if c.last_seq is not None and seq > c.last_seq + 1:
                        c.gaps += seq - c.last_seq - 1
                    c.last_seq = seq
                kind = msg.get("type")
                if kind == "hello":
                    c.name = f"{msg.get('device', '?')} ({peer.split(':')[0]})"
                    print(f"[{stamp()}] HELLO        {c.name}: sensor {msg.get('fs')} samples/s, "
                          f"sending {msg.get('rate_hz')} msg/s, simulate={msg.get('simulate')}")
                elif kind == "vitals":
                    c.vitals_this_second += 1
                    c.last = msg
                    ts = msg.get("ts")
                    if isinstance(ts, (int, float)):
                        if c.last_ts is not None:
                            c.max_sender_gap = max(c.max_sender_gap, ts - c.last_ts)
                        c.last_ts = ts
                elif kind == "button":
                    extra = f", held {msg['held_s']} s" if "held_s" in msg else ""
                    sim = " (simulated)" if msg.get("sim") else ""
                    print(f"[{stamp()}] BUTTON       {c.name}: {msg.get('event', '?').upper()}"
                          f"{extra}{sim}  device ts {msg.get('ts')}")
                else:
                    print(f"[{stamp()}] {c.name}: message type {kind!r}")
        except Exception as e:      # abnormal close (Wi-Fi drop, Pi unplugged)
            print(f"[{stamp()}] {c.name}: connection error: {e}")
        finally:
            clients.pop(peer, None)
            dur = time.monotonic() - c.connected_at
            print(f"[{stamp()}] DISCONNECTED {c.name} after {dur:.1f} s, {c.count} msgs, "
                  f"{c.gaps} missing, worst arrival gap {c.worst_arrival_gap * 1000:.0f} ms  "
                  f"({len(clients)} client(s))")

    async def reporter():
        while True:
            await asyncio.sleep(1.0)
            for c in list(clients.values()):
                c.rate, c.vitals_this_second = c.vitals_this_second, 0
                m = c.last
                if not m:
                    continue
                hr = m.get("hr")
                spo2 = m.get("spo2_exp")
                status = m.get("status") or ("finger" if m.get("finger") else "no finger")
                since = time.monotonic() - c.last_arrival
                stall = "  << STALL" if max(c.max_arrival_gap, since) > 0.5 else ""
                print(f"[{stamp()}] {c.name}  {c.rate:3.0f} msg/s  "
                      f"HR {f'{hr:.0f}' if hr else '--':>3}  {status:<11} "
                      f"IR {m.get('ir', 0):>7,}  SpO2* {f'{spo2:.0f}' if spo2 else '--':>3}  "
                      f"missing {c.gaps}  arrival gap {c.max_arrival_gap * 1000:4.0f} ms  "
                      f"last {since * 1000:4.0f} ms ago  "
                      f"sender gap {c.max_sender_gap * 1000:3.0f} ms{stall}")
                c.max_arrival_gap = c.max_sender_gap = 0.0

    print(f"HANDOFF receiver - listening on ws://0.0.0.0:{args.port}")
    ips = lan_ips()
    for iface, ip in ips:
        print(f"  this Mac: {ip} ({iface})  ->  on the Pi run:  python3 stream_test.py {ip}")
    if not ips:
        print("  (could not find this Mac's IP: System Settings > Wi-Fi > Details)")
    print("  (* SpO2 is EXPERIMENTAL.)  Ctrl-C to stop.\n")
    try:
        async with serve(handler, "0.0.0.0", args.port, ping_interval=5, ping_timeout=5):
            await reporter()
    finally:
        if log:
            log.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--log", metavar="FILE", help="append every received message to FILE (JSON lines)")
    args = ap.parse_args()
    if serve is None:
        print("ERROR: the 'websockets' package is missing. See software/README.md (Mac setup):\n"
              "  python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt")
        return 1
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\nStopped.")
    except OSError as e:
        print(f"ERROR: {e}\n  -> Is another receiver already running on port {args.port}?")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
