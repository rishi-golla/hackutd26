# Screw-free assembly order and image contract

This replaces every earlier M2.5 assembly instruction. **A** outer shell; **B** chest plate; **C** relay base; **D** relay lid; **F** finger tray; **G** finger cradle; **J** removable spring clip, two used plus a spare. **E is removed.** T1 is the mount gauge, T2 the phone-fit gauge, and T3 the snap coupon. Only the button panel nut and harness thumbscrew remain, both hand-tightened. No OLED or short Qwiic cable is used. Exactly four removable backup glue dots are added as specified below. The builder supplies the power bank, straight USB-C cable and hook-and-loop straps.

Each numbered item is one action. Each filename identifies its corresponding picture. `_zoom` is a separate close-up; `_ok` / `_no` share a camera for comparison. The image set and factual captions are listed in `../manual/img/MANIFEST.md`.

## Before assembly

1. Measure the bare phone’s camera bar and corners. — `b2_measure`
2. Print the corrected c020 coupon in the supplied bed orientation. — `b2_bed_coupon`
3. Test all four coupon pairs using FIT_TEST.md; try c025 if binding or c015 if still loose. — `coupon_test` (additional details: `coupon_test_zoom`)
4. Test the mount gauge in the harness buckle. — `b2_t1_test`, `b2_t1_test_ok`, `b2_t1_test_no`
5. Check the selected fit ring against the phone. — `b2_t2_test`

The coupon includes actual beam sections and layer directions. See [FIT_TEST.md](FIT_TEST.md): single-slice rotation can be normal, but unlatched straight withdrawal, broken tips and permanent bending fail. The numbered ladder plates take about 20–24 minutes by volume estimate. Part-bed pictures are `b2_bed_T1`, `b2_bed_T2r`, `b2_bed_T2f`, `b2_bed_A_rear`, `b2_bed_A_front`, `b2_bed_B`, `b2_bed_C`, `b2_bed_D`, `b2_bed_F`, `b2_bed_G`, `b2_bed_J`.

## P3 — finger sensor, built first

1. Plug the long cable into either side socket on the sensor board. — `b4_02_cable`
2. Place the board sensor-up on the tray’s seats, with the sensor toward the closed fingertip end. — `b4_03_board`
3. Lower the cradle onto the tray. — `b4_04_cradle`
4. Slide one J clip onto the front pair of flanges until its hook clicks into the notch. — `b4_04_clip_front`, `b4_04_clip_zoom`
5. Slide the second J clip onto the rear pair of flanges until it clicks. — `b4_04_clip_rear`, `b4_04_clip_rear_zoom`
6. Check both hooks sit in their notches. — `b4_04_clip_ok`, `b4_04_clip_no`
7. Add one rice-grain hot-glue dot across the outside seam on the cable side near the open finger entry. — `b4_04_glue_zoom`
8. Add one rice-grain dot at the matching seam on the opposite side. — `b4_04_glue`
9. Let both dots cool before handling. — `b4_04_glue`
10. Add a thin black tape frame around the sensor opening. — `b4_05_tape_ok`, `b4_05_tape_no`
11. Thread a zip tie through the tray’s small slot beside the cable. — `b4_07_thread`
12. Close the tie around the cable jacket beside the plug. — `b4_07_ziptie`
13. Thread the black strap through the two low wall slots. — `b4_06_strap`
14. Slide the fingertip beneath the visor and strap. — `b4_06_finger`
15. Fasten the strap lightly over the finger directly above the sensor. — `b4_06_strap_ok`, `b4_06_strap_no`

The cable itself does not pass through the small tie slot. Tape must leave the optical window uncovered. The strap crosses the finger under the visor, not over the rigid roof. Keep glue on the outside F/G seam only, away from the board, optical window, gasket, channel and cable. Keep both J clips installed. Peel both dots away cold before opening the removable sensor board. To remove a J clip, lift its small free tip before sliding it off (`b4_release_clip`, `b4_release_clip_zoom`).

## P2 — relay

