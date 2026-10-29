# Magna Urbis architecture and release review

28 October 2026 · Local working tree based on commit `1eaab909`

Scope: three review pages followed by two pages on release debt. Page markers provide the requested reading structure; physical pagination depends on the Markdown renderer. Findings describe the code present locally, including uncommitted work. Recommendations are explicitly labelled.

<!-- Page 1 of 5 — Review 1 of 3 -->

## Review 1 of 3 — What V2 actually is

**V2 already exists as a hybrid application: a TypeScript frontend and orchestration layer, Rust generation engines, and several execution adapters.** “TypeScript = V1” is therefore misleading. V2 still legitimately uses TypeScript for its interface, workers, rendering, project handling and some generation. Rust is becoming the authoritative terrain and urban engine; it does not replace the whole application.

| Application or surface | Actual technology | What it connects to |
| --- | --- | --- |
| V1 map application, `web/src/ui/index.html` | TypeScript, Vite, DOM, Canvas/SVG | Classic TS world generator; separate rendering worker; optional illustration connector. |
| V2 workshop, `web/src/ui/v2.html` | TypeScript, Vite, DOM/CSS; dedicated generation, rendering, export and project workers | Rust/WASM or local Rust; optional terrain inference; selectable classic TS engine. |
| Terrain, Urban, City and House benches | Separate TypeScript browser entry points | Rust bridges, diagnostics, architectural tools and specialist workflows. Their capabilities are not automatically V2 capabilities. |
| V2 desktop, `rust/desktop-v2` | Tauri 2 shell around the same web frontend | Starts the packaged native Rust service; optionally starts externally installed Python/CUDA. V1 has its own desktop shell. |
| `viewer-local` | Godot, Terrain3D, GDScript and shaders | Consumes exported SurfaceWorld packets and optional live refinement. Separate viewer, outside the V2 launch path. |
| `godot-render` | Godot/GDScript, custom GPU shaders and preparation tools | Independent tile comparison viewer; also contains the RenderOriginalRD reproduction path. |

**Execution choices are different dimensions.** WASM is the browser target for Rust. WebGPU accelerates selected terrain stages and browser neural inference. Native Rust runs through loopback HTTP. Python/CUDA supplies optional neural terrain. None of those choices means that the urban pipeline or the renderer automatically runs on the GPU.

The V2 default recipe selects Rust with automatic compute selection. The installed application starts the native service. Urban generation can independently select TS, Rust/WASM or Rust native. Natural-cover adaptation, rural land use, names and cartographic projection still use TS code even with Rust-generated cities.

**Recommendation:** retain this hybrid stack. Define V2 by its staged workflow, retained world data and supported engines. A Rust-only frontend rewrite would add migration work without resolving the current release blockers.

Evidence: [V2 settings and defaults](../web/src/v2/settings.ts), [execution contracts](../web/src/v2/contracts.ts), [platform adapter](../web/src/v2/platform.ts), [generation orchestration](../web/src/v2/engine.ts), [desktop startup](../rust/desktop-v2/src/main.rs).

<!-- pagebreak -->
<!-- Page 2 of 5 — Review 2 of 3 -->

## Review 2 of 3 — Main generation features and their consumers

“Connected” below means an execution path exists in the reviewed code. It does not certify every culture, parameter combination or hardware backend.

