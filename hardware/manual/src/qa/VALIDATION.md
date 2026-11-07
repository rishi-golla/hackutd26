Current revision: see [SCREENFREE_REVISION.md](SCREENFREE_REVISION.md) for the 145-image screen-free set. The older counts below describe the superseded OLED revision.

# Manual image validation — 2026-11-01

- All 155 IDs in NEEDED_IMAGES.txt are present; the requested comm comparison prints nothing.
- MANIFEST.md covers all 164 PNGs: 140 required AST, nine additional release views, and 15 Terra images.
- AST main images are 1600 × 1200, detail images 1200 × 1200 and icons 600 × 600.
- Captions contain at most 15 words. Correct/incorrect pairs differ. Parts-sheet label anchors cover A B C D F G J T1 T2 T3; J shows two clips.
- No obsolete E or M2.5 hardware icons remain.
- Visual review covered the image sheets and detailed snap, glue, strap, SHIM, USB and coupon views. Final clarity render batch exited zero without Blender ERROR or Traceback lines.
- Printed geometry is unchanged by the manual renderer. CAD report: PASS, 13 STLs, 77 geometry/tolerance checks and four nominal strain screens.

Recheck files with `cad/.venv/bin/python manual/src/validate_manual.py` from hardware/.

## Phone clarity and front-camera pass

- Re-ran `manual/src/render_all.sh`; all eleven requested front-camera variants are present.
- Motion-arrow audit: 80 visible straight motion arrows, minimum length 15.5% and shaft width 2.6% of canvas width. Curved rotation arrows use the same shaft width; dimension arrows preserve measurement endpoints.
- Global framing margin is 1.22. Related states share camera envelopes; front/rear counterparts have matching camera centers and widths. Detailed crops preserve the visible joint.
- Front mode uses the front shell/chest plate and the phone screen-down. OLED `_no` intentionally shows glass facing away from the lid window.
- Corrected a missing newline that had joined `wire_07_done` and `b2_t2_test_front` in NEEDED_IMAGES.txt. The exact comm check now prints nothing.
