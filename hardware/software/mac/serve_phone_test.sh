#!/usr/bin/env bash
# Serve software/phone/ (the phone test page) to the Pixel on port 8000.
#
#   bash serve_phone_test.sh           plain HTTP  (use with the Chrome flag, option A)
#   bash serve_phone_test.sh --https   HTTPS with a mkcert certificate (option B)
#
# The Mac and the Pixel must be on the same Wi-Fi / hotspot.
# Camera, motion sensor and wake lock need a "secure context"; the script
# prints both ways to get one. Ctrl-C stops the server.
set -euo pipefail

PORT=8000
MODE=http
for arg in "$@"; do
  case "$arg" in
    --https) MODE=https ;;
    --port=*) PORT="${arg#*=}" ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHONE_DIR="$(cd "$SCRIPT_DIR/../phone" && pwd)"
CERT_DIR="$SCRIPT_DIR/.certs"

# This Mac's LAN IP: the interface of the default route, else the first enX with an address.
IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' || true)"
IP=""
if [ -n "$IFACE" ]; then IP="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"; fi
if [ -z "$IP" ]; then
  for i in 0 1 2 3 4 5 6 7; do
    IP="$(ipconfig getifaddr "en$i" 2>/dev/null || true)"
    if [ -n "$IP" ]; then IFACE="en$i"; break; fi
  done
fi
if [ -z "$IP" ]; then
  echo "WARNING: could not find this Mac's IP address - is Wi-Fi connected to the hotspot?"
  IP="<mac-ip>"
fi

CA_FILE=""
if command -v mkcert >/dev/null 2>&1; then
  CA_FILE="$(mkcert -CAROOT)/rootCA.pem"
fi

CERT=""
KEY=""
SCHEME=http
if [ "$MODE" = https ]; then
  if ! command -v mkcert >/dev/null 2>&1; then
    echo "mkcert is not installed. Install it with:  brew install mkcert"
    echo "(or use option A below with plain HTTP:  bash serve_phone_test.sh)"
    exit 1
  fi
  mkdir -p "$CERT_DIR"
  CERT="$CERT_DIR/$IP.pem"
  KEY="$CERT_DIR/$IP-key.pem"
  if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    echo "Creating a certificate for $IP with mkcert (first run also creates a local CA) ..."
    mkcert -cert-file "$CERT" -key-file "$KEY" "$IP" localhost 127.0.0.1 >/dev/null
  fi
  SCHEME=https
fi

URL="$SCHEME://$IP:$PORT/"
cat <<EOF

HANDOFF phone test page
  Serving : $PHONE_DIR
  This Mac: $IP (${IFACE:-?})
  On the Pixel (same Wi-Fi), open in Chrome:

      $URL

The camera, motion sensor and wake lock only work in a secure context.
The page's top bar shows a green "✓ Secure context" chip when it is right. Pick ONE way:

 (A) Chrome flag (quickest, plain HTTP):
     1. On the Pixel, open  chrome://flags/#unsafely-treat-insecure-origin-as-secure
     2. Set it to Enabled and type exactly:  http://$IP:$PORT
     3. Tap Relaunch, then open  http://$IP:$PORT/
     (Do step 2 again whenever the Mac's IP changes.)

 (B) HTTPS with mkcert (no flag; closer to the real app):
     1. On the Mac, once:  brew install mkcert
     2. Run:  bash serve_phone_test.sh --https
     3. On the Pixel open  https://$IP:$PORT/handoff-rootCA.crt
        Chrome warns "not private": tap Advanced > Proceed; the file downloads.
     4. Pixel Settings > search "CA certificate" > Install a certificate >
        CA certificate > Install anyway > pick the downloaded file.
     5. Open  https://$IP:$PORT/  - no warning any more.

Ctrl-C stops the server.
EOF

exec python3 - "$PORT" "$PHONE_DIR" "$CERT" "$KEY" "$CA_FILE" <<'PY'
import functools, http.server, os, ssl, sys, time

port, root, cert, key, ca = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # always serve the latest page
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/handoff-rootCA.crt":
            if not ca or not os.path.exists(ca):
                self.send_error(404, "No mkcert CA yet: run serve_phone_test.sh --https once")
                return
            with open(ca, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/x-x509-ca-cert")
            self.send_header("Content-Disposition", 'attachment; filename="handoff-rootCA.crt"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {self.client_address[0]} {fmt % args}", flush=True)


httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), functools.partial(Handler, directory=root))
if cert:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
PY
