# Display audit 2026-11-28 (Fable) — 2D/3D display management in Magna Urbis

Read-only audit. Nothing was built, started or rendered; no GPU was used. The only things executed were static Node scripts reading the
generated shader files (the lot 6 size estimator `web/out/lot6-shaders-2026-11-12/live.cjs`, with its file parser adapted in the scratchpad
because it no longer parses the current generated file).

Tags: **[verified]** = read in code at the given file:line (paths relative to `web/` unless they start with `rust/` or `docs/`).
**[measured-static]** = number produced today by a static script on the current files. **[inferred]** = reasoning from code, reports or
platform knowledge, not executed. **[report]** = taken from an earlier report, not re-measured.

## 0. Short answer to the owner

1. **Why is there still WebGPU?** For one reason only: on Windows, Chrome, Edge and WebView2 run WebGL2 on ANGLE/D3D11, whose HLSL compiler
   (FXC) takes tens of seconds to minutes on the ground shader; WebGPU goes through DXC instead, which is 2-4x faster cold. WebGPU buys
   **compile time on Windows, nothing else**: it does not draw anything WebGL2 cannot draw, and the WGSL is machine-translated from the GLSL.
   It is an accelerator bolted on to dodge a compiler, and it costs a second ground renderer, a second 3D renderer, two shader generators,
   4.2 MB of generated source, two GPU devices, a backend swap in flight and a set of ready signals that only one backend sets.
2. **Why is compilation still slow after the split?** Because what was split is the TypeScript around the shader, not the shader. The
   satellite ground is still **one fragment entry point whose live code inlines to 2.30 million characters** (it was 1.40 M right after lot 6
   on 2026-11-12: **+64 % in 16 days**, with no size gate, and with two lot 6 gains lost again). Both HLSL compilers pay for the inlined size
   of one function. Splitting files does not change that; only smaller programs do.
3. **The 20-minute freeze is most probably not WebGPU at all.** On every ground change City Bench also runs a *third* GPU implementation
   of the ground material (`rust/bridge/terrainMaterialRaster.ts`): the whole material in one WebGL2 program, **not specialised per look,
   compiled and linked synchronously on the main thread**. Under `--use-angle=d3d11` that program goes through FXC, the exact case the code
   itself records as "took minutes and froze the page". It fits every observed fact (renderer idle, one GPU-process thread busy, 20 s on
   Vulkan, ground correct afterwards). This is an inference from code, to confirm with one profile (section 3.5). WebGPU's own cost by the
   lot 6 timings is about 20 s per heavy pipeline, and it too can freeze the page, through synchronous captures.
4. **The path**: one reference renderer (WebGL2 for every GPU layer, Canvas for exact output), WebGPU demoted to an explicit, named
   accelerator for "Windows + Chromium" only, selected in one module, shown and logged; one honest "frame drawn with the wanted look" signal;
   a shader size budget enforced by the existing check script; then a structural cut of the ground material into small programs. If that
   cut brings FXC under a few seconds, WebGPU can be deleted entirely. The desktop-only optimisation that really exists is a **persistent
   compiled-shader cache plus a first-run warm-up**, not a different backend.

## 1. Map of the current display pipeline

### 1.1 The layers and who draws them

| Layer | Technology | Where | Backend choice |
|---|---|---|---|
| 2D ground (relief, material, forest crowns, water) | WebGPU `TerrainGpu` **or** WebGL2 `TerrainGl` **or** CPU raster | `src/ui/terrainGpu.ts`, `src/ui/terrainGl.ts`, `src/v2/display/groundProducts.ts` | automatic, see 1.2 |
| 2D ground of illustrated styles | CPU raster + Canvas2D washes and stamps over SVG | `src/ui/citybench.ts:165-178`, `:598-611`; V2 `groundProducts.ts` (CPU mode) | style trait `fantasy` |
| 2D moving view (V2) | one WebGL2 canvas, the live compositor (ground tiles, city, overlay, text) | `src/render/live/compositor.ts:131`, policy `src/render/live/policy.ts:1-10` | compositor, else the fallback view (`?display=fallback`) |
| 2D vector layers at rest, captures, exports, sheets | Canvas2D exact renderers | `src/render/canvas.ts`, `cityCanvas.ts`, `render/city/canvas/*` | reference path |
| 2D vector tiles on GPU | WebGL2 recorder/replay | `src/render/gpu/tileRasterizer.ts:100`, policy `src/render/vectorEngine.ts` | policy module |
| Town geometry on GPU | WebGL2 | `src/render/city/gl/renderer.ts:42`, `src/render/cityGlLayer.ts:91` | own contexts |
| V1 "minimal" contours | WebGL2 | `src/render/minimalContourPainter.ts:62` | own context |
| 3D view (terrain, ground material, buildings, trees) | WebGPU `Terrain3dGpu` **or** WebGL2 `Terrain3d` | `src/ui/view3d/gpu/view.ts:101`, `src/ui/view3d/terrainView.ts:540`, host `src/ui/view3d/host/host.ts` | starts WebGL2, upgrades, see 1.2 |
| 3D material tiles, drapes, exports | synchronous captures of the 2D ground renderer into Canvas2D | `src/ui/terrain/gpu/captures.ts:38-74`, `src/ui/terrain/gl/captures.ts` | follows the 2D ground |

All rows **[verified]** at the cited lines. A page can therefore hold, at the same time, at least seven WebGL2 contexts (ground or its
"material context", compositor, vector tiles, two town renderers, minimal contours, 3D) and four WebGPU canvas contexts (map, capture canvas
`captures.ts:27`, world-tile canvas `worldTiles.ts:56`, 3D view) on **two separate GPUDevices** (`src/ui/terrain/gpu/device.ts:177-200` for the
map, `src/ui/view3d/gpu/preparation.ts:19-22` for 3D) **[verified]**.

### 1.2 How the backend is chosen

- **2D ground, generic rule** — `createTerrainRenderer` (`src/ui/terrainRenderer.ts:54-68`): WebGPU when `navigator.gpu` exists and
  `?renderer` is not `webgl`; any exception or an `undefined` renderer falls to `new TerrainGl(canvas)` with a `console.warn`
  (`:61-64`, `:67`). The WebGPU device is refused when the adapter is missing or is a fallback (software) adapter
  (`src/ui/terrain/gpu/device.ts:181-182`), and when the adapter or the device does not answer within 2.5 s
  (`rust/bridge/webGpuAdapter.ts:5`, `:21-26`, `:41-46`). **[verified]** Consequence **[inferred]**: on a busy machine the 2.5 s timeout turns
  into a silent WebGL2 session; the backend is then a matter of timing, not of configuration.
