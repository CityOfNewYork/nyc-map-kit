#!/usr/bin/env bash
# nyc-map-kit — Clash Grotesk Semibold, the heading face of the warming app's hero, from
# Fontshare.
#
#     build/clash-grotesk.sh
#
# Writes app/public/fonts/ClashGrotesk-Semibold.woff2, the web font exactly as Fontshare
# publishes it. The ITF Free Font License (in the download, License/FFL.txt) allows a site
# to self-host the font but not to redistribute it, so the file is not committed: CI runs
# this before each deploy, and anyone building a copy of the site fetches their own from
# Fontshare. Without the file the hero's heading is set in Noto Sans.
#
# The checksum is of the file as published on 2026-10-17. If Fontshare publishes a new
# version, this stops until the checksum is updated.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/app/public/fonts/ClashGrotesk-Semibold.woff2"
ZIP_URL="https://api.fontshare.com/v2/fonts/download/clash-grotesk"
MEMBER="ClashGrotesk_Complete/Fonts/WEB/fonts/ClashGrotesk-Semibold.woff2"
SHA256="c0fb7a1f0a1e642e38998fc6dd39a1f2820043112cd2da15413c8a4d0d98a911"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$ZIP_URL" -o "$tmp/clash-grotesk.zip"
unzip -p "$tmp/clash-grotesk.zip" "$MEMBER" > "$tmp/font.woff2"
echo "$SHA256  $tmp/font.woff2" | shasum -a 256 -c - >&2
mv "$tmp/font.woff2" "$OUT"
