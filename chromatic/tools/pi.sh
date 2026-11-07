#!/bin/bash
# SSH to the Pi over the USB cable. Its address changes every boot, so find it on the USB link (en7) first.
IP=$(ping6 -c 2 -i 0.5 ff02::1%en7 2>/dev/null | grep -o 'fe80::[0-9a-f:]*%en7' | grep -v "$(ifconfig en7 | grep -o 'fe80::[0-9a-f:]*' | head -1)%" | head -1)
[ "$1" = --ip ] && { echo "$IP"; exit; }
[ -z "$IP" ] && { echo "Pi not found on USB (en7). Plug its USB-C port into the Mac and wait ~45 s." >&2; exit 255; }
exec ssh -i /Users/kovidh/Hackathon-Ideation/chromatic/captures/private/pi_key -o UserKnownHostsFile=/Users/kovidh/Hackathon-Ideation/chromatic/captures/private/pi_known_hosts -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o BatchMode=yes "cmx@$IP" "$@"
