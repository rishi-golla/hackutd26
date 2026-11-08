#!/bin/bash
# Public https link to this laptop's voice worker (run.py on :7860, plain http, no --ssl) from a free Cloudflare quick
# tunnel, announced to the Pi hub as {"what":"voice"} so the bodycam page (hub/phone.html) connects to it by itself
# (SPEC decision 23). The tunnel carries only the WebRTC handshake; the audio goes phone <-> laptop directly (or
# through TURN). Run it in its own terminal from the repo root, next to the brain and run.py:
#   HUB_URL=http://handoff-pi:8000 voice/pipecat/link.sh        (the Pi over Tailscale; VOICE_PORT=7860)
# The link changes when this restarts; each new one is announced once the tunnel is registered, and every 30 s.
# Anyone with the link can connect to the worker: stop this (Ctrl-C) when you're not demoing.
command -v cloudflared >/dev/null || { echo "cloudflared is not installed (macOS: brew install cloudflared)"; exit 1; }
HUB_URL=${HUB_URL:-http://handoff-pi:8000}
HUB_URL=${HUB_URL%/}
PORT=${VOICE_PORT:-7860}
STATE=$(mktemp "${TMPDIR:-/tmp}/handoff-voice-link.XXXXXX") || exit 1

announce() {
  if curl -sf --max-time 3 -d "{\"from\":\"voice\",\"what\":\"voice\",\"value\":\"$1\"}" "$HUB_URL/send" >/dev/null; then
    [ "$2" = quiet ] || echo "announced $1 to $HUB_URL"
  else
    echo "hub $HUB_URL didn't take the link; announcing again in 30 s"
  fi
}

(while sleep 30; do [ -s "$STATE" ] && announce "$(cat "$STATE")" quiet; done) &
ANNOUNCER=$!
trap 'rm -f "$STATE"; kill $ANNOUNCER 2>/dev/null' EXIT

while true; do
  url=''
  cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" 2>&1 |
  while read -r line; do
    found=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' <<<"$line" | head -1)
    [ -n "$found" ] && url=$found && echo "$url (waiting for the tunnel to register)"
    # Announce only once Cloudflare has registered the tunnel, so the phone never looks up a name that isn't live yet.
    if [ -n "$url" ] && grep -q 'Registered tunnel connection' <<<"$line"; then
      echo "$url" > "$STATE"
      announce "$url"
      url=''
    fi
  done
  sleep 3
done
