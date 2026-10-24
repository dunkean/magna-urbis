# Follow-up: V2 compile correction

V1 failed root compilation with E0277 at json!(f.sites); Site is Deserialize-only.
Its frozen files and failed build log are preserved. Root should use V2 only:
`web/out/java100k-current-benchmark-workspace-v2/implementation-freeze.json`
SHA256 `37530416a4f3d55196f247a0e9ae0845bef472089db1587f74da4859bccb82f4`.

V2 serializes actual parsed Site fields explicitly, including center/radius bits.
No raw input JSON is passed off as parser observation. No product/v3 code changed.
Own standalone Cargo lock9837a5d2... is declared separately in compiled source
identity; preflight records it and postflight checks it did not change during run.
V2 README has new paths/target-v2; V1 instructions below are historical only.
Author performed no build/test/native run. Root builds and measures.

Independent parameters_ui provenance review also confirms exact URL/options,
terrain/geometry, true radius1815.7360834719918 and fallback seeds. Its note is
`CODEX_JAVA100K_INPUT_PROVENANCE.md`. The old runtime SHA is an archived declared
identity, not independently rehashed binary provenance; no new inference added.

# Java100000 current benchmark - prepared handoff

Freeze: `web/out/java100k-current-benchmark-workspace/implementation-freeze.json`
SHA256 `6dcd7e88ea62a8fa3dd7735ad17867375447a3520466e15459e46a42144ab27b`.

69 local harness/input/bridge files;340 external source/config identities bind exact frozen v3/candidate Core+Houses. No v3/product source changed, no build/test/Cargo/native/server/browser executed by author. README.md is plain ASCII with all root commands.

Pipeline: exact user retained decor and archived URL/config -> real Core quarters/parcels -> all original BuildingSiteIndex pages -> copied actual streamArchitectureSource plus archivePlanBatch -> existing non-test Houses plan_batch -> offline native housing-floor outcome aggregation. All original pages, enriched batches/neighbors, native plans, archived bridge plans, facts and stdout/stderr survive. There is no old-C request-count assumption or replicated geometry.

Build is a standalone external crate with v3 path dependencies; fresh distinct target and Cargo JSON artifact/source paths for main/Core/Houses are mandatory. verify_inputs.py binds executable SHA and all runtime/input/harness bytes, real decor float32 raster bytes/vector geography/recipe metadata and URL settings. Root copies the declared executable outside target, runs preflight, core stage, TS stage, postflight, then analysis. Lock normalizes only in the standalone crate and is recorded before/after; v3's lock is not used.

Provenance boundaries explicit: seed city-tropical-island-l, population100000, culturejavanese-courts, center8000/8000, parcel_fit=true. Retained terrain16000m/1024, retained site radius1815.7360834719918, exact original road list empty (retained decor also has zero segments despite URL roads enabled). No fresh terrain/roads/neural generation. Dated v3 excludes the later tidy.rs drift. Unknown original capture binary SHA is not replaced with a guess; this harness has a new explicit build identity. Input label encoding is preserved without numerical effects.

Analysis separates exported known indicative useful need, admitted measured gross, per-site necessary admitted deficit, unplaced known need, unknown models/inventories, requested massing, actual body footprint, requested composition, actual native layout/source, real per-body levels, requested households and native entries. Native levels already use exact coplanar unions/holes; no footprint-times-floors calculation. Model roundtrip comparisons use the existing scalar64*f64::EPSILON allowance, not physical EPS. Insular remains generic/not-culture-calibrated. Housed households and actual useful area stay unknown, no gross-to-population conversion.

Sums of housing_floor_need concern the requests that Core actually exports. They are not silently a need model for unallocated city population; complete layouts/programme graphs remain on disk for inspecting that separate debt. Native fact extraction uses public lossless serialization, no new native export; cost is separate. Normal native admission is preserved; the independent128m index checks bridge context continuity, not a new global geometric collision/terrain audit. No perfect-city or screenshot claim.

Root can compile immediately. No promotion candidate in this benchmark, only measurement preparation. Slot released after handoff; isolated fixes can follow root compilation/results.
