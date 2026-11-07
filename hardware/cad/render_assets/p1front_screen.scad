include <../p1_bodycam.scad>
translate([0,0,phone_t])rotate([180,0,0])translate([0,0,-phone_detail_t])centered_box([phone_l-2*phone_screen_inset,phone_w-2*phone_screen_inset,phone_detail_t],phone_r-phone_screen_radius_inset);
