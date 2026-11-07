use </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/lcd1602_pod.scad>
use </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/p2_relay.scad>
intersection(){
lcd_pod_place(){lcd_pod_base();lcd_pod_lcd();lcd_pod_female_ends();}
p2_button();
}
