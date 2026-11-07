include <../common.scad>
// All PCB/package/connector envelopes are named in common.scad.
module max30101(){
 color([0.8,0.04,0.055])difference(){cube([sensor_board,sensor_board,sensor_pcb]); for(x=[sensor_hole_inset,sensor_board-sensor_hole_inset],y=[sensor_hole_inset,sensor_board-sensor_hole_inset])translate([x,y,-eps])cylinder(d=sensor_hole_d,h=sensor_pcb+2*eps);}
 color([0.1,0.1,0.12])translate([(sensor_board-sensor_w)/2,sensor_board-sensor_top_offset-sensor_l/2,sensor_pcb])cube([sensor_w,sensor_l,sensor_h]);
 color([0.15,0.03,0.05])translate([sensor_board/2-sensor_optical_size[0]/2,sensor_board-sensor_top_offset-sensor_optical_size[1]/2,sensor_pcb+sensor_h])cube(sensor_optical_size);
 color([0.07,0.07,0.08])for(x=[-sensor_connector_overhang,sensor_board-qwiic_w+sensor_connector_overhang])translate([x,(sensor_board-qwiic_l)/2,sensor_pcb])cube([qwiic_w,qwiic_l,qwiic_h]);
 // Low component envelope estimated from photo. No soldered bottom header assumed.
 color([0.14,0.14,0.15])translate([sensor_ic_pos[0],sensor_ic_pos[1],sensor_pcb])cube(sensor_ic_size);
}
max30101();
