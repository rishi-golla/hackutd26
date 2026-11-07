# Verification record — snap recovery and removable backups, 2026-11-03

**PASS:** 13 production STL exports, 112 default geometry checks, four strain screens, six scalar fit checks, one historical-lid regression, three labelled ladder exports, and **847 checks across seven clearances**. **ALL CHECKS PASSED.** See [checks/report.json](checks/report.json).

OpenSCAD 2026.10.11 with the Manifold backend generates every STL. Trimesh checks watertightness, winding, positive volume, connectivity and bed position. No repairs are applied. Every ordinary part is one solid; the J pair is exactly two, and the coupon exactly eight. All start at Z=0 within 0.03 mm numerical tolerance.

Run `cad/.venv/bin/python cad/verify.py`. Each geometry check leaves a SCAD witness and log. Empty intersection means no penetration. Planar contact is allowed only when every result component is planar within 0.00001 mm and aggregate volume is below 0.00001 mm³, with OpenSCAD NoError. Positive retention probes deliberately move a part in its removal/load direction and must produce positive overlap. They establish geometric capture, not pull strength.

The old M2.5 checks remain retired rather than passing through empty modules. Current checks cover screw-free joints, components, optical openings, direct SHIM cable, USB-C plug, optional OLED, the four glue-dot envelopes and both backup-band routes. All geometry witnesses use the production `$fn=64`. The new sweep exports **all 13 production files at each setting** (including both P1 modes), then runs 104 geometry/retention checks and four nominal strain screens at that setting: **121 per value × 7 = 847**. Each connected component must itself be watertight, consistently wound, positive-volume and on the bed. This catches the detached hook and zero-volume sheet failures the former closed-fit-only tests missed.

Values swept: **0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45 mm**. Every value passes. `verify.py --staging` performs the same audit under `checks_staged/` without overwriting production STLs. `--skip-sweep` is diagnostic only and is not final acceptance. Production default remains 0.30 pending Alan's physical c020-first ladder result; [FIT_TEST.md](FIT_TEST.md) documents the recommendation and actual gap multipliers.

The original baseline failed **12/70** mesh exports: detached J tips at four settings, and degenerate P2 catch surfaces at 0.25/0.35. J and P1 hook joins now have internal Boolean overlap. P2's catch uses one continuous extruded profile instead of coincident cheek/ramp faces. No mesh repair or component filtering hides a failed printable export.

## Nominal joint calculations