- **2D ground, V2** — `groundProducts.ts:168-189`: the V2 first creates a **WebGL2** context on its ground canvas, reads the renderer name,
  throws `WebGL2 indisponible pour la carte.` when there is none (`:182`), switches to a CPU raster when the name looks like software GL
  (`:184-188`), and only then calls `createTerrainRenderer(this.gpuCanvas, document.createElement('canvas'))` (`:189`). **[verified]**
  So in the V2, **WebGPU is gated behind a working hardware WebGL2**, and the WebGL2 context stays alive beside the WebGPU one
  (`materialContext`, `:183`).
- **2D ground, City Bench** — `citybench.ts:156-165`: `createTerrainRenderer(groundCanvas)` once at module load, with none of the V2
  guards (no software test, no CPU mode, no context-loss handling in the file). **[verified]** Two different owners of the same renderer.
- **3D, V2** — the V2 has no separate 3D renderer: its "3D" is the tilt of the live compositor's single camera
  (`src/v2/page/view3d.ts:5-8`), so it is WebGL2 only and unavailable where the compositor is refused. **[verified]**
- **3D, City Bench / Terrain Bench / urban perspective** — `Terrain3dHost` (`view3d/cityTerrain.ts:12`, `terrainbench.ts:1179`,
  `urbanPerspective.ts:88`): `host.ts:27-38` starts preparing a WebGPU device at module load; a view created before it is ready starts on WebGL2
  (`:132-150`) and is swapped for a WebGPU view when that one is settled (`:182-216`), or kept on WebGL2 after 45 s (`:59`, `:219-224`);
  after device losses it falls back to WebGL2 for the session (`:278-291`). **[verified]**
- **Override** — `?renderer=webgl|webgpu`, read once at load (`src/ui/rendererOverride.ts:9-12`), honoured by the 2D ground and by 3D.
  It does **not** cover the compositor, the vector tiles or the town renderers, which have their own switches (`?display=fallback`,
  `vectorEngine.ts`). **[verified]**
- **Prewarm** — V2 only: `client.ts:310` → `prewarmTerrainRenderer` → `prepareTerrainGpu` (`terrainRenderer.ts:72-78`) when a generation
  starts. **[verified]**

### 1.3 Where "ready" is declared

| Signal | Set where | Meaning in the code | Set by both backends? |
|---|---|---|---|
| `#viewport[data-ground-wanted]` | `citybench.ts:521` | a ground with this key was requested | n/a |
| `#viewport[data-ground-applied]` | `citybench.ts:617` | the inputs were handed to the renderer (`setLook`, `setRetainedWater`, `setView` at `:595-597`); **nothing was drawn or compiled yet** | n/a |
| `canvas[data-map-variant-ready]`, `data-map-variant` | `src/ui/terrain/gl/redraw.ts:89-90` | the look's own WebGL2 programs are linked | **WebGL2 only** (the only `dataset.` writes under `src/ui/terrain*`) |
| `variantReady()` | `terrainGpu.ts:219-233`, TerrainGl | the *live* look's pipelines exist | both, but see 4.2 |
| `data-renderer-upgrade` | `host.ts:213`, `:222` | 3D upgrade done / abandoned | 3D only |
| `data-renderer` | `v2/client.ts:246`, `:763` (`'Classic Canvas'`), `ui/terrainUrban.ts:3032`, 3D status (`view3d/terrain/status.ts`) | free text per owner | inconsistent vocabulary |
| `RenderReadiness` marks (`first-useful-frame`, `visible-complete`…) | `src/render/renderReadiness.ts:1-23` | V2 performance marks per request | V2 only |

All **[verified]**. City Bench and the benches have no signal that means "a frame of the wanted look was presented". The V2 has one
(`settled()`, section 1.5): it rests on a presented picture and on pending work, not on a GPU acknowledgement, and it is not shared with the benches.

### 1.4 Contexts (complements from the two exploration passes are in section 1.5)

| Context | 2D ground | 3D | Notes |
|---|---|---|---|
| Chrome/Edge on Windows (web) | WebGPU, Dawn D3D12 + DXC **[report, lot 6]** | WebGL2 (ANGLE D3D11, FXC) then WebGPU | both HLSL compilers can run in one session |
| Desktop app, WebView2 | same as Edge **[inferred]**; `rust/desktop-v2/src/main.rs:123-127` builds a plain window: no browser arguments, no data directory **[verified]** | compositor tilt | default profile folder keyed by the app identifier, hence persistent across versions **[inferred]**; no web code changes the renderer choice for the desktop app **[verified by grep]** |
| Headless Chrome, `--use-angle=d3d11` | WebGPU **[brief]** | as Chrome | `megapoles.mjs:33` and `run.mjs:160` use `chromium.launch` = **fresh profile each run**, no shader cache **[verified]** |
| Headless Chrome, `--use-angle=vulkan` | WebGL2 on ANGLE Vulkan (adapter request returns null) **[brief]** | WebGL2 | fast compile, white ground in City Bench (4.4) |
| Firefox on Windows | WebGPU if `navigator.gpu` answers, else WebGL2 (ANGLE D3D11, FXC) **[inferred]**; always the *light* profile (`ui/glContextRecovery.ts:110-111`) **[verified]** | compositor tilt, or a "3D unavailable" toast (`v2/page/viewLock.ts:58-60`) | see 4.6 |
| Firefox over RDP (no WebGL2, no WebGPU) | V2: machine level `minimal` (`v2/machineTier.ts:81-87`, `:136`) → the `minimal` preset on `MinimalCanvasRenderer`, pure Canvas2D (`v2/client.ts:455-474`); another style → CPU ground (`groundProducts.ts:182`, `:195-200`, `:256-320`). City Bench: ground canvas hidden + status text (`citybench.ts:161-164`) | none | **[verified]** for the code paths |
| Linux desktop (WebKitGTK) | WebGL2 only **[inferred]** | WebGL2 | no HLSL compiler in the chain |
| macOS desktop (WKWebView) | automatic rule | compositor tilt | the desktop smoke test forces `renderer=webgl` in a fresh incognito profile (`rust/desktop-v2/src/main.rs:122-125`): WebGPU display is never exercised by the release checks **[verified]** |
| Phones | automatic rule, **no handheld test before WebGPU** (`terrainRenderer.ts:56`, `terrain/gpu/device.ts:182`); level-based downgrades: DPR cap, light quality, CPU satellite ground on Adreno 619 (`v2/machineTier.ts:108-124`, `:197-200`; `groundProducts.ts:90`) **[verified]** | compositor tilt | Vulkan back end, no HLSL |

### 1.5 Complements from the exploration passes

All **[verified]** by a reading pass unless tagged.

