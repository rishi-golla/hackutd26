# Verification record — 2026-10-31

## Result and reproducibility

Run `cad/.venv/bin/python cad/verify.py` from `hardware/`. The current pass re-exports all **12** printable STLs with OpenSCAD **2026.10.11, Manifold backend**, and checks the resulting meshes with trimesh. All **111** geometry checks pass: **106** intersection/clearance checks and **5** nut-bearing-web material checks. Every printable STL is a **single connected, watertight, consistently wound, positive-volume solid**, and its supplied bed orientation starts at Z=0. No repair, remeshing or silent mesh cleanup is applied.

The authoritative machine-readable results are [checks/report.json](checks/report.json). Each assembly check has a generated `checks/<name>.scad` witness and matching OpenSCAD log. This directory is regenerated on each run, so stale failures do not remain mixed with current results.

Each component collision check uses a real OpenSCAD `intersection()`. The five web checks use `difference()` to subtract the manufactured part from the required continuous bearing annulus: any missing web material fails. Each source also asserts that its 6 mm screw reaches through the full 2 mm nut. Empty output passes. Mating surfaces may touch: a nonempty result passes only if **every connected result is planar to 0.00001 mm** and aggregate signed volume is below **0.00001 mm³**, with OpenSCAD reporting `NoError`. This permits screw-seat/PCB seating faces, not positive-volume collisions. Tiny coplanar contacts can cause harmless trimesh centre-of-mass warnings because their volume is zero; the tests classify them explicitly as `contact_only`.

Additional clearance witnesses expand a reference component in X/Y/Z using a Minkowski box before intersecting the other part. Tests use 0.01 mm less than the nominal stated margin to avoid numerical tangencies. These are conservative three-dimensional envelope tests, not just a visual inspection or a bounding-box check.

## Measured and derived clearances

Values describe the modeled parts at nominal dimensions, **not measured hardware or FDM tolerances**. A zero clearance is deliberate surface contact. Printed screw/nut allowances are separate from component-fit allowances.

