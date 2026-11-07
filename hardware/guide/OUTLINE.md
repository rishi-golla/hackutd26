# Build guide outline (coordinator working notes)

Final guide = published HTML page with images from ../renders, ../illustrations, ../diagrams.
Facts must match the Phase 2 build spec (Traycer artifact handoff-phase2-build-spec).

## 0. Overview
- What you are building: AI bodycam (Pixel 9 Pro in printed case on chest harness) + vitals relay (Pi 4 box with finger sensor, OLED, MARK button).
- Hero illustration, system illustration, network diagram.
- Time budget: printing ~X h (from PRINT_SETTINGS), Pi setup 45 min, wiring 45 min, relay assembly 30 min, bodycam assembly 15 min, end-to-end test 20 min.

## 1. Before you start: tools and materials
Tools
- 3D printer, PETG filament (bodycam case, relay box), PLA or PETG (finger clip). Amounts from PRINT_SETTINGS.md.
- Small Phillips screwdriver (#0 or #1) for the M2.5 nylon screws.
- Flush cutters or hobby knife for print cleanup; needle-nose pliers or tweezers for nuts.
- Scissors (Velcro), masking tape + fine marker (wire labels).
- microSD card 16 GB+ (the Pi's existing card is erased by flashing; back it up) and a way to write it from the Mac (built-in SD slot or a USB-C card reader).
- Optional: multimeter, calipers (otherwise a steel ruler for the phone measurements).
Parts (from the parts page + kit)
- Bought: harness, MAX30101, Qwiic SHIM, 4209 cable, Qwiic cable kit, standoff kit, Velcro, mini breadboard, OLED 938, HBAN button, power bank, right-angle cable, heatsinks.
- From the kit: 3 × 220 Ω resistors, 6 × female-to-male jumper wires (kit has 10), spare female-female jumpers.
- Already owned: Pi 4 + official supply, Pixel 9 Pro, MacBook, Dino's phone.

## Stages (each ends with a checkpoint: expected result + fixes)
1. Phone test: decide rear or front camera mode (software/phone). Checkpoint: verdict screen.
2. Measure the phone, print the two fit tests (fit ring, mount test). Checkpoint: fit.
3. Print all parts (settings table, bed orientation renders, nut insertion).
4. Pi setup: flash, first boot, SSH, setup_pi.sh, health_check.
5. Bench wiring: SHIM (pin 1!), Qwiic chain, i2c_scan, test_oled, test_max30101; button wires: identify, breadboard, test_button.
6. Relay box assembly (exploded render), then re-run tests closed; 10-minute temperature check.
7. Finger clip assembly; HR check against a manual pulse count (15 s × 4).
8. Bodycam assembly: nuts, phone, screws, buckle, harness, tilt; camera framing check; motion test vs metronome.
9. End-to-end on Dino's hotspot: receiver.py on the Mac, stream_test.py on the Pi, phone page over the hotspot.

## Safety notes (draft)
- Power bank (Li-ion, 37 Wh): don't crush, puncture or heat it; charge on a hard surface while awake; carry-on only when flying (37 Wh is under the 100 Wh limit); stop using it if it swells.
- Pi heat: heatsinks can reach 60–70 °C; print the relay box in PETG (PLA softens near 55–60 °C); keep vents clear; run health_check if the OLED freezes.
- Electrical: power the Pi off before changing wires; line up the SHIM's square pad with pin 1 (an offset or flipped SHIM shorts 5 V to ground); never connect 5 V to a GPIO pin; never wire an LED colour without its resistor.
- Phone: take it out of the case if it gets hot to the touch; the case's lattice back is there for airflow.
- 3D printer: ventilate when printing PETG; let parts cool before removing; mind the hot nozzle and bed.
- Medical: the finger sensor is not a medical device; all demo data is synthetic; never do chest compressions on a person (use a manikin or a firm cushion).
