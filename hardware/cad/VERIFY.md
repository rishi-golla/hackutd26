# No-snap verification — 2026-11-05

**ALL CHECKS PASSED.** Run `cad/.venv/bin/python cad/verify.py` from hardware/. OpenSCAD uses the manifold backend, binary STL and `$fn=64`. Results and generated intersection witnesses are in [checks/report.json](checks/report.json).

The final report contains **1600 passing records**: 14 production exports, 183 default geometric checks, 22 scalar fit checks, 2 mount regressions and 1379 sweep records.

## What is checked

- Every production mesh has the expected body count, positive volume, watertight surfaces and consistent winding. Each body rests on the bed within 0.03 mm; the optional rail pair was also checked at zero minimum Z.
- The supported sweep is 0.15, 0.20, 0.25, 0.30, 0.35, 0.40 and 0.45 mm: 197 checks per setting, all passing. It includes both camera modes, the optional rail pair, assembled component clearances and sliding/lifting paths.
- Closed rigid fits have no positive-volume overlap. P1 and the test tongue slide at sampled positions without binding, then intersect the closed stop on attempted over-travel. Normal rail pull is geometrically captured.
- P2 lid lips resist X/Y movement but lift freely after straps are removed. Pi lifts freely when the lid is removed; the lid posts limit lift after closure. P3 locator pins resist X/Y shift but permit straight opening after glue removal.
- Both bodycam bands clear the phone, optics, buttons, port and mount. Both relay straps clear the box surfaces, bank, button, cable, openings and vents in the specified guide routes.
- Four finger glue-dot envelopes clear the sensor board, finger and strap. Pi glue is removed entirely. Two lid posts clear all modeled components by ≥2 mm, the heatsinks by ≥3 mm, and both GPIO and button-wire envelopes by ≥2 mm. A 0.2 mm attempted Pi lift produces two separate contact regions at the mounting-hole rings.
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
| Pi, including ≤12 mm heatsink envelope, to lid skin/lips | ≥3.0 mm expanded-envelope check |
| Post to PCB top / peg tip | 0.15 / 0.35 mm |
| Post to modeled ports, header and SHIM | ≥2.0 mm expanded-envelope check |
| Post to heatsinks | ≥3.0 mm expanded-envelope check |
| All lid features to GPIO/button-wire routing envelopes | ≥2.0 mm expanded-envelope check |
| Button/plug to Pi | ≥3.0 mm |
| Button/plug to breadboard | ≥4.9 mm |
| Finger cable to all lid features | ≥3.0 mm expanded route check |
| P3 locator socket outer wall at default / c045 | 0.67 / 0.40 mm |

At the chosen `snap_clearance=0.18`, P1 has 0.18 mm outer side allowance and 0.18 mm total vertical rail allowance. The Pi peg is 2.34 mm in the nominal 2.7 mm hole (0.18 mm radial allowance). P3 pins are 2.4 mm, sockets 2.76 mm, with 0.18 mm axial extra depth. These are CAD gaps, not measured print tolerances.

USB-C centre remains **3.5 + 7.7 = 11.2 mm from the PCB left edge**, following the official dimension chain. The straight 17×12 mm overmold gauge has only 0.2 mm lower clearance; the builder must perform the early dry-fit. The 120 mm cable allowance exceeds the modeled service-loop centreline by 5.633 mm.

## Retention supplies

- **Two relay straps total**, at X=36/96, each around lid + box + bank. No floor slots or third backup strap. Maximum 13×1.2 mm section; 10–12 mm width preferred. Allow 32–35 cm each for a 14–30 mm thick bank and about 5 cm overlap. A 30 cm strap gives about 4 cm overlap with the 14 mm example; check its fastening.
- **Two bodycam bands**, 2–2.4 mm wide and ≤1.2 mm thick. Installed loop approximately 325 mm rear / 332 mm front; soft 280–300 mm unstretched circumference is only an initial size candidate.
- **Two Pi lid posts**, at (69.5,13.5) and (11.5,62.5), ending at Z=10.75 mm above PCB top Z=10.6 mm. Tips are Ø4 mm with Ø2.4×1.2 mm blind relief; annular wall 0.8 mm, effective radial PCB-ring bearing width 0.65 mm. Solid Ø6 mm stems flare through 2 mm root fillets to Ø10 mm at the lid. Total projection is 26.25 mm. The other two holes cannot provide the requested 2 mm clearance with this tip diameter. There is no glue or intended preload on the Pi.
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
| p2_lid | 158 × 78 × 28.65 | 1 |
| p3_tray | 32.9 × 48.4 × 3.8 | 1 |
| p3_hood | 32.9 × 22.35 × 48.4 | 1 |
| rail_fit_test | 32 × 35.62 × 10.04 | 2 |
| universal_phone_plate | 128 × 55.154 × 54.447 | 1 |
| lcd1602_pod | 87 × 46 × 31.361 | 1 |

