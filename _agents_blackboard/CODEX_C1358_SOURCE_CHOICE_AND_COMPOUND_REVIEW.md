# C1358 — first-success source choice and missing Javanese compound grammar

Read-only production review plus a separate **test-only, unexecuted** proposal. Production, affine-early workspace, catalogue, source recipes and native guards were not edited. No Cargo/native/server/browser execution. Only the offline Python source/RNG reconstruction was run.

## Exact first-success path

Fixture: `web/out/b06-c1358-readonly-audit/fixture.json`, SHA256 `a5b266a8709c0bd64a953525f9b5a2745dc3a761857cdf1ec21e322034cd795b`. Index1358, parcel`ab85167603a15b09`; body target617.9m², Compound preference, floors[1,1], requested households3. Retained B06 body4.060225m² (0.6571% of target), with native entrance deferred. The physical room/wall minimum is allowed by inspired morphology;14m is a nominal source range, not a universal historical or physical minimum in that adapter.

The cultural query in `rust/crates/houses/src/plans.rs` uses `cultural_palettes::automatic_tradition`: `javanese-courts` /`AS-ISL` →`javanese`, preserving B06/B14/B15 and excluding Balinese B05. `candidate_styles_for_programme` gives all three Compound rank2 and floor rank0. None has a nominal area reaching90% of617.9, so the nominal preference does not reorder them. Exact seeded weighted ordering reconstructs **B15/default → B06/default → B14/default**. Reproduction: `python web/out/houses-b06-source-tail-workspace/analyse_sources.py`; output`source-analysis.json` preserves inputs/hashes/ranges/order. This is a source-code/RNG reconstruction, not a recovered runtime refusal journal. B15 was reached before B06, but its individual failure reason was not archived.

`plan_one_initial_pass` returns on the first admitted proxy, including `prefer_accepted_adapted_front` after constrained morphology. B06 therefore exits the source loop before B14. `plan_one_initial_sequence` sees`Ok` and does not run its legacy-dimension or missing-family passes. `plan_one` then calls `improve_domestic_budget_selection`, which unpacks **only that accepted B06 archive**, keeps its recipe/variant/seed and searches bounded dimensions/poses for that source. It never revisits B14. Its failure to improve the tiny incumbent therefore freezes the initial style decision. The final native-entry function preserves this admitted body when preparation fails; it did not create the undersizing.

## What the actual alternatives permit

| Source | Declared operator | Nominal W×D | Existing inspired resolver ceilings, size1 | Body-area ceiling before site |
|---|---|---|---|---:|
| B06 Joglo | Single/RECT,1body,1floor,Ground |14–22 ×14–22m |44 ×44m |1936m² axis-only; existing all-angle strip/aspect bound on C1358 reduces this to490.234m² |
| B14 Kampung | Single/RECT,1body,1floor,Ground |4.5–7.5 ×6–11m |15 ×22m |330m² |
| B15 Limasan | Single/RECT,1body,1floor,Ground |5–8 ×9–13m |16 ×26m |416m² |

The ±10% lower target is **556.11m²**. B14 and B15 cannot reach it even at their current resolver's doubled per-axis ceilings, before roofs, neighbours, access and restrictive Ground terrain. Those ceilings are model bounds, not feasible constructions or historical dimensions. Ordinary constrained morphology may reduce dimensions down to actual constructor minima; this does not increase those upper bounds. None of the three declares a Compound topology. A larger B14 admission could be a useful partial improvement over4m², but cannot close this programme or certify the requested3households. No B14 gain is claimed before root replay.

## Isolated bounded tail comparator

Workspace: `web/out/houses-b06-source-tail-workspace/rust`. `source-freeze.json` records200 production inputs (Houses, Random, workspace manifest/lock); only the copied workspace members are normalized. Exact original C1358 fixture is copied unchanged. Product sources are untouched.

The new cfg(test) opt-in `source_tail_choice` runs the **complete old pipeline including dimension search and final native entry first**. Its fully finalized result is the safety incumbent. It captures the original≤4-source palette at its existing draw and records actual resolver attempts, including same-source fallback. It does not infer attempts from a shortlist or redraw the palette/variants.

Only an undersized automatic inspired Single, without explicit controls, imposed footprint, native minimum contract or frontage/Row request enters the pilot. It fixes the **first untried tuple from the original palette**, at most one. C1358 selects B14; B15 and B06 are already attempted. No original request/config field is pinned or rewritten. The private candidate tuple enters the same ordinary initial source-pass code. No recursive `plan_one`, legacy pass, additional-family selection, terrain-recovery finish or second8-dimension/24-pose improvement budget is added.

For this covered non-frontage Single branch: **one added source pass**, at most **two resolver invocations** (principal and its existing same-source fallback), at most **five proxy admission calls** (three rigid +whole-envelope adaptation +hint adaptation), then at most **one existing-pose Single final-entry check**. Morphology retains its current80-candidate internal bounds per adapter call. These are source/admission function-call bounds, not counts of every internal geometric operation. The proposal instruments resolver phases and the physical admission function; the C test asserts≤2 tail resolutions,≤6 admission calls and≤1 candidate finalization.

The candidate must strictly reduce actual final body-union area error without worsening actual composition rank or floor distance. A certified old native entrance can never be replaced by an uncertified candidate. Refusal, unsupported source, absent untried source, equal/worse quality or lost old entrance returns the original finalized value exactly. Successful partial replacement reports target/actual/deficit and unknown housed-household capacity; it does not declare programme success from composition rank alone.

