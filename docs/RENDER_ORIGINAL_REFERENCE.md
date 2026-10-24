# Original Render 2D reference

This isolated worktree starts from primary commit
`f2298841d9fe09729df02f8ecc92e7ffbefa6505`. It exports the original
`style=render` program, including its existing multi-scale material functions.
It adds no SurfaceWorld, GR, PBR assets, inferred geology or 3D vegetation.
The six literal shader bodies are compared with that commit in a CPU test.
The composed source export is `renderOriginalShaderSources()` in
`web/src/ui/terrainGl.ts`; the existing Neural Earth GPL notice is retained.

## Actual source, not a regenerated fixture

`web/scripts/prepare_render_original_source.ts` reads the recorded V15 Python
response `fresh-neural-heightfield.f32`: 1024² FP32 controls on 40 km,
SHA256 `3c7c2f32e37844842f058208e21522543bcec69125348e115390f83d5b814159`.
It checks the archived response metadata and writes those exact bytes plus all
11 mips produced by the original `heightPyramid()` (5,592,404 bytes in total).
It does not resample, generate or condition the controls.

This is a retained raw neural source, before Magna reconstruction/hydrology.
It is not a new live generation, a reconstruction of the former displayed
512² overview, or a claim that the original hydrology matches this raw bed.
The original retained water SVG and lake field are extracted separately from
the strict source archive by the one-time CPU preparation script. They are
available for the next water-composition stage; the current reference images
explicitly use `layers.water=false`.

## Tool and capture

Run an isolated Vite server on port 5203 from `web/` without restarting the
other benches. Open `/render-original-reference.html`. Loading this page only
fetches CPU inputs; the explicit Initialize button creates WebGL. The helper
`window.renderOriginalReference.exportFixture(widthM,x,z)` exposes a fixture
for the serial capture driver.

```powershell
node scripts/capture_render_original.mjs --angle vulkan --widths 40000 --out out/render-original-reference/captures-vulkan-r6
node scripts/capture_render_original.mjs --angle vulkan --widths 40,10 --out out/render-original-reference/captures-vulkan-near-r7
```

The driver uses the installed Edge channel with a fresh temporary profile,
checks for the user demo before launch and watches it asynchronously. It
closes only its own browser if the demo opens. Each stage is bounded at 30 s;
binary transfers use 32 KiB chunks. Earlier unbounded/default-ANGLE and
unsupported OpenGL attempts remain separate failed diagnostics.

`captureExact2D()` keeps the exact TerrainLook object and does not force
`mesh3d=true`, unlike the existing perspective-oriented `captureRegion()`.
It records the effective uniforms, sampler state, targets and blending at
each actual draw. Array uniform names are normalized from `name[0]` to `name`.
The capture FBO is named `screen`, and its reference RGBA is flipped to
top-first rows. Source texture bytes and mips are not flipped or regenerated.

## Export contract

Each directory contains `fixture.json`, shader sources, relative binary files,
`reference.png` and `reference.rgba`. The manifest format is
`magna-render-original-fixture`, version 1:

- `inputs`: original look/view, origin, metres-per-pixel and fixed-DPR canvas.
- `data`: relative file, width/height, RF/RGF/RGBA8/R8 format, original GL format,
  exact mip byte offsets/lengths and sampler metadata.
- `draws`: program, effective uniform dictionary, source texture bindings,
  per-draw sampler state, target, clear, blend, primitive and instance count.
- `buffers.rivers`: original float9 records, even when empty in this stage.
- `targets` and `outputTarget`: replay framebuffers; output is `screen`.
- `fileSha256`, `shaderSources` and `reference`: integrity and output layout.
- `retainedWater`: unchanged world paths, explicitly not rendered yet.

Static source bytes are copied at upload time. Thus a later mutation of a
caller-owned array cannot silently change an exported already-uploaded grid.
Per-draw sampler state is authoritative if a later water pass changes filters.
RF/RGF input files are linear numeric data, not sRGB images.

## Captured evidence and limits

The actual successful renderer was ANGLE Vulkan 1.4.325 on RTX 4090.
The three fixtures had one terrain draw, `uEnhanced3d=0`, no unknown sampler
bindings and no browser/shader errors. The 40 km reference PNG SHA256 is
`f02f88bb3db34f2812f8887c30d587878524118055068be126cf21bb9251ee0c`;
40 m is `ae4e492ff628cadbda73e76d1126a8e302ef8682e782c719d6ef6e54f83d641d`;
10 m is `5da87b7fea4646f93e10c201ad68f41e15684cc41038a18f9eb6abb222374f95`.

These are original WebGL reference outputs, not a Godot parity verdict,
performance/FPS qualification, complete lake/river composition, or a new
physical source. The default ANGLE attempt stalled during initialization;
ANGLE OpenGL could not create a WebGL2 context. Vulkan succeeded without
pruning or changing material functions. CPU tests cover literal source
identity, binary mip layout/copying, fixed-DPR capture state and row order.
The full baseline typecheck still depends on the snapshot's WASM declarations;
those unrelated generated interfaces are not repaired by this tool.