| Existing feature | Implementation | Connected frontend | Recommendation for V2 |
| --- | --- | --- | --- |
| Procedural relief, coasts and terrain families | Rust `core`, WASM/native adapters; optional WGSL compute. Classic TS terrain also remains. | V2, Terrain Bench; classic path in V1 | **Core.** Make Rust CPU the release baseline. |
| Erosion, drainage, rivers and lakes | Rust terrain/hydrology stages; selected GPU passes. V1 has separate TS hydrology. | V2 and Terrain Bench; V1 uses its own engine | **Core.** Preserve Rust water fields rather than recomputing them in TS. |
| Heightmap import and terrain editing | TS image decoding and controls; Rust surface processing, sketches and semantic zones | V2, Terrain Bench; image import also in V1 | **Core.** Clearly distinguish imported precision from export precision. |
| Neural terrain in the browser | Optional `neural-wasm` adapter into Neural Earth's Rust/WASM/WebGPU runtime; external weights | V2, terrain benches | **Optional.** Keep model preparation and hardware requirements outside the basic install. |
| Neural terrain through Python | Local PyTorch/CUDA service, source `neural-python`; configurable checkpoints | V2, terrain benches | **Optional extension.** Python does not generate the cities. |
| Neural terrain through native Rust | `crates/neural`, Burn/wgpu; separate service, source `neural` | Existing terrain bridge and V2 source selector | **Legacy/advanced.** Requires its own running service; the normal V2 launcher does not start it. |
| Regional settlement placement and roads | Rust settlement/road engine; classic TS alternative | V2 and Terrain/Settlements Bench; classic equivalent in V1 | **Core.** Keep placement and road-only recalculation separate. |
| Cultural plans, growth, streets and defences | Rust urban layout, catalogue, morphology and historical policies; classic TS urban engine | V2, Urban/City/Terrain benches; classic equivalent in V1 | **Core.** Qualify representative cultures, sizes, slopes and waterfronts. |
| Blocks, parcels, functions and capacity | Rust cadastral and programme stages, including placement refusals and built-capacity evidence | V2 inspectors and urban benches | **Core.** Preserve the four stops: plan, parcels, programme, buildings. |
| Architectural houses and functional buildings | Rust `houses` and `houses-wasm`; retained plans, materials, site constraints and refusals | V2 through the urban bridge; House Bench and City Bench | **Core.** Keep standalone architectural experimentation in House Bench. |
| Local edits and selective regeneration | TS settings and override management; native quarter, parcel and house contracts | V2; related bench tools | **Core.** Retain upstream stages and neighbouring occupations when editing one house. |
| Forest cover, rural land use, names and fantasy layers | Rust terrain forest fields plus TS cover/rural/name/cavern code | V1 and V2; terrain/urban benches have additional displays | **Keep existing reuse.** Fantasy options are connected, but cross-engine parity needs explicit qualification. |

The staged Rust urban path is more advanced than the README's older “streets, blocks and parcels” description suggests. Conversely, extensive parameter exposure does not prove that V2 reproduces every specialist bench workspace.

Evidence: [terrain bridge](../rust/bridge/terrain.ts), [regional orchestration](../web/src/v2/region.ts), [urban execution and projection](../web/src/v2/rustUrban.ts), [urban parity and remaining gaps](V2_URBAN_PARITY.md), [neural manifests](../rust/crates/neural/Cargo.toml) and [external browser dependency](../rust/crates/neural-wasm/Cargo.toml).

<!-- pagebreak -->
<!-- Page 3 of 5 — Review 3 of 3 -->

## Review 3 of 3 — Rendering and product boundaries

**There is already a working web 3D integration in V2. Godot is a separate renderer experiment, not its current 3D backend.** The renderer family and the compute backend must be named separately in product documentation.

| Rendering path | Technology and actual consumer | Recommendation |
| --- | --- | --- |
| Finished cartographic maps | Shared TS scene/style code, Canvas 2D/OffscreenCanvas, SVG and PNG exports; used by V1 and V2 | **V2 default.** Retain shared styles, labels and export composition. |
| Terrain and city diagnostic maps | Custom WebGL2 plus Canvas/SVG paths in the benches; dedicated terrain/city buffers and shaders | **Development tools.** Reuse relevant components without importing every bench UI. |
| V2 3D | `v2/urban3d.ts` adapts retained world/city snapshots to City Bench's `city3d.ts` and custom WebGL2 `terrain3d.ts` | **Keep.** It reuses existing geometry and native architectural detail; it is not a Godot scene. |
| SurfaceWorld viewer | TS surface compiler, versioned packets/binary transport, Godot/Terrain3D consumer in `viewer-local` | **Experimental.** Valuable interchange boundary; not ready to replace finished map composition. |
| Godot tile and original-render comparison | `godot-render/project.godot`, tile viewer, PBR preparation and RenderOriginalRD | **Outside the initial release.** Retain as renderer evaluation and visual comparison tooling. |

Godot work is substantive: surface materials, vegetation, water, refinement and native urban geometry have adapters and diagnostics. However, the SurfaceWorld viewer still does not reproduce the full web labels, fantasy brushes and final map composition. Existing regional/Neural Earth exchange contracts also do not constitute complete integration into the planetary application.

