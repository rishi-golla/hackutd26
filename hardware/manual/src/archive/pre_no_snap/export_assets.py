#!/usr/bin/env python3
"""Export render-only reference detail. Never modifies any printed CAD source or STL."""
from pathlib import Path
import subprocess,concurrent.futures,json
ROOT=Path(__file__).resolve().parent
CAD=ROOT.parents[1]/'cad'
OUT=ROOT/'assets';OUT.mkdir(exist_ok=True)
SCAD='/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD'
COMMON=f'include <{CAD}/common.scad>\nuse <{CAD}/models/pi4.scad>\n'
DETAIL='''
pitch=2.54;
pin_x0=pi_header_pos[0]+pitch/2;
pin_y0=pi_header_pos[1]+(pi_header_size[1]-pitch)/2;
module pins(){for(i=[0:19],j=[0:1])translate([pin_x0+i*pitch-.32,pin_y0+j*pitch-.32,pi_pcb+2.5])cube([.64,.64,6]);}
module header_base(){translate([pi_header_pos[0],pi_header_pos[1],pi_pcb])cube([pi_header_size[0],pi_header_size[1],2.5]);}
module shim_pcb(){difference(){
 translate([shim_pos[0],shim_pos[1],pi_pcb+shim_pos[2]])linear_extrude(shim_t)polygon([[0,0],[shim_w,0],[shim_w,8.6],[7.8,8.6],[7.8,shim_l],[0,shim_l]]);
 for(i=[0:2],j=[0:1])translate([pin_x0+i*pitch,pin_y0+j*pitch,pi_pcb+shim_pos[2]-.1])cylinder(d=.95,h=shim_t+.2);
}}
module shim_pads(){for(i=[0:2],j=[0:1])translate([pin_x0+i*pitch,pin_y0+j*pitch,pi_pcb+shim_pos[2]+shim_t])difference(){
 if(i==0 && j==0)translate([-.9,-.9,0])cube([1.8,1.8,.04]);else cylinder(d=1.8,h=.04);
 translate([0,0,-.1])cylinder(d=.95,h=.3);
}}
module shim_connector(){translate([shim_connector_pos[0],shim_connector_pos[1],pi_pcb+shim_pos[2]+shim_t])difference(){cube(shim_connector_size);translate([.7,-.1,.6])cube([shim_connector_size[0]-1.4,1.5,shim_connector_size[2]-1.1]);}}
'''
JOBS={'pi_board':'pi4_board();','pi_ports':'pi4_ports();','pi_header_base':'header_base();','pi_pins':'pins();','shim_pcb':'shim_pcb();','shim_pads':'shim_pads();','shim_connector':'shim_connector();', 'pi_cpu_sink':'translate([pi_soc_pos[0],pi_soc_pos[1],pi_pcb]){cube([pi_soc_size[0],pi_soc_size[1],2]);for(y=[0:2.5:12.5])translate([0,y,2])cube([pi_soc_size[0],0.9,pi_heatsink_h-2]);}'}
SPECIAL={
'p1_backup_band':('p1_bodycam.scad','p1_backup_band();'),
'p1_front_backup_band':('p1_bodycam.scad','camera_mode="front";p1_backup_band();'),
'p2_backup_strap':('p2_relay.scad','p2_backup_strap();'),
'p2_pi_glue':('p2_relay.scad','p2_pi_glue();'),
'p3_joint_glue':('p3_finger_clip.scad','p3_joint_glue();'),
'p2_base':('p2_relay.scad','p2_base();'),
'p2_lid':('p2_relay.scad','p2_lid();'),
'coupon_p1_receiver':('p1_bodycam.scad', 'p1_coupon_receiver();'),
'coupon_p1_key':('p1_bodycam.scad', 'p1_coupon_key();'),
'coupon_p2_receiver':('p2_relay.scad', 'p2_coupon_catch();'),
'coupon_p2_key':('p2_relay.scad', 'p2_coupon_lid();'),
'coupon_pi_receiver':('p2_relay.scad', 'p2_coupon_pi_receiver();'),
'coupon_pi_key':('p2_relay.scad', 'p2_coupon_pi_board();'),
'coupon_j_receiver':('p3_finger_clip.scad', 'p3_coupon_flange();'),
'coupon_j_key':('p3_finger_clip.scad', 'p3_joint_clip();'),

'p3_board_pcb':('p3_finger_clip.scad','translate([0,0,board_seat_z])difference(){cube([sensor_board,sensor_board,sensor_pcb]);for(x=[sensor_hole_inset,sensor_board-sensor_hole_inset],y=[sensor_hole_inset,sensor_board-sensor_hole_inset])translate([x,y,-eps])cylinder(d=sensor_hole_d,h=sensor_pcb+2*eps);}'),
'p3_components':('p3_finger_clip.scad','translate([0,0,board_seat_z+sensor_pcb]){translate([(sensor_board-sensor_w)/2,sensor_y-sensor_l/2,0])cube([sensor_w,sensor_l,sensor_h]);translate([sensor_ic_pos[0],sensor_ic_pos[1],0])cube(sensor_ic_size);}'),
'p3_clip_front':('p3_finger_clip.scad','translate([clip_x,clip_ys[0]+joint_clip_w/2,0])p3_joint_clip();'),
'p3_clip_rear':('p3_finger_clip.scad','translate([clip_x,clip_ys[1]+joint_clip_w/2,0])p3_joint_clip();'),
'p2_button_core':('p2_relay.scad','translate([button_x,button_y,lid_top]){translate([0,0,-button_body_depth])cylinder(d=button_body_d,h=button_body_depth);cylinder(d=button_head_d,h=button_head_h);}'),
'p2_button_nut':('p2_relay.scad','translate([button_x,button_y,lid_top-lid_t-button_nut_h])difference(){cylinder(d=button_nut_af/cos(30),h=button_nut_h,$fn=6);translate([0,0,-eps])cylinder(d=button_body_d,h=button_nut_h+2*eps);}'),
'p2_button_plug':('p2_relay.scad','translate([button_x-button_plug_w/2,button_y-button_plug_w/2,lid_top-button_plug_depth])cube([button_plug_w,button_plug_w,button_plug_depth-button_body_depth]);'),

}
def export(job):
 name,body=job;src=OUT/(name+'.scad');src.write_text((f'include <{CAD}/{SPECIAL[name][0]}>\n'+SPECIAL[name][1]) if name in SPECIAL else COMMON+DETAIL+body+'\n')
 r=subprocess.run([SCAD,'--backend=manifold','-D','part="none"','--export-format','binstl','-o',str(OUT/(name+'.stl')),str(src)],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr)
 print(name,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(export,(JOBS|{n:'' for n in SPECIAL}).items()))

# Export the same parameterized cable centreline used by the CAD collision checks.
route=OUT/'finger_route.scad';route.write_text(f'include <{CAD}/p2_relay.scad>\necho(finger_route_points());\n')
subprocess.run([SCAD,'-D','part="none"','-o',str(OUT/'finger_route.echo'),str(route)],check=True,capture_output=True)
points=json.loads((OUT/'finger_route.echo').read_text().split('ECHO: ')[1])
(OUT/'finger_route.json').write_text(json.dumps(points,indent=2)+'\n')
