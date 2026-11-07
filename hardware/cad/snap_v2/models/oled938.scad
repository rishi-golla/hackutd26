include <../common.scad>
// All PCB, glass and connector dimensions are named in common.scad.
module oled938(){
 color([0.025,0.11,0.17])difference(){rounded_box([oled_w,oled_l,oled_pcb],oled_corner_r);for(x=oled_hole_x,y=oled_hole_y)translate([x,y,-eps])cylinder(d=oled_hole_d,h=oled_pcb+2*eps);}
 color([0.025,0.03,0.04])translate([(oled_w-oled_glass_w)/2,oled_glass_y,oled_pcb])cube([oled_glass_w,oled_glass_l,oled_depth-oled_pcb]);
 color([0.06,0.18,0.23])translate([(oled_w-oled_active_w)/2,oled_active_y-oled_active_l/2,oled_depth])cube([oled_active_w,oled_active_l,oled_visual_t]);
 color([0.08,0.08,0.09])for(x=[0,oled_w-oled_connector_w])translate([x,oled_connector_y,-oled_back_depth])cube([oled_connector_w,oled_connector_l,oled_back_depth]);
}
oled938();
