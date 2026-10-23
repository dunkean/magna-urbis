# Reference fixture: authentic native exteriors from retained source plots

This CPU-only tool produces a **new current native plan version**, constrained
by 500 real source footprints and their original site/access/terrain/config/seed
requests. It does not reinterpret an old plan as current, reroll refused sites,
construct roofs in a renderer, or modify the original source files.

The reference result is 419 native exteriors, 81 explicit planning refusals and
zero realization refusals. The old 500 accepted occupation plots remain the
canonical baseline, explicitly marked 419 newly realized / 81 retained unrealized
plots. This is not certification of interiors, site/access, population capacity,
fresh neural terrain or a live browser handshake.

## Inputs

Large inputs and generated binaries are intentionally outside Git:

| Input | SHA-256 |
| --- | --- |
| `city-01-river-plain-l-plans.json` (6683 original accepted native plans) | `78b9a0eb1d19bb9c553dcf632af113f8e16c0cd32347e1bec93a889f78facd92` |
| `city-01-river-plain-l-placement-requests.json` (8305 original requests) | `9f5af72bd64c87e3561ec9c871fbf30b7dfd2e897d7df741b8b69636ee8ca8ba` |
| `city500-retained-layers-1.5.2-bound.surfacebin` (bound terrain/urban reference) | `91ad2a522f159f67d629dd46e36d97c1b1786222eaa00bac25454bf2834e7ef2` |

The base packet selects the exact 500 building IDs from the larger source files.
It has a corrected canonical-parent binding; its entire physical payload is
unchanged from the earlier invalid-binding diagnostic fixture. See the evidence
reports in `docs/surface/evidence/native-city500-v152.json` and
`docs/surface/evidence/native-current-exterior-fixture.json` for provenance and
the separate negative legacy-replay result.

## Run

Use Python3.11+, Node, the repository's `tsx` dependency and the Rust toolchain.
The locked native dependencies must already be cached for `--offline` builds.
All outputs and Cargo build products go into the explicitly supplied ignored
directory. Native dependencies compile there; no primary checkout, native crate
source or shared package artifact is modified.

```powershell
python web/scripts/fixtures/native-city-realization/produce.py `
  --source-plans C:/data/city-01-river-plain-l-plans.json `
  --source-requests C:/data/city-01-river-plain-l-placement-requests.json `
  --base C:/data/city500-retained-layers-1.5.2-bound.surfacebin `
  --out web/out/surface/native-city-realization
```

`--runtime-repo <path>` selects a separate read-only repository providing the
existing TS surface/urban adapters. By default these come from this checkout.
`--skip-build` reuses the executable in the chosen output directory and records
its actual SHA; it does not infer its provenance from a branch name.

The runner calls precisely the native functions behind the existing JSON APIs:

- `plans::plan_batch(PlanBatchRequest)` for the new current plans;
- `plans::realize_plan(RealizePlanRequest { building, interiors:false })` for
  genuine native exterior meshes.

Original legacy replay is attempted separately and its refusal is retained.
Only then is a trial new plan and trial new realization tested before the full
batch. A failed trial stops the process. Planning refusals stay in the reports;
realization failures stop assembly rather than silently dropping buildings.
The reference assembly also refuses to label a different count as 419.

The native local-to-world conversion is the existing `nativeExteriorDetail`;
mesh export is the existing `exportMagnaBuildings` / `packUrbanColumns` path.
New-plan IDs, world transform, construction plane, level supports and materials
must survive this conversion exactly. New native planning is **not** claimed to
preserve the old plan's construction plane: the measured maximum difference is
0.138916m, despite near-identical physical footprint boundaries. The old source
plans remain untouched and separately qualified.

The packet preserves terrain/canonical fields/parents, gets a new urban identity,
and embeds raw UTF-8 native planning requests/responses and exterior JSONL bytes.
This keeps resolved source data available without bloating the JSON manifest or
losing source data needed for future editing/replay.

## Source and binary provenance

`runner/src/main.rs`, `runner/Cargo.toml` and `runner/Cargo.lock` are byte-identical
copies of the executed isolated runner inputs. The lock derives from the native
workspace lock; all dependency versions/checksums match it. The 419 reference
was built using 196 native source/data files whose hashes were checked equal to
the integration checkout; the executable's actual SHA is recorded in the report.

The cached `rust/pkg/houses` WASM did **not** export `plan_buildings_json` or
`realize_plan_json`. It was not used, replaced or silently treated as current.
The isolated CPU native executable is the producer of this fixture.

The tracked assembler keeps the executed geometry logic. Its only adaptations
are configurable `--root` / `--out` / `--base` paths and an explicit reference
count assertion. The original executed assembler SHA and file remain in the
ignored evidence directory. Moving a build project can change an executable
hash; compare the actual recorded binary/request/output hashes and geometry
identity rather than assuming bit-identical executables across build paths.

The tracked orchestration was replayed with the executed native binary in a
separate ignored output directory. The resulting 246,787,817-byte fixture was
**byte-identical** (SHA `3bc88b136930baa83d31b9ca3f41a05a768365a6fa8ad6719a93f204d430da81`).
See `docs/surface/evidence/native-exterior-tool-reproduction.json`. That report
provides raw and LF-normalized tool-source hashes because checkout line endings
can differ. It does not claim identical executables across build paths/toolchains.