Five Rust tests are prepared **but not compiled/executed**: comparator safeguards; no-untried-source zero gain; already-attained baseline exact preservation; explicit/native-minimum guards; exact C1358 A/B with preceding same-batch occupation. The A/B report is written before assertions and assumes no gain. Root-only command:

```powershell
$env:HOUSES_SOURCE_TAIL_PROBE_OUT = (Join-Path (Resolve-Path web/out/houses-b06-source-tail-workspace).Path 'pilot.json')
cargo test --manifest-path web/out/houses-b06-source-tail-workspace/rust/Cargo.toml -p magna-urbis-houses --lib source_tail_ -- --nocapture
```

## The missing compound grammar is real, but not universal

The UGM description of **Omah UGM** distinguishes an open pendopo, dalem, connecting pringgitan, sentong and lateral gandhok in one specific maintained Kotagede property. It supplies topology/function evidence, not a universal household programme or numeric pavilion dimensions. [UGM Omah,2022](https://ugm.ac.id/id/berita/22154-pesona-bangunan-tradisional-jawa-di-omah-ugm/).

The UGM repository study of **16 abdi-dalem houses in Kemlayan** reports two compositions organized around pendopo/dalem and three gandok compositions affected by changing needs and surroundings. Its public catalogue dates the thesis2008; the abstract does not establish a2007 fieldwork date. These court-associated artistic-worker houses demonstrate variation, not an obligatory full palace composition for all commoner households. [UGM Kemlayan thesis abstract](https://etd.repository.ugm.ac.id/penelitian/detail/39963).

The coastal Dalem Kabupaten study concerns regents/nobility and relationships between administrative residence, civic centre and historical stylistic influences. It must not become the default morphology for this commoner`dwelling.tenement` request. [UGM coastal dalem thesis,2021](https://etd.repository.ugm.ac.id/penelitian/detail/204263).

UNESCO's pekarangan case describes cultivated land around a dwelling or shared commons, with ecological and productive functions. It supports preserving gardens/commons as meaningful programme components; it gives no footprint ratio or rule requiring several pavilions for every household. The original page was challenge-blocked, but the same UNESCO page's indexed content was readable. [UNESCO Javanese Pekarangan Homegarden System](https://ich.unesco.org/en/individual-case-study-00988?id=00004).

## Existing operators and a concrete next boundary

`layouts::build_layout` can create several bodies for authored Additive/Kancha/Shinden/etc. `morphology::supports_components` /`synthesize_components` can place a declared Additive Main+Adjacent programme, keeping per-component materials/roofs/floors/counts. This is **not** an assembler for arbitrary B06+B14+B15 recipe archives: `Component` has no independent recipe/variant/seed/archive identity, and the current three Javanese recipes each declare only`main`. It also cannot silently localize B06's global master-post details onto just one mixed-source component. Copying another culture's Kancha recipe would bypass the actual palette.

One composite `ResolvedArchitecture` yields one `CompactArchitecture`, one retained world transform/ground elevation and one entry contract. Current native foundation/entry preparation is explicitly narrow (one Single or Strip), and ordinary visual admission evaluates support/terrain over the assembly. Several bodies do not grant independent footing elevations or native doors. Simply concatenating bodies or repacking several archives as one house would lose source/access contracts.

The available conservative building block is **several ordinary native requests through `plan_batch`**, retaining separate PlanBuilding archives, transforms,`ground_z_m` and final native entries. Its shared OccupationIndex already excludes accepted body/court/circulation/feature surfaces from subsequent members. It has **no parent global footprint-budget/composition contract** and no shared-circulation ownership permission. Current occupancy includes connectors: removing them to make a shared path pass would relax a real guard.

A concrete next pilot is a **site-owned assembly coordinator**, with a small fixed work cap (e.g. two members as an engineering cap, not a cultural norm):

1. Core selects a documented/status-appropriate programme and asks whether C1358's617.9m² demand is itself appropriate. Its label and3requested households do not mandate a complete noble dalem or three pavilions.
2. Supply explicit member domains, shared court/garden reserve, source palette and per-member body targets whose total allocates the parent target **once**. Retain different B06/B14/B15 native identities; do not stretch a Single or turn catalogue `platform` into Posts/Ground support freedom. The present B06 is walled; its`open_sides` detail does not by itself authorize an open pendopo envelope.
3. Validate an actual shared access graph from the outer public frontage to each collective branch: geometric continuity, dry/terrain-traversable route, permitted ownership, clear width and grade. A branch becomes a valid collective access only from this proof, not by renaming a segment. Individual admissions end at their own branch endpoints; shared circulation remains separately owned and validated.
4. Plan members in deterministic order in a scratch OccupationIndex, preserving each member's current roof, terrain and native entry guards and distinct support elevation. A physical common enclosure/gate must have one declared native/site contract; a cadastral boundary alone is not a certified wall or gate.
5. Retain each exact archive and aggregate **final union body area** with target/deficit/excess, mandatory-member and access statuses. Keep housed households unknown. Commit a replacement only under an explicit group policy; if the required group fails, retain the old admitted house rather than silently deleting it or presenting a partial group as complete.

This needs a narrow site/access/budget coordinator and a declared cultural programme; no existing operator already supplies the entire mixed-source, per-pavilion-ground, native-door and global-budget contract. A successful B14 tail comparison is therefore an incremental deficit reduction, not the compound solution.
