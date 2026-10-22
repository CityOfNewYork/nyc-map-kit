#!/usr/bin/env bash
# nyc-map-kit — builds the app the way .github/workflows/pages.yml does for main: install,
# lint, test, fetch the pinned Protomaps basemap and Clash Grotesk, then `npm run build`.
#
#     deploy/build.sh
#
# The app's search search box uses the Geoclient v2 REST API for geocoding hosted
# on the NYC API Developers Postal. A subscription key must provided with each
# call which is currently sent in an HTTP header.
#
# The npm build requires that VITE_GEOCLIENT_KEY be defined in file app/.env.local.
# If this file does not exist, the build will fail. If it exists but
# VITE_GEOCLIENT_KEY is undefined or invalid, the search box will not work.
#
# The file app/.env.local should not be committed to git and .gitignore has a
# pattern definition which will enforce this. See the app/.env.example file for
# more information.
# 
#
# Each step is named; if one fails the script stops and says which, with its exit code.
set -euo pipefail

STEP="starting up"

fail() {
  echo "Error: $*" >&2
  exit 1
}

trap 'code=$?; echo "Error: build failed during \"${STEP}\" (exit code ${code}, line ${LINENO})." >&2' ERR

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Keep in step with the workflow (and build/protomaps.sh) when a newer basemap is cut.
BASEMAP_URL="https://github.com/CityOfNewYork/nyc-map-kit/releases/download/basemap-20261019-3/nyc-20261019-3.pmtiles"
BASEMAP_SHA256="b36c554f9ed888292c924c24ab7b9e6738b6c58212586337ea2df000b28ad2ca"
BASEMAP_OUT="app/public/nyc.pmtiles"

STEP="checking prerequisites"
for cmd in npm curl; do
  command -v "$cmd" >/dev/null 2>&1 || fail "required command '$cmd' was not found on PATH."
done
if command -v sha256sum >/dev/null 2>&1; then
  sha256_check() { sha256sum -c -; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_check() { shasum -a 256 -c -; }
else
  fail "neither 'sha256sum' nor 'shasum' was found on PATH."
fi

[[ -x build/clash-grotesk.sh ]] || fail "build/clash-grotesk.sh is missing or not executable."

STEP="npm ci"
npm ci

STEP="npm run lint"
npm run lint

STEP="npm test"
npm test

STEP="downloading the Protomaps basemap from $BASEMAP_URL"
BASEMAP_TMP="$(mktemp "$BASEMAP_OUT.XXXXXX")"
trap 'rm -f "$BASEMAP_TMP"' EXIT
curl -fsSL --proto '=https' --proto-redir '=https' --retry 3 "$BASEMAP_URL" -o "$BASEMAP_TMP"

STEP="verifying the checksum of the downloaded basemap (expected $BASEMAP_SHA256)"
echo "$BASEMAP_SHA256  $BASEMAP_TMP" | sha256_check
mv "$BASEMAP_TMP" "$BASEMAP_OUT"
echo "Protomaps basemap: $BASEMAP_URL"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Protomaps basemap: $BASEMAP_URL" >> "$GITHUB_STEP_SUMMARY"
fi

STEP="fetching Clash Grotesk (build/clash-grotesk.sh)"
build/clash-grotesk.sh

STEP="npm run build"
npm run build

STEP="done"
echo "Build succeeded."
