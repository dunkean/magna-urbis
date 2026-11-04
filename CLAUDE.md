# Magna Urbis — working rules

## Development stage
- The project is in development, with about 9 users. Speed comes first.
- No compatibility, continuity or uptime constraints: saved projects, recipes, URLs, seeds and APIs may break; services may be restarted at any time.
- Do not add migrations, legacy aliases or fallbacks just to preserve old behaviour; change things directly, across repositories if needed (e.g. ../infinite_map).
- The V2 stays local (never deployed to github.io).

## Rust builds: shared, batched, few
Several Claude/Codex sessions and their agents work on this tree at the same time. Parallel builds waste hours and millions of tokens.

**Workflow for every session and agent:** everyone codes first, then the supervisor builds once, tests once, and publishes.
1. Agents write all their code and stop. Agents do not compile, except for a quick `cargo check` on their own change when it is really needed.
2. When every agent has finished, the supervising session compiles once and tests once.
3. Fixes go back to the agents as a new batch. Shots and publishing come after a green build.
4. Do not insist: if a build or a render lasts 30 min, stop it, think, and report instead of retrying.

- **One target dir.** Build in `rust/target`. Never use a private `CARGO_TARGET_DIR` per agent: each one rebuilds the whole `magna-urbis-core` crate.
- **Batch your Rust edits.** Make all edits, then run one build and one test run. Do not iterate edit → build → probe on every small change. Validate logic in unit tests of the touched module first (`cargo test -p magna-urbis-core --lib <module>::`), and run the full `urban::` suite once at the end.
- **Build in turns.** Before a build, check whether another `cargo`/`rustc` is already running (`Get-Process cargo,rustc`). If so, wait for it to finish rather than starting a competing build. Run at most 2 Rust-building agents at a time per session.
- **Compute budget.** Builds use cores 3–23 (affinity `0xFFFFF8`, `-j 21`, via `rust/scripts/cargo-sync.ps1`/`.sh`). Shot runs use cores 9–23 (`0xFFFE00`) and the RTX 5090 only (`VK_LOADER_DEVICE_ID_FILTER=0x2b85`), with at most 3 pages. Pause shot passes while Rust agents build.
- **Engine.** One engine on :8791 (`web/out/engine`). Only the supervising session rebuilds and redeploys it, by PID and in one batch after the agents are done. Agents never restart it.
- **Crate layout.** `magna-urbis-terrain` (terrain, erosion, hydrology, noise; leaf crate, opt 3) <- `magna-urbis-core` (facade that re-exports terrain, plus resources, settlements, urban; opt 1). `urban` is one strongly connected block of ~67k lines (parcels, culture, composition, footprint, kinds, network, fortification, programme, roles, quarters, macroplan, building_sites, edits...), so it is not split further: see `web/out/fix-v7/round11/split/plan.md`. Test a terrain module with `-p magna-urbis-terrain --lib <module>::`, an urban/settlements/resources module with `-p magna-urbis-core --lib urban::<module>::`.
- **Dev profile = fast rebuilds.** `dev` is opt-level 1, `debug = line-tables-only`, incremental, 256 codegen units; third-party deps and the terrain crate stay at opt 3 (compiled once); `houses` stays at opt 2 for its slow test suites and never rebuilds on an urban edit. Edit one urban file then `cargo-sync build -p magna-urbis-local` takes ~9 s (binary in `rust/target/debug/`); the same edit rebuilds `cargo test --lib` in ~11 s, about 2 min after a batch of edits across modules. The whole `-p magna-urbis-core --lib` suite then runs in ~6 min. Use the default dev profile for iteration; `release`/`wasm-release` remain for deploy; the `fast` profile (release-like, slower to build) is only for timing-sensitive benches.
- **Time-box agents.** Give each agent about 45 min. When the time is up, it finishes with what it has, or reverts to a clean state and reports the root cause.
