# HANDOFF — parametric enclosure kit

All dimensions are **millimetres**. The STLs are in their intended print orientation, with the lowest point at Z=0. Do not auto-orient or uniformly scale them: a scale change also changes screw and GoPro fits.

Browse the [render gallery](../renders/index.html). Start with [PRINT_SETTINGS.md](PRINT_SETTINGS.md) and the recorded limitations in [VERIFY.md](VERIFY.md). No physical parts, printer or slicer were available for this CAD pass. The result is a verified digital fit against the documented reference envelopes, with physical fit gates below.

## Files and selectors

| Source | Selectors / outputs |
|---|---|
| `common.scad` | Shared dimensions, clearance variables, rounded corners, M2.5 bores/nut pockets, GoPro two-ear interface |
| `p1_bodycam.scad` | `camera_mode="rear"` or `"front"`; `part="front_frame"`, `"back_plate"`, `"fit_ring"`, `"mount_test"`, `"assembly"`, `"exploded"` |
| `p2_relay.scad` | `part="base"`, `"lid"`, **`"oled_retainer"`**, `"assembly"`, `"exploded"` |
| `p3_finger_clip.scad` | `part="clip"` lays out both pieces; `"tray"`, `"hood"`, `"assembly"`, `"exploded"` |
| `models/` | Simplified reference components, for fit checks and visual explanation; not manufacturing models of purchased parts |
| `stl/` | 12 independently watertight printable parts, including both P1 variants and the added OLED retainer |
| `verify.py`, `checks/report.json` | Re-export, non-penetration and nut-bearing-web checks, with replayable SCAD witnesses and logs |
| `render_assets.py`, `render_blender.py` | Reproducible CAD-derived Blender renders in `../renders/` |

**In BOTH camera modes, `front_frame` means the outward face (the guide’s “outer shell”), and `back_plate` means the chest side with the GoPro ears (the “chest plate”).** Both versions hold the phone landscape. With the rear variant, the screen faces the chest; with the front variant, the screen faces outward and the deeper cavity clears the rear camera bar. Both back-plate STL shapes happen to be identical; their assembled Z positions differ by 3.6 mm.

## Measure the Pixel before printing P1

Remove any existing phone case. Use calipers where possible; ruler estimates are sufficient only for deciding which coupon to try.

| Measure on the actual Pixel 9 Pro | Variable in `common.scad` | Default / meaning |
|---|---|---|
| Overall long edge / short edge / thickness | `phone_l`, `phone_w`, `phone_t` | 152.8 / 72 / 8.5 |
| Corner radius, viewed square-on | `phone_r` | **9.5 estimate**. Compare against printed radius templates or the fit ring. |
| Bar width across portrait phone | `camera_bar_w` | **61 estimate** |
| Bar height along portrait long axis | `camera_bar_h` | **19 estimate** |
| Phone top edge to nearest camera-bar edge | `camera_bar_top` | **9.5 estimate** |
| Bar centre relative to portrait width centre | `camera_bar_side_offset` | 0; positive follows CAD +Y |
| Bar projection beyond the rear body | `camera_bar_protrusion` | **3.6 estimate** |
| Desired clearance on each side of phone | `phone_clearance` | 0.4 per side; add any liner thickness here |
| Top edge to beginning of button cluster / cluster length | `phone_button_start`, `phone_button_length` | 25 / 59 conservative relief |
| Protruding button envelope | `phone_button_depth` | 2.0; reference model only, confirm relief after printing |
| Bottom speaker/USB-C/mic span, top mic span | `phone_end_slot_width`, `phone_mic_slot_width` | 48 / 34 broad edge openings |

Keep `camera_margin >= 2`. In `p1_bodycam.scad`, the default `face_t=1.8` and `face_gap=0.4` put the outward surface 1.4 mm behind the assumed bar face. The camera aperture opens outward with a 45-degree chamfer. Check the actual ultra-wide image at 0.5× for dark corners: the entrance-pupil location and the phone's unpublished bar geometry were not measured.