| Interface | Nominal clearance / location | Evidence / implication |
|---|---|---|
| P1 phone body to cavity sidewall | **0.4 mm per side** | 153.6 × 72.8 cavity around 152.8 × 72.0 phone; corner radii increase by the same allowance |
| P1 phone screen/body to flat retaining faces | **0.4 mm** | Rear variant: screen Z=0, chest plate inner face Z=-0.4; rear retaining face Z=8.9, phone back Z=8.5 |
| Front variant camera bar to chest plate | **0.4 mm** | Bar extends to Z=-3.6; plate inner face at Z=-4.0 |
| Rear camera bar to aperture | **2.0 mm at throat**, wider at outward chamfer | Window wall is 1.8 mm; bar front at Z=12.1, enclosure front Z=10.7: **1.4 mm proud** |
| P1 buttons at both longitudinal slot ends | **0.4 mm** | Relief expands conservative 59 mm button envelope by 0.4 at each end; mirrored to correct edge for front mode |
| Approximate GoPro mating faces | **0.1 mm each face** | Two 3 mm ears, 3.2 mm gap; approximate three-ear buckle tested at 15° downward tilt for both variants. Actual buckle still needs coupon. |
| Pi PCB / base | **6.0 mm** | PCB bottom Z=9.0, base floor Z=3.0; 6 mm M/F spacers installed male-up |
| Pi underside screw head → flat base plane | **0.2 mm recessed** | Head Z=0.2–2.2 inside Ø5.4 counterbore; Ø5 × 2 mm head envelope. Explicit below-Z=0 exclusion tests pass. |
| Pi underside screw → female spacer | **5.2 mm thread engagement** | 6 mm screw through 0.8 mm remaining floor; head stays recessed. Actual blind-hole depth is a fit gate; shorten nylon screws if necessary. |
| Power bank → base | **0 mm, flush contact** | Bank top Z=0. No rigid hardware below Z=0; bank/fastener intersections pass. |
| Bank straps → bank/base/Pi/breadboard | **No penetration** | 13 × 0.8 mm reference webbing crosses inside floor at X=36/96, descends outside bank footprint at Y=3.2/74.8, then wraps bank bottom. No webbing is between mating faces. |
| Pi SoC heatsink → OLED rear connector envelope | **3.8 mm vertical** | Highest modeled SoC stack Z=22.6; OLED rear connector bottom Z=26.4. Expanded-reference check passes at 3.79 mm. |
| Pi SoC heatsink → OLED retainer | **3.0 mm vertical** | Retainer bottom Z=25.6. Its rear rail overlaps the SoC envelope in XY, so this is the relevant tight vertical gap. Expanded-reference check passes at 2.99 mm. |
| Pi Ethernet → right retainer edge | **3.5 mm lateral** | Ethernet starts X=74.5; retainer ends X=71.0. These parts do not overlap in XY; there is also 1.5 mm vertical separation. |
| Pi USB stacks → right retainer edge | **4.0 mm lateral** | USB starts X=75.0; retainer ends X=71.0. These parts do not overlap in XY. |
| Pi USB stacks → flat lid underside | **10.4 mm vertical** | USB stack top Z=26.6; lid underside Z=37.0 |
| Pi components → integral lid posts/spacers | **≥3.0 mm envelope clearance** | Expanded whole-Pi/whole-lid test passes at 2.99 mm. Outboard retainer post bottom Z=28.0 is 3.9 mm above the Ethernet top Z=24.1; posts are also outside the component footprint. |
| SHIM connector → flat lid | **15.4 mm vertical** | Conservative connector top Z=21.6, lid underside Z=37.0. Reserve about 8 mm for the flexible Qwiic bend; bend itself is not certified by the static PCB model. |
| OLED glass → flat lid underside | **1.4 mm vertical** | Glass model top Z=35.6, underside Z=37.0; this is display clearance, not a Pi-component clearance |
| OLED glass → nearest printed spacer | **0.386 mm lateral** | Bottom hole Y=30.48, glass edge Y=28.194, round spacer radius=1.9; top pair has 0.64 mm. Actual glass/spacer fit is a required fit gate. |
| Button/plug → Pi | Separate bay, **≥3 mm whole-envelope check** | Button centre X=128; Pi metal ports end X=96.2. The 18 mm square socket and conservative nut remain beside the Pi, never above it. |
| Button nut/plug → breadboard | **≥4.9 mm** | Expanded-envelope check passes at 4.89 mm; breadboard ends Y=45.5, nut/body bay starts above it. |
| Button plug → base floor | **11.4 mm vertical** | Plug bottom Z=39.4−25=14.4; floor Z=3.0 |
| Breadboard → pocket sides | **0.5 mm per side** | Pocket uses corrected 45 × 34.5 × 9.5 mm board |
| Right-angle USB-C plug → printed base | **No collision** | Conservative 12 × 12 × 6 mm plug envelope tested through the shaped opening. Actual elbow orientation/plug strain-relief length remains a fit gate. |
| P3 board → pocket sides | **0.35 mm per side** | PCB is held vertically by hood corner pads against tray seats, not by interference fit |
| P3 sensor → cradle contact plateau | **Flush (0 mm)** | 2.2 mm seat + 1.6 mm PCB + 1.55 mm sensor = **Z=5.35 mm**, same as local floor |
| P3 sensor package → aperture sides | **0.2 mm per side** | Aperture 6.0 × 3.7; seal perimeter with opaque gasket/tape without covering optical surface |
| P3 Qwiic body → pocket ceiling | **0.4 mm** | Connector top Z=7.0; pocket top Z=7.4; local side-cap top Z=8.7 leaves an opaque 1.3 mm roof above that pocket; central entry floor is Z=6.5 |
| P3 low IC envelope → descending floor | **0.5 mm over modeled low ICs** | IC envelope ends at Y=19, top Z=4.8; cavity ceiling Z=5.3, central floor Z=6.5. Ramp starts after this cluster |
| P3 visor underside → nominal flexible strap | **0.65 mm at visor entrance; 0.80 mm over sensor centre** | Visor underside Z=22.35, **17 mm above the sensor**; reference finger is 20 × 15 mm, strap 1.2 mm. `visor_clearance` sets this height; `visor_top_z` is derived. |
| P3 opening at top of sidewalls | **26.1 mm minimum under visor cheeks** | Curved U is approximately 27.7 mm wide at entry / 28.0 mm over the sensor at side-top Z=13.35. Both clear the required 21 mm opening. Flat strip 11 mm; side radius 8.5 mm. |
| P3 flexible strap → wall slots | **≈0.2 mm per fore/aft edge**, 0.5 mm vertically per face on straight segment | 13 × 1.2 mm webbing in 13.4 × 2.2 mm slots; all strap/cradle/tray/board intersection tests pass. |

The original relay height yielded only 1.0 / 1.8 mm above the heatsink. At the coordinator's request the lid and its hardware were raised **2 mm**, and the retainer shortened **1 mm** at the Ethernet side. Only the larger-clearance revision is supplied.

