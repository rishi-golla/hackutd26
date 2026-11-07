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
