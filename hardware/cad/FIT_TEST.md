# Rigid rail fit test — optional, no snaps

Print [rail_fit_test.stl](stl/rail_fit_test.stl) at its supplied **0.18 mm** rigid fit. It contains two backed pieces, about 32×35.62×10.04 mm together, 3.22 cm³, roughly **15–18 minutes** without a slicer.

Use PETG, a 0.4 mm nozzle, 0.20 mm layers, four walls, 100% infill, no supports and no brim inside the mating faces. Keep the supplied orientation. Remove strings and first-layer burrs; do not round away the rail stop or sand a new profile into the tongue.

1. Hold the tongue square to the open rail end.
2. Slide it to the closed end stop.
3. Hold the two backed bodies and check for rattle.
4. Slide the tongue out along the same axis.

**Pass:** slides smoothly by hand, no perceptible rattle while held square, and stops firmly at the closed end. There is no click and nothing should flex. One short rail cannot constrain roll as two full case rails do; test the intended slide and normal directions, not twisting a single strip as a lever.

If it binds after removing burrs, report which face binds before increasing `snap_clearance` in common.scad. If it rattles, report that result before the main print. Never scale the STL. The geometry sweep checks 0.15–0.45, but it cannot identify the right physical fit or predict long-rail warping. T1 remains the passed harness test; T2 still checks the phone outline and camera/screen aperture.

The snap coupon T3, c015/c020/c025 snap ladder, J clips and unfinished snap-v2 experiment are retired. They cannot validate this no-snap design. Production retention uses two bodycam bands, two whole-stack relay straps, two Pi lid hold-down posts and four finger-joint glue dots.
