@echo off
rem Lance le service neural (Rust/wgpu) et le serveur Vite du terrain bench,
rem chacun dans sa propre fenetre. Arguments supplementaires -> neural serve.
setlocal
set "WEB=%~dp0web"

if not exist "%WEB%\node_modules" (
  echo Installation des dependances web...
  pushd "%WEB%" && call npm install && popd || exit /b 1
)

start "Magna Urbis - neural" /D "%WEB%" cmd /k npm run neural:serve -- %*
start "Magna Urbis - terrain bench" /D "%WEB%" cmd /k npm run dev:terrain

echo Terrain bench : http://localhost:5173/terrainbench.html
echo Le service neural chauffe ses noyaux GPU pendant environ une minute.
endlocal
