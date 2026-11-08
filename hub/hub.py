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

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("HUB_DATA", HERE / "data"))
PORT = int(os.environ.get("HUB_PORT", "8000"))
DATA.mkdir(exist_ok=True)
MAX_BODY = 4 * 1024 * 1024                               # one camera frame or mic chunk is far below this

latest = {}                                              # what -> last message
recent = []                                              # (seq, json line) of the last 500 messages
seq = 0
news = threading.Condition()                             # guards latest/recent/seq; wakes waiting polls
frame = {"jpg": b"", "n": 0, "seq": 0, "said": 0.0}
new_frame = threading.Condition()

LOG = open(DATA / "messages.jsonl", "a+")
LOG.seek(0)
for _line in LOG:                                        # restart keeps the last value of everything (e.g. the link)
    try:
        _m = json.loads(_line); latest[_m["what"]] = _m
    except (ValueError, KeyError, TypeError):
        pass


def publish(msg):
    global seq
    msg.setdefault("from", "?")
    msg.setdefault("t", round(time.time(), 3))
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
        after = int(qs.partition("after=")[2] or 0) if "after=" in qs else 0
        if p in ("/", "/phone"):
            return self.reply(body=(HERE / "phone.html").read_bytes(), ctype="text/html; charset=utf-8")
        if p == "/dash":
            return self.reply(body=(HERE / "dash.html").read_bytes(), ctype="text/html; charset=utf-8")
        if p == "/state":
            with news:
                return self.reply(body=json.dumps(latest).encode())
        if p == "/poll":
            with news:
                if after <= 0 or after > seq or (recent and after < recent[0][0] - 1):
                    # new viewer, hub restarted, or too far behind: catch up with the latest values (never live)
                    lines = [json.dumps({**m, "replay": True}) for m in sorted(latest.values(), key=lambda m: m["t"])]
                else:
                    news.wait_for(lambda: seq > after, timeout=10)
                    lines = [l for s, l in recent if s > after]
                last = seq
            return self.reply(body=('{"seq": %d, "msgs": [%s]}' % (last, ",".join(lines))).encode())
        if p == "/frame.jpg":
            with new_frame:
                if after > frame["seq"]:                 # hub restarted: anything we have is newer
                    after = 0
                new_frame.wait_for(lambda: frame["seq"] > after and frame["jpg"], timeout=5)
                s, jpg = frame["seq"], frame["jpg"]
            if s <= after or not jpg:
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
            n = int(qs.partition("n=")[2] or 0)
            with new_frame:
                if n > frame["n"] or frame["n"] - n > 50:        # drop late frames; a big jump back = phone restarted
                    frame["jpg"], frame["n"] = data, n
                    frame["seq"] += 1
                    new_frame.notify_all()
            if time.time() - frame["said"] > 1:                  # "camera live" at most once a second
                frame["said"] = time.time()
                publish({"from": "phone", "what": "camera", "value": "live"})
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
