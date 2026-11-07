// HANDOFF — millimetres. Shared printable and reference dimensions.
// All nominal fits need a physical coupon: do not compensate CAD by scaling STLs.
$fn = 64;                     // Curve resolution; raise for smoother large arcs.
eps = 0.02;                   // Boolean overlap only; not a fit allowance.
// Screw-free fit control: increase for a tighter-printing machine; do not scale STLs.
snap_clearance = 0.30;         // Master tuning value; actual gaps differ by joint (see FIT_TEST.md). Default held pending print test.
snap_strain_limit = 0.015;     // Conservative 1.5% nominal beam strain SCREEN, not a strength certification.
assert(snap_clearance>=0.15 && snap_clearance<=0.45,"Use snap_clearance 0.15 to 0.45 mm and test the coupon");
function beam_strain(t,d,L) = 1.5*t*d/(L*L);
fit_clearance = 0.4;           // General clearance per mating side.
wall = 2.4;                    // Six 0.4 mm extrusion widths.
screw_d = 2.9;                 // M2.5 clearance bore; tune to printer.
nut_af = 5.0;                  // Measure nylon M2.5 nuts across flats.
nut_h = 2.0;                   // Measure nylon nut thickness.
nut_clearance = 0.2;           // Added to AF and depth, NOT to every face.
nut_pocket_af = nut_af + nut_clearance;
nut_pocket_h = nut_h + nut_clearance;
nut_bearing_web = 1.2;         // Solid web toward screw head: six 0.2 mm layers.
assembly_screw_l = 6;          // Available M2.5 screw length UNDER its head.
assembly_screw_head_d = 5;     // Reference nylon head envelope; measure actual kit.
assembly_screw_head_h = 2;
standoff_af = 5.0;             // Approximate kit hex standoff AF.
label_depth = 0.6;             // Recess/emboss depth; red paint after printing.
graphite = [0.12,0.14,0.16];    // Render colours only.
signal_red = [0.85,0.045,0.06];

// De-facto GoPro fit, not a manufacturer tolerance drawing. Print mount_test.
gopro_finger = 3.0;            // Thickness of each of our TWO ears.
gopro_gap = 3.2;               // Gap accepting the buckle's middle ear.
gopro_hole = 5.2;              // M5 clearance; teardrop adds a 45-degree roof.
gopro_radius = 7.5;            // Outer ear radius (15 mm diameter).
gopro_axis_z = 12.0;           // Hinge height above the mounting face.
gopro_foot_x = 24;             // Spread bending load into the back plate.
gopro_foot_y = 26;
gopro_foot_h = 2.4;

// Pixel 9 Pro, bare phone. x=portrait length, y=portrait width.
phone_l = 152.8;
phone_w = 72.0;
phone_t = 8.5;
phone_r = 9.5;                 // UNKNOWN: measure corner radius before full print.
phone_clearance = 0.4;         // Clearance PER SIDE; padding is additional.
camera_bar_w = 61;             // ESTIMATE across portrait width: MEASURE.
camera_bar_h = 19;             // ESTIMATE along portrait length: MEASURE.
camera_bar_top = 9.5;          // ESTIMATE top of phone to nearest bar edge.
camera_bar_side_offset = 0;    // Signed bar centre offset across portrait width.
camera_bar_protrusion = 3.6;   // Case-maker estimate; measure actual phone.
camera_margin = 2.0;           // Minimum free margin on each side of bar.
phone_button_start = 25;       // Portrait top to beginning of combined button relief.
phone_button_length = 59;      // Relief includes power + volume; measure with case off.
phone_button_depth = 2.0;      // Radial envelope of protruding buttons (conservative).
phone_end_slot_width = 48;     // Bottom USB-C, speaker and mic relief across width.
phone_mic_slot_width = 34;     // Top edge mic relief across width.

// Pi official drawing. x=85 mm axis, y=56 mm axis, bottom edge y=0.
pi_l = 85;
pi_w = 56;
pi_pcb = 1.6;                  // Typical PCB thickness; check actual board.
pi_r = 3;
pi_hole_d = 2.7;
pi_hole_x = [3.5,61.5];
pi_hole_y = [3.5,52.5];
pi_usb_c_x = 11.2;             // CORRECTED: left hole datum 3.5 + 7.7, NOT 7.7.
pi_hdmi_x = [26.0,39.5];        // Same official dimension chain.
pi_av_x = 54.0;
pi_port_overhang = 3.2;        // Conservative beyond right board edge.
pi_usb_h = 16;
pi_eth_h = 13.5;
pi_heatsink_h = 12;            // Envelope above PCB, includes chip/adhesive allowance.
pi_header_h = 8.5;
shim_w = 10.2;
shim_l = 14;
shim_t = 0.8;                  // Conservative pressed-PCB model; verify purchased part.

