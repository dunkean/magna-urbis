# Original drawing and terrain modifications

Heightmap contains **Draw relief**. This opens an independent coarse drawing (`terrain.drawing`, at most 128², metres). Its broad shape goes through the procedural sketch refinement and erosion path. It is never stored as an exact replacement surface. File import keeps its existing heightmap resolution and surface semantics.

**Modify relief**, below Advanced, opens the same canvas on the generated physical terrain. It writes only metre offsets in `terrain.modification`. The bridge applies these offsets once, after generation and coastline preparation and before hydrology. The unmodified source is retained alongside the result so reopening, resetting and repeated generation cannot bake edits into the source. Saved decor terrain uses the same independent offset semantics.

Raise/lower add smooth displacements. Level/smooth operate on the broad shape while preserving a fixed fine-scale residual from the unmodified terrain. Restore returns affected cells to that terrain.

Reset in Draw clears the drawing canvas. Saving/generating then deletes the drawing, its dependent modifications and legacy replacement snapshots. Reset in Modify zeros the deformation layer and shows the generated terrain underneath; saving/generating deletes the stored offsets. Reset also removes replacement snapshots left by the earlier editor when no independent drawing exists. Cancel discards the popup draft; undo/redo remains available before saving.

The sidebar footer contains **Create relief** and **Full generation** (relief → settlements → cities). Main seed, size and definition controls remain above the source tabs. The canvas is an 8-bit grayscale view; stored heights and offsets retain metre precision.

Run `node scripts/v2_relief_paint_check.mjs` from `web/` for the real browser/engine flow: drawing refinement, coastline cache, independent modifiers, repeated regeneration, both resets and legacy cleanup. Captures and the report go to ignored `web/out/relief-paint/`. Scalar brush and offset integrity tests are in `web/tests/v2ReliefPaint.test.ts`.