1. Fit the largest heatsink to the processor using its supplied adhesive. — `b5_01_heatsink_cpu`
2. Press the SHIM onto the first six header pins, with its square pad at pin 1. — `b5_02_shim`, `b5_02_shim_zoom`, `b5_02_shim_ok`, `b5_02_shim_no`
3. Thread the first bank strap across the inside floor and down through its two slots. — `b5_04_strap_one`
4. Thread the second bank strap through the remaining pair of slots. — `b5_04_straps`
5. Lower the Pi onto the four locating pegs, with USB-C toward the side opening. — `b5_06_pi`, `b5_06_pi_zoom`
6. Press the Pi’s two clear corner lands down until the edge clips retain it. — `b5_06_pi_click`, `b5_06_pi_ok`, `b5_06_pi_no`
7. Gently insert your unpowered USB-C plug through the opening into the Pi. — `b5_06_usb_dryfit`, `b5_06_usb_dryfit_ok`, `b5_06_usb_dryfit_no`
8. Pull the plug out. — `b5_06_usb_dryfit`
9. Add one rice-grain glue dot over the front mounting peg beside the USB stacks. — `b5_06_pi_rivet_zoom`
10. Add one rice-grain glue dot over the diagonally opposite rear mounting peg beside the other edge clip. — `b5_06_pi_rivet`
11. Let the glue cool before moving the board. — `b5_06_pi_rivet`
12. Peel the breadboard’s adhesive backing. — `b5_07_peel`
13. Press the breadboard into its pocket with row 1 nearest the Pi. — `b5_07_breadboard`
14. Feed the free end of the 500 mm finger cable through the notch marked FINGER. — `b5_08_cable_in`
15. Push the finger cable’s keyed plug into the SHIM socket. — `b5_12_finger_shim`, `b5_12_finger_shim_zoom`, `b5_12_finger_shim_ok`, `b5_12_finger_shim_no`
16. Lay a loose service loop with 120 mm of cable between the plug’s rear face and the tie grip. — `b5_12_finger_slack`
17. Thread a zip tie through the anchor eye beside the FINGER notch. — `b5_08_tie_thread`
18. Close the tie around the cable jacket without pulling the service loop tight. — `b5_08_tie_close`
19. Unplug the button’s cable plug. — `b5_11_unplug`
20. Remove the button’s own panel nut. — `b5_11_nut_remove`
21. Push the button through the lid hole from the labelled side. — `b5_11_button`
22. Hand-tighten the button’s nut from underneath. — `b5_11_nut`, `b5_11_button_zoom`
23. Push the plug back onto the button. — `b5_11_plug`
24. Complete the breadboard wiring using the wiring panels. — `wire_00_overview` through `wire_07_done`
25. Test the electronics with the lid resting beside the box. — `b5_test_open`
26. Lower the lid onto its locating lips. — `b5_22_close`
27. Press each latch paddle down until it is under its catch bridge. — `b5_22_click`, `b5_22_close_zoom`
28. Check all four paddles are captured. — `b5_22_close_ok`, `b5_22_close_no`
29. Place your own power bank against the flat underside, under both strap positions. — `b5_23_bank`
30. Fasten the first bank strap. — `b5_23_strap_one`
31. Fasten the second bank strap. — `b5_23_straps`
32. Wrap the separate backup strap in its side guides around the whole box and bank. — `b5_22_strap`, `b5_22_strap_zoom`
33. Fasten the backup strap without covering a vent, paddle, button, port or cable. — `b5_22_strap_ok`, `b5_22_strap_no`
34. Plug the bank end of your cable into the bank’s matching output socket. — `b5_23_usb_a`
35. Plug the straight USB-C end into the Pi through the side opening. — `b5_23_usb_c`

**Cable and bank fit:** the only Qwiic connection is SHIM → long cable → finger board. Leave the 120 mm internal service length before securing the tie. Bank and cable pictures are generic; the USB-A bank end is an example, and a bank with USB-C output needs a suitable USB-C–C cable. Use straps up to 13 mm wide and no thicker than 1.2 mm where they pass through the finger clip. Check the bank spans all three strap positions, remains flush and cannot slide out; see README for the dimensional limits. The only Pi glue points are the two diagonally opposite mounting holes beside the edge clips. Pegs end 0.2 mm below the board top; cap the hole rim, keeping glue off components and metal connectors. Use the smallest dots that bridge peg recess to hole rim. These are removable adhesive caps, not hard mechanical rivets. See README for strap lengths.

**Breadboard convention:** row 1 nearest Pi; a–e toward the rear header/FINGER wall; f–j toward USB-C. The assembly picture marks the row-1 end only. Only the processor heatsink is fitted. All other kit pieces stay in the bag. The auxiliary CAD block remains only as a conservative clearance envelope and is omitted from every manual assembly picture. The fitted processor sink must stay below the 12 mm envelope above the PCB.

To open the relay, undo the third backup strap, then push a paddle inward and lift that corner slightly (`b5_release_lid`, `b5_release_lid_zoom`); repeat around the lid. To remove the Pi, peel both glue caps away cold, then press its two edge clips outward before lifting the board (`b5_release_pi`, `b5_release_pi_zoom`). Nothing underneath the base needs removal.

## P1 — bodycam

1. Lay the selected outer shell with its outward face down. — `b6_01_shell`
2. Place the bare phone in the shell. — `b6_04_phone`
3. Align the chest plate with the open ends of the long rails. — `b6_05_align`, `b6_05_align_zoom`
4. Slide the chest plate along the rails until both latches click. — `b6_05_plate`, `b6_05_plate_zoom`
5. Check both latch shoulders are seated. — `b6_05_plate_ok`, `b6_05_plate_no`
6. Stretch the narrow rubber band into the rim guide around both short ends. — `b6_05_strap`, `b6_05_strap_zoom` (front version: `b6_05_strap_front`, `b6_05_strap_front_zoom`)
7. Fit the case’s two mount fingers between the buckle’s three fingers. — `b6_06_buckle`, `b6_06_buckle_zoom`
8. Insert the harness thumbscrew through the aligned holes. — `b6_06_thumb`
9. Tilt the case about 15 degrees downward. — `b6_07_tilt`
10. Hand-tighten the harness thumbscrew. — `b6_07_tighten`
11. Check the closed case with a gentle pull over a padded surface. — `b6_11_final`

In rear mode the camera bar faces the shell window and the screen faces the chest plate. In front mode the screen faces the outward opening. Keep the phone’s side buttons free. There is no partially screwed test state: always seat both latches before a worn test.

Use only a 2–2.4 mm wide band, at most 1.2 mm thick, following the guide beside the opening. See README for loop lengths.

To reopen, remove the backup band, squeeze **both** recessed tabs inward (`b6_release`, `b6_release_zoom`), then slide the plate horizontally off the shell (`b6_slide_open`). The slide direction is the phone’s long axis, horizontal when worn landscape. Do not glue this joint.
