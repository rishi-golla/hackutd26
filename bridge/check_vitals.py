#!/usr/bin/env python3
"""Is the Pi's vitals feed reaching SpacetimeDB right now? Standard library only; runs on the laptop or the Pi.

Reads the vitals table back over SpacetimeDB's SQL endpoint and prints:
  - how many rows DEVICE has, per status, and how many "pulse" rows carry SpO2 (the sensor publishes SpO2 only once
    3 readings in a row agree within 2 points, so a pulse stretch of a few seconds has none)
  - the newest rows, and whether the newest one is at most STALE_S old (the bridge's own cutoff)

Exit code 0 when the feed is live, 1 when it isn't, 2 when SpacetimeDB can't be read.
  python3 bridge/check_vitals.py [--rows N]
Settings (environment, same names as hub_bridge.py): SPACETIMEDB_URL, SPACETIMEDB_DB, DEVICE, STALE_S.
"""
import argparse, collections, json, os, sys, time, urllib.error, urllib.request

STDB = os.environ.get("SPACETIMEDB_URL", "https://maincloud.spacetimedb.com").rstrip("/")
DB = os.environ.get("SPACETIMEDB_DB", "handoff-hackutd26")
DEVICE = os.environ.get("DEVICE", "relay-1")
STALE_S = float(os.environ.get("STALE_S", "3"))


def post(path, body=b"", headers=None):
    req = urllib.request.Request(f"{STDB}{path}", data=body, method="POST", headers=headers or {})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def sql(token, query):
    """Rows of one SELECT. Options come back as [0, value] (some) or [1, []] (none), timestamps as [micros]."""
    return post(f"/v1/database/{DB}/sql", query.encode(), {"Authorization": f"Bearer {token}"})[0]["rows"]


def opt(o):
    return o[1] if o[0] == 0 else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--rows", type=int, default=5, help="how many of the newest rows to print (default 5)")
    n = ap.parse_args().rows
    device = DEVICE.replace("'", "''")
    try:
        token = post("/v1/identity")["token"]          # read-only queries: a throwaway identity is enough
        rows = sql(token, f"SELECT ts, status, hr, spo2, simulated FROM vitals WHERE device = '{device}'")
    except (urllib.error.URLError, OSError, ValueError, KeyError, IndexError) as e:
        print(f"can't read {DB} at {STDB}: {e}", file=sys.stderr)
        return 2
    rows.sort(key=lambda r: r[0][0])
    print(f"{DB} at {STDB}, device {DEVICE}: {len(rows)} vitals rows (the module keeps 30 min)")
    if not rows:
        print("NOT LIVE: no rows from this device. Is handoff-bridge running on the Pi?")
        return 1
    pulse = [r for r in rows if r[1] == "pulse"]
    print("statuses:", ", ".join(f"{s} {c}" for s, c in collections.Counter(r[1] for r in rows).most_common()))
    print(f"pulse rows with SpO2: {sum(opt(r[3]) is not None for r in pulse)} of {len(pulse)}")
    for r in rows[-n:] if n > 0 else []:
        at = time.strftime("%H:%M:%S", time.localtime(r[0][0] / 1e6))
        print(f"  {at}  {r[1]:<12}  hr {opt(r[2])}  spo2 {opt(r[3])}  simulated {r[4]}")
    age = max(0.0, time.time() - rows[-1][0][0] / 1e6)
    live = age <= STALE_S
    print(f"{'LIVE' if live else 'NOT LIVE'}: newest row is {age:.1f} s old (live means {STALE_S:g} s or less)")
    return 0 if live else 1


if __name__ == "__main__":
    sys.exit(main())
