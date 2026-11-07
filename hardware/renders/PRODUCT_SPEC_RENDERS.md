# HackUTD product-spec concept renders — 7 November 2026

The current set contains five 1600 × 1000 PNGs, with flat-colour fills, dark outlines and a light neutral setting. Relay, bodycam, finger-clip and LCD-pod meshes are reused from the existing manual assets. No CAD sources or STLs have been changed.

| Current image | Content and approximations |
|---|---|
| [demo_scene.png](demo_scene.png) | Training manikin, kneeling medic wearing the bodycam, LCD relay, shield-free med kit and seated sensor volunteer. No tablet or OLED. People, posture and furniture are stylised. |
| [relay_lcd.png](relay_lcd.png) | Closed relay and existing LCD1602 pod, held by the left of two full-stack straps. MARK button, finger cable, LCD leads via vent 3, temperature leads via vent 2. |
| [relay_lcd_labeled.png](relay_lcd_labeled.png) | Same camera and geometry, with six component callouts. |
| [medkit.png](medkit.png) | Cutaway tray, dummy vials, sensors, countdown, bare UNO Q, shared breadboard and USB-C bank. Component geometry and cable dressing are schematic. |
| [medkit_labeled.png](medkit_labeled.png) | Same med-kit camera with seven callouts identifying the bare board, jumper breakouts and shared power/I2C breadboard. |

## Current relay and full scene

- The team dropped the Touch Display, tablet and relay OLED. The current display is the **GeeekPi-style I2C LCD1602** in the existing **lcd1602_pod.stl**, at the established X=0, Y=10, Z=39.4 placement. The pod is unchanged, angled 20° above the lid and retained under the left full-stack strap.
- LCD PCB **80 × 36 mm**, bezel **71 × 24 mm**, PCF8574 backpack and connector dimensions remain the original fit assumptions. The blue backlight now shows two 16-character demo lines: `HR  72  SpO2  97` and `pulse    LINK OK`. Cosmetic details and text are illustrative; no logo is rendered.
- The LCD's four leads follow the existing pod route through **vent 3**, centred X=78.6. The three temperature leads exit **vent 2**, centred X=71.6, to an approximate **15 × 20 mm 18B20 module** beside the relay. These exterior views do not certify internal pin assignments, engagement or new electrical clearances.
- The full scene uses the same LCD relay and approved shield-free med-kit builders as the close-ups. The optional extra operator figure was omitted; the accepted medic, manikin and volunteer composition is retained.
- The sensor-cable centreline totals nominally **500 mm**, including the existing relay service route. Cable drape and volunteer pose remain illustrative.
- Demo readings are authored presentation content, not live measurements or software screenshots. Commercial logos are omitted; HANDOFF lettering remains part of the unchanged printed model.
- Earlier `monitor_relay*.png` tablet/OLED views remain on disk as **superseded** and are excluded from the default render command. The brief-lived OLED-only previews were moved to `_unused_oled/`. Neither represents the current build.

## Current med kit

- Tray **180 × 120 mm**, vials **Ø24 × 50 mm**, UNO Q **68.85 × 53.34 mm**, mini breadboard **45 × 35 mm**. The bare UNO has female headers along the long edges and a visible **8 × 13 blue LED matrix**. Component/matrix placement is schematic. Dimensions and matrix facts follow the [official UNO Q page](https://store-usa.arduino.cc/products/uno-q); header signal names follow the [official pinout](https://docs.arduino.cc/resources/pinouts/ABX00162-full-pinout.pdf).
- Individual male jumper pins are inserted into white female Grove cable ends. IR yellow goes directly to **D2**, light yellow to **A0**. Their white contacts remain unused.
- All four modules' red and black wires join separate **3.3 V and GND breadboard rows**, with one UNO feed per row. Each uses five separate contacts. The temperature/barometer and quad alphanumeric module share **SDA and SCL rows**, with one jumper each to the UNO header. The coordinator explicitly approved using the breadboard for power as well as I2C.
- The display represents a **0.54-inch quad alphanumeric I2C module** showing `3:12`; its exact package is approximate. Grove boards, foam, cardboard and generic bank are schematic. The bank sits farther sideways to make room for the breadboard.
- Front walls and pocket fronts are cut away to reveal sensors beneath the vial slots. The concept illustrates the agreed connections; it is not a tested electrical assembly or exact lead-length plan.

## Re-render

From `hardware/`:

```sh
renders/src/render_demo.sh
```

This regenerates the five current images and their labels. Sources are in `renders/src/`, assets in `renders/assets/`, and QA records/logs in `renders/qa/`. All writes stay under `renders/`.
