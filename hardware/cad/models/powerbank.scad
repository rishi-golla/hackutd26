include <../common.scad>
// External envelope/radius in common.scad.
module powerbank(){color([0.07,0.08,0.09])rounded_box([bank_l,bank_w,bank_t],bank_corner_r);}
powerbank();
