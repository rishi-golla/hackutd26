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
7. Peel the breadboard backing. — `b5_07_peel`
8. Stick the breadboard in its pocket, row 1 nearest the Pi. — `b5_07_breadboard`
9. Feed the finger cable through the FINGER notch. — `b5_08_cable_in`
10. Plug the finger cable directly into the SHIM. — `b5_12_finger_shim` + `_zoom` + `_ok` / `_no`
11. Leave 12 cm of cable between plug rear and zip-tie grip in the shown loop. — `b5_12_finger_slack`
12. Thread the zip tie through the anchor eye. — `b5_08_tie_thread`
13. Close the tie around the cable jacket. — `b5_08_tie_close`
14. Unplug the button's connector. — `b5_11_unplug`
15. Remove the button's panel nut. — `b5_11_nut_remove`
16. Insert the button through D from the outside. — `b5_11_button`
17. Hand-tighten the button's own nut. — `b5_11_nut` + `b5_11_button_zoom`
18. Reconnect the button's plug. — `b5_11_plug`
19. Complete the wiring and test with D beside C. — `b5_test_open` and the separate wiring panels
20. Check the two lid posts are clean and intact. — `b5_22_posts`
21. Keep the mounting-hole rings and the post paths free of wires. — `b5_22_posts_zoom`
22. Lower D onto the rigid locating lips, with wiring inside. — `b5_22_close`
23. Check the lid rests flush without forcing or bowing the Pi. — `b5_22_seat` + `b5_22_close_ok` / `_no`
24. Place the builder's bank against the flat underside. — `b5_23_bank`
25. Close the first strap around the whole lid–box–bank stack in the left guide. — `b5_22_strap` / `b5_23_strap_one`
26. Close the second strap around the whole stack in the right guide. — `b5_22_straps` / `b5_23_straps`
27. Check the straps occupy both guides and clear the vents, cable and ports. — `b5_22_strap_ok` / `_no`
28. Connect the bank end of the power cable. — `b5_23_usb_a`
29. Connect the straight USB-C end to the Pi. — `b5_23_usb_c`

There are TWO straps total, 10–12 mm preferred (13 mm maximum), no more than 1.2 mm thick, about 32–35 cm each including overlap. No straps thread through the base floor. Undo both before lifting D. With D removed, lift the Pi directly off its pegs. Keep the box flat whenever D is off; the board has no vertical restraint then. There is no click or release paddle.

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

## Optional universal phone plate (separate pivot-kit part)

1. Print `universal_phone_plate.stl` in its supplied leaning orientation. — `b2_bed_universal_plate`
2. Remove the brim.
3. Smooth the phone-contact edges.
4. Fit the mount into the harness buckle.
5. Install the existing thumbscrew.
6. Add optional felt/tape at the two phone-side pad seats.
7. Rest the phone on both bottom ledges in the selected camera direction.
8. Fit the first band into matching top and bottom notches.
9. Fit the second band into another pair of notches. — `universal_plate_assembled`
10. Check that the bands miss the camera and controls.
11. Hand-tighten the thumbscrew at the desired angle.
12. Test phone retention over a soft surface.

See [UNIVERSAL_PHONE_PLATE.md](UNIVERSAL_PHONE_PLATE.md) for sizes and the front-camera bump fit gate. This sequence adds no glue or printed snaps.

## Optional LCD1602 pod (no reprint of C/D)

Use the measurements and wiring table in [LCD1602_POD.md](LCD1602_POD.md). These four overview images support the steps; they are not a new full one-picture-per-action booklet.

1. Measure the LCD PCB, hole pattern, backpack and header against the guide.
2. Print the pod with its flat base down. — `lcd_pod_bed`
3. Remove the brim.
4. Lower the LCD onto the four pegs.
5. Check the PCB rests flat on all four pads.
6. Add a tiny hot-glue cap over the first LCD mounting peg.
7. Add a tiny hot-glue cap over the second LCD mounting peg.
8. Add a tiny hot-glue cap over the third LCD mounting peg.
9. Add a tiny hot-glue cap over the fourth LCD mounting peg.
10. Let the glue cool.
11. Disconnect relay power.
12. Open the relay lid.
13. Check the SHIM is fully seated.
14. Measure the exposed metal on physical pins 3 and 5; proceed only with secure female-contact engagement, ideally at least 4 mm. — `lcd_pod_wiring`
15. Connect one female–male jumper from Pi pin 3 to g16.
16. Connect another female–male jumper from Pi pin 5 to g17.
17. Pass the LCD GND lead's male end through the third lid vent.
18. Connect that lead to d5.
19. Pass the LCD VCC lead's male end through the same vent.
20. Connect that lead to d7, the existing 3.3 V row.
21. Pass the LCD SDA lead's male end through the same vent.
22. Connect that lead to h16.
23. Pass the LCD SCL lead's male end through the same vent.
24. Connect that lead to h17.
25. Fit the GND female end to the LCD's labelled GND pin.
26. Fit the VCC female end to the LCD's labelled VCC pin.
27. Fit the SDA female end to the LCD's labelled SDA pin.
28. Fit the SCL female end to the LCD's labelled SCL pin.
29. Route the leads clear of both lid posts.
30. Dry-seat the lid without strap force.
31. Place the pod at the lid's left end, facing the USB-C side. — `lcd_pod_on_box`
32. Lay the four LCD wires between the pod's wire guides.
33. Leave about 30 mm loose wire outside for lifting the pod.
34. Pass the left strap over the pod's centre spine, below the LCD.
35. Fasten the left strap with secure overlap.
36. Fasten the unchanged right strap.
37. Check the pod is stable and MARK remains accessible. — `lcd_pod_on_box_labeled`

Do not supply this LCD from 5 V. The coordinator's accepted 3.3 V plan may give faint contrast; loosen the left strap and lift the pod to reach the contrast pot. If pin contact or 3.3 V operation fails, leave the add-on disconnected. No glue goes on the Pi.
