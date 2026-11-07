# HANDOFF — no-snap CAD

The active build uses **rigid rails and locating pins, hot glue, two relay straps and two bodycam rubber bands**. No joint relies on a flexing plastic catch. No M2.5 screws, nuts, standoffs or J clips are needed. The button's own hand-tightened panel nut and harness thumbscrew remain.

Alan rejected all three snap-coupon fits. T3 and the unfinished `snap_v2/` experiment are retired; do not print them. T1 already passed his harness test and its STL is unchanged. T2 still checks the selected phone outline/window. [FIT_TEST.md](FIT_TEST.md) explains the optional rigid rail test.

## Export and verification

From `hardware/`, run:

```sh
cad/.venv/bin/python cad/verify.py
```

This exports the active STLs, checks assembled and insertion geometry, and sweeps `snap_clearance` from 0.15 to 0.45 in 0.05 steps. The legacy variable name remains for compatibility; **it now tunes rigid fits**, not snap stiffness. Its chosen default is **0.18 mm**. `--staging` writes test exports into `checks_staged/stl/` without replacing production files. No flexure-strain result is claimed for this design.

Individual exports use `/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD --backend=manifold --export-format binstl -D '$fn=64'`. In `p1_bodycam.scad`, set `camera_mode="rear"` or `"front"`; set `part="front_frame"` or `"back_plate"`. Both variants are already exported in `stl/`.

`front_frame` is the **outward outer shell A** and `back_plate` is the **chest plate B carrying the GoPro ears**, in BOTH camera modes. Rear mode points the rear lenses outward. Front mode places the phone screen toward the outward opening.

## Before printing A/B

Measure the bare Pixel 9 Pro:

| Measurement | Variable in common.scad |
|---|---|
| Length, width, thickness | `phone_l`, `phone_w`, `phone_t` |
| Corner radius | `phone_r` |
| Camera-bar width and height | `camera_bar_w`, `camera_bar_h` |
| Bar's distance from phone top | `camera_bar_top` |
| Bar offset across phone width | `camera_bar_side_offset` |
| Bar protrusion | `camera_bar_protrusion` |
| Button cluster start, length and protrusion | `phone_button_start`, `phone_button_length`, `phone_button_depth` |

The camera-bar values and corner radius remain estimates until measured. Keep `camera_margin>=2`. Rear face thickness plus `face_gap` must stay below bar protrusion. Check T2 against the phone before the long print.

## P1: rigid rails, closed-end stop, two bands

Both long rails carry the mount-to-phone load. The plate slides in from the open end to a rigid closed-end stop. The new running allowance is `snap_clearance` per outer bearing side and `snap_clearance` total vertically; the previous rails had doubled gaps. No latch beams or fences remain.

Print optional [rail_fit_test.stl](stl/rail_fit_test.stl) first if time permits: about 15–18 minutes, two rigid backed pieces. Hold them square, slide to the stop, and check for smooth movement without perceptible rattle. There is no click. Remove first-layer burrs before changing the fit value; do not scale STLs. A short test cannot prove the full-length rails against warping.

Use **two soft rubber bands**, each 2–2.4 mm wide and at most 1.2 mm thick, in the mirrored rim grooves. A 13 mm hook-and-loop strap would obstruct the front screen. Installed loop length is approximately 325 mm rear / 332 mm front; a soft 280–300 mm unstretched circumference (140–150 mm laid flat) is a starting size, not a guaranteed tension specification. The bands must hold the plate against its stop without crushing the phone. Both routes clear the optics, buttons, port and GoPro mount in the CAD envelope. Remove both bands before opening.

## P2: two straps total, lid posts retain the Pi

The lid's 2 mm thick, 4 mm deep rigid lips locate it. There are no paddles or catch bridges. Four pegs locate the Pi at the original height; edge clips and their floor slots are removed. The underside remains flat.

**No glue touches the Pi.** Two hold-down posts on D approach the bare rings of the diagonal mounting holes: the USB-C-wall corner beside the USB/Ethernet end, and the opposite header-side corner. Four base pads support the PCB; the two lid posts prevent lift when the lid is seated and both stack straps are closed. With the lid off, the Pi is unrestrained vertically: keep the box flat for wiring/tests, and lift the board straight off its pegs to service it.

The two post centres are (69.5,13.5) and (11.5,62.5) mm from the base's USB-C/left corner. They extend 26.25 mm below the lid underside. Tips are Ø4 mm with a Ø2.4 mm blind relief (1.2 mm deep); solid stems are Ø6 mm with 2 mm root fillets reaching Ø10 mm. The nominal tip is **0.15 mm above the PCB**, not preloaded. Peg tips remain 0.2 mm below PCB top; the posts land around the holes rather than on the pegs. `pi_post_gap`, `pi_post_tip_d`, `pi_post_stem_d` and `pi_post_root_r` are named parameters in `p2_relay.scad`.

The tips have no flexing catch and need no foam pad. **Dry-close D without tightening the straps:** it must lie flush under its own seating pressure with the PCB flat. FDM height variation can exceed the nominal gap. If either post makes the lid rock, remove only that tip's high spot in small increments, or increase `pi_post_gap` and re-export; never use strap force to bend the PCB. If there is noticeable board lift after closing, check all four base seats for debris and measure the actual stack before reducing the gap. Do not add arbitrary foam or tape thickness. The ≥2 mm component/wire clearances and the bare-ring landing must also be checked on the actual Pi; reference components are simplified.

