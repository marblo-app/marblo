#!/usr/bin/env bash
# Convert a chosen concept SVG into the full icon set:
#   icon.png (1024)  ·  icon.icns (mac)  ·  icon.ico (win, >=256 multi-size)
#
# Usage:   ./build-icons.sh concept-b.svg
# Output:  ./out/{icon.png,icon.icns,icon.ico}  (NOT auto-copied to resources/)
#
# Requirements:
#   - rsvg-convert  (brew install librsvg)         SVG -> PNG rasterize
#   - iconutil      (ships with macOS Xcode CLT)   PNG set -> .icns
#   - magick/convert (brew install imagemagick)    PNG set -> multi-size .ico
#
# NOTE on the .ico size guard: electron-builder's nsis target rejects any .ico
# whose largest frame is < 256px ("ERR_ICON_TOO_SMALL"). The current
# resources/icon.ico is only 16x16, which is why electron-builder.yml points
# win.icon at the 1024 PNG instead. This script emits a proper >=256 .ico so a
# future win.icon: resources/icon.ico switch is safe.
set -euo pipefail

SVG="${1:?usage: ./build-icons.sh <concept-x.svg>}"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/out"
ICONSET="$OUT/icon.iconset"
rm -rf "$OUT"; mkdir -p "$ICONSET"

command -v rsvg-convert >/dev/null || { echo "need rsvg-convert (brew install librsvg)"; exit 1; }

png() { rsvg-convert -w "$1" -h "$1" "$DIR/$SVG" -o "$2"; }

# 1) Master 1024 PNG
png 1024 "$OUT/icon.png"
echo "✓ icon.png (1024)"

# 2) macOS .iconset -> .icns
for s in 16 32 128 256 512; do
  png "$s"        "$ICONSET/icon_${s}x${s}.png"
  png "$((s*2))"  "$ICONSET/icon_${s}x${s}@2x.png"
done
if command -v iconutil >/dev/null; then
  iconutil -c icns "$ICONSET" -o "$OUT/icon.icns"
  echo "✓ icon.icns"
else
  echo "⚠ iconutil not found (macOS only) — skipped icon.icns"
fi

# 3) Windows .ico — multi-size, largest frame 256 (satisfies electron-builder)
ICO_SIZES=(16 24 32 48 64 128 256)
ICO_PNGS=()
for s in "${ICO_SIZES[@]}"; do png "$s" "$OUT/_ico_${s}.png"; ICO_PNGS+=("$OUT/_ico_${s}.png"); done
if command -v magick >/dev/null; then MK=(magick); elif command -v convert >/dev/null; then MK=(convert); else MK=(); fi
if [ "${#MK[@]}" -gt 0 ]; then
  "${MK[@]}" "${ICO_PNGS[@]}" "$OUT/icon.ico"
  echo "✓ icon.ico (16..256 multi-size)"
else
  echo "⚠ ImageMagick not found — skipped icon.ico (electron-builder can still"
  echo "  derive one from icon.png; keep win.icon: resources/icon.png)"
fi
rm -f "$OUT"/_ico_*.png
rm -rf "$ICONSET"

echo
echo "Done → $OUT"
echo "To adopt: copy out/icon.{png,icns,ico} over v3/resources/ and rebuild."
