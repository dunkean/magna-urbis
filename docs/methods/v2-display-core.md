# V2 Display Core

The optimisation concerns presentation and scheduling. The generators, geometry, shaders and layer drawing rules remain the same.

## Presentation Paths

The composite path uses `Viewer.setDirectSource`. The WebGPU or WebGL terrain stays in its visible canvas, beneath the CPU overlays. The browser composites these surfaces. The CPU composite path presents its 2D surface directly. Both paths avoid `createImageBitmap`, the transfer to another presentation canvas and, for the GPU, the copy of the terrain to the 2D canvas.

The input canvas keeps mouse, touch and keyboard events. The visible layers are its neighbours in the same viewport. It is therefore necessary to capture the complete viewport, rather than reading only the input canvas. The illustration explicitly prepares the GPU canvas before freezing the layers. Exports keep an explicit raster composition.

The classic path keeps its worker and the bitmap transfer from an `OffscreenCanvas`. It keeps a single request in flight and immediately follows the camera through a CSS transform. A response from a previous source is closed without replacing the image or releasing the request for the new source.

## Avoided Work

- One presentation per dirty frame; the GPU engine draws within that frame without adding a second `requestAnimationFrame`.
- Pipelines are prepared asynchronously when the rendering changes; navigation no longer uses the synchronous capture mode.
- The thumbnail has its own surface and is recomputed only when the content, appearance or size changes.
- 2D surfaces are resized only if their size changes.
- Changes to the composite no longer rebuild the hidden scene of the classic worker. This scene is released when leaving the classic path; the worker and its decoded assets remain available.
- The world/appearance pair is sent atomically to the worker when switching projects. Identical display changes are ignored.
- Appearance resolutions of previous worlds are released when the world changes and when the project is closed.

## Checks

`web/scripts/v2_display_core_check.mjs` uses a saved project containing a town and native houses, without running any generator. It checks movements and zooms, parity with a composed capture, classic/composite transitions and resizing. Options: `--backend=webgl`, `--backend=webgpu`, `--backend=cpu`, `--dpr=2`, `--exports`.

On the validation machine, each series of 90 movements produced 90 composite renders and **zero** calls to `createImageBitmap`, compared with 90 before the change. CPU, WebGL and WebGPU passed the check. The CPU output is pixel-for-pixel identical to the reference capture; GPU differences remain less than or equal to two levels per channel. The median frame intervals are close to 16.7 ms on this project. These measurements describe this local case and do not measure the intrinsic cost of each layer or of much larger maps.

The validation reports and captures are in `web/out/v2-display-core/`. The unit tests cover in particular the batching of requests, stale responses, the release of scenes and the preparation of captures.
