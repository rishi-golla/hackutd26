# Handoff: device setup and hardware tests

Bring-up and test tools for the two Handoff devices (build spec: `handoff-phase2-build-spec`):

- **Vitals relay**: Raspberry Pi 4, MAX30101 finger sensor, MARK button with an RGB light ring. (A 1.3" OLED is optional and no longer in the build; the scripts still drive one if it's plugged in.)
- **AI bodycam**: Pixel 9 Pro in Chrome. Camera, motion sensor, speaker, wake lock.

These are **hardware checks, not the Handoff app**. They prove each part works and print the likely
fix when one doesn't.

| Folder | What | Runs on |
| --- | --- | --- |
| `pi/setup_pi.sh` | One-time setup (packages, I2C, venv). Safe to re-run. | Pi |
| `pi/health_check.py` | CPU temperature, power/throttling, Wi-Fi, I2C devices | Pi |
| `pi/i2c_scan.py` | Names what's on the I2C bus and explains what's missing | Pi |
| `pi/test_oled.py` | Draws a demo on the optional OLED for 10 s | Pi (only if fitted) |
| `pi/test_lcd.py` | Shows a demo on the optional LCD1602 add-on | Pi (only if fitted) |
| `pi/test_max30101.py` | Sensor ID, raw red/IR, finger detection, heart rate, SpO2 (experimental) | Pi (`--simulate` anywhere) |
| `pi/identify_wires.py` | Finds which of the button's 6 wires is which, step by step | Pi |
| `pi/test_button.py` | MARK button press/hold and ring colours | Pi |
| `pi/stream_test.py` | Sends readings to the Mac over WebSocket at 25 Hz | Pi (`--simulate` anywhere) |
| `pi/lib/` | Shared code: MAX30101 driver, DSP, OLED, GPIO, self-test | — |
| `mac/receiver.py` | Receives and prints the stream | Mac |
| `mac/serve_phone_test.sh` | Serves the phone page to the Pixel | Mac |
| `phone/index.html` | Phone test page: camera, motion, speaker, wake lock | Pixel (Chrome) |

Order of work: **1** flash the SD card, **2** SSH in, **3** copy the scripts, **4** run setup,
**5** run the Pi tests in order, **6** stream to the Mac, **7** phone page.

Wiring reference (build spec §3), Pi 4 header physical pins:

| Part | Pin |
| --- | --- |
| Qwiic SHIM | pins 1–6 (square pad over pin 1). 500 mm Qwiic cable from the SHIM straight to the MAX30101 |
| MARK switch | pin 11 (GPIO17) and pin 9 (GND) |
| Ring common + | pin 17 (3.3 V) |
| Ring red / green / blue | 220 Ω → pin 15 (GPIO22) / pin 16 (GPIO23) / pin 18 (GPIO24) |

I2C address: **0x57** MAX30101 (an optional OLED would add 0x3D or 0x3C). Type `pinout` on the Pi for a header diagram.

---

## 1. Flash the SD card (Raspberry Pi Imager, on the Mac)

1. Install Raspberry Pi Imager (`brew install --cask raspberry-pi-imager`, or raspberrypi.com/software).
2. **Device**: Raspberry Pi 4. **OS**: Raspberry Pi OS (other) → **Raspberry Pi OS Lite (64-bit)**.
   **Storage**: the microSD card.
3. When asked about OS customisation, choose **Edit settings** and set:

   | Setting | Value |
   | --- | --- |
   | Hostname | `handoff-relay` |
   | Username / password | `handoff` / a password the team knows (this README uses `handoff`) |
   | Wi-Fi SSID / password | Dino's hotspot, typed exactly |
   | Wireless LAN country | `US` (Wi-Fi stays off without a country) |
   | Time zone / keyboard | `America/Chicago` / `us` |
   | Services | **Enable SSH**, use password authentication |

4. Save → Yes → Write. Takes about 5 minutes.

**Hotspot tips (do these before flashing):**
- iPhone hotspot names like `Dino’s iPhone` contain a curly apostrophe that is hard to type.
  Rename the phone to something plain (iPhone: Settings → General → About → Name, e.g. `dino-hotspot`).
- iPhone: turn on **Maximize Compatibility** (Settings → Personal Hotspot) and keep that screen open
  while the Pi joins the first time.
- Android: set the hotspot band to 2.4 GHz if the Pi won't join.

## 2. First boot and SSH

1. Put the card in the Pi, turn the hotspot on, power the Pi. **First boot takes 2–3 minutes**
   (it resizes the card and reboots once).
2. Join the Mac to the **same** hotspot.
3. On the Mac: `ssh handoff@handoff-relay.local` → answer `yes` to the fingerprint question → password.

Expected: a prompt like `handoff@handoff-relay:~ $`.

| If you see | Do |
| --- | --- |
| `Could not resolve hostname handoff-relay.local` | Wait 2 more minutes. Check the hotspot's connected-devices list. Use the IP instead: `ssh handoff@172.20.10.x` (iPhone hotspots use 172.20.10.x; `arp -a` on the Mac lists neighbours). |
| `Connection refused` | SSH wasn't enabled in Imager: re-flash with SSH on. |
| `Permission denied` | Wrong username/password: re-flash. |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` (after a re-flash) | `ssh-keygen -R handoff-relay.local`, then connect again. |
| The Pi never shows up on the hotspot | SSID/password typo or no Wi-Fi country: re-flash. Red LED blinking = power too weak. |

## 3. Copy the scripts to the Pi

From this `software/` folder on the Mac:

```bash
rsync -av --exclude __pycache__ pi/ handoff@handoff-relay.local:~/handoff-pi/
```

Run it again after any change; it only copies what changed. (`scp -r pi handoff@handoff-relay.local:~/handoff-pi` also works.)

## 4. Run the setup (on the Pi)

```bash
cd ~/handoff-pi
bash setup_pi.sh
```

Needs internet (the hotspot's data). Takes 2–5 minutes the first time, seconds after that.
Expected output (apt/pip download lines omitted):

```
==> 1/5 System packages
Installing: i2c-tools python3-venv            <- whatever was missing
...
==> 2/5 I2C interface
I2C enabled.
/dev/i2c-1 is present.

==> 3/5 Permissions (groups i2c and gpio)
handoff is already in group i2c.
handoff is already in group gpio.

==> 4/5 Python venv at /home/handoff/handoff-venv
venv created.
Installing into the venv (skipped if already there): smbus2 luma.oled websockets

==> 5/5 Check
  ok       smbus2
  ok       luma.oled
  ok       websockets
  ok       gpiozero
  ok       lgpio
  ok       PIL

Setup complete.
```

then a "next steps" list. A second run says `Already installed`, `I2C already enabled.`, `venv already exists.`

**Every time you SSH in, first run:**

```bash
source ~/handoff-venv/bin/activate
cd ~/handoff-pi
```

| If you see | Do |
| --- | --- |
| `FAILED (line N). Is the Pi online?` | The hotspot has no data, or Wi-Fi dropped. `ping -c 3 pypi.org`, fix, re-run. |
| `Run this as your normal user, without sudo` | Run `bash setup_pi.sh`, not `sudo bash ...`. |
| `-> Reboot now: sudo reboot` | Do it, wait a minute, SSH in again. |
| `-> Log out and back in` | `exit`, then SSH in again (new groups apply at login). |
| `MISSING  <package>` in step 5 | Re-run the script; if it persists, copy the error to the coordinator. |

### Add home Wi-Fi later (for bench work)

While connected through the hotspot, add the home network **without switching to it**:

```bash
sudo nmcli connection add type wifi ifname wlan0 con-name home ssid "HomeWiFiName" \
     wifi-sec.key-mgmt wpa-psk wifi-sec.psk "home-password"
sudo nmcli connection modify preconfigured connection.autoconnect-priority 10   # prefer the hotspot
nmcli connection show            # lists 'preconfigured' (the Imager hotspot profile) and 'home'
```

The Pi joins whichever is available, preferring the hotspot. (`preconfigured` is the name Imager
gives its Wi-Fi profile; check `nmcli connection show` if yours differs.)

## 5. Pi tests, in order

Run each from `~/handoff-pi` with the venv active. Every script has `--help`.

### 5.0 Self-test (no hardware needed)

```bash
python3 -m lib.selftest
```

Expected, exactly:

```
PASS  band-pass 0.5-4 Hz: passes 1.2 Hz, blocks DC and 20 Hz
PASS  priming with the first sample: no start-up transient on a 100k DC level
PASS  peak detector finds every cycle of a 1.5 Hz sine
PASS  two bumps 0.15 s apart count once (refractory 0.3 s)
PASS  rate_per_minute uses the median and drops impossible intervals
PASS  heart rate within 3 bpm for 45-180 bpm, no missed beats (notch, wander, HRV)
PASS  heart rate within 4 bpm with 4x the noise and a strong dicrotic bump
PASS  heart rate at 40 bpm (slow upstroke) and with +/-30 % pulse-size changes
PASS  HR/SpO2 go null: flat signal within 5 s, saturation and lost samples at once
PASS  no finger -> not present, no heart rate, no SpO2
PASS  finger detector: threshold from calibration, on/off with hysteresis
PASS  calibrating with a finger on: warns, then heals when the finger lifts
PASS  SpO2 (EXPERIMENTAL): formula values and R=0.5 from the pipeline -> ~98.8 %
PASS  register encoders: SpO2 config, FIFO config, LED current
PASS  FIFO pointers: wrap-around, empty, and full (overflow counter set)
PASS  FIFO parsing: 3 bytes per channel, MSB first, bits 23:18 masked
PASS  driver on a simulated bus: part ID, setup, 100/s, overflow and recovery
PASS  i2cdetect parsing and diagnosis of missing devices
PASS  vcgencmd get_throttled decoding
PASS  nmcli Wi-Fi and `ip addr` parsing
PASS  wire identification: all 720 orders, common anode and common cathode

21/21 checks passed
```

Any `FAIL` means the files were damaged in the copy: re-run the rsync.

### 5.1 Health check

```bash
python3 health_check.py
```

Expected (values vary):

```
HANDOFF relay health check  (handoff-relay, 2026-11-07 10:15:02)
------------------------------------------------------------------
Model       : Raspberry Pi 4 Model B Rev 1.5
CPU temp    : 47.2 C   OK
Power/clock : throttled=0x0   OK - no under-voltage or throttling since boot
Wi-Fi       : connected to "dino-hotspot", signal 71%
IP address  : 172.20.10.3 (wlan0)
Name        : handoff-relay.local
I2C bus 1   : 0x57   OK
------------------------------------------------------------------
RESULT: all good
```

Before the Qwiic parts are plugged in, the I2C line says `none   PROBLEM`; that's expected.
Example of a problem report:

```
Power/clock : throttled=0x50005
              - under-voltage detected NOW
              - throttled NOW
              - under-voltage has occurred since boot
              - throttling has occurred since boot
...
RESULT: needs attention
  - Power supply is too weak right now: use the official 5.1 V 3 A supply or a short, thick USB-C cable.
```

| If you see | Do |
| --- | --- |
| `under-voltage detected NOW` / `has occurred since boot` | Weak supply or thin cable. Use the wall supply, or a power bank that gives 5 V at 2.4 A or more (or USB-C PD) with a short, thick cable; avoid long thin cables. |
| `CPU temp ... WARM` / `HOT` | Check the heatsinks are stuck on and the box vents are clear. |
| `Wi-Fi : not connected` | Hotspot off or out of range; `nmcli dev wifi list` shows what the Pi can see. |
| `signal` below 40 % | Move the hotspot phone closer. |
| `I2C bus 1 : ... PROBLEM` | Run `i2c_scan.py` (next). |

### 5.2 I2C scan

Plug in: Qwiic SHIM on pins 1–6 → 500 mm cable → MAX30101.
**Power the Pi off while plugging.**

```bash
python3 i2c_scan.py
```

Expected, exactly:

```
HANDOFF relay - I2C scan of bus 1
Found 1 device(s):
  0x57  MAX30101 pulse sensor (finger clip)
Expected: 0x57 (sensor). 0x3D / 0x3C only if you fitted the optional OLED.

RESULT: OK - the sensor answers.
```

With the optional OLED fitted (SHIM → short cable → OLED → 500 mm cable → sensor) you also see
`0x3D  OLED screen, SSD1306 (default address)` (or 0x3C), and the result is still OK.

If something is missing, the script prints the likely cause, for example:

```
RESULT: PROBLEM
  MAX30101 missing (expected 0x57).
  Most likely: the 500 mm cable is loose at the SHIM or at the sensor.
  Re-seat both ends until they click.
```

| If you see | Do |
| --- | --- |
| `Nothing answered on I2C bus 1.` | SHIM not fully pressed onto pins 1–6, on the wrong pins, or square pad not over pin 1. Check the first cable clicks in. |
| `MAX30101 missing (expected 0x57).` | Power off, then re-seat the 500 mm cable at both ends until each plug clicks fully in. |
| `MAX30101 missing ..., but the OLED answers.` | Only with the optional OLED: re-seat the 500 mm cable from the OLED's second socket to the sensor. |
| `NN addresses answered - that is not real devices.` | SDA/SCL shorted (bus stuck). Power off, unplug cables one at a time. |
| `ERROR: /dev/i2c-1 does not exist` | I2C is off: re-run `setup_pi.sh`, then `sudo reboot`. |
| `ERROR: no permission to open /dev/i2c-1` | `sudo usermod -aG i2c $USER`, log out and in. |
| `ERROR: smbus2 is not installed` | You forgot `source ~/handoff-venv/bin/activate`. |

Cross-check with the standard tool: `i2cdetect -y 1` should show `57` (plus `3d` or `3c` only if the optional OLED is fitted).

### 5.3 OLED (optional, skip if you have no screen)

```bash
python3 test_oled.py
```

The screen shows `HANDOFF RELAY`, a fake heart rate (60–90, changes each second), `bpm (fake)` and a
moving pulse waveform for 10 s, then goes blank. Terminal, exactly except the numbers:

```
HANDOFF relay - OLED test
OLED found at 0x3D. Drawing for 10 s (Ctrl-C to stop early)...
Done: 83 frames in 10.0 s (8.3 frames/s). Screen cleared.
You should have seen "HANDOFF RELAY", a heart rate and a moving wave.
```

Anything from about 5 to 15 frames/s is fine.

| If you see | Do |
| --- | --- |
| `ERROR: no OLED answers at 0x3D or 0x3C` | Run `i2c_scan.py`. |
| Script runs but the screen stays black | Power-cycle the Pi (the OLED can latch up). Check the screen's protective film/shipping card is not covering it. |
| Picture shifted sideways with a noise band down one side | The screen has an SH1106 controller: `HANDOFF_OLED_DRIVER=sh1106 python3 test_oled.py` (works for every script). Tell the coordinator. |
| Under 3 frames/s | Optional speed-up: add `dtparam=i2c_arm_baudrate=400000` to `/boot/firmware/config.txt`, reboot. |

`--address 0x3C` forces an address; `--snapshot frame.png` saves the last frame.

### 5.3b LCD1602 add-on (optional, skip if you have no LCD)

The kit's I2C LCD1602 (4-pin backpack) sits in a printed pod on the lid. **Power it from 3.3 V, never
5 V:** the backpack pulls SDA/SCL up to its VCC, and the Pi's pins are not 5 V tolerant. Wire it with the
Pi off, through the mini breadboard (female end on the LCD or Pi pin, male end in the hole):

| From | To | Why |
| --- | --- | --- |
| LCD VCC | d7 | row 7 is 3.3 V (pin 17) |
| LCD GND | d5 | row 5 is ground (pin 9) |
| LCD SDA | h16 | |
| LCD SCL | h17 | |
| Pi pin 3 (SDA) | g16 | joins the LCD's SDA |
| Pi pin 5 (SCL) | g17 | joins the LCD's SCL |

Pins 3 and 5 sit under the Qwiic SHIM: push the jumpers down over the pins that stick up through it.

```bash
python3 test_lcd.py
```

Expected (0x3F instead of 0x27 is also fine):

```
HANDOFF relay - LCD1602 test
LCD found at 0x27. Showing a demo for 10 s (Ctrl-C to stop early)...
Done. Screen cleared and backlight off.
```

The screen shows `HANDOFF RELAY`, then `HR nn  SpO2  97` with a changing number. `i2c_scan.py` now lists
`0x27  LCD1602 screen` alongside the sensor, and `stream_test.py` and `test_max30101.py --lcd` show live
heart rate, oxygen and status on it.

| If you see | Do |
| --- | --- |
| `no LCD answers at 0x27 or 0x3F` | Pi off; re-check the six jumpers above; run `i2c_scan.py`. |
| Backlight on, no letters (or faint) | Turn the small blue contrast screw on the back slowly until letters appear. At 3.3 V the best setting is near one end. |
| Still unreadable at 3.3 V | Leave the LCD out (the dashboard shows everything). Don't switch it to 5 V. |
| Letters jumbled | Unplug power for 10 s; re-seat SDA/SCL. |

### 5.4 MAX30101 sensor

```bash
python3 test_max30101.py           # with the optional OLED, add --oled to show HR and the waveform on it
```

1. **Keep your finger off** for the first 2 s (calibration measures the no-finger level).
2. When asked, rest your fingertip pad on the sensor window, lightly, and keep still.
3. Ctrl-C to stop.

Expected (numbers vary; this is from `--simulate`, real IR/red are typically 50 000–200 000 with a finger):

```
HANDOFF relay - MAX30101 test (bus 1, address 0x57)
PART_ID 0x15 - MAX30101 OK (revision 0x..), die temperature 30.2 C
Config: SpO2 mode (red + IR), 100 samples/s, 411 us pulses (18-bit), ADC range 4096 nA, LED current 6.2 mA
Calibrating: keep your finger OFF the sensor for 2 s ...
  no-finger IR level 2,501 (noise 41); finger threshold 15,608
Now rest your fingertip on the sensor window. Keep still. Ctrl-C to stop.

    time       IR      red  finger     HR  SpO2*
   3.0 s    2,488    1,739      no     --    --
   4.0 s  109,912   79,966     YES     --    --
   5.0 s  110,968   80,722     YES     --    --
   6.1 s  109,452   79,819     YES     --    --
   7.0 s  108,539   79,100     YES     --    --
   8.0 s  109,899   79,930     YES     72    99
   9.0 s  111,108   80,796     YES     72    99
^C
* SpO2 is EXPERIMENTAL: uncalibrated, not a medical measurement.
Stopped after 9.6 s: 960 samples (99.9/s), 0 lost to FIFO overflow. Sensor LEDs off.
```

What "good" means: `PART_ID 0x15`; `finger` flips to `YES` within a second of touching and back to
`no` when you lift; **HR appears 4–6 s after the finger goes on and matches your pulse** (count at
your wrist for 15 s × 4) within about ±5 bpm; samples/s ≈ 100 and `0 lost`. HR and SpO2 go back to
`--` within 5 s of the last detected beat, at once when the reading saturates, and after lost samples,
so a number on screen always comes from a live pulse.
SpO2 is for demo only: it was never calibrated for this sensor and clip.
Known limit (from simulation): below ~50 bpm, a very pronounced dicrotic notch can be counted
as an extra beat; the median-based HR usually absorbs it.

| If you see | Do |
| --- | --- |
| `ERROR: no answer from 0x57` | `i2c_scan.py`; re-seat the 500 mm cable. |
| `ERROR: PART_ID is 0x.., expected 0x15` | Something else is at 0x57. Check the board is a MAX30101. |
| `WARNING: IR was already high during calibration` | A finger (or a reflective surface) was on the sensor at start. Lift it once; it re-calibrates itself. |
| IR barely changes with the finger on, `finger` stays `no` | Finger not over the window (centred, 2.8 mm below the board's top edge); or LEDs too weak: `--led-ma 12`. |
| `SAT` in the finger column / `reading saturated` | Too much light: `--led-ma 3`. |
| `finger YES` but HR stays `--`, or `(no clear pulse...)` | Keep still; press lighter (pressing squeezes the blood out); warm a cold finger; make the clip light-tight. |
| HR about double or half your real pulse | Motion artefacts or a very weak pulse; keep still, re-seat the finger, try `--led-ma 10`. |
| `lost to FIFO overflow` above 0 | The Pi was too busy; close other scripts. Occasional small numbers are harmless. |
| samples/s far from 100 | Report it to the coordinator with the full output. |

`--simulate` runs the whole pipeline on a fake sensor, anywhere (no Pi needed).

### 5.5 Identify the button wires (before wiring the button)

The pre-wired button plug has 6 unlabelled wires. If you can't follow each wire to a labelled pin
on the button body, the script finds them using only a 220 Ω resistor and three Pi pins:

```bash
python3 identify_wires.py                         # or name them by colour:
python3 identify_wires.py --names red black white yellow green blue
```

It builds two probes: **+ probe** = pin 17 (3.3 V) → 220 Ω → loose jumper end, and
**- probe** = pin 9 (GND). Each step tells you which wire to touch with each probe and asks what
lights: `r`, `g`, `b` or `n` (nothing). **Pin 17 is only ever connected through the resistor**, no
pin is ever an output, so no probe position can short anything. Expect 6–24 steps. Expected ending:

```
================================================================
RESULT (common anode, found in 11 steps)
  switch      : wires red and green
  ring common : wire white
  red         : wire black
  green       : wire blue
  blue        : wire yellow
================================================================

Wire it like this (build spec section 3), with the Pi OFF:
  wire red    -> pin 11 (GPIO17)
  wire green  -> pin 9  (GND)
  wire white  -> pin 17 (3.3 V)   ring common +
  wire black  -> 220 ohm -> pin 15 (GPIO22)   red
  wire blue   -> 220 ohm -> pin 16 (GPIO23)   green
  wire yellow -> 220 ohm -> pin 18 (GPIO24)   blue
```

Finally it asks you to put the two switch wires on pins 11 and 9 and press 3 times
(`press 1 seen` ... `Switch confirmed.`), using GPIO17 as an input only.

**Write the mapping down** (tape labels on the wires).

| If you see | Do |
| --- | --- |
| Nothing lights at any step | Probe contact is poor (push the wire fully into the jumper socket); check the resistor really goes to pin 17; shade the button (green/blue are dim). |
| `... lit twice` / `answers don't fit` | A probe slipped or the button was pressed. Start again. |
| `IMPORTANT: this ring is COMMON CATHODE` | The listing was wrong. Don't use the spec wiring: tell the coordinator (common goes to GND, code needs `active_high=True`). |
| `Only N press(es) seen` | The switch wires aren't firmly on pins 11 and 9. |

### 5.6 Button and light ring

Wire per the table at the top (Pi off), resistors on the mini breadboard. Then:

```bash
python3 test_button.py
```

Part 1 shows red, green, blue, white, amber for 2 s each (2 rounds). Part 2 reacts to the button:
ring green while pressed, blue once held 1.5 s, off on release. Expected (times vary):

```
HANDOFF relay - MARK button + light ring test

Part 1 - colours, 2 s each. Note how bright each one looks:
  round 1: red
  round 1: green
  round 1: blue
  round 1: white
  round 1: amber
  round 2: red
  ...
  If green and blue are much dimmer than red: expected with 220 ohm at 3.3 V.
  Fix: add a second 220 ohm resistor in parallel with the green one and the blue one
  (side by side across the same two breadboard rows, e.g. e11-f11 and d11-g11)
  to get 110 ohm - never a direct wire.
  If a colour never lit, or the wrong one did: check that wire (identify_wires.py).

Part 2 - button. Press, release, and hold for 1.5 s.
  Ring: green while pressed, blue once held. Ctrl-C to finish.
[  21.52 s] PRESS
[  21.82 s] RELEASE after 0.31 s
[  22.33 s] PRESS
[  23.83 s] HOLD (held >= 1.5 s)
[  24.34 s] RELEASE after 2.01 s
^C
Ring off. Done.
```

| If you see | Do |
| --- | --- |
| The wrong colour lights (e.g. "red" shows blue) | Two colour wires swapped; move them per `identify_wires.py`. |
| One colour never lights | Its resistor or wire isn't connected; check the breadboard row. |
| Green/blue very dim, red bright | Expected (spec §3 known limitation). The kit has no 100 Ω: add a second 220 Ω resistor in parallel with each dim one (side by side across the same two breadboard rows, e.g. e11–f11 and d11–g11) to get 110 Ω. Never a direct wire. |
| Ring lit all the time, even after exit | Common wire on GND instead of pin 17, or the ring is common cathode: run `identify_wires.py`. |
| `WARNING: the button reads PRESSED before you touch it` | Switch wire on the wrong pin, or pin 11 touching GND. |
| No PRESS lines at all / `(no press seen for 20 s ...)` | Switch wires not on pins 11 and 9. |
| PRESS/RELEASE pairs when pressed once | Contact bounce; harmless for testing; tell the coordinator. |
| `ERROR: could not open the ring LED pins` / `GPIO busy` | Another script (e.g. `stream_test.py`) is running: stop it. |

### 5.7 Stream to the Mac

Start the receiver on the Mac first (setup in section 6):

```bash
cd software/mac && source .venv/bin/activate && python3 receiver.py
```

```
HANDOFF receiver - listening on ws://0.0.0.0:8765
  this Mac: 172.20.10.4 (en0)  ->  on the Pi run:  python3 stream_test.py 172.20.10.4
  (* SpO2 is EXPERIMENTAL.)  Ctrl-C to stop.
```

On the Pi, use the IP it printed. Try `--simulate` first (no sensor needed), then the real sensor:

```bash
python3 stream_test.py 172.20.10.4 --simulate
python3 stream_test.py 172.20.10.4
```

Pi output (real sensor; keep the finger off for the first 2 s):

```
HANDOFF relay - stream test -> ws://172.20.10.4:8765
Keep your finger OFF the sensor for 2 s (calibrating) ...
[link] connecting to ws://172.20.10.4:8765 ...
[link] connected
Calibrated: no-finger IR 2,501, finger threshold 15,608. Put your finger on now.
[   5.0 s] connected | sent 125 msgs (25.0/s) | acquiring | HR -- | IR 111,084
[  10.0 s] connected | sent 251 msgs (25.0/s) | pulse | HR 72 | IR 109,214
[button] press
[button] release (0.31 s)
...
^CStopped. Sent 749 vitals messages. Sensor LEDs and ring off.
```

Mac output (one status line per second, button events as they happen; numbers vary):

```
[13:52:19] CONNECTED    172.20.10.3:50228  (1 client(s))
[13:52:19] HELLO        handoff-relay (172.20.10.3): sensor 100.0 samples/s, sending 25.0 msg/s, simulate=False
[13:52:21] handoff-relay (172.20.10.3)   25 msg/s  HR  --  no finger   IR   2,503  SpO2*  --  missing 0  arrival gap   42 ms  last   13 ms ago  sender gap  42 ms
[13:52:22] handoff-relay (172.20.10.3)   25 msg/s  HR  --  acquiring   IR 108,064  SpO2*  --  missing 0  arrival gap   42 ms  last   14 ms ago  sender gap  42 ms
[13:52:26] handoff-relay (172.20.10.3)   25 msg/s  HR  72  pulse       IR 109,190  SpO2*  99  missing 0  arrival gap   41 ms  last   23 ms ago  sender gap  41 ms
[13:52:31] BUTTON       handoff-relay (172.20.10.3): PRESS  device ts 427880.178
[13:52:31] BUTTON       handoff-relay (172.20.10.3): RELEASE, held 0.3 s  device ts 427880.48
[13:52:39] DISCONNECTED handoff-relay (172.20.10.3) after 20.0 s, 466 msgs, 0 missing, worst arrival gap 45 ms  (0 client(s))
```

Columns: `status` is `calibrating`, `no finger`, `saturated`, `acquiring` (finger on, no beat in the
last 5 s) or `pulse`; HR and SpO2 show `--` unless the status is `pulse`. The timing columns are
measured on the **Mac's** clock:

- `arrival gap`: longest time between two messages arriving during the last second.
- `last ... ago`: time since the newest message arrived. A stall that is happening right now shows here.
- `sender gap`: longest gap between the Pi's own timestamps (the Pi's sending rhythm, not the network).
- `<< STALL`: an arrival gap or a silence over 0.5 s.

