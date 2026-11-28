# Audit brief: 2D/3D display management in Magna Urbis (all styles, all contexts)

Repository: D:/workspace/self/magna-urbis (web app in `web/`, Rust in `rust/`). Write in English.

## The owner's question
"The WebGPU / WebGL2 / D3D11 / Vulkan situation has been a mess from the start, and Firefox can barely run Magna Urbis.
Why is there still WebGPU? Why does it compile for so long when the shaders were supposedly split and modularised?
I want an explicit path, and an optimisation for the local (desktop) app only where one really exists."

Audit how the app displays maps and towns in 2D and 3D, for every render style (parchment, parchment-night, satellite,
satellite-2 and their night variants, atlas, topographic, cadastre, illustration, V1 map...) and every context:
- V2 page (`v2.html`, the reference), City Bench (`citybench.html`, debug bench that must match V2), render board / v7 sheets
  (headless Chrome captures), web build on GitHub Pages, desktop app (Tauri / WebView2 on Windows, WebKitGTK on Linux, WKWebView on macOS),
  phones, Firefox (including over Remote Desktop, where it has neither WebGL2 nor WebGPU in hardware).
Then say how to make it coherent, clear, debuggable and, above all, much faster.

## Facts measured on 2026-11-28 (headless Chrome, RTX 4090, Windows 11)
- Backend choice is automatic: `web/src/ui/terrainRenderer.ts` uses WebGPU whenever `navigator.gpu` exists, else WebGL2 (`TerrainGl`);
  `web/src/ui/view3d/host/host.ts` starts 3D on WebGL2 then upgrades to WebGPU; `?renderer=webgl|webgpu` forces one (`ui/rendererOverride.ts`).
- With `--use-angle=d3d11`, headless Chrome exposes a WebGPU adapter (Dawn/D3D12). Switching City Bench (16 km map, 150k-town decor) from parchment
  to the `satellite` composition preset froze the page for **1307 s**: the renderer process idle, one GPU-process thread at 100 % CPU (shader
  compilation). The satellite ground then appeared correctly.
- With `--use-angle=vulkan`, headless Chrome has `navigator.gpu` but `requestAdapter()` returns null, so the WebGL2 path is used: no freeze (about 20 s),
  but the satellite ground is **white** in City Bench, with a broken-image icon at the top-left of the map (origin not found yet: both SVG
  `<image>` elements of `svg#map` decode fine).
- The capture scripts wait for `#viewport` `data-ground-applied === data-ground-wanted`, which is set when the ground is *requested*, not when
  the GPU has drawn it: captures taken during the compile came out blank (megacity sheets, `web/out/planches-styles-v7/megapoles.mjs`,
  `run.mjs`, `v2drive.mjs`).
- Earlier v7 passes had pages frozen "outside JS" for minutes (2D topographic view of an elven 10k town in V2; a City Bench megacity right after
  the buildings/volumes step).

## History to take into account (read the reports, do not trust them blindly)
- 2026-11-12 renderer-load round: on ANGLE D3D11 cold satellite took 56 s vs 1-6 s on Vulkan; Chrome on Windows runs the map on WebGPU/Dawn D3D12
  with DXC, whose compile time follows the *inlined* size of live code; shaders were reworked (lot 6) and idle prewarm added.
  Reports: `web/out/renderer-load-2026-11-12/`, `web/out/lot6-shaders-2026-11-12/REPORT.md`, `web/out/renderer-load-final-2026-11-12/REPORT.md`,
  `web/out/renderer-load-codex-2026-11-12/REPORT.md`. The desktop app (WebView2) does not pass `--use-angle=vulkan`.
- 2026-11-18 live compositor (`web/src/render/live/`, one WebGL2 canvas for the moving 2D view; exact Canvas renderers still paint the view at
  rest, captures, exports and sheets). Notes: `web/out/live-compositor-2026-11-18/`.
- 2026-11-12/13 vector GPU engine (`web/src/render/gpu/recorder.ts`, `glRaster.ts`, policy `render/vectorEngine.ts`, design
  `web/out/vector-gpu-2026-11-12/DESIGN.md`).
- Owner rule since 2026-11-18: "everything that can be drawn in WebGL goes to WebGL", geometry built once per content, instanced.
- V2 is the reference; shared render choices live in `web/src/render/cityContract.ts` and shared modules; `web/tests/v2/cityParity.test.ts`.
- Docs: `docs/RENDERING.md`, `docs/SURFACE_RENDER_LAYERS.md`, `docs/RENDER_SURFACE_DESIGN.md`, `docs/V2_RENDER_REFACTORING_FR.md`,
  `docs/MAGNA_URBIS_RENDER_COMPOSITION_SPEC.md`, `web/out/render-audit-2026-11-06/HANDOFF.md`.

## What to deliver (one Markdown report)
1. **Map of the current display pipeline**: for each context x style x 2D/3D, which technologies draw what (WebGPU, WebGL2, Canvas2D, SVG, DOM,
   workers/OffscreenCanvas, WASM), how the backend is chosen, fallbacks, and where "ready" signals are set. File:line references.
2. **Why WebGPU is still there**: what depends on it, what it buys (measured where reports exist), what breaks without it.
3. **Why compilation is still slow** despite the split: which pipelines/shaders are compiled for the satellite ground and 3D, their inlined size,
   when they are compiled (load, prewarm, first draw), whether pipeline creation is synchronous somewhere, and why D3D11/D3D12 differ from Vulkan.
   Explain the 1307 s freeze if you can from the code.
4. **Defects and incoherences**: duplicated paths that drift (WebGL2 vs WebGPU ground, Canvas vs GPU vector, V2 vs City Bench), silent fallbacks,
   lying ready signals, Firefox / RDP / phones / WebView2 / WebKitGTK behaviour, why the WebGL2 satellite ground is white in City Bench.
5. **Target design**: one explicit, documented backend path per context (what is the reference renderer, what is an optional accelerator and under
   which proof of parity), how the choice is shown and logged, a real "frame drawn" signal for captures, how to debug (overlay, `?renderer=`,
   per-layer diagnostics), and how to make first display and style switches much faster (shader architecture, caching, precompilation for the
   desktop app only where it truly helps, e.g. WebView2 flags or a pipeline cache).
6. **Ordered plan**: lots with expected gain, risk and how to measure each (existing probes: `scripts/nav_fps_probe.mjs`,
   `scripts/vector_gpu_parity.mjs`, `web/out/renderer-load-*/` tools).

Mark every claim **verified in code** (with file:line) or **inferred**. Prefer fewer, solid findings over many guesses.

## Rules
- Read-only audit: do not edit source files, do not build (no cargo, no vite build, no npm install), do not start servers or browsers,
  do not use any GPU. The RTX 5090 is reserved for the owner's neural training.
- Other sessions work in this tree: never touch git state.
- Time box: about 45 minutes. If short of time, deliver sections 3, 4 and 5 first.
