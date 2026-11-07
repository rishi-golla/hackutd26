# No-snap manual renderer

From `hardware/`, re-render every AST image with:

```sh
python3 cad/render_assets.py
manual/src/render_all.sh
cad/.venv/bin/python manual/src/validate_manual.py
```

For selected images, append IDs to `render_all.sh`. It refreshes detailed render assets before calling Blender. `cad/render_assets.py` must also run after CAD changes. Printed geometry is imported unchanged from production STLs; assembly poses use the same CAD modules. Terra’s wiring panels and scene files are preserved.

`scenes_no_snap.py` overrides former catch actions and removes retired J/T3 scenes from the registry. No joint depends on a flexible catch. Two whole-stack straps hold the relay, two narrow rubber bands hold the bodycam plate, four outside glue dots hold F/G and two lid posts retain the Pi. Old images are retained in `img/_unused_snap/`; unfinished snap-v2 sources are not production.

The optional rigid rail test has `b2_bed_rail_test` and `b2_rail_test`. The main parts sheet contains A/B/C/D/F/G/T1/T2; its generated anchor JSON matches the eight positions.

Style: real part colours, 40% orange tint on the new part, crisp outlines, pale background and large motion arrows. The global phone-readability settings are in `render_manual.py`; shared camera families are in `phone_layout.py`. `_zoom` images are 1200×1200, main views 1600×1200, icons 600×600. Captions (maximum 15 words) live with scene registrations and regenerate MANIFEST.md. Text instructions and check/cross glyphs belong in the HTML, which this pipeline does not edit.

Validation checks required images, dimensions, comparison pairs, captions, parts anchors and front/rear camera matching. Generated QA metadata is under `src/qa/`.

Pi retention revision: `b5_22_posts` and `_zoom` show the two integral lid posts. The retired rivet images are in `img/_unused/`. No current scene includes Pi glue.

Complete relay overview: `relay_complete` and `relay_complete_labeled` share a fixed camera in `scenes_relay_complete.py`. The labeled version intentionally embeds seven callouts; the scene uses current CAD with a generic bank and a 500 mm total sensor-cable route.

The optional pivot-kit phone plate uses `scenes_universal.py`; rerender with `manual/src/render_all.sh b2_bed_universal_plate universal_plate_assembled`. Its source is `cad/universal_phone_plate.scad`; the supplied STL is already tilted for support-free printing.

The optional LCD1602 add-on uses `scenes_lcd_pod.py` and assets exported from `cad/lcd1602_pod.scad`. Re-render its four pictures with `manual/src/render_all.sh lcd_pod_bed lcd_pod_on_box lcd_pod_on_box_labeled lcd_pod_wiring`. The last two intentionally embed requested callouts. The wiring view separates the pod and shows a narrow cutaway of the existing vent; its new internal wire paths use the verified CAD envelopes. It is an **unpowered fit**, conditional on enough exposed metal above the seated SHIM; it does not demonstrate electrical contact. Four small glue caps touch the LCD only. C/D and existing images are unchanged.
