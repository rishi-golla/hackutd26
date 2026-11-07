include <common.scad>
use <p2_relay.scad>
use <models/pi4.scad>
// Optional add-on only. Existing C, D and both strap positions are unchanged.
// All LCD dimensions below are ASSUMED until Alan measures the actual module.
part = "pod";                       // pod is already on the bed; assembly is a reference view.
lcd_pod_pcb = [80,36,1.6];           // Actual LCD PCB length, width, thickness.
lcd_pod_hole_pitch = [75,31];        // Centre-to-centre pattern; nominal holes assumed 3.0–3.4 mm.
lcd_pod_hole_d = 3.0;               // Smallest assumed board hole, used in reference model.
lcd_pod_peg_d = 2.4;                // Plain locating pegs: 0.3 mm radial allowance at 3.0 mm hole.
lcd_pod_peg_extra = 1.2;            // Projection beyond PCB for four small hot-glue caps.
lcd_pod_pad_d = 4.6;               // Back-side PCB corner-ring support; never against bezel/glass.
lcd_pod_bezel = [71,24,7];          // Front envelope above PCB front; measure before fitting.
lcd_pod_backpack = [45,20,12];      // Assumed PCF8574 board/component envelope behind LCD PCB.
lcd_pod_backpack_xy = [28,2];       // Measure backpack location from PCB lower-left corner.
lcd_pod_header_y = 11;             // Four-pin centre, relative to LCD PCB; header exits +X.
lcd_pod_header_back = 7;            // Header centre behind PCB back surface.
lcd_pod_header_pin_l = 6;           // Exposed sideways male pin length.
lcd_pod_header_pitch = 2.54;
lcd_pod_female = [14,2.54,2.54];    // Axial length, width, height: conservative connector body.
lcd_pod_pot_xy = [65,10];           // Assumed blue contrast-pot centre, measured on PCB back.
lcd_pod_pot_size = [7,7,5];
lcd_pod_angle = 20;                 // Degrees ABOVE horizontal lid; faces USB-C wall (Y=0).
lcd_pod_pcb_origin = [3.5,4,17];    // PCB back plane: 17 mm high at its near edge.
lcd_pod_size = [87,46];             // Base footprint: leaves X=96 strap clear.
lcd_pod_on_box = [0,10,39.4];       // Current closed D top; no changes to D required.
lcd_pod_floor = 2.4;
lcd_pod_rail_w = 6;                 // Front/rear rails land beyond the vent openings.
lcd_pod_strap_x = 36;               // Uses ONLY existing left whole-stack strap.
lcd_pod_strap_w = 13;               // Up to 13 mm-wide user strap, <=1.2 mm thick.
lcd_pod_strap_t = 1.2;
lcd_pod_channel_w = 13.6;           // 0.3 mm allowance each side of a 13 mm strap.
lcd_pod_channel_wall = 1.2;
lcd_pod_channel_h = 2;
lcd_pod_spine_w = 19;               // Rigid base spine under strap, clear of lid vents.
lcd_pod_post_foot = 6;              // Six-mm square post feet on front/rear rails.
lcd_pod_post_neck = 4.6;
lcd_pod_cap_d = 3.4;                // Illustrative hot-glue cap; avoid the bezel and glass.
lcd_pod_cap_h = 0.8;
lcd_pod_vent_x = 78.6;              // Third existing 3.2 × 28 mm lid slot, centre in X.
lcd_pod_vent_ys = [23,28,33,38];     // Feed four housings one at a time; wires stay spaced along slot.
lcd_pod_guide_y = 6;                // Guide starts just ahead of vent; local to pod base.
lcd_pod_guide_l = 16;
lcd_pod_guide_gap = 3.0;            // Inner guide width; 0.23 mm each side of square 2.54 mm housing.
lcd_pod_guide_t = 1.2;
lcd_pod_guide_h = 3.2;
lcd_pod_wire_r = 0.55;              // Insulated-wire envelope, not copper diameter.
lcd_pod_gpio_socket_z = 18.6;       // HIGH-SHIM clearance case. Not a claim of enough pin engagement.
lcd_pod_gpio_socket_h = 14;         // Full female body, replacing earlier simplified 6 mm envelope.
lcd_pod_gpio_pin_tip_z = 19.1;      // Existing conservative pin model; expose >=4 mm physically first.
lcd_pod_gpio_route_z = 33.5;        // Stays below lid and above existing wiring.
lcd_pod_service_slack = 30;         // Extra loose wire allowance outside; lift pod to adjust contrast.