| Other existing feature | Current connection | Recommendation |
| --- | --- | --- |
| Complete project save/load, seed/recipe export, territory/urban recipe composition | V2 project and composition workers; typed fields and native snapshots retained | **Core.** Treat complete snapshots as the reliable preservation path. |
| Cropped, layered SVG/PNG, heightmap and 3D PNG exports | V2 UI and export worker; shared cartographic infrastructure | **Core.** Heightmap export is 8-bit plus scale metadata; full projects retain FP32. |
| English/French UI, progress log and terrain caches | V2; memory and IndexedDB caches; actual backend provenance | **Core.** Preserve explicit failure and fallback reporting. |
| AI illustration through FLUX/SDXL or external providers | Python illustration service and TS connector mounted in V1 and several benches; no mount found in V2 | **Later optional feature.** Separate from terrain inference and source-world generation. |
| RPG pins, annotations and measuring tools | V1 and/or City Bench; no equivalent V2 mount found | **Useful follow-up.** Prioritise if tabletop map authoring is the release promise. |
| Cold city stores, parent archives and assembly experiments | Specialist City Bench/native workflows; V2 retains regular city snapshots | **Defer.** Do not promise the benches' large-city workflow in V2. |

**Recommended boundary:** one V2 web application and one Tauri wrapper, shared Rust core/house libraries, explicit WASM/native adapters, and the current shared web renderers. Keep TS utility generation until a measured reason justifies porting it. Keep Godot and neural engines optional, independently versioned consumers/providers.

Evidence: [2D client](../web/src/v2/client.ts), [3D adapter](../web/src/v2/urban3d.ts), [SurfaceWorld viewer limits](../viewer-local/README.md), [Godot comparison path](surface/RENDER_ORIGINAL_GODOT_FR.md), [V2 UI](../web/src/v2/main.ts), [illustration and pins in City Bench](../web/src/ui/citybench.ts).

<!-- pagebreak -->
<!-- Page 4 of 5 — Release debt 1 of 2 -->

## Release debt 1 of 2 — What should block a release

**Release judgement: a bounded procedural beta is plausible, but the reviewed working tree is not ready to tag.** The immediate debt is reproducibility and failing validation, rather than a need to replace the stack. The checks below were executed locally; application source code was not changed.

| Check executed | Observed result |
| --- | --- |
| `npm run test:v2` | **Pass:** 19 test files, 101 tests. |
| `npm run typecheck` | **Fail:** TS2345 at `tests/v2TerrainParity.test.ts:44–45`; `relief` is inferred as `string`, outside the request's literal union. |
| `npm run build:v2` | **Pass:** static artifact built using the existing local WASM packages. This build does not run the type checker. |
| `node scripts/v2_static_check.mjs` | **Pass:** deployed-style subpath, external workers, real Rust/WASM CPU terrain, documentation and images; no recorded page errors or missing resources. |
| `cargo test -p magna-urbis-local --offline` | **Fail:** native binary unit tests report 6 passes, 1 failure; later test targets were not reached. |

### P0 — Make the release reproducible

At inspection, `git ls-files` returned no tracked files for `web/src/v2`, `rust/desktop-v2` or the V2 workshop guide. Their local presence is therefore not evidence that a checkout of HEAD contains V2. Commit the intended frontend, launcher, configuration, tests and documentation before release; review the wider dirty tree separately. This is a packaging blocker, not a request to discard ongoing work.

`rust/pkg` is intentionally ignored. The V2 launcher verifies that required WASM files exist, but that does not establish that they match the reviewed Rust source. **Required exit condition:** a clean checkout runs `npm ci`, `npm run prepare:v2` and `npm run build:v2`, then passes the static smoke test. Record the source revision and WASM/toolchain identities with the artifact.

### P0 — Restore meaningful green checks

Fix the two TS test typing errors. Resolve the native failure in `programme_functions_capability_announces_consumed_native_weights`: the assertion expects French text containing “régénérant les quartiers”, while the corresponding source message contains corrupted character encoding. This demonstrates a message/encoding contract failure, not a proven city geometry failure. Use a stable error code for machine assertions and test readable presentation separately. Rerun the complete native target afterwards.

No checked-in `.github` workflow directory was found. Add a release gate for clean preparation, type checking, V2 tests, relevant Rust tests, build and production-artifact smoke checks. Existing npm/Cargo lockfiles and the pinned Rust toolchain are useful foundations. Also pin the desktop CLI: the launcher currently resolves `@tauri-apps/cli@^2` through `npm exec`.