Print **`p1_mount_test.stl` first**, and engage it in the purchased harness buckle with the supplied M5 thumbscrew. The two ears are 3.0 mm, the middle gap is 3.2 mm, the nominal round part of the teardrop hole is Ø5.2 mm, and the ear diameter is 15 mm. These are community/de-facto GoPro dimensions, not guaranteed manufacturer tolerances. Adjust `gopro_finger`, `gopro_gap`, `gopro_hole`, and `gopro_radius` only after checking the coupon. There is no printed M5 thread or extra M5 nut.

Print the selected **2 mm fit ring** next. The front ring checks the phone outline. The rear ring includes a 0.6 mm camera-aperture gauge web; lay it against the phone's rear surface to compare the bar location. It is a gauge, not a load-bearing holder. The web means it is not a sleeve that can slide the whole way down the phone body.

## Re-export in one command

From the `hardware/` folder, using the included local environment:

```sh
cad/.venv/bin/python cad/verify.py
```

This regenerates all twelve STLs and runs every check. The script exits nonzero for failed topology, a disconnected printable part, an off-bed STL, a real collision, or a clearance failure. For a fresh machine, create the local environment once:

```sh
python3 -m venv cad/.venv
cad/.venv/bin/pip install numpy trimesh scipy pillow
```

Set `OPENSCAD` to the OpenSCAD executable on another machine. The default is `/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD`. The script uses the Manifold backend. There is no mesh-repair step hiding CAD errors.

A single front-camera frame can also be exported directly:

```sh
/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD --backend=manifold -D 'camera_mode="front"' -D 'part="front_frame"' -o cad/stl/p1_front_front_frame.stl cad/p1_bodycam.scad
```

Change `"front"` to `"rear"` for the preferred rear-camera variant. In the OpenSCAD GUI, change the two selectors at the top of `p1_bodycam.scad`, render (F6), then export STL. Run the full verifier after changing fit dimensions.

Regenerate the full render set:

```sh
cad/.venv/bin/python cad/render_assets.py
/Applications/Blender.app/Contents/MacOS/Blender -b -P cad/render_blender.py
cad/.venv/bin/python cad/write_gallery.py
```

## Assembly and fit gates

**P1:** Slide four M2.5 nuts into the frame’s side slots from the outward edges of the screw lugs. Each nut sits behind a 1.2 mm printed bearing web facing the chest plate; the seam shows only the screw bore. Place the phone in the frame without compressing any buttons, add the back plate, and install four M2.5×6 screws from the chest side. Tighten gently and evenly. Deburr every surface near the phone; use a thin soft liner only after accounting for its thickness in the clearance. Check the harness coupon, camera field of view, button freedom, microphone and USB access before putting the phone on a harness.

**P2:** Install the four **6 mm M/F standoffs male-up**. Their female ends sit on the base floor at Z=3; the Pi stays at Z=9. Four M2.5×6 screws enter from below, with their heads fully inside Ø5.4 × 2.2 mm counterbores. The modeled head is Ø5 × 2 mm and sits 0.2 mm above the base underside. Put the Pi over the upward male studs and use four nuts on top of the PCB. Nothing protrudes below the base, and the power bank sits flush against it (`bank_gap=0`).

Check the actual screw heads fit the counterbores and the female thread accepts **5.2 mm engagement** without bottoming. If the kit’s blind female hole is shallower, shorten only the four underside nylon screws to `base_floor - pi_counterbore_h + measured usable thread depth` (leave about 0.2 mm before the blind end), deburr and start the threads by hand. Keep the screw heads recessed and the 6 mm spacer-body height unchanged. The male studs must extend at least 3.6 mm above the spacer to cover the PCB and nut; 6 mm studs are modeled. Tighten gently: only 0.8 mm of floor lies above the head seat.

