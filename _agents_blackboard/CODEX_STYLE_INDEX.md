# Source-driven house style index

Owned files: `rust/crates/houses/src/style_index.rs`, `rust/bridge/buildingStyles.ts`,
`rust/crates/houses/examples/style_index_bench.rs`.

The index contains one stable `recipe_id::variant_id` per coherent atlas bundle.
It is constructed once and borrows the cached catalogue; candidate lookup does
not clone parameters. `StyleIndex::find(&StyleQuery)` intersects exact facet
posting lists, and `StyleEntry::recipe()` / `parameters()` return borrowed data.

Selection facets include pack, era, role, profile (explicit typology), layout,
morphology, actual footprint/roof families, principal materials, source path,
confidence and settlement archetype. Source ranges and component optionality
remain explicit. Native details are kept out of the index payload.

The city-facing `typology` facet uses the existing placement Layout mapping
(`row`, `courtyard`, `compound`, `detached`; `common` applies no filter).
`candidate_recipes(query, seed, limit)` returns weighted attempts without
replacement, with one atlas weight per recipe regardless of variant count.
It returns recipes that have at least one matching bundle; callers realizing
only defaults must set `include_variants: false`.
`candidate_styles(query, seed, limit)` also chooses one coherent matching variant
per recipe using an independent seeded stream. Pin the returned `variant_id` in
the native resolver. An explicit `query.variant_id` stays binding. Geometry and
other HouseConfig overrides still undergo native validation.

Default queries select the atlas automatic residential palette, all variants,
`historical_inspired`, era `any`, and exclude late-only profiles. Explicit recipe
selection can reach zero-weight/nonresidential entries. Strict chronology still
applies. Callers should retain a candidate list per shared selection query rather
than repeat its allocation for every building.

All 145 existing functional mappings have `status: planned`. They remain visible
with that status, and are not promoted into implemented mill/forge/etc. programs.
Function selection currently uses the actual `Role` enum; typology uses `profile`.
Constrained-composition eligibility delegates to the implemented morphology
operator. Arbitrary imposed-polygon decomposition is explicitly unsupported.
Bounded orthogonal imposed-footprint support is separately advertised through
the operator's `supports_imposed` predicate, subject to its access/topology and
minimum-dimension checks.

Root agent owns module/API integration; morphology agent provides
`morphology::supports(&Parameters)`. The TS contract passes isolated strict tsc.
All 8 Rust index tests pass, including coherent candidate selection and bounded
imposed-footprint capability verification. Command:
`cargo test -p magna-urbis-houses style_index --lib -- --nocapture`.

## Selection benchmark, 2026-10-22

`cargo run -p magna-urbis-houses --example style_index_bench` (existing optimized
dev profile, opt-level 2). Four packs: EUR-MED, AF-EAST, MED-ANT, AS-CHI. Automatic
residential query, all coherent variants, four weighted distinct recipe attempts
per seed. This measures selection only, not plan generation or rendering.

- Index: 415 entries; first load/index construction 10.800 ms.
- 1,000 queries / 4,000 selected bundles: 2.603 ms.
- 10,000 queries / 40,000 selected bundles: 26.726 ms.
- 100,000 queries / 400,000 selected bundles: 271.236 ms (2.712 us/query).

Checksums are printed by the executable for reproducibility. No additional
selection cache is justified by this measurement; callers can still retain
borrowed `.find()` results when a query is shared by many houses.
# Explicit configuration prefilter — 2026-10-22

`candidate_styles_for_config(query, config, seed, limit)` now filters coherent
source bundles **before** the weighted recipe ordering and attempt limit.
It reuses the native catalogue's `validate_config` and
`resolve_variant_parameters`, covering explicit era, size, variant, materials,
roof/footprint and numeric overrides. The source-only compound constraints from
`engine::resolve_draws` are checked before selection as well: the main residential
component's floor range and the sum of residential component count ranges.
An aggregate parent range that includes a tower does not authorize extra floors
in the main dwelling. Omitted overrides remain unconstrained.

Explicit recipe/variant pins are intersected, never replaced. Empty compatible
sets return an error with a bounded set of native rejection reasons. No geometry,
site, roof or access rule is relaxed; successful parameter compatibility remains
only a candidate for subsequent native admission. Existing unfiltered index APIs
remain available for catalogue browsing.

Morphology owns the corresponding `plans.rs` call change. One focused test passed:
`explicit_floors_filter_before_the_four_style_budget_without_replacing_pins`.
It verifies four distinct eligible recipes for a three-floor request, exclusion of
EUR-MED-B01 and the EUR-MED-B07 main-house constraint, unchanged availability when
floors are omitted, preservation/refusal of explicit pins and native size bounds.
The running :8794 service was not rebuilt or restarted for this change. A city
acceptance-rate claim requires the coordinated combined native replay.