## Outer dimensions

| Part / assembly | X × Y × Z, mm |
|---|---|
| Rear P1 front frame, print orientation | 158.4 × 89.4 × 11.1 |
| Front P1 front frame, print orientation | 158.4 × 89.4 × 14.7 |
| Either P1 back plate with integral mount | 158.4 × 89.4 × 21.3 |
| Either P1 fit ring | 158.4 × 77.6 × 2.0 |
| P1 mount test | 32 × 34 × 21.5 |
| P1 rear enclosure assembled, excluding proud phone bar | 158.4 × 89.4 × 32.4 |
| P1 front enclosure assembled | 158.4 × 89.4 × 36.0 |
| P2 base, including carry loop | 170 × 78 × 37 |
| P2 lid, in print orientation including inward posts | 158 × 78 × 11.4; outer skin 2.4 thick |
| P2 OLED retainer | 55 × 41 × 3.8 |
| P2 shell assembled | 170 × 78 × 39.4; body footprint without loop 158 × 78 |
| P2 with bank and button | 170 × 78 × 55.9, with bank flush; soft webbing underneath adds approximately 1.2 mm locally |
| P3 tray | 46.4 × 48.4 × 3.6 |
| P3 hood, print orientation | 46.4 × 22.35 × 48.4 |
| P3 assembled, rigid enclosure | 46.4 × 48.4 × 24.15; 25.35 mm high including the 1.2 mm soft strap below tray |

P3 has an open U cradle, 8 mm sides, a 14 mm distal visor and direct finger-pressure strap. The low slots at Z=6.8–9.0 remain centred on sensor Y=22.6; the flush sensor plane remains Z=5.35 and the closed fingertip stop remains Y=34. The strap passes through these slots and over the finger beneath the visor. The enlarged **20 × 15 mm fingertip** and **13 × 1.2 mm strap** fit without penetrating the cradle or board. The reference strap contacts the finger directly above the sensor. The visor underside is Z=22.35, **17 mm above the sensor**. `hood_wall=3.4` retains material around the wider U. The screw-lug centres move outward to X=−6.5/31.9 and the distal pair to Y=33, clear of the strap. `end_wall=6.4` supports their 45° approach ramps; the closed stop stays at Y=34. Direct strap pressure and shielding still need testing on a relaxed hand. The relay microSD opening remains 12 mm high with 45° shoulders and a 4 mm crown bridge.

## Fastener retention correction

Nuts in P1 and both P2 printed joints now load **solid printed webs toward the screw heads**. Side slots permit insertion without cutting through those webs. P3 already opened on the far/bottom face; its bearing roof remains intact. No joint depends on nut-pocket friction to clamp the two pieces.

| Joint | Nut access | Material toward screw head | Required under-head screw length | Extra length beyond full nut |
|---|---|---:|---:|---:|
| P1 chest plate → outward frame, both modes | Side of each external frame lug, outward ±Y | 1.2 mm | 1.8 plate + 1.2 web + 2 nut = **5.0 mm** | 1.0 mm |
| P2 lid → base | Interior-facing side of each corner boss, along X | 1.2 mm | 2.4 lid + 1.2 web + 2 nut = **5.6 mm** | 0.4 mm |
| P2 OLED rear retainer → lid posts | Post side facing away from OLED, along ±X | 1.2 mm | 2.4 retainer + 1.2 web + 2 nut = **5.6 mm** | 0.4 mm |
| P3 cradle → tray | Tray bottom, opposite screw head | 1.4 mm | 2.4 cradle flange + 1.4 web + 2 nut = **5.8 mm** | 0.2 mm |

These stacks use nominal 2 mm-thick nuts and 6 mm screw shanks. Pockets are 5.2 mm AF × 2.2 mm deep, so the seated nut bears against the web with the remaining 0.2 mm on the far side. Only a Ø2.9 mm bore crosses each web. Side-slot/pocket roofs bridge at most 6.1 mm in the supplied orientations. Confirm actual nylon nut thickness and under-head screw length; start every thread by hand.

New seated-hardware intersections exposed P3 head collisions that the original component-only checks missed. The wider, relocated lugs remove them: modeled Ø5 × 2 mm heads clear the cradle wall by **0.25 mm** and the rear pressure-strap edge by **1.4 mm**. Their head undersides bear on the 2.4 mm flanges. All nut/screw/printed-part and strap intersections now pass. P2 lid/retainer hardware also retains **≥3.0 mm** expanded-envelope clearance from the Pi. This validates the geometric load path, not physical pull-out strength or layer adhesion.

