# Rust workshop workflow

[French original](RUST_BENCH_PIPELINE_FR.md). This document records the workflow as described in that source; workshop routes and labels may evolve.

The `/rustbench.html` container offers separate, successive sessions. Direct HTTP addresses for the workshops (`/terrainbench.html`, `/urbanbench.html`, `/housebench.html`) enter this container while retaining their parameters, including the 3D camera and drawn zones. The tab bar is available in both 2D and 3D. “Open ↗” uses `standalone=1` to deliberately open a workshop on its own. HTML files opened without a server remain self-contained.

1. **Terrain** (`#terrain`, `/terrainbench.html`): relief, coasts and water, stages 1–3. “Send to settlements” retains the displayed map, either whole or cropped. The crop is square and can be specified by X/Y/side or placed on the map.
2. **Settlements** (`#settlements`, `/terrainbench.html?stage=settlements`): settlement placement, regional roads and neighborhoods/blocks. Parcels are disabled by default. Terrain and water come exclusively from the loaded export. Select a city from the list, on the map or in “Neighborhoods and blocks”, then use “Open the city in the workshop”.
3. **Urban planning** (`#urban`, `/urbanbench.html`) contains only the workshop. A transferred city opens its computed plan with a local portion of the terrain, water and regional roads. Cropping retains FP32 cells and translates the geometries together; axes remain unit vectors. Parcels use the same blocks. “Send back to settlements” restores the full map and its other cities, with the modified settings and plan. Shared options synchronize across open sessions of the same city; synchronized drafts wait for explicit application.
4. **Houses** continues to operate independently.

Each workshop stays open during navigation: map, camera, selection, panels and pending settings are retained when returning through the tabs, home or browser Back/Forward buttons. Sending a new export to a stage explicitly loads that new export there.

After reloading the container, each workshop resumes its last applied settings and view when reopened in the same tab. Pending fields, open panels, scroll positions and unapplied painted zones are then restored without applying them to the map. A link with explicit parameters takes precedence over this session context. The export history described below is independent of the session.

“Keep this export” adds a snapshot to the browser's IndexedDB history. The server catalogue and import of existing terrain are in the Terrain menu of Settlements; land use and its layers are also available there. Closing a tab or reloading the container does not delete exports. They are not synchronized across browsers, machines or HTTP origins. Links name the export; to share its contents between machines, attach the **`.decor`** file and import it into the receiving page's history. Downloading from Terrain/Settlements also retains a new snapshot. In the workshop, “Keep and share .decor” adds the result to history and downloads its file.

## Temporary transfer contract

### Generation zones and heightmaps

The **Generation zones** panel selects the automatic background terrain and allows **Sea, Plain, Hills, Mountains, High mountains** masks to be drawn in the main view. The eraser removes an operation; unpainted zones return to the automatic generator. **Example: coast and massifs** prepares editable regions. Radius and transition control spatial boundaries without painting altitude.

The masks control uplift, ridges, mountain distribution and procedural-generator detail **before erosion**. Physical erosion joins the regions. For neural WASM and Python, the same Rust profiles produce input fields and a local relief constraint passed to the base network. The networks produce their own valleys and peaks. The sea mask also applies the coastal operation to the result to preserve the drawn sea.

Auto generates at the end of a stroke; otherwise use **Generate terrain**. Undo/redo and Ctrl+Z/Ctrl+Shift+Z apply to masks. Escape leaves zone editing and restores panning; the wheel continues to zoom. The link shares applied masks, not pending edits. Zones are imported and exported as JSON, separately from heightmaps: version 1, an 8–128² grid, `weights` interleaving five integer weights from 0–255 per cell for sea/plain/hills/mountains/high mountains, with a sum of at most 255. The remainder uses automatic terrain. Zones store no altitudes.

NN masks must form large regions: coarse reads native 7.7 km cells over 40 km. Entering zones with an NN source selects **Scale** to use the whole map; **Crop** remains available. The Python service must be restarted after updating because local relief conditioning changes. An old service must not silently ignore this data.

**Heightmap · import / export** exchanges an already generated or imported raster up to 1024². **Keep** uses its altitudes; **Erode** applies Rust erosion. Export distinguishes displayed terrain after processing from the imported heightmap before processing. To view or export procedural terrain before erosion, generate it at 0%. Non-interlaced 8/16-bit grayscale PNGs can be imported; 16-bit PNG export retains its altitude range and physical width. An external PNG uses the **Black = m** and **White = m** fields. JSON retains altitudes in meters, sea at zero, northwest origin and centered cells. Legacy altitude sketches remain readable for compatibility without becoming zones.

Masks are compressed in the link fragment, without a long HTTP query. Large heightmaps (more than 100,000 compressed characters) remain in IndexedDB with a local reference; share their JSON/PNG or `.decor` for another machine. A missing reference blocks generation rather than producing a different map. Caverns do not use surface operations.

### Transfer to subsequent stages

The existing `.decor` container remains `magna-decor`, version 1: UTF-8 JSON header, gzip-compressed binary raster, FP32 bytes grouped by significance to improve compression. Older maps remain readable. New optional `meta.pipeline` fields describe the stage, parent, crop, selected city and workshop state: applied parameters, seeds, plans and already computed partitions. This extends the bench adapter without imposing a permanent Rust engine contract.

- Local coordinates in meters, northwest origin; centered cells.
- Altitudes, water levels and river widths in FP32; water masks in bytes, river IDs in Int32. No PNG raster round-trip.
- Terrain exports use the adapted physical raster, up to 1024². A crop copies cells without resampling and retains their physical size. X/Y/side are rounded to cell boundaries and displayed in provenance metadata. Vector water and land are clipped and translated into local coordinates, preserving holes.
- Roads and urban plans remain vector geometries. City transfer crops its local raster and preserves approach roads, plan and partitions for the workshop. A complete regional snapshot is retained separately for the return to Settlements.
- Each new snapshot receives an independent ID. An identical import reuses its entry; a different file with the same ID receives a new entry. Previous exports remain accessible.
- Incomplete or failed generation blocks transfer. A missing local export requires reimport; it does not trigger implicit regeneration.

The `web/scripts/export_decors.mjs` batch explicitly uses `pipeline=legacy` to retain its previous automatic terrain → settlements → roads workflow. TypeScript build commands remain independent of Rust compilation.

The full browser workflow check runs from `web/` with `node scripts/rust_pipeline_ui_check.mjs http://127.0.0.1:5173` after starting `npm run dev:benches`. It verifies the terrain crop, selection of another city, the transferred plan, parcels, reimport into empty storage, reload and compatibility of the historical batch. `node scripts/bench_context_ui_check.mjs http://127.0.0.1:5173` checks the four tabs, history navigation, drafts, camera, selection, restoration of applied settings and drafts after reload, and a new transfer.
