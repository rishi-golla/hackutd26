# Handoff illustration prompts

Tool: built-in image_gen. These are conceptual illustrations; final geometry is pending CAD renders.

Shared direction: wide landscape 1536×1024, clean semi-realistic product illustration for a Handoff build guide; soft studio light, dark graphite hardware, no arrows, no logos or legible text except a small red HANDOFF wordmark on the bodycam case.

## hero.png
A gloved paramedic in a plain EMS uniform kneels beside a CPR training manikin on the floor. On their chest is a black Pixel 9 Pro held landscape in a dark graphite printed clamshell on a black GoPro-style chest harness; its rear camera faces outward and slightly down. A power-bank-sized dark graphite relay box sits beside the manikin with a small white-on-black OLED and glowing ring button, and a thin cable to a dark finger clip on the manikin's finger.

## wear-harness.png
Front view of a person wearing a black GoPro-style chest harness: shoulder straps and buckle centered on sternum; black Pixel 9 Pro held landscape in a dark graphite 3D-printed clamshell case, outward-facing rear camera, tilted approximately 15 degrees downward.

## finger-clip.png
Close-up of a patient's index finger in a small opaque dark finger-clip tunnel, pad resting on sensor window flush with tunnel floor; Velcro strap across the finger top; thin cable exits sideways. Clear view of the finger-clip assembly.

## relay-box.png
Dark graphite rounded relay box approximately 15 × 7.5 × 4 cm on a table, white-on-black OLED showing an illustrative heart rate number and waveform, a 16 mm brushed-steel push button with glowing green ring; thin power bank strapped flat underneath. Exclude all other text.

## system.png
Four separate devices arranged together on a table: black Pixel 9 Pro held landscape in dark graphite clamshell case; compact dark graphite relay box with small OLED, steel ring button and thin cable to finger clip; a second phone representing a hotspot; an open MacBook with a hospital dashboard visible. No arrows or explanatory text.

## Refinement prompts

- wear-harness: Front view of a person in a black GoPro-style chest harness. The black Pixel 9 Pro is rotated 90 degrees into landscape, so its camera pill is vertical near one short end of the horizontal phone, not horizontal. Case is graphite, camera faces out and slightly down, small red HANDOFF wordmark, no other writing.
- system: Four items on a table: landscape black Pixel 9 Pro in graphite case with camera pill vertical near a short end; relay with OLED and ring button connected to finger clip; separate hotspot phone; laptop with generic hospital dashboard. No arrows, branding or legible text.
- finger-clip: Index finger inserted in opaque dark printed tunnel closed at the distal end, finger pad on sensor window in floor, Velcro over the top, thin cable exits sideways.
- relay-box: Only one device on a table: dark graphite rounded relay box 15 × 7.5 × 4 cm, small OLED with heart-rate number and waveform, 16 mm brushed-steel button with glowing green ring, thin power bank strapped flat underneath with black Velcro. No extra camera, phone, logo, or text.
- relay-box final refinement: show 72 and a smooth rounded photoplethysmogram-style pulse waveform on the OLED, no ECG-style sharp spikes; dark graphite rounded relay enclosure, green-ring steel button, power bank Velcro-strapped underneath; no other devices or writing.

## CAD-referenced revision (October 31)

Built-in image_gen; use the listed CAD renders as geometry references, and `hero.png` for semi-realistic lighting and style. All images are conceptual visual aids; construction should follow the actual CAD.

### wear-harness.png
References: `renders/bodycam_assembled.png`, `renders/bodycam_worn.png`, `reference/harness.jpg`, `illustrations/hero.png`. Show a person wearing the black chest harness and the fully enclosed graphite clamshell case holding the phone landscape. Reproduce the CAD: vertical camera pill at one end, six narrow vent slots, red HANDOFF, four corner screw ears. Tilt camera ~15° downward. Two case fingers interleave with the harness buckle's three prongs, a horizontal black thumbscrew through the joint, buckle seated in the harness chest base. No phone clamp, jaws, or retaining clips.

### relay-box_v2.png
References: `renders/relay_assembled.png`, `renders/relay_exploded.png`, `illustrations/hero.png`. Three-quarter view of the graphite CAD-matched box on a table: OLED at one end of the top lid, central vent slots, glowing green ring button at the other end; recessed red HANDOFF RELAY, FINGER, MARK labels; corner screws, side vents, end carry loop; black power bank strapped underneath with two black Velcro straps. Keep the OLED and button on the lid.

### step-thumbscrew.png
References: `renders/bodycam_worn.png`, `renders/p1_mount_test.png`, `reference/harness.jpg`, `illustrations/hero.png`. Realistic close-up of hands attaching the bodycam to the GoPro harness: two fingers on the case's chest side interleave with three fingers on the buckle, coaxial holes joined by a single black thumbscrew being tightened by hand. Show buckle and harness chest base. No clamp or additional hardware.

### step-powerbank.png
References: `renders/relay_assembled.png`, `renders/relay_exploded.png`, `renders/p2_base.png`, `illustrations/hero.png`. Low three-quarter assembly view of the relay with a flat black power bank strapped under the base using two Velcro straps through its base slots. A short USB-A to right-angle USB-C cable connects the power bank to the Pi's USB-C opening. Recognizable CAD lid, vents, red labels and carry loop. No arrows.

Power-bank image note: the first generated image shows a right-angle cable at the case opening but the connector geometry is ambiguous. Subsequent image-gen attempts to refine it using `reference/cable.jpg` were rejected by the output safety system; use the product cable photo and CAD for the connector detail.

## Redesigned finger cradle revision

Built-in image_gen; match the redesigned cradle and keep its proportions slightly roomier than the referenced renders because the CAD visor will rise ~3 mm and the channel will widen. Preserve the semi-realistic studio style of `hero.png`.

### finger-clip.png v2
References: `renders/finger_clip_assembled.png`, `renders/finger_clip_strapped.png`, `illustrations/hero.png`. Show an intact adult hand palm-down on a table with its index finger in a low graphite open-top U-cradle on a flat tray. The finger pad rests on the flush sensor window and its tip slides under the short boxy visor. One 13 mm black Velcro strap passes through the low wall slots, over the finger just behind the visor, then under the tray. A thin cable exits sideways. This is a cradle, not a hinged spring clip or full finger tunnel.

### system.png v2
References: `renders/finger_clip_assembled.png`, `renders/bodycam_assembled.png`, `renders/relay_assembled.png`, `illustrations/hero.png`. Arrange the four system components on a table: the landscape Pixel inside its vented graphite bodycam clamshell; the graphite relay with OLED and ring button on the lid, carry loop, power bank strapped underneath, and a thin cable to the redesigned open-top visor-and-strap finger cradle; a second phone as hotspot; and a MacBook showing a generic hospital dashboard. No arrows.
