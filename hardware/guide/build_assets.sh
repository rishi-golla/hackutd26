#!/usr/bin/env bash
# Copies renders, illustrations and diagrams into guide/assets as web-sized images.
# Run from anywhere: bash hardware/guide/build_assets.sh
set -euo pipefail
HW="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$HW/guide/assets"
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg "$OUT"/*.png

# Photo-like images -> JPEG, 1400 px max side
for f in "$HW"/renders/*.png "$HW"/illustrations/*.png; do
  b="$(basename "$f" .png)"
  if [[ "$f" == */illustrations/* ]]; then
    case "$b" in *_v1|relay-box) continue;; esac
  fi
  sips -s format jpeg -s formatOptions 80 -Z 1400 "$f" --out "$OUT/$b.jpg" >/dev/null
done
# Product photos
for f in "$HW"/reference/*.jpg; do cp "$f" "$OUT/part-$(basename "$f")"; done
# Diagrams -> PNG, 1800 px wide (crisp text)
for f in "$HW"/diagrams/*.png; do
  sips -Z 1800 "$f" --out "$OUT/$(basename "$f")" >/dev/null
done
du -sh "$OUT"; ls "$OUT" | wc -l
