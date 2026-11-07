include <../common.scad>
buckle_w=32;                 // Visual approximation only; NOT a printable replacement.
buckle_l=42;
buckle_base=4;
buckle_ear=3;
buckle_gap=3.2;
buckle_axis=15;
buckle_r = 3;                // Planar corners of simplified buckle base.
buckle_ear_r = 7.5;          // Rounded ear envelope; measure the harness coupon.
buckle_bore = 5.2;
buckle_bore_length = 60;     // Boolean cutter spans entire buckle.
module gopro_buckle(){
 color([0.045,0.05,0.06])difference(){
 union(){centered_box([buckle_w,buckle_l,buckle_base],buckle_r);for(x=[-buckle_gap-buckle_ear,0,buckle_gap+buckle_ear])translate([x-buckle_ear/2,0,0])rotate([90,0,90])linear_extrude(buckle_ear)union(){translate([-buckle_ear_r,0])square([2*buckle_ear_r,buckle_axis]);translate([0,buckle_axis])circle(r=buckle_ear_r);}}
 translate([-buckle_bore_length/2,0,buckle_axis])rotate([0,90,0])cylinder(d=buckle_bore,h=buckle_bore_length);
 }
}
gopro_buckle();
