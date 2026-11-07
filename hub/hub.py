#!/usr/bin/env python3
"""Handoff hub. Runs on the Pi. Standard library only (the Pi has no internet).

Every input and output is one message:  {"from": "pi", "what": "hr", "value": 74, "t": 1731000000.0}

  POST /send          JSON message in (any device, any sensor)
  GET  /events        live stream of every message (Server-Sent Events)
  GET  /state         latest value of every "what"
  POST /frame?n=N     JPEG from the phone camera      GET /video  live MJPEG stream   GET /frame.jpg  latest frame
  POST /audio         mic chunk from the phone (?new=1 starts a fresh file)
  GET  /              phone page      GET /dash  dashboard

Talk to it from anything:   curl -d '{"from":"me","what":"say","value":"hello"}' http://<pi>:8000/send
The phone needs https for its camera: put pinggy (or any https tunnel) in front of port 8000.
"""
import json, os, queue, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("HUB_DATA", HERE / "data"))
PORT = int(os.environ.get("HUB_PORT", "8000"))
DATA.mkdir(exist_ok=True)

latest = {}                     # what -> last message
listeners = set()               # one queue per open /events stream
lock = threading.Lock()
frame = {"jpg": b"", "n": 0, "seq": 0, "said": 0.0}
new_frame = threading.Condition()
LOG = open(DATA / "messages.jsonl", "a+")
LOG.seek(0)
for _line in LOG:                                        # restart keeps the last value of everything (e.g. the link)
    try:
        _m = json.loads(_line); latest[_m["what"]] = _m
    except (ValueError, KeyError, TypeError):
        pass
MAX_BODY = 4 * 1024 * 1024                               # one camera frame or mic chunk is far below this


def publish(msg):
    msg.setdefault("from", "?")
    msg.setdefault("t", round(time.time(), 3))
    line = json.dumps(msg, allow_nan=False)
    with lock:
        prev = latest.get(msg.get("what", "?"))
        latest[msg.get("what", "?")] = msg
        if not prev or prev.get("value") != msg.get("value") or prev.get("from") != msg.get("from"):
            try:
                LOG.write(line + "\n"); LOG.flush()      # file keeps changes only (sensors repeat every second)
            except OSError:
                pass                                     # full SD card must not stop the live feed
        for q in list(listeners):
            try:
                q.put_nowait(line)
            except queue.Full:
                pass                                     # a stuck viewer drops messages, nobody else waits


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = 30                                         # frees threads held by dead phones or silent sockets

    def log_message(self, *a):
        pass

    def reply(self, code=200, body=b"", ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def body(self, cap=MAX_BODY):
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 <= n <= cap:
            raise ValueError("body too large")
        return self.rfile.read(n)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/phone"):
            return self.reply(body=(HERE / "phone.html").read_bytes(), ctype="text/html; charset=utf-8")
        if p == "/dash":
            return self.reply(body=(HERE / "dash.html").read_bytes(), ctype="text/html; charset=utf-8")
        if p == "/state":
            with lock:
                return self.reply(body=json.dumps(latest).encode())
        if p == "/frame.jpg":
            if not frame["jpg"]:
                return self.reply(404, b"no frame yet", "text/plain")
            return self.reply(body=frame["jpg"], ctype="image/jpeg")
        if p == "/events":
            return self.stream()
        if p == "/video":
            return self.video()
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
            mode = "wb" if "new=1" in qs else "ab"
            with open(DATA / "mic.webm", mode) as f:
                f.write(data)
            return self.reply(body=b'{"ok":true}')
        self.reply(404, b"not found", "text/plain")

    def video(self):
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=f")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        seq = -1
        try:
            while True:
                with new_frame:                                  # wake on every new frame (resend after 10 s idle)
                    new_frame.wait_for(lambda: frame["seq"] != seq, timeout=10)
                    seq, jpg = frame["seq"], frame["jpg"]
                if jpg:
                    self.wfile.write(b"--f\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n%s\r\n" % (len(jpg), jpg))
                    self.wfile.flush()
        except OSError:
            pass

    def stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        q = queue.Queue(maxsize=200)
        with lock:
            listeners.add(q)
            first = list(latest.values())
        try:
            for m in first:                                  # catch the new viewer up; replays are never live values
                self.wfile.write(f"data: {json.dumps({**m, 'replay': True})}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    line = q.get(timeout=5)
                    self.wfile.write(f"data: {line}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b'data: {"what":"ping"}\n\n')   # pages treat 12 s of silence as a dead link
                self.wfile.flush()
        except OSError:
            pass
        finally:
            with lock:
                listeners.discard(q)


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    srv.daemon_threads = True
    publish({"from": "hub", "what": "hub", "value": "started"})
    print(f"hub on http://0.0.0.0:{PORT}  (phone: /   dashboard: /dash)", flush=True)
    srv.serve_forever()
