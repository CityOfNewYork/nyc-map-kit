#!/usr/bin/env bash
# nyc-map-kit — the fonts and icons the Protomaps basemap draws its labels with.
#
#     build/protomaps-assets.sh
#
# Writes app/public/protomaps/ from one pinned commit of protomaps/basemaps-assets: the
# three Noto Sans faces the style names, and the light icon sheet at both pixel densities.
# The app serves them from its own host, beside the tiles, and the files are committed, so
# a build does not run this. Run it to move to a newer commit, then look the map over.
#
# The fonts are under the SIL Open Font License (fonts/OFL.txt). The icons derive from
# Mapzen's MIT-licensed tangrams/icons (sprites/LICENSE.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/app/public/protomaps"
ASSETS_REPO="https://github.com/protomaps/basemaps-assets"
ASSETS_COMMIT="028c18f713baecad011301ff7a69acc39bcc2ae7"
ICONS_LICENSE="https://raw.githubusercontent.com/tangrams/icons/92510779634f4a006c61ea70e50cb8c52c765a81/LICENSE.md"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q
git -C "$TMP" fetch -q --depth 1 "$ASSETS_REPO" "$ASSETS_COMMIT"
git -C "$TMP" checkout -q FETCH_HEAD

rm -rf "$OUT"
mkdir -p "$OUT/fonts" "$OUT/sprites/v4"
cp -R "$TMP/fonts/Noto Sans Regular" "$TMP/fonts/Noto Sans Medium" \
  "$TMP/fonts/Noto Sans Italic" "$TMP/fonts/OFL.txt" "$OUT/fonts/"
cp "$TMP"/sprites/v4/light.json "$TMP"/sprites/v4/light.png \
  "$TMP"/sprites/v4/light@2x.json "$TMP"/sprites/v4/light@2x.png "$OUT/sprites/v4/"
curl -fsSL --proto '=https' --retry 3 "$ICONS_LICENSE" -o "$OUT/sprites/LICENSE.md"
