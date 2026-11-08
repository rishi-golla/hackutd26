#!/bin/bash
# Flash the Chromatic with this firmware and turn on the vitals monitor at power-on.
# Needs ESP-IDF v5.3 in the shell (source esp-idf/export.sh) and the Chromatic on USB-C.
#   chromatic/fw/flash.sh [PORT]
# The first run saves the Chromatic's original flash (4 MB, about 6 minutes) next to this script; restore it with
#   python -m esptool -p PORT -b 115200 write_flash 0 chromatic-original-*.bin
set -e
cd "$(dirname "$0")"
# shellcheck disable=SC2012
PORT=${1:-$(ls /dev/cu.usbmodem* /dev/ttyACM* 2>/dev/null | head -1)}
[ -n "$PORT" ] || { echo "Chromatic not found on USB. Plug it in, or pass the port."; exit 1; }

if ! ls chromatic-original-*.bin >/dev/null 2>&1; then
  python -m esptool --chip esp32 -p "$PORT" -b 115200 read_flash 0 0x400000 "chromatic-original-$(date +%Y%m%d-%H%M%S).bin"
fi
(cd xp2 && idf.py -p "$PORT" -b 115200 build app-flash)      # app only, at 0x10000: the stock bootloader stays

# Standalone mode is a setting on the device: send `mboot on` to its console (DTR/RTS low so it is not reset).
python - "$PORT" <<'EOF'
import sys, time, serial
s = serial.Serial()
s.port, s.baudrate, s.timeout, s.dtr, s.rts = sys.argv[1], 115200, 0.1, False, False
s.open()
time.sleep(6)                                               # let it finish booting after the flash
s.reset_input_buffer()
s.write(b"\r\nmboot on\r\n")
out, end = b"", time.time() + 3
while time.time() < end and b'"saved":true' not in out:
    out += s.read(4096)
s.close()
sys.exit(0 if b'"saved":true' in out else "could not turn on standalone mode: " + out.decode("utf-8", "replace")[-300:])
EOF
echo "Flashed. The vitals monitor starts by itself at the next power-on."
