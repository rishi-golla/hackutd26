#!/usr/bin/env python3
"""Handoff hub. Runs on the Pi. Standard library only.

Every input and output is one message:  {"from": "pi", "what": "hr", "value": 74, "t": 1731000000.0}

  POST /send            JSON message in (any device, any sensor)
  GET  /poll?after=N    new messages after N (waits up to 10 s): {"seq": last, "msgs": [...]}
  GET  /state           latest value of every "what"
  POST /frame?n=N       JPEG from the phone camera
  GET  /frame.jpg?after=S   the next frame newer than S (waits up to 5 s); its number is in X-Seq
  POST /audio           mic chunk from the phone (?new=1 starts a fresh file)
  GET  /                phone page      GET /dash  dashboard

Live data is long-polled: each answer is a normal complete response, so it passes any https tunnel at once
(Cloudflare holds back streamed responses in ~64 KB blocks, which froze SSE and MJPEG).
Talk to it from anything:   curl -d '{"from":"me","what":"say","value":"hello"}' http://<pi>:8000/send
"""
import json, os, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("HUB_DATA", HERE / "data"))
PORT = int(os.environ.get("HUB_PORT", "8000"))
DATA.mkdir(exist_ok=True)
MAX_BODY = 4 * 1024 * 1024

latest = {}                                              # what -> last message
recent = []                                              # (seq, json line) of the last 500 messages
seq = 0
EPOCH = os.urandom(4).hex()                              # changes every start, so viewers notice a hub restart
news = threading.Condition()                             # guards latest/recent/seq; wakes waiting polls
frame = {"jpg": b"", "n": 0, "seq": 0, "said": 0.0, "at": 0.0, "session": ""}
camera_sessions = set()
new_frame = threading.Condition()

FILES = {"/": "phone.html", "/phone": "phone.html", "/dash": "dash.html", "/common.js": "common.js"}
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8"}

# A restart keeps the last value of everything (e.g. the phone link). The log is compacted to just those values,
# so it never grows past one line per kind of message.
_log = DATA / "messages.jsonl"
for _line in (_log.read_text().splitlines() if _log.exists() else []):
    try:
        _m = json.loads(_line); latest[_m["what"]] = _m
    except (ValueError, KeyError, TypeError):
        pass
_log.write_text("".join(json.dumps(m) + "\n" for m in latest.values()))
LOG = open(_log, "a")


