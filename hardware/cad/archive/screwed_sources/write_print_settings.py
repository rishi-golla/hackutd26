#!/usr/bin/env python3
"""Refresh volume-based estimates after verify.py; no slicer claims."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent
report=json.loads((ROOT/'checks/report.json').read_text())
assert report['passed']
settings={
'p1_rear_front_frame':(5,25,'Outward camera face on bed; cavity upward, side-loading nut slots near seam.',3,'Slide four nuts into outward lug side slots, behind the 1.2 mm webs. Paint-fill HANDOFF red; clear aperture and screw bores.'),
'p1_front_front_frame':(5,25,'Outward screen rim on bed; cavity upward, side-loading nut slots near seam.',3,'Slide four nuts into outward lug side slots. Deburr screen lip and button relief; paint-fill HANDOFF recess.'),
'p1_rear_back_plate':(6,30,'Flat phone-side face on bed; GoPro ears upward.',3,'Deburr ear gap and M5 teardrop bore; trial-fit coupon first.'),
'p1_front_back_plate':(6,30,'Flat phone-side face on bed; GoPro ears upward.',3,'Same shape as rear back plate; installed deeper in front-camera shell.'),
'p1_rear_fit_ring':(3,15,'Thin camera gauge web on bed; outline ring upward.',0,'Remove brim/elephant foot before comparing the phone outline and bar.'),
'p1_front_fit_ring':(3,15,'Either flat ring face on bed, as supplied.',0,'Check internal dimensions without forcing it onto the phone.'),
'p1_mount_test':(6,100,'32 × 34 mm foot flat on bed; ears upward.',3,'Trial-fit the harness buckle and M5 thumbscrew; tune parameters, not force.'),
'p2_base':(5,20,'Broad external bottom on bed; cavity upward.',5,'Slide four lid nuts into corner side slots from box interior. Clear underside head counterbores; fit male-up spacers and nuts ABOVE Pi. Check female thread depth; keep every underside head recessed.'),
'p2_lid':(5,25,'Outside labelled face on bed; round OLED spacers and nut posts upward.',3,'Slide two retainer nuts into post side slots away from OLED, behind 1.2 mm webs. Paint-fill HANDOFF RELAY/MARK/FINGER; remove face burrs.'),
'p2_oled_retainer':(5,30,'Flat rear face on bed; four PCB contact pads upward.',0,'Smooth pads; verify they bear on PCB only; hand-tighten two M2.5×6 screws.'),
'p3_tray':(4,25,'Large bottom face on bed; PCB seats and four nut bosses upward.',3,'Insert four M2.5 nuts from below, against the 1.4 mm bearing roofs. Deburr seats and underside strain slots; heads enter from cradle above.'),
'p3_hood':(4,25,'CLOSED fingertip stop on bed; cradle axis vertical; open proximal entry upward.',5,'Smooth U cradle and strap slots; keep visor underside clean; thread black strap under visor and over finger. Seal sensor perimeter.'),
}
lines=['# Print settings — HANDOFF','',
'All supplied STLs are already bed-oriented and single connected watertight solids. Use a 0.4 mm nozzle, 0.20 mm layers (0.20 mm first layer), 0.42–0.45 mm line width, six top/bottom layers, and the filament manufacturer’s PETG/PLA temperature profile. **Supports: none for every part.** Do not auto-orient the hood or lid.','',
'Use PETG for P1/P2. Use opaque black PETG or PLA for P3; the estimates below use PETG density 1.27 g/cm³. Use gyroid for the listed infill percentages; the 100% mount coupon uses rectilinear. Add a 100% infill modifier over the GoPro ears/foot on either back plate if the slicer leaves any internal voids. Avoid excessive fan on loaded PETG ears; use the normal bridge settings for short holes.','',
'No slicer is installed. The numbers below are conservative **volume-based planning ranges**, not G-code predictions: 85–100% of the CAD solid volume is deposited (many thin shells become effectively solid), 10% extra filament allowance, 4 mm³/s average extrusion, and 30% time allowance for motion/slow layers. Real time depends on the printer, cooling, acceleration and material. Brim/purge usage is included only approximately.','',
'| STL | Bed bounds X × Y × Z (mm) | Walls | Infill | Brim | CAD solid cm³ | PETG estimate | Filament 1.75 mm | Time estimate |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|']
for p in report['parts']:
 n=p['name'];walls,infill,orientation,brim,post=settings[n];v=p['volume_mm3'];g=v/1000*1.27*1.10;meters=v/(3.14159265*.875**2)/1000*1.10;hours=v/4/3600*1.3
 lines.append(f"| [{n}.stl](stl/{n}.stl) | {' × '.join(f'{d:g}' for d in p['dimensions_mm'])} | {walls} | {infill}% | {brim} mm | {v/1000:.2f} | {g*.85:.1f}–{g:.1f} g | {meters*.85:.1f}–{meters:.1f} m | {hours*.85:.1f}–{hours:.1f} h |")
lines += ['', '## Bed orientation and finishing','', '| Part | Orientation | Finishing / assembly |','|---|---|---|']
for n,(walls,infill,orientation,brim,post) in settings.items():lines.append(f'| [{n} preview](../renders/{n}.png) | {orientation} | {post} |')
lines += ['', '## Why these orientations avoid supports','',
'- P1 frames print outward-face down. The side openings open upward from that face. Side-loaded nut traps retain 1.2 mm bearing webs; their roofs bridge at most 6.1 mm. Back plates print flat with vertical GoPro ears; the M5 hole has a 45-degree teardrop roof.',
'- P2 base has vertical walls. USB-C opening shoulders are 45 degrees with a 6 mm crown bridge; the microSD opening has a 4 mm crown bridge. Vent bridges are 3.2 mm. Screw-head counterbore ceilings span 5.4 mm; side-nut-slot roofs span at most 6.1 mm, leaving 1.2 mm bearing webs. The horizontal cable-tie eye has a teardrop roof. The carry loop and strap slots start on the bed.',
'- P2 lid prints labelled face down, so integral OLED spacers and outboard retainer posts grow straight upward. Retainer-post side slots bridge at most 6.1 mm under their 1.2 mm webs. Recessed label strokes bridge only a few millimetres. The retainer prints flat; its cable grooves are open upward.',
'- P3 cradle/visor prints on the closed fingertip end. Roof, curved channel and sidewalls grow along the bed normal. Screw flanges and local connector caps use 45-degree approach ramps. The central contact floor descends at 45 degrees. The wider footprint places the rear screw heads beyond the strap. Tray bottom-open nut pockets bridge at most 6.1 mm and retain 1.4 mm roofs. Wall strap slots bridge 2.2 mm in the cradle orientation; connector/pad features have short bridges of roughly 4 mm. No external loops or full-length rigid roof remain.',
'', '## Fit-first order','',
'1. Print the GoPro mount test and selected P1 fit ring. Check the actual phone, buckle and M5 screw before committing to the full bodycam.',
'2. Print the relay lid and retainer and check the actual OLED, its connector plugs, button and nut. The 0.386 mm nominal glass-to-spacer clearance is deliberately small: sand a spacer lightly if necessary, never force it against glass.',
'3. Print the base, fit recessed underside screws and male-up 6 mm spacers, and dry-fit the lid while checking the heatsink and plug gaps. Remove stringing from ports and small holes.',
'4. Print the finger parts in opaque material. Check the sensor face is flush, the board is held without bowing, the strap contacts the finger under the visor, and a relaxed palm-down hand retains sensor contact. Check light rejection after adding the opaque gasket.',
'', 'Nylon fasteners require only light finger torque. Smooth all edges against phone or finger, and check the GoPro joint under load over a soft surface before wearing it. Printing success and load strength have not been physically tested.','']
(ROOT/'PRINT_SETTINGS.md').write_text('\n'.join(lines))
print('Wrote PRINT_SETTINGS.md')