// Adafruit 938. Board, hole pattern and glass offset follow official fab print.
oled_w = 35.56;
oled_l = 33.02;
oled_pcb = 1.6;
oled_depth = 6.2;              // Glass top above PCB bottom, conservative envelope.
oled_back_depth = 3.0;         // Extra conservative rear Qwiic/component depth.
oled_hole_x = [2.54,33.02];     // 30.48 mm pattern, centered on board.
oled_hole_y = [2.54,30.48];       // 27.94 mm pattern.
oled_hole_d = 2.5;
oled_glass_w = 34.544;
oled_glass_l = 23.114;
oled_glass_y = 5.08;           // Official fab print; y=0 is HEADER edge.
oled_active_w = 29.42;
oled_active_l = 14.7;
oled_active_y = 16.637;          // ESTIMATE centre from HEADER edge; visual only, measure.

// Other purchased parts; enlarged plug/connector envelopes are intentional.
button_hole_d = 16.4;          // 16 nominal + diametral allowance.
button_body_d = 15.8;
button_head_d = 19;
button_head_h = 2.5;
button_body_depth = 12;
button_nut_af = 21;            // Conservative nut envelope: verify HBAN item.
button_nut_h = 3;
button_plug_w = 18;            // Conservative socket width; measure supplied plug.
button_plug_depth = 25;        // Total below OUTER lid surface, includes plug.
// Unbranded example bank only; user supplies their own. No enclosure pocket depends on this size.
bank_l = 149;
bank_w = 68;
bank_t = 14;
bread_l = 45;                  // Confirmed ELEGOO B09ZQPRFTB, corrected Oct 31.
bread_w = 34.5;
bread_h = 9.5;

// SparkFun SEN-16474: top edge is y=25.4.
sensor_board = 25.4;
sensor_pcb = 1.6;
sensor_hole_inset = 2.54;
sensor_hole_d = 3.3;
sensor_top_offset = 2.8;       // Official 0.11 inch, rounded by spec.
sensor_w = 5.6;
sensor_l = 3.3;
sensor_h = 1.55;
qwiic_w = 5.5;                 // Envelope along board x at left/right edges.
qwiic_l = 6.5;                 // Along y; verify connector and cable plug.
qwiic_h = 3.2;                 // Conservative top-side connector height.