Only D’s STL changed for the earlier Pi-post revision. The new universal backup plate is an addition: all twelve pre-existing production STL hashes match `archive/pre_universal_plate/production_hashes.json`. The assembled relay shell is 158×78×39.4 mm, with its carry loop extending the base to 170 mm. The rigid finger assembly remains 24.15 mm high; removing the J flange shortens it to 48.4 mm. T1 is byte-identical to the passed harness coupon.

## Physical fit gates still required

The failed snap ladders do not validate this redesign. Check the optional rigid rail pair, then the complete full-length rails and actual phone over padding. Check actual camera-bar dimensions, button relief and T2. Verify glue adhesion after cooling, gentle removal for servicing, bank no-slide retention, strap fastening, and rubber-band tension. Confirm real heatsinks stay within the assumed envelope, the straight power plug seats fully, cable slack stays below the lid, the sensor face is flush and the finger strap applies light direct pressure. CAD does not establish impact strength, material aging, fatigue or adhesion.

## Pi post contact and routing limits

The blanket 3 mm Pi-to-lid test now uses the lid skin and locating lips, excluding the deliberately near-contact posts. The posts receive their own exact PCB, base, SHIM, button, breadboard, cable and component tests. Both contact witnesses must contain exactly two distinct positive-volume regions when the board rises 0.2 mm. There is no collision at the seated PCB height. The OLED-feature exclusion witness also tests the skin/lips so an intentional post root is not mistaken for an old OLED guide; optional `with_oled=true` still receives collision checks.

`p2_jumper_wires()` matches all six GPIO-to-breadboard routes and connector housings drawn by the manual. `p2_button_wires()` follows the six button leads down through the open bay and forward to the breadboard. Both envelopes are expanded by 1.99 mm for the reported nominal 2 mm clearance. The original 120 mm finger-cable loop retains its ≥3 mm lid clearance. Real wire lengths must stay inside these corridors rather than crossing a post.

The nominal 0.15 mm gap is a design target, not a guarantee against printer height variation. Dry-seat D with no strap load: it must sit flush with a flat PCB. Dress a high tip incrementally or adjust `pi_post_gap` and re-export, rather than force the board down. No foam/tape preload is specified. Check the actual bare-hole rings and unmodeled small components before closing. Keep an open relay flat, since the pegs provide location but no vertical retention without D.

## Universal plate addition

The independent PLA backup reuses `gopro_two_prong()` without overriding its dimensions. Set-difference checks prove the full original mount is present and that no added material enters the two-ear region above the original foot. T1 remains byte-identical. A 1.6 mm concave root fillet stays below the mating region; A/B geometry is unchanged.

All eight corner combinations of 131/164 mm length, 64/78 mm width and 7/12 mm thickness have empty intersections with the plate. Each 0.5 mm downward-motion witness creates exactly two separate support contacts at the short bottom ledges. These are rectangular phone envelopes with rounded plan corners, not guarantees about a particular camera bump or button placement.

The 45° bed pose exports one watertight, positively wound body, Zmin=0, volume 27,860.39 mm³, 3,076 triangles. Its three flat starting lands total 169.706 mm². A mesh-normal screen restricts steeper-than-45° downward faces to the original M5 bore roof regions only (27.847 mm² total); the tilted teardrop has a 2.6 mm flat crown within each 3 mm ear. Print these short bridges with cooling, and verify actual thumbscrew fit. There are no long unsupported window bridges.

