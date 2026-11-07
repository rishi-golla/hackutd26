#!/usr/bin/env bash
# Set up the Handoff relay Pi (Raspberry Pi OS Lite 64-bit). Safe to re-run:
# every step checks first and only changes what is missing.
#
#   bash setup_pi.sh          (as your normal user over SSH - NOT with sudo)
#
# Installs i2c-tools, gpiozero, lgpio, venv, Pillow; enables I2C; makes
# ~/handoff-venv (with system packages, so gpiozero/lgpio/PIL are visible)
# and installs smbus2, luma.oled and websockets into it.
set -euo pipefail

VENV="$HOME/handoff-venv"
APT_PACKAGES=(i2c-tools python3-gpiozero python3-lgpio python3-venv python3-pil)
PIP_PACKAGES=(smbus2 luma.oled websockets)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEED_REBOOT=0
NEED_RELOGIN=0

step() { printf '\n==> %s\n' "$*"; }
trap 'echo; echo "FAILED (line $LINENO). Is the Pi online? Try: ping -c 3 pypi.org"' ERR

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as your normal user, without sudo (it calls sudo itself when needed)."
  exit 1
fi
if ! grep -qa "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
  echo "WARNING: this does not look like a Raspberry Pi - continuing anyway."
fi

step "1/5 System packages"
missing=()
for p in "${APT_PACKAGES[@]}"; do
  if ! dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed"; then
    missing+=("$p")
  fi
done
if [ ${#missing[@]} -eq 0 ]; then
  echo "Already installed: ${APT_PACKAGES[*]}"
else
  echo "Installing: ${missing[*]}"
  sudo apt-get update
  sudo apt-get install -y "${missing[@]}"
fi

step "2/5 I2C interface"
if [ "$(sudo raspi-config nonint get_i2c)" = "0" ]; then
  echo "I2C already enabled."
else
  sudo raspi-config nonint do_i2c 0      # 0 = enable
  echo "I2C enabled."
fi
if [ ! -e /dev/i2c-1 ]; then
  sudo modprobe i2c-dev 2>/dev/null || true
fi
if [ -e /dev/i2c-1 ]; then
  echo "/dev/i2c-1 is present."
else
  echo "/dev/i2c-1 will appear after a reboot."
  NEED_REBOOT=1
fi

step "3/5 Permissions (groups i2c and gpio)"
for g in i2c gpio; do
  if id -nG "$USER" | tr ' ' '\n' | grep -qx "$g"; then
    echo "$USER is already in group $g."
  else
    sudo usermod -aG "$g" "$USER"
    echo "Added $USER to group $g."
    NEED_RELOGIN=1
  fi
done

step "4/5 Python venv at $VENV"
if [ -x "$VENV/bin/python" ] && grep -qiE '^include-system-site-packages *= *true' "$VENV/pyvenv.cfg"; then
  echo "venv already exists."
elif [ -x "$VENV/bin/python" ]; then
  echo "venv exists without system packages - recreating it with --system-site-packages."
  python3 -m venv --clear --system-site-packages "$VENV"
else
  python3 -m venv --system-site-packages "$VENV"
  echo "venv created."
fi
echo "Installing into the venv (skipped if already there): ${PIP_PACKAGES[*]}"
"$VENV/bin/python" -m pip install --disable-pip-version-check -q "${PIP_PACKAGES[@]}"

step "5/5 Check"
"$VENV/bin/python" - <<'PY'
import importlib
for name in ("smbus2", "luma.oled", "websockets", "gpiozero", "lgpio", "PIL"):
    try:
        importlib.import_module(name)
        print(f"  ok       {name}")
    except Exception as e:
        print(f"  MISSING  {name}: {e}")
PY

trap - ERR
echo
echo "Setup complete."
if [ "$NEED_REBOOT" = 1 ]; then
  echo "  -> Reboot now:  sudo reboot   (wait ~1 min, then SSH in again)"
elif [ "$NEED_RELOGIN" = 1 ]; then
  echo "  -> Log out and back in (type: exit, then ssh again) so the new groups apply."
fi
cat <<EOF

Every time you SSH in:
  source ~/handoff-venv/bin/activate
  cd $SCRIPT_DIR

Then run the checks in this order (README has the expected output):
  python3 -m lib.selftest
  python3 health_check.py
  python3 i2c_scan.py
  python3 test_oled.py
  python3 test_max30101.py --oled
  python3 identify_wires.py        (before wiring the MARK button)
  python3 test_button.py
  python3 stream_test.py <mac-ip>  (start mac/receiver.py first)
EOF
