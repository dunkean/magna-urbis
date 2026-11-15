#!/usr/bin/env bash
# Publish committed HEAD as V1 on v1.magna-urbis.org.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
exec node "$ROOT/web/scripts/deploy_site.mjs" v1
