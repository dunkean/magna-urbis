# Activation audit: native parent batch + session + roof support

AUDIT ONLY. No promotion is authorized or performed here. No build/test/native/server/browser execution. V4 is immutable and still awaiting root's current validation.

1. Exact union:20 paths (12 existing modified,8 new), all proposed bytes identical to frozen roofV4.
2. Fresh observed product bases match their original ancestors for all12 existing paths; all8 additions are absent. Three-way result is therefore the proposal, without dropping current changes.
3. main.rs base65290698... and houses-wasm/lib.rs base801ab0e2... already include the live Opus/current backend additions; no wrapper conflict exists at this audit timestamp.
4.969 other product files in rust/config/web/src are inventoried separately;21 literal dependencies are either in this allowlist or already byte-exact in product. No added fixture/cohort/driver/data is needed.
5. Product remains untouched. Before later promotion: recheck EACH base/absence, redo any drift as a fresh three-way merge, and preserve all protected files. This audit is a per-file observation, not an atomic lock on concurrent work.

Audit manifest SHA2562a5cf978232e09f16663577f999be076ac3e3ab40901aabdbd092b88c4d1676d. Source runtime freeze fab5189541c93ef3d2bc6ad2a4cbd73b19fa69ea30c757b167719a091d7c472e. proposed/ contains ONLY the20 allowlisted files; it is intentionally NOT a full compilable workspace. current-base/ preserves12 live files. proposed-20.patch is the complete product-relative diff. No Cargo manifest/lock/features/assets/config/Core source is proposed.

## Exact allowlist

| Product path | Operation |
|---|---|
| `rust/crates/houses-wasm/src/lib.rs` | modify |
| `rust/crates/houses/src/native_assembly.rs` | modify |
| `rust/crates/houses/src/native_assembly_builder.rs` | modify |
| `rust/crates/houses/src/native_assembly_std_transport.rs` | modify |
| `rust/crates/houses/src/native_candidate.rs` | modify |
| `rust/crates/houses/src/native_one_bend_access.rs` | modify |
| `rust/crates/houses/src/native_one_bend_access_tests.rs` | modify |
| `rust/crates/houses/src/native_parent_batch.rs` | add |
| `rust/crates/houses/src/native_parent_batch_tests.rs` | add |
| `rust/crates/houses/src/native_parent_context.rs` | add |
| `rust/crates/houses/src/native_parent_leaf_index.rs` | add |
| `rust/crates/houses/src/native_parent_prefix_scope.rs` | add |
| `rust/crates/houses/src/native_parent_session.rs` | add |
| `rust/crates/houses/src/native_parent_session_registry.rs` | add |
| `rust/crates/houses/src/native_parent_session_tests.rs` | add |
| `rust/crates/houses/src/plan_programme_outcome.rs` | modify |
| `rust/crates/houses/src/plans.rs` | modify |
| `rust/crates/houses/src/single_incumbent_growth.rs` | modify |
| `rust/crates/houses/src/single_need_continuation.rs` | modify |
| `rust/crates/local/src/main.rs` | modify |

## Activation map

- Native routing/archive: native_parent_batch.rs/context.rs and plans.rs expose tagged parent Single|Assembly plus lossless world-parent archive/unpack/realize; programme/outcome remains once per parent. native_candidate.rs and growth/continuation hooks consult common context. Legacy Single/pair APIs remain callable; no global serde feature or geometry policy change.
- Session runtime: session/registry/prefix_scope/leaf_index modules retain exact2D prefix and one bounded pending response, explicit durable ACK, idempotence and cleanup. Native cfg(test) barriers/index helpers are ordinary autonomous lifecycle tests, not external proof drivers; they stay test-only. No automatic city graph retention.
- Roof correction: assembly.rs/builder plus one_bend_access.rs supply actual incumbent roof support solely for the internal bend. Existing guards/query/budgets and original automatic-positive test are unchanged.
- Transport: scoped Std parser adds typed parent/session entry points; main.rs adds opt-in routes/capabilities and raw session replies; houses-wasm/lib.rs adds matching exports and real guest nonce/clock. Pair capability getter and existing pair/Std routes remain. Session replies do not pass through the historical Value response serializer.
- Tests: new parent batch/session tests and appended bend negatives use existing SMALL product fixtures or explicitly synthetic native geometry. Existing parent automatic-positive file is byte-exact to SessionV1. No diagnostic V3 recorder/test/output,22case dataset,103MiB data, compiled binary, guest JS/Wasm artifact or proof-only CLI is included.

Future root acceptance: first currentV4 unchanged automatic-positive plus3 internal_roof_support tests; then native parent/session/pair/full library. Priority public witness is REAL guest V4: begin -> synthetic HH100 native plan -> Assembly -> native parent archive -> both members exterior/interior -> durable ACK/release. SessionV1's existing17-call Single guest witness does not prove this new group path. Actual UI source/receiver session integration and cumulative prefix proof remain independently necessary; this audit claims no city gain or housed capacity.
