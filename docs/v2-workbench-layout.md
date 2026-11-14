# V2 workbench layout

The UI changes are in `web/src/v2/workbenchLayout.ts`, `workbenchLayout.css`, `advancedPanel.ts` and `settlementDefaults.ts`, with integration in `main.ts`, `urbanControls.ts`, `editingTools.ts`, `localUrbanEditor.ts` and `townMoveEditor.ts`. No generation engine or native Rust source is changed by this UI work.

- Settlements: grouped cultures, automatic environmental medieval culture suggestions, five editable settlement counts, an environmental density slider, and all regional stages/actions in Advanced, and draft positions with validation/cancellation. Validation uses the existing regional generation action to reset built cities and compute routes from the new placement list. Existing manually specified counts and lists survive recipe import.
- Cities: a right-hand list of demographic groups ordered by population and isolated activity sites, with all-or-one generation selection and explicit map selection of settlements, districts, parcels or houses. The left panel contains primary generation parameters and Advanced, without scope/status cards. The contextual inspector provides direct controls and advanced grids. Districts expose density, phase/zone and culture; parcels expose household counts and functions, plus house style controls before or after house generation. House recipes and local rerolls use the existing scoped native overrides.
- Editor: map editing tools are in the left panel. Main map display choices are in the toolbar; the remaining map settings are in its advanced grid.
- Header: a thin identity/project/link/build row and a thick configuration row with a single shared settings line. The renderer's live 3D controls are positioned in that same configuration line, retaining their existing DOM ownership and event handlers.

The raster icon source, tool and exact prompt are documented in `web/src/v2/assets/city-display-v1.md`.

## Verification

From `web/`:

```powershell
npx vite --config vite.v2.config.ts --port 5185
node scripts/v2_workbench_layout_check.mjs
npx vitest run tests/v2SettlementDefaults.test.ts tests/v2TownMove.test.ts tests/v2UrbanControls.test.ts tests/v2UrbanSeeds.test.ts tests/v2RenderControls.test.ts
npx tsc --noEmit --pretty false --allowImportingTsExtensions
```

The browser regression uses a small retained fixture and the browser WASM runtime, without rebuilding or calling the local native generation service. It covers primary/advanced controls, density, culture groups, imported explicit counts, isolated places, city/district/parcel/house selection, draft cancellation, position validation, city reset, road regeneration, header 3D controls and mobile overflow. Screenshots and its report are written to `web/out/workbench-layout/`.

`--allowImportingTsExtensions` accommodates the unrelated existing `scripts/_beach_probe2.tmp.mts` file in this shared worktree. The separate `v2Region.test.ts` suite currently has five failures in its WASM URL loading and regional resolution assertions; those engine files are outside this refactor.
