# HANDOFF — screw-free enclosure kit

All dimensions are millimetres. No M2.5 screws, nuts or purchased standoffs are used. The button's own panel nut and harness thumbscrew remain hand-tightened. The current build has no display. Four small removable hot-glue backup dots are now specified: two outside the finger tray/cradle seam and two over Pi locating pegs.

Start with [PRINT_SETTINGS](PRINT_SETTINGS.md), [VERIFY](VERIFY.md), and the numbered [ASSEMBLY ORDER](ASSEMBLY_ORDER.md). The [manual image manifest](../manual/img/MANIFEST.md) shows the current geometry. The older renders/ gallery is superseded. The archived screwed sources are historical only. No physical printer, purchased parts or slicer were available.

## Files

| Source | Selectors |
|---|---|
| `common.scad` | Phone/component dimensions, shared `snap_clearance`, GoPro interface |
| `p1_bodycam.scad` | `camera_mode="rear"` / `"front"`; `part="front_frame"`, `"back_plate"`, `"fit_ring"`, `"mount_test"`, `"assembly"`, `"exploded"` |
| `p2_relay.scad` | `part="base"`, `"lid"`, `"assembly"`, `"exploded"`; `with_oled=false` is the supplied closed lid |
| `p3_finger_clip.scad` | `part="tray"`, `"hood"`, `"joint_clips"` (two J clips), `"joint_clip"` (one spare), `"assembly"`, `"exploded"` |
| `snap_coupon.scad` | Eight small bodies testing four joint types, already arranged on the bed |
| `verify.py` | Re-exports all 13 STL files; audits topology, component fit, capture, tolerance and strain |
| `models/` | Simplified component envelopes, not vendor manufacturing models |

**In BOTH camera modes, front_frame = the outward outer shell A; back_plate = the chest plate B with the GoPro ears.** The long slide axis is horizontal when the phone is worn landscape. Rear mode puts the screen against the chest. Front mode puts the screen outward and adds space behind the rear camera bar. Both chest-plate STL shapes are identical; their installed positions differ.

## One fit variable; coupon first

`common.scad: snap_clearance = 0.30` remains the production default pending Alan’s physical calibration. **Print corrected c020 first**; c025 if it binds, c015 if capture is still too loose. Read [FIT_TEST.md](FIT_TEST.md) for the embossed ladder files, actual gap multipliers, four beginner pass/fail tests, and the distinction between spring stiffness and running play. Every setting from 0.15 to 0.45 in 0.05 steps is now exported and checked by `verify.py`. Select one passing setting for all mating production parts, re-export them together, and never scale STLs.

Print the coupon in PETG in the supplied orientation. Test all four pairs, including release, before printing large parts. There must be a clear seated stop, positive capture and hand release without whitening or cracks. Cycle each at least ten times; this is a fit check, not a lifetime test. The unlabelled default coupon is 4.19 cm³ and about **19–23 minutes**. The numbered ladder plates are 4.31–4.35 cm³ and about **20–24 minutes**. These are volume estimates; actual sliced time is unknown.

P1's full rails carry the phone and mount load. Its two external beams only stop horizontal withdrawal; remove the backup band and squeeze both tips inward before sliding the plate off. Do a pull and bounce check over a padded surface with the real phone before wearing it. A static CAD intersection does not establish shock strength or fatigue life.

P2's four lid paddles press inward toward the box centre to release. Lift a released corner slightly before moving to the next. The base retains the Pi independently on four integral 6 mm pads and two flexible edge clips; peel the cold glue caps away, then press the clips outward to remove the Pi. The microSD opening remains accessible. The bottom is flat and the power bank touches it directly.

The supplied relay lid has **`with_oled=false`** in `p2_relay.scad`: its former screen area is an uninterrupted 2.4 mm skin, with no display pads or guides. The button hole, labels, vents and latches stay in place. `with_oled=true` restores the display features while retaining the new backup-strap edge guides. For the historical identity check only, `with_backup_guides=false, snap_clearance=0.30` reproduces the archived display lid exactly. This is a future CAD option only: the active assembly and manual contain no OLED. Hot glue is used only at the four backup locations described below. `verify.py` exports just one production lid, **`stl/p2_lid.stl`**, with the option explicitly disabled.

To inspect the optional lid without replacing the supplied STL:

```sh
/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD --backend=manifold -D 'with_oled=true' -D 'part="lid"' -o cad/tmp/optional_oled_lid.stl cad/p2_relay.scad
```

## Relay cables, straps and own power bank

The only Qwiic chain is **SHIM → 500 mm finger cable → MAX30101**. Feed the cable through FINGER, push its plug into the SHIM socket, and leave **120 mm measured along the cable from the plug's rear face to the zip-tie grip**. Lay the loose U-shaped service loop over the clear front region of the Pi as shown in `b5_12_finger_slack`; then tighten the tie around the jacket, not the connector. The modeled route is 114.4 mm, so the allowance leaves about 5.6 mm of extra slack. Keep the loop below the lid and away from the four latch paddles. The long cable remains about 360 mm outside the exit after the internal route and notch-to-anchor section; check that this reaches the volunteer comfortably.

