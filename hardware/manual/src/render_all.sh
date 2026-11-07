#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 "$SCRIPT_DIR/export_assets.py"
/Applications/Blender.app/Contents/MacOS/Blender -b -P "$SCRIPT_DIR/render_manual.py" -- "$@"
