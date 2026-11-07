include <../common.scad>
// Envelope and visual ring parameters are named in common.scad.
// Origin is panel OUTER face; positive z points toward user.
module button_hban(panel_t=button_reference_panel_t){
 color([0.55,0.57,0.59])translate([0,0,-button_body_depth])cylinder(d=button_body_d,h=button_body_depth);
 color([0.65,0.67,0.69])cylinder(d=button_head_d,h=button_head_h);
 color(signal_red)translate([0,0,button_head_h])difference(){cylinder(d=button_ring_outer_d,h=button_ring_t);translate([0,0,-eps])cylinder(d=button_ring_inner_d,h=2*button_ring_t);}
 color([0.44,0.46,0.48])translate([0,0,-panel_t-button_nut_h])cylinder(d=button_nut_af/cos(30),h=button_nut_h,$fn=6);
 color([0.06,0.06,0.07])translate([-button_plug_w/2,-button_plug_w/2,-button_plug_depth])cube([button_plug_w,button_plug_w,button_plug_depth-button_body_depth]);
}
button_hban();
