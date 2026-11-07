use </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/lcd1602_pod.scad>
use </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/p2_relay.scad>
intersection(){
minkowski(){lcd_pod_bb_housings();cube([3.98,3.98,3.98],center=true);}
p2_pi_posts();
}
