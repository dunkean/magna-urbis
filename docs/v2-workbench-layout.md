# V2 workbench layout

The UI changes are in `web/src/v2/workbenchLayout.ts`, `workbenchLayout.css`, `advancedPanel.ts` and `settlementDefaults.ts`, with integration in `main.ts`, `urbanControls.ts`, `editingTools.ts`, `localUrbanEditor.ts` and `townMoveEditor.ts`. No generation engine or native Rust source is changed by this UI work.

- Settlements: grouped cultures, automatic environmental medieval culture suggestions, five editable settlement counts, an environmental density slider, and all regional stages/actions in Advanced, and draft positions with validation/cancellation. Validation uses the existing regional generation action to reset built cities and compute routes from the new placement list. Existing manually specified counts and lists survive recipe import.
- Cities: a right-hand list of demographic groups ordered by population and isolated activity sites, with all-or-one generation selection and explicit map selection of settlements, districts, parcels or houses. The left panel contains primary generation parameters and Advanced, without scope/status cards. The contextual inspector provides direct controls and advanced grids. Districts expose density, phase/zone and culture; parcels expose household counts and functions, plus house style controls before or after house generation. House recipes and local rerolls use the existing scoped native overrides.
- Editor: map editing tools are in the left panel. The redundant map-stage action and Full generation are removed from this tab. Primary display switches and the road mode selector are shared by 2D and 3D.
- Generation: Full generation starts from the selected family. Region runs the existing complete pipeline; Settlements runs the existing region action then towns; Cities runs only the selected city or all cities. A failed or cancelled placement never starts city generation. No generation algorithm is changed.
- Header: a thin identity/project/link/build row and a thick configuration row with a single shared settings line. The renderer's live navigation and supported satellite-tree controls are in that same line. Ground controls, refinement, city rendering icons and textures live in Advanced. Textures remain off by default.
- Navigation: Orbit, Walk (12 m/s, Shift 36 m/s) and Free flight (60 m/s, Shift 240 m/s). First flight starts at eye level over the current orbit target. Flight follows view pitch, Space/E ascends and Ctrl/C descends; horizontal flight retains absolute altitude. Escape returns to orbit. Movement is normalized and frame-rate independent. First-person fog uses a landscape distance (at least 5 km), shared by terrain, trees and billboards in WebGL and WebGPU, instead of the short orbit anchor.

## Adaptive rendering Advanced

`renderPassControls.ts` presents the current style, target and rendering family, component activation, independent style sources, and folded component settings. Inapplicable satellite waves and perspective controls are hidden; inactive components hide their fine settings. The canonical visibility input elements move into the open popover and return to their exact toolbar slots when it closes. No duplicate visibility state or per-frame UI listener is introduced. The urban Plan switch applies to the same overlays in both views and export, retaining individual layer choices for when Plan is enabled again.

`renderPassMix.ts` copies only the selected component's existing appearance fields. For example, satellite ground can keep cartographic water and parchment vegetation. This is composition of existing components, with one ground material; it introduces no shader-code compiler, additional GPU pass or second renderer. Opening Advanced does not write appearance values. Quality tiers, normal shader preparation and default rendering costs are retained; enabling optional components still uses their existing renderer and caches. Modelled 3D trees remain opt-in and appear only for supported procedural satellite vegetation.

Changing a 3D control emits only changed fields, so it cannot pin unrelated ground/visibility defaults. Selecting another style clears the explicit per-view ground override and updates controls immediately, independently from asynchronous texture/shader preparation. A deferred ground selection cannot overwrite a more recent style choice. The 3D background follows appearance revisions even when its canvas object is reused. Imported terrain missing its display forest now builds and caches that display product over retained heights, while existing forest fields are reused without work.

The raster icon source, tool and exact prompt are documented in `web/src/v2/assets/city-display-v1.md`.

## Verification

From `web/`:

```powershell
npx vite --config vite.v2.config.ts --port 5185
node scripts/v2_workbench_layout_check.mjs
node scripts/v2_render_controls_check.mjs
node scripts/v2_full_generation_check.mjs
node scripts/v2_navigation_visibility_check.mjs
npx vitest run tests/v2FullGeneration.test.ts tests/v2Urban3d.test.ts tests/v2RenderControls.test.ts tests/terrain3dNavigation.test.ts tests/v2RenderPassMix.test.ts tests/v2DisplayForest.test.ts tests/appearanceRecipe.test.ts tests/v2Appearance.test.ts tests/v2SettlementDefaults.test.ts tests/v2TownMove.test.ts
npx tsc --noEmit --pretty false --allowImportingTsExtensions
```

The browser regressions use a small retained fixture and the browser WASM runtime, without rebuilding or calling the local native generation service. They cover layout, inspectors, placement edits, shared controls, read-only Advanced opening, style composition, ground reset, flight, and the actual generation actions from Settlements and Cities. Exported physical terrain products and untargeted native city products are compared before and after generation; presentation changes are checked against the entire exported world. Screenshots and reports are written to `web/out/workbench-layout/`.

`--allowImportingTsExtensions` accommodates the unrelated existing `scripts/_beach_probe2.tmp.mts` file in this shared worktree. The separate `v2Region.test.ts` suite currently has five failures in its WASM URL loading and regional resolution assertions; those engine files are outside this refactor.