- **Style → renderer in the V2** (`v2/client.ts`): `minimal` → `MinimalRenderer` (`:455-476`); every composition recipe → `BenchRenderer`
  (`:490-524`; recipes set `renderer: 'bench'`, `render/composition.ts:266`); the legacy "classic" path → `renderWorker` (Canvas2D on an
  OffscreenCanvas) or the main-thread Canvas renderer (`:527-566`). Presets and their layers: `render/composition.ts:28-42`, `:63-74`,
  `:120-144`; night forces the atlas look with night ambience (`:74`, `:336`); illustration is hidden (`:166`).
- **Ground mode in the V2** (`groundProducts.ts:87-92`): GPU when relief is on, the style is not illustrated and the GPU is usable; CPU
  raster for the satellite-light fast path, for a handheld Adreno 619 on satellite looks, and for illustrated looks.
- **Town in City Bench**: `CityGlCanvasLayer`, a WebGL2 canvas under a Canvas2D canvas inside a `foreignObject` of `svg#map`
  (`render/cityGlHost.ts:29-57`), switched by `?render=gpu|cpu|auto` and `localStorage magna.renderMode` (`render/renderMode.ts:18-38`).
  GL is refused for parchment, comparison, urban land use, rendered roads, painted and night (`renderMode.ts:61-67`,
  `render/cityContract.ts:42-53`): **in satellite the town is always Canvas2D**.
- **Vector engine**: default `auto`, stored in `localStorage magna-urbis-vector-engine`, no URL switch (`render/vectorEngine.ts:17`,
  `:53-58`); a context loss or raster error demotes it for the page with a `console.warn` only (`:170-177`, `:240-242`). Not used by City Bench.
- **Live compositor**: V2 only; refused without hardware WebGL2 (`render/live/compositor.ts:126-142`); the reasons for the fallback view
  are listed in `v2/display/composedView.ts:270-319`.
- **V2 ready signal**: the V2 does have a real one. `settled()` (`v2/display/readiness.ts:39-47`) waits for `pendingWork() === 0` and for the
  `visible-complete` mark, set one animation frame after a presented picture (`:26-36`), and `prepareCapture` refuses while work is pending
  (`v2/benchRenderer.ts:172-179`). `v2drive.mjs` uses it and adds a two-shot stability loop (`:121-135`). **City Bench and its scripts have
  nothing equivalent**: `run.mjs:357-358` waits for the two attributes of 1.3 and then sleeps 1 or 4 s.
- **Capture launchers**: every GPU capture script uses Playwright `chromium.launch({ channel: 'chrome', headless: true })`, i.e. the
  installed Chrome with a fresh temporary profile per run **[inferred for the profile: standard Playwright behaviour]**.
  `scripts/render_board.mjs:70-75` and `scripts/vector_gpu_parity.mjs:145-150` default to `--use-angle=vulkan` (hence WebGL2) and switch to
  `--use-angle=d3d11 --use-webgpu-adapter=d3d12` + `&renderer=webgpu` only with `--webgpu`; `scripts/webgpu_headless.mjs:8-9`, `:51-53`
  documents that `--use-angle=vulkan` gives no WebGPU adapter.
- **Backend visibility**: no page shows the active backends. They sit in hidden attributes (`dataset.terrainBackend` at `v2/client.ts:606`,
  `:673`; `dataset.renderer`), in debug globals (`__muLive`, `__muVectorEngine`) and in the "copy journal" text of Settings › Performance
  (`v2/settingsPanel.ts:347-371`, `v2/deviceJournal.ts:71-119`). There is no start-up log line.
- **3D device**: `view3d/gpu/preparation.ts:21-23` requests its adapter with no timeout and no default-adapter retry (the map has both), and
  adopts seven pipelines at two sample counts (`:44`).
- **Web build**: no supported-browser statement in `docs/WEB_PUBLICATION_FR.md`; `terrainGpu` is a separate chunk only through dynamic
  `import()` (`terrainRenderer.ts:58`, `:74`).

## 2. Why WebGPU is still there

- **What it was introduced for** — stated in the code: "On Windows, Chrome and Edge run WebGL on ANGLE/D3D11, whose HLSL compiler takes 10
  to 40 s on the natural looks; WGSL skips that step" (`src/ui/terrainRenderer.ts:2-4`), and "the full map shader took minutes and froze the
  page" (`src/ui/glVariants.ts:1-4`). FXC figures recorded in the code: Render v2 with forest 22 s for the map + 21 s for its auxiliary pass,
  "the full shader never loaded" (`src/ui/terrain/variant.ts:7-8`). **[verified]**
- **What it buys, measured** — cold satellite on ANGLE D3D11 56 s vs 1-6 s on Vulkan **[brief/report]**; WebGPU/D3D12/DXC after lot 6:
  map 11.2 s, aux 5.8 s, 3D ground 15.5 s per pipeline, isolated **[report, lot 6]**. So WebGPU is roughly 2-4x faster to compile than FXC
  on Windows and 3-10x slower than a chain without an HLSL compiler.
- **What depends on it** — nothing functional. The WGSL is generated from the WebGL2 GLSL (`terrainGpu.ts:2-4`, generators
  `scripts/wgsl_shaders.ts`, `scripts/wgsl_shaders_3d.ts`); the public surface is `Pick<TerrainGl, …>` (`terrainRenderer.ts:14-43`); every
  WebGPU class has a "continue as TerrainGl / WebGL2" exit (`terrainGpu.ts:101-117`, `host.ts:278-291`). The compositor, the vector engine,
  the town renderers and the Canvas renderers do not use it at all (1.1). **[verified]**
- **What breaks without it** — on Windows Chromium, first satellite and first 3D go back to FXC times (tens of seconds, minutes on weak
  CPUs) unless the shader is made smaller. Nowhere else does anything break **[inferred]**.
- **What it costs** **[verified unless noted]**:
  - two implementations of the 2D ground (`src/ui/terrain/gpu/*` 1 697 lines vs `src/ui/terrain/gl/*` 2 379 lines) and of the 3D view
    (`view3d/gpu/*` 1 573 lines vs `view3d/gl/*` 1 341 lines), each with its own passes, resources, captures and tiles;
  - generated sources of 3.10 MB (`src/ui/terrainWgsl.generated.ts`) and 1.08 MB (`src/ui/terrain3dWgsl.generated.ts`), shipped as lazy chunks;
  - three near-identical 1 MB WGSL modules for the map (`terrainFs` 991 507 chars, `terrainAuxTextureFs` 995 693, `auxFs` 947 519
    **[measured-static]**), all created and validated at device preparation (`device.ts:54`, `:215-218`);
  - a backend swap while the 3D view is open (`host.ts:182-216`), during which the same inputs are mirrored into two renderers
    (`MIRRORED`, `host.ts:61-85`) and, on Windows, **both** the FXC link of the WebGL2 ground and the DXC compile of the WebGPU ground run
    for the same view **[inferred from host.ts:132-150]**;
  - behaviours that differ by construction: stand-in rules, sync capture, ready attributes (1.3), holdings left out on ANGLE D3D11 because
    of a 16-texture-unit limit (`src/ui/terrain/gl/programs.ts:15-16`, `:42`).