The USB-C port centre remains **11.2 mm from the Pi's left PCB edge**. Its side opening is now **18 mm wide × 18 mm high**, with 45° shoulders and a 6 mm crown bridge. A straight **15 × 10 mm plastic overmold** clears it; a **17 × 12 mm** rectangular gauge also passes, but has only 0.2 mm lower clearance and needs an actual print fit check. Those width/height limits apply together at the socket centre; an arbitrary 18 × 18 mm plug does not fit the sloped opening. Change `usb_plug_size` to the measured width, axial plastic length and height if needed; `usb_cut_w`, `usb_cut_h` and `usb_cut_z` control the aperture.

The socket face is modeled 8.8 mm inside the box wall. A 24 mm-long plastic overmold therefore projects **about 15 mm** outside; an additional 8 mm straight strain relief brings the projection to **about 23 mm before the flexible cable**. For other cables, projection is approximately overmold length minus 8.8 mm, plus strain-relief length. USB-A–C and USB-C–C cables are both mechanically suitable at the Pi end; match the bank end to the builder's bank.

Use plain hook-and-loop up to **13 mm wide**. The relay's rounded slots are **13.4 × 2.8 mm**, while the finger cradle's are **13.4 × 2.2 mm**. For one strap type throughout, use webbing **no thicker than 1.2 mm**; keep stiff sewn ends, buckles and doubled overlap out of the slots. Width alone does not guarantee a thick strap fits. Straps must be long enough to wrap the actual bank and leave their maker's fastening overlap.

The reference bank is an **unbranded 149 × 68 × 14 mm example**, not a required purchase. The base underside is flat. A practical bank envelope is up to **158 × 68 mm**, with thickness limited by strap length. The two straps are 60 mm apart: a bank needs at least **73 mm of straight usable length** to span both full 13 mm bands when positioned accordingly (allow extra for rounded ends). A 73 mm bank must be shifted toward the USB-C end to lie under both straps; a bank centred under the box needs about 99 mm length. Very small banks, slippery rounded banks and banks wider than the slot spacing are not automatically secure. Check that both straps lie on the body, the bank stays flush, ports remain accessible and it cannot slide out. For the pictured 14 mm bank, about 230 mm per strap leaves useful overlap; measure the actual wrap before cutting.

P3 uses two separate **J spring clips**. Slide each over the paired end flanges until its hook drops into the notch. Lift the clip's small free tip before sliding it off. Print a spare. The rear clip pocket retains a 1.4 mm opaque wall toward the finger. Use PETG for J even if F/G are opaque PLA.

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

## Re-export and render

From hardware/:

```sh
cad/.venv/bin/python cad/verify.py
```

This exports all 13 STL files. All individual pieces must be connected, watertight, consistently wound and on the bed. `p3_joint_clips.stl` intentionally contains two separate J clips; `snap_coupon.stl` intentionally contains eight pieces. No mesh repair is performed. Removed-hardware checks are retired explicitly, not passed by empty modules.

On a fresh machine:

```sh
python3 -m venv cad/.venv
cad/.venv/bin/pip install numpy trimesh scipy pillow
```

Set `OPENSCAD` if its path differs from `/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD`. Single front-mode export:

```sh
/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD --backend=manifold -D 'camera_mode="front"' -D 'part="front_frame"' -o cad/stl/p1_front_front_frame.stl cad/p1_bodycam.scad
```

Use `camera_mode="rear"` for the rear camera. Print a spare J with `part="joint_clip"`. The old CAD gallery is superseded; if explicitly needed later, its refresh commands are:

```sh
cad/.venv/bin/python cad/render_assets.py
/Applications/Blender.app/Contents/MacOS/Blender -b -P cad/render_blender.py
cad/.venv/bin/python cad/write_gallery.py
```

The manual renderer is separate: `manual/src/render_all.sh`. It imports the same printed geometry and adds only explanatory colours, arrows and purchased-part details.

## Fit gates

Check the actual Pixel bar/buttons/radius, harness buckle, straight USB-C overmold, SHIM plug, processor heatsink (maximum 12 mm above PCB; other kit pieces stay in the bag), HBAN plug, and the builder's bank/straps. The breadboard is **45 × 34.5 × 9.5 mm**. The optional OLED CAD still has unmeasured total-stack and active-area offsets, but these are not fit gates for the default screen-free build.

Breadboard row 1 is the end nearest the Pi. Rows increase away from the Pi; **a–e are the rear half toward the header/FINGER notch**, and **f–j are the front half toward USB-C**.

P3 keeps the 20 × 15 mm reference finger, 17 mm sensor-to-visor clearance, 14 mm visor, low 13 mm strap slots and flush sensor. Use black webbing directly over the finger beneath the visor. The opaque perimeter gasket must not cover the optical window. Check light pressure, comfort and retention on a relaxed palm-down hand; the reference finger is not an anatomy guarantee.

