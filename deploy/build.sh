#!/usr/bin/env bash
# nyc-map-kit — builds the app the way .github/workflows/pages.yml does for main and
# deploy/ci/azure-pipelines.yml does for its Build stage: install, lint, test, fetch the
# pinned Protomaps basemap and Clash Grotesk, then `npm run build`.
#
#     deploy/build.sh
#
# The app's search box uses the Geoclient v2 REST API, hosted on the NYC API Developer
# Portal, to geocode addresses. A subscription key must be sent with each call (currently
# in an HTTP header).
#
# The key is read at build time from VITE_GEOCLIENT_KEY, which can be set in the
# environment (it takes precedence, as in CI) or in app/.env.local. This script requires
# a non-empty key from one of them, and stops before building if there is none.
# An invalid key still builds, but address search will not work.
#
# app/.env.local must not be committed to git; .gitignore enforces this. See
# app/.env.example for more information.
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

# Keep in step with the workflow, the tileBuild variable in deploy/ci/azure-pipelines.yml
# (and build/protomaps.sh) when a newer basemap is cut.
#
# BASEMAP_URL and BASEMAP_SHA256 are pinned on purpose and must be updated together, by
# hand, whenever the pmtiles version changes: copy the new release asset's URL and its
# "sha256:" digest (shown on the release page) from the same release. The checksum is not
# fetched automatically, because it would then come from the same place as the file and
# verify nothing.
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

# Same precedence as Vite: a VITE_GEOCLIENT_KEY in the environment wins over app/.env.local.
GEOCLIENT_KEY="${VITE_GEOCLIENT_KEY:-}"
if [[ -z "$GEOCLIENT_KEY" ]]; then
  [[ -f app/.env.local ]] || fail "VITE_GEOCLIENT_KEY is not set and app/.env.local is missing; copy app/.env.example to it and set VITE_GEOCLIENT_KEY."
  GEOCLIENT_KEY="$(tr -d '\r' < app/.env.local \
    | sed -n -E "s/^[[:space:]]*VITE_GEOCLIENT_KEY[[:space:]]*=[[:space:]]*//p" \
    | tail -n 1 | sed -E "s/^[\"']//; s/[\"']\$//")"
fi
[[ -n "$GEOCLIENT_KEY" ]] || fail "VITE_GEOCLIENT_KEY is unset or empty; set it in the environment or in app/.env.local."

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

# Add read permissions to group and others for the downloaded basemap or the
# map breaks because it is not readable by the web server.
chmod a+r "$BASEMAP_OUT"

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
