#!/bin/bash
# SSH to the Pi over the USB cable. Its address changes every boot, so find it on the USB link (en7) first.
#   pi.sh [command]     run a command (or open a shell) on the Pi
#   pi.sh --ip          print the Pi's address
# The SSH key defaults to captures/private/pi_key next to this tools/ folder; set PI_KEY to use another.
DIR=$(cd "$(dirname "$0")/.." && pwd)
KEY=${PI_KEY:-$DIR/captures/private/pi_key}
HOSTS=${PI_KNOWN_HOSTS:-$DIR/captures/private/pi_known_hosts}
IP=$(ping6 -c 2 -i 0.5 ff02::1%en7 2>/dev/null | grep -o 'fe80::[0-9a-f:]*%en7' | grep -v "$(ifconfig en7 | grep -o 'fe80::[0-9a-f:]*' | head -1)%" | head -1)
[ "$1" = --ip ] && { echo "$IP"; exit; }
[ "$1" = --ssh-opts ] && { echo "-i $KEY -o UserKnownHostsFile=$HOSTS -o StrictHostKeyChecking=no"; exit; }
[ -z "$IP" ] && { echo "Pi not found on USB (en7). Plug its USB-C port into the Mac and wait ~45 s." >&2; exit 255; }
exec ssh -i "$KEY" -o UserKnownHostsFile="$HOSTS" -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o BatchMode=yes "cmx@$IP" "$@"
