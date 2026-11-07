use </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/p2_relay.scad>
intersection(){
minkowski(){p2_pi_posts();cube([5.98,5.98,5.98],center=true);}
p2_pi_heatsinks();
}
