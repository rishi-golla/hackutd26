include <common.scad>
use <models/pi4.scad>
use <models/oled938.scad>
use <models/button_hban.scad>
use <models/powerbank.scad>
use <models/breadboard.scad>
with_backup_guides = true;     // Disable only for historical-lid regression; keep true for current prints.
with_oled = false;             // Optional legacy OLED lid; false is the current screen-free build.
part = "assembly";             // base, lid, assembly, exploded; print selectors bed-oriented.
backup_strap_x = 109.25;      // Between the existing bank strap, last vent and right latch roots.
backup_strap_w = 13;          // User-supplied maximum width.
backup_strap_t = 1.2;         // User-supplied maximum thickness.
backup_guide_w = 13.4;
backup_guide_d = 0.6;         // Opposite wall channels; 1.8 mm wall remains, bottom stays flat.
pi_glue_holes = [[1,0],[0,1]]; // Front/right and rear/left diagonal holes: >=2 mm to modeled components.
pi_glue_cap_d = 4.0;          // Approximate two rice-grain glue heads; reference only, not printed.
pi_glue_cap_h = 0.8;
box_l = 158;                    // Body length; separate carry loop adds 12 mm.
box_w = 78;                     // Allows cable/strap channels beside 56 mm Pi.
base_floor = 3.0;               // Flat underside; integral supports have no through-floor hardware.
inside_lid_z = 37;              // Height of lid underside above bottom of base.
lid_t = 2.4;
box_r = 5;
pi_x = 8;
pi_y = 10;
pi_support_h = 6;              // Integral pads preserve the accepted PCB height.
pi_peg_d = pi_hole_d-2*snap_clearance; // Plain locating pins, never interference-fit into PCB.
pi_peg_h = 1.4;                // Ends below PCB top; board lifts straight off after releasing clips.
pi_support_d = 5;
pi_z = base_floor+pi_support_h;
pi_clip_t = 0.8;               // Two extrusion widths; vertical beam bends away from PCB.
pi_clip_w = 4;
pi_clip_root_z = 0.8;          // Recessed isolation slot increases effective beam length; bottom stays closed.
pi_clip_gap = snap_clearance;
pi_clip_overlap = 0.65;        // Positive plan overlap over the component-free PCB edge.
pi_clip_head_h = 1.2;
pi_clip_z = pi_z+pi_pcb+snap_clearance;
pi_clip_top = pi_clip_z+pi_clip_overlap+pi_clip_head_h;
pi_clip_l = pi_clip_z-pi_clip_root_z;
pi_clip_deflect = pi_clip_overlap+0.15;
lid_latch_t = 1.2;             // In-plane lid beams: three extrusion widths.
lid_latch_l = 26;
lid_latch_w = lid_t;
lid_beam_y = wall+2*snap_clearance+1.2+1.0; // Behind the catch cheeks; free tip reaches outward.
lid_latch_tip_x = [48,142];
lid_latch_y = wall+snap_clearance;
lid_latch_overlap = 1.0;
lid_latch_bridge = 6;          // Short base catch bridge between two vertical cheeks.
lid_latch_top_gap = snap_clearance;
lid_latch_bridge_t = 1.2;
lid_latch_ramp_h = 1.5;
lid_latch_release_gap = 3.0;   // Inward travel + fingertip access beside beam.
lid_locating_depth = 3;
oled_x = 26;                   // Low Pi region, clear of right USB/Ethernet stacks.
oled_y = 17;
oled_support_h = 6;            // Printed ROUND spacers; hex hardware would hit glass.
oled_z = inside_lid_z-oled_support_h-oled_pcb;
oled_window_inset = 1.0;        // Full glass minus 1 mm each edge; active offset unknown.
oled_window_offset_y = 0;       // Additional measured window shift from glass centre.
oled_round_boss_d = 3.8;        // Clears glass by 0.386 mm at closest holes.
oled_rail_t = 1.6;             // PCB edge guides at header and distal edges; side connectors stay clear.
oled_slide_gap = snap_clearance;
oled_rail_x = [oled_x+8,oled_x+oled_w-12];
oled_rail_w = 4;
oled_glue_r = 0.9;             // Render envelope for two rice-grain glue dots, not a printed part.
button_x = 128;                 // Separate bay next to Pi, above no PCB.
button_y = 61;
bread_x = 105;
bread_y = 11;
bread_pocket_clearance = 0.5;   // PER SIDE; adhesive back rests on base floor.
bread_rim_h = 2;
bread_rim_t = 1.2;
strap_x = [36,96];             // Two straps wrap around the power bank in YZ plane.
strap_y = [3.2,74.8];          // Outside bank footprint; straps do not lie between flat faces.
strap_width = 13.4;             // User-supplied hook-and-loop, maximum 13 mm wide.
bank_strap_t = 0.8;            // Illustrative hook-and-loop thickness, routed around bank sides.
bank_strap_w = 13;
strap_gap = 2.8;                // Slot for strap thickness; open through base floor.
carry_extension = 12;
carry_width = 28;
carry_rim = 3;
usb_cut_w = 18;                 // Full aperture width; clear straight 15 x 10 mm overmolds.
usb_cut_h = 18;                 // Raised 45-degree crown clears tall straight plug corners.
usb_cut_z = 6;                  // Low edge of side opening; contains port at 10.6–13.8.
microsd_cut_w = 20;
microsd_cut_z = 4.0;
microsd_cut_h = 12;             // Height gives true 45-degree shoulders above card.
vent_slot_w = 3.2;
vent_slot_h = 14;
vent_pitch = 7;
vent_z = 16;
finger_exit_w = 8;              // Qwiic plug exit, open at seam, with zip-tie anchor.
finger_exit_x = 83;
finger_exit_bottom = 27;
strain_hole_d = 3.2;            // Two short vertical bores for zip tie.
strain_anchor_x = 68;          // Beside, not in, cable exit or bank strap path.
strain_anchor_y = 73.8;
strain_anchor_w = 14;
strain_anchor_h = 6;
brand_size = 5;
mark_size = 4;
// Secondary radii, openings and label layout. Tune after a measured fit check.
bread_rim_outer_r = 2;
bread_rim_inner_r = 1;
carry_outer_r = 3;
carry_inner_r = 1.2;
strap_corner_r = 0.5;
usb_cut_extra = 1;            // Boolean reach through side wall.
usb_crown_bridge = 6;         // Short horizontal crown of shaped port opening.
microsd_cut_y = 26;           // Port centre measured from Pi Y datum.
microsd_crown_bridge = 4;
microsd_shoulder_h = microsd_cut_h-(microsd_cut_w-microsd_crown_bridge)/2; // 45°.
front_vent_x = [43,74];       // Start/end of front sidewall slot series.
back_vent_x = [28,70];
strain_tie_z = 31;             // Horizontal teardrop lashing eye; no underside tie loop.
strain_hole_y_offset = 1.2;   // From anchor datum toward enclosure interior.
oled_window_r = 0.8;
lid_vent_x = [78,99];
lid_vent_y = 20;
lid_vent_l = 28;
brand_xy = [48,65];
mark_y = 45;
finger_label_xy = [finger_exit_x,71]; // Directly aligned with actual rear-wall notch.
finger_arrow_y = [74,77.3];
finger_arrow_w = 3;
finger_arrow_shaft = 0.7;
finger_arrow_head_l = 2;
finger_label_size = 2.8;
bank_gap = 0;                 // Bank rests flush against the unobstructed underside.
usb_plug_size = [15,24,10];   // Straight plastic overmold W x axial length x H; measure own cable.
usb_plug_max_size = [17,24,12]; // Largest jointly verified W/H gauge; only 0.2 mm lower clearance.
usb_plug_relief_l = 8;        // Illustrative straight strain-relief length, outside plastic body.
usb_plug_relief_d = 5;
usb_port_z = pi_z+pi_pcb+pi_usb_c_size[2]/2;
finger_plug_w = 5;           // Qwiic plug body envelope; mouth at front edge of SHIM socket.
finger_plug_l = 4;
finger_plug_h = 3;
finger_plug_x = pi_x+shim_connector_pos[0]+shim_connector_size[0]/2;
finger_socket_y = pi_y+shim_connector_pos[1];
finger_plug_z = pi_z+pi_pcb+shim_pos[2]+shim_t+shim_connector_size[2]/2;
finger_bundle_r = 1.1;       // Conservative round envelope enclosing the four fine conductors.
finger_bend_r = 10;          // Minimum plan-view bend radius on the routed service loop.
finger_internal_allowance = 120; // Leave 120 mm along cable from zip-tie grip to plug rear.
// Route begins at plug rear, bows toward USB-C wall, returns beside the header to the eye.
function finger_route_points() = concat(
 [[finger_plug_x,46,finger_plug_z],[finger_plug_x,28,finger_plug_z]],
 [for(a=[185:5:270]) [finger_plug_x+finger_bend_r+finger_bend_r*cos(a),28+finger_bend_r*sin(a),finger_plug_z+(30-finger_plug_z)*(1-cos(2*(a-180)))/2]],
 [[50,18,30]],
 [for(a=[-85:5:0]) [50+16*cos(a),34+16*sin(a),30]],
 [[66,60,30],[68,66,31]]
);
exploded_gap = 25;            // Visual spacing, not a fit dimension.
// Derived placement; top surface is the button's reference datum.
lid_top=inside_lid_z+lid_t;
assert(beam_strain(lid_latch_t,lid_latch_t+lid_latch_overlap+0.15,lid_latch_l)<snap_strain_limit,"P2 lid beam strain screen");
assert(beam_strain(pi_clip_t,pi_clip_deflect,pi_clip_l)<snap_strain_limit,"Pi clip strain screen");
module p2_latch_places(){for(x=lid_latch_tip_x,side=[0,1])translate([x,side?box_w:0,0])scale([1,side?-1:1,1])children();}
// Each base catch has two cheeks and a 6 mm bridge. All overhangs are ramps or that bridge.
// One continuous catch section avoids coincident cheek/ramp faces and STL slivers.
module p2_lid_catches(){p2_latch_places(){
 d=lid_latch_y+lid_latch_t+lid_latch_overlap;
 z=lid_top+lid_latch_top_gap+lid_latch_bridge_t;
 difference(){
  translate([-lid_latch_bridge/2-1.2,0,0])rotate([90,0,90])linear_extrude(lid_latch_bridge+2.4)
   polygon([[0,0],[d,0],[d,z],[wall,z+lid_latch_ramp_h],[0,z+lid_latch_ramp_h]]);
  translate([-lid_latch_bridge/2,-eps,-eps])cube([lid_latch_bridge,d+2*eps,lid_top+lid_latch_top_gap+eps]);
 }
}}
module p2_lid_beams(){p2_latch_places(){
 translate([-lid_latch_l,lid_beam_y,inside_lid_z])cube([lid_latch_l+1.2,lid_latch_t,lid_t]);
 translate([-2,lid_latch_y,inside_lid_z])cube([3.2,lid_beam_y+lid_latch_t-lid_latch_y,lid_t]);
}}
module p2_lid_beam_clearance(){p2_latch_places(){
 translate([-lid_latch_l+1,-eps,inside_lid_z-eps])cube([lid_latch_l+6,lid_beam_y+lid_latch_t+lid_latch_release_gap+eps,lid_t+2*eps]);
}}
module p2_pi_supports(){pi_holes(){translate([0,0,base_floor-eps])cylinder(d=pi_support_d,h=pi_support_h+eps);translate([0,0,pi_z-eps])cylinder(d=pi_peg_d,h=pi_peg_h+eps);}}
// Front/right and rear/left clear lands. Tip ramps print at 45 degrees; press OUT to release.
module p2_pi_clip_places(){translate([pi_x+pi_hole_x[1],pi_y,0])children();translate([pi_x+pi_hole_x[0],pi_y+pi_w,0])rotate([0,0,180])children();}
module p2_pi_clips(){p2_pi_clip_places()translate([-pi_clip_w/2,0,0])rotate([90,0,90])linear_extrude(pi_clip_w)
 polygon([[-pi_clip_gap-pi_clip_t,pi_clip_root_z],[-pi_clip_gap,pi_clip_root_z],[-pi_clip_gap,pi_clip_z],[pi_clip_overlap,pi_clip_z+pi_clip_overlap+pi_clip_gap],[pi_clip_overlap,pi_clip_top],[-pi_clip_gap-pi_clip_t,pi_clip_top+pi_clip_overlap+pi_clip_gap]]);
}
module p2_pi_clip_slots(){p2_pi_clip_places(){
 translate([-pi_clip_w/2-snap_clearance,-pi_clip_gap-pi_clip_t-1.5,pi_clip_root_z])cube([pi_clip_w+2*snap_clearance,pi_clip_t+pi_clip_gap+1.5,base_floor-pi_clip_root_z+eps]);
}}
// The OLED lowers onto round pads between these guides. Rear PCB edges take the glue dots.
module p2_oled_rails(){for(x=oled_rail_x,edge=[0,1])translate([x,edge?oled_y+oled_l:oled_y,0])scale([1,edge?-1:1,1])union(){
 translate([0,-oled_rail_t-oled_slide_gap,oled_z-oled_slide_gap-oled_rail_t])cube([oled_rail_w,oled_rail_t,inside_lid_z-(oled_z-oled_slide_gap-oled_rail_t)+eps]);
}}
module p2_oled_glue(){for(edge=[0,1])translate([oled_x+10,edge?oled_y+oled_l:oled_y,oled_z-0.2])scale([1.6,0.7,0.55])sphere(r=oled_glue_r);}
module pi_holes(){for(x=pi_hole_x,y=pi_hole_y)translate([pi_x+x,pi_y+y,0])children();}
module oled_holes(){for(x=oled_hole_x,y=oled_hole_y)translate([oled_x+x,oled_y+y,0])children();}
// Side channels guide a third strap around box AND bank; no strap lies between their flat faces.
module p2_backup_guides(){for(y=[-eps,box_w-backup_guide_d])translate([backup_strap_x-backup_guide_w/2,y,-eps])cube([backup_guide_w,backup_guide_d+eps, lid_top+2*eps]);}
module p2_backup_strap(){translate([backup_strap_x-backup_strap_w/2,0,0])rotate([90,0,90])linear_extrude(backup_strap_w)difference(){
 translate([backup_guide_d-backup_strap_t,-bank_t-backup_strap_t])square([box_w-2*backup_guide_d+2*backup_strap_t,lid_top+bank_t+2*backup_strap_t]);
 translate([backup_guide_d,-bank_t])square([box_w-2*backup_guide_d,lid_top+bank_t]);
}}
module p2_backup_access(){
 p2_button();p2_usb_plug([17,24,12]);p2_finger_route();p2_bank_straps();
 p2_lid_beams();p2_lid_catches();
 for(x=[lid_vent_x[0]:vent_pitch:lid_vent_x[1]])translate([x,lid_vent_y,lid_top])cube([vent_slot_w,lid_vent_l,backup_strap_t+1]);
 for(x=[front_vent_x[0]:vent_pitch:front_vent_x[1]])translate([x,-2,vent_z])cube([vent_slot_w,4,vent_slot_h]);
 for(x=[back_vent_x[0]:vent_pitch:back_vent_x[1]])translate([x,box_w-2,vent_z])cube([vent_slot_w,4,vent_slot_h]);
 translate([-2,pi_y+microsd_cut_y-microsd_cut_w/2,microsd_cut_z])cube([4,microsd_cut_w,microsd_cut_h]);
}
module p2_pi_glue(){for(hole=pi_glue_holes)translate([pi_x+pi_hole_x[hole[0]],pi_y+pi_hole_y[hole[1]],pi_z+pi_pcb]){
 // The peg tip is 0.2 mm below the PCB top. Glue fills that recess and caps the hole rim.
 translate([0,0,-(pi_pcb-pi_peg_h)])cylinder(d=pi_peg_d+0.1,h=pi_pcb-pi_peg_h+pi_glue_cap_h/2);
 intersection(){scale([pi_glue_cap_d/2,pi_glue_cap_d/2,pi_glue_cap_h])sphere(r=1);translate([-pi_glue_cap_d,-pi_glue_cap_d,0])cube([2*pi_glue_cap_d,2*pi_glue_cap_d,pi_glue_cap_h]);}
}}
module p2_pi_components(){translate([pi_x,pi_y,pi_z]){pi4_ports();pi4_header();pi4_heatsinks();}p2_shim();}
module p2_base(){union(){difference(){union(){
 difference(){rounded_box([box_l,box_w,inside_lid_z],box_r);translate([wall,wall,base_floor])rounded_box([box_l-2*wall,box_w-2*wall,inside_lid_z],box_r-wall);}
 p2_lid_catches();p2_pi_supports();
 // Adhesive breadboard pocket, open on top, with 0.5 mm per side clearance.
 translate([bread_x-bread_pocket_clearance-bread_rim_t,bread_y-bread_pocket_clearance-bread_rim_t,base_floor])difference(){
  rounded_box([bread_l+2*(bread_pocket_clearance+bread_rim_t),bread_w+2*(bread_pocket_clearance+bread_rim_t),bread_rim_h],bread_rim_outer_r);
  translate([bread_rim_t,bread_rim_t,-eps])rounded_box([bread_l+2*bread_pocket_clearance,bread_w+2*bread_pocket_clearance,bread_rim_h+2*eps],bread_rim_inner_r);
 }
 translate([box_l-wall,(box_w-carry_width)/2,0])difference(){rounded_box([carry_extension+wall,carry_width,base_floor],carry_outer_r);translate([carry_rim,carry_rim,-eps])rounded_box([carry_extension+wall-2*carry_rim,carry_width-2*carry_rim,base_floor+2*eps],carry_inner_r);}
 // Solid upright anchor joins back wall all the way to floor, avoiding a floating ledge.
 translate([strain_anchor_x-strain_anchor_w/2,box_w-wall-strain_anchor_h,base_floor])cube([strain_anchor_w,strain_anchor_h+eps,inside_lid_z-base_floor]);
 }
 p2_pi_clip_slots();
 if(with_backup_guides)p2_backup_guides();
 for(x=strap_x,y=strap_y)translate([x-strap_width/2,y-strap_gap/2,-eps])rounded_box([strap_width,strap_gap,base_floor+2*eps],strap_corner_r);
 // Port aperture has 45-degree shoulders and a 6 mm short bridge at its crown.
 translate([pi_x+pi_usb_c_x,wall/2,usb_cut_z])rotate([90,0,0])linear_extrude(wall+usb_cut_extra,center=true)
 polygon([[-usb_cut_w/2,0],[usb_cut_w/2,0],[usb_cut_w/2,usb_cut_h-(usb_cut_w-usb_crown_bridge)/2],[usb_crown_bridge/2,usb_cut_h],[-usb_crown_bridge/2,usb_cut_h],[-usb_cut_w/2,usb_cut_h-(usb_cut_w-usb_crown_bridge)/2]]);
 // microSD: 45 degree top slopes leave a 4 mm bridge.
 translate([-eps,pi_y+microsd_cut_y,microsd_cut_z])rotate([90,0,90])linear_extrude(wall+2*eps)
 polygon([[-microsd_cut_w/2,0],[microsd_cut_w/2,0],[microsd_cut_w/2,microsd_shoulder_h],[microsd_crown_bridge/2,microsd_cut_h],[-microsd_crown_bridge/2,microsd_cut_h],[-microsd_cut_w/2,microsd_shoulder_h]]);
 // Vertical air slots: 3.2 mm bridges at the top.
 for(x=[front_vent_x[0]:vent_pitch:front_vent_x[1]])translate([x,-eps,vent_z])cube([vent_slot_w,wall+2*eps,vent_slot_h]);
 for(x=[back_vent_x[0]:vent_pitch:back_vent_x[1]])translate([x,box_w-wall-eps,vent_z])cube([vent_slot_w,wall+2*eps,vent_slot_h]);
 translate([finger_exit_x-finger_exit_w/2,box_w-wall-eps,finger_exit_bottom])cube([finger_exit_w,wall+2*eps,inside_lid_z-finger_exit_bottom+eps]);
 // Internal horizontal eye: tie loops around cable jacket, entirely above floor.
 translate([strain_anchor_x-strain_anchor_w/2-eps,strain_anchor_y-strain_hole_y_offset,strain_tie_z])rotate([90,0,90])linear_extrude(strain_anchor_w+2*eps)teardrop2d(strain_hole_d);
}
p2_pi_clips();}}
module p2_lid(){union(){difference(){union(){
 translate([0,0,inside_lid_z])rounded_box([box_l,box_w,lid_t],box_r);
 if(with_oled) oled_holes()translate([0,0,oled_z+oled_pcb])cylinder(d=oled_round_boss_d,h=oled_support_h+eps);
 if(with_oled) p2_oled_rails();
 for(x=[wall+snap_clearance,box_l-wall-snap_clearance-1.2])translate([x,24,inside_lid_z-lid_locating_depth])cube([1.2,30,lid_locating_depth+eps]);
 }
 p2_lid_beam_clearance();
 if(with_backup_guides)p2_backup_guides();
 if(with_oled) translate([oled_x+oled_w/2,oled_y+oled_glass_y+oled_glass_l/2+oled_window_offset_y,inside_lid_z-eps])centered_box([oled_glass_w-2*oled_window_inset,oled_glass_l-2*oled_window_inset,lid_t+2*eps],oled_window_r);
 translate([button_x,button_y,inside_lid_z-eps])cylinder(d=button_hole_d,h=lid_t+2*eps);
 for(x=[lid_vent_x[0]:vent_pitch:lid_vent_x[1]])translate([x,lid_vent_y,inside_lid_z-eps])rounded_box([vent_slot_w,lid_vent_l,lid_t+2*eps],vent_slot_w/2);
 translate([brand_xy[0],brand_xy[1],lid_top-label_depth])label("HANDOFF RELAY",brand_size,label_depth+eps);
 translate([button_x,mark_y,lid_top-label_depth])label("MARK",mark_size,label_depth+eps);
 p2_finger_mark(lid_top-label_depth,label_depth+eps);
}
p2_lid_beams();}}
module p2_finger_mark(z,h){
 translate([finger_label_xy[0],finger_label_xy[1],z])label("FINGER",finger_label_size,h);
 translate([finger_exit_x,finger_arrow_y[0],z])linear_extrude(h)union(){translate([-finger_arrow_shaft/2,0])square([finger_arrow_shaft,finger_arrow_y[1]-finger_arrow_y[0]-finger_arrow_head_l]);polygon([[-finger_arrow_w/2,finger_arrow_y[1]-finger_arrow_y[0]-finger_arrow_head_l],[finger_arrow_w/2,finger_arrow_y[1]-finger_arrow_y[0]-finger_arrow_head_l],[0,finger_arrow_y[1]-finger_arrow_y[0]]]);}
}
module p2_pi(){translate([pi_x,pi_y,pi_z])pi4(false);}
module p2_shim(){translate([pi_x,pi_y,pi_z])qwiic_shim();}
module p2_oled(){translate([oled_x,oled_y,oled_z])oled938();}
module p2_button(){translate([button_x,button_y,lid_top])button_hban(lid_t);}
module p2_bread(){translate([bread_x,bread_y,base_floor])breadboard();}
module p2_bank(){translate([(box_l-bank_l)/2,(box_w-bank_w)/2,-bank_t-bank_gap])powerbank();}
module p2_underside_exclusion(){translate([-box_l,-box_w,-bank_t])cube([3*box_l,3*box_w,bank_t-eps]);}
module p2_bank_straps(){pts=[[strap_y[0],base_floor+bank_strap_t/2],[strap_y[1],base_floor+bank_strap_t/2],[strap_y[1],-bank_t-bank_strap_t],[strap_y[0],-bank_t-bank_strap_t],[strap_y[0],base_floor+bank_strap_t/2]];
 for(x=strap_x)translate([x-bank_strap_w/2,0,0])rotate([90,0,90])linear_extrude(bank_strap_w)for(i=[0:len(pts)-2])hull(){translate(pts[i])circle(r=bank_strap_t/2);translate(pts[i+1])circle(r=bank_strap_t/2);}
}
module p2_usb_plug(size=usb_plug_size){
 translate([pi_x+pi_usb_c_x-size[0]/2,pi_y-pi_usb_c_overhang-size[1],usb_port_z-size[2]/2])cube(size);
 translate([pi_x+pi_usb_c_x,pi_y-pi_usb_c_overhang-size[1],usb_port_z])rotate([90,0,0])cylinder(d=usb_plug_relief_d,h=usb_plug_relief_l);
}
module p2_finger_plug(){translate([finger_plug_x-finger_plug_w/2,finger_socket_y-finger_plug_l,finger_plug_z-finger_plug_h/2])cube([finger_plug_w,finger_plug_l,finger_plug_h]);}
module p2_finger_cable(radius=finger_bundle_r){pts=finger_route_points();for(i=[0:len(pts)-2])hull(){translate(pts[i])sphere(r=radius);translate(pts[i+1])sphere(r=radius);}
 // Outside tail enters the open seam notch, then turns in front of the solid anchor.
 tail=[[68,66,31],[77,66,31],[83,70,30],[83,81,30]];
 for(i=[0:len(tail)-2])hull(){translate(tail[i])sphere(r=radius);translate(tail[i+1])sphere(r=radius);}
}
module p2_finger_route(){p2_finger_plug();p2_finger_cable();}
module p2_finger_route_clearance(gap=2.99){
 p2_finger_cable(finger_bundle_r+gap);
 translate([finger_plug_x-finger_plug_w/2-gap,finger_socket_y-finger_plug_l-gap,finger_plug_z-finger_plug_h/2-gap])cube([finger_plug_w+2*gap,finger_plug_l+2*gap,finger_plug_h+2*gap]);
}
// Solid witness exactly filling the former window at normal lid skin thickness.
module p2_closed_window(){translate([oled_x+oled_w/2,oled_y+oled_glass_y+oled_glass_l/2+oled_window_offset_y,inside_lid_z])centered_box([oled_glass_w-2*oled_window_inset,oled_glass_l-2*oled_window_inset,lid_t],oled_window_r);}
function p2_route_metrics()=[finger_internal_allowance,usb_port_z,usb_cut_w,usb_cut_h,strap_width,strap_gap];
module p2_reference(){p2_pi();p2_shim();if(with_oled)p2_oled();p2_button();p2_bread();}
module p2_assembly(e=0){color(graphite)p2_base();translate([0,0,5.2*e])color(graphite)p2_lid();translate([0,0,2.2*e])p2_pi();translate([0,0,3.1*e])p2_shim();if(with_oled)translate([0,0,4*e])p2_oled();translate([0,0,4.4*e])p2_button();translate([0,0,2.2*e])p2_bread();translate([0,0,-e])p2_bank();}
if(part=="base")p2_base();
else if(part=="lid")translate([0,0,lid_top])rotate([180,0,0])p2_lid();

