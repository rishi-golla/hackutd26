#!/bin/bash
# SSH to the Pi. Over Wi-Fi, set PI_HOST to its address (e.g. PI_HOST=192.168.1.20). Otherwise the Pi is found on a
# Mac's USB cable: its address there changes every boot, so look it up on the Mac's "RNDIS/Ethernet Gadget" interface
# (set PI_IF to override).
#   pi.sh [command]     run a command (or open a shell) on the Pi
#   pi.sh -t command    same, with a terminal (for commands that ask for input)
#   pi.sh --ip          print the Pi's address
#   pi.sh --dst         print cmx@[address], for scp
# The SSH key is captures/private/pi_key next to this tools/ folder if it exists, else ~/.ssh/id_ed25519;
# set PI_KEY to use another.
DIR=$(cd "$(dirname "$0")/.." && pwd)
KEY=${PI_KEY:-$DIR/captures/private/pi_key}
[ -f "$KEY" ] || KEY=$HOME/.ssh/id_ed25519
HOSTS=${PI_KNOWN_HOSTS:-$DIR/captures/private/pi_known_hosts}
[ -d "$(dirname "$HOSTS")" ] || HOSTS=$HOME/.ssh/known_hosts
if [ -n "$PI_HOST" ]; then
  IP=$PI_HOST; WHERE="at $PI_HOST"; FAM=
else
  IF=${PI_IF:-$(networksetup -listallhardwareports 2>/dev/null | awk '/Gadget/ {getline; print $2; exit}')}
  IF=${IF:-en7}
  IP=$(ping6 -c 2 -i 0.5 "ff02::1%$IF" 2>/dev/null | grep -o "fe80::[0-9a-f:]*%$IF" | grep -v "$(ifconfig "$IF" 2>/dev/null | grep -o 'fe80::[0-9a-f:]*' | head -1)%" | head -1)
  WHERE="on USB ($IF). Plug its USB-C port into the Mac and wait ~45 s, or set PI_HOST to its Wi-Fi address"; FAM=-6
fi
[ "$1" = --ip ] && { echo "$IP"; exit; }
[ "$1" = --ssh-opts ] && { echo "$FAM -i $KEY -o UserKnownHostsFile=$HOSTS -o StrictHostKeyChecking=no"; exit; }
[ -z "$IP" ] && { echo "Pi not found $WHERE." >&2; exit 255; }
[ "$1" = --dst ] && { echo "cmx@[$IP]"; exit; }
T=(); [ "$1" = -t ] && { T=(-t); shift; }                    # ssh only takes -t before the host
exec ssh "${T[@]}" $FAM -i "$KEY" -o UserKnownHostsFile="$HOSTS" -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o BatchMode=yes "cmx@$IP" "$@"