// Secondary reference envelopes. Change only after measuring purchased parts.
fastener_nominal_d = 2.5;       // Nominal threaded hardware, distinct from printed bore.
reference_standoff_h = 6;      // Default physical spacer height.
default_corner_r = 2;          // Generic utility radius; part-specific radii override it.
gopro_foot_r = 3;              // Mount-foot planar corner radius.
phone_lens_y = [-19,0,19];     // Illustrative lens centres; not optical metrology.
phone_lens_d = 10;
phone_detail_t = 0.05;         // Thin visual screen/lens layers.
phone_screen_inset = 2;        // Visual display margin per side.
phone_screen_radius_inset = 1;
phone_button_z = 2.7;         // Conservative button-envelope bottom above screen.
phone_button_h = 3.1;
pi_usb_x = 67;                // USB stack left edge from PCB datum.
pi_usb_y = [2,20];            // Two USB stacks along right edge.
pi_usb_w = 14;                // Stack extent along Y.
pi_eth_x = 66.5;
pi_eth_y = 39;
pi_eth_w = 16;
pi_usb_c_size = [9,7,3.2];     // X/Y/Z metal-shell envelope.
pi_usb_c_overhang = 1.2;       // Beyond bottom PCB edge.
pi_hdmi_size = [7,6,3];
pi_hdmi_overhang = 1.2;
pi_av_size = [7,14,6];
pi_av_overhang = 1;
pi_sd_pos = [-1,18,-2.2];     // Underside card socket envelope.
pi_sd_size = [14,16,2.2];
pi_header_pos = [7.5,48.5];
pi_header_size = [51,5.5];
pi_soc_pos = [21.75,25];       // Conservative heatsink footprint, verify actual kit.
pi_soc_size = [15,15];
pi_aux_sink_pos = [39,26];
pi_aux_sink_size = [12,12,8];
shim_pos = [7.5,41,7];        // Z relative to Pi PCB top.
shim_connector_pos = [9,40];
shim_connector_size = [6.5,5.5,3.2];
oled_corner_r = 2;
oled_visual_t = 0.02;         // Visual active surface only.
oled_connector_w = 6;
oled_connector_l = 7;
oled_connector_y = 12;        // Rear side-entry connector envelope.
button_ring_outer_d = 16;     // Visual light-ring diameters.
button_ring_inner_d = 13.5;
button_ring_t = 0.05;
button_reference_panel_t = 2.4;
bank_corner_r = 6;
bread_corner_r = 2;
sensor_optical_size = [2,1.6,0.01]; // Illustrative die/window on sensor top.
sensor_connector_overhang = 0.5; // Outside PCB edge.
sensor_ic_pos = [7,6];        // Conservative low-component cluster from photo.
sensor_ic_size = [11,13,1];
// A rounded rectangle made of exact circular arcs; radius must fit outline.
module rounded2d(size, r) {
    assert(r > 0 && min(size) >= 2*r);
    hull() for(x=[r,size[0]-r], y=[r,size[1]-r]) translate([x,y]) circle(r=r);
}
module rounded_box(size, r=default_corner_r) { linear_extrude(height=size[2]) rounded2d([size[0],size[1]],r); }
module centered_box(size,r=default_corner_r) { translate([-size[0]/2,-size[1]/2,0]) rounded_box(size,r); }
module screw_bore(h) { cylinder(d=screw_d,h=h); }
module nut_pocket(h=nut_pocket_h) { cylinder(d=nut_pocket_af/cos(30),h=h,$fn=6); }
// Subtract this sideways slot; rotate about Z to point entry toward an accessible side.
// Nut axis stays Z. The adjoining part must retain nut_bearing_web toward the screw head.
module side_nut_pocket(reach,h=nut_pocket_h) {
    hull(){nut_pocket(h);translate([reach,0,0])nut_pocket(h);}
}
module hex_nut() { difference(){cylinder(d=nut_af/cos(30),h=nut_h,$fn=6);translate([0,0,-eps])cylinder(d=fastener_nominal_d,h=nut_h+2*eps);} }
// Shaft starts at z=0, head is below it. Rotate 180 degrees for a downward screw.
module assembly_screw() { cylinder(d=fastener_nominal_d,h=assembly_screw_l);translate([0,0,-assembly_screw_head_h])cylinder(d=assembly_screw_head_d,h=assembly_screw_head_h); }
// Required continuous printed bearing annulus, for verification by set difference.
module bearing_web(h=nut_bearing_web) { difference(){cylinder(d=nut_af,h=h);translate([0,0,-eps])screw_bore(h+2*eps);} }
module hex_standoff(h=reference_standoff_h) { difference(){ cylinder(d=standoff_af/cos(30),h=h,$fn=6); translate([0,0,-eps]) cylinder(d=fastener_nominal_d,h=h+2*eps); } }
// Circular lower hole and tangential 45-degree roof. Axis is local extrusion Z.
module teardrop2d(d) { r=d/2; union(){circle(r=r); polygon([[-r/sqrt(2),r/sqrt(2)],[0,r*sqrt(2)],[r/sqrt(2),r/sqrt(2)]]);} }
// Two ears stand UP from z=0. Hinge axis X, parallel to landscape phone long axis.
module gopro_two_prong(){
    difference(){
        union(){
            centered_box([gopro_foot_x,gopro_foot_y,gopro_foot_h],gopro_foot_r);
            for(x=[-gopro_gap/2-gopro_finger,gopro_gap/2])
                translate([x,0,0]) rotate([90,0,90]) linear_extrude(gopro_finger)
                    union(){translate([-gopro_radius,0]) square([2*gopro_radius,gopro_axis_z]); translate([0,gopro_axis_z]) circle(r=gopro_radius);}
        }
        translate([-gopro_foot_x,0,gopro_axis_z]) rotate([90,0,90]) linear_extrude(2*gopro_foot_x) teardrop2d(gopro_hole);
    }
}
module label(txt,size=5,h=label_depth){ linear_extrude(h) text(txt,size=size,font="Helvetica:style=Bold",halign="center",valign="center"); }
