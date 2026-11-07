include </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/common.scad>
use </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/models/pi4.scad>

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
translate([pi_soc_pos[0],pi_soc_pos[1],pi_pcb]){cube([pi_soc_size[0],pi_soc_size[1],2]);for(y=[0:2.5:12.5])translate([0,y,2])cube([pi_soc_size[0],0.9,pi_heatsink_h-2]);}
