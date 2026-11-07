#!/usr/bin/env python3
"""Volume-based no-snap print plan; no slicer is installed."""
from pathlib import Path
import json,math
R=Path(__file__).resolve().parent
d=json.loads((R/'checks/report.json').read_text());assert d['passed']
settings={
'p1_rear_front_frame':(5,25,3,'Outward camera face down; cavity and rigid rails upward.','Clear both rail channels and the two narrow band grooves.'),
'p1_front_front_frame':(5,25,3,'Outward screen rim down; cavity and rigid rails upward.','Clear both rails, both band grooves and the button relief.'),
'p1_rear_back_plate':(6,30,3,'Flat phone-side face down; GoPro ears upward.','Clear tongue edges and the M5 hole; retain the square end-stop surfaces.'),
'p1_front_back_plate':(6,30,3,'Flat phone-side face down; GoPro ears upward.','Same plate geometry as rear mode; fit the selected shell.'),
'p1_rear_fit_ring':(3,15,0,'Thin camera-gauge web down.','Remove elephant foot before checking the phone and camera bar.'),
'p1_front_fit_ring':(3,15,0,'Flat ring face down.','Check the phone outline without forcing it.'),
'p1_mount_test':(6,100,3,'Flat rectangular foot down; ears upward.','Unchanged T1 geometry; Alan already passed the harness fit test.'),
'p2_base':(5,20,5,'Broad flat bottom down; locating pegs upward.','Clear peg tips and exterior strap-guide shoulders. There are no floor strap slots.'),
'p2_lid':(5,25,3,'Labelled outer face down; rigid locating lips upward.','Clear lips and the button hole. No springs, catches or OLED features at default.'),
'p3_tray':(4,25,3,'Broad bottom down; board seats and three locator pins upward.','Smooth board seats; remove burrs from pin chamfers and cable-tie slots.'),
'p3_hood':(4,25,5,'CLOSED fingertip stop down; open finger entry upward.','Clear the three blind locator sockets and strap slots. J pockets are removed.'),
'rail_fit_test':(4,100,0,'Both rigid pieces lie exactly as supplied; receiver backing and key base on bed.','Clear first-layer burrs, then slide square to the stop. No click should occur.'),
}
lines=['# Print settings — no-snap HANDOFF','',
'Use a **0.4 mm nozzle**, **0.20 mm layers**, 0.40–0.45 mm line width and six top/bottom layers. **Supports: none for every supplied part.** Keep the supplied orientation. PETG is recommended for A/B/C/D and the rail test; opaque PETG or PLA is suitable for F/G. No printed flexures remain.','',
'Use gyroid for partial infill and rectilinear at 100%. Keep GoPro ears solid with a modifier if necessary. Put any brim outside mating faces, then remove it fully. Do not scale STLs to change a fit. Use the filament maker’s profile.','',
'No slicer is installed. Estimates use 85–100% of CAD solid volume, 10% filament allowance, PETG density 1.27 g/cm³, 4 mm³/s average extrusion and 30% motion/cooling allowance. They are planning estimates, not measured print times. The optional backed rail pair is about **15–18 minutes**; the snap coupon T3 and J clips are retired.','',
'| STL | Bed bounds, mm | Walls | Infill | Brim | CAD cm³ | PETG | 1.75 mm filament | Time |','|---|---|---:|---:|---:|---:|---:|---:|---:|']
for x in d['parts']:
 n=x['name'];walls,infill,brim,ori,post=settings[n];v=x['volume_mm3'];g=v/1000*1.27*1.1;m=v/(math.pi*.875**2)/1000*1.1;mins=v/4/60*1.3
 lines.append(f"| [{n}](stl/{n}.stl) | {' × '.join(f'{q:g}' for q in x['dimensions_mm'])} | {walls} | {infill}% | {brim} mm | {v/1000:.2f} | {g*.85:.1f}–{g:.1f} g | {m*.85:.1f}–{m:.1f} m | {mins*.85:.0f}–{mins:.0f} min |")
lines+=['','## Orientation and finishing','','| Part | Bed orientation | Finishing |','|---|---|---|']
for n,(_,_,_,ori,post) in settings.items():lines.append(f'| {n} | {ori} | {post} |')
lines+=['','## Support-free details','',
'- P1 frame rail lips grow at 45 degrees. Chest plates have no latch beams. GoPro holes keep their teardrop roofs. Each 0.4 mm-deep band groove has only a 2.8 mm span in the frame bed pose.',
'- P2 base has upright locating pegs, open ventilation slots and short port crowns: 6 mm USB-C / 4 mm microSD. Both external strap channels leave 1.8 mm walls. The underside is flat and has no hardware recesses or strap openings.',
'- P2 lid lies on its labelled face; 2 mm thick locating lips grow upward. No catch bridges or paddles remain.',
'- P3 tray pins grow vertically. G prints closed-tip-down; the small blind locator bores have less than a 3.3 mm span across the full fit sweep. Existing sensor and connector ramps remain unchanged.',
'- The optional rail receiver and backed tongue use the same bearing profile and layer directions as the case. No glue or band is needed to assess the slide fit.',
'','## Assembly finish','',
'Use four exterior rice-grain glue dots on the F/G seam and two small Pi mounting-hole caps. There are no printed nut pockets to load and no J clips to fit. Use two 32–35 cm whole-stack relay straps and two narrow bodycam rubber bands. See ASSEMBLY_ORDER.md for the exact one-action steps.','',
'Physical fit, glue adhesion, strap friction and phone retention still require the real build tests.','']
(R/'PRINT_SETTINGS.md').write_text('\n'.join(lines));print('Wrote PRINT_SETTINGS.md')
