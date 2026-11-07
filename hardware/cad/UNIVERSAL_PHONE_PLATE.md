# Universal phone plate — optional pivot-kit backup

[Download the STL](stl/universal_phone_plate.stl). This is a separate one-piece mount; it does not replace or alter A/B. The landscape hinge uses the same `gopro_two_prong()` module as chest plate B and the passed T1 test: two 3.0 mm ears, 3.2 mm gap, Ø5.2 mm M5 hole. The root adds a 1.6 mm concave fillet below the mating region.

The plate supports phones about **131–164 × 64–78 mm**, with **7–12 mm total contact-to-outward-face thickness**. It has a 128 × 74 mm outline, 4 mm stiffening ribs, 2 mm webs, and two 12 mm-wide bottom ledges projecting 12.6 mm. The central 96 mm between ledges stays open for side buttons. Larger phones overhang it. It has no camera cutout and no fitted enclosure.

## How to use

1. Deburr every edge that will touch the phone or a band.
2. Fit the two ears into the harness buckle using the existing thumbscrew.
3. Put the two short ledges at the bottom when worn landscape.
4. Add optional thin felt or foam tape to the two recessed phone-side pad seats.
5. Rest the phone on both ledges: **screen toward the plate for rear-camera use; back toward the plate for front-camera use**.
6. Put one band around the phone and plate, seated in matching top/bottom edge notches.
7. Put a second band in a well-separated pair of notches.
8. Move either band if it covers a lens, flash, microphone, port or side button; add a third if needed.
9. Set the camera angle and hand-tighten the thumbscrew gently.
10. Test with two hands over a soft surface: tilt forward, sideways and gently bounce. The phone must stay on both ledges without sliding or twisting.

There are four band positions, at X=-44, -24, +24 and +44 mm. Each notch is 14 mm wide and 2 mm deep. The example uses -44/+24, leaving the right-hand camera end clear; reverse that choice for a camera block at the other end. Do not route a band through the GoPro ears. The ledges carry downward weight; the bands provide outward and sideways retention. Check the camera preview before wearing it.

Use **two or three rubber bands, roughly 3–8 mm wide**. The installed loop is about **17–21 cm** over the size range. Soft bands about **14–17 cm unstretched circumference** (7–8.5 cm laid flat) are a starting point, not a required stretch ratio: choose the actual band by a firm, gentle hold. Do not crush the phone or bend the PLA. Alternatively use **two 25–30 cm hook-and-loop straps, up to 13 mm wide**, with at least about 5 cm securely fastened overlap. Keep bulky folded ends off the camera and controls.

A front-mode phone's rear camera bump must not become a pressure point against the plate. If it overlaps the plate, put equal tape pads on flat phone-back areas high enough to clear the bump; count that stand-off in the **12 mm combined thickness**. The two recessed tape seats are on the end ribs. If that cannot be achieved while both ledges support the phone, this plate is not a fit for that case/phone combination. The rectangular range check does not certify every camera bump or button layout.

## Print

- **PLA**, 0.4 mm nozzle, **0.20–0.24 mm layers**, **6 walls**, 6 top/bottom layers, **25% gyroid**. Keep the ears/root solid.
- **Keep the supplied 45° leaning bed orientation**, shown in [the bed picture](../manual/img/b2_bed_universal_plate.png). Do not lay a broad face flat. No supports or folding. Use an **8 mm brim** joining the starting lands; remove it fully afterward.
- Bed envelope: **128 × 55.15 × 54.45 mm**. Three flat starting lands total about **169.7 mm²**. The inclined plate, ledges and window roofs grow at ≤45° overhang; the unchanged M5 bore has short bridge roofs. The flat section of each tilted bore crown is 2.6 mm across, within a 3 mm-thick ear.
- Solid CAD volume: **27.86 cm³**. Estimated **32–38 g / 10.8–12.7 m PLA**, including allowance. About **70–80 minutes** assumes an 8 mm³/s average deposition rate, 30% travel/cooling allowance and a brim. At 4 mm³/s allow **2–2.5 hours**. No slicer is installed; use the slicer's actual estimate and the filament/printer profile rather than forcing speed.
- PLA is rigid and brittle: do not pry the ears apart, overtighten the thumbscrew or use the mount as a handle. Keep it away from hot cars/direct heat. Inspect the root and layer bonds before wearing. This has not been physically drop- or bounce-tested.

## Re-export and verification

From hardware/: `cad/.venv/bin/python cad/verify.py` re-exports this and every other production part and runs the full seven-clearance sweep. The original A/B/T1 dimensions and files remain unchanged.

The verifier checks one watertight, positively wound body at Z=0; unchanged mount geometry; all eight corner combinations of the phone size range; two independent ledge contacts under a 0.5 mm downward movement; flat bed contact; and steep faces restricted to the original short M5-bore roofs. Strength, friction, actual camera/button fit and printed-hole clearance still require the physical check above.
