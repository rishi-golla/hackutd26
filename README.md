# Handoff

A paramedic's finger sensor and bodycam, live at the ER before the patient arrives.

- A Raspberry Pi 4 reads a MAX30102 finger sensor and shows the heart rate (and an experimental SpO2) on a ModRetro
  Chromatic over Bluetooth.
- The Pi also runs the hub. A phone worn on the chest streams camera and audio to it, and the ER watches the
  dashboard through a public link.

```
hub/                 hub server, phone + dashboard pages, Pi setup and deploy scripts
chromatic/pi/        finger sensor service, driver, tests on real recordings
chromatic/tools/     pi.sh (SSH to the Pi over USB), prep-sd.sh (first boot over USB)
chromatic/fw/        Chromatic firmware (ModRetro's GPL-3.0 MCU firmware + the vitals screen) and flash.sh
```

## What you need

- Raspberry Pi 4, a microSD card, and a USB-C data cable to a Mac.
- MAX30102 sensor (on a Qwiic SHIM), a push button, and an RGB ring LED (common anode) with two 220 Ω resistors.
- ModRetro Chromatic and a USB-C cable.
- An Android or iPhone with Chrome or Safari.

## 1. Wire the Pi

| Part | Pi header pin |
|---|---|
| MAX30102 via Qwiic SHIM | pins 1 to 6 (3.3 V, SDA, SCL, GND) |
| Button | pin 11 (GPIO17) and pin 9 (GND) |
| Ring LED common + | 3.3 V (pin 17) |
| Ring LED red | pin 18 (GPIO24) through 220 Ω |
| Ring LED blue | pins 15 and 16 (GPIO22, GPIO23) through 220 Ω |

The ring shows steady blue for a reading, blinking blue while measuring, blinking red when the sensor is unplugged, and
a red flash when the button marks a moment. On the board we used, green does not light, so the code does not use it.

## 2. Set up the Pi (once)

1. Make an SSH key: `mkdir -p chromatic/captures/private && ssh-keygen -t ed25519 -N '' -f chromatic/captures/private/pi_key`.
   This folder is git-ignored. To keep the key elsewhere, set `PI_KEY`.
2. In Raspberry Pi Imager, choose **Raspberry Pi OS (Legacy) Lite, Bullseye**. The code relies on its Python 3.9
   and apt numpy. In the settings, set the username `cmx`, turn on SSH with the public key from
   `chromatic/captures/private/pi_key.pub`, and add a Wi-Fi network that has internet.
3. Leave the card in the Mac and run `chromatic/tools/prep-sd.sh`. This turns on networking over the USB cable.
4. Put the card in the Pi, then connect the Pi's USB-C port to the Mac. Wait about 45 seconds.
   `chromatic/tools/pi.sh` should open a shell on the Pi.
5. Run `hub/deploy.sh setup`. It installs the packages, turns on I2C, and installs cloudflared. Then reboot the Pi
   with `chromatic/tools/pi.sh sudo reboot`.

For WPA2-Enterprise Wi-Fi such as a campus network, copy the login script to the Pi and run it. It asks for the
username and password.

```
chromatic/tools/pi.sh 'cat > wifi-login.sh' < chromatic/pi/wifi-login.sh
chromatic/tools/pi.sh -t 'sudo bash wifi-login.sh SSID'
```

## 3. Deploy

```
hub/deploy.sh                     # copy, test the sensor code on real recordings, then switch over
hub/deploy.sh wifi "NAME" "PASS"  # same, and join a Wi-Fi network (for example a phone hotspot)
```

The deploy ends by printing the public link (`https://….trycloudflare.com`). The services start at every boot. The
link changes when the Pi reboots, and the newest link is always on the dashboard.

**Over Wi-Fi instead of the USB cable**, set `PI_HOST` to the Pi's address, e.g. `PI_HOST=192.168.1.20 hub/deploy.sh`
or `PI_HOST=192.168.1.20 chromatic/tools/pi.sh`. Without `captures/private/pi_key` the scripts use your own
`~/.ssh/id_ed25519`. Add it to the Pi once with
`ssh-copy-id -i ~/.ssh/id_ed25519.pub cmx@192.168.1.20` (it asks for the Pi's password). On Windows, run the scripts
in Git Bash or WSL.

## 4. Flash the Chromatic (once)

1. Install [ESP-IDF v5.3](https://docs.espressif.com/projects/esp-idf/en/v5.3/esp32/get-started/), then run
   `. $IDF_PATH/export.sh` in your shell.
2. Plug the Chromatic into the Mac and switch it on.
3. Run `chromatic/fw/flash.sh`.
   - The first run saves the original flash to `chromatic/fw/chromatic-original-*.bin` (about 6 minutes). The script
     prints how to restore it.
   - It then builds and flashes the app, and turns on standalone mode.

From then on the Chromatic needs no laptop. Each time it powers on it opens the vitals screen and connects to the Pi's
Bluetooth heart-rate sensor (`PI-HRM`) by itself, and it reconnects after drop-outs. To turn standalone mode off, send `mboot off` on its serial
console at 115200 baud.

## 5. Use it

- **Phone:** open the link, tap Start, and allow the camera and microphone. Keep the screen on and wear it on the chest.
- **ER:** open the link with `/dash` at the end. It shows the camera, heart rate, SpO2, sensor status and activity
  feed. You can type a message and the phone speaks it aloud.
- **Patient:** place a finger on the sensor and hold it still. A heart rate appears in about 4 seconds.

## SpO2 calibration

SpO2 is marked experimental until it is calibrated against a reference finger oximeter. To calibrate:

1. Put a finger on our sensor and a finger of the same hand in the reference oximeter.
2. Record for 60 seconds. The service is stopped while recording because it reads the same sensor:
   `chromatic/tools/pi.sh 'sudo systemctl stop cmx-oximeter; python3 max30102.py record 60 cal.json; sudo systemctl start cmx-oximeter'`.
3. Save the offset: `chromatic/tools/pi.sh 'python3 max30102.py calibrate cal.json REF'`, where `REF` is the reference
   reading. This writes `/home/cmx/spo2_cal.json`. It needs 20 clean 4-second windows. If there are fewer, record again
   with the finger firm and still.
4. Restart the sensor service: `chromatic/tools/pi.sh sudo systemctl restart cmx-oximeter`.

## License

`chromatic/fw/xp2` is a modified version of ModRetro's Chromatic MCU firmware under the GNU GPL v3. See its `LICENSE`
and `NOTICE`.
