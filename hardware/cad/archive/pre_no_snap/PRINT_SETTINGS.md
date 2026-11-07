# Print settings — screw-free HANDOFF

Use a **0.4 mm nozzle**, **0.20 mm layers**, 0.40–0.45 mm line width and six top/bottom layers. **Supports: none for every supplied part.** Keep the supplied bed orientation. Use PETG for P1/P2, coupon and J clips. Opaque black PLA is acceptable for F/G; J still uses PETG. Use the filament maker’s temperature and cooling profile.

Use gyroid for partial infill and rectilinear at 100%. The thin snap beams should be solid walls; confirm the slicer preserves the Pi clip’s 0.8 mm section as two lines. Use a solid modifier over GoPro ears if the slicer leaves voids. Do not apply a brim inside snap gaps; remove outside brims completely before fitting.

The labelled c025/c020/c015 ladder plates are about 20–24 minutes each. See FIT_TEST.md before printing the main parts. No slicer is installed. Estimates assume 85–100% of CAD solid volume deposited, 10% filament allowance, PETG density 1.27 g/cm³, 4 mm³/s average extrusion and 30% motion/cooling allowance. The coupon is about **19–23 minutes**, above the ten-minute target; all four full-size flexures and matching pieces are retained so the fit test is meaningful.

| STL | Bed bounds, mm | Walls | Infill | Brim | CAD cm³ | PETG | 1.75 mm filament | Time |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| [p1_rear_front_frame](stl/p1_rear_front_frame.stl) | 158.4 × 103.8 × 15.62 | 5 | 25% | 3 mm | 40.81 | 48.5–57.0 g | 15.9–18.7 m | 188–221 min |
| [p1_rear_back_plate](stl/p1_rear_back_plate.stl) | 158.4 × 100.8 × 21.3 | 6 | 30% | 3 mm | 26.55 | 31.5–37.1 g | 10.3–12.1 m | 122–144 min |
| [p1_rear_fit_ring](stl/p1_rear_fit_ring.stl) | 158.4 × 77.6 × 2 | 3 | 15% | 0 mm | 2.51 | 3.0–3.5 g | 1.0–1.1 m | 12–14 min |
| [p1_front_front_frame](stl/p1_front_front_frame.stl) | 158.4 × 103.8 × 19.22 | 5 | 25% | 3 mm | 29.24 | 34.7–40.9 g | 11.4–13.4 m | 135–158 min |
| [p1_front_back_plate](stl/p1_front_back_plate.stl) | 158.4 × 100.8 × 21.3 | 6 | 30% | 3 mm | 26.55 | 31.5–37.1 g | 10.3–12.1 m | 122–144 min |
| [p1_front_fit_ring](stl/p1_front_fit_ring.stl) | 158.4 × 77.6 × 2 | 3 | 15% | 0 mm | 2.13 | 2.5–3.0 g | 0.8–1.0 m | 10–12 min |
| [p1_mount_test](stl/p1_mount_test.stl) | 32 × 34 × 21.5 | 6 | 100% | 3 mm | 4.90 | 5.8–6.8 g | 1.9–2.2 m | 23–27 min |
| [p2_base](stl/p2_base.stl) | 170 × 78 × 42.4 | 5 | 20% | 5 mm | 75.90 | 90.1–106.0 g | 29.5–34.7 m | 349–411 min |
| [p2_lid](stl/p2_lid.stl) | 158 × 78 × 5.4 | 5 | 25% | 3 mm | 25.74 | 30.6–36.0 g | 10.0–11.8 m | 119–139 min |
| [p3_tray](stl/p3_tray.stl) | 32.9 × 53.4 × 2.2 | 4 | 25% | 3 mm | 3.04 | 3.6–4.2 g | 1.2–1.4 m | 14–16 min |
| [p3_hood](stl/p3_hood.stl) | 32.9 × 22.35 × 53.4 | 4 | 25% | 5 mm | 12.67 | 15.0–17.7 g | 4.9–5.8 m | 58–69 min |
| [p3_joint_clips](stl/p3_joint_clips.stl) | 52 × 7.5 × 4.4 | 3 | 100% | 0 mm | 0.74 | 0.9–1.0 g | 0.3–0.3 m | 3–4 min |
| [snap_coupon](stl/snap_coupon.stl) | 82 × 56 × 13.7 | 3 | 100% | 0 mm | 4.19 | 5.0–5.8 g | 1.6–1.9 m | 19–23 min |