function lcd_pod_hole_xy()=[for(x=[(lcd_pod_pcb[0]-lcd_pod_hole_pitch[0])/2,(lcd_pod_pcb[0]+lcd_pod_hole_pitch[0])/2],y=[(lcd_pod_pcb[1]-lcd_pod_hole_pitch[1])/2,(lcd_pod_pcb[1]+lcd_pod_hole_pitch[1])/2])[x,y]];
function lcd_pod_at(p)=lcd_pod_pcb_origin+[p[0],p[1]*cos(lcd_pod_angle)-p[2]*sin(lcd_pod_angle),p[1]*sin(lcd_pod_angle)+p[2]*cos(lcd_pod_angle)];
function lcd_pod_global(p)=lcd_pod_on_box+lcd_pod_at(p);
module lcd_pod_tilt(){translate(lcd_pod_pcb_origin)rotate([lcd_pod_angle,0,0])children();}
module lcd_pod_place(){translate(lcd_pod_on_box)children();}
module lcd_pod_trace(pts,r=lcd_pod_wire_r){for(i=[0:len(pts)-2])hull(){translate(pts[i])sphere(r=r);translate(pts[i+1])sphere(r=r);}}
module lcd_pod_base(){union(){
 for(y=[0,lcd_pod_size[1]-lcd_pod_rail_w])translate([0,y,0])cube([lcd_pod_size[0],lcd_pod_rail_w,lcd_pod_floor]);
 translate([lcd_pod_strap_x-lcd_pod_spine_w/2,0,0])cube([lcd_pod_spine_w,lcd_pod_size[1],lcd_pod_floor]);
 for(s=[-1,1])translate([lcd_pod_strap_x+s*lcd_pod_channel_w/2-(s<0?lcd_pod_channel_wall:0),0,lcd_pod_floor-eps])cube([lcd_pod_channel_wall,lcd_pod_size[1],lcd_pod_channel_h+eps]);
 // Two open guide fences straddle the vent rather than blocking its opening.
 for(s=[-1,1])translate([lcd_pod_vent_x+s*lcd_pod_guide_gap/2-(s<0?lcd_pod_guide_t:0),lcd_pod_guide_y,0])cube([lcd_pod_guide_t,lcd_pod_guide_l,lcd_pod_guide_h]);
 translate([lcd_pod_vent_x-lcd_pod_guide_gap/2-lcd_pod_guide_t,lcd_pod_rail_w-eps,0])cube([lcd_pod_guide_gap+2*lcd_pod_guide_t,lcd_pod_guide_y-lcd_pod_rail_w+2*eps,lcd_pod_floor]);
 for(p=lcd_pod_hole_xy())let(q=lcd_pod_at([p[0],p[1],-0.8]),fy=p[1]<lcd_pod_pcb[1]/2?lcd_pod_rail_w/2:lcd_pod_size[1]-lcd_pod_rail_w/2){
  hull(){
   translate([q[0]-lcd_pod_post_foot/2,fy-lcd_pod_post_foot/2,0])cube([lcd_pod_post_foot,lcd_pod_post_foot,lcd_pod_floor]);
   lcd_pod_tilt()translate([p[0],p[1],-1.5])cylinder(d=lcd_pod_post_neck,h=1.5);
  }
  lcd_pod_tilt()translate([p[0],p[1],-eps]){cylinder(d=lcd_pod_peg_d,h=lcd_pod_pcb[2]+lcd_pod_peg_extra-.35+eps);translate([0,0,lcd_pod_pcb[2]+lcd_pod_peg_extra-.35])cylinder(d1=lcd_pod_peg_d,d2=lcd_pod_peg_d-.7,h=.35);}
 }
}}
module lcd_pod_board(){lcd_pod_tilt()difference(){cube(lcd_pod_pcb);for(p=lcd_pod_hole_xy())translate([p[0],p[1],-eps])cylinder(d=lcd_pod_hole_d,h=lcd_pod_pcb[2]+2*eps);}}
module lcd_pod_bezel(){lcd_pod_tilt()translate([(lcd_pod_pcb[0]-lcd_pod_bezel[0])/2,(lcd_pod_pcb[1]-lcd_pod_bezel[1])/2,lcd_pod_pcb[2]])cube(lcd_pod_bezel);}
module lcd_pod_backpack(){lcd_pod_tilt()translate([lcd_pod_backpack_xy[0],lcd_pod_backpack_xy[1],-lcd_pod_backpack[2]])cube(lcd_pod_backpack);}
module lcd_pod_pot(){lcd_pod_tilt()translate([lcd_pod_pot_xy[0]-lcd_pod_pot_size[0]/2,lcd_pod_pot_xy[1]-lcd_pod_pot_size[1]/2,-lcd_pod_backpack[2]-eps])cube(lcd_pod_pot_size);}
function lcd_pod_header_point(i)= [lcd_pod_backpack_xy[0]+lcd_pod_backpack[0]+lcd_pod_header_pin_l,lcd_pod_header_y+(i-1.5)*lcd_pod_header_pitch,-lcd_pod_header_back];
module lcd_pod_header(){lcd_pod_tilt()for(i=[0:3])let(p=lcd_pod_header_point(i))translate([p[0]-lcd_pod_header_pin_l,p[1]-.32,p[2]-.32])cube([lcd_pod_header_pin_l,.64,.64]);}
module lcd_pod_female_ends(){lcd_pod_tilt()for(i=[0:3])let(p=lcd_pod_header_point(i))translate([p[0]-3,p[1]-lcd_pod_female[1]/2,p[2]-lcd_pod_female[2]/2])cube(lcd_pod_female);}
module lcd_pod_glue(){lcd_pod_tilt()for(p=lcd_pod_hole_xy())translate([p[0],p[1],lcd_pod_pcb[2]])cylinder(d=lcd_pod_cap_d,h=lcd_pod_peg_extra+lcd_pod_cap_h);}
module lcd_pod_lcd(){lcd_pod_board();lcd_pod_bezel();lcd_pod_backpack();lcd_pod_header();}
// Strap follows the existing full-stack route and climbs only 2.4 mm over the pod base spine.
module lcd_pod_stack_strap(){translate([lcd_pod_strap_x-lcd_pod_strap_w/2,0,0])rotate([90,0,90])linear_extrude(lcd_pod_strap_w)difference(){
 offset(delta=lcd_pod_strap_t)polygon([[.6,-14],[77.4,-14],[77.4,39.4],[56,41.8],[10,41.8],[.6,39.4]]);
 polygon([[.6,-14],[77.4,-14],[77.4,39.4],[56,41.8],[10,41.8],[.6,39.4]]);
}}
// The 170-point board has rows 1–17. a–e are rear; f–j are front.
function lcd_pod_bb(row,col)=[107.18+2.54*(row-1),42.22-2.54*(col<5?col:col+2),12.5];
function lcd_pod_lcd_dest(i)= i==0?lcd_pod_bb(5,3):i==1?lcd_pod_bb(7,3):i==2?lcd_pod_bb(16,7):lcd_pod_bb(17,7);
function lcd_pod_wire_route(i)=let(p=lcd_pod_global(lcd_pod_header_point(i)),d=lcd_pod_lcd_dest(i),y=lcd_pod_vent_ys[i])[
 p+[lcd_pod_female[0]-3,0,0], [100+i*.8,p[1]+3,p[2]-3], [100+i*.8,29+i*4,44], [lcd_pod_vent_x,y,44], [lcd_pod_vent_x,y,41], [lcd_pod_vent_x,y,33], [96+i*2,y,30], [d[0],d[1],23], [d[0],d[1],18.5]];
