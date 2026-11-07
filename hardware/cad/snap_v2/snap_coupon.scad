include <common.scad>
use <p1_bodycam.scad>
use <p2_relay.scad>
use <p3_finger_clip.scad>
// Eight pieces, each with the actual full beam, root and wider backing.
coupon_piece = -1;            // -1 prints complete plate; 0..7 isolates one bed-oriented piece.
coupon_mark = "20";           // Must match snap_clearance x 100; embossed v2 distinguishes old plates.
module raw_piece(i){
 if(i==0)p1_coupon_receiver();
 if(i==1)p1_coupon_key();
 if(i==2)p2_coupon_catch();
 if(i==3)p2_coupon_lid();
 if(i==4)p2_coupon_pi_receiver();
 if(i==5)p2_coupon_pi_board();
 if(i==6)p3_clip_print();
 if(i==7)p3_coupon_flange();
}
if(coupon_piece>=0)raw_piece(coupon_piece);
module tag(){
 translate([-11.8,0,0])cube([12,4,0.8]);
 translate([-5.8,2,0.8-eps])linear_extrude(0.4+eps)text(str("v2 ",coupon_mark),size=2.35,halign="center",valign="center",font="Liberation Sans:style=Bold");
}
if(coupon_piece<0) {
 p1_coupon_receiver();tag();translate([46,0,0])p1_coupon_key();
 translate([0,30,0]){p2_coupon_catch();tag();}translate([20,30,0])p2_coupon_lid();
 translate([0,56,0]){p2_coupon_pi_receiver();tag();}translate([16,56,0])p2_coupon_pi_board();
 translate([33,62,0])p3_clip_print();translate([61,56,0]){p3_coupon_flange();translate([35.8,0,0])tag();}
}
