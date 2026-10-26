# Real CC0 grass: bounded A/B evidence

[gpu.json](gpu.json) records six sequential native runs on the same retained V12
packet: baseline versus prepared CC0 tufts, TOP 160m/10m and controlled OBLIQUE
10m. Each runs the production five-image layer probe. The adapter actually
reported **RTX5090**, Forward+, Godot4.7.2 / Terrain3D1.0.2. Audio uses Dummy.
The runtime is commit `157c93d`; participating file hashes and source/asset/PNG
hashes are included. All processes exited and no owned Godot remained.

Reproduce from the repository root after ingestion, using the pinned engine:

```powershell
node web/scripts/surface_vegetation_gpu.mjs --godot D:/tools/Godot_v4.7.2-stable_win64_console.exe --world retained-v12-live-refinement.surfacebin --assets surface-assets/resolved.json --vegetation-assets web/out/vegetation-assets/resolved.json
node web/scripts/surface_vegetation_gpu.mjs --godot D:/tools/Godot_v4.7.2-stable_win64_console.exe --world retained-v12-live-refinement.surfacebin --assets surface-assets/resolved.json --vegetation-assets web/out/vegetation-assets/resolved.json --widths 10 --oblique --out web/out/vegetation-gpu-oblique
```

Technical A/B passes: source terrain/context/parents/ground/detail/inventory
fingerprints and actual family counts match. Ground/no-low-cover central pixels
match. Layer toggles preserve allocations and remove the intended instances.
The actual MultiMesh material and its alpha/normal/ARM maps compiled and rendered;
only the existing Terrain3D physics-interpolation deprecation warning occurred.
The TBN formula has no separate GPU normal-direction oracle in this proof.

Images were opened: the close green prisms become fine textured blades. TOP
shows little leaf area naturally; OBLIQUE confirms slender upright blade shapes.
The exact source view has only three alpha-positive grass centres at10m,44at160m;
no density was added. This is a modest asset correction, not acceptance of the
whole scene. Shrubs, debris, rocks and spherical crowns are unchanged. This is
neither a fresh generation nor a navigation/performance qualification. The
recorded20–25s process durations include initialization and five captures and
are not FPS. VRAM was not measured.

Raw logs/metrics/PNGs remain in ignored `web/out/vegetation-gpu/` and
`web/out/vegetation-gpu-oblique/` of the producing worktree. The evidence JSON
preserves their hashes and paths; images are not silently relabelled V12 finals.
