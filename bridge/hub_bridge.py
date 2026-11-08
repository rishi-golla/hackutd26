#!/usr/bin/env python3
"""Pi hub → SpacetimeDB bridge. Standard library only.

kgand's hub (hub/hub.py on the Pi) carries the finger sensor's readings on its own message bus. This process
long-polls the hub and forwards them to SpacetimeDB, so the hospital dashboard, the callout rules and the agent
see the real vitals:

  hub "hr" / "spo2" / "state"  →  push_vitals(device, json)   once a second, only while the hub data is fresh
  hub "mark" (press counter)    →  mark(device, '{"source":"MARK"}')   once per press

Hub state → relay status (spacetime/README.md; hr/spo2 are kept only when the status is "pulse"):
  live → pulse · no_finger → no finger · saturated → saturated · sensor_error → sensor error
  measuring / settling / moving / weak / noisy (anything else) → acquiring

Never forwards a stale number: if the hub goes quiet for more than STALE_S, nothing is sent and the dashboard shows
"no data" by itself. The hub doesn't carry the pulse waveform or temperature, so neither is forwarded. Nor is the
2 s hold (toggle_incident): the sensor publishes presses only.

Run it on the Pi next to the hub (default), or on the laptop with HUB_URL=http://<pi>:8000:
  python3 hub_bridge.py
Settings (environment): HUB_URL, SPACETIMEDB_URL, SPACETIMEDB_DB, DEVICE, TOKEN_FILE, STALE_S.
"""
import json, os, sys, threading, time, urllib.error, urllib.request
from pathlib import Path

HUB = os.environ.get("HUB_URL", "http://127.0.0.1:8000").rstrip("/")
STDB = os.environ.get("SPACETIMEDB_URL", "https://maincloud.spacetimedb.com").rstrip("/")
DB = os.environ.get("SPACETIMEDB_DB", "handoff-hackutd26")
DEVICE = os.environ.get("DEVICE", "relay-1")
TOKEN_FILE = Path(os.environ.get("TOKEN_FILE", Path.home() / ".handoff-bridge-token"))
STALE_S = float(os.environ.get("STALE_S", "3"))
SEND_EVERY_S = 1.0                                     # spec R3: vitals once a second

STATUS = {"live": "pulse", "no_finger": "no finger", "saturated": "saturated", "sensor_error": "sensor error"}

latest = {}                                            # what -> (value, local monotonic time it arrived)
lock = threading.Lock()
marks = []                                             # MARK presses waiting to be forwarded


def log(**k):
    print(json.dumps({"t": round(time.time(), 3), **k}), flush=True)


def http(method, url, body=None, headers=None, timeout=15):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


# ---------------------------------------------------------------- SpacetimeDB

def token():
    """One SpacetimeDB identity per bridge, kept across restarts."""
    if TOKEN_FILE.exists():
        t = TOKEN_FILE.read_text().strip()
        if t:
            return t
    _, body = http("POST", f"{STDB}/v1/identity")
    t = json.loads(body)["token"]
    try:
        TOKEN_FILE.write_text(t)
        TOKEN_FILE.chmod(0o600)
    except OSError:
        pass                                           # read-only home: a new identity next start is fine
    return t


def call(reducer, args):
    """POST /v1/database/<db>/call/<reducer> with the arguments as a JSON array. Returns True on success."""
    try:
        http("POST", f"{STDB}/v1/database/{DB}/call/{reducer}", json.dumps(args).encode(),
             {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}, timeout=5)
        return True
    except urllib.error.HTTPError as e:
        log(ev="stdb_error", reducer=reducer, status=e.code, error=e.read()[:200].decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError) as e:
        log(ev="stdb_unreachable", reducer=reducer, error=str(e))
    return False


# ---------------------------------------------------------------- hub

def poll_hub():
    """Long-poll the hub forever, keeping the newest value of each message. Catch-up (replay) messages only set
    the MARK baseline: they are old values and are never forwarded as live readings."""
    after, epoch, mark_seen, up = 0, "", None, None
    while True:
        try:
            _, body = http("GET", f"{HUB}/poll?after={after}&e={epoch}", timeout=15)
            d = json.loads(body)
            after, epoch = d["seq"], d["e"]
            now = time.monotonic()
            for m in d["msgs"]:
                what, value = m.get("what"), m.get("value")
                if what == "mark" and isinstance(value, int):
                    if m.get("replay"):
                        mark_seen = value              # baseline: what the hub already had (bridge start, hub restart)
                    else:
                        # The sensor publishes "mark" only on a press, so every live message is at least one press.
                        # A counter jump means presses were missed; a drop means the sensor restarted (still a press).
                        n = value - mark_seen if mark_seen is not None and value > mark_seen else 1
                        with lock:
                            marks.extend([now] * n)
                        mark_seen = value
                    continue
                if m.get("replay") or what not in ("hr", "spo2", "state"):
                    continue
                with lock:
                    latest[what] = (value, now)
            if up is not True:
                up = True
                log(ev="hub_up", hub=HUB)
        except (urllib.error.URLError, OSError, ValueError, KeyError) as e:
            if up is not False:
                up = False
                log(ev="hub_down", hub=HUB, error=str(e))
            time.sleep(1)


def vitals_now():
    """The JSON for push_vitals from fresh hub values, or None when the hub data is stale."""
    now = time.monotonic()
    with lock:
        state = latest.get("state")
        if not state or now - state[1] > STALE_S:
            return None
        fresh = lambda k: latest[k][0] if k in latest and now - latest[k][1] <= STALE_S else None
        status = STATUS.get(state[0], "acquiring")
        hr, spo2 = fresh("hr"), fresh("spo2")
    v = {"status": status, "simulated": False, "hub_state": state[0]}
    if status == "pulse":                              # SpacetimeDB drops hr/spo2 otherwise; send them only then
        v["hr"] = hr if isinstance(hr, (int, float)) and hr > 0 else None
        v["spo2"] = spo2 if isinstance(spo2, (int, float)) and spo2 > 0 else None
    return v


def main():
    global TOKEN
    TOKEN = token()
    log(ev="start", hub=HUB, stdb=STDB, db=DB, device=DEVICE)
    threading.Thread(target=poll_hub, daemon=True).start()
    sent_ok, last_status = None, None
    next_at = time.monotonic()
    while True:
        with lock:
            pending, marks[:] = list(marks), []
        for _ in pending:
            ok = call("mark", [DEVICE, json.dumps({"source": "MARK"})])
            log(ev="mark", forwarded=ok)
        v = vitals_now()
        if v is not None:
            ok = call("push_vitals", [DEVICE, json.dumps(v)])
            if ok != sent_ok or v["status"] != last_status:
                sent_ok, last_status = ok, v["status"]
                log(ev="vitals", ok=ok, status=v["status"], hr=v.get("hr"), spo2=v.get("spo2"))
        elif last_status is not None:
            last_status = None
            log(ev="vitals_paused", reason=f"no fresh hub data for {STALE_S:g} s")
        next_at += SEND_EVERY_S
        time.sleep(max(0.0, next_at - time.monotonic()))
        if time.monotonic() - next_at > 5:             # fell far behind (sleep/suspend): resync the schedule
            next_at = time.monotonic()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