For a rectangular fixed-root cantilever, the screen uses ε = 1.5 × thickness × tip deflection / length². The **1.5% limit is an engineering screening assumption, not a measured allowable for this PETG/printer**. Root concentration, layer adhesion, torsion, creep and cycle life are not modeled. The Pi clips bend across their vertical print layers and deserve particular physical testing. [Covestro’s snap-fit design guide](https://solutions.covestro.com/-/media/covestro/solution-center/brands/downloads/imported/1557218421.pdf) explains the underlying cantilever method; its molded-resin allowables are not applied to printed PETG.

| Joint | Beam thickness | Effective length | Required deflection | Geometric engagement | Nominal strain |
|---|---:|---:|---:|---:|---:|
| P1 squeeze latch | 1.6 mm | 26 mm | 1.05 mm | 0.9 mm | 0.373% |
| P2 lid paddle | 1.2 mm | 25 mm | 2.35 mm | 2.2 mm | 0.677% |
| Pi edge clip | 0.8 mm | 10.1 mm | 0.8 mm | 0.65 mm | 0.941% |
| P3 J spring clip | 1.2 mm | 18.6 mm | 1 mm | 0.85 mm | 0.52% |

P1 withdrawal probes at 1 mm meet both latch shoulders; a 1 mm normal separation meets the long rail lips. P2 lid lift at 1 mm meets the catch bridges. Pi lift at 1.35 mm meets its edge catches before the 1.4 mm locating pins fully disengage. J withdrawal at 1 mm meets the notches; cradle lift at 0.5 mm meets J’s upper jaws. The Pi retaining faces are ramped for support-free printing, so their holding force needs the coupon/actual-board check.

## Component clearances

These are nominal model clearances, not measurements of the hardware. Sensor, phone, optional OLED, button and port positions remain unchanged. The USB-C aperture crown rises 4 mm; the default lid loses the display opening, pads and guides.

| Interface | Nominal clearance / location | Evidence / implication |
|---|---|---|
| P1 phone body to cavity sidewall | **0.4 mm per side** | 153.6 × 72.8 cavity around 152.8 × 72.0 phone; corner radii increase by the same allowance |
| P1 phone screen/body to flat retaining faces | **0.4 mm** | Rear variant: screen Z=0, chest plate inner face Z=-0.4; rear retaining face Z=8.9, phone back Z=8.5 |
| Front variant camera bar to chest plate | **0.4 mm** | Bar extends to Z=-3.6; plate inner face at Z=-4.0 |
| Rear camera bar to aperture | **2.0 mm at throat**, wider at outward chamfer | Window wall is 1.8 mm; bar front at Z=12.1, enclosure front Z=10.7: **1.4 mm proud** |
| P1 buttons at both longitudinal slot ends | **0.4 mm** | Relief expands conservative 59 mm button envelope by 0.4 at each end; mirrored to correct edge for front mode |
| Approximate GoPro mating faces | **0.1 mm each face** | Two 3 mm ears, 3.2 mm gap; approximate three-ear buckle tested at 15° downward tilt for both variants. Actual buckle still needs coupon. |
| Power bank → base | **0 mm, flush contact** | Bank top Z=0. No rigid hardware below Z=0; bank/base intersections pass. |
| Bank straps → bank/base/Pi/breadboard | **No penetration** | 13 × 0.8 mm reference webbing crosses inside floor at X=36/96, descends outside bank footprint at Y=3.2/74.8, then wraps bank bottom. No webbing is between mating faces. |
| Optional OLED only: Pi SoC heatsink → OLED rear connector envelope | **3.8 mm vertical** | Highest modeled SoC stack Z=22.6; OLED rear connector bottom Z=26.4. Expanded-reference check passes at 3.79 mm. |
| Pi USB stacks → flat lid underside | **10.4 mm vertical** | USB stack top Z=26.6; lid underside Z=37.0 |
| SHIM connector → flat lid | **15.4 mm vertical** | Conservative connector top Z=21.6, lid underside Z=37.0. The new direct cable includes a separately checked plug and service-loop envelope. |
| Optional OLED only: glass → flat lid underside | **1.4 mm vertical** | Glass model top Z=35.6, underside Z=37.0; this is display clearance, not a Pi-component clearance |
| Optional OLED only: glass → nearest printed spacer | **0.386 mm lateral** | Bottom hole Y=30.48, glass edge Y=28.194, round spacer radius=1.9; top pair has 0.64 mm. Actual glass/spacer fit is a required fit gate. |
| Button/plug → Pi | Separate bay, **≥3 mm whole-envelope check** | Button centre X=128; Pi metal ports end X=96.2. The 18 mm square socket and conservative nut remain beside the Pi, never above it. |
| Button nut/plug → breadboard | **≥4.9 mm** | Expanded-envelope check passes at 4.89 mm; breadboard ends Y=45.5, nut/body bay starts above it. |
| Button plug → base floor | **11.4 mm vertical** | Plug bottom Z=39.4−25=14.4; floor Z=3.0 |
| Breadboard → pocket sides | **0.5 mm per side** | Pocket uses corrected 45 × 34.5 × 9.5 mm board |
| Straight USB-C overmold → printed base | **1.2 mm minimum**, 15 × 10 mm gauge | Port centre Z=12.2; aperture starts Z=6 and crowns at Z=24. Opening is 18 × 18 with 45° shoulders and a 6 mm bridge. |
| Largest verified rectangular overmold | **17 × 12 mm**, 0.2 mm minimum gap | Both dimensions apply together at the socket centre. It clears base/Pi/lid; actual printer tolerances can consume the small lower gap. Prefer 15 × 10. |
| Finger cable → lid features | **≥3 mm whole-route check**; **4.9 mm** to flat skin | A 2.2 mm-diameter cable envelope plus 5 × 4 × 3 mm plug passes base/lid/Pi/SHIM/button/breadboard/clip/beam checks. The enlarged route also clears the lid. |
| Finger cable → anchor front face | **2.5 mm** at tie grip | Cable centre Y=66, anchor front Y=69.6, envelope radius 1.1. Tie wraps the jacket to the horizontal eye; cable does not pass through the eye. |
| FINGER notch → cable envelope | **2.9 mm lateral each side** on straight exit | Notch is 8 mm wide; envelope diameter 2.2 mm; centre Z=30 is 3 mm above notch floor. |
| Direct finger cable internal route | **114.4 mm modeled**, **120 mm leave-in allowance** | Measure along cable from plug rear to tie grip. 10 mm and 16 mm plan-view bend arcs avoid the heatsinks; the rising arc has approximately 4.8 mm minimum spatial radius. Actual cable bend stiffness remains a fit check. |
| P3 board → pocket sides | **0.35 mm per side** | PCB is held vertically by hood corner pads against tray seats, not by interference fit |
| P3 sensor → cradle contact plateau | **Flush (0 mm)** | 2.2 mm seat + 1.6 mm PCB + 1.55 mm sensor = **Z=5.35 mm**, same as local floor |
| P3 sensor package → aperture sides | **0.2 mm per side** | Aperture 6.0 × 3.7; seal perimeter with opaque gasket/tape without covering optical surface |
| P3 Qwiic body → pocket ceiling | **0.4 mm** | Connector top Z=7.0; pocket top Z=7.4; local side-cap top Z=8.7 leaves an opaque 1.3 mm roof above that pocket; central entry floor is Z=6.5 |
| P3 low IC envelope → descending floor | **0.5 mm over modeled low ICs** | IC envelope ends at Y=19, top Z=4.8; cavity ceiling Z=5.3, central floor Z=6.5. Ramp starts after this cluster |
| P3 visor underside → nominal flexible strap | **0.65 mm at visor entrance; 0.80 mm over sensor centre** | Visor underside Z=22.35, **17 mm above the sensor**; reference finger is 20 × 15 mm, strap 1.2 mm. `visor_clearance` sets this height; `visor_top_z` is derived. |
| P3 opening at top of sidewalls | **26.1 mm minimum under visor cheeks** | Curved U is approximately 27.7 mm wide at entry / 28.0 mm over the sensor at side-top Z=13.35. Both clear the required 21 mm opening. Flat strip 11 mm; side radius 8.5 mm. |
| P3 flexible strap → wall slots | **≈0.2 mm per fore/aft edge**, 0.5 mm vertically per face on straight segment | 13 × 1.2 mm webbing in 13.4 × 2.2 mm slots; all strap/cradle/tray/board intersection tests pass. |

| Pi PCB / base | **6.0 mm** | Integral pads preserve PCB bottom Z=9 and floor Z=3 |
| Pi locating pins | **0.3 mm radial** | Ø2.1 pegs in Ø2.7 holes; 1.4 mm above pads |
| Pi / all lid features | **≥3.0 mm envelope clearance** in both modes | Whole-Pi Minkowski expansion by 2.99 mm clears default lid and optional display pads/guides |
| P3 rear clip pocket / finger | **1.4 mm opaque wall** | Pocket begins behind the unchanged fingertip stop |

## Current STL bounds

| STL | Bed dimensions X × Y × Z, mm | Bodies |
|---|---|---:|
| p1_rear_front_frame | 158.4 × 103.8 × 15.62 | 1 |
| p1_rear_back_plate | 158.4 × 100.8 × 21.3 | 1 |
| p1_rear_fit_ring | 158.4 × 77.6 × 2.0 | 1 |
| p1_front_front_frame | 158.4 × 103.8 × 19.22 | 1 |
| p1_front_back_plate | 158.4 × 100.8 × 21.3 | 1 |
| p1_front_fit_ring | 158.4 × 77.6 × 2.0 | 1 |
| p1_mount_test | 32.0 × 34.0 × 21.5 | 1 |
| p2_base | 170.0 × 78.0 × 42.4 | 1 |
| p2_lid | 158.0 × 78.0 × 5.4 | 1 |
| p3_tray | 32.9 × 53.4 × 2.2 | 1 |
| p3_hood | 32.9 × 22.35 × 53.4 | 1 |
| p3_joint_clips | 52.0 × 7.5 × 4.4 | 2 |
| snap_coupon | 82.0 × 56.0 × 13.7 | 8 |

P1 assembled outer size is **158.4 × 103.8 × 32.4 mm** rear / **36.0 mm high** front; the new external squeeze tabs account for the wider envelope. P2 bare assembled shell is **170 × 78 × 42.4 mm**, including the catch towers and carry loop; the lid plane remains at 39.4 mm. With the illustrative 14 mm-thick bank it is 56.4 mm high before soft webbing; the builder’s actual bank changes that height. P3 with its two J clips is **35.6 × 53.4 × 26.1 mm**; sensor plane and visor are unchanged.

## Screen-free lid and generic power accessories

The supplied `stl/p2_lid.stl` is always exported with `with_oled=false`. A set-difference witness proves the entire former window has the normal **2.4 mm skin**, and a separate intersection proves the former pad/guide region is empty below the skin. Bed orientation remains labelled-face down, with only the locating lips projecting upward. No display-support bridge or OLED glue is required; the separate Pi and P3 backup dots are specified below. Base C retains its taller USB-C crown and now adds the robust catch section and shallow exterior backup-strap channels.

`with_oled=true, with_backup_guides=false, snap_clearance=0.30` matches the archived previous lid at **0.000000 mm vertex displacement**, **0.000000 mm³ volume difference**, and identical triangle count. The current optional lid normally retains the new side guides. Disabling only those guides allows historical identity comparison. The optional lid is generated only under checks/, not as a second production STL. Optional display-to-Pi 3.8 mm and whole-Pi-to-lid ≥3 mm checks also pass.

The revised lid has **25.74 cm³** CAD volume and estimates **119–139 minutes**, **30.6–36.0 g PETG**. Closing the window adds slightly more material than removing the pads/guides saves. These are volume estimates, not slicer output.

The aperture retains **13 mm of wall above its crown** below the lid seam, **6 mm below its floor**, and 2.4 mm wall thickness. Socket centre stays **11.2 mm from the PCB left edge**, or X=19.2 in the enclosure. The nominal 15 × 10 mm plug has 1.5 mm lateral and 1.2 mm lower clearance. A 17 × 12 mm gauge has 0.5 mm lateral, 0.2 mm lower and 0.3 mm upper-corner clearance. The sloped roof means these are paired width/height limits, not a full 18 × 18 rectangular opening. With zero manufacturing clearance, centred rectangles satisfy W ≤ 18 and H ≤ min(12.4, 29.6−W), in millimetres; the verified 17 × 12 gauge stays inside that boundary.

For the modeled **24 mm axial plastic body**, seated at the socket face 8.8 mm inside the outer wall, **15.2 mm sticks outside the box**. Including the 8 mm strain-relief example gives **23.2 mm** before flexible cable. A different overmold length changes this directly; no particular purchased cable is assumed.

The relay's slot size is actually **13.4 × 2.8 mm**; **13.4 × 2.2 mm** applies to P3. Both accept the modeled 13 mm-wide webbing. Use ≤1.2 mm thickness for a common strap type, and keep doubled/sewn ends out of the slots. The fixed bank straps are 60 mm apart. A practical bank fits within **158 × 68 mm**, spans at least **73 mm of straight body length** when shifted under the straps, and has enough strap wrap/overlap. A centred bank needs roughly **99 mm length** to cover both entire bands. The generic 149 × 68 × 14 reference clears the base and straps, but that does **not** verify every smaller or wider bank. Retention depends on strap friction and actual shape. Check flush contact, port access and resistance to slipping.

The OpenSCAD rounded-geometry Minkowski expansion initially crashed for the long cable bundle. It was replaced by an analytic clearance envelope: cable radius enlarged by 2.99 mm and plug box enlarged by 2.99 mm on every face. This still tests at least 3 mm nominal Euclidean separation at the specified tolerance and avoids the unnecessary mesh expansion. No failing collision was waived.

## Backup clearances and physical meaning

| Feature | Verified geometry / remaining gate |
|---|---|
| Pi glue caps | Exactly two, at front/right and rear/left locating holes beside the edge clips. Ø4.0 × 0.8 mm upper caps plus narrow stems fill the 0.2 mm peg recess. Expanded-glue witness passes at 1.99 mm against ports, header, heatsinks and SHIM: **at least 2 mm nominal component clearance**. Caps remain 25.6 mm below the lid. Do not exceed the illustrated rice-grain size. |
| P3 seam glue | Exactly two outside dots at X=-3.75 / 29.15, Y=-4, Z=1.8. Reference dots 3.5 mm along seam, 2 mm tall, 1 mm outward. No intersection with board, J clips, strap or reference finger. These join F/G only; peel cold before opening. No glue wells change the printed parts. |
| Relay backup strap | ≤13 × 1.2 mm through 13.4 mm-wide, 0.6 mm-deep opposing side guides, centred X=109.25. No penetration into base/lid/bank and no overlap with vents, latches, button, port/cable or existing bank straps. **Only 0.25 mm nominal lateral gap** to the neighbouring strap / latch-root corridor at full 13 mm width; prefer 10–12 mm if available, and centre it in its guides. Guides leave 1.8 mm wall. |
| Relay strap length | Around closed box **plus bank**, never between their flat faces. Approximately 315 mm for 14 mm bank, 350 mm for ≤30 mm bank, including 50 mm overlap. Bank must cover the third strap as well: ≥87 mm straight usable length shifted appropriately, about 100 mm if centred, plus rounded-end allowance. Actual bank and fastening overlap remain fit gates. |
| Bodycam backup band | Both modes: 2–2.4 mm width, ≤1.2 mm thickness in a 2.8 mm-wide, 0.4 mm-deep rim groove. No intersection with phone, shell, plate, actual aperture, side-button/USB-C access envelopes, tabs or GoPro fingers. 1.4 mm face skin remains. The band sits 0.8 mm above the outer face, below the rear camera bar's 1.4 mm proud position. |
| Bodycam band length | Installed loop about 325 mm rear / 332 mm front. Initial soft rubber candidate 280–300 mm unstretched circumference (140–150 mm flat); verify tension and that it cannot slip out of the groove. A 13 mm strap is unsuitable for front-mode optics. |

Nominal strain ranges across the sweep: P1 **0.320–0.426%**; P2 lid **0.677%**; Pi clip **0.914–0.970%**; J **0.481–0.559%**. All remain below the 1.5% screen. Positive interference under forced removal proves geometric capture only; it does not model a flexible ramp camming out or quantify retention force. The Pi's ramped clip is specifically not a rated pull-off lock. Single-slice coupon rotation is expected, especially around its lone Pi peg.

[The labelled ladder](stl/coupons/) has exactly eight valid bed-seated components per file. The four large mates have raised clearance digits; labels do not alter mating surfaces. The source default has not been lowered without a physical result. Topology repairs and approved guide geometry have been re-exported at c030 after the coordinator was told the recommendation.

## Physical checks still required

- Follow FIT_TEST.md: print corrected c020 first, clean it, and cycle each joint ten times. Do not confuse permitted single-slice rotation with failed straight capture. Confirm the material and thin-beam slicer paths; fit does not prove fatigue life.
- Check P1’s two latches cannot release with only one pressed. Check the rails and GoPro ears with the actual phone over a padded surface, then a controlled bounce/pull trial. No load test or structural FEA was available.
- Check the actual Pi corner component clearances before snapping it in; do not flex the PCB. Check the actual straight USB-C overmold and microSD access. The direct finger cable has a checked envelope; loose GPIO jumper shells and arbitrary cable routing are not fully modeled.
- Pixel bar, buttons and corner radius; harness fit; heatsink heights; HBAN nut/plug; SHIM cable plug; MAX30101 connector and IC envelopes remain physical fit gates. Test camera vignetting, P3 light rejection, light pressure and relaxed-hand retention.
- Only the processor heatsink is fitted for this build; the other kit pieces stay in the bag. The second CAD block remains only as a conservative clearance envelope, and is omitted from every manual picture. Its target chip has not been verified.
- Check glue adhesion/removal cold, the bank’s three-strap contact and no-slide retention, and band tension with both optics unobstructed. Remove backups before operating the release tabs.
- No slicer or printer was available. Supplied orientations use 45-degree ramps and short bridges. Estimated times are volume-based, not G-code predictions.

## Source corrections

USB-C is 3.5 + 7.7 = 11.2 mm from the Pi PCB edge. The confirmed breadboard is 45 × 34.5 × 9.5 mm. The official OLED fabrication print gives a 35.56 × 33.02 PCB and offset 34.544 × 23.114 glass; Ø3.8 pads clear glass by 0.386 mm. MAX30101 centre is X=12.7, Y=25.4−2.8=22.6. Reference drawings remain in ../reference/.
