#!/usr/bin/env python3
"""Volume-based no-snap print plan; no slicer is installed."""
from pathlib import Path
import json,math
R=Path(__file__).resolve().parent
d=json.loads((R/'checks/report.json').read_text());assert d['passed']
settings={
'lcd1602_pod':(4,25,3,'Flat H-shaped base down, all four inclined peg posts upward, exactly as supplied.','Clear strap and wire guides; dry-fit PCB before four tiny glue caps. Do not bend pegs.'),
'universal_phone_plate':(6,25,8,'KEEP the supplied 45-degree lean; three flat starting lands on the bed. Do not lay either broad face flat.','Remove brim; smooth phone-contact edges and clear the M5 bore gently. Do not flex PLA ears. Use 0.20–0.24 mm layers.'),
'p1_rear_front_frame':(5,25,3,'Outward camera face down; cavity and rigid rails upward.','Clear both rail channels and the two narrow band grooves.'),
'p1_front_front_frame':(5,25,3,'Outward screen rim down; cavity and rigid rails upward.','Clear both rails, both band grooves and the button relief.'),
'p1_rear_back_plate':(6,30,3,'Flat phone-side face down; GoPro ears upward.','Clear tongue edges and the M5 hole; retain the square end-stop surfaces.'),
'p1_front_back_plate':(6,30,3,'Flat phone-side face down; GoPro ears upward.','Same plate geometry as rear mode; fit the selected shell.'),
'p1_rear_fit_ring':(3,15,0,'Thin camera-gauge web down.','Remove elephant foot before checking the phone and camera bar.'),
'p1_front_fit_ring':(3,15,0,'Flat ring face down.','Check the phone outline without forcing it.'),
'p1_mount_test':(6,100,3,'Flat rectangular foot down; ears upward.','Unchanged T1 geometry; Alan already passed the harness fit test.'),
'p2_base':(5,20,5,'Broad flat bottom down; locating pegs upward.','Clear peg tips and exterior strap-guide shoulders. There are no floor strap slots.'),
'p2_lid':(5,25,3,'Labelled outer face down; locating lips and both tall posts upward.','Clear the two hollow tips, lips and button hole. Dry-close before tightening straps; never force the PCB.'),
'p3_tray':(4,25,3,'Broad bottom down; board seats and three locator pins upward.','Smooth board seats; remove burrs from pin chamfers and cable-tie slots.'),
'p3_hood':(4,25,5,'CLOSED fingertip stop down; open finger entry upward.','Clear the three blind locator sockets and strap slots. J pockets are removed.'),
'rail_fit_test':(4,100,0,'Both rigid pieces lie exactly as supplied; receiver backing and key base on bed.','Clear first-layer burrs, then slide square to the stop. No click should occur.'),
}
lines=['# Print settings — no-snap HANDOFF','',
'Use a **0.4 mm nozzle**, **0.20 mm layers**, 0.40–0.45 mm line width and six top/bottom layers. **Supports: none for every supplied part.** Keep the supplied orientation. The optional universal_phone_plate uses **PLA**, 0.20–0.24 mm layers and an 8 mm brim. The optional lcd1602_pod uses **PLA**, 0.20 mm layers, four walls and a 3 mm brim. PETG is recommended for the original A/B/C/D and the rail test; opaque PETG or PLA is suitable for F/G. No printed flexures remain.','',
'Use gyroid for partial infill and rectilinear at 100%. Keep GoPro ears solid with a modifier if necessary. Put any brim outside mating faces, then remove it fully. Do not scale STLs to change a fit. Use the filament maker’s profile.','',
'No slicer is installed. Estimates use 85–100% of CAD solid volume, 10% filament allowance, PETG density 1.27 g/cm³, 4 mm³/s average extrusion and 30% motion/cooling allowance. They are planning estimates, not measured print times; minimum-layer cooling on the narrow posts can add time. The optional backed rail pair is about **15–18 minutes**; the snap coupon T3 and J clips are retired.','',
'| STL | Bed bounds, mm | Walls | Infill | Brim | CAD cm³ | Material / mass | 1.75 mm filament | Time |','|---|---|---:|---:|---:|---:|---:|---:|---:|']
for x in d['parts']:
 n=x['name'];walls,infill,brim,ori,post=settings[n];v=x['volume_mm3'];mat='PLA' if n in ('universal_phone_plate','lcd1602_pod') else 'PETG';density=1.24 if mat=='PLA' else 1.27;flow=8 if n=='universal_phone_plate' else 4;g=v/1000*density*1.1;m=v/(math.pi*.875**2)/1000*1.1;mins=v/flow/60*1.3+(5 if mat=='PLA' else 0)
 lines.append(f"| [{n}](stl/{n}.stl) | {' × '.join(f'{q:g}' for q in x['dimensions_mm'])} | {walls} | {infill}% | {brim} mm | {v/1000:.2f} | {mat}: {g*.85:.1f}–{g:.1f} g | {m*.85:.1f}–{m:.1f} m | {mins*.85:.0f}–{mins:.0f} min |")
