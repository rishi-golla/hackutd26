include <common.scad>
use <models/pixel9pro.scad>
use <models/gopro_buckle.scad>
// Export selectors. Every printable selector is already oriented on the bed.
camera_mode = "rear";         // "rear" preferred; "front" reverses phone, deeper back.
part = "assembly";            // front_frame, back_plate, fit_ring, mount_test, assembly, exploded.
backup_band_y = 36.3;         // Narrow band runs along the long rim, clear of both optical openings.
backup_band_w = 2.4;          // Use a 2–2.4 mm rubber band; a 13 mm strap would cover the screen.
backup_groove_w = 2.8;
backup_groove_d = 0.4;        // Leaves 1.4 mm skin; shallow 2.8 mm bridge in frame bed pose.
backup_band_t = 1.2;          // Maximum reference thickness; tension gently, not phone-crushing tight.
face_t = 1.8;                 // Must remain below bar protrusion (rear lens sits proud).
face_gap = 0.4;               // Phone surface to retaining face.
rail_length = 136;             // Horizontal slide travel direction is the phone's LONG axis.
rail_flange_w = 4.6;           // Plate tongues outside the phone/button envelope.
rail_wall = 2.4;               // Solid C-rail back wall; primary mount-to-phone load path.
rail_depth = 4.5;              // Below mating plane; 45-degree lower rail lip.
rail_attach_h = 5.5;           // Rail connection above mating plane.
latch_length = 26;             // In-plane beam, root at X=70, free end at X=44.
latch_t = 1.6;                 // Four extrusion widths; flexes sideways, not through layers.
latch_root_x = 70;
latch_tip_x = latch_root_x-latch_length;
latch_hook = 1.2;              // Outward hook; both opposite hooks must be squeezed inward.
latch_hook_l = 3;
rail_stop_t = 2;               // Far end stop; plate enters from the +X end only.
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
rail_y=outer_w/2+rail_flange_w;
latch_inner_y=rail_y+2*snap_clearance+rail_wall+1.2;
latch_outer_y=latch_inner_y+latch_t;
rail_inner_y=rail_y+2*snap_clearance;
rail_outer_y=rail_inner_y+rail_wall;
latch_travel=latch_hook-snap_clearance+0.15;
assert(beam_strain(latch_t,latch_travel,latch_length)<snap_strain_limit,"P1 latch strain exceeds nominal limit");
bar_x=phone_l/2-camera_bar_top-camera_bar_h/2;
assert(camera_mode=="rear" || camera_mode=="front");
assert(camera_margin>=2 && face_gap+face_t<camera_bar_protrusion,"Rear lens must stand proud of window wall");
module p1_outline(h){centered_box([outer_l,outer_w,h],phone_r+phone_clearance+wall);}
// C sections are open at +X. The lower retaining lip grows at 45 degrees in bed pose.
module p1_rails(){for(side=[-1,1])scale([1,side,1])difference(){union(){
 translate([-rail_length/2-rail_stop_t,0,0])rotate([90,0,90])linear_extrude(rail_length+rail_stop_t)
 polygon([[outer_w/2-0.2,joint_z+snap_clearance],[rail_inner_y,joint_z+snap_clearance],[rail_inner_y-face_t-2*snap_clearance,joint_z-face_t-snap_clearance],[rail_inner_y-face_t-2*snap_clearance,joint_z-rail_depth],[rail_outer_y,joint_z-rail_depth],[rail_outer_y,joint_z+rail_attach_h],[outer_w/2-0.2,joint_z+rail_attach_h]]);
 translate([-rail_length/2-rail_stop_t,outer_w/2,joint_z-rail_depth-eps])cube([rail_stop_t-snap_clearance,rail_outer_y-outer_w/2+eps,rail_depth+rail_attach_h+2*eps]);
 // Two external latch fences join the rail above the plate. Beams stay outside the rails.
 translate([latch_tip_x-1,rail_outer_y-0.2,joint_z+snap_clearance])cube([latch_hook_l+2, latch_outer_y+snap_clearance+wall-rail_outer_y+0.2,rail_attach_h-snap_clearance]);
 translate([latch_tip_x-1,latch_outer_y+snap_clearance,joint_z-face_t-snap_clearance])cube([latch_hook_l+2,wall,face_t+2*snap_clearance+eps]);
 }
 translate([latch_tip_x-snap_clearance,latch_outer_y,joint_z-face_t-snap_clearance])cube([latch_hook_l+2*snap_clearance,wall+latch_hook+1,face_t+2*snap_clearance]);
}}
module p1_plate_tongues(){for(side=[-1,1])scale([1,side,1])union(){
 translate([-rail_length/2,0,0])rotate([90,0,90])linear_extrude(rail_length)
 polygon([[outer_w/2-1,plate_z+eps],[rail_y-face_t,plate_z+eps],[rail_y,joint_z-eps],[outer_w/2-1,joint_z-eps]]);
 // Root crossbar is beyond the open rail end, outside the phone-button envelope.
 translate([latch_root_x,outer_w/2-1,plate_z])cube([4,latch_outer_y-outer_w/2+1,face_t]);
 translate([latch_tip_x,latch_inner_y,plate_z])cube([latch_length+eps,latch_t,face_t]);
 translate([latch_tip_x,latch_outer_y,plate_z])linear_extrude(face_t)polygon([[0,-eps],[latch_hook_l,-eps],[latch_hook_l,latch_hook],[latch_hook,latch_hook]]);
}}
module p1_latch_shoulders(){for(side=[-1,1])scale([1,side,1])translate([latch_tip_x+latch_hook_l+snap_clearance,latch_outer_y+snap_clearance,plate_z])cube([0.4,latch_hook-snap_clearance,face_t]);}
module p1_aperture(z,h,chamfer=true){
 if(camera_mode=="rear")translate([bar_x,camera_bar_side_offset,z]) hull(){
  centered_box([camera_bar_h+2*camera_margin,camera_bar_w+2*camera_margin,eps],camera_bar_h/2+camera_margin);
  translate([0,0,h-eps])centered_box([camera_bar_h+2*camera_margin+(chamfer?2*h:0),camera_bar_w+2*camera_margin+(chamfer?2*h:0),eps],camera_bar_h/2+camera_margin+(chamfer?h:0));
 }
 else translate([0,0,z])centered_box([phone_l-2*frame_lip,phone_w-2*frame_lip,h],phone_r-frame_lip);
}
// Rectangular-section belt follows the rounded short ends at this narrow rim slice.
module p1_backup_shell(inset=0,outset=0){
 intersection(){
  translate([-outer_l,backup_band_y-backup_groove_w/2,plate_z-outset])cube([2*outer_l,backup_groove_w,outer_z-plate_z+2*outset]);
  difference(){
   translate([0,0,plate_z-outset])centered_box([outer_l+2*outset,outer_w+2*outset,outer_z-plate_z+2*outset],phone_r+phone_clearance+wall+outset);
   translate([0,0,plate_z+inset])centered_box([outer_l-2*inset,outer_w-2*inset,outer_z-plate_z-2*inset],phone_r+phone_clearance+wall-inset);
  }
 }
}
module p1_backup_groove(){p1_backup_shell(backup_groove_d,eps);}
module p1_backup_band(){intersection(){
 p1_backup_shell(backup_groove_d,backup_band_t-backup_groove_d);
 translate([-outer_l,backup_band_y-backup_band_w/2,plate_z-10])cube([2*outer_l,backup_band_w,outer_z-plate_z+20]);
}}
module p1_backup_access(){
 p1_aperture(front_z-eps,face_t+2*eps);
 translate([-outer_l/2-2,-phone_end_slot_width/2,joint_z])cube([5,phone_end_slot_width,front_z-joint_z]);
 translate([phone_l/2-phone_button_start-phone_button_length,camera_mode=="rear"?-outer_w/2-2:phone_w/2,0])cube([phone_button_length,5,phone_t]);
 for(side=[-1,1])scale([1,side,1])translate([latch_tip_x-2,latch_inner_y-2,plate_z-2])cube([latch_length+7,7,face_t+4]);
 translate([0,0,plate_z])rotate([180,0,0])gopro_two_prong();
}
module p1_frame_assembled(){difference(){
 union(){translate([0,0,joint_z])p1_outline(outer_z-joint_z);p1_rails();}
 translate([0,0,joint_z-eps])centered_box([cavity_l,cavity_w,front_z-joint_z+eps],phone_r+phone_clearance);
 p1_aperture(front_z-eps,face_t+2*eps);
 p1_backup_groove();
 // Open-sided port slots reach the seam. Their roof prints directly on the bed.
 translate([-outer_l/2-eps,-phone_end_slot_width/2,joint_z-eps])cube([wall+phone_clearance+port_cut_extra,phone_end_slot_width,front_z-joint_z+eps]);
 translate([phone_l/2-mic_cut_inset,-phone_mic_slot_width/2,joint_z-eps])cube([wall+phone_clearance+port_cut_extra,phone_mic_slot_width,front_z-joint_z+eps]);
 translate([phone_l/2-phone_button_start-phone_button_length-button_end_clearance,camera_mode=="rear"?-outer_w/2-eps:phone_w/2-button_cut_inset,joint_z-eps])cube([phone_button_length+2*button_end_clearance,wall+phone_clearance+port_cut_extra,front_z-joint_z+eps]);
 if(camera_mode=="rear")for(x=[vent_x_start:vent_pitch:vent_x_end])translate([x,-vent_length/2,front_z-eps])rounded_box([vent_w,vent_length,face_t+2*eps],vent_w/2);
 // Recess so the front frame can print outer face DOWN without loose text islands.
 translate([camera_mode=="rear"?brand_x:0,camera_mode=="rear"?brand_y:-outer_w/2+front_brand_inset,outer_z-label_depth])label("HANDOFF",camera_mode=="rear"?brand_size:front_brand_size,label_depth+eps);
}}
module p1_back_assembled(){difference(){union(){
 translate([0,0,plate_z])p1_outline(face_t);p1_plate_tongues();
 translate([0,0,plate_z])rotate([180,0,0])gopro_two_prong();
 }
 p1_backup_groove();
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
// Exact joint extracts for the tolerance coupon, in the production bed orientation.
module p1_coupon_receiver(){translate([-(latch_tip_x-5),latch_outer_y+snap_clearance+wall,joint_z+rail_attach_h])rotate([180,0,0])intersection(){p1_frame_assembled();translate([latch_tip_x-5,outer_w/2-1,joint_z-rail_depth-2*eps])cube([latch_length+10,20,rail_depth+rail_attach_h+2*eps]);}}
module p1_coupon_key(){translate([-(latch_tip_x-5),latch_outer_y+latch_hook,joint_z])rotate([180,0,0])intersection(){p1_back_assembled();translate([latch_tip_x-5,outer_w/2-1,plate_z-eps])cube([latch_length+10,20,face_t+2*eps]);}}

function p1_snap_metrics()=[["P1 squeeze latch",latch_t,latch_travel,latch_length,latch_hook-snap_clearance]];