Use **two hook-and-loop straps total**, at the former bank positions, each wrapping **lid + box + bank**. There are no floor-threaded bank straps or third backup strap. Each strap may be up to 13 mm wide and 1.2 mm thick; **10–12 mm is preferred**. Shallow wall grooves guide them. Rear-wall and lid vents moved between the routes. Keep straps centred: the maximum-width left strap has 1.3 mm clearance from the USB-C opening and 0.5 mm from the first front vent.

Allow **32–35 cm per strap** for the example bank range: about 32 cm for a 14 mm thick bank, 35 cm for up to 30 mm. This includes approximately 50 mm fastening overlap; the actual fastening method may need more. Two 20–30 cm straps may be too short: measure the complete stack before cutting, or join compatible straps securely. No longitudinal 50 cm strap is required.

The bank is generic, unbranded and supplied by the builder. A roughly 10–16 cm long bank, no wider than 6.8 cm, should span both routes when positioned correctly; rounded ends need usable bearing length. Check that it cannot slide after tightening. Bank adhesion and strap friction have not been physically tested.

The finger cable runs directly from the FINGER notch to the SHIM socket. Leave **120 mm along the cable from the zip-tie grip to the plug rear**; plug it in, arrange the service loop, then tighten the tie. Keep the loop below the lid and away from the lips.

Dry-fit the builder's straight USB-C plug before breadboard installation. The shaped opening clears a 15×10 mm overmold with 1.2 mm minimum modeled margin, and a 17×12 mm gauge with only 0.2 mm lower margin. A typical straight plug projects about 15–25 mm outside, depending on its length. The actual plug must seat without force. USB-C centre stays 11.2 mm from the PCB's left edge.

`with_oled=false` is the production default: solid former window area, no pads or OLED rails. `with_oled=true` retains an optional display layout, but no OLED is installed in this build. The no-snap lid intentionally differs from the historical snap lid.

## P3: self-locating halves, four glue dots

F has three asymmetrically placed chamfered pins; G has matching blind sockets. They locate the halves without an interference lock. The J clips, projecting front flange and rear clip pocket are removed.

After seating the sensor and matching the pins, apply **four rice-grain hot-glue dots outside the F/G seam**: one near the open finger-entry end and one near the closed fingertip end on each side. They avoid the sensor opening, light seal, cable and finger channel. Do not flood the seam. Let all four cool before testing the joint. Peel the cold dots off to service the removable sensor board.

The adult defaults remain: 20 mm wide ×15 mm thick reference finger, 17 mm visor clearance above the sensor, and a strap directly over the finger. The sensor plane and board seats are unchanged. For a small finger, reduce `finger_width`/`finger_thickness` only for the reference; reduce `channel_flat_width` and/or `channel_radius` to narrow the cradle, and reduce `visor_clearance` only while preserving finger + strap clearance. Re-run verification after resizing. Use opaque material and check the real sensor is flush.

## Build order and limitations

See [ASSEMBLY_ORDER.md](ASSEMBLY_ORDER.md), [PRINT_SETTINGS.md](PRINT_SETTINGS.md) and [VERIFY.md](VERIFY.md). Images are regenerated with `manual/src/render_all.sh` from `hardware/`. No physical drop, fatigue, glue-adhesion, band-tension or complete-case load test is claimed. Test the assembled phone case over padding and the strapped relay before wearing them.

## Optional universal phone plate

The separate [universal_phone_plate.stl](stl/universal_phone_plate.stl) holds phones in the 131–164 × 64–78 × 7–12 mm range with two corner ledges and two or three bands. It reuses the T1-tested mount and changes nothing in A/B. **PLA, supplied 45° bed pose, no supports, 8 mm brim.** See [the use and print instructions](UNIVERSAL_PHONE_PLATE.md) for band sizing, front-camera bump padding and the physical retention check. `verify.py` exports and checks it with the rest.

## Optional LCD1602 pod: no existing part needs reprinting

[lcd1602_pod.stl](stl/lcd1602_pod.stl) adds an open PLA support on the existing lid, using the **left of the two current straps**. The screen faces the USB-C side, 20° above horizontal. Four plain locating pegs and small LCD-only glue caps retain the board. The Pi remains glue-free. The right strap and MARK button stay clear.

Read [LCD1602_POD.md](LCD1602_POD.md) before printing: its PCB/backpack dimensions are assumptions to measure, and its `lcd_pod_*` parameters are in [lcd1602_pod.scad](lcd1602_pod.scad). Print the supplied flat-base orientation, 0.20 mm PLA, four walls, 25% infill, 3 mm brim, no supports; allow **35–45 minutes**.

Four separate LCD leads pass through the existing third lid vent, one housing at a time. This optional wiring uses **3.3 V only** from breadboard d7, ground d5, and free front rows 16/17 for SDA/SCL. The Pi ends still require physical pins 3/5: check at least about 4 mm exposed pin above the fully seated SHIM before proceeding. CAD verifies space, not electrical contact or reliable LCD operation at 3.3 V. The guide gives the exact six-jumper map and the unpowered fit procedure.
