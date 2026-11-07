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

## P2: two straps total, Pi glue caps

The lid's 2 mm thick, 4 mm deep rigid lips locate it. There are no paddles or catch bridges. Four pegs locate the Pi at the original height; edge clips and their floor slots are removed. The underside remains flat.

Apply **two rice-grain glue caps** over the diagonal mounting holes: the corner beside the USB/Ethernet end on the USB-C wall side, and the opposite corner beside the header. These are the already-checked component-clear holes, not all four corners. Peg tips remain 0.2 mm below the PCB top; glue bridges the recess and hole rim. Keep glue off chips, connectors and the header. Peel cold glue away before lifting the Pi off its pegs.

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

See [ASSEMBLY_ORDER.md](ASSEMBLY_ORDER.md), [PRINT_SETTINGS.md](PRINT_SETTINGS.md) and [VERIFY.md](VERIFY.md). Images are regenerated with `manual/src/render_all.sh` from `hardware/`. No physical drop, fatigue, glue-adhesion, band-tension or complete-case load test is claimed. Test the assembled phone case over padding and the glued/strapped relay before wearing them.
