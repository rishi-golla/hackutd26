include <common.scad>
use <models/max30101.scad>
part = "assembly";             // tray, hood, joint_clips (two J pieces), assembly, exploded.
joint_glue_y = -4;            // Two outside seam spots at the finger-entry end, away from connectors.
joint_glue_length = 3.5;       // Rice-grain reference dot; no printed glue well needed.
joint_glue_height = 2.0;
joint_glue_depth = 1.0;
board_clearance = 0.35;         // Per side; PCB is clamped by four corner pads.
tray_floor = 1.8;
board_seat_z = 2.2;
hood_joint_z = 1.8;
hood_wall = 3.4;                // Outer skirt allowance preserves >=2.4 mm beside widened U.
end_wall = 6.4;                 // Closed distal wall; rear J pocket keeps an opaque inner wall.
channel_radius = 8.5;           // Curvature of each U-cradle side; fit actual fingertip.
channel_flat_width = 11;         // Flat sensor-contact strip between curved sides.
cradle_side_h = 8;              // Low open sides above the sensor plane.
tunnel_start = -8;              // Proximal entry, open at top.
tunnel_end = 34;                // Inner face of closed fingertip stop.
visor_length = 14;              // Short distal shade; strap passes UNDER it.
visor_roof_t = 1.8;
visor_clearance = 17;           // Sensor plane to visor UNDERSIDE: 15 mm finger + 1.2 strap + margin.
visor_top_z = board_seat_z+sensor_pcb+sensor_h+visor_clearance+visor_roof_t; // Derived rigid height.
floor_thickness = 1.2;
entry_floor_z = 6.5;            // Central floor only 1.15 above sensor; clears low ICs.
floor_ramp_start = 19;          // Descend after low IC cluster, before sensor aperture.
sensor_window_clearance = 0.2; // Per side; opaque gasket/tape seals package edge.
connector_clearance = 0.4;
connector_exit_l = 8;
connector_cap_z = 8.7;          // Local side caps above Qwiic, not across finger centre.
connector_cap_inner_x = 5.4;   // Edge of left cap; mirrored on right.
connector_cap_margin = 1;      // Material beyond connector opening along Y.
joint_clip_length = 24;         // J: flat-printed C spring, two copies per finger assembly.
joint_clip_t = 1.6;             // Upper spring arm, three extrusion widths.
joint_clip_spine = 3.2;
joint_clip_bottom_t = 2.4;
joint_clip_w = 4.4;             // Fits rear pocket without breaching the fingertip light wall.
joint_flange_h = 4.2;           // Tray 1.8 + cradle flange 2.4, both positively captured.
joint_clip_gap = snap_clearance/4; // Small running gap on EACH clamping face.
joint_clip_hook = 1.4;
joint_clip_hook_l = 2.8;
joint_clip_root_r = 0.8;
joint_clip_tip = 20.5;            // Hook trailing shoulder from clip's closed end.
joint_clip_release = 3;         // Free tip beyond hook gives a fingernail lift point.
front_flange_y = -13.0;
rear_clip_light_wall = 1.4;     // Continuous opaque wall between rear clip pocket and finger.
strap_width = 13.4;             // Clearance for 13 mm opaque Velcro, along finger axis.
strap_slot_z = 6.8;             // LOW wall slots: strap climbs over finger, not over visor.
strap_gap = 2.2;                // Slot height; actual strap must slide freely.
strap_nominal_width = 13;       // Reference flexible strap, not a printable piece.
strap_thickness = 1.2;          // Conservative reference webbing thickness.
strap_route_x_clearance = 7.5; // Outside sidewall to strap centreline.
strap_under_z = -strap_thickness/2;           // Reference strap beneath tray; P3 can sit on this soft layer.
finger_width = 20;              // Illustrative compliant fingertip envelope, NOT anatomy proof.
finger_thickness = 15;        // Must fit below visor with strap; measure actual finger.
finger_reference_start = -28;
finger_reference_end = 32;
board_clamp_pad = 4.4;
strain_slot_l = 6;
strain_slot_w = 2;
tray_corner_r = 2;
seat_w = 1.2;
seat_l = 3;
seat_y = [6,17];
strain_slot_x_inset = 1;
strain_slot_y = 8;
flange_wall_overlap = 0.3;
clamp_fuse_overlap = 0.15;
clip_layout_offset = 55;
exploded_gap = 14;
curve_step = 5;                // Degrees per reference/U-channel arc segment.
channel_cut_top = 45;          // Boolean cutter above entire part.
// Derived dimensions, not independent fitting inputs.
sensor_top_z=board_seat_z+sensor_pcb+sensor_h;
floor_ramp_end=floor_ramp_start+entry_floor_z-sensor_top_z;
sensor_y=sensor_board-sensor_top_offset;
outer_x=-board_clearance-hood_wall;
outer_w=sensor_board+2*(board_clearance+hood_wall);
outer_end=tunnel_end+end_wall;
side_top_z=sensor_top_z+cradle_side_h;
visor_start=tunnel_end-visor_length;
visor_inner_z=visor_top_z-visor_roof_t;
strap_y=sensor_y-strap_width/2;
strap_mid_z=strap_slot_z+strap_gap/2;
channel_top_width_sensor=channel_flat_width+2*sqrt(pow(channel_radius,2)-pow(channel_radius-cradle_side_h,2));
channel_top_width_entry=channel_flat_width+2*sqrt(pow(channel_radius,2)-pow(channel_radius-(side_top_z-entry_floor_z),2));
assert(visor_clearance>=finger_thickness+strap_thickness, "Visor must clear finger plus strap");
function floor_z(y)=y<=floor_ramp_start?entry_floor_z:y>=floor_ramp_end?sensor_top_z:entry_floor_z-(y-floor_ramp_start);
function channel_points(z)=concat(
 [[sensor_board/2-channel_flat_width/2-channel_radius,channel_cut_top]],
 [for(a=[180:curve_step:270])[sensor_board/2-channel_flat_width/2+channel_radius*cos(a),z+channel_radius+channel_radius*sin(a)]],
 [for(a=[270:curve_step:360])[sensor_board/2+channel_flat_width/2+channel_radius*cos(a),z+channel_radius+channel_radius*sin(a)]],
 [[sensor_board/2+channel_flat_width/2+channel_radius,channel_cut_top]]);
