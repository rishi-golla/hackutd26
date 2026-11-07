# Screen-free revision record

**CAD:** ALL CHECKS PASSED — 13 STLs; 90 geometry/tolerance checks; four strain screens; six fit metrics; one exact optional-lid regression.

**Manual:** 145 required images present, 154 active PNGs; required-list comm output empty. CAD-owned generator now includes the network overview. Captions, canvas sizes, comparison pairs, arrows and anchors pass validation.

**Cable:** 120 mm from plug rear to tie grip; modeled path 114.4 mm, at least 3 mm from lid features.

**USB-C:** opening raised from 18 × 14 to 18 × 18 mm. Recommended overmold 15 × 10 mm; largest verified paired gauge 17 × 12 mm, only 0.2 mm lower margin. Example projects 15.2 mm as plastic body, 23.2 mm including straight strain relief.

**Lid:** 158 × 78 × 5.4 mm on bed; 25.78 cm³; 119–140 minutes, 30.6–36.0 g PETG by volume estimate. with_oled=true is geometrically identical to the archived previous lid.

**Accessories:** user-supplied bank, USB cable and straps. Relay slots are 13.4 × 2.8 mm; P3 slots 13.4 × 2.2 mm. Up to 13 mm width, recommend ≤1.2 mm webbing. Fixed bands are 60 mm apart; a bank needs ≥73 mm usable straight length when positioned to span both. Practical width ≤68 mm. Unknown shapes/lengths require a retention check.

**Scope:** manual/index.html, software/, guide/ and renders/ were not edited. The relay wiring SVG/PNG were regenerated without the display.

## Changed existing pictures

42 files:

- `b2_bed_C.png`
- `b2_bed_D.png`
- `parts_printed.png`
- `icon_C.png`
- `icon_D.png`
- `icon_PB.png`
- `icon_UC.png`
- `icon_h6.png`
- `b5_04_strap_one.png`
- `b5_04_straps.png`
- `b5_06_pi.png`
- `b5_06_pi_zoom.png`
- `b5_06_pi_click.png`
- `b5_06_pi_ok.png`
- `b5_06_pi_no.png`
- `b5_07_peel.png`
- `b5_07_breadboard.png`
- `b5_08_cable_in.png`
- `b5_08_tie_thread.png`
- `b5_08_tie_close.png`
- `b5_11_unplug.png`
- `b5_11_nut_remove.png`
- `b5_11_button.png`
- `b5_11_nut.png`
- `b5_11_button_zoom.png`
- `b5_11_plug.png`
- `b5_test_open.png`
- `b5_22_close.png`
- `b5_22_click.png`
- `b5_22_close_zoom.png`
- `b5_22_close_ok.png`
- `b5_22_close_no.png`
- `b5_release_lid.png`
- `b5_release_lid_zoom.png`
- `b5_release_pi.png`
- `b5_release_pi_zoom.png`
- `b5_23_bank.png`
- `b5_23_strap_one.png`
- `b5_23_straps.png`
- `b5_23_usb_a.png`
- `b5_23_usb_c.png`
- `b7_network.png`

## New pictures

5 files:

- `b5_12_finger_shim.png`
- `b5_12_finger_shim_zoom.png`
- `b5_12_finger_shim_ok.png`
- `b5_12_finger_shim_no.png`
- `b5_12_finger_slack.png`

## Moved to img/_unused_oled/

15 files:

- `b5_09_lid.png`
- `b5_09_lid_oled.png`
- `b5_09_lid_oled_zoom.png`
- `b5_09_lid_oled_ok.png`
- `b5_09_lid_oled_no.png`
- `b5_10_glue_one.png`
- `b5_10_glue_two.png`
- `b5_10_glue_set.png`
- `b5_10_glue_zoom.png`
- `b5_12_oled.png`
- `b5_12_qwiic.png`
- `b5_12_finger.png`
- `icon_O.png`
- `icon_Q1.png`
- `icon_glue.png`

The previous network overview is additionally preserved as `_unused_oled/b7_network_before.png`. The new overview is reproducible from `scenes_network.py`.

Physical print fit, actual cable flexibility and bank retention remain untested. No geometric collision was waived.
