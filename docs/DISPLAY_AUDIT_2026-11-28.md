# Display audit, 2026-11-28 — synthesis and decisions

Two independent read-only audits of 2D/3D display management (all styles, all contexts), written without reading each other:
- [Fable report](display-audit-2026-11-28/fable.md)
- [Astra (Codex gpt-6.2-astra) report](display-audit-2026-11-28/astra.md)
- [Shared brief](display-audit-2026-11-28/BRIEF.md) (owner question and facts measured that day)

## Trigger
v7 regeneration of 2026-11-28: megacity shots blank or frozen. Measured on the RTX 4090, headless Chrome:
- ANGLE D3D11 (WebGPU adapter present): switching City Bench to the satellite preset froze the page **1307 s**, then drew a correct ground.
- ANGLE Vulkan (no WebGPU adapter): no freeze, but a white satellite ground with a broken-image icon.
- Capture scripts trusted `data-ground-applied`, which is set when the ground is requested, not drawn.

## Points both audits agree on
1. **WebGPU exists only to dodge FXC** (the HLSL compiler behind WebGL2 on ANGLE D3D11, i.e. Chrome/Edge/WebView2 on Windows). It draws nothing
   WebGL2 cannot; its WGSL is machine-translated from the GLSL. Cost: a second 2D ground renderer, a second 3D renderer, 4.2 MB of generated source.
   Exception (Astra): browser neural generation needs WebGPU compute; that is independent of display.
2. **The shader split was of the TypeScript, not of the shader.** The satellite map fragment inlines to **2.30 M characters** (both audits measured
   the same figure; 1.40 M right after the 2026-11-12 lot 6, +64 % in 16 days, no size gate). The 3D ground: 1.64 M -> 2.36 M.
3. **The 1307 s freeze is most probably not WebGPU**: on each ground change City Bench runs a hidden third GPU copy of the material
   (`rust/bridge/terrainMaterialRaster.ts` via `renderRustTerrain`, `web/src/ui/citybench.ts:547`), one unspecialised WebGL2 program compiled and
   linked synchronously on the main thread, hence through FXC on D3D11. Inferred from code; confirm with timestamps around that call.
4. **Ready signals lie** (ground "applied" = requested); captures accept timeouts. V2 has a real readiness module, City Bench does not.
5. **V2 and City Bench diverge**: different ground owners and looks, City Bench 3D is a separate renderer (`ui/view3d/*`) whereas V2 tilts its compositor;
   parity tests stop before pixels.
6. **Silent fallbacks**, no page shows the effective backend. Firefox on Windows gets FXC or an untested WebGPU translation.
7. Capture scripts launch a fresh Chrome profile each run (everything recompiles); several probes hard-code the RTX 5090.
8. Not recommended for the desktop app: forcing `--use-angle=vulkan` in WebView2, or a native renderer.
   Desktop-only gain: Fable — persistent WebView2 shader cache + first-run warm-up; Astra — persistent cache of derived ground tiles.

## Decisions (owner, 2026-11-28)
- **V2 is the only page.** Benches are removed (City Bench, terrain/urban/rust/test benches, house bench) once V2 is instrumentable for tests
  (generation steps and timings, city probe, Rust replay capture, display report, a real "frame drawn" signal).
- The four City Bench-only options are ported to V2: readable gardens, visible paddocks, concrete field boundaries, RPG pins.
- The house bench is replaced by a V2 building window (generate or inspect one building: culture, name...; rotating 3D view; 2D footprint minimap),
  opened from an "editor" icon.
- Then the 2D/3D display chain is reworked on V2 alone, following the merged plan below.

## Merged plan (display chain, after the bench removal)
| Lot | Content |
|---|---|
| A | Instrument: timestamps around hidden work, effective backend record, FXC vs DXC table on today's shaders; remove the 5090 from probes |
| B | Honest "frame drawn" signal; captures fail closed |
| C | No blocking compile anywhere (no hidden material raster on a style switch, no synchronous pipeline in captures) |
| D | Persistent Chrome profile for capture scripts; desktop first-run graphics preparation |
| E | Shader size budget enforced in `wgsl_shaders_check.ts`; undo the lot 6 regressions (about -35 % cold compile) |
| F | One backend decision module, shown in a `?debug=display` overlay and in every capture |
| G | Cut the ground material into small programs / bake land into tiles shared by 2D and tilt |
| H | Keep or delete WebGPU display, on G's numbers |
| I | Named tiers for Firefox, Remote Desktop and phones |