For a compact version fitted to a smaller finger, edit these variables at the top of `p3_finger_clip.scad`:

| Variable | Default | Smaller-finger adjustment |
|---|---:|---|
| `finger_width`, `finger_thickness` | 20, 15 | Reduce to measured finger dimensions. These change the **reference finger/strap**, not the printed cradle. |
| `channel_flat_width` | 11 | Reduce toward 7 to narrow the printed U while keeping its centre on the sensor. `channel_radius` controls side curvature; start by leaving it at 8.5. |
| `visor_clearance` | 17 | Reduce only to measured finger thickness + `strap_thickness` + at least 0.8 mm. For a 17 × 10.5 mm finger with 1.2 mm webbing, 12.5 mm gives a 19.65 mm cradle height before the clips. `visor_top_z` is derived; do not edit it separately. |
| `strap_thickness` | 1.2 | Set to measured webbing thickness; allow for any added pressure pad when choosing `visor_clearance`. |

Keep `board_seat_z`, the sensor plane, `sensor_top_offset`, strap-slot centre and closed stop fixed. Re-run `verify.py` after any sizing change, then refresh renders and print estimates. Smaller custom sizes are suggestions for iteration, not pre-verified alternate STLs.

## Drawing corrections retained

- Pi USB-C datum: left hole 3.5 mm + dimension 7.7 mm = 11.2 mm from PCB edge.
- ELEGOO breadboard dimensions replace the early generic 47 × 35 × 8.5 mm estimate.
- [Adafruit fab print](https://cdn-learn.adafruit.com/assets/assets/000/087/765/original/adafruit_products_1-3_STEMMA_OLED_fab_print.png) defines the glass/PCB offsets. The suggested UG-2864HSWEG01 datasheet is a different, 0.96-inch panel and was not used for the window offset.
- MAX30101 sensor centre is 2.8 mm below the board's top edge, not at board centre.


## Approved removable backups

**P3:** keep both J clips. Add exactly two rice-grain hot-glue dots on the outside tray/cradle seam, one on each side near the open finger-entry end. In CAD these are Y=-4, Z=1.8, at X=-3.75 and 29.15; the picture is easier to follow than coordinates. Keep glue outside, away from the sensor, gasket/light seal, channel, cable and J clips. No printed wells are needed. Let it cool before handling; peel the dots away cold before opening the removable sensor board.

**Pi:** after the dry-fit power-cable test, with power disconnected, apply one rice-grain dot to each of two diagonally opposite mounting holes beside the edge clips: the front corner beside USB, then the rear corner at the microSD end. Fill the recess over the peg and make a small cap on the hole rim. The tips are **0.2 mm below the PCB top**. They do not need to be taller for this adhesive backup; a taller plain peg would not create a true mechanical rivet head. Do not flood the hole, glue underneath the board, or touch chips, metal connectors, header or SHIM. Peel cold glue away before releasing the two edge clips. Adhesion and removal must be checked on the actual material; these are glue caps, not certified rivets.

**Relay third strap:** after fastening both bank straps, route a separate ≤13 mm wide, ≤1.2 mm thick strap in the shallow opposing wall guides, around the **whole closed box and the bank**. The band is between the last lid vent and right latch roots; it must not cover a vent, paddle, MARK button, port or cable. Do not put it between bank and base. Required usable length is approximately `2 × (78 + 39.4 + bank thickness) + 50 mm` for overlap: about **315 mm for a 14 mm bank**, or **350 mm for a bank up to 30 mm thick**. Use more overlap if the strap maker requires it. The bank must extend beneath all three strap positions: at least about 87 mm of straight usable length when shifted appropriately, or about 100 mm if centred, plus allowance for rounded ends. Prefer a 10–12 mm third strap if available; 13 mm fits the CAD but leaves only 0.25 mm lateral margin to the adjacent strap/latch-root corridor. Small banks still need both original straps and the no-slide check; the third strap supplements those two. Undo it before releasing the lid.

**Bodycam:** use a soft **2–2.4 mm wide rubber band, ≤1.2 mm thick**, following the narrow rim groove over both short ends and around shell plus chest plate. A 13 mm strap would cover the front-mode screen and is not suitable here. Installed loop length is roughly **325 mm rear / 332 mm front**; start with an unstretched loop around **280–300 mm circumference (140–150 mm laid flat)**, then check gentle tension and actual rubber properties. It must stay in its guide without touching the camera/screen opening, phone buttons, USB-C port, latches, GoPro ears or buckle. Remove the band before squeezing both plate tabs. This backup is removable by hand; never glue A to B.

The relay guides are 0.6 mm-deep open side channels, leaving 1.8 mm of wall and a flat base underside. P1's groove is 0.4 mm deep and 2.8 mm wide, leaving 1.4 mm face skin and a short bridge in the existing bed orientation. No supports or new printed pieces are introduced.