A 1.5 s Wi-Fi stall looks like this. During it:

```
[13:52:28] handoff-relay (172.20.10.3)   11 msg/s  HR  72  pulse       IR 110,857  SpO2*  99  missing 0  arrival gap   42 ms  last  587 ms ago  sender gap  42 ms  << STALL
```

After it, the held-up messages arrive in a burst; the Pi's timestamps still look regular:

```
[13:53:02] handoff-relay (172.20.10.3)   48 msg/s  HR  72  pulse       IR 109,988  SpO2*  99  missing 0  arrival gap 1554 ms  last    0 ms ago  sender gap  42 ms  << STALL
```

Ring: **blue pulsing** = connecting, **green** = connected, **3 red flashes** = error (it then retries:
1 s, 2 s, 4 s, then every 5 s, forever). White while the MARK button is pressed. With the optional OLED fitted, it prints `OLED at 0x3D shows the
link status.` and the screen shows `LINK  OK` / `LINK  connecting` / `LINK  ERROR`, the Mac's IP, HR,
the status and the message count. Without one it prints `(No OLED - fine, the screen is optional: ...)`.

**Wi-Fi checkpoint (pass):** run for 2 minutes over the real hotspot. Pass if `msg/s` stays at
24–26, `missing 0`, `arrival gap` stays under ~150 ms, `last ... ago` under ~100 ms, no
`<< STALL` lines, and the `DISCONNECTED` line's `worst arrival gap` is under 500 ms. Button events
should appear within a fraction of a second of the press.

