#!/usr/bin/env bash
# Builds a web-ready copy of the manual in manual/web/: JPEG images (smaller than the
# 1.6 MB PNG renders) and an index.html that points at them.
# Usage: bash hardware/manual/build_web.sh
set -euo pipefail
M="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
W="$M/web"
rm -rf "$W"; mkdir -p "$W/img"
n=0
for f in "$M"/img/*.png; do
  b="$(basename "$f" .png)"
  # icons stay small; step pictures max 1600 px
  case "$b" in icon_*) size=600 ;; *) size=1600 ;; esac
  sips -s format jpeg -s formatOptions 84 -Z "$size" "$f" --out "$W/img/$b.jpg" >/dev/null
  n=$((n+1))
done
# point the page at .jpg files
sed -e 's#src="img/${id}.png"#src="img/${id}.jpg"#' \
    -e 's#`img/icon_${k}.png`#`img/icon_${k}.jpg`#' "$M/index.html" > "$W/index.html"
grep -q 'img/${id}.jpg' "$W/index.html" || { echo "image path rewrite failed"; exit 1; }
grep -q 'img/icon_${k}.jpg' "$W/index.html" || { echo "icon path rewrite failed"; exit 1; }
echo "converted $n images"; du -sh "$W"