def publish(msg):
    global seq
    msg.setdefault("from", "?")
    msg["t"] = round(time.time(), 3)                     # the hub's clock, never the sender's
    msg.pop("replay", None)                              # only the hub marks replays
    line = json.dumps(msg, allow_nan=False)
    with news:
        prev = latest.get(msg["what"])
        latest[msg["what"]] = msg
        if not prev or prev.get("value") != msg.get("value") or prev.get("from") != msg.get("from"):
            try:
                LOG.write(line + "\n"); LOG.flush()      # file keeps changes only (sensors repeat every tick)
            except OSError:
                pass                                     # full SD card must not stop the live feed
        seq += 1
        recent.append((seq, line))
        del recent[:-500]
        news.notify_all()


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = 30                                         # frees threads held by dead phones or silent sockets

    def log_message(self, *a):
        pass

    def reply(self, code=200, body=b"", ctype="application/json", headers=()):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def body(self, cap=MAX_BODY):
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 <= n <= cap:
            raise ValueError("body too large")
        return self.rfile.read(n)

    def do_GET(self):
        p, _, qs = self.path.partition("?")
        q = parse_qs(qs)
        try:
            after = int(q.get("after", ["0"])[0])
        except ValueError:
            return self.reply(400, b'{"ok":false,"error":"after must be a number"}')
        if p in FILES:
            f = HERE / FILES[p]
            return self.reply(body=f.read_bytes(), ctype=TYPES[f.suffix])
        if p == "/state":
            with news:
                return self.reply(body=json.dumps(latest).encode())
        if p == "/poll":
            with news:
                if q.get("e", [""])[0] != EPOCH or after <= 0 or after > seq or (recent and after < recent[0][0] - 1):
                    # new viewer, hub restarted, or too far behind: catch up with the latest values (never live)
                    by_time = sorted(latest.values(), key=lambda m: m["t"] if isinstance(m.get("t"), (int, float)) else 0)
                    lines = [json.dumps({**m, "replay": True}) for m in by_time]
                else:
                    news.wait_for(lambda: seq > after, timeout=10)
                    lines = [l for s, l in recent if s > after]
                last = seq
            body = '{"seq": %d, "e": "%s", "now": %.3f, "msgs": [%s]}' % (last, EPOCH, time.time(), ",".join(lines))
            return self.reply(body=body.encode())
        if p == "/frame.jpg":
            with new_frame:
                if after > frame["seq"]:                 # hub restarted: anything we have is newer
                    after = 0
                new_frame.wait_for(lambda: frame["seq"] > after and frame["jpg"], timeout=5)
                s, jpg, at = frame["seq"], frame["jpg"], frame["at"]
            if s <= after or not jpg or time.time() - at > 3:  # never serve an old image
                return self.reply(204)
            return self.reply(body=jpg, ctype="image/jpeg", headers=[("X-Seq", str(s))])
        self.reply(404, b"not found", "text/plain")

    def do_POST(self):
        p, _, qs = self.path.partition("?")
        try:
            data = self.body(64 * 1024 if p == "/send" else MAX_BODY)
        except ValueError:
            self.close_connection = True
            return self.reply(413, b'{"ok":false,"error":"bad or too large body"}')
        if p == "/send":
            try:
                msg = json.loads(data or b"{}")
                ok = isinstance(msg, dict) and isinstance(msg.get("what"), str) and 0 < len(msg["what"]) <= 64
                if ok:
                    publish(msg)
            except ValueError:                           # bad JSON, or NaN/Infinity
                ok = False
            if not ok:
                return self.reply(400, b'{"ok":false,"error":"need JSON with a short text \\"what\\""}')
            return self.reply(body=b'{"ok":true}')
        if p == "/frame":
            session = parse_qs(qs).get("session", [""])[0]
            if len(session) > 128 or (session and not all(c.isascii() and (c.isalnum() or c in "_-") for c in session)):
                return self.reply(400, b'{"ok":false,"error":"invalid camera session"}')
            try:
                n = int(parse_qs(qs).get("n", ["0"])[0])
            except ValueError:
                n = 0
            if data[:2] != b"\xff\xd8":
                return self.reply(400, b'{"ok":false,"error":"not a JPEG"}')
            with new_frame:
                new_session = bool(session) and session != frame["session"] and session not in camera_sessions
                fresh = new_session or (session == frame["session"] and (n > frame["n"] or frame["n"] - n > 50))
                if fresh:
                    if session:
                        camera_sessions.add(session)
                    frame.update(jpg=data, n=n, seq=frame["seq"] + 1, at=time.time(), session=session)
                    new_frame.notify_all()
                if fresh and (new_session or time.time() - frame["said"] > 1):  # announce new sessions immediately
                    frame["said"] = time.time()
                    publish({"from": "phone", "what": "camera", "value": "live", "session": session})
            return self.reply(body=b'{"ok":true}')
        if p == "/audio":
            with open(DATA / "mic.webm", "wb" if "new=1" in qs else "ab") as f:
                f.write(data)
            return self.reply(body=b'{"ok":true}')
        self.reply(404, b"not found", "text/plain")


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    srv.daemon_threads = True
    publish({"from": "hub", "what": "hub", "value": "started"})
    print(f"hub on http://0.0.0.0:{PORT}  (phone: /   dashboard: /dash)", flush=True)
    srv.serve_forever()