| If you see | Do |
| --- | --- |
| `[link] error: [Errno 111] Connect call failed` (Pi) | Receiver not running, or wrong IP. Use the IP the receiver printed. |
| `[link] error: timed out during opening handshake` or `No route to host` | Mac and Pi on different networks, or the hotspot isolates clients. Check both are on the same hotspot. |
| Pi says connected, Mac shows nothing | macOS firewall: System Settings → Network → Firewall → Options → allow Python. |
| `<< STALL` with `sender gap` still ~40 ms | Delivery stalled on the network. Move the hotspot closer. Turn off the Pi's Wi-Fi power saving: `sudo iw wlan0 set power_save off` (until reboot), then re-test. |
| `<< STALL` with a large `sender gap` too | The Pi itself paused (busy, or slowed by under-voltage): run `health_check.py`. |
| `last ... ago` keeps growing | The link is dead. The Pi notices within ~10 s and reconnects (ring goes blue). |
| `msg/s` below ~22, or `arrival gap` regularly 100–300 ms | Weak Wi-Fi or Wi-Fi power saving; same fixes as the first `STALL` row. |
| `missing` keeps rising | Messages dropped during reconnects; check Wi-Fi. |
| HR `--` with status `acquiring`, finger on | No beat in the last 5 s: keep still, press lightly (see 5.4). Values never outlive the pulse. |
| status `saturated` | Too much light: restart with `--led-ma 3`. |
| `ERROR: the 'websockets' package is missing` | Activate the venv (Pi: `~/handoff-venv`; Mac: `software/mac/.venv`). |
| Mac: `address already in use` | Another receiver is running (close that Terminal tab), or use `--port 8766` on both sides. |