function lcd_pod_gpio_route(i)=let(x=19.31+2.54*i,d=lcd_pod_bb(16+i,6))[
 [x,59.98,lcd_pod_gpio_socket_z+lcd_pod_gpio_socket_h], [x+7,57-i*2,lcd_pod_gpio_route_z], [75,43-i*3,lcd_pod_gpio_route_z], [112,30-i*3,30], [d[0],d[1],23], [d[0],d[1],18.5]];
module lcd_pod_lcd_wires(gap=0){for(i=[0:3])lcd_pod_trace(lcd_pod_wire_route(i),lcd_pod_wire_r+gap);}
module lcd_pod_gpio_wires(gap=0){for(i=[0:1])lcd_pod_trace(lcd_pod_gpio_route(i),lcd_pod_wire_r+gap);}
module lcd_pod_gpio_housings(gap=0){for(i=[0:1])translate([19.31+2.54*i-1.27-gap,59.98-1.27-gap,lcd_pod_gpio_socket_z-gap])cube([2.54+2*gap,2.54+2*gap,lcd_pod_gpio_socket_h+2*gap]);}
module lcd_pod_bb_housings(){for(i=[0:5])let(d=i<4?lcd_pod_lcd_dest(i):lcd_pod_bb(16+i-4,6))translate([d[0]-1.27,d[1]-1.27,13])cube([2.54,2.54,5.5]);}
module lcd_pod_pass_gauges(){for(y=lcd_pod_vent_ys)translate([lcd_pod_vent_x-1.27,y-1.27,34])cube([2.54,2.54,14]);}
module lcd_pod_vent_apertures(){for(x=[63:7:84])translate([x,20,39.4])rounded_box([3.2,28,.1],1.6);}
module lcd_pod_pi_non_header(){translate([8,10,9]){pi4_ports();pi4_heatsinks();}p2_shim();}
module lcd_pod_all_wires(gap=0){lcd_pod_gpio_wires(gap);lcd_pod_lcd_wires(gap);lcd_pod_gpio_housings(gap);}
function lcd_pod_fit_metrics()=[
 ["lcd_vent_housing_side_gap",(3.2-lcd_pod_female[1])/2,.3],
 ["lcd_guide_housing_side_gap",(lcd_pod_guide_gap-lcd_pod_female[1])/2,.2],
 ["lcd_second_strap_side_gap",89.5-lcd_pod_size[0],2],
 ["lcd_hole_radial_gap",(lcd_pod_hole_d-lcd_pod_peg_d)/2,.2],
 ["lcd_strap_channel_side_gap",(lcd_pod_channel_w-lcd_pod_strap_w)/2,.25]
];
if(part=="pod")lcd_pod_base();
else if(part=="assembly"){p2_base();p2_lid();lcd_pod_place(){color(graphite)lcd_pod_base();color([.1,.4,.1])lcd_pod_lcd();}lcd_pod_stack_strap();}
