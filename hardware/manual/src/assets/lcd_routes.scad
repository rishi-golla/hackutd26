use </Users/alantai/Documents/Hackathons/HackUTD-2026/hardware/cad/lcd1602_pod.scad>
echo([ [for(i=[0:3])lcd_pod_wire_route(i)], [for(i=[0:1])lcd_pod_gpio_route(i)] ]);
