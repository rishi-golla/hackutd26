include <../p2_relay.scad>
translate([brand_xy[0],brand_xy[1],lid_top-label_depth+0.03])label("HANDOFF RELAY",brand_size,0.12);translate([button_x,mark_y,lid_top-label_depth+0.03])label("MARK",mark_size,0.12);p2_finger_mark(lid_top-label_depth+0.03,0.12);
