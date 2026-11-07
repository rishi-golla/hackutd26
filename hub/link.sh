#!/bin/bash
# Public https link to the hub (the phone camera needs https). Free pinggy tunnels end after 60 min, so reconnect
# forever; every new link is posted to the hub and shows up on the dashboard.
while true; do
  ssh -p 443 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R0:localhost:8000 a.pinggy.io 2>&1 |
  while read -r line; do
    url=$(grep -oE 'https://[a-z0-9-]+\.free\.pinggy\.net' <<<"$line" | head -1)
    [ -n "$url" ] && echo "$url" && curl -s -m 3 -d "{\"from\":\"pi\",\"what\":\"link\",\"value\":\"$url\"}" http://127.0.0.1:8000/send >/dev/null
  done
  sleep 3
done
