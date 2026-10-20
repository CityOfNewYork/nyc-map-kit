#!/usr/bin/env bash
# nyc-map-kit — the Protomaps basemap for the map's area, cut from Protomaps' daily build.
#
#     build/protomaps.sh
#
# Writes app/public/nyc.pmtiles: every tile from z0 to z15 that covers the area the map
# lets a reader pan to (MAX_BOUNDS in app/src/core/map-core.ts). Outside the city line
# the tiles then keep only land, water, parks and roads (build/protomaps-outside.py),
# which brings the file from about 170 MB to about 100 MB. A reader's browser fetches only the
# tiles on screen, by range request. Prints the name of the build it cut from.
#
# The file is too large for git. A deploy downloads one pinned cut (BASEMAP_URL in
# .github/workflows/pages.yml), so the basemap changes only when someone means it to.
# To move to a newer build: run this, look the map over, attach the file to a release
# named for the build, and set BASEMAP_URL and BASEMAP_SHA256 to it:
#
#     cp app/public/nyc.pmtiles nyc-YYYYMMDD.pmtiles
#     gh release create basemap-YYYYMMDD nyc-YYYYMMDD.pmtiles --notes "…"
#     shasum -a 256 nyc-YYYYMMDD.pmtiles
#
# Needs the pmtiles CLI on PATH, a single binary from
# https://github.com/protomaps/go-pmtiles/releases. Protomaps keeps a week of daily builds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/app/public/nyc.pmtiles"
BBOX="-74.52,40.39,-73.43,41.03"   # MAX_BOUNDS in app/src/core/map-core.ts
MAXZOOM=15                          # the deepest zoom Protomaps builds

BUILD="$(curl -fsS https://build-metadata.protomaps.dev/builds.json | node -e '
  let raw = ""; process.stdin.on("data", (c) => raw += c).on("end", () => {
    const keys = JSON.parse(raw).map((b) => b.key).filter((k) => /^\d{8}\.pmtiles$/.test(k));
    console.log(keys.sort().at(-1));
  });')"

pmtiles extract "https://build.protomaps.com/$BUILD" "$OUT" \
  --bbox="$BBOX" --maxzoom="$MAXZOOM" --download-threads=8 >&2
python3 "$ROOT/build/protomaps-outside.py"
echo "$BUILD"
