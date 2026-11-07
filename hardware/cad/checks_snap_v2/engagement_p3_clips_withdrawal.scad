use </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/snap_v2/p3_finger_clip.scad>
intersection(){
union(){p3_tray();p3_hood();}
translate([-1,0,0])p3_clips();
}
