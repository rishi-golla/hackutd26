#!/bin/bash
# Prepare a freshly imaged Raspberry Pi OS SD card (boot partition mounted on the Mac) so the Mac can reach the Pi over
# its USB-C cable on first boot: USB networking on, SSH on.
#   chromatic/tools/prep-sd.sh [/Volumes/boot]
set -e
BOOT=${1:-/Volumes/boot}
[ -f "$BOOT/config.txt" ] && [ -f "$BOOT/cmdline.txt" ] || { echo "No Pi boot partition at $BOOT"; exit 1; }
grep -q '^dtoverlay=dwc2' "$BOOT/config.txt" || printf '\ndtoverlay=dwc2\n' >> "$BOOT/config.txt"
grep -q 'modules-load=dwc2,g_ether' "$BOOT/cmdline.txt" || sed -i '' 's/rootwait/rootwait modules-load=dwc2,g_ether/' "$BOOT/cmdline.txt"
touch "$BOOT/ssh"
echo "SD card ready: put it in the Pi and connect the Pi's USB-C port to the Mac."
