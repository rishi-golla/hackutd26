#!/bin/bash
# Copy the bridge to the Pi (over the USB cable, like hub/deploy.sh) and start it as a service.
# Doesn't touch the hub or the sensor service.   ./deploy.sh
set -e
cd "$(dirname "$0")"
PI=../chromatic/tools/pi.sh
DST="cmx@[$($PI --ip)]"
SSHO="-6 -q $($PI --ssh-opts)"
$PI 'mkdir -p /home/cmx/bridge'
scp $SSHO hub_bridge.py handoff-bridge.service "$DST:/home/cmx/bridge/"
$PI 'sudo cp /home/cmx/bridge/handoff-bridge.service /etc/systemd/system/ && sudo systemctl daemon-reload &&
     sudo systemctl enable --now handoff-bridge && sudo systemctl restart handoff-bridge && sleep 4 &&
     systemctl is-active handoff-bridge && journalctl -u handoff-bridge -n 5 --no-pager -o cat'