else if(part=="exploded")p2_assembly(exploded_gap);
else if(part=="assembly")p2_assembly();
// Coupon extracts preserve the actual beam section, ramp, bridge and layer direction.
module p2_coupon_catch(){translate([-lid_latch_tip_x[0]+5,0,-inside_lid_z+2])intersection(){p2_base();translate([lid_latch_tip_x[0]-5,-eps,inside_lid_z-2])cube([11,10,10]);}}
module p2_coupon_lid(){translate([-lid_latch_tip_x[0]+lid_latch_l+2,10,lid_top])rotate([180,0,0])intersection(){p2_lid();translate([lid_latch_tip_x[0]-lid_latch_l-2,0,inside_lid_z-eps])cube([lid_latch_l+7,10,lid_t+2*eps]);}}
module p2_coupon_pi_receiver(){translate([-pi_x-pi_hole_x[1]+4,-pi_y+3,0])intersection(){p2_base();translate([pi_x+pi_hole_x[1]-4,pi_y-3,0])cube([8,10,pi_clip_top+2]);}}
module p2_coupon_pi_board(){translate([-pi_x-pi_hole_x[1]+4,-pi_y,-pi_z])intersection(){p2_pi();translate([pi_x+pi_hole_x[1]-4,pi_y,pi_z])cube([8,7,pi_pcb]);}}

