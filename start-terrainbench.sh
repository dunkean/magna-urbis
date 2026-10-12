#!/usr/bin/env sh
# Lance le service neural (Rust/wgpu) en arriere-plan et le serveur Vite du
# terrain bench au premier plan. Ctrl+C arrete les deux.
# Arguments supplementaires -> neural serve.
set -e
WEB="$(cd "$(dirname "$0")/web" && pwd)"
cd "$WEB"

if [ ! -d node_modules ]; then
  echo "Installation des dependances web..."
  npm install
fi

npm run neural:serve -- "$@" &
# kill 0 vise tout le groupe : npm, cargo et le binaire neural.
trap 'trap - EXIT INT TERM; kill 0 2>/dev/null' EXIT INT TERM

echo "Terrain bench : http://localhost:5173/terrainbench.html"
echo "Le service neural chauffe ses noyaux GPU pendant environ une minute."
npm run dev:terrain
