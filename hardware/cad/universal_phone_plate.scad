include <common.scad>
// Universal backup only: original A/B and the T1-tested mount dimensions stay unchanged.
// Assembly axes: X = phone landscape length, Y = upright width, Z = toward chest.
// Phone contact is Z=0; its outward surface is negative Z. Bottom edge rests at Y=-28.
part = "plate";               // plate = supplied tilted bed pose; assembly = design coordinates.
nu_length = 128;               // Phone may overhang both ends; supports 131–164 mm phone lengths.
nu_bottom = -42;               // Lower band edge, 14 mm below the phone's support plane.
nu_top = 32;                   // Larger phones overhang the top; bands wrap the phone itself.
nu_web = 2.0;                  // Continuous webs; four-mm perimeter and centre ribs carry bending.
nu_rib = 4.0;                  // Stiff PLA spine/perimeter thickness.
nu_rim = 8;                    // Width of perimeter ribs around the lightening windows.
nu_spine = 28;                 // Solid centre spine under the mount.
nu_ledge_x = [-54,54];         // Short corner supports leave the central long edge open for buttons.
nu_ledge_w = 12;
nu_phone_bottom = -28;         // Phone bottom long edge rests here; no lip presses the outward face.
nu_ledge_wall = 2.4;
nu_ledge_reach = 12.6;         // Supports phones/cases 7–12 mm thick, including thin optional padding.
nu_band_x = [-44,-24,24,44];   // Four independent positions; choose two or three away from cameras/buttons.
nu_notch_w = 14;              // Takes bands or hook-and-loop up to 13 mm wide.
nu_notch_depth = 2.0;
nu_root_fillet = 1.6;         // True concave root radius outside the unchanged GoPro foot.
nu_bed_angle = 45;            // Deliberate support-free pose: bottom edge down, plate leaning 45 degrees.
nu_bed_cut = 2.0;             // Flat starting lands for adhesion, cut only below the phone-support area.
nu_pad_depth = 0.35;           // Shallow phone-side tape recesses; optional thin felt/foam, <=0.5 mm proud.
nu_pad_size = [14,20];
nu_window_half_w = 16;
nu_window_bottom = -19;
nu_window_shoulder = -3;
nu_window_peak = 21;          // Roof rises 24 mm over 16 mm: >45 degrees in the tilted bed pose.
nu_phone_length = 152;        // Render/check reference; not a fitted cavity.
nu_phone_width = 72;
nu_phone_thickness = 9;
nu_reference_band_w = 6;
nu_reference_band_t = 1;
nu_face_z = -0.05;            // Reference contact gap only; no printed lip over the phone face.

nu_min_sum = nu_phone_bottom - nu_ledge_wall - nu_ledge_reach;
nu_bed_plane = (min(nu_bottom,nu_min_sum)+nu_bed_cut)/sqrt(2);
assert(nu_ledge_reach>=12 && nu_rib>=4 && nu_notch_w>=13.4);
assert((nu_window_peak-nu_window_shoulder)*cos(nu_bed_angle)>=nu_window_half_w);

module universal_windows(){for(s=[-1,1])translate([s*37,0,-20])linear_extrude(50)
 polygon([[-nu_window_half_w,nu_window_bottom],[nu_window_half_w,nu_window_bottom],[nu_window_half_w,nu_window_shoulder],[0,nu_window_peak],[-nu_window_half_w,nu_window_shoulder]]);}
module universal_notches(){for(x=nu_band_x){
 translate([x-nu_notch_w/2,nu_bottom-eps,-20])cube([nu_notch_w,nu_notch_depth+eps,50]);
 translate([x-nu_notch_w/2,nu_top-nu_notch_depth,-20])cube([nu_notch_w,nu_notch_depth+eps,50]);
}}
module universal_mount(){translate([0,0,nu_rib])gopro_two_prong();}
module universal_body(){difference(){
 union(){
  // Two-mm web with a four-mm perimeter, central spine and diagonals around the windows.
  translate([-nu_length/2,nu_bottom,0])cube([nu_length,nu_top-nu_bottom,nu_web]);
  difference(){
   translate([-nu_length/2,nu_bottom,0])cube([nu_length,nu_top-nu_bottom,nu_rib]);
   for(s=[-1,1])translate([s*37-19,nu_bottom+nu_rim,nu_web])cube([38,nu_top-nu_bottom-2*nu_rim,nu_rib+eps]);
  }
  // The ledges and plate each start on the bed in the tilted pose; no support undercuts.
  for(x=nu_ledge_x)translate([x-nu_ledge_w/2,nu_phone_bottom-nu_ledge_wall,-nu_ledge_reach])cube([nu_ledge_w,nu_ledge_wall,nu_ledge_reach+nu_web]);
  // Flared collar only below the original foot top, never inside the buckle mating region.
  for(i=[0:11])hull()for(j=[i,i+1])let(h=nu_root_fillet*j/12,d=nu_root_fillet-sqrt(max(0,nu_root_fillet*nu_root_fillet-pow(h-nu_root_fillet,2))))
   translate([0,0,nu_rib+h-eps])centered_box([gopro_foot_x+2*d,gopro_foot_y+2*d,eps*2],gopro_foot_r+d);
  universal_mount();
 }
 universal_windows();universal_notches();
 // Recessed, bounded tape seats avoid an abrasive raised rib against a phone screen.
 for(x=[-56,56])translate([x-nu_pad_size[0]/2,-nu_pad_size[1]/2,-eps])cube([nu_pad_size[0],nu_pad_size[1],nu_pad_depth+eps]);
}}
module universal_bed_transform(){translate([0,0,-nu_bed_plane])rotate([nu_bed_angle,0,0])children();}
module universal_plate(){difference(){
 universal_bed_transform()universal_body();
 translate([-200,-200,-100])cube([400,400,100]);
}}
module universal_assembled(){rotate([-nu_bed_angle,0,0])translate([0,0,nu_bed_plane])universal_plate();}
module universal_phone(l=nu_phone_length,w=nu_phone_width,t=nu_phone_thickness){translate([-l/2,nu_phone_bottom,nu_face_z-t])rounded_box([l,w,t],7);}
module universal_band_profile(w,t){polygon([[nu_bottom+nu_notch_depth,0],[nu_bottom+nu_notch_depth,nu_rib],[nu_top-nu_notch_depth,nu_rib],[nu_phone_bottom+w,nu_face_z],[nu_phone_bottom+w,nu_face_z-t],[nu_phone_bottom,nu_face_z-t]]);}
module universal_bands(l=nu_phone_length,w=nu_phone_width,t=nu_phone_thickness){for(x=[-44,24])translate([x-nu_reference_band_w/2,0,0])rotate([90,0,90])linear_extrude(nu_reference_band_w)difference(){
 offset(delta=nu_reference_band_t)universal_band_profile(w,t);
 universal_band_profile(w,t);
}}
module universal_generic_camera(){translate([nu_phone_length/2-18,nu_phone_bottom+nu_phone_width/2,nu_face_z-nu_phone_thickness-2])centered_box([14,48,2],3);}
if(part=="plate")universal_plate();
else if(part=="assembly"){color(graphite)universal_assembled();color([.03,.03,.03])universal_phone();color([.02,.02,.02])universal_bands();}
