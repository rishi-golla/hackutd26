#!/bin/bash
# Public https link to the hub (the phone camera needs https): a free Cloudflare quick tunnel. No account, no time
# limit, no warning page (pinggy free links died within the hour and were 3x slower: 260 ms vs 85 ms per frame).
# The link changes only when this restarts; every new link is posted to the hub and shows on the dashboard.
while true; do
  cloudflared tunnel --no-autoupdate --url http://localhost:8000 2>&1 |
  while read -r line; do
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' <<<"$line" | head -1)
    [ -n "$url" ] && echo "$url" && curl -s --max-time 3 -d "{\"from\":\"pi\",\"what\":\"link\",\"value\":\"$url\"}" http://127.0.0.1:8000/send >/dev/null
  done
  sleep 3
done