### P0 — State the supported release envelope

Release only the cultures, populations, map extents and platforms exercised by an acceptance matrix. UI limits of up to 100 km, 100 places or millions of inhabitants are input bounds, not demonstrated performance guarantees. Include waterfronts, steep terrain, placement refusals and failed/cancelled operations. Require native end-to-end and clean-machine installer checks if desktop is shipped.

Evidence: [WASM preparation and launcher](../web/scripts/v2.mjs), [native failing assertion](../rust/crates/local/src/urban_source_tests.rs#L45), [native message](../rust/crates/local/src/main.rs#L900), [type-check failure location](../web/tests/v2TerrainParity.test.ts#L44), [test/build scripts](../web/package.json).

<!-- pagebreak -->
<!-- Page 5 of 5 — Release debt 2 of 2 -->

## Release debt 2 of 2 — Contain the cost of shipping

### P1 — Stabilise ownership and compatibility

V2 imports V1 `World`/`Options` types, bench rendering code and Rust bridge contracts. Native snapshots also travel through `world.debug`. This reuse accelerates delivery but makes apparently local changes affect multiple applications. Establish a documented, versioned retained-world contract, with adapters for display and persistence. Promote essential native data out of a diagnostic namespace gradually; a wholesale rewrite is unnecessary before beta.

Project schema, terrain cache key, house generator and native archive versions are separate compatibility concerns. Existing validation, typed-array round trips and legacy cache handling are strengths. Add release fixtures that load an older complete project, preserve FP32/water/native geometry, edit one building, save and reload. Store effective engine/model/backend provenance. A seed and recipe alone cannot promise identical neural/GPU output across versions and devices.

### P1 — Set performance and rendering budgets

The observed build contains approximately **29.9 MB of raw WASM** across the terrain and house binaries, before optional neural assets. This is artifact size, not measured startup traffic. Generation, snapshots, rendering and exports can each retain large arrays or archives. Existing transfer projections, caches and lazy detail are worth preserving; the remaining work is to measure cold start, peak memory, import/export and navigation on the supported scenarios.

Use representative retained scenes to compare 2D exports and 3D views: water alignment, building identity, materials, labels, zoom detail and context recovery. Freeze output expectations for the chosen web renderers. Keeping Godot outside the initial product avoids adding another renderer qualification matrix during release preparation.

### P1 — Qualify the desktop boundary

The native service already enforces loopback binding, checks Host/Origin, limits request sizes and bounds concurrency. Retain those protections. The Tauri configuration currently has `csp: null`; assess and configure the policy required for workers, WASM and permitted local endpoints before public desktop distribution. Verify service shutdown, occupied ports, missing Python, invalid projects and startup errors on an installed build. These are targeted checks of the actual local-service architecture.

### Suggested release sequence

1. **Freeze a procedural beta scope.** Rust CPU terrain and urban generation, shared 2D maps, project persistence and exports. Include web 3D only after representative browser/GPU checks; classify WebGPU compute as optional until qualified.
2. **Make one clean artifact reproducible.** Track the V2 files, rebuild WASM from the tagged source, fix both failing checks, and run the release gate. Review stale README claims about missing Rust towns and future rendering.
3. **Exercise the complete user journey.** Generate terrain → place settlements/routes → build a city → edit a parcel/house → save/reload → export. Add invalid input, cancellation, unavailable GPU, cache failure and placement refusal scenarios. For desktop, repeat after installation on a clean target machine.
4. **Ship optional engines separately.** Neural profiles should identify runtime, models, hashes, hardware requirements and redistribution terms. Keep the external `../infinite_map` checkout out of the procedural baseline. Introduce illustration, specialist city archives and Godot through explicit later milestones.

**Validation limits:** this review did not rebuild WASM from a clean checkout, run the full TS/Rust suites, qualify real neural models or WebGPU compute, perform a live 3D acceptance run, or build/install desktop packages. The passing static browser test covers Rust/WASM CPU terrain, not that wider matrix. Those gaps are release tasks, not inferred defects.

Evidence: [project format and validation](../web/src/v2/project.ts), [cache versioning](../web/src/v2/cache.ts), [house versions](../rust/bridge/housesContract.ts), [native service boundaries](../rust/crates/local/src/main.rs), [desktop security configuration](../rust/desktop-v2/tauri.conf.json), [existing optimisation review](V2_OPTIMIZATION.md).