clip_x = outer_x-joint_clip_spine-snap_clearance;
clip_ys = [front_flange_y+snap_clearance,tunnel_end+rear_clip_light_wall+snap_clearance];
clip_hook_x = clip_x+joint_clip_tip;
assert(beam_strain(joint_clip_t,joint_clip_hook-joint_clip_gap+0.15,joint_clip_tip-joint_clip_spine-joint_clip_root_r)<snap_strain_limit,"P3 J clip nominal strain screen");
module p3_footprint(h){union(){translate([outer_x,tunnel_start,0])rounded_box([outer_w,outer_end-tunnel_start,h],tray_corner_r);translate([outer_x,front_flange_y,0])cube([joint_clip_length, tunnel_start-front_flange_y+flange_wall_overlap,h]);}}
module p3_tray(){difference(){union(){p3_footprint(tray_floor);
 for(x=[0,sensor_board-seat_w],y=seat_y)translate([x,y,tray_floor])cube([seat_w,seat_l,board_seat_z-tray_floor]);
 }
 p3_flange_lead_relief();
 for(x=[outer_x+strain_slot_x_inset,outer_x+outer_w-strain_slot_x_inset-strain_slot_w])translate([x,strain_slot_y,-eps])cube([strain_slot_w,strain_slot_l,tray_floor+2*eps]);
}}
// Extruded flat C profile with internal root fillets and first-layer edge relief.
module p3_clip_profile(){union(){
 translate([0,-joint_clip_gap-joint_clip_bottom_t])square([joint_clip_spine,joint_flange_h+2*joint_clip_gap+joint_clip_bottom_t+joint_clip_t]);
 translate([0,-joint_clip_gap-joint_clip_bottom_t])square([joint_clip_length,joint_clip_bottom_t]);
 translate([0,joint_flange_h+joint_clip_gap])square([joint_clip_length,joint_clip_t]);
 translate([joint_clip_spine,-joint_clip_gap])root_fillet_2d(joint_clip_root_r);
 translate([joint_clip_spine,joint_flange_h+joint_clip_gap])mirror([0,1])root_fillet_2d(joint_clip_root_r);
 translate([joint_clip_tip,0])polygon([[0,joint_flange_h+joint_clip_gap+eps],[0,joint_flange_h+joint_clip_gap-joint_clip_hook],[joint_clip_hook_l-joint_clip_hook,joint_flange_h+joint_clip_gap-joint_clip_hook],[joint_clip_hook_l,joint_flange_h+joint_clip_gap+eps]]);
}}
module p3_joint_clip(){translate([0,joint_clip_w/2,0])rotate([90,0,0])bed_chamfer_extrude(joint_clip_w) p3_clip_profile();}
// Clearance at the leading flange corners accepts rounded clip roots and elephant foot.
module p3_flange_lead_relief(){for(y=clip_ys)translate([outer_x-eps,y+joint_clip_w/2,0])rotate([90,0,0])linear_extrude(joint_clip_w+2*snap_clearance,center=true)union(){
 polygon([[0,-eps],[1.1,-eps],[0,1.1]]);
 polygon([[0,joint_flange_h-1.1],[1.1,joint_flange_h+eps],[0,joint_flange_h+eps]]);
}}
module p3_clips(){for(y=clip_ys)translate([clip_x,y+joint_clip_w/2,0])p3_joint_clip();}
module p3_clip_print(){translate([0,0,joint_clip_w/2])rotate([90,0,0])p3_joint_clip();}
module p3_clip_pair(){p3_clip_print();translate([joint_clip_length+4,0,0])p3_clip_print();}
module p3_channel_slice(y,z){translate([0,y,0])rotate([90,0,0])linear_extrude(eps)polygon(channel_points(z));}
module p3_channel_cut(){for(pair=[[tunnel_start-eps,floor_ramp_start],[floor_ramp_start,floor_ramp_end],[floor_ramp_end,tunnel_end]])hull(){p3_channel_slice(pair[0],floor_z(pair[0]));p3_channel_slice(pair[1],floor_z(pair[1]));}}
// Side connector caps are local. Their distal approach is 45 degrees in print orientation.
module p3_connector_caps(){cap_y0=sensor_board/2-connector_exit_l/2-connector_cap_margin;cap_y1=sensor_board/2+connector_exit_l/2+connector_cap_margin;cap_bottom=entry_floor_z-floor_thickness;
 for(m=[0,1])translate([m?sensor_board:0,0,0])mirror([m?1:0,0,0])translate([outer_x,0,0])rotate([90,0,90])linear_extrude(connector_cap_inner_x-outer_x)
 polygon([[cap_y0,cap_bottom],[cap_y1+connector_cap_z-cap_bottom,cap_bottom],[cap_y1,connector_cap_z],[cap_y0,connector_cap_z]]);
}
module p3_hood_body(){difference(){union(){
 difference(){
  translate([outer_x,tunnel_start,hood_joint_z])cube([outer_w,outer_end-tunnel_start,side_top_z-hood_joint_z]);
  p3_channel_cut();
 }
 // Short visor: opaque distal roof + side cheeks; proximal cradle stays open.
 difference(){
  translate([outer_x,visor_start,side_top_z-eps])cube([outer_w,outer_end-visor_start,visor_top_z-side_top_z+eps]);
  translate([outer_x+hood_wall,visor_start-eps,side_top_z-2*eps])cube([outer_w-2*hood_wall,tunnel_end-visor_start+eps,visor_inner_z-side_top_z+2*eps]);
 }
 p3_connector_caps();
 translate([outer_x,front_flange_y,hood_joint_z])cube([joint_clip_length,tunnel_start-front_flange_y+flange_wall_overlap,joint_flange_h-hood_joint_z]);
 }
 p3_flange_lead_relief();
 // Board bay and underside IC pocket. Keep a 1.2 mm central floor above low components.
 translate([-board_clearance,-board_clearance,hood_joint_z-eps])cube([sensor_board+2*board_clearance,sensor_board+2*board_clearance,board_seat_z+sensor_pcb+connector_clearance-hood_joint_z+eps]);
 translate([sensor_ic_pos[0]-connector_clearance,sensor_ic_pos[1]-connector_clearance,board_seat_z+sensor_pcb])cube([sensor_ic_size[0]+2*connector_clearance,sensor_ic_size[1]+connector_clearance,entry_floor_z-floor_thickness-board_seat_z-sensor_pcb]);
 for(x=[outer_x-eps,sensor_board-qwiic_w])translate([x,sensor_board/2-connector_exit_l/2,board_seat_z+sensor_pcb])cube([qwiic_w+hood_wall+board_clearance+connector_cap_margin,connector_exit_l,qwiic_h+connector_clearance]);
 translate([sensor_board/2-sensor_w/2-sensor_window_clearance,sensor_y-sensor_l/2-sensor_window_clearance,hood_joint_z-eps])cube([sensor_w+2*sensor_window_clearance,sensor_l+2*sensor_window_clearance,sensor_top_z-hood_joint_z+2*eps]);
 // One transverse cut makes TWO wall slots. Strap lies on finger underneath visor.
 translate([outer_x-eps,strap_y,strap_slot_z])cube([outer_w+2*eps,strap_width,strap_gap]);
 // Rear clip upper arm occupies a pocket below the closed fingertip stop.
 translate([outer_x-eps,tunnel_end+rear_clip_light_wall,joint_flange_h])cube([joint_clip_length+snap_clearance,outer_end-tunnel_end-rear_clip_light_wall+eps,joint_clip_t+2*joint_clip_gap+eps]);
 for(y=clip_ys)translate([clip_hook_x-snap_clearance,y-snap_clearance,joint_flange_h-joint_clip_hook])cube([joint_clip_hook_l+2*snap_clearance,joint_clip_w+2*snap_clearance,joint_clip_hook+eps]);
 // Leave PCB corners clamped at z=3.8 by the solid floor outside the bay.
 }
}
// Separate pads join the cavity ceiling to clamp the four PCB corner lands.
module p3_clamp_pads(){for(x=[sensor_hole_inset,sensor_board-sensor_hole_inset],y=[sensor_hole_inset,sensor_board-sensor_hole_inset])translate([x-board_clamp_pad/2,y-board_clamp_pad/2,board_seat_z+sensor_pcb])cube([board_clamp_pad,board_clamp_pad,connector_clearance+clamp_fuse_overlap]);}
module p3_hood(){union(){p3_hood_body();p3_clamp_pads();}}
module p3_board(){translate([0,0,board_seat_z])max30101();}
module p3_hood_print(){translate([0,-hood_joint_z,outer_end])rotate([-90,0,0])p3_hood();}
// Flexible strap and finger are reference envelopes only, never exported as print parts.
function strap_points(z=sensor_top_z)=concat([[outer_x-strap_route_x_clearance,strap_under_z],[outer_x-strap_route_x_clearance,strap_mid_z],[sensor_board/2-finger_width/2-strap_thickness/2,strap_mid_z]],
 [for(a=[180:-curve_step:0])[sensor_board/2+(finger_width/2+strap_thickness/2)*cos(a),z+finger_thickness/2+(finger_thickness/2+strap_thickness/2)*sin(a)]],
 [[sensor_board/2+finger_width/2+strap_thickness/2,strap_mid_z],[outer_x+outer_w+strap_route_x_clearance,strap_mid_z],[outer_x+outer_w+strap_route_x_clearance,strap_under_z],[outer_x-strap_route_x_clearance,strap_under_z]]);