Final STL: **153,884 bytes**, SHA-256 `961444fb62f942304dbea92fca9621c8185cae80726adafcd3702e8f8f8baa2c`. All seven clearance sweeps repeat the new export, mount differences, phone envelopes and ledge-contact witnesses. This part has no fit-dependent mating joint or flexure.

Physical gates: both ledges support the phone, bands remain in their notches, controls/optics stay clear, and no phone movement occurs during a gentle over-cushion retention check. In front-camera mode, add equal tape pads on flat back areas if a camera bump would bear on the plate, keeping combined phone/padding thickness ≤12 mm. Camera-bump fit, PLA impact resistance and actual band friction are not established by the geometric tests. See [UNIVERSAL_PHONE_PLATE.md](UNIVERSAL_PHONE_PLATE.md).

## LCD1602 pod addition — verified 2026-11-05

**ALL CHECKS PASSED**, including all seven supported clearances. This addition changes no pre-existing STL: all **13 hashes match** `archive/pre_lcd_pod/production_hashes.json`, including C, D and the T1-verified mount. The pod has one watertight, consistently wound body on Z=0, volume 6,820.65 mm³, 2,964 triangles. The mesh-normal screen found **0.000 mm²** of downward faces steeper than 45° outside the bed. The four tapered posts and inclined pegs print without supports.

The new 53 intersection checks cover the pod against the assumed LCD PCB/bezel/backpack/header/female ends, its four LCD-only glue caps, both existing strap positions, the revised left-strap route, the current lid/base/button, individual vent passage gauges, all six new jumper housings/routes, the SHIM, existing finger loop and existing GPIO/button-wire envelopes. The two Pi sockets use full 2.54 × 2.54 × 14 mm bodies. New wire/socket envelopes expanded by 1.99 mm do not touch either lid hold-down post; reported nominal post clearance is **at least 2 mm**. The button plug and breadboard surroundings remain collision-free.

| LCD fit metric | Result |
|---|---:|
| 2.54 mm housing in the existing 3.2 mm vent | 0.330 mm per side |
| Housing between the pod's 3.0 mm guides | 0.230 mm per side |
| Pod to right strap at X=96 | 2.500 mm lateral gap |
| Ø2.4 peg in assumed Ø3.0 LCD hole | 0.300 mm radial gap |
| 13 mm strap in 13.6 mm channel | 0.300 mm per side |
| Original lid vent aperture area left open | 99.384% |

The pod sits at X=0, Y=10 on the closed lid, under the existing left strap at X=36. The right strap stays at X=96. The display face is 20° above horizontal toward the USB-C wall. The contrast pot remains exposed underneath; loosen the left strap and lift the pod for adjustment. Four 2.54 mm housings pass the third lid slot (X=77–80.2) individually; a bundled connector block is not covered by the test. Vent area is a planar geometric measure, not thermal validation.

**Electrical contact is explicitly not proven by these collision checks.** The conservative old SHIM reference leaves only 0.7 mm of pin above it. The space check places the female bodies at Z=18.6–32.6, above that reference; it must not be read as a valid pin-grip model. Alan must measure actual pin 3/5 exposure above the fully seated SHIM (aim ≥4 mm) and verify secure contact. The wiring picture is labelled unpowered fit. See `lcd_limitations` in the report.

The approved wiring is LCD VCC→d7 (3.3 V), GND→d5, SDA→h16, SCL→h17, with Pi3→g16 and Pi5→g17. The 170-point board has 17 rows; rows 16/17 f–j are unused by the base build. No LCD lead uses the Pi's 5 V rail. LCD function/contrast at 3.3 V remains unverified. The longest illustrated LCD run is about 134 mm between housings; allow another 30 mm of loose service wire outside. Header leads are about 137–138 mm between housings.

Final pod STL: **148,284 bytes**, SHA-256 `ae3edd246e31429889baec1af7eaafd35b5717a5417a3ed380c9a591092cc741`. Its dimensions, hole pattern, backpack and header locations are explicit measurement assumptions in [LCD1602_POD.md](LCD1602_POD.md). Do not force a mismatched module onto the PLA pegs. This is an open add-on support, not a sealed electronics enclosure.
