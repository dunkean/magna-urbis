# Repository map

Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for setup and checks. The supported product is the V2 web application and its desktop edition. Development benches and renderer experiments have separate entry points; their presence does not make them release targets.

## Product and shared code

| Location | Responsibility |
| --- | --- |
| `web/src/v2/` | V2 application, editing, project storage and desktop integration |
| `web/src/gen/` | Shared world types, generation orchestration, names and remaining TypeScript generation |
| `web/src/render/` | Shared map and city rendering used by V2 and the benches |
| `web/src/ui/` | Shared UI/rendering components and development workshop pages |
| `rust/crates/terrain/` | Terrain, erosion, hydrology and climate |
| `rust/crates/core/` | Resources, settlements, roads and urban generation; re-exports terrain |
| `rust/crates/random/` | Shared deterministic random generation |
| `rust/crates/houses/` | Building generation |
| `rust/crates/wasm/`, `rust/crates/houses-wasm/` | Browser bindings for the procedural engine and buildings |
| `rust/bridge/` | TypeScript adapters to Rust/WASM and native services |
| `rust/crates/local/` | Native procedural engine service |
| `rust/desktop-v2/` | Released V2 Tauri application |

Run `npm run dev:v2` from `web/` after preparing its WASM packages. Generation and display choices shared with a bench belong in shared modules, not in parallel copies. The [Rust README](../rust/README.md) describes the engine and workshops.

## Optional modules

| Location | Responsibility |
| --- | --- |
| `rust/crates/neural/` | Neural terrain implementation and reference tooling |
| `rust/crates/neural-native/`, `rust/crates/neural-wasm/` | Native and browser adapters to the pinned Neural Earth runtime |
| `rust/models/neural-earth/` | Model inventories, profiles, configuration and attribution |
| `python_runtime/` | On-demand management of optional Python environments |
| `illustration/` | Optional local illustration service |

Procedural use requires neither Python nor model downloads. Building the optional native/browser neural adapters currently also requires the Neural Earth checkout at `../infinite_map`; the pinned engine revision is recorded in `rust/models/neural-earth/desktop-profile.json`. Follow the [V2 setup guide](../rust/desktop-v2/README.md) and [desktop release guide](DESKTOP_RELEASE.md) rather than substituting a machine's existing caches. Original Python checkpoints, browser caches and native prepared weights are distinct artifacts.

## Workshops and experiments

| Location | Status and entry point |
| --- | --- |
| Workshop HTML and scripts under `web/src/ui/` | Development/debugging interfaces; `npm run dev:benches` |
| `rust/desktop/` | Separate bench/local Tauri shell; `npm run app:dev`; not the V2 release application |
| `web/src/surface/`, `surface/` | Surface interchange contracts, adapters and asset preparation for renderer experiments |
| `viewer-local/` | Experimental Godot/Terrain3D SurfaceWorld viewer; see its [README](../viewer-local/README.md) |
| `godot-render/` | Separate Godot rendering experiment, launched by `Test-Render.ps1` |
| `rust/experiments/` | Isolated research experiments |
| `tools/namebench/` | Import/export tooling for the embedded name data |

Keep these components until their callers, fixtures and maintained use have been checked. Deleting an experiment also requires updating its launchers, documentation and asset attribution. The V1 product is maintained in the [separate V1 repository](https://github.com/dunkean/magna-urbis-v1).

## Tests, documentation and assets

- `web/tests/` and the Rust crates' tests hold executable regressions and reproducible fixtures.
- `web/scripts/` contains development, build, release and validation commands; consult its [command guide](../web/scripts/README.md). Root `scripts/` contains asset, license and neural-release preparation tools.
- `docs/` holds current guides, interface specifications and scientific references. Dated studies state a historical scope; the [documentation index](README.md) identifies maintained entry points.
- `docs/scientific/` contains the published illustrated atlas and its source generator. Its images, HTML and source data are publication assets, not disposable validation output.
- `assets/`, renderer asset directories, `licenses/` and `THIRD_PARTY_NOTICES.md` retain source assets and their attribution. Check provenance and consumers before moving or deleting them.
- `rust/pkg/`, `rust/target/`, `web/dist*`, `web/out/` and other ignored output directories are generated locally. A clean clone must recreate required build products; do not commit caches or captures to make a test pass.

## Making a cleanup change

Keep each change reviewable: identify the current entry point, search imports and script callers, remove the obsolete implementation and update its references together. A missing static import alone is insufficient evidence for workers, dynamically loaded modules or tools launched by command. Preserve regression fixtures, model manifests and license records. Include the relevant check results in the pull request, and identify hardware-dependent checks that were not run.