Message format (one JSON object per WebSocket text message; `ts` = Pi monotonic clock, seconds):

```json
{"type": "hello", "device": "handoff-relay", "fs": 100.0, "rate_hz": 25.0, "simulate": false, "v": 1}
{"type": "vitals", "seq": 17, "ts": 1234.567, "ir": 109876, "red": 79123, "hr": 72.1, "finger": true, "spo2_exp": 98.4, "status": "pulse", "n": 4}
{"type": "button", "seq": 18, "ts": 1234.612, "event": "press"}
{"type": "button", "seq": 19, "ts": 1236.120, "event": "hold"}
{"type": "button", "seq": 20, "ts": 1236.400, "event": "release", "held_s": 1.79}
```

`ir`/`red` are the mean of the `n` raw samples since the previous message. `hr` and `spo2_exp` are
`null` unless a beat was confirmed in the last 5 s; `status` says why (`calibrating`, `no finger`,
`saturated`, `acquiring`, `pulse`). Saturation, a lifted finger and lost sensor samples (FIFO
overflow) throw away the stored beats at once. `python3 receiver.py --log stream.jsonl` saves every
message.

## 6. Mac setup (receiver)

Homebrew Python refuses global `pip install`, so use a venv inside `software/mac`:

```bash
cd software/mac
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 receiver.py
```

