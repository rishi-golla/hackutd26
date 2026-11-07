include <../p3_finger_clip.scad>
translate([(sensor_board-sensor_w)/2,sensor_board-sensor_top_offset-sensor_l/2,sensor_top_z])cube([sensor_w,sensor_l,0.1]);
