#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
cad/.venv/bin/python renders/src/make_demo_texture.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 -P renders/src/render_product_demo.py -- relay_lcd relay_lcd_labeled medkit medkit_labeled demo_scene
cad/.venv/bin/python renders/src/annotate_demo.py