Seat the adhesive-backed **45 × 34.5 × 9.5 mm** breadboard in its pocket. The button goes into the separate bay, with its supplied nut below the lid.
Slide a nut into each lid retainer post from its side facing away from the OLED, before seating the display. These nuts also bear on 1.2 mm printed webs toward the retainer screws. The OLED uses **printed round spacers and a rear retainer**, because 5 mm-AF nylon spacers overlap the real glass. Seat the display glass-side toward the lid on the four round pads; put the retainer behind the PCB, with its four raised pads toward the board. Two M2.5×6 screws through the retainer engage nuts in the outboard lid posts. The screws clamp the PCB edges, not the glass. Hand-tighten only. Its rear Qwiic connectors and cable routing remain accessible through the retainer opening and rail notches. Check actual display fit and cable plugs **before** final assembly. The window uses full glass minus 1 mm per side; `oled_window_inset` and `oled_window_offset_y` remain adjustable.

The lid uses four further M2.5×6 screws. Slide four nuts into the base corner bosses from the box interior along X, beneath their 1.2 mm bearing webs; then fit the lid. The nuts must seat against printed webs, not the lid or retainer itself. Each P2 joint uses 2.4 mm of mating plate + 1.2 mm of web + the full 2 mm nut = 5.6 mm of the available 6 mm screw. Total P2: **10 M2.5×6 screws, 10 M2.5 nuts, four 6 mm M/F standoffs**, plus the button's supplied nut. Two 13 mm Velcro straps run **across the inside floor** at X=36 and X=96, down slots outside the bank’s Y footprint, and around the bank underside. Thread them before mounting electronics. The second strap clears the breadboard pocket; neither lies between the flat bank and base contact faces. Route the finger cable through the rear notch at X=83. The lid’s FINGER label and arrow point directly at this exit. Thread a small zip tie through the horizontal teardrop eye in the internal anchor beside the notch, then loop it around the cable jacket. The tie stays entirely above the base floor.

Confirm the actual right-angle USB-C plug seats fully through the side opening, the microSD is accessible, all nylon spacers are seated, and the heatsinks stay within the 12 mm envelope. The shell was raised by 2 mm to provide at least 3 mm modeled clearance above the heatsink envelope. USB-A/Ethernet remain internal; this enclosure is intended for Wi-Fi operation.

**P3:** The second printable piece keeps the file name `p3_hood.stl`. It combines an open U cradle with a 14 mm distal visor and a closed fingertip stop. The default reference finger is **20 mm wide × 15 mm thick**, with **1.2 mm-thick** webbing. The rigid assembly measures **46.4 × 48.4 × 24.15 mm**; the soft strap beneath the tray adds 1.2 mm locally. The sides rise 8 mm above the sensor. `channel_radius=8.5` and `channel_flat_width=11` give roughly 27.7–28.0 mm of opening at the top of the curved sides; the visor cheeks narrow this to **26.1 mm**, still above the 21 mm requirement. The visor underside is **17 mm above the sensor plane**, at Z=22.35. The central entry floor is 1.15 mm above the sensor; local side caps separately clear the Qwiic connectors.

Insert four nuts from the tray underside, away from the screw heads. Their pockets retain a 1.4 mm printed bearing roof toward the cradle, crossed only by the Ø2.9 mm screw bore. Lay the board sensor-up on the tray seats, connect Qwiic, and join the cradle using four M2.5×6 screws from above. The 2.4 mm cradle flange + 1.4 mm tray web + full 2 mm nut uses 5.8 mm of screw length. The enlarged lugs keep the screw heads outside the cradle and beyond the pressure-strap edges. Corner pads hold the PCB without loading its glass/package. Seal the sensor aperture’s 0.2 mm perimeter gap with opaque tape or a thin black gasket; keep the optical surface clear. Do not solder a bottom header.