## Source corrections

1. **Pi USB-C datum:** the official drawing's 7.7 mm runs from the left mounting-hole centre, itself 3.5 mm from the PCB edge. The centre is **11.2 mm from the board edge**, not 7.7. Visual source: `../reference/pi4-mechanical-drawing.pdf`; raster retained at `tmp/pi4.png`. Micro-HDMI centres follow the same chain at 26.0 and 39.5 mm; AV at 54.0 mm.
2. **Breadboard:** confirmed ELEGOO part is **45 × 34.5 × 9.5 mm**, replacing the original generic dimensions.
3. **OLED:** official fab print gives **35.56 × 33.02 mm**, holes on **30.48 × 27.94 mm**, and offset **34.544 × 23.114 mm** glass. y=0 is the header edge. Glass begins 5.08 mm from that edge. Ordinary 5 mm-AF hex spacers overlap the bottom of this glass; the approved rear retainer and Ø3.8 printed round pads replace them. The suggested UG-2864HSWEG01 PDF describes a 0.96-inch panel and was rejected as a source for this 1.3-inch active-area offset. The window is full glass minus 1 mm per edge, as approved.
4. **MAX30101:** the sensor is at X=12.7, Y=25.4−2.8=22.6, not in the board centre. This matches the supplied official dimension drawing. P3's floor drops at 45° from the connector-clearance height to the sensor plateau.

## What this verification does not establish

- Pixel bar dimensions, side-button positions and corner radius remain estimates until the bare phone and coupons are checked. Camera field of view and optical vignetting need an actual phone image.
- The GoPro buckle is a simplified reference, not a metrology model; friction, real screw fit, load strength, wear and layer adhesion were not tested.
- Pi connector footprints, heatsink positions/heights and SHIM are conservative simplified solids. The real Easycargo heatsinks must stay inside the 12 mm-above-PCB envelope. GPIO jumper shells and free cable shapes are not fully modeled. Check lid fit with all wiring installed.
- M/F spacers now mount male-up; bottom screw heads are recessed and the bank rests flush, so the previous bank-gap caveat is removed. Confirm actual heads fit the Ø5.4 × 2.2 counterbores and the female hole accepts 5.2 mm engagement, or shorten the four bottom nylon screws appropriately. The male stud must cover the 1.6 mm PCB and 2 mm nut; a 6 mm stud is modeled. The 0.8 mm bearing floor above the head seat requires gentle hand tightening.
- The HBAN nut, plug width and 25 mm below-panel envelope are assumptions from the supplied listing/spec; no physical plug was available. The power-bank shape is simplified and its cable is not routed in the collision tests.
- OLED total stack height is modeled conservatively as 6.2 mm above PCB bottom plus an additional 3 mm rear connector envelope. The nominal active-area position in the reference render is illustrative; the full-glass window intentionally avoids relying on it.
- P3 connector bodies, low IC heights and sensor package are reference envelopes, not a vendor STEP model. No soldered bottom header is allowed by this design. Finger sizing, light rejection, comfort, light pressure and retention on a limp palm-down hand require a physical check; the opaque perimeter gasket is part of assembly.
- **No slicer or FDM machine was available.** Support-free printability follows the specified orientation, 45° approach ramps/teardrop roof, and short bridges listed in PRINT_SETTINGS.md. It has not been confirmed by G-code inspection or a real print. The PNGs show CAD geometry with visual bevel/material effects; they are not photographs of built parts.

## Review revision — 2026-10-31

- P3 full gabled tunnel/external loops replaced with U cradle + direct pressure strap + short visor. The final adult-sizing revision uses a 20 × 15 mm finger, 1.2 mm strap, 11 mm flat contact strip and 17 mm visor clearance; rigid height is 24.15 mm. The printable selector/file remains `hood` for compatibility. Sensor/board position, slot centre and closed stop are unchanged.
- Pi standoffs reversed male-up, underside screw heads recessed, bank gap removed. Cable-tie eye is internal and horizontal; bank straps pass outside the contact footprint and clear breadboard.
- FINGER label sits at X=83, aligned with the actual cable notch; arrow reaches the lid’s rear edge above it.
- Worn bodycam render uses a vertical chest plane with buckle base on it. Landscape case points 15° down. Front-camera assembly and strapped-finger demonstration renders added.
- The verification suite now contains 111 checks, including below-base exclusion, bank strap routing, all mounting hardware, direct finger strap path, the enlarged fingertip envelope and explicit nut-bearing-web material witnesses.