Conclusion **[inferred]**: WebGPU is a workaround for FXC that became a second renderer. Its justification disappears the day the largest
program compiles in a few seconds on FXC.

## 3. Why compilation is still slow

### 3.1 What is compiled

2D ground, WebGPU **[verified]**:
- At device preparation (`device.ts:202-232`): 9 shader modules (`:54`), `getCompilationInfo()` awaited on each (`:215-218`), then the preview
  pipeline `map.0.0.00.none` (`:220`) and five small pipelines (`:222-230`). Nothing is returned before all of that, so **the first display of
  any look waits for the preview pipeline**.
- Per look: one pipeline per (variant, pass, blend). Variant = four override constants: mode, Render v2 number, forest, brushes
  (`variant.ts:17-26`, `device.ts:120`). Passes: `map`, plus `aux` when the look has forest or Render v2 (`variant.ts:29`), plus `map…alpha`
  when detail layers are shown (`pipelines.ts:63`, `:76`; `gpu/redraw.ts:382`). Satellite = 2 to 3 heavy pipelines.
- When: asynchronously at the first draw that asks for them (`device.ts:83`), with the last drawn variant standing in (`pipelines.ts:51-54`);
  the satellite pair at idle once the first look is drawn (`pipelines.ts:84-93`), except on a light/low-end profile (`variant.ts:71`);
  **synchronously** on capture paths (`device.ts:97-101`), see 3.3.

3D ground, WebGPU **[verified]**: one `groundFs` module of 871 602 chars **[measured-static]**; pipelines keyed by sample count
(`view3d/gpu/device.ts:71`, `:87`), so the ground is compiled **twice** (4 samples for frames at rest, 1 sample for moving frames,
`view3d/gpu/view.ts:73`, `:276-278`); on its own device.

WebGL2 **[verified]**: the same variants as `#define`/`const` specialisations of one GLSL source (`terrain/gl/programs.ts:17-19`,
`glVariants.ts:34-45`), linked in the background where `KHR_parallel_shader_compile` exists (`glVariants.ts:65`, `:79`), blocking on
`LINK_STATUS` for captures (`glVariants.ts:22-23`, `:87-88`).

### 3.2 Inlined size today (the number both HLSL compilers pay for)

Same estimator as the lot 6 report (pure-override branches folded, calls inlined); it reproduces that report's "before" figure exactly
(4 673 144 for the map on `lot6-shaders-2026-11-12/terrainWgsl.before.ts`). **[measured-static]**

| Program (variant) | before lot 6 | after lot 6 (2026-11-12) **[report]** | **today (file of 2026-11-26)** |
|---|---|---|---|
| map, Satellite (`mode 3, v2 1, forest`) | 4.67 M | 1.40 M | **2.30 M** (+64 %) |
| aux, Satellite | 1.38 M | 0.74 M | **0.99 M** (+34 %) |
| 3D ground, Satellite | 5.46 M | 1.64 M | **2.36 M** (+44 %) |
| map, preview (`0.0.00`), compiled before every first display | 353 k | 110 k | **373 k** (x3.4) |
| map, parchment with tree symbols (`0.0.01`) | — | — | 434 k |
| map, Satellite-2 with brushes | — | — | 2.25 M |

Where it sits now (map, Satellite): `land_1` → `naturalMaterial` 1.51 M, of which `applyForest` 449 k, `v2GroundEnv` 449 k,
`earthMaterial` x2 288 k, `applyGroundOccupation` 255 k; then `v2Local` 191 k, `underdarkFloor` 119 k, `underdarkRock` 76 k, `v2FreshIce` 76 k.

Regressions against lot 6 **[measured-static]**:
- `v2Pattern` is inlined **33 times** again (lot 6 had brought it from 33 to 6 call sites);
- `surfaceNoise` 63 copies (368 k of duplicated code), `forestCrownBaseColor` 19, `forestCanopy` 19, `udFbm` 26, `sstep` 474, `groundSmooth` 334;
- `underdarkFloor` + `underdarkRock` (195 k) are live in **every** 2D variant, the preview included: in 2D `uUnderdark` is a runtime uniform
  (it is a field of `TerrainParams` in `terrainFs`), while the 3D shader has it as an override (`WGSL3D_OVERRIDES`: `uUnderdark: 4`). That
  alone is half of the preview pipeline every user compiles before seeing anything.

Why it grew back **[verified by `git log` on the generated file]**: at least 25 commits touched `terrainWgsl.generated.ts` between
2026-11-19 and 2026-11-26 (river beds, ice, dry washes, estuaries, seasons, winter trees, underdark), 15 of them on 2026-11-26 alone, and
nothing in the build measures inlined size (`scripts/wgsl_shaders_check.ts` checks that the WGSL is in sync, not its size **[inferred from
its name and role in the lot 6 report]**).

### 3.3 Why "split and modularised" did not help

- The split that happened is of the TypeScript (`terrainGpu.ts` → `terrain/gpu/{device,pipelines,passes,redraw,…}.ts`) and of the variants
  (four switches as constants). The shader each variant compiles is still **one fragment entry** (`main_1`) calling one material function.
  HLSL compilers inline everything into that entry; their time follows the size of the result (lot 6 finding, confirmed by its two data
  points: 4.67 M → 28.0 s, 1.40 M → 11.2 s, i.e. about 5 s per million characters plus a fixed 4 s) **[report + inferred fit]**.
- The three map modules are the same megabyte of code with different `#define`s, so the map and its auxiliary pass each recompile the shared
  half (`v2Local` appears in both, 191 k each). **[measured-static]**
- A variant is a compile-time key, not a cache of shared work: Satellite, Satellite fast (no forest), Satellite-2 with brushes, each with
  or without the blended pipeline, are separate full compiles (`variantKey`, `variant.ts:26`; `terrainKey`, `device.ts:115-117`). **[verified]**

### 3.4 Why D3D11/D3D12 differ from Vulkan