module p3_strap_segment(y,z,i){pts=strap_points(z);translate([0,y,0])rotate([90,0,0])linear_extrude(eps)hull(){translate(pts[i])circle(r=strap_thickness/2);translate(pts[i+1])circle(r=strap_thickness/2);}}
module p3_strap(){ys=[sensor_y-strap_nominal_width/2,floor_ramp_start,floor_ramp_end,sensor_y+strap_nominal_width/2];for(j=[0:len(ys)-2],i=[0:len(strap_points())-2])hull(){p3_strap_segment(ys[j],floor_z(ys[j]),i);p3_strap_segment(ys[j+1],floor_z(ys[j+1]),i);}}

module p3_finger_slice(y,z){translate([sensor_board/2,y,z+finger_thickness/2])rotate([90,0,0])scale([finger_width/2,finger_thickness/2,1])cylinder(r=1,h=eps);}
module p3_finger(){hull(){p3_finger_slice(finger_reference_start,entry_floor_z);p3_finger_slice(floor_ramp_start,entry_floor_z);}hull(){p3_finger_slice(floor_ramp_start,entry_floor_z);p3_finger_slice(floor_ramp_end,sensor_top_z);}hull(){p3_finger_slice(floor_ramp_end,sensor_top_z);p3_finger_slice(finger_reference_end,sensor_top_z);}}
module p3_assembly(e=0){color(graphite)p3_tray();translate([0,0,e])p3_board();color(graphite)translate([0,0,2*e])p3_hood();color(graphite)translate([-2*e,0,0])p3_clips();}
if(part=="joint_clips")p3_clip_pair();else if(part=="joint_clip")p3_clip_print();else if(part=="tray")p3_tray();else if(part=="hood")p3_hood_print();else if(part=="clip"){p3_tray();translate([clip_layout_offset,0,0])p3_hood_print();}else if(part=="exploded")p3_assembly(exploded_gap);else if(part=="assembly")p3_assembly();
module p3_coupon_flange(){difference(){cube([joint_clip_length, joint_clip_w+2*snap_clearance,joint_flange_h]);
 translate([0,joint_clip_w+2*snap_clearance+eps,0])rotate([90,0,0])linear_extrude(joint_clip_w+2*snap_clearance+2*eps)union(){polygon([[0,-eps],[1.1,-eps],[0,1.1]]);polygon([[0,joint_flange_h-1.1],[1.1,joint_flange_h+eps],[0,joint_flange_h+eps]]);}
translate([clip_hook_x-outer_x-snap_clearance,-eps,joint_flange_h-joint_clip_hook])cube([joint_clip_hook_l+2*snap_clearance,joint_clip_w+2*snap_clearance+2*eps,joint_clip_hook+eps]);}}

function p3_snap_metrics()=[["P3 J spring clip",joint_clip_t,joint_clip_hook-joint_clip_gap+0.15,joint_clip_tip-joint_clip_spine-joint_clip_root_r,joint_clip_hook-joint_clip_gap]];

// Exactly two removable glue dots bridge the OUTSIDE F/G seam. Not a printed part.
module p3_joint_glue(){for(x=[outer_x,outer_x+outer_w])translate([x,joint_glue_y,hood_joint_z])scale([joint_glue_depth,joint_glue_length/2,joint_glue_height/2])sphere(r=1);}
