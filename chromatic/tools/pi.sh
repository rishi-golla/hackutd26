#!/bin/bash
# SSH to the Pi: over the USB cable on a Mac, or over Wi-Fi from anywhere (Windows Git Bash, Linux, Mac).
#   pi.sh [command]     run a command (or open a shell) on the Pi
#   pi.sh --ip          print the Pi's address
#   pi.sh --dst         print user@address as scp wants it
# PI_HOST=<address or name> uses the Pi on Wi-Fi (get it with `hostname -I` on the Pi). Without it, a Mac finds the
# Pi on the USB link (en7); its address there changes every boot.
# The SSH key defaults to captures/private/pi_key next to this tools/ folder; set PI_KEY to use another.
DIR=$(cd "$(dirname "$0")/.." && pwd)
KEY=${PI_KEY:-$DIR/captures/private/pi_key}
HOSTS=${PI_KNOWN_HOSTS:-$DIR/captures/private/pi_known_hosts}
if [ -n "$PI_HOST" ]; then
  IP=$PI_HOST
elif [ "$(uname)" = Darwin ]; then
  IP=$(ping6 -c 2 -i 0.5 ff02::1%en7 2>/dev/null | grep -o 'fe80::[0-9a-f:]*%en7' | grep -v "$(ifconfig en7 | grep -o 'fe80::[0-9a-f:]*' | head -1)%" | head -1)
fi
[ "$1" = --ip ] && { echo "$IP"; exit; }
[ "$1" = --ssh-opts ] && { echo "-i $KEY -o UserKnownHostsFile=$HOSTS -o StrictHostKeyChecking=no"; exit; }
if [ -z "$IP" ]; then
  if [ "$(uname)" = Darwin ]; then
    echo "Pi not found on USB (en7). Plug its USB-C port into the Mac and wait ~45 s, or set PI_HOST to its Wi-Fi address." >&2
  else
    echo "Set PI_HOST to the Pi's Wi-Fi address (hostname -I on the Pi), e.g.  export PI_HOST=192.168.1.20" >&2
  fi
  exit 255
fi
[ "$1" = --dst ] && { case $IP in *:*) echo "cmx@[$IP]" ;; *) echo "cmx@$IP" ;; esac; exit; }
exec ssh -i "$KEY" -o UserKnownHostsFile="$HOSTS" -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o BatchMode=yes "cmx@$IP" "$@"
