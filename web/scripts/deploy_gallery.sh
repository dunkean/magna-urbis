#!/usr/bin/env bash
# Publish the V2 preview gallery (built by web/out/planches-styles-v6/review/gallery.py) to gh-pages:/gallery/v2/
# on top of the deployed app, without touching it. Optionally set GITHUB_TOKEN_FILE=/path/to/token.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
SRC=${1:-$ROOT/web/out/gallery-v2}
REMOTE=$(git -C "$ROOT" remote get-url origin)
AUTH=()
if [[ -n "${GITHUB_TOKEN_FILE:-}" ]]; then
  T=$(tr -d ' \r\n' < "$GITHUB_TOKEN_FILE")
  AUTH=(-c http.extraheader="Authorization: Basic $(printf 'x-access-token:%s' "$T" | base64 -w0)")
fi
TMP=$(mktemp -d)
git "${AUTH[@]}" clone -q --depth 1 --branch gh-pages "$REMOTE" "$TMP/site"
rm -rf "$TMP/site/gallery/v2" && mkdir -p "$TMP/site/gallery/v2" && cp -r "$SRC"/. "$TMP/site/gallery/v2/"
git -C "$TMP/site" add -A gallery
git -C "$TMP/site" -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" commit -qm "Gallery V2 preview ($(date +%F))" || { echo "Gallery unchanged"; exit 0; }
git -C "$TMP/site" "${AUTH[@]}" push -q "$REMOTE" gh-pages
rm -rf "$TMP"
echo "Gallery published: https://dunkean.github.io/magna-urbis/gallery/v2/"
