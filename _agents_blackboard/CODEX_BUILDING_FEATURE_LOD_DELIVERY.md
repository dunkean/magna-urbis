# Building feature LOD delivery

Installed the reviewed `b06_feature_lod` proposal byte-for-byte after checking both active base SHA-256 values and all four proposal hashes. Changes are confined to `urbanBuildingGeometry.ts`, new `urbanBuildingFeatureLod.ts`, and `urbanBuilding3d.ts`, plus the dedicated regression test below.

Overview sectors can omit `post`, `frame`, and `portal_lintel` pieces only when their conservative projected extent is below two pixels. Near views and callers without projection context retain all geometry. Large pieces, walls, stairs, roof attachments, unknown kinds, and invalid bounds remain visible. Source plans, occupation, and rights are unchanged. Perspective bounds include off-axis projection and nonorthogonal Float32 rows. Octave caching avoids per-frame rebuilds; ineligible sectors retain their caches across zoom octaves. Picking follows the LOD of the geometry actually cached and drawn, including budget-deferred rebuilds.

Validation completed:

- Root integration: `node node_modules/vitest/vitest.mjs run tests/urbanBuildingFeatureLod.test.ts tests/urbanBuilding3dUpdates.test.ts tests/urbanBuildingGeometry.test.ts tests/city3d.test.ts`: **15 tests passed in 4 files**. The new five tests cover immutable physical data, near/no-context geometry, omission eligibility, the off-axis counterexample, sector eligibility replacement, and cached picking during deferred rebuilds.
- Root final `node node_modules/typescript/bin/tsc --noEmit`: **passed**. A transient failure during concurrent external edits had resolved before this final check. Logs: `integration-vitest.log` and `integration-tsc.log` in the proof directory.
- Targeted `git diff --check`: **passed**; Git emitted line-ending normalization notices only.
- Fresh proposal CPU checker: **8 checks passed** on **6,225 buildings / 7,921 archived requests / 124 batches**. Near triangles and overview triangles without scale matched their original SHA-256 streams; physical scene objects were unchanged.

On the **final production C replay**, at an explicit overview scale of **2 m/px, exaggeration 1**, feature triangles fall from **309,401 to 36,903 (88.07%)**; total overview triangles fall from **496,385 to 223,887**. Current source hashes and all 124 native output hashes are recorded in `production-c-inventory.json`, produced by `web/scripts/benchmark_building_feature_lod.mjs`. These are corpus CPU triangle counts, not measured FPS, GPU memory, or a live-camera benchmark. The earlier proposal proof used V1 (332,902 to 40,222 feature triangles); it remains a distinct archived experiment.

Evidence is in [`web/out/b06-feature-lod-delivery-proposal-proof/`](../web/out/b06-feature-lod-delivery-proposal-proof/): `report.json` contains the full corpus/scales and exact proposal hashes; `delivery-verification.json` records installed source hashes and commands; `.before` snapshots preserve the verified bases. The original checker and manifest are copied there for provenance. Re-run the persistent tests from `web/`; the original proposal checker intentionally requires the pre-install base hashes.

No browser or server was started for this LOD delivery. Its display inventory reads the separate frozen native production replay; it does not generate architecture.