function p2_snap_metrics()=[["P2 lid paddle",lid_latch_t,lid_latch_t+lid_latch_overlap+0.15,lid_latch_l-1,lid_latch_t+lid_latch_overlap],["Pi edge clip",pi_clip_t,pi_clip_deflect,pi_clip_l,pi_clip_overlap]];

module p2_oled_glass_envelope(){translate([oled_x+(oled_w-oled_glass_w)/2,oled_y+oled_glass_y,oled_z+oled_pcb])cube([oled_glass_w,oled_glass_l,oled_depth-oled_pcb]);}

// Scalar fit checks complement full geometry intersections and remain parametric.
function path_length(pts,i=1) = i>=len(pts) ? 0 : norm(pts[i]-pts[i-1])+path_length(pts,i+1);
function usb_rect_gap(w,h) = min((usb_cut_w-w)/2,usb_port_z-h/2-usb_cut_z,usb_cut_z+usb_cut_h-max(0,(w-usb_crown_bridge)/2)-usb_port_z-h/2);
function p2_fit_metrics() = [
 ["straight_15x10_min_gap",usb_rect_gap(15,10),1.19],
 ["straight_17x12_min_gap",usb_rect_gap(17,12),0.19],
 ["finger_loop_spare_length",finger_internal_allowance-path_length(finger_route_points()),3],
 ["finger_cable_to_flat_lid",inside_lid_z-max([for(p=finger_route_points())p[2]])-finger_bundle_r,3],
 ["strap_width_clearance",strap_width-13,0.39],
 ["relay_strap_thickness_clearance",strap_gap-1.2,1.59]
];