Use an **opaque black 13 mm Velcro strap**. Thread it through the two low transverse wall slots centred directly on the sensor (Y=22.6), over the finger **under the visor**, and around the tray. The strap must contact the finger; never route it over the rigid visor. The fingertip slides toward the closed stop under the short roof. Close the strap with light, consistent pressure so the pad touches the flush sensor even when the hand is relaxed, palm down. The strap provides retention and top light shielding; the visor and sidewalls shield the fingertip end. Put cable strain relief through the tray’s small side slots, avoiding the pressure strap.

The 20 × 15 mm reference finger and 13 × 1.2 mm strap pass the modeled collision checks. The strap contacts the top of the finger above the sensor and clears the visor by **0.80 mm there**, or **0.65 mm at the visor entrance** where the floor is slightly higher. This is a geometric fit check; actual finger shape, comfort, pad contact, ambient-light rejection and retention on a relaxed hand on the floor still need a physical check. A thinner finger can use the same cradle by taking up the slack in the strap. A thin compliant black pad between strap and finger can spread pressure, but its thickness consumes the visor clearance. Keep the finger pad on the sensor and use only light pressure.

For a compact version fitted to a smaller finger, edit these variables at the top of `p3_finger_clip.scad`:

| Variable | Default | Smaller-finger adjustment |
|---|---:|---|
| `finger_width`, `finger_thickness` | 20, 15 | Reduce to measured finger dimensions. These change the **reference finger/strap**, not the printed cradle. |
| `channel_flat_width` | 11 | Reduce toward 7 to narrow the printed U while keeping its centre on the sensor. `channel_radius` controls side curvature; start by leaving it at 8.5. |
| `visor_clearance` | 17 | Reduce only to measured finger thickness + `strap_thickness` + at least 0.8 mm. For a 17 × 10.5 mm finger with 1.2 mm webbing, 12.5 mm gives a 19.65 mm rigid height. `visor_top_z` is derived; do not edit it separately. |
| `strap_thickness` | 1.2 | Set to measured webbing thickness; allow for any added pressure pad when choosing `visor_clearance`. |

Keep `board_seat_z`, the sensor plane, `sensor_top_offset`, strap-slot centre and closed stop fixed. Re-run `verify.py` after any sizing change, then refresh renders and print estimates. Smaller custom sizes are suggestions for iteration, not pre-verified alternate STLs.

## Source notes and deliberate changes

- Official Pi drawing: USB-C centre is **3.5 + 7.7 = 11.2 mm** from the left PCB edge. The early spec's 7.7 mm edge datum was wrong. Micro-HDMI centres are 26.0 / 39.5 mm; AV is 54.0 mm.
- Corrected confirmed ELEGOO breadboard size replaces the generic 47 × 35 × 8.5 mm model.
- [Adafruit official OLED fabrication print](https://cdn-learn.adafruit.com/assets/assets/000/087/765/original/adafruit_products_1-3_STEMMA_OLED_fab_print.png) defines 35.56 × 33.02 mm PCB, 30.48 × 27.94 mm hole pattern and an offset glass rectangle. The separately suggested [UG-2864HSWEG01 datasheet](https://www.adafruit.com/datasheets/UG-2864HSWEG01.pdf) is for a **0.96-inch** display; its active-area offsets were not applied.
- GoPro dimensions are a de-facto fit; [Meshra's first-party design discussion](https://meshra.ai/blog/gopro-mount-that-fits-the-ecosystem) describes 3 mm ears and a 3.2 mm gap. The physical harness coupon is the authority for the purchased buckle.
- Recessed, paint-fill lettering replaces raised lettering on the face-down P1 frame and P2 lid. This keeps the bed contact flat and the print support-free. Red markings in the renders illustrate post-print paint fill.
- P2 gains one small rear OLED retainer; P3 is two rigid pieces, with an open cradle, short visor and direct pressure strap rather than a spring hinge. These choices use only available fasteners and avoid support material.
