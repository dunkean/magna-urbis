site-opts — three default-off City Bench toggles in the existing Options Reddit (27/10) group.

- powerHighGround: major worship and hill-sited power landmarks use summit scoring without changing needs/admission; hilltop/spur nuclei use usable summit ground with an existing grade-limited road approach. Already-served summits need no duplicate road.
- mergeParallelStreets: merge sustained partial runs whose free strip is below MIN_LAND (4 m), preserve tails/junctions and road grades, keep height-separated roads, curtains and protected crossings.
- regularGridOutline: auto gridded footprints become rectangles with dry-land clipping; explicit forms retain priority. Every component's macro grid receives the same footprint angle, including isolated sites with no regional road.

Own implementation: rust/crates/core/src/urban/footprint.rs, network_site_options.rs, site_options_tests.rs; web/tests/urban.siteOptions.test.ts.
Self-contained shared hooks: urban/mod.rs (fields/tests), roles.rs (service siting/scorer), network.rs (optional terrain guards), quarters.rs and access.rs (cleanup calls), composition.rs and macroplan.rs (optional grid angle). Config/transport/UI: rust/bridge/urbanConfig.ts, rust/bridge/urban.ts, web/src/ui/terrainUrban.ts.

Verification: 8 native site_options tests pass, including the final grid-angle hook/rotated isolated-grid assertion (fresh shared test binary compiled at 01:17:58, run directly at 01:19; original focused cargo run also 8/8). The redundant queued cargo rerun was cancelled by its own PID after this final pass. Web: 14 tests pass (urban.siteOptions + urbanRust.bridge); npx tsc --noEmit passes. Full modern config with all options on encoded to MU1 and decoded with node scripts/city_situation.mjs; saved code/JSON in web/out/site-opts/.

ON/OFF SVG and rendered PNG evidence: web/out/site-opts/{bastide-500,bastide-10000,hill,parallel,power}-{off,on}.* and terraces-on.*. Visually inspected. Cathedral reservation x=450→850 m; keep x=850→750 m; requested areas/counts unchanged. The hill route passes the 12% grade check. Disabled street/config paths compare byte-for-byte with the legacy pass.

Reshoot after the supervisor's shared engine rebuild: bastide 500 (temperate-valley) and 10k (Atlantic coast), European-organic 10k hilltop/spur on city-04-mountain-bay-s; compare each option on/off. Engine :8791 and Vite :5173 untouched. Sheltered harbour remains outside this slice. No commit.
