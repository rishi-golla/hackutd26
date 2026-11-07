use </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/snap_v2/p2_relay.scad>
intersection(){
minkowski(){ p2_button(); cube([9.78,9.78,9.78],center=true); }
p2_bread();
}
