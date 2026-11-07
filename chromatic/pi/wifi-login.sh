#!/bin/bash
# Join a school Wi-Fi (WPA2-Enterprise, PEAP/MSCHAPv2) such as CometNet with your NetID.
#   sudo ./wifi-login.sh                 CometNet
#   sudo ./wifi-login.sh eduroam         another network
#   sudo ./wifi-login.sh CometNet --no-ca   skip the server certificate check (only if the normal run fails on it)
# The password is never stored in plain text: only its MSCHAPv2 hash goes into wpa_supplicant.conf (root-only).
set -e
SSID=${1:-CometNet}
CONF=/etc/wpa_supplicant/wpa_supplicant.conf
[ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo $0 $*"; exit 1; }

read -rp "Username (NetID) for $SSID: " USER
read -rsp "Password: " PASS; echo
HASH=$(printf %s "$PASS" | iconv -t UTF-16LE | openssl md4 | awk '{print $NF}')
unset PASS
CA='	ca_cert="/etc/ssl/certs/ca-certificates.crt"'
[ "$2" = --no-ca ] && CA=''

cp -n "$CONF" "$CONF.orig"                                   # first run keeps the original
awk -v s="ssid=\"$SSID\"" '/^network=\{/{b=$0; skip=0; inb=1; next}
  inb{b=b"\n"$0; if(index($0,s)) skip=1; if($0 ~ /^}/){ if(!skip) print b; inb=0 } next} {print}' "$CONF.orig" > "$CONF.new"
cat >> "$CONF.new" <<EOF

network={
	ssid="$SSID"
	key_mgmt=WPA-EAP
	eap=PEAP
	identity="$USER"
	password=hash:$HASH
	phase2="auth=MSCHAPV2"
$CA
	priority=10
}
EOF
install -m 600 "$CONF.new" "$CONF" && rm "$CONF.new"

wpa_cli -i wlan0 reconfigure >/dev/null
echo "Connecting to $SSID..."
for i in $(seq 1 30); do
  IP=$(ip -4 -o addr show wlan0 | awk '{print $4}' | cut -d/ -f1)
  ON=$(wpa_cli -i wlan0 status | grep -x "ssid=$SSID")
  [ -n "$IP" ] && [ -n "$ON" ] && { echo "Connected. Pi address: $IP"; ping -c 1 -W 3 1.1.1.1 >/dev/null && echo "Internet: OK" || echo "Internet: no (network may need device registration)"; exit 0; }
  sleep 1
done
echo "Not connected after 30 s. Last Wi-Fi log lines:"
journalctl -n 60 --no-pager | grep -i wpa | tail -8 | cut -c1-160 || true
echo "If the log mentions a certificate, run: sudo $0 $SSID --no-ca"
exit 1
