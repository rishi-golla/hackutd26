# No-snap verification — 2026-11-03

**ALL CHECKS PASSED.** Run `cad/.venv/bin/python cad/verify.py` from hardware/. OpenSCAD uses the manifold backend, binary STL and `$fn=64`. Results and generated intersection witnesses are in [checks/report.json](checks/report.json).

The final report contains **932 passing records**: 12 production exports, 103 default geometric checks, 11 scalar fit checks, 1 unchanged-T1 regression and 805 sweep records.

## What is checked

- Every production mesh has the expected body count, positive volume, watertight surfaces and consistent winding. Each body rests on the bed within 0.03 mm; the optional rail pair was also checked at zero minimum Z.
- The supported sweep is 0.15, 0.20, 0.25, 0.30, 0.35, 0.40 and 0.45 mm: 115 checks per setting, all passing. It includes both camera modes, the optional rail pair, assembled component clearances and sliding/lifting paths.
- Closed rigid fits have no positive-volume overlap. P1 and the test tongue slide at sampled positions without binding, then intersect the closed stop on attempted over-travel. Normal rail pull is geometrically captured.
- P2 lid lips resist X/Y movement but lift freely after straps are removed. Pi lifts freely after glue is removed. P3 locator pins resist X/Y shift but permit straight opening after glue removal.
- Both bodycam bands clear the phone, optics, buttons, port and mount. Both relay straps clear the box surfaces, bank, button, cable, openings and vents in the specified guide routes.
- Four finger glue-dot envelopes clear the sensor board, finger and strap. Two Pi glue caps clear the electronics and a 1.99 mm expanded component envelope (reported as at least 2.0 mm nominal margin).
- Unknown OpenSCAD modules/variables and other warnings now fail validation. An empty result is accepted only for a valid empty intersection/difference; planar touching faces may pass below the strict contact threshold. No mesh repair or deletion of bad components is used.

The old latch, J-clip and strain checks are explicitly retired because those parts/features were removed. They are not recorded as empty passes. No joint requires elastic strain, so PETG/PLA flexure screens do not apply. The historical OLED snap-lid identity test was replaced by the unchanged T1 regression; the optional OLED layout still receives explicit collision checks.

## Measured and verified clearances

| Check | Value |
|---|---:|
| straight_15x10_min_gap | 1.200 mm |
| straight_17x12_min_gap | 0.200 mm |
| finger_loop_spare_length | 5.633 mm |
| finger_cable_to_flat_lid | 4.900 mm |
| strap_guide_width_clearance | 0.400 mm |
| strap_guide_wall_remaining | 1.800 mm |
| left_strap_to_usb_opening | 1.300 mm |
| left_strap_to_front_vent | 0.500 mm |
| right_strap_to_finger_notch | 2.500 mm |
| right_strap_to_lid_vents | 2.300 mm |
| right_strap_to_button | 16.000 mm |
| Pi, including ≤12 mm heatsink envelope, to lid features | ≥3.0 mm expanded-envelope check |
| Button/plug to Pi | ≥3.0 mm |
| Button/plug to breadboard | ≥4.9 mm |
| Finger cable to all lid features | ≥3.0 mm expanded route check |
| P3 locator socket outer wall at default / c045 | 0.67 / 0.40 mm |

At the chosen `snap_clearance=0.18`, P1 has 0.18 mm outer side allowance and 0.18 mm total vertical rail allowance. The Pi peg is 2.34 mm in the nominal 2.7 mm hole (0.18 mm radial allowance). P3 pins are 2.4 mm, sockets 2.76 mm, with 0.18 mm axial extra depth. These are CAD gaps, not measured print tolerances.

USB-C centre remains **3.5 + 7.7 = 11.2 mm from the PCB left edge**, following the official dimension chain. The straight 17×12 mm overmold gauge has only 0.2 mm lower clearance; the builder must perform the early dry-fit. The 120 mm cable allowance exceeds the modeled service-loop centreline by 5.633 mm.

## Retention supplies

- **Two relay straps total**, at X=36/96, each around lid + box + bank. No floor slots or third backup strap. Maximum 13×1.2 mm section; 10–12 mm width preferred. Allow 32–35 cm each for a 14–30 mm thick bank and about 5 cm overlap. A 30 cm strap gives about 4 cm overlap with the 14 mm example; check its fastening.
- **Two bodycam bands**, 2–2.4 mm wide and ≤1.2 mm thick. Installed loop approximately 325 mm rear / 332 mm front; soft 280–300 mm unstretched circumference is only an initial size candidate.
- **Two Pi glue caps** at (69.5,13.5) and (11.5,62.5), PCB top Z=10.6 mm. Peg tips Z=10.4 mm remain 0.2 mm below that top. A small cap fills the recess and bonds to the hole rim; keep it off nearby components.
- **Four F/G glue dots** at the outside side seams, X=-3.75/29.15, Y=-4/32, Z=1.8 mm. These are two spots per side, near the finger-entry and fingertip ends. No internal glue pocket or sensor-board glue is used.

## Printed bounds

| STL | Bed bounds, mm | Bodies |
|---|---|---:|
| p1_rear_front_frame | 158.4 × 92 × 15.62 | 1 |
| p1_rear_back_plate | 158.4 × 86.8 × 21.3 | 1 |
| p1_rear_fit_ring | 158.4 × 77.6 × 2 | 1 |
| p1_front_front_frame | 158.4 × 92 × 19.22 | 1 |
| p1_front_back_plate | 158.4 × 86.8 × 21.3 | 1 |
| p1_front_fit_ring | 158.4 × 77.6 × 2 | 1 |
| p1_mount_test | 32 × 34 × 21.5 | 1 |
| p2_base | 170 × 78 × 37 | 1 |
| p2_lid | 158 × 78 × 6.4 | 1 |
| p3_tray | 32.9 × 48.4 × 3.8 | 1 |
| p3_hood | 32.9 × 22.35 × 48.4 | 1 |
| rail_fit_test | 32 × 35.62 × 10.04 | 2 |

The assembled relay shell is 158×78×39.4 mm, with its carry loop extending the base to 170 mm. The rigid finger assembly remains 24.15 mm high; removing the J flange shortens it to 48.4 mm. T1 is byte-identical to the passed harness coupon.

## Physical fit gates still required

The failed snap ladders do not validate this redesign. Check the optional rigid rail pair, then the complete full-length rails and actual phone over padding. Check actual camera-bar dimensions, button relief and T2. Verify glue adhesion after cooling, gentle removal for servicing, bank no-slide retention, strap fastening, and rubber-band tension. Confirm real heatsinks stay within the assumed envelope, the straight power plug seats fully, cable slack stays below the lid, the sensor face is flush and the finger strap applies light direct pressure. CAD does not establish impact strength, material aging, fatigue or adhesion.
