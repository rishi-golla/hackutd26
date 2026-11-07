# No-snap assembly order

Each numbered item is one action. Filenames below are image IDs in `manual/img/`; the coordinator owns the HTML manual. A = outer shell; B = chest plate; C = relay base; D = lid; F = finger tray; G = finger cradle. J and T3 are retired. `front_frame` always means A and `back_plate` always means B, in both modes.

## Fit gates

1. Check T1 against the harness buckle. Alan's existing test passed; its geometry is unchanged. — `b2_t1_test`
2. Check the selected T2 against the bare phone. — `b2_t2_test` / `b2_t2_test_front`
3. Optionally print the backed rigid rail pair. — `b2_bed_rail_test`
4. Slide the tongue by hand to its stop and check for rattle. No click is expected. — `b2_rail_test`

## P3 finger clip

1. Plug the long Qwiic cable into the sensor board. — `b4_02_cable`
2. Lower the board onto the tray seats. — `b4_03_board`
3. Lower G onto F with all three pins aligned. — `b4_04_cradle` + `b4_04_locate_zoom`
4. Check the outside seam is flush. — `b4_04_locate_ok` / `_no`
5. Apply one rice-grain glue dot to the left seam near the open finger entry. — `b4_04_glue_1`
6. Apply one rice-grain glue dot to the right seam near the open finger entry. — `b4_04_glue_2`
7. Apply one rice-grain glue dot to the left seam near the closed fingertip end. — `b4_04_glue_3`
8. Apply one rice-grain glue dot to the right seam near the closed fingertip end. — `b4_04_glue_4`
9. Let the four exterior dots cool. — `b4_04_glue`
10. Seal light leaks around the sensor while leaving its optical window uncovered. — `b4_05_tape_ok` / `_no`
11. Thread the zip tie through the tray slot. — `b4_07_thread`
12. Close the tie around the cable jacket beside its plug. — `b4_07_ziptie`
13. Thread the finger strap through the two low slots. — `b4_06_strap`
14. At the sensor test, slide the finger beneath the visor. — `b4_06_finger`
15. Tighten the strap lightly over the finger pad. — `b4_06_strap_ok` / `_no`

To service the sensor, peel off the four cold glue dots and lift G off the pins. No J clips remain.

## P2 relay box

1. Fit only the processor heatsink. — `b5_01_heatsink_cpu`
2. Seat the SHIM on pins 1–6. — `b5_02_shim` + `_zoom` + `_ok` / `_no`
3. Lower the Pi onto its four locating pegs. — `b5_06_pi` + `_zoom`
4. Check that the Pi rests flat on every support pad. — `b5_06_pi_seat` + `b5_06_pi_ok` / `_no`
5. Dry-fit the builder's straight USB-C plug through the side opening. — `b5_06_usb_dryfit` + `_ok` / `_no`
6. Remove the power cable. — `b5_06_usb_remove`
7. Apply a rice-grain glue cap over the mounting hole beside the USB/Ethernet end on the USB-C wall side. — `b5_06_pi_rivet_zoom`
8. Apply a rice-grain glue cap over the diagonally opposite hole beside the header. — `b5_06_pi_rivet`
9. Let both caps cool. — `b5_06_pi_rivet`
10. Peel the breadboard backing. — `b5_07_peel`
11. Stick the breadboard in its pocket, row 1 nearest the Pi. — `b5_07_breadboard`
12. Feed the finger cable through the FINGER notch. — `b5_08_cable_in`
13. Plug the finger cable directly into the SHIM. — `b5_12_finger_shim` + `_zoom` + `_ok` / `_no`
14. Leave 12 cm of cable between plug rear and zip-tie grip in the shown loop. — `b5_12_finger_slack`
15. Thread the zip tie through the anchor eye. — `b5_08_tie_thread`
16. Close the tie around the cable jacket. — `b5_08_tie_close`
17. Unplug the button's connector. — `b5_11_unplug`
18. Remove the button's panel nut. — `b5_11_nut_remove`
19. Insert the button through D from the outside. — `b5_11_button`
20. Hand-tighten the button's own nut. — `b5_11_nut` + `b5_11_button_zoom`
21. Reconnect the button's plug. — `b5_11_plug`
22. Complete the wiring and test with D beside C. — `b5_test_open` and the separate wiring panels
23. Lower D onto the rigid locating lips, with wiring inside. — `b5_22_close`
24. Check the lid seam is flush. — `b5_22_seat` + `b5_22_close_ok` / `_no`
25. Place the builder's bank against the flat underside. — `b5_23_bank`
26. Close the first strap around the whole lid–box–bank stack in the left guide. — `b5_22_strap` / `b5_23_strap_one`
27. Close the second strap around the whole stack in the right guide. — `b5_22_straps` / `b5_23_straps`
28. Check the straps occupy both guides and clear the vents, cable and ports. — `b5_22_strap_ok` / `_no`
29. Connect the bank end of the power cable. — `b5_23_usb_a`
30. Connect the straight USB-C end to the Pi. — `b5_23_usb_c`

There are TWO straps total, 10–12 mm preferred (13 mm maximum), no more than 1.2 mm thick, about 32–35 cm each including overlap. No straps thread through the base floor. Undo both before lifting D. Peel the two cold glue caps before lifting the Pi off its pegs. There is no click or release paddle.

## P1 bodycam

For front mode, use the `_front` image variants where listed; the screen faces the outward opening.

1. Place A outward-face down. — `b6_01_shell` / `_front`
2. Lower the bare phone into A. — `b6_04_phone` / `_front`
3. Align B with the open ends of both rigid rails. — `b6_05_align` / `_front` + corresponding `_zoom`
4. Slide B to the closed-end stop. — `b6_05_plate` / `_front` + corresponding `_zoom`
5. Check B has reached the stop. — `b6_05_plate_ok` / `_no` or `b6_05_plate_front_ok` / `_no`
6. Fit the first thin rubber band into one long rim groove. — `b6_05_strap` / `_front` + corresponding `_zoom`
7. Fit the second thin rubber band into the opposite groove. — `b6_05_strap_second` / `_front` + corresponding `_zoom`
8. Interleave the buckle and case fingers. — `b6_06_buckle` / `_front` + corresponding `_zoom`
9. Insert the harness thumbscrew. — `b6_06_thumb`
10. Tilt the case downward. — `b6_07_tilt`
11. Hand-tighten the thumbscrew. — `b6_07_tighten`
12. Check retention gently over padding before wearing the phone. — `b6_11_final`

Use TWO soft 2–2.4 mm wide rubber bands, at most 1.2 mm thick. About 140–150 mm laid flat is a starting size; check actual tension. Remove both bands before sliding the plate out. No squeezing, clicking or glue is used on A/B.
