port-params2 DONE. Final report: web/out/fix-v7/port-params2/result.md.

Generated and inspected detachment.png (3x3) and detachment-ports.png. Same three 10k coast fixtures, d=0/0.5/1, shelter=.75. Unique candidate centres: Hanseatic 28, Swahili 28, Venetian 27; raw samples 32/33/30. Full candidate scores in summary.json and profile logs.

Invariant fixes: common global shore search including built shores; partial gentle berth runs; proximity/shelter blend normalized by population reach; real grade-checked bank access; d0 Swahili now east waterfront with working port buildings + moles; preserve final selected quay; dedicated landside port streets grow with detachment and serve storage buildings; port masks exclude unserved inland residue.

Default (1,0): exact match of centre, quarters, blocks, streets, enclosures, phases, programme and structure against BOTH saved baseline and previous port-params/default archives, all three fixtures.

Tests: cargo test -q -p magna-urbis-core --lib urban::macroplan (29 passed); --lib port (21 passed, 1 existing ignored); harbourOptions + cityCanvas vitest (6 passed); tsc --noEmit passed.

Production files: macroplan/harbour.rs + harbour_parameters.rs; port parts of roles.rs; roles_port5_tests.rs; one small quarters.rs hook passes original user stair permission to dock access. Render aliases only in web/src/render/{cityCanvas,cityGlStyle,buildingMaterials,groundBlend,cityRoles}.ts for port-stairs and labels.

No fortification.rs/composition.rs changes; no server restarted; no commit. Supervisor rebuild/reshoot remaining: Hanseatic, Swahili, Venetian at 10k coast, d=0/.5/1 shelter=.75, and unchanged default controls.
