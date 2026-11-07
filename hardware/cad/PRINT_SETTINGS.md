# Print settings — no-snap HANDOFF

Use a **0.4 mm nozzle**, **0.20 mm layers**, 0.40–0.45 mm line width and six top/bottom layers. **Supports: none for every supplied part.** Keep the supplied orientation. The optional universal_phone_plate uses **PLA**, 0.20–0.24 mm layers and an 8 mm brim. The optional lcd1602_pod uses **PLA**, 0.20 mm layers, four walls and a 3 mm brim. PETG is recommended for the original A/B/C/D and the rail test; opaque PETG or PLA is suitable for F/G. No printed flexures remain.

Use gyroid for partial infill and rectilinear at 100%. Keep GoPro ears solid with a modifier if necessary. Put any brim outside mating faces, then remove it fully. Do not scale STLs to change a fit. Use the filament maker’s profile.

No slicer is installed. Estimates use 85–100% of CAD solid volume, 10% filament allowance, PETG density 1.27 g/cm³, 4 mm³/s average extrusion and 30% motion/cooling allowance. They are planning estimates, not measured print times; minimum-layer cooling on the narrow posts can add time. The optional backed rail pair is about **15–18 minutes**; the snap coupon T3 and J clips are retired.

| STL | Bed bounds, mm | Walls | Infill | Brim | CAD cm³ | Material / mass | 1.75 mm filament | Time |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| [p1_rear_front_frame](stl/p1_rear_front_frame.stl) | 158.4 × 92 × 15.62 | 5 | 25% | 3 mm | 39.56 | PETG: 47.0–55.3 g | 15.4–18.1 m | 182–214 min |
| [p1_rear_back_plate](stl/p1_rear_back_plate.stl) | 158.4 × 86.8 × 21.3 | 6 | 30% | 3 mm | 26.05 | PETG: 30.9–36.4 g | 10.1–11.9 m | 120–141 min |
| [p1_rear_fit_ring](stl/p1_rear_fit_ring.stl) | 158.4 × 77.6 × 2 | 3 | 15% | 0 mm | 2.51 | PETG: 3.0–3.5 g | 1.0–1.1 m | 12–14 min |
| [p1_front_front_frame](stl/p1_front_front_frame.stl) | 158.4 × 92 × 19.22 | 5 | 25% | 3 mm | 27.97 | PETG: 33.2–39.1 g | 10.9–12.8 m | 129–152 min |
| [p1_front_back_plate](stl/p1_front_back_plate.stl) | 158.4 × 86.8 × 21.3 | 6 | 30% | 3 mm | 26.05 | PETG: 30.9–36.4 g | 10.1–11.9 m | 120–141 min |
| [p1_front_fit_ring](stl/p1_front_fit_ring.stl) | 158.4 × 77.6 × 2 | 3 | 15% | 0 mm | 2.13 | PETG: 2.5–3.0 g | 0.8–1.0 m | 10–12 min |
| [p1_mount_test](stl/p1_mount_test.stl) | 32 × 34 × 21.5 | 6 | 100% | 3 mm | 4.90 | PETG: 5.8–6.8 g | 1.9–2.2 m | 23–27 min |
| [p2_base](stl/p2_base.stl) | 170 × 78 × 37 | 5 | 20% | 5 mm | 74.71 | PETG: 88.7–104.4 g | 29.0–34.2 m | 344–405 min |
| [p2_lid](stl/p2_lid.stl) | 158 × 78 × 28.65 | 5 | 25% | 3 mm | 30.73 | PETG: 36.5–42.9 g | 11.9–14.1 m | 141–166 min |
| [p3_tray](stl/p3_tray.stl) | 32.9 × 48.4 × 3.8 | 4 | 25% | 3 mm | 2.85 | PETG: 3.4–4.0 g | 1.1–1.3 m | 13–15 min |
| [p3_hood](stl/p3_hood.stl) | 32.9 × 22.35 × 48.4 | 4 | 25% | 5 mm | 12.55 | PETG: 14.9–17.5 g | 4.9–5.7 m | 58–68 min |
| [rail_fit_test](stl/rail_fit_test.stl) | 32 × 35.62 × 10.04 | 4 | 100% | 0 mm | 3.22 | PETG: 3.8–4.5 g | 1.3–1.5 m | 15–17 min |
| [universal_phone_plate](stl/universal_phone_plate.stl) | 128 × 55.154 × 54.447 | 6 | 25% | 8 mm | 27.86 | PLA: 32.3–38.0 g | 10.8–12.7 m | 68–80 min |
| [lcd1602_pod](stl/lcd1602_pod.stl) | 87 × 46 × 31.361 | 4 | 25% | 3 mm | 6.82 | PLA: 7.9–9.3 g | 2.7–3.1 m | 36–42 min |

## Orientation and finishing

