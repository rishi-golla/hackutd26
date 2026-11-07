#!/bin/bash
# Copy the hub + sensor program to the Pi (over the USB cable) and (re)start both.
#   ./deploy.sh                      deploy
#   ./deploy.sh wifi "NAME" "PASS"   also join a Wi-Fi network (e.g. your phone hotspot)
set -e
cd "$(dirname "$0")"
PI=../chromatic/tools/pi.sh
DST="cmx@[$($PI --ip)]"
SSHO="-6 -i ../chromatic/captures/private/pi_key -o UserKnownHostsFile=../chromatic/captures/private/pi_known_hosts -o StrictHostKeyChecking=no"

if [ "$1" = wifi ]; then
  $PI "sudo raspi-config nonint do_wifi_country US && sudo raspi-config nonint do_wifi_ssid_passphrase $(printf %q "$2") $(printf %q "$3") && sleep 8 && hostname -I"
fi

$PI 'mkdir -p /home/cmx/hub'
scp $SSHO hub.py phone.html dash.html link.sh handoff-hub.service handoff-link.service "$DST:/home/cmx/hub/"
scp $SSHO ../chromatic/pi/pi_oximeter.py "$DST:/home/cmx/"
$PI 'chmod +x /home/cmx/hub/link.sh && sudo cp /home/cmx/hub/handoff-*.service /etc/systemd/system/ && sudo systemctl daemon-reload &&
     sudo systemctl enable handoff-hub handoff-link && sudo systemctl restart handoff-hub cmx-oximeter handoff-link && sleep 3 &&
     systemctl is-active handoff-hub cmx-oximeter handoff-link && echo "Wi-Fi address(es): $(hostname -I)"'
