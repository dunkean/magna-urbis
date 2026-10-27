# Composing a final map over a SurfaceWorld capture

The `web/src/surface/mapComposition.ts` bridge composes a standalone SVG over a georeferenced PNG without generating or changing the world. It reuses the web renderer's palettes, font stacks, name placement engine, label serializer, panel primitives and frames. The CLI produces SVG, PNG via resvg and JSON evidence. It does not replace the web styles or existing SVG pipeline.

## Inputs and API

`composeSurfaceMap(capture, pngBytes, content, { style?, gridMeters? })` returns `{ svg, evidence }`. The `SurfaceMapCapture` binding links SHA256 hashes of the source packet, metrics and PNG to the world and canonical-context IDs. The PNG is verified and embedded in the SVG with its original bytes. The CLI also verifies the packet and metrics bytes; external raster URLs are not accepted.

TOP is an exact metric rectangle in the packet coordinate system, never the local rendering origin. Its aspect ratio must match the PNG. Scale is in metres or kilometres; an optional RPG grid is anchored to source metric coordinates, with a budget of 2,048 lines. North is explicitly local grid north, `-Z`, without a geodetic claim.

`surfaceMapContent(packet, capture)` extracts recipes actually present in canonical nodes near the frame, tree/canopy potentials and native/source road records. Counts are neither areas nor GPU visibility. The legend distinguishes those semantics from appearance; ground recipes are not assigned fictitious raster colours. Names are read only from `source.meta.names.entries`. A producer with an actual `World` may call `sourceMapLabels(world.names.entries, 'world.names', translation)`; the bridge does not invoke a name grammar. IDs, texts and paths are retained, with explicit coordinate translation and no mutation.

## Native projection and 3D views

`nativeSurfaceMapCapture(identity, projection)` attaches the following native sidecar:

```ts
{
  format: 'surface-map-projection', version: 1, worldId,
  projectionMode: 'orthographic-top' | 'perspective',
  viewportPixels: { width, height },
  worldToClip: [/* 16 numbers, column-major */],
  renderOrigin: { x, y, z }, // float64, subtracted BEFORE the matrix
  clipRange: [-1, 1], focus: { x, z },
  uniformMetricScale: null // perspective
  // TOP: { metresPerPixel, bounds:{minX,minZ,maxX,maxZ}, north:'local-negative-z' }
}
```

The matrix must actually be exported by the native camera and be invertible. A test at coordinates ±1e9 checks origin subtraction before multiplication. Perspective receives no uniform metric scale, automatic north or RPG grid. Point annotations require a source elevation; otherwise they are omitted and diagnosed. Draping linear labels and occlusion by volumes are not reconstructed. Auto-binding rejects older oblique captures without a matrix; no approximate camera calculation replaces them.

The CLI uses `metrics.mapProjection` when present, with identity checks. Otherwise, `--capture-proof` permits only TOP explicitly requested in the native command, with PNG and metrics hashes. An explicit `--binding file.json` can supply an engine-neutral binding; if the metrics contain a native projection, both must agree.

## Reproducible CITY419 example

From `web/`, inputs remain in ignored outputs of the ROOT worktree:

```powershell
node --import tsx scripts/compose_surface_map.ts `
  --source <ROOT>/web/out/surface/native-current-419-v12-final/source.surfacebin `
  --capture <ROOT>/web/out/surface/native-current-419-v13-final/blueprint-native-close-top.png `
  --metrics <ROOT>/web/out/surface/native-current-419-v13-final/blueprint-native-close-top.json `
  --capture-proof <ROOT>/web/out/surface/native-current-419-v13-final/capture-run.json `
  --view blueprint-native-close-top --grid-m 5 `
  --out out/surface/map-composition/city419-blueprint
```

The [CITY evidence](evidence/map-composition-city419.json) retains the packet of 419 native realizations and 81 rejections, the retained 15.625 m parent and legacy 1.5.3 ground. It produces a 400 m plan with a blueprint frame, grid north, 25 m scale bar, 5 m grid and five legend entries. The packet archives no names in the expected location: zero place names and zero POIs are added. The embedded raster SHA is exactly `c69ecb23fc11944e7553908834b1fa934634869b9ef121ce8068e909fb0d2452`. The composed PNG SHA is `75621009d8f089f98e7949f152ea2af9cff72b00dfbf4d0a6c32263aa98fbb26`.

Nine map palettes are shared (`styles.ts`), distinct from the fifteen terrain styles. Tests exercise all nine overlays; they do not qualify fifteen final native realizations. Changing the frame palette does not repaint the raster. Missing SVG brushes, relief hatching and names are not invented. Fonts use existing system stacks and are not embedded, so identical PNGs across machines are not promised. This evidence is a CPU composition over a retained capture, without new GPU rendering, neural generation, overall artistic acceptance or an FPS claim.

[Original French version](MAP_COMPOSITION_FR.md).
