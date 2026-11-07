include <../p2_relay.scad>
translate([oled_x+(oled_w-oled_active_w)/2,oled_y+oled_active_y-oled_active_l/2,oled_z+oled_depth+0.03])cube([oled_active_w,oled_active_l,0.06]);
