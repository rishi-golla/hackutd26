#!/bin/bash
# Copy the hub + sensor program to the Pi (USB cable on a Mac, or Wi-Fi with PI_HOST set), test the sensor on real
# recordings, and only then switch over and restart. The public link keeps running (restarting it would give the
# phone a new URL).
#   ./deploy.sh                      deploy
#   PI_HOST=192.168.1.20 ./deploy.sh deploy to the Pi at that Wi-Fi address (Windows Git Bash, Linux, Mac)
#   ./deploy.sh wifi "NAME" "PASS"   also join a Wi-Fi network (e.g. your phone hotspot)
#   ./deploy.sh setup                one-time setup of a fresh Pi: packages, I2C, tunnel, USB networking
set -e
cd "$(dirname "$0")"
PI=../chromatic/tools/pi.sh
DST=$($PI --dst)
SSHO=(-q)
while IFS= read -r o; do SSHO+=("$o"); done < <($PI --ssh-opts)

if [ "$1" = setup ]; then                                     # once, on a fresh Pi (needs internet)
  scp "${SSHO[@]}" setup-pi.sh "$DST:/tmp/setup-pi.sh"
  $PI 'sudo bash /tmp/setup-pi.sh && rm /tmp/setup-pi.sh'
  exit
fi

if [ "$1" = wifi ]; then
  $PI "sudo raspi-config nonint do_wifi_country US && sudo raspi-config nonint do_wifi_ssid_passphrase $(printf %q "$2") $(printf %q "$3") && sleep 8 && hostname -I"
  # over Wi-Fi the Pi just left the network PI_HOST is on, so it can only be reached at its new address
  [ -n "$PI_HOST" ] && { echo "Pi moved to $2. Run again with PI_HOST set to its new address (printed above, if it answered)."; exit; }
fi

$PI 'rm -rf /home/cmx/next && mkdir -p /home/cmx/next/hub /home/cmx/next/testdata /home/cmx/hub'
scp "${SSHO[@]}" hub.py common.js phone.html dash.html link.sh handoff-hub.service handoff-link.service "$DST:/home/cmx/next/hub/"
scp "${SSHO[@]}" ../chromatic/pi/{pi_oximeter,max30102,pi_hr_sensor,test_sensor}.py ../chromatic/pi/cmx-oximeter.service "$DST:/home/cmx/next/"
scp "${SSHO[@]}" ../chromatic/pi/testdata/*.json "$DST:/home/cmx/next/testdata/"
$PI 'cd /home/cmx/next && python3 -W ignore test_sensor.py' || { echo "Sensor test failed: nothing deployed."; exit 1; }
$PI 'cp /home/cmx/next/*.py /home/cmx/ && cp -r /home/cmx/next/testdata /home/cmx/ && cp /home/cmx/next/hub/* /home/cmx/hub/ &&
     sudo cp /home/cmx/hub/handoff-*.service /home/cmx/next/cmx-oximeter.service /etc/systemd/system/ &&
     rm -rf /home/cmx/next && chmod +x /home/cmx/hub/link.sh &&
     sudo systemctl daemon-reload && sudo systemctl enable --now handoff-hub handoff-link cmx-oximeter &&
     sudo systemctl restart handoff-hub cmx-oximeter && sleep 3 &&
     systemctl is-active handoff-hub cmx-oximeter handoff-link && curl -s localhost:8000/state | grep -oE "https://[a-z0-9-]+\.trycloudflare\.com"'