Next time: `cd software/mac && source .venv/bin/activate && python3 receiver.py`.
The first run may show a macOS "accept incoming network connections?" dialog: click **Allow**.

## 7. Phone test page (Pixel 9 Pro, Chrome)

On the Mac (same hotspot as the phone):

```bash
bash software/mac/serve_phone_test.sh
```

It prints the URL to open on the Pixel, for example `http://172.20.10.4:8000/`, and both ways to get
the **secure context** that the camera, motion sensor and wake lock need:

- **(A) Chrome flag, quickest.** On the Pixel open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
  set **Enabled**, type the exact origin the script prints (e.g. `http://172.20.10.4:8000`), tap
  **Relaunch**, open the URL. Redo it if the Mac's IP changes.
- **(B) HTTPS with mkcert.** `brew install mkcert`, run `bash software/mac/serve_phone_test.sh --https`,
  open `https://<mac-ip>:8000/handoff-rootCA.crt` on the Pixel (tap Advanced → Proceed on the warning;
  the file downloads), then Pixel Settings → search "CA certificate" → Install a certificate →
  CA certificate → pick the file. Open `https://<mac-ip>:8000/`: no warning any more.
  (`software/mac/.certs/` holds the private key; don't share it.)

The page's top bar shows chips: `✓ Secure context`, `✓ Camera API`, `✓ Motion sensor API`,
`✓ Wake lock API`, `✓ Speech`, `✓ Web Audio`. A red `✗ Secure context` plus a red banner means
neither A nor B is in effect. After loading, the page needs no network.

**Camera tab.** Tap **Allow camera** → **Scan all cameras**. The table lists every camera with
facing, size and zoom range, and the verdict box says:

- `Verdict: REAR MODE - ultra-wide reachable`: a rear camera reports zoom down to ~0.5×. Open it,
  tap **Min (widest)**, confirm the picture really widens. Print the rear enclosure.
- `Verdict: MAYBE REAR - check by eye`: several rear cameras, none with zoom < 1×. Open each; if
  one is clearly wider, tap **This is the ultra-wide** while it is open.
- `Verdict: FRONT MODE`: only the main rear camera is reachable. Use the front camera (103°) and
  the front enclosure.

The optional FOV check turns "visible wall width at a known distance" into degrees
(ultra-wide ≈ 110–120°, main ≈ 70–75°, front ≈ 90–95° across a 16:9 picture).
**Copy the verdict and the table to the coordinator.** That decides which enclosure variant to print.

**Motion tab.** Phone in the enclosure on the chest harness. **Metronome: ON** (110), **Start motion
test**, kneel and compress a firm cushion at the beat. Expected: the big number settles at
**105–115** within ~3 s, status `Good rate (100-120)`, the plot shows one green dot per
compression, `sensor` reads about 60 Hz or more. At ~80/min it says `Too slow - push faster`; at
~140, `Too fast - slow down`. Stop for over 10 s: `PAUSE 11 s - resume compressions!` in red.

**Speaker tab.** Media volume all the way up. **Say** must be clearly audible at arm's length
with the phone in the enclosure; **Beep** checks the speaker without the speech engine.

**Screen tab.** **Request screen wake lock** → `Wake lock ACTIVE`; the screen must stay on past the
phone's normal timeout. **Run self-test** → `9/9 passed`. The log can be copied for bug reports.

| If you see | Do |
| --- | --- |
| "This site can't be reached" | Phone and Mac on different networks, or the Mac's firewall blocks Python (allow it). |
| `✗ Secure context` | Flag (A) not set for the exact origin, or Chrome not relaunched; or use (B). |
| Camera: `NotAllowedError` | Tap the icon left of the address bar → Permissions → Camera → Allow. |
| Camera: `NotReadableError` | Another app is using the camera; close it. |
| Zoom column says `not reported` | Zoom permission was declined: allow it, scan again. |
| Motion: `No motion events.` | Not a secure context, or the browser blocks sensors (site settings → Motion sensors → Allow). |
| Rate jumps around or counts double | Phone loose in the harness; tighten it. Compress more steadily. |
| Wake lock failed | Battery saver on, or the page wasn't visible; tap again. |
| Speech silent, beep works | Install/enable a voice: Android Settings → search "Text-to-speech output" → Google. |

## 8. Offline tests on any computer

```bash
cd software/pi
python3 -m lib.selftest                     # 21 checks, standard library only
python3 test_max30101.py --simulate --seconds 10
python3 -m pytest tests -q                  # 68 tests; needs pytest (e.g. in software/mac/.venv)
node ../phone/dsp_selftest.js               # phone compression-rate DSP, needs Node
```

`stream_test.py --simulate` and `receiver.py` can run together on one Mac
(`python3 stream_test.py 127.0.0.1 --simulate --no-gpio`).

## 9. What only real hardware can confirm

Everything above was exercised on a Mac with simulated sensors, a simulated I2C bus, mock GPIO
pins and a virtual OLED. These still need the real parts:

- MAX30101 on the real bus: part ID, FIFO timing at 100 samples/s, real IR/red levels with a finger
  and in the finger clip, whether 6.2 mA is the right LED current, heart rate vs a real pulse.
- (Only if the optional OLED is fitted) its frame rate over I2C and that it really is an SSD1306 (not SH1106).
- Button and ring: brightness of green/blue through 220 Ω; switch bounce; that the ring is
  really common anode.
- Wi-Fi: stream rate and gaps over the actual hotspot; mDNS (`handoff-relay.local`) on that hotspot.
- `setup_pi.sh` on a fresh Raspberry Pi OS Lite image (package names, raspi-config).
- Phone: which cameras Chrome exposes on the Pixel 9 Pro and whether zoom < 1× is offered; the
  DeviceMotion rate; compression counting in the harness on a real body; speaker loudness in the
  enclosure; wake lock behaviour.
