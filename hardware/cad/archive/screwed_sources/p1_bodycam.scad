include <common.scad>
use <models/pixel9pro.scad>
use <models/gopro_buckle.scad>
// Export selectors. Every printable selector is already oriented on the bed.
camera_mode = "rear";         // "rear" preferred; "front" reverses phone, deeper back.
part = "assembly";            // front_frame, back_plate, fit_ring, mount_test, assembly, exploded.
face_t = 1.8;                 // Must remain below bar protrusion (rear lens sits proud).
face_gap = 0.4;               // Phone surface to retaining face.
ear_r = 4.2;                  // Four external screw lugs.
ear_inset = 8.0;              // Lug centre inset from phone ends.
ear_offset = 4.5;             // Lug centre outside short phone edge.
frame_lip = 1.4;              // Front screen retaining lip at nominal phone edge.
vent_w = 3.2;                 // Back heat slots. Flat face-down printing avoids bridges.
vent_pitch = 8.0;
vent_length = 47;
fit_ring_h = 2;               // Quick 2 mm outline and camera/screen aperture gauge.
fit_gauge_web = 0.6;          // Thin rear camera-window gauge crossbars.
brand_size = 6;
brand_x = -34;                 // Keeps all letters clear of the first vent.
brand_y = -24;
mount_test_plate = 2.0;
wear_tilt_deg = 15;             // Downward tilt used for approximate buckle fit check.
buckle_axis_h = 15;             // Approximate buckle hinge above its reference base.
// Secondary fit and layout dimensions; all distances in mm.
port_cut_extra = 1;           // Boolean reach through side wall, not phone clearance.
mic_cut_inset = 0.5;          // Start top mic cutter inside phone edge.
button_cut_inset = 1;         // Cut through front-mode sidewall completely.
button_end_clearance = 0.4;  // Clearance at BOTH ends of combined button cluster.
vent_x_start = -12;
vent_x_end = 28;
front_brand_inset = 1.4;     // Distance from frame outer edge to small label centre.
front_brand_size = 2.2;
fit_web_r = 3;              // Planar radius of camera-gauge web.
mount_test_l = 32;
mount_test_w = 34;
mount_test_r = 3;
exploded_gap = 26;          // Visual separation; has no manufacturing effect.
// Derived envelope; change the dimensions above/common.scad, not these formulas.
cavity_l=phone_l+2*phone_clearance;
cavity_w=phone_w+2*phone_clearance;
outer_l=cavity_l+2*wall;
outer_w=cavity_w+2*wall;
front_z=phone_t+face_gap;
outer_z=front_z+face_t;
joint_z= -face_gap-(camera_mode=="front" ? camera_bar_protrusion : 0);
plate_z=joint_z-face_t;
ear_x=phone_l/2-ear_inset;
ear_y=phone_w/2+ear_offset;
bar_x=phone_l/2-camera_bar_top-camera_bar_h/2;
assert(camera_mode=="rear" || camera_mode=="front");
assert(camera_margin>=2 && face_gap+face_t<camera_bar_protrusion,"Rear lens must stand proud of window wall");
assert(face_t+nut_bearing_web+nut_h<=assembly_screw_l,"P1 screw must engage full nut");
module p1_screw_positions(){for(x=[-ear_x,ear_x],y=[-ear_y,ear_y])translate([x,y,0])children();}
module p1_nut_webs(){p1_screw_positions()translate([0,0,joint_z])bearing_web();}
module p1_joint_hardware(){
 for(x=[-ear_x,ear_x],y=[-ear_y,ear_y]){
  translate([x,y,joint_z+nut_bearing_web])rotate([0,0,y>0?90:-90])hex_nut();
  translate([x,y,plate_z])assembly_screw();
 }
}
module p1_outline(h){union(){centered_box([outer_l,outer_w,h],phone_r+phone_clearance+wall);for(x=[-ear_x,ear_x],y=[-ear_y,ear_y])translate([x,y,0])cylinder(r=ear_r,h=h);}}
module p1_aperture(z,h,chamfer=true){
 if(camera_mode=="rear")translate([bar_x,camera_bar_side_offset,z]) hull(){
  centered_box([camera_bar_h+2*camera_margin,camera_bar_w+2*camera_margin,eps],camera_bar_h/2+camera_margin);
  translate([0,0,h-eps])centered_box([camera_bar_h+2*camera_margin+(chamfer?2*h:0),camera_bar_w+2*camera_margin+(chamfer?2*h:0),eps],camera_bar_h/2+camera_margin+(chamfer?h:0));
 }
 else translate([0,0,z])centered_box([phone_l-2*frame_lip,phone_w-2*frame_lip,h],phone_r-frame_lip);
}
module p1_frame_assembled(){difference(){
 translate([0,0,joint_z])p1_outline(outer_z-joint_z);
 translate([0,0,joint_z-eps])centered_box([cavity_l,cavity_w,front_z-joint_z+eps],phone_r+phone_clearance);
 p1_aperture(front_z-eps,face_t+2*eps);
 // Open-sided port slots reach the seam. Their roof prints directly on the bed.
 translate([-outer_l/2-eps,-phone_end_slot_width/2,joint_z-eps])cube([wall+phone_clearance+port_cut_extra,phone_end_slot_width,front_z-joint_z+eps]);
 translate([phone_l/2-mic_cut_inset,-phone_mic_slot_width/2,joint_z-eps])cube([wall+phone_clearance+port_cut_extra,phone_mic_slot_width,front_z-joint_z+eps]);
 translate([phone_l/2-phone_button_start-phone_button_length-button_end_clearance,camera_mode=="rear"?-outer_w/2-eps:phone_w/2-button_cut_inset,joint_z-eps])cube([phone_button_length+2*button_end_clearance,wall+phone_clearance+port_cut_extra,front_z-joint_z+eps]);
 for(x=[-ear_x,ear_x],y=[-ear_y,ear_y]){
  // Slide nut in from the outward lug edge; solid web faces chest-plate screw head.
  translate([x,y,joint_z+nut_bearing_web])rotate([0,0,y>0?90:-90])side_nut_pocket(ear_r+eps);
  translate([x,y,joint_z-eps])screw_bore(outer_z-joint_z+2*eps);
 }
 if(camera_mode=="rear")for(x=[vent_x_start:vent_pitch:vent_x_end])translate([x,-vent_length/2,front_z-eps])rounded_box([vent_w,vent_length,face_t+2*eps],vent_w/2);
 // Recess so the front frame can print outer face DOWN without loose text islands.
 translate([camera_mode=="rear"?brand_x:0,camera_mode=="rear"?brand_y:outer_w/2-front_brand_inset,outer_z-label_depth])label("HANDOFF",camera_mode=="rear"?brand_size:front_brand_size,label_depth+eps);
}}
module p1_back_assembled(){difference(){union(){
 translate([0,0,plate_z])p1_outline(face_t);
 translate([0,0,plate_z])rotate([180,0,0])gopro_two_prong();
 }
 for(x=[-ear_x,ear_x],y=[-ear_y,ear_y])translate([x,y,plate_z-eps])screw_bore(face_t+2*eps);
}}
module p1_phone(){if(camera_mode=="rear")pixel9pro();else translate([0,0,phone_t])rotate([180,0,0])pixel9pro();}
module p1_fit_ring(){difference(){union(){
 difference(){centered_box([outer_l,outer_w,fit_ring_h],phone_r+phone_clearance+wall);translate([0,0,-eps])centered_box([cavity_l,cavity_w,fit_ring_h+2*eps],phone_r+phone_clearance);}
 if(camera_mode=="rear")translate([bar_x,0,0])centered_box([camera_bar_h+2*camera_margin+2*wall,outer_w,fit_gauge_web],fit_web_r);
 }
 if(camera_mode=="rear")p1_aperture(-eps,fit_ring_h+2*eps,false);
}}
module p1_mount_test(){union(){centered_box([mount_test_l,mount_test_w,mount_test_plate],mount_test_r);translate([0,0,mount_test_plate])gopro_two_prong();}}
module p1_assembly(explode=0){
 color(graphite)translate([0,0,explode])p1_frame_assembled();
 color(graphite)translate([0,0,-explode])p1_back_assembled();
 p1_phone();
}
module p1_worn_body(){h=plate_z-gopro_axis_z;translate([0,0,h])rotate([wear_tilt_deg,0,0])translate([0,0,-h])p1_assembly();}
module p1_worn_buckle(){translate([0,0,plate_z-gopro_axis_z-buckle_axis_h])gopro_buckle();}
module p1_fit_ring_assembled(){translate([0,0,front_z])p1_fit_ring();}
if(part=="front_frame")translate([0,0,outer_z])rotate([180,0,0])p1_frame_assembled();
else if(part=="back_plate")translate([0,0,joint_z])rotate([180,0,0])p1_back_assembled();
else if(part=="fit_ring")p1_fit_ring();
else if(part=="mount_test")p1_mount_test();
else if(part=="exploded")p1_assembly(exploded_gap);
else if(part=="assembly")p1_assembly();
