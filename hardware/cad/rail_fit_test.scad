include <common.scad>
use <p1_bodycam.scad>
// Optional rigid rail pair. Same bed/layer direction, backed key, no springs.
module rail_receiver(){p1_rail_test_receiver();}
module rail_key(){union(){p1_rail_test_key();translate([0,5,0])cube([28,6.6,4]);}}
module rail_key_seated(dx=0){translate(p1_rail_test_offset()+[dx,0,0])rail_key();}
rail_receiver();
translate([0,24,0])rail_key();
