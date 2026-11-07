include <common.scad>
use <p1_bodycam.scad>
use <p2_relay.scad>
use <p3_finger_clip.scad>
part="all";                  // Eight intentionally separate pieces: four actual interfaces.
row_pitch=23;                // Bed layout only; never changes joint dimensions.
column_pitch=46;             // Bed layout only.
// P1 one side: slide together, squeeze latch, slide apart.
p1_coupon_receiver();
translate([column_pitch,0,0])p1_coupon_key();
// P2 lid: press the paddle under the catch bridge; push inward to release.
translate([0,row_pitch,0])p2_coupon_catch();
translate([20,row_pitch,0])p2_coupon_lid();
// Pi: mock PCB onto peg, flex clip out before lifting board.
translate([0,2*row_pitch,0])p2_coupon_pi_receiver();
translate([14,2*row_pitch,0])p2_coupon_pi_board();
// J: slide onto the paired-flange surrogate until the hook enters its notch.
translate([31,2*row_pitch+6,0])p3_clip_print();
translate([58,2*row_pitch,0])p3_coupon_flange();

// Optional ladder identification: exterior bed tabs do not change mating surfaces.
// Set coupon_mark="20" etc together with snap_clearance=0.20; blank preserves layout.
coupon_mark="";
coupon_mark_h=0.4;            // Two layers of raised digits.
coupon_tab_h=1.0;
module coupon_tag(x,y,w=8,h=6){
 translate([x,y,0])cube([w,h,coupon_tab_h]);
 translate([x+w/2,y+h/2,coupon_tab_h-eps])linear_extrude(coupon_mark_h+eps)
 text(coupon_mark,size=4,halign="center",valign="center",font="Liberation Sans:style=Bold");
}
if(coupon_mark!=""){
 coupon_tag(-7.8,0);                // P1 receiver, outside the rail.
 coupon_tag(-7.8,row_pitch,8,4.8);  // P2 catch, outside the paddle.
 coupon_tag(-7.8,2*row_pitch);      // Pi peg receiver, outside mock PCB.
 coupon_tag(81.8,2*row_pitch,8,5);  // J flange surrogate, beyond clip travel.
}
