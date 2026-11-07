include <common.scad>
use <models/pi4.scad>
use <models/oled938.scad>
use <models/button_hban.scad>
use <models/powerbank.scad>
use <models/breadboard.scad>
part = "assembly";             // base, lid, oled_retainer, assembly, exploded; print selectors bed-oriented.
box_l = 158;                    // Body length; separate carry loop adds 12 mm.
box_w = 78;                     // Allows cable/strap channels beside 56 mm Pi.
base_floor = 3.0;               // Flat underside; recessed screw heads stay above Z=0.
inside_lid_z = 37;              // Height of lid underside above bottom of base.
lid_t = 2.4;
box_r = 5;
pi_x = 8;
pi_y = 10;
pi_standoff_h = 6;              // Purchased M/F spacers, MALE UP into Pi, nut on top.
pi_stud_h = 6;                  // Conservative male stud length; check actual kit.
pi_screw_l = 6;                 // Underside screw length under head.
pi_screw_head_d = 5;            // Conservative nylon screw head envelope.
pi_screw_head_h = 2;
pi_head_clearance = 0.2;        // Diametral/radial fit allowance for counterbore.
pi_head_recess = 0.2;           // Lowest hardware point is ABOVE the flat base bottom.
pi_counterbore_h = pi_screw_head_h+pi_head_recess;
pi_counterbore_d = pi_screw_head_d+2*pi_head_clearance;
pi_female_depth = pi_screw_l-(base_floor-pi_counterbore_h); // 5.2 mm modeled engagement.
pi_z = base_floor+pi_standoff_h;
oled_x = 26;                   // Low Pi region, clear of right USB/Ethernet stacks.
oled_y = 17;
oled_standoff_h = 6;            // Printed ROUND spacers; hex hardware would hit glass.
oled_z = inside_lid_z-oled_standoff_h-oled_pcb;
oled_window_inset = 1.0;        // Full glass minus 1 mm each edge; active offset unknown.
oled_window_offset_y = 0;       // Additional measured window shift from glass centre.
oled_round_boss_d = 3.8;        // Clears glass by 0.386 mm at closest holes.
retainer_z = inside_lid_z-11.4; // 3 mm above conservative Pi heatsink envelope.
retainer_t = 2.4;
retainer_pad_h = 1.4;           // Pads contact PCB rear at Z=29.4 mm.
retainer_post_z = inside_lid_z-9; // Side-loaded nuts sit above a web facing the retainer.
retainer_post_r = 4;
retainer_posts = [[20,20],[68,47]]; // Outboard posts, clear of OLED connectors.
retainer_x = 16;
retainer_y = 13;
retainer_w = 55;                // Right edge x=71: 3.5 mm lateral gap to Ethernet.
retainer_l = 41;
retainer_rail = 8;
retainer_cable_notch = 0.8;     // Shallow rail notches for side-exiting Qwiic wires.
button_x = 128;                 // Separate bay next to Pi, above no PCB.
button_y = 61;
bread_x = 105;
bread_y = 11;
bread_pocket_clearance = 0.5;   // PER SIDE; adhesive back rests on base floor.
bread_rim_h = 2;
bread_rim_t = 1.2;
lid_screw_inset = 5;
lid_boss_r = 3.8;
strap_x = [36,96];             // Two straps wrap around the power bank in YZ plane.
strap_y = [3.2,74.8];          // Outside bank footprint; straps do not lie between flat faces.
strap_width = 13.4;             // 13 mm Velcro, +0.4 clearance.
bank_strap_t = 0.8;            // Reference Velcro thickness, routed around bank sides.
bank_strap_w = 13;
strap_gap = 2.8;                // Slot for strap thickness; open through base floor.
carry_extension = 12;
carry_width = 28;
carry_rim = 3;
usb_cut_w = 18;                 // Right-angle USB-C plug envelope: measure actual cable.
usb_cut_h = 14;
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
lid_boss_corner_r = 1;
bread_rim_outer_r = 2;
bread_rim_inner_r = 1;
carry_outer_r = 3;
carry_inner_r = 1.2;
lid_screw_depth = 8;          // Blind clearance hole below nut pocket.
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
retainer_outer_r = 3;
retainer_inner_r = 1.5;
retainer_notch_y = 11;        // Qwiic notch from OLED board header edge.
retainer_notch_l = 10;
bank_gap = 0;                 // Bank rests flush against the unobstructed underside.
usb_plug_size = [12,12,6];    // Conservative right-angle plug envelope.
usb_plug_z_offset = -1;       // Relative to Pi PCB top.
exploded_gap = 25;            // Visual spacing, not a fit dimension.
// Derived placement; top surface is the button's reference datum.
lid_top=inside_lid_z+lid_t;
assert(lid_t+nut_bearing_web+nut_h<=assembly_screw_l,"P2 lid screw must engage full nut");
assert(retainer_t+nut_bearing_web+nut_h<=assembly_screw_l,"P2 retainer screw must engage full nut");
module p2_corner_nut_webs(){lid_holes()translate([0,0,inside_lid_z-nut_bearing_web])bearing_web();}
module p2_retainer_nut_webs(){for(p=retainer_posts)translate([p[0],p[1],retainer_post_z])bearing_web();}
module p2_shell_hardware(){lid_holes(){
 translate([0,0,inside_lid_z-nut_bearing_web-nut_h])hex_nut();
 translate([0,0,lid_top])rotate([180,0,0])assembly_screw();
}}
module p2_retainer_hardware(){for(p=retainer_posts){
 translate([p[0],p[1],retainer_post_z+nut_bearing_web])hex_nut();
 translate([p[0],p[1],retainer_z])assembly_screw();
}}
module lid_holes(){for(x=[lid_screw_inset,box_l-lid_screw_inset],y=[lid_screw_inset,box_w-lid_screw_inset])translate([x,y,0])children();}
module pi_holes(){for(x=pi_hole_x,y=pi_hole_y)translate([pi_x+x,pi_y+y,0])children();}
module oled_holes(){for(x=oled_hole_x,y=oled_hole_y)translate([oled_x+x,oled_y+y,0])children();}
module p2_base(){difference(){union(){
 difference(){rounded_box([box_l,box_w,inside_lid_z],box_r);translate([wall,wall,base_floor])rounded_box([box_l-2*wall,box_w-2*wall,inside_lid_z],box_r-wall);}
 lid_holes()translate([-lid_boss_r,-lid_boss_r,0])rounded_box([2*lid_boss_r,2*lid_boss_r,inside_lid_z],lid_boss_corner_r);
 // Adhesive breadboard pocket, open on top, with 0.5 mm per side clearance.
 translate([bread_x-bread_pocket_clearance-bread_rim_t,bread_y-bread_pocket_clearance-bread_rim_t,base_floor])difference(){
  rounded_box([bread_l+2*(bread_pocket_clearance+bread_rim_t),bread_w+2*(bread_pocket_clearance+bread_rim_t),bread_rim_h],bread_rim_outer_r);
  translate([bread_rim_t,bread_rim_t,-eps])rounded_box([bread_l+2*bread_pocket_clearance,bread_w+2*bread_pocket_clearance,bread_rim_h+2*eps],bread_rim_inner_r);
 }
 translate([box_l-wall,(box_w-carry_width)/2,0])difference(){rounded_box([carry_extension+wall,carry_width,base_floor],carry_outer_r);translate([carry_rim,carry_rim,-eps])rounded_box([carry_extension+wall-2*carry_rim,carry_width-2*carry_rim,base_floor+2*eps],carry_inner_r);}
 // Solid upright anchor joins back wall all the way to floor, avoiding a floating ledge.
 translate([strain_anchor_x-strain_anchor_w/2,box_w-wall-strain_anchor_h,base_floor])cube([strain_anchor_w,strain_anchor_h+eps,inside_lid_z-base_floor]);
 }
 // Access from the box interior along X; 1.2 mm roof is the lid-facing bearing web.
 for(x=[lid_screw_inset,box_l-lid_screw_inset],y=[lid_screw_inset,box_w-lid_screw_inset])translate([x,y,inside_lid_z-nut_bearing_web-nut_pocket_h])rotate([0,0,x<box_l/2?0:180])side_nut_pocket(lid_boss_r+eps);
 lid_holes()translate([0,0,inside_lid_z-lid_screw_depth])screw_bore(lid_screw_depth+eps);
 pi_holes(){translate([0,0,-eps])screw_bore(base_floor+2*eps);translate([0,0,-eps])cylinder(d=pi_counterbore_d,h=pi_counterbore_h+eps);}
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
}}
module p2_lid(){difference(){union(){
 translate([0,0,inside_lid_z])rounded_box([box_l,box_w,lid_t],box_r);
 oled_holes()translate([0,0,oled_z+oled_pcb])cylinder(d=oled_round_boss_d,h=oled_standoff_h+eps);
 for(p=retainer_posts)translate([p[0],p[1],retainer_post_z])cylinder(r=retainer_post_r,h=inside_lid_z-retainer_post_z+eps);
 }
 lid_holes()translate([0,0,inside_lid_z-eps])screw_bore(lid_t+2*eps);
 // Side entry points away from the OLED. A solid 1.2 mm web faces each retainer screw.
 for(p=retainer_posts){translate([p[0],p[1],retainer_post_z+nut_bearing_web])rotate([0,0,p[0]<oled_x?180:0])side_nut_pocket(retainer_post_r+eps);translate([p[0],p[1],retainer_post_z-eps])screw_bore(inside_lid_z-retainer_post_z+eps);}
 translate([oled_x+oled_w/2,oled_y+oled_glass_y+oled_glass_l/2+oled_window_offset_y,inside_lid_z-eps])centered_box([oled_glass_w-2*oled_window_inset,oled_glass_l-2*oled_window_inset,lid_t+2*eps],oled_window_r);
 translate([button_x,button_y,inside_lid_z-eps])cylinder(d=button_hole_d,h=lid_t+2*eps);
 for(x=[lid_vent_x[0]:vent_pitch:lid_vent_x[1]])translate([x,lid_vent_y,inside_lid_z-eps])rounded_box([vent_slot_w,lid_vent_l,lid_t+2*eps],vent_slot_w/2);
 translate([brand_xy[0],brand_xy[1],lid_top-label_depth])label("HANDOFF RELAY",brand_size,label_depth+eps);
 translate([button_x,mark_y,lid_top-label_depth])label("MARK",mark_size,label_depth+eps);
 p2_finger_mark(lid_top-label_depth,label_depth+eps);
}}
module p2_finger_mark(z,h){
 translate([finger_label_xy[0],finger_label_xy[1],z])label("FINGER",finger_label_size,h);
 translate([finger_exit_x,finger_arrow_y[0],z])linear_extrude(h)union(){translate([-finger_arrow_shaft/2,0])square([finger_arrow_shaft,finger_arrow_y[1]-finger_arrow_y[0]-finger_arrow_head_l]);polygon([[-finger_arrow_w/2,finger_arrow_y[1]-finger_arrow_y[0]-finger_arrow_head_l],[finger_arrow_w/2,finger_arrow_y[1]-finger_arrow_y[0]-finger_arrow_head_l],[0,finger_arrow_y[1]-finger_arrow_y[0]]]);}
}
module p2_retainer(){difference(){union(){
 translate([retainer_x,retainer_y,retainer_z])difference(){rounded_box([retainer_w,retainer_l,retainer_t],retainer_outer_r);translate([retainer_rail,retainer_rail,-eps])rounded_box([retainer_w-2*retainer_rail,retainer_l-2*retainer_rail,retainer_t+2*eps],retainer_inner_r);}
 oled_holes()translate([0,0,retainer_z+retainer_t-eps])cylinder(d=oled_round_boss_d,h=retainer_pad_h+eps);
 }
 for(p=retainer_posts)translate([p[0],p[1],retainer_z-eps])screw_bore(retainer_t+2*eps);
 for(x=[retainer_x-eps,retainer_x+retainer_w-retainer_rail-eps])translate([x,oled_y+retainer_notch_y,retainer_z+retainer_t-retainer_cable_notch])cube([retainer_rail+2*eps,retainer_notch_l,retainer_cable_notch+eps]);
}}
module p2_pi(){translate([pi_x,pi_y,pi_z])pi4(false);}
module p2_shim(){translate([pi_x,pi_y,pi_z])qwiic_shim();}
module p2_oled(){translate([oled_x,oled_y,oled_z])oled938();}
module p2_button(){translate([button_x,button_y,lid_top])button_hban(lid_t);}
module p2_bread(){translate([bread_x,bread_y,base_floor])breadboard();}
module p2_bank(){translate([(box_l-bank_l)/2,(box_w-bank_w)/2,-bank_t-bank_gap])powerbank();}
module p2_pi_standoffs(){color([0.78,0.77,0.7])pi_holes(){
 translate([0,0,base_floor])hex_standoff(pi_standoff_h);
 translate([0,0,pi_z])cylinder(d=fastener_nominal_d,h=pi_stud_h);
}}
module p2_pi_nuts(){color([0.78,0.77,0.7])pi_holes()translate([0,0,pi_z+pi_pcb])difference(){cylinder(d=nut_af/cos(30),h=nut_h,$fn=6);translate([0,0,-eps])cylinder(d=fastener_nominal_d,h=nut_h+2*eps);}}
module p2_bottom_screws(){color([0.78,0.77,0.7])pi_holes(){translate([0,0,pi_head_recess])cylinder(d=pi_screw_head_d,h=pi_screw_head_h);translate([0,0,pi_counterbore_h])cylinder(d=fastener_nominal_d,h=pi_screw_l);}}
module p2_underside_exclusion(){translate([-box_l,-box_w,-bank_t])cube([3*box_l,3*box_w,bank_t-eps]);}
module p2_bank_straps(){pts=[[strap_y[0],base_floor+bank_strap_t/2],[strap_y[1],base_floor+bank_strap_t/2],[strap_y[1],-bank_t-bank_strap_t],[strap_y[0],-bank_t-bank_strap_t],[strap_y[0],base_floor+bank_strap_t/2]];
 for(x=strap_x)translate([x-bank_strap_w/2,0,0])rotate([90,0,90])linear_extrude(bank_strap_w)for(i=[0:len(pts)-2])hull(){translate(pts[i])circle(r=bank_strap_t/2);translate(pts[i+1])circle(r=bank_strap_t/2);}
}
module p2_oled_standoffs(){} // Compatibility helper: spacers are integral to lid.
module p2_usb_plug(){translate([pi_x+pi_usb_c_x-usb_plug_size[0]/2,pi_y-usb_plug_size[1],pi_z+pi_pcb+usb_plug_z_offset])cube(usb_plug_size);}
module p2_reference(){p2_pi();p2_shim();p2_oled();p2_button();p2_bread();}
module p2_assembly(e=0){color(graphite)p2_base();translate([0,0,5.2*e])color(graphite)p2_lid();translate([0,0,2.2*e])p2_pi();translate([0,0,3.1*e])p2_shim();translate([0,0,4*e])p2_oled();translate([0,0,4.4*e])p2_button();color(graphite)translate([0,0,3.3*e])p2_retainer();translate([0,0,2.2*e])p2_bread();translate([0,0,1.5*e])p2_pi_standoffs();translate([0,0,2.8*e])p2_pi_nuts();p2_bottom_screws();translate([0,0,-e])p2_bank();}
if(part=="base")p2_base();
else if(part=="lid")translate([0,0,lid_top])rotate([180,0,0])p2_lid();
else if(part=="oled_retainer")translate([0,0,-retainer_z])p2_retainer();
else if(part=="exploded")p2_assembly(exploded_gap);
else if(part=="assembly")p2_assembly();
