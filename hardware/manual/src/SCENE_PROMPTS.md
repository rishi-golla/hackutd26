# Manual scene prompts

Generated with the built-in image_gen tool. Use the listed input images as style and geometry references. Request 4:3 output; outputs were proportionally resized to 1600 × 1200. AI outputs vary between generations.

Shared style: single flat-colour, friendly instructional illustration; pale #f4f6f8 background, simple shapes, crisp dark outlines, muted colors and orange-red #ff5a36 emphasis; no text, letters, numbers, logos, watermarks, collages or borders.

- **b6_02_harness** — Input `reference/harness.jpg`. Simple faceless person from hips to head putting on the black harness, shoulder straps and horizontal chest strap, GoPro quick-release mounting base centered on the sternum, no camera or phone. One hand adjusts shoulder strap; orange-red arrow shows strap over shoulder and highlights harness.
- **b1_samewifi** — Input `manual/img/b6_02_harness.png`. Laptop and phone side by side, with a central shared Wi-Fi symbol and orange-red arcs. Screens contain abstract shapes only.
- **b3_sd_mac** — Input `manual/img/b6_02_harness.png`. Hand holds tiny black microSD with clipped corner and eight gold contacts; arrow points to the narrow rectangular microSD card slot of a USB-C reader connected to a laptop. Do not depict a USB-C socket as the card slot.
- **b6_08_kneel** — Inputs `manual/img/b6_02_harness.png`, `renders/bodycam_assembled.png`. Faceless adult wearing a black chest harness and landscape bodycam, kneeling beside a CPR training manikin with both hands together in the center of its chest. Clear three-quarter view, orange-red emphasis on the hands.
- **b6_09_frame_ok** — Input `manual/img/b6_02_harness.png`. First-person chest-camera view of two normal hands, one directly atop the other, centered on a CPR training manikin's sternum, forearms entering from lower corners. Manikin chest fills frame, orange-red outline around hands. No check mark or border.
- **b6_09_frame_no** — Input `manual/img/b6_02_harness.png`. First-person chest-camera view of mostly empty pale grey floor; only a small edge of the training manikin appears at the top, and hands and chest are out of frame. Orange-red accent. No cross or lettering.
- **b7_network** — Superseded by the reproducible CAD-derived builder in `scenes_network.py`; no OLED or screw holes. The previous generated illustration is retained in `img/_unused_oled/b7_network_before.png`.
