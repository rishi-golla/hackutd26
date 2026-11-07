use </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/p2_relay.scad>
intersection(){
minkowski(){ p2_pi(); cube([5.98,5.98,5.98],center=true); }
p2_lid_skin();
}
