include <../common.scad>
// All measured/illustrative phone dimensions are named in common.scad.
// Phone screen at z=0, rear at z=phone_t. Bar toward +X (portrait top).
module pixel9pro(detail=true){
 color([0.025,0.03,0.035]) centered_box([phone_l,phone_w,phone_t],phone_r);
 color([0.18,0.20,0.22]) translate([phone_l/2-camera_bar_top-camera_bar_h/2,camera_bar_side_offset,phone_t]) centered_box([camera_bar_h,camera_bar_w,camera_bar_protrusion],camera_bar_h/2);
 if(detail){
  color([0.025,0.04,0.06]) for(y=phone_lens_y) translate([phone_l/2-camera_bar_top-camera_bar_h/2,y,phone_t+camera_bar_protrusion]) cylinder(d=phone_lens_d,h=phone_detail_t);
  color([0.05,0.14,0.18]) translate([0,0,-phone_detail_t]) centered_box([phone_l-2*phone_screen_inset,phone_w-2*phone_screen_inset,phone_detail_t],phone_r-phone_screen_radius_inset);
 }
 // Conservative button envelope on portrait right edge (-Y in this orientation).
 color([0.12,0.13,0.15]) translate([phone_l/2-phone_button_start-phone_button_length,-phone_w/2-phone_button_depth,phone_button_z]) cube([phone_button_length,phone_button_depth,phone_button_h]);
}
pixel9pro();
