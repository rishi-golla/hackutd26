#!/bin/bash
# One-time setup of a fresh Raspberry Pi OS (Bullseye) for the hub and sensor. deploy.sh runs it as `./deploy.sh setup`;
# it is safe to run again. Needs internet on the Pi.
set -e
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }

raspi-config nonint do_i2c 0                                  # finger sensor on I2C bus 1
apt-get install -y -q python3-numpy python3-scipy python3-matplotlib python3-smbus python3-dbus python3-gi \
                      python3-rpi.gpio bluez i2c-tools
pip3 install -q --no-deps heartpy                             # --no-deps: pip's numpy would replace the working apt one

if ! command -v cloudflared >/dev/null; then                  # the public https link (hub/link.sh)
  arch=$(dpkg --print-architecture); [ "$arch" = armhf ] && arch=arm
  curl -fsSL -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch"
  chmod 755 /usr/local/bin/cloudflared
fi

# USB networking, so a Mac can reach the Pi over its USB-C cable (takes effect after a reboot)
grep -q '^dtoverlay=dwc2' /boot/config.txt || echo 'dtoverlay=dwc2' >> /boot/config.txt
grep -q 'modules-load=dwc2,g_ether' /boot/cmdline.txt || sed -i 's/rootwait/rootwait modules-load=dwc2,g_ether/' /boot/cmdline.txt
echo "setup done"
