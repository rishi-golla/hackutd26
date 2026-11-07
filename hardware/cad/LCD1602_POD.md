# LCD1602 pod — optional add-on for the existing relay

[STL](stl/lcd1602_pod.stl) · [Bed view](../manual/img/lcd_pod_bed.png) · [Mounted view](../manual/img/lcd_pod_on_box_labeled.png) · [Unpowered wiring fit](../manual/img/lcd_pod_wiring.png)

The open pod stands on the already printed D lid. **Do not reprint or drill C/D.** The existing left whole-stack strap, at X=36 mm, passes over the pod's centre spine between its guides. The right strap stays in its current position. The LCD face is **20° above the lid**, tilted toward the **USB-C side** of the relay. Four plain pegs locate the board; four tiny hot-glue caps at the LCD mounting holes retain it. No glue touches the Pi.

## Measure before printing

These are fit assumptions, not a SunFounder mechanical drawing. All adjustable values are named `lcd_pod_*` in [lcd1602_pod.scad](lcd1602_pod.scad).

| Assumption | Default / variable | What to check |
|---|---|---|
| PCB outline and thickness | `lcd_pod_pcb=[80,36,1.6]` mm | Measure the actual board; no case is assumed. |
| Hole pattern, centred on PCB | `lcd_pod_hole_pitch=[75,31]` mm | Centre-to-centre in both directions. |
| Hole diameter | `lcd_pod_hole_d=3.0` mm; expected 3.0–3.4 mm | Printed pegs are Ø2.4, not interference pins. |
| Bezel, centred on PCB | `lcd_pod_bezel=[71,24,7]` mm | Seven millimetres above the PCB front; never load the glass. |
| Backpack envelope | `lcd_pod_backpack=[45,20,12]` mm | Assumed outline/depth behind PCB, including components. |
| Backpack placement | `lcd_pod_backpack_xy=[28,2]` mm | From PCB lower-left corner in the model; keep it off the four supports. |
| Header | +X end, 2.54 mm pitch, 6 mm exposed pins | Check actual direction and the **printed signal labels**, not wire colour alone. |
| Header location | `lcd_pod_header_y=11`, `lcd_pod_header_back=7` mm | Four-pin centreline and depth behind PCB. |
| Contrast pot | Centre `[65,10]`, envelope `[7,7,5]` mm | Must remain exposed behind the LCD, away from the centre strap. |
| Female housing | `lcd_pod_female=[14,2.54,2.54]` mm | Axial length × square section. |
| Strap | Up to 13 × 1.2 mm; 13.6 mm channel | Existing strap must retain enough fastening overlap after rising 2.4 mm over the spine. |

The pod is **87 × 46 × 31.361 mm**, volume **6.821 cm³**. Its base is at `(0,10,39.4)` on the current relay. The right strap has **2.5 mm lateral clearance** from the pod. The LCD and its modeled female plugs stay left of the MARK button. The feet and guides leave **99.38% of the actual lid-vent opening area unblocked**; this is geometry, not a thermal-performance test. Air can pass through the open space beneath the display.

## Fit and assembly

1. Measure the PCB and hole pattern against the table.
2. Print the pod flat in the supplied orientation.
3. Remove the brim and smooth the small guides.
4. Lower the LCD onto all four pegs; the PCB must rest flat on all four pads.
5. Check the backpack, header and blue pot clear the printed posts and strap channel.
6. Add one small hot-glue cap over each peg at its PCB hole, no larger than roughly Ø3.4 mm; keep all glue off bezel, glass, components and connectors.
7. Loosen the left whole-stack strap.
8. Set the pod on the left end of D, with its display facing the USB-C side.
9. Thread the left strap **over the pod's flat centre spine**, between the guides and below the LCD; do not put the strap over the display.
10. Tighten that strap enough to keep the pod stable, retaining the usual secure overlap.
11. Check the right strap and MARK button remain free.

The blue contrast pot stays exposed from behind/under the display. For adjustment, loosen this one strap and lift the pod slightly; the LCD stays on its pegs. Leave a loose service loop in the four leads. Do not force a tool between the display and the closed lid.

## Wiring — unpowered fit first

