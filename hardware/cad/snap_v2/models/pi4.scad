include <../common.scad>
// All component envelope parameters are in common.scad.
module pi4_board(){ difference(){rounded_box([pi_l,pi_w,pi_pcb],pi_r); for(x=pi_hole_x,y=pi_hole_y)translate([x,y,-eps])cylinder(d=pi_hole_d,h=pi_pcb+2*eps);} }
module pi4_ports(){
 // Approximate footprints conservatively enclose official metal connector outlines.
 for(y=pi_usb_y) translate([pi_usb_x,y,pi_pcb]) cube([pi_l+pi_port_overhang-pi_usb_x,pi_usb_w,pi_usb_h]);
 translate([pi_eth_x,pi_eth_y,pi_pcb]) cube([pi_l+pi_port_overhang-pi_eth_x,pi_eth_w,pi_eth_h]);
 translate([pi_usb_c_x-pi_usb_c_size[0]/2,-pi_usb_c_overhang,pi_pcb]) cube(pi_usb_c_size);
 for(x=pi_hdmi_x)translate([x-pi_hdmi_size[0]/2,-pi_hdmi_overhang,pi_pcb])cube(pi_hdmi_size);
 translate([pi_av_x-pi_av_size[0]/2,-pi_av_overhang,pi_pcb])cube(pi_av_size);
 translate(pi_sd_pos)cube(pi_sd_size);
}
module pi4_header(){translate([pi_header_pos[0],pi_header_pos[1],pi_pcb])cube([pi_header_size[0],pi_header_size[1],pi_header_h]);}
module pi4_heatsinks(){translate([pi_soc_pos[0],pi_soc_pos[1],pi_pcb])cube([pi_soc_size[0],pi_soc_size[1],pi_heatsink_h]); translate([pi_aux_sink_pos[0],pi_aux_sink_pos[1],pi_pcb])cube(pi_aux_sink_size);}
module qwiic_shim(){
 // Pins 1–6 at microSD end of header; conservative connector and PCB envelopes.
 color([0.8,0.07,0.08])translate([shim_pos[0],shim_pos[1],pi_pcb+shim_pos[2]])cube([shim_w,shim_l,shim_t]);
 color([0.05,0.05,0.05])translate([shim_connector_pos[0],shim_connector_pos[1],pi_pcb+shim_pos[2]+shim_t])cube(shim_connector_size);
}
module pi4(include_shim=true){ color([0.05,0.35,0.15])pi4_board();color([0.62,0.65,0.66])pi4_ports();color([0.04,0.04,0.05])pi4_header();color([0.17,0.19,0.2])pi4_heatsinks();if(include_shim)qwiic_shim(); }
pi4();