| Part | Bed orientation | Finishing |
|---|---|---|
| lcd1602_pod | Flat H-shaped base down, all four inclined peg posts upward, exactly as supplied. | Clear strap and wire guides; dry-fit PCB before four tiny glue caps. Do not bend pegs. |
| universal_phone_plate | KEEP the supplied 45-degree lean; three flat starting lands on the bed. Do not lay either broad face flat. | Remove brim; smooth phone-contact edges and clear the M5 bore gently. Do not flex PLA ears. Use 0.20–0.24 mm layers. |
| p1_rear_front_frame | Outward camera face down; cavity and rigid rails upward. | Clear both rail channels and the two narrow band grooves. |
| p1_front_front_frame | Outward screen rim down; cavity and rigid rails upward. | Clear both rails, both band grooves and the button relief. |
| p1_rear_back_plate | Flat phone-side face down; GoPro ears upward. | Clear tongue edges and the M5 hole; retain the square end-stop surfaces. |
| p1_front_back_plate | Flat phone-side face down; GoPro ears upward. | Same plate geometry as rear mode; fit the selected shell. |
| p1_rear_fit_ring | Thin camera-gauge web down. | Remove elephant foot before checking the phone and camera bar. |
| p1_front_fit_ring | Flat ring face down. | Check the phone outline without forcing it. |
| p1_mount_test | Flat rectangular foot down; ears upward. | Unchanged T1 geometry; Alan already passed the harness fit test. |
| p2_base | Broad flat bottom down; locating pegs upward. | Clear peg tips and exterior strap-guide shoulders. There are no floor strap slots. |
| p2_lid | Labelled outer face down; locating lips and both tall posts upward. | Clear the two hollow tips, lips and button hole. Dry-close before tightening straps; never force the PCB. |
| p3_tray | Broad bottom down; board seats and three locator pins upward. | Smooth board seats; remove burrs from pin chamfers and cable-tie slots. |
| p3_hood | CLOSED fingertip stop down; open finger entry upward. | Clear the three blind locator sockets and strap slots. J pockets are removed. |
| rail_fit_test | Both rigid pieces lie exactly as supplied; receiver backing and key base on bed. | Clear first-layer burrs, then slide square to the stop. No click should occur. |

The universal plate estimate assumes an 8 mm³/s average deposition rate plus 30% motion/cooling and 5 minutes for the brim: about 70–80 minutes. A 4 mm³/s profile takes about 2–2.5 hours. Check the slicer estimate; do not exceed the printer/filament flow limit to meet a time target. Its 4 mm ribs and 2 mm webs trade print time for PLA stiffness.

## Support-free details

- LCD pod: flat open base, four tapered support posts and 20-degree inclined locating pegs; no steeper-than-45-degree downward faces. Allow about 35–45 minutes with cooling for the small pegs. Four small glue caps touch only LCD PCB corner holes, never the Pi.
- Universal plate: deliberate 45-degree bed pose, 169.7 mm² flat starting lands, 8 mm brim. Diagonal window roofs exceed 45 degrees from the bed. Only the unchanged Ø5.2 M5 bore crowns need short bridging (2.6 mm flat roof within a 3 mm ear). Keep the GoPro ears and root solid with six walls. No temporary supports or folding are required.
- P1 frame rail lips grow at 45 degrees. Chest plates have no latch beams. GoPro holes keep their teardrop roofs. Each 0.4 mm-deep band groove has only a 2.8 mm span in the frame bed pose.
- P2 base has upright locating pegs, open ventilation slots and short port crowns: 6 mm USB-C / 4 mm microSD. Both external strap channels leave 1.8 mm walls. The underside is flat and has no hardware recesses or strap openings.
- P2 lid lies on its labelled face; two solid 6 mm stems with 2 mm root fillets grow upward, narrowing to 4 mm tips. Each tip has an upward-opening 2.4 mm blind relief and 0.8 mm walls. No supports, catch bridges or paddles are needed. Use a slow small-perimeter setting and adequate cooling at the tips.
- P3 tray pins grow vertically. G prints closed-tip-down; the small blind locator bores have less than a 3.3 mm span across the full fit sweep. Existing sensor and connector ramps remain unchanged.
- The optional rail receiver and backed tongue use the same bearing profile and layer directions as the case. No glue or band is needed to assess the slide fit.

## Assembly finish

Use four exterior rice-grain glue dots on the F/G seam. The optional LCD pod adds four tiny glue caps at its LCD PCB mounting holes only. No glue goes on the Pi: two lid posts limit board lift with a nominal 0.15 mm gap. Check the lid seats freely before strapping; lightly dress a high post tip if needed. There are no printed nut pockets to load and no J clips to fit. Use two 32–35 cm whole-stack relay straps and two narrow bodycam rubber bands. See ASSEMBLY_ORDER.md for the exact one-action steps.

Physical fit, glue adhesion, strap friction and phone retention still require the real build tests.