**This is the coordinator's 3.3 V-only plan. Do not connect the LCD to a 5 V pin.** SunFounder's documentation describes a nominal 5 V display with SDA/SCL pull-ups to VCC; Raspberry Pi GPIO is not 5 V tolerant. Supplying this kit display at 3.3 V avoids the specified 5 V pull-up connection, but does not guarantee good contrast or reliable LCD operation. If the display is unusable at 3.3 V, omit it as planned. [SunFounder LCD guide](https://docs.sunfounder.com/projects/davinci-kit/en/latest/1.1.7_i2c_lcd1602.html), [Raspberry Pi GPIO documentation](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html).

Use **six female–male jumpers**: four on the LCD header and two on Pi physical pins 3 and 5. The existing 170-point breadboard has rows **1–17**. Row 1 is nearest the Pi; a–e are the rear half, f–j the USB-C/front half. Rows 16/17 on f–j are unused by the existing build.

| From | To | Existing connection / meaning |
|---|---|---|
| LCD GND | **d5** | Same rear row as c5 → Pi pin 9 ground |
| LCD VCC | **d7** | Same rear row as c7 → Pi pin 17, **3.3 V** |
| Pi physical pin **3** | **g16** | SDA into the free front half |
| LCD SDA | **h16** | Same connected front row as g16 |
| Pi physical pin **5** | **g17** | SCL into the free front half |
| LCD SCL | **h17** | Same connected front row as g17 |

1. Disconnect relay power before fitting the jumpers.
2. Check the SHIM is correctly aligned and fully seated.
3. Measure the exposed metal on pins 3 and 5 above the SHIM: aim for **at least 4 mm** for the female contacts.
4. Fit the two Pi female ends only if they grip securely without pushing the SHIM sideways.
5. Run those two wires above the existing routes toward g16/g17, keeping them away from the lid posts.
6. Feed the four LCD leads' male ends through the **third lid vent from the left**, the X=77–80.2 mm slot, one at a time.
7. Put the four male ends into d5/d7/h16/h17 as listed.
8. Fit the female ends to the LCD's matching GND/VCC/SDA/SCL pins.
9. Place the four wires between the pod's small guide fences and along the vent, without trapping insulation under a foot or strap.
10. Leave roughly **30 mm of loose service length** outside, sufficient to lift/tilt the pod for contrast adjustment.
11. Dry-close the lid without strap force; it must seat flush with no wires under the posts.

The existing vent is **3.2 × 28 mm**. A square 2.54 mm housing passes aligned with **0.33 mm clearance per side**; the pod guide leaves **0.23 mm per side**. Feed singly, with no four-wide connector block. No USB-C opening or new lid hole is needed. Smooth burrs rather than forcing the end through.

The modeled runs **between housings** are about 94/100/127/134 mm for GND/VCC/SDA/SCL, and 137/138 mm for the two Pi-to-breadboard leads. Choose **20–30 cm jumpers**, checking their actual free-wire length: the longest LCD wire needs about **164 mm of wire plus its housings** to provide the 30 mm service loop. Use a longer lead if necessary; do not tension the LCD pins. Keep excess outside the box, loosely curved, clear of MARK and both straps.

### The SHIM contact gate is real

The old conservative SHIM reference has its top at Z=18.4 mm and GPIO tips at Z=19.1 mm: only **0.7 mm modeled exposure**. That does **not** establish reliable contact. The clearance screen places 14 mm female bodies at Z=18.6–32.6 mm, above that high reference; it proves available space and ≥2 mm clearance to the lid posts, not a working electrical engagement. SparkFun describes the thin, fully pressed-down SHIM as compatible with stacked HATs, but Alan must check his actual seating and exposed pins. [SparkFun SHIM guide](https://learn.sparkfun.com/tutorials/qwiic-shim-for-raspberry-pi-hookup-guide/all).

If the sockets cannot grip pins 3/5 securely, stop this add-on and report the measured exposure. Routing through a breadboard does not create an alternative SDA/SCL connection to the Pi by itself. Do not solder, force or glue the Pi/SHIM to compensate.

## Print settings and limitations

**PLA, 0.4 mm nozzle, 0.20 mm layers, 4 walls, 6 top/bottom layers, 25% gyroid, 3 mm brim, no supports.** Keep the flat base down and pegs up, exactly as supplied. Estimated **35–45 minutes, 8–9.3 g / 2.7–3.1 m filament** including allowance. Time assumes 4 mm³/s average deposition plus travel/cooling; tiny peg layers can add time. No slicer is installed.

The final STL is **148,284 bytes**, SHA-256 `ae3edd246e31429889baec1af7eaafd35b5717a5417a3ed380c9a591092cc741`. `cad/.venv/bin/python cad/verify.py` exports it with the existing parts and checks the full supported clearance sweep. C/D and the previous STLs are unchanged.

Physical dimensions, glue adhesion, strap grip, exposed pin length and the actual LCD's 3.3 V behavior remain fit gates. The pod is an open support, not a sealed protective enclosure. Avoid bending the PLA pegs or lifting the whole relay by the display.
