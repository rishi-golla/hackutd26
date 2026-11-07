include <../p3_finger_clip.scad>
for(x=[-0.5,sensor_board-qwiic_w+0.5])translate([x,(sensor_board-qwiic_l)/2,board_seat_z+sensor_pcb])cube([qwiic_w,qwiic_l,qwiic_h]);
