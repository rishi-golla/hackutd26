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
'lcd_vent_strip':('lcd1602_pod.scad','intersection(){p2_lid_skin();translate([75.5,19,37])cube([6.2,30,2.4]);}'),
'lcd_pod_base':('lcd1602_pod.scad','lcd_pod_base();'),
'lcd_pod_board':('lcd1602_pod.scad','lcd_pod_board();'),
'lcd_pod_bezel':('lcd1602_pod.scad','lcd_pod_bezel();'),
'lcd_pod_backpack':('lcd1602_pod.scad','lcd_pod_backpack();'),
'lcd_pod_pot':('lcd1602_pod.scad','lcd_pod_pot();'),
'lcd_pod_header':('lcd1602_pod.scad','lcd_pod_header();'),
'lcd_pod_female_ends':('lcd1602_pod.scad','lcd_pod_female_ends();'),
'lcd_pod_glue':('lcd1602_pod.scad','lcd_pod_glue();'),
'lcd_pod_stack_strap':('lcd1602_pod.scad','lcd_pod_stack_strap();'),
'lcd_pod_gpio_housings':('lcd1602_pod.scad','lcd_pod_gpio_housings();'),
'lcd_pod_bb_housings':('lcd1602_pod.scad','lcd_pod_bb_housings();'),
'lcd_pod_second_strap':('lcd1602_pod.scad','difference(){p2_backup_strap();p2_backup_strap(true);}'),

'universal_assembled':('universal_phone_plate.scad','universal_assembled();'),
'universal_phone':('universal_phone_plate.scad','universal_phone();'),
'universal_bands':('universal_phone_plate.scad','universal_bands();'),
'universal_camera':('universal_phone_plate.scad','universal_generic_camera();'),
'rail_receiver':('p1_bodycam.scad','p1_rail_test_receiver();'),
'rail_key':('p1_bodycam.scad','union(){p1_rail_test_key();translate([0,5,0])cube([28,6.6,4]);}'),
'p1_band_second':('p1_bodycam.scad','difference(){p1_backup_band();p1_backup_band(true);}'),
'p1_front_band_second':('p1_bodycam.scad','camera_mode="front";difference(){p1_backup_band();p1_backup_band(true);}'),
'p1_band_first':('p1_bodycam.scad','p1_backup_band(true);'),
'p1_front_band_first':('p1_bodycam.scad','camera_mode="front";p1_backup_band(true);'),
'p2_stack_strap_first':('p2_relay.scad','p2_backup_strap(true);'),
'p1_backup_band':('p1_bodycam.scad','p1_backup_band();'),
'p1_front_backup_band':('p1_bodycam.scad','camera_mode="front";p1_backup_band();'),
'p2_backup_strap':('p2_relay.scad','p2_backup_strap();'),
'p2_pi_posts':('p2_relay.scad','p2_pi_posts();'),
'p2_lid_skin':('p2_relay.scad','p2_lid_skin();'),
'pi_post_section_tip':('p2_relay.scad','intersection(){p2_pi_posts();translate([64,13.5,0])cube([11,6,40]);}'),
'pi_post_section_base':('p2_relay.scad','intersection(){p2_base();translate([64,13.5,0])cube([11,6,14]);}'),
'pi_post_section_board':('p2_relay.scad','intersection(){translate([pi_x,pi_y,pi_z])pi4_board();translate([64,13.5,8.9])cube([11,6,1.8]);}'),
'p3_joint_glue':('p3_finger_clip.scad','p3_joint_glue();'),
'p2_base':('p2_relay.scad','p2_base();'),
'p2_lid':('p2_relay.scad','p2_lid();'),

'p3_board_pcb':('p3_finger_clip.scad','translate([0,0,board_seat_z])difference(){cube([sensor_board,sensor_board,sensor_pcb]);for(x=[sensor_hole_inset,sensor_board-sensor_hole_inset],y=[sensor_hole_inset,sensor_board-sensor_hole_inset])translate([x,y,-eps])cylinder(d=sensor_hole_d,h=sensor_pcb+2*eps);}'),
'p3_components':('p3_finger_clip.scad','translate([0,0,board_seat_z+sensor_pcb]){translate([(sensor_board-sensor_w)/2,sensor_y-sensor_l/2,0])cube([sensor_w,sensor_l,sensor_h]);translate([sensor_ic_pos[0],sensor_ic_pos[1],0])cube(sensor_ic_size);}'),
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

# LCD routes mirror the CAD collision witnesses; render-only JSON stays local.
lcd=OUT/'lcd_routes.scad';lcd.write_text(f'use <{CAD}/lcd1602_pod.scad>\necho([ [for(i=[0:3])lcd_pod_wire_route(i)], [for(i=[0:1])lcd_pod_gpio_route(i)] ]);\n')
subprocess.run([SCAD,'-o',str(OUT/'lcd_routes.echo'),str(lcd)],check=True,capture_output=True)
(OUT/'lcd_routes.json').write_text(json.dumps(json.loads((OUT/'lcd_routes.echo').read_text().split('ECHO: ')[1]),indent=2)+'\n')