- WebGL2 on ANGLE **D3D11**: GLSL → HLSL → **FXC**, which inlines every call and unrolls constant-bound loops (`glVariants.ts:1-4`; the
  `uLoopZero` trick at `:31-45` exists only to stop that). **[verified for the app's own account of it]**
- WebGPU on Windows: WGSL → Tint → HLSL → **DXC** → DXIL, whatever `--use-angle` says; the flag only selects ANGLE's back end for WebGL
  **[inferred; consistent with the brief's "WebGPU adapter (Dawn/D3D12)" under `--use-angle=d3d11`]**.
- WebGL2 on ANGLE **Vulkan**: GLSL → SPIR-V with no whole-program optimiser in front of the driver. That is why it is fast, and it is also
  why it is not an answer for users: Chrome, Edge and WebView2 on Windows default to ANGLE D3D11, and under `--use-angle=vulkan` headless
  Chrome gives no WebGPU adapter at all **[brief]**.
- So on Windows the choice is between two HLSL compilers. "Vulkan is fast" in the earlier reports is a statement about the capture harness,
  not about any user's browser. **[inferred]**

### 3.5 The 1307 s freeze: what the code explains, and what it does not

**Explained [verified]: why the page freezes instead of showing a stand-in.**
- Every world-space capture draws with `wait: true` (`terrain/gpu/captures.ts:61`), which makes `GpuShared.pipeline` call the synchronous
  `device.createRenderPipeline` when the pipeline does not exist yet (`device.ts:97-101`), and then copies the WebGPU canvas into a 2D canvas
  **in the same task** (`captures.ts:65`, plus `getImageData` at `:67`). The file header says it: "a pipeline still missing is created
  synchronously and the copy waits for its compilation" (`captures.ts:4-5`). The renderer main thread then sits in a GPU-process round trip
  for the whole compile: no JS runs, the renderer shows no CPU, one GPU-process thread is busy. That is exactly the observed picture.
  The same holds for `redrawForCapture` (`terrainGpu.ts:263-271`) and for WebGL2 captures (`glVariants.ts:22-23`).
- The guard meant to prevent it, `variantReady()`, waits for the pipelines of the **live** look (`terrainGpu.ts:224-226`), but captures draw
  `captureLook(look)`, which pins `displayLight: false` (`terrain/redraw.ts:120`). When the display quality is "light"
  (`variant.ts:47-53`: no forest, or mode 0), the capture needs the **full** variant, which nobody awaited and nobody prewarmed
  (`speculativePrewarmAllowed` is false in light quality, `variant.ts:71`). A caller that correctly awaits `variantReady()` still freezes.
- If the asynchronous creation of the same key is already running, the synchronous one starts a second compile of the same shader
  (`device.ts:79-101`: the entry exists without a pipeline, `wait` is true). **[verified in code; the cost is inferred]**
- City Bench starts 3D work right after the ground (`city3d.refresh()` at `citybench.ts:616`), which is where captures come from.

**The magnitude: 1307 s is not what WebGPU costs.** By the lot 6 fit, 2.30 M + 0.99 M characters are about 15 s + 9 s on DXC, twice that
if compiled twice; a minute at most with the 3D ground. Twenty minutes needs another compiler. Candidates, most probable first:

1. **The material raster, through FXC [inferred; every step of the chain is verified].**
   - City Bench calls `renderRustTerrain(…)` in every `drawBackground`, before it looks at which ground is displayed (`citybench.ts:549`),
     and passes no shared context.
   - For material looks that function calls `renderMaterialRaster` (`rust/bridge/terrainRender.ts:279`; `:151`, `:267`, `:299` for canopies).
   - `renderMaterialRaster` takes its own WebGL2 context (`rust/bridge/terrainMaterialContext.ts:14-34`) and builds **one program holding the
     whole material** (`RENDER_V2_GLSL`, `NEURAL_EARTH_MATERIAL_GLSL`, `RENDER_3D_MATERIAL_GLSL`, `FOREST_PRELUDE_GLSL`,
     `rust/bridge/terrainMaterialRaster.ts:1-5`), in which the Render v2 switch is a **runtime uniform** (`uniform int uRenderV2;`,
     `rust/bridge/terrainForest.ts:691`; `if(uRenderV2>0){…}` in the raster's `main`), with **no `specializeShader`, no `uLoopZero`, no
     parallel link** (no match in the file). It is compiled and linked **synchronously**: `COMPILE_STATUS` read at `:96-97`, `LINK_STATUS`
     at `:186-189`, then `readPixels` at `:312`.
   - That is the situation `glVariants.ts:1-4` was written to end: on ANGLE/D3D11, FXC "inlines every call and unrolls constant-bound
     loops: the full map shader took minutes and froze the page"; `variant.ts:8`: "the full shader never loaded".
   - It matches the measurements: frozen only with `--use-angle=d3d11`; about 20 s and no freeze under `--use-angle=vulkan` (no FXC);
     renderer idle because the main thread waits on a status read; one GPU-process thread at 100 %; the ground correct afterwards. It also
     matches the earlier City Bench freeze "right after the buildings/volumes step".
   - It is independent of WebGPU: `?renderer=webgl` would freeze the same way, and so would a Windows user of City Bench on first satellite.
2. **FXC links of other WebGL2 programs in the same GPU process**: a WebGL2 3D view that starts before its WebGPU device is ready
   (`host.ts:138-148`) links the 2.36 M ground through FXC, in the background where the parallel-compile extension exists, blocking for
   captures (`glVariants.ts:87-88`).
3. **A super-linear case in DXC on code added since 2026-11-19** (the lot 6 fit has only two points).
4. **FXC instead of DXC inside Dawn.** The installed Chrome ships `dxcompiler.dll` (present in its application folder), so this is unlikely;
   but the app never logs the adapter (`adapter.info` is read only for `isFallbackAdapter`, `device.ts:182`), so logs cannot exclude it.

What settles it in minutes: a CPU profile of the frozen run (candidate 1 shows as one long task under `renderRustTerrain`, inside
`getShaderParameter` or `getProgramParameter`); the per-pipeline `console.debug` timings that already exist (`device.ts:85`, `:100`) but
that the capture scripts do not record; and `lot6-shaders-2026-11-12/driver.mjs` + `harness.ts` for the isolated WebGPU cost (lot A).

## 4. Defects and incoherences

### 4.1 Ready signals that do not mean "drawn" **[verified]**
- `data-ground-applied` is written when the look has been *handed over* (`citybench.ts:595-597` then `:617`), before any pipeline exists;
  `variantReady()` is never awaited there.
- The capture scripts test `(!vp.groundWanted || vp.groundApplied === vp.groundWanted) && (!c || c.hidden || !c.dataset.mapVariantReady || …)`
  (`out/planches-styles-v7/megapoles.mjs:50`, same shape at `run.mjs:357`). `data-map-variant-ready` is only ever written by the WebGL2
  ground (`terrain/gl/redraw.ts:90`). On WebGPU the attribute is absent, `!c.dataset.mapVariantReady` is true, and **the whole second half
  of the test is skipped**: the script shoots as soon as the request was made. This is the direct cause of the blank megacity sheets.
- Neither backend signals a presented frame. WebGPU has `queue.onSubmittedWorkDone()`; it is not used on the display path.

### 4.2 `variantReady()` awaits the wrong pipelines in light quality **[verified]** — see 3.5.

### 4.3 Two owners of the 2D ground that already differ **[verified]**
- V2: `groundProducts.ts:168-200` (WebGL2 probe, software-GL test, CPU mode, context-loss recovery, error into `stats.gpuFallback`).
- City Bench: `citybench.ts:156-165` + `:558-597` (its own `TerrainLook` literal at `:565-594`: `contours: false`, no `groundCover`, no
  `treeSymbols`, `independentCanopy` from the recipe where the V2 passes `true` (`groundProducts.ts:222-253`); it never calls `setWater`,
  `setOverlay`, `setGroundRoads` or `setLandBackdrop`, which the V2 does), no loss handling, the same canvas for WebGL2 and WebGPU.
- `cityParity.test.ts` guards generation and render *choices*; nothing guards that both pages build the same `TerrainLook` or go through
  the same guards. A shared `groundHost` does not exist.
- City Bench also renders the "Rust terrain" scene on every ground change (`renderRustTerrain(… 'city-ground' …)` at `citybench.ts:549`,
  encoded into a 2048 px SVG data URL at `:554`) even when the GPU ground is the one displayed (`:555-557`). For material looks that call
  is not CPU work: it is the material raster of 4.8.

### 4.4 White satellite ground with a broken-image icon (City Bench, WebGL2 on ANGLE Vulkan) **[inferred]**
The symptom "blank canvas + broken-image icon at its top-left corner, while every `<image>` decodes" is what Chromium paints for a **canvas
whose WebGL context is lost**. The pieces that fit:
- `TerrainGl` reacts to a loss by stopping its draws and waiting for a restore, then gives up with a window event after a timeout or a
  second loss (`terrain/gl/contextLoss.ts:20-48`, `:58-60`) **[verified]**;
- City Bench has no listener for that event and no code that replaces the ground canvas (no match for `contextlost`, `isContextLost`,
  `MapContextLost`, `glContextRecovery` in `citybench.ts`) **[verified]**, whereas the V2 takes a fresh canvas (`groundProducts.ts:174-177`);
- the capture driver already documents that "a style change while tilted loses the GL context (headless Vulkan)" (`v2drive.mjs:180`) **[verified]**.
So the likely story is: linking or first drawing the satellite variant loses the context on headless ANGLE Vulkan, City Bench keeps the dead
canvas, and `data-ground-applied` still reports success. Check in one minute: `document.querySelector('canvas#gl').getContext('webgl2').isContextLost()`
in the frozen page, and the console for "Map WebGL context lost". If it is false, the next suspect is a failed variant
(`glVariants.ts:89-92` logs once and the stand-in stays).

### 4.5 Silent fallbacks **[verified]**
- WebGPU → WebGL2 on any exception: one `console.warn` (`terrainRenderer.ts:61-64`); on the 2.5 s adapter/device timeouts: nothing at all
  (`webGpuAdapter.ts:21-26`, `:41-46` return `null`).
- 3D upgrade abandoned after 45 s: a `console.warn` and a data attribute (`host.ts:219-224`); the user keeps a WebGL2 view whose ground may
  still be linking through FXC.
- A failed look pipeline: the stand-in (another look) stays on screen with a console line (`terrainGpu.ts:229`; `glVariants.ts:89-92`).
- GPU → CPU ground in the V2: `stats.gpuFallback` string (`groundProducts.ts:186`, `:199`).
- `terrainRendererBackend()` exists "for status lines" (`terrainRenderer.ts:85-89`) but no page shows a single, complete "what draws what"
  line; `data-renderer` carries three unrelated vocabularies (1.3).

### 4.6 Firefox **[inferred, to confirm in lot A]**
- On Windows, Firefox's WebGL2 is ANGLE D3D11 + FXC: the path the app left on Chromium because it "took minutes and froze the page".
- Where Firefox exposes `navigator.gpu`, the automatic rule sends it to WebGPU with machine-translated WGSL of 1 MB per module; its shader
  translator and HLSL compiler are not Chromium's, and none of the lot 6 tuning (which targeted DXC inlining) was measured there.
- Over RDP there is no hardware WebGL2: the V2 goes to its CPU ground, City Bench hides the ground. That is the only context in which the
  app is, in effect, a Canvas application; it is not named, tested or budgeted as such.
"Firefox can barely run Magna Urbis" is therefore expected from the code: it gets either the worst compiler or an untested translation.
The code already concedes it **[verified]**: Firefox on Windows is pinned to the light profile (`ui/glContextRecovery.ts:110-111`), which
removes the forest pass and the Render v2 material from every variant (`ui/terrain/variant.ts:34`) and caps textures at 2048; every
non-Chromium browser gets a "use Chrome or Edge" banner (`ui/browserAdvice.ts:28-32`); and nothing excludes Firefox from the WebGPU rule
(`terrainRenderer.ts:56` only tests `navigator.gpu`).

### 4.7 Duplicated paths that can drift
- WGSL vs GLSL ground: same source, but different passes/targets code (`terrain/gpu/passes.ts` vs `terrain/gl/passes.ts`), different stand-in
  rules, different capture mechanics, holdings dropped on ANGLE D3D11 only (`terrain/gl/programs.ts:15-16`). **[verified]**
- 2D quality policy lives in three places: `displayQuality.ts`, `glContextRecovery.ts` (`mapGpuLight`, `mapGpuLowEnd`), `variant.ts`. **[verified]**
- Two GPU devices mean two caches, two loss handlers (`terrain/gpu/recovery.ts`, `host.ts:238-291`) and two prewarm policies. **[verified]**

### 4.8 A third GPU implementation of the ground, outside every policy **[verified]**
`rust/bridge/terrainMaterialRaster.ts` (368 lines) evaluates the same material as the live ground in its own WebGL2 program and context,
"for worker SVG rasters and exports" (`:74-76`). It ignores `?renderer=`, the variants, the light profile, the software-GL test and the
context-loss policy, and it compiles synchronously (3.5). Its callers through `renderRustTerrain`: City Bench on every ground change
(`citybench.ts:549`), Terrain Bench (`terrainbench.ts:130`), the terrain worker (`ui/terrainWorker.ts:66`) and the V2's non-GPU ground
(`groundProducts.ts:320`). The page that is meant to mirror the V2 thus compiles one more copy of the heaviest shader than the V2 does, on
the main thread, even when the GPU ground is the one displayed.

### 4.9 The review tools do not run the users' backend **[verified]**
`scripts/render_board.mjs` and `scripts/vector_gpu_parity.mjs` default to ANGLE Vulkan, hence WebGL2; the v7 runners take `ANGLE` from the
environment (`run.mjs:160`); `megapoles.mjs:33` defaults to Vulkan; the macOS desktop smoke test forces `renderer=webgl`. Windows users of
Chrome, Edge and the desktop app get WebGPU on D3D12. Parity "checked on the board" is the parity of another renderer.

## 5. Target design

### 5.1 One rule, written once

A single module (say `src/render/displayBackend.ts`) resolves **once per page**, before any context is created, a plain record and
publishes it (`window.__muDisplay.backends`, one `console.info` line, a row in the developer panel, `data-display-*` on `<html>`):

```
ground2d:   'webgl2' | 'webgpu' | 'cpu'      + reason + adapter/renderer string
view3d:     'webgl2' | 'webgpu' | 'none'     + reason
vector:     'canvas' | 'webgl2'
moving2d:   'compositor' | 'fallback'
```

Every renderer takes its backend from that record; none probes on its own. `?renderer=` becomes `?display=ground:webgl2,3d:webgl2,…` (or
keeps its name) and covers all four lines. A fallback at run time (device lost, context lost) updates the record and logs the old value,
the new one and the reason. No timeout may change a backend silently: a 2.5 s adapter timeout is a logged decision.

### 5.2 Reference and accelerators, per context

| Context | Reference (must always work, is what parity is judged on) | Optional accelerator | Condition to enable the accelerator |
|---|---|---|---|
| All | Canvas2D exact renderers for vector layers at rest, captures, exports | WebGL2 compositor / vector tiles for the moving view | `scripts/vector_gpu_parity.mjs` green; already the case |
| All | **WebGL2 ground and 3D** (GLSL is the source of truth already) | — | — |
| Windows + Chromium (Chrome, Edge, WebView2 desktop app) | WebGL2 | **WebGPU for ground and 3D**, as long as FXC is slower than a stated budget | pixel parity on the render board per style + cold-compile numbers from the harness; chosen at page load, never swapped under an open view |
| Firefox, Safari/WKWebView, WebKitGTK, phones | WebGL2 | none | WebGPU stays off until someone measures it there |
| No hardware WebGL2 (Firefox over RDP, blocklisted GPUs) | CPU ground + Canvas (the V2's existing CPU mode), offered by both pages | none | 3D disabled with a message, not a blank canvas |
| Headless captures and the render board | **the same backend as the context being illustrated** (Windows Chromium: ANGLE D3D11 + the Windows accelerator), forced explicitly in the URL, with a persistent profile; ANGLE Vulkan only as a named, secondary run | — | scripts abort when `__muDisplay.backends` differs from what they asked for |

Two consequences: the automatic rule becomes "WebGPU only where it is proven to help" instead of "WebGPU wherever it exists", and the 3D
view no longer starts on WebGL2 to be swapped later: it waits for the decision (`terrain3dBackendReady()` already exists, `host.ts:41-43`)
or opens with the ground stand-in.

### 5.3 A real "frame drawn" signal

One promise and one attribute, owned by the display layer, identical on every backend and every page (the V2's `settled()` in
`v2/display/readiness.ts:39-47` is the model to generalise; City Bench gets the same one instead of its two attributes):
- each ground/3D renderer exposes `settled(): Promise<{ look, frame, standIn: false }>`: resolved after a frame was drawn **with the wanted
  look's own programs** and the GPU acknowledged it (WebGPU: `queue.onSubmittedWorkDone()` after that frame; WebGL2: a `fenceSync` on that
  frame, or the frame after a successful link);
- the page aggregates them with the Canvas/compositor state into `window.__muDisplay.settled(requestId)` and mirrors it as
  `data-display-settled="<requestId>"`; a failure (failed pipeline, lost context, stand-in kept) **rejects** with the reason;
- capture scripts wait for that and nothing else; a timeout writes the `__muDisplay` state into the shot's log instead of saving a blank PNG.
`data-ground-applied`, `data-map-variant-ready` and the scripts' compound conditions go away.

### 5.4 Never block the page on a compile

- Captures never create a pipeline synchronously. `capture*` become async (most callers already are: 3D tiles, illustration, exports) and
  await the pipelines of **the look they will draw** (`captureLook`), not of the live look. The synchronous variant is kept only for the
  export code that truly cannot await, and it throws when the pipeline is missing rather than freezing.
- No GPU program outside the ground host: the material raster (4.8) goes through the same variants, the same backend record and the same
  asynchronous link as the ground, or disappears in favour of captures of the ground renderer.
- One creation per key: when an asynchronous creation is in flight, a waiter awaits it; it does not start a second compile.
- The 3D ground compiles the sample count it will show first, and the other only when the first is on screen (partly done in lot 1 of
  2026-11-12; the key still doubles the work).

### 5.5 Making first display and style switches much faster

In order of value per effort:
1. **A size budget that fails the build** (`scripts/wgsl_shaders_check.ts` + the lot 6 estimator): per variant, e.g. preview ≤ 120 k,
   Satellite map ≤ 1.5 M today and lower after each structural step. It prints the inlining tree, so the commit that adds 200 k sees it.
   Without it, lot 6 was undone in two weeks.
2. **Recover the regressions** (same arithmetic, no visual change): `v2Pattern` back to loops; `uUnderdark` as an override in 2D as in 3D
   (preview 373 k → about 180 k, every other variant −195 k); `surfaceNoise`/`sstep`/`groundSmooth` copies. Expected: Satellite map
   2.30 M → about 1.5 M, i.e. the lot 6 level.
3. **Cut the material into programs** instead of one entry: the ground is already drawn through passes and, in the moving view, through
   576 px tiles (`render/live/policy.ts:20-25`). Evaluate `v2GroundEnv`, the forest, the occupation and the water as **separate small passes
   into intermediate targets** (the aux pass already does this for crowns and water), composed by a small final program. Each program then
   compiles in parallel, is cached independently, and a look change recompiles only what it changes. Target: no program above 400 k inlined,
   which by the lot 6 fit is about 6 s on DXC cold and is the size at which FXC stops being pathological (`variant.ts:33`: the light variant
   "links in about 5 s" on FXC).
4. **Replace repeated procedural noise by sampled noise textures** where the look allows (63 `surfaceNoise` sites): the ground is baked
   into tiles, so run-time cost is not the constraint, compile size is.
5. **Share one GPUDevice** between the map and the 3D view: one module set, one cache, one loss handler.

When step 3 is done and measured on FXC, decide WebGPU's fate with numbers: if the largest GLSL program links in a few seconds on ANGLE
D3D11, delete the WebGPU renderers and the generators; if not, keep WebGPU as the named Windows accelerator of 5.2.

### 5.6 Desktop app: the optimisation that really exists

- **Persistent compiled-shader cache.** Chromium stores Dawn's compiled pipelines and ANGLE's program binaries on disk per profile. With a
  persistent WebView2 user-data folder, a pipeline is compiled once per (app shader version, driver, WebView2 version) **[inferred]**. The
  desktop app should (a) make sure its WebView2 profile folder is stable across app versions and not cleared, (b) run a **first-run
  "preparing graphics" step** that creates every pipeline of the default styles behind a progress bar instead of at the first style switch,
  (c) re-run it when the shader version, the GPU driver or the WebView2 version changes. This is the only desktop-only gain I can defend:
  it turns a per-session cost into a per-install cost.
- **Not recommended:** `--use-angle=vulkan` for WebView2. It removes FXC, but it is the configuration that loses contexts and shows the white
  ground in today's captures, it disables the WebGPU adapter in headless Chrome, and it is not what Chromium ships on Windows. A flag that
  makes the desktop app render differently from the web reference is the opposite of an explicit path.
- **Not recommended:** a native (Rust/wgpu) ground renderer for the desktop app. It would allow offline-compiled shaders, and it would be a
  fourth implementation of the ground.
- Linux (WebKitGTK) and macOS (WKWebView) have no HLSL compiler in the chain; they need the reference WebGL2 path to be solid, nothing more.
- The same persistent-profile idea applies to the capture scripts today: `megapoles.mjs:33` and `run.mjs:160` launch a fresh profile, so
  every run recompiles everything; a fixed `userDataDir` (Playwright `launchPersistentContext`) makes every run after the first one warm.

### 5.7 Debugging

- `?debug=display` overlay: the 5.1 record, adapter/renderer strings, each program/pipeline with its state (compiling since n s, ready in
  n ms, failed), stand-in active or not, context/device losses, last settled request.
- The same data as `window.__muDisplay.report()` so that capture scripts attach it to every sheet.
- The existing `console.debug` pipeline timings (`device.ts:85`, `:100`) promoted to that record.

## 6. Ordered plan

| Lot | Content | Expected gain | Risk | How to measure |
|---|---|---|---|---|
| **A. Know what ran** (½ day) | Profile one frozen City Bench switch under `--use-angle=d3d11` (is the long task inside `renderMaterialRaster`?); log `adapter.info` and the GL renderer string once; keep pipeline/program timings in `__muDisplay`; capture scripts save the console; run `lot6-shaders-2026-11-12/driver.mjs` on today's WGSL (map, aux, 3D ground; DXC) and the same variants through `?renderer=webgl` on ANGLE D3D11 | Explains or refutes the 1307 s; gives the FXC vs DXC table that decides lot G | none (instrumentation) | harness table; one City Bench megacity run with the console saved |
| **B. Honest ready signal** (½-1 day) | `settled()` per renderer + `__muDisplay.settled`; City Bench and V2 set it; scripts wait for it and fail loudly; drop `data-ground-applied` / `data-map-variant-ready` | No more blank or stand-in shots; sheets stop needing manual reshoots | low; scripts get slower exactly where they were wrong | megacity sheet rerun: zero blank frames; timeouts carry a state dump |
| **C. No blocking compile** (1 day) | City Bench stops calling `renderRustTerrain` when the GPU ground is displayed (its 3D snapshot comes from a capture of the ground renderer); the material raster reuses the specialised variants and links in the background, or gives way to captures of the ground renderer; captures await the pipelines of `captureLook`; no second compile of an in-flight key; `variantReady(look)` takes the look to draw; 3D compiles one sample count first | Removes the 20-minute class of freeze on Windows (if lot A confirms candidate 1) and the shorter capture freezes; the page shows a stand-in instead | medium: capture callers become async | `scripts/nav_fps_probe.mjs` during a style switch: no frame gap above 1 s; long-task trace |
| **D. Persistent caches** (½ day) | Fixed `userDataDir` for capture scripts; desktop: stable WebView2 profile + first-run warm-up step | Second and later runs: compile near zero; desktop pays once per install | low; cache invalidation on driver/runtime update must re-warm | `renderer-load-*/switch_profile.mjs` cold vs warm profile |
| **E. Size budget + regressions** (1 day) | Budget test in `wgsl_shaders_check.ts`; `v2Pattern` loops, `uUnderdark` override in 2D, noise call sites | Satellite map 2.30 M → ~1.5 M, preview 373 k → ~180 k: about −35 % cold compile on every backend, and it stays there | low: same arithmetic; pixel parity required | estimator numbers in CI; `renderer-load-final` `parity.mjs`; harness timings |
| **F. One backend record, one ground host** (1-2 days) | `displayBackend.ts`; City Bench uses the V2's ground host (guards, loss recovery, CPU mode); no WebGL2→WebGPU swap under an open 3D view; one GPUDevice; overlay | Coherence and debuggability; fixes the white-ground class of bugs; removes the double FXC+DXC compile of 3D | medium: touches both pages | `cityParity.test.ts` extended to the `TerrainLook`; render board per backend |
| **G. Cut the material into programs** (3-5 days) | Separate passes for ground environment, forest, occupation, water; small composing program; noise textures | Largest program ≤ 400 k: a few seconds cold on DXC **and** on FXC; a look change recompiles one pass | high: the biggest change; needs before/after sheets | harness per program on DXC and FXC; render board parity; `nav_fps_probe.mjs` |
| **H. Decide WebGPU** (½ day + deletion) | With G's FXC numbers: delete the WebGPU renderers and generators, or keep them as the Windows accelerator of 5.2 | Up to −3 300 lines and −4.2 MB of generated source, one renderer to maintain | low if the numbers are there | FXC cold satellite and 3D under the agreed budget |
| **I. Named tiers for the weak contexts** (1 day) | Firefox: WebGL2 only until measured; no hardware GL: CPU ground in both pages, 3D off with a message; phones: reference path with the light variant | Firefox and RDP stop being accidents | low | manual run per context with the overlay screenshot |

Order: A, B and C first (they stop the lost capture passes and the freezes, about two days); D and E next (cheap, large, permanent);
F before G so that the structural work is measured through one path; H only on numbers.

## Limits of this audit

- Nothing was executed on a GPU: every timing is from earlier reports or from the size fit; the 1307 s figure is not reproduced, and its
  attribution to the material raster (3.5, candidate 1) is a reading of the code, strong but unconfirmed.
- The white ground diagnosis (4.4) and the Firefox analysis (4.6) are inferences from code and platform behaviour.
- Sections 1.4 and 1.5 rely partly on two parallel read-only exploration passes (desktop packaging, phones, Firefox handling, launchers,
  vector layers); I did not re-read every line reference they returned. The WebView2 profile location and Playwright's fresh profile are
  platform behaviour, not code in this repository.
- `web/out/display-audit-1128/astra.md` was deliberately not read, to keep this audit independent.
