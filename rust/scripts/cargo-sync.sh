#!/usr/bin/env sh
# Git Bash entry point for cargo-sync.ps1 (same lock, affinity, shared target dir).
#   rust/scripts/cargo-sync.sh build -p magna-urbis-local
exec pwsh -NoProfile -File "$(dirname "$0")/cargo-sync.ps1" "$@"