lines+=['','## Orientation and finishing','','| Part | Bed orientation | Finishing |','|---|---|---|']
for n,(_,_,_,ori,post) in settings.items():lines.append(f'| {n} | {ori} | {post} |')
lines+=['','The universal plate estimate assumes an 8 mm³/s average deposition rate plus 30% motion/cooling and 5 minutes for the brim: about 70–80 minutes. A 4 mm³/s profile takes about 2–2.5 hours. Check the slicer estimate; do not exceed the printer/filament flow limit to meet a time target. Its 4 mm ribs and 2 mm webs trade print time for PLA stiffness.','', '## Support-free details','',
'- LCD pod: flat open base, four tapered support posts and 20-degree inclined locating pegs; no steeper-than-45-degree downward faces. Allow about 35–45 minutes with cooling for the small pegs. Four small glue caps touch only LCD PCB corner holes, never the Pi.',
'- Universal plate: deliberate 45-degree bed pose, 169.7 mm² flat starting lands, 8 mm brim. Diagonal window roofs exceed 45 degrees from the bed. Only the unchanged Ø5.2 M5 bore crowns need short bridging (2.6 mm flat roof within a 3 mm ear). Keep the GoPro ears and root solid with six walls. No temporary supports or folding are required.',
'- P1 frame rail lips grow at 45 degrees. Chest plates have no latch beams. GoPro holes keep their teardrop roofs. Each 0.4 mm-deep band groove has only a 2.8 mm span in the frame bed pose.',
'- P2 base has upright locating pegs, open ventilation slots and short port crowns: 6 mm USB-C / 4 mm microSD. Both external strap channels leave 1.8 mm walls. The underside is flat and has no hardware recesses or strap openings.',
'- P2 lid lies on its labelled face; two solid 6 mm stems with 2 mm root fillets grow upward, narrowing to 4 mm tips. Each tip has an upward-opening 2.4 mm blind relief and 0.8 mm walls. No supports, catch bridges or paddles are needed. Use a slow small-perimeter setting and adequate cooling at the tips.',
'- P3 tray pins grow vertically. G prints closed-tip-down; the small blind locator bores have less than a 3.3 mm span across the full fit sweep. Existing sensor and connector ramps remain unchanged.',
'- The optional rail receiver and backed tongue use the same bearing profile and layer directions as the case. No glue or band is needed to assess the slide fit.',
'','## Assembly finish','',
'Use four exterior rice-grain glue dots on the F/G seam. The optional LCD pod adds four tiny glue caps at its LCD PCB mounting holes only. No glue goes on the Pi: two lid posts limit board lift with a nominal 0.15 mm gap. Check the lid seats freely before strapping; lightly dress a high post tip if needed. There are no printed nut pockets to load and no J clips to fit. Use two 32–35 cm whole-stack relay straps and two narrow bodycam rubber bands. See ASSEMBLY_ORDER.md for the exact one-action steps.','',
'Physical fit, glue adhesion, strap friction and phone retention still require the real build tests.','']
(R/'PRINT_SETTINGS.md').write_text('\n'.join(lines));print('Wrote PRINT_SETTINGS.md')