## Orientation and finishing

| Part | Bed orientation | Finishing / assembly |
|---|---|---|
| p1_rear_front_frame | Outward camera face down; cavity and rails upward. | Clear rail channels, release windows and the narrow backup-band groove. |
| p1_front_front_frame | Outward screen rim down; cavity and rails upward. | Clear rail channels, release windows, button relief and backup-band groove. |
| p1_rear_back_plate | Flat phone-side face down; GoPro ears upward. | Clear beam gaps and M5 hole; do not round the latch shoulders. |
| p1_front_back_plate | Flat phone-side face down; GoPro ears upward. | Same geometry as rear chest plate; fit the selected frame. |
| p1_rear_fit_ring | Thin camera-gauge web down. | Remove elephant foot before comparing bar and phone outline. |
| p1_front_fit_ring | Flat ring face down. | Check outline without forcing the phone. |
| p1_mount_test | Flat rectangular foot down; ears upward. | Check buckle and harness thumbscrew before printing B. |
| p2_base | Broad flat bottom down; supports and catches upward. | Clear Pi clip isolation slots and locating pegs; keep underside flat. |
| p2_lid | Labelled outer face down; locating lips upward; closed screen area lies on the bed. | Clear the four beam gaps and check the button nut. Default with_oled=false; no display; exterior backup-strap edge guides. |
| p3_tray | Broad bottom down; board seats upward. | Smooth sensor seats and cable-tie slots. |
| p3_hood | CLOSED fingertip stop down; open finger entry upward. | Clear rear clip pocket and both notches; smooth finger and strap surfaces. |
| p3_joint_clips | Both C profiles lie flat on their sides, exactly as supplied. | Print two J clips plus one spare. Clear hook corners; test seating and hand release. |
| snap_coupon | Eight pieces lie in their production layer directions. | Separate the four test pairs. Clear stringing; cycle each ten times before tuning snap_clearance. |

## Support-free features

- P1 frames print on their outward face. The dovetail walls grow at 45 degrees; the external latch fences grow from their roof in this orientation. Chest-plate flexures lie in the bed plane. GoPro holes have teardrop roofs. The 0.4 mm-deep rim groove bridges only 2.8 mm in the unchanged frame bed pose.
- P2 base catches have 6 mm bridges between cheeks. Port crowns bridge 6 mm (USB-C) and 4 mm (microSD); vents bridge 3.2 mm. The backup-strap channels are vertical, open at the outside edge and leave a 1.8 mm wall. Pi clip heads use 45-degree ramps. Their isolation slots open upward from a remaining 0.8 mm floor, keeping the bottom flat.
- P2 lid flexures lie flat on the bed. Locating lips grow upward; the closed former window is the same 2.4 mm skin as the rest of the lid. There is no rear retainer, countersunk screw, nut trap or printed thread.
- P3 cradle prints closed-tip-down. The rear clip pocket opens at the bed and joins the wall behind it; its short notch features bridge at most the 4.4 mm clip width. The front flange grows directly from the cradle floor. Sensor ramp and connector caps retain their 45-degree approaches. J clips print as flat C profiles, so their hooks need no support.
- These are geometric printability checks. Confirm layer paths and thin beams in the actual slicer before printing.

## Fit-first order

1. Print snap_coupon, T1 and the selected T2 fit ring.
2. Follow FIT_TEST.md: c020 first, then c025 if binding or c015 if loose; distinguish rotation from failed capture.
3. Print A/B and test both latches, then the actual phone and harness over padding.
4. Print C/D and check the Pi, button, direct finger cable and straight USB-C plug; add only the two specified removable Pi glue caps.
5. Print F/G and two J clips plus a spare; test the strap directly over the finger under the visor; add two exterior seam glue dots.

Use only light pressure on electronics. Do not force or heat-bend a tight snap. No physical fatigue, load or print test has been performed.
