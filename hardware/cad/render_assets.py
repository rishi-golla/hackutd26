#!/usr/bin/env python3
"""Export coloured render layers from the same parametric CAD modules."""
from pathlib import Path
import subprocess,concurrent.futures
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'render_assets';OUT.mkdir(exist_ok=True)
SCAD='/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD'
JOBS={}
def job(name,file,body,defs=None):JOBS[name]=(file,body,defs or {})
for name,body in {
 'frame':'p1_frame_assembled();','back':'p1_back_assembled();',
 'phone':'centered_box([phone_l,phone_w,phone_t],phone_r);',
 'bar':'translate([bar_x,camera_bar_side_offset,phone_t])centered_box([camera_bar_h,camera_bar_w,camera_bar_protrusion],camera_bar_h/2);',
 'lenses':'for(y=[-19,0,19])translate([bar_x,y,phone_t+camera_bar_protrusion])cylinder(d=10,h=0.15);',
 'brand':'translate([brand_x,brand_y,outer_z-label_depth+0.03])label("HANDOFF",brand_size,0.12);',
 'screen':'translate([0,0,-0.05])centered_box([phone_l-4,phone_w-4,0.05],phone_r-1);',
 'buckle':'gopro_buckle();'
}.items():job('p1_'+name,'p1_bodycam.scad',body)
for name,body in {
 'frame':'p1_frame_assembled();','back':'p1_back_assembled();','phone':'p1_phone();',
 'screen':'translate([0,0,phone_t])rotate([180,0,0])translate([0,0,-phone_detail_t])centered_box([phone_l-2*phone_screen_inset,phone_w-2*phone_screen_inset,phone_detail_t],phone_r-phone_screen_radius_inset);',
 'brand':'translate([-outer_l/2+1.8,0,outer_z-label_depth+0.03])rotate([0,0,90])label("HANDOFF",front_brand_size,0.12);',
}.items():job('p1front_'+name,'p1_bodycam.scad',body,{'camera_mode':'front'})
for name,body in {
 'base' :'p2_base();','lid':'p2_lid();','glue':'p2_oled_glue();',
 'pi':'translate([pi_x,pi_y,pi_z])pi4_board();',
 'ports':'translate([pi_x,pi_y,pi_z])pi4_ports();',
 'header':'translate([pi_x,pi_y,pi_z])pi4_header();',
 'heatsinks':'translate([pi_x,pi_y,pi_z])pi4_heatsinks();',
 'shim':'p2_shim();','bread':'p2_bread();','oled':'p2_oled();','button':'p2_button();','bank':'p2_bank();',
 'straps':'p2_bank_straps();',
 'oledscreen':'translate([oled_x+(oled_w-oled_active_w)/2,oled_y+oled_active_y-oled_active_l/2,oled_z+oled_depth+0.03])cube([oled_active_w,oled_active_l,0.06]);',
 'buttonring':'translate([button_x,button_y,lid_top+button_head_h+0.06])difference(){cylinder(d=16,h=0.1);translate([0,0,-eps])cylinder(d=13.5,h=0.2);}',
 'brand':'translate([brand_xy[0],brand_xy[1],lid_top-label_depth+0.03])label("HANDOFF RELAY",brand_size,0.12);translate([button_x,mark_y,lid_top-label_depth+0.03])label("MARK",mark_size,0.12);p2_finger_mark(lid_top-label_depth+0.03,0.12);',
}.items():job('p2_'+name,'p2_relay.scad',body)
for name,body in {'tray':'p3_tray();','hood':'p3_hood();','board':'p3_board();','strap':'p3_strap();','finger':'p3_finger();',

 'sensor':'translate([(sensor_board-sensor_w)/2,sensor_board-sensor_top_offset-sensor_l/2,sensor_top_z])cube([sensor_w,sensor_l,0.1]);',
 'connectors':'for(x=[-0.5,sensor_board-qwiic_w+0.5])translate([x,(sensor_board-qwiic_l)/2,board_seat_z+sensor_pcb])cube([qwiic_w,qwiic_l,qwiic_h]);'}.items():job('p3_'+name,'p3_finger_clip.scad',body)
def export(item):
 name,(file,body,defs)=item
 src=OUT/(name+'.scad');src.write_text(f'include <../{file}>\n{body}\n')
 r=subprocess.run([SCAD,'--backend=manifold','--export-format','binstl','-D','part="none"','-o',str(OUT/(name+'.stl')),*[arg for key,val in defs.items() for arg in ['-D',key+'='+repr(val).replace("'",'"')]],str(src)],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(name+'\n'+r.stderr)
 return name
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for name in pool.map(export,JOBS.items()):print(name,flush=True)
