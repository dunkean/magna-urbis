#!/usr/bin/env bash
# Publish committed HEAD as V2 on magna-urbis.org.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
exec node "$ROOT/web/scripts/deploy_site.mjs" v2
