include <../p2_relay.scad>
translate([button_x,button_y,lid_top+button_head_h+0.06])difference(){cylinder(d=16,h=0.1);translate([0,0,-eps])cylinder(d=13.5,h=0.2);}
