# Azgaar city iframe — handoff, 2026-11-19

## State at stop

The compact city iframe is implemented and tested locally. No deployment, desktop release,
push or Azgaar PR was made. The user asked to stop after documenting and committing this work.
Generation performance was measured; the optimizations below have **not** been implemented.

Integration contract and upstream PR points: [AZGAAR_EMBED.md](AZGAAR_EMBED.md).
The local production preview used during validation is `http://127.0.0.1:5187/embed.html`.
Generated reports, screenshots and rebuilt WASM assets are local artifacts, not committed sources.
Other sessions have concurrent terrain/coast changes in this worktree; preserve them.

## Implemented

- Separate Vite `embed.html` entry, one Rust-generated city using the shared Minimal renderer.
  Inputs: Watabou-style query parameters or `#burg=` containing the existing `fmg-burg-v1`
  JSON payload. Full-editor link preserves the source inputs.
- Preview uses 128-cell terrain/region, no erosion or forests, no optional service or GPU probe.
  Its worker currently uses `threads=off` and terminates after generation.
- Six bounded, build-specific local PNG thumbnails; reopening the same input and viewport
  avoids generation. Cached images are drawn on canvas. They zoom as bitmaps; new generations
  retain vector detail.
- Strong parameter randomizer (`demo=1` inside an iframe); mouse/touch/keyboard pan and zoom,
  reset and controls. Randomization currently navigates to another URL, losing worker caches.
- Shared Minimal building outlines, earlier visibility and warmer landmark colors. The full V2
  uses the same renderer. `worldDecor.ts` extracts the existing shared terrain/decor adapter so
  the lightweight entry does not depend on the full 3D module.
- Fixed the empty Mongolian camp: requesting a monument used to reserve its only residential
  block. `quarters.rs` now reserves a monument precinct only with multiple residential blocks.
  Native regression covers housing capacity and drawable building requests.
- Upcoming Alpha 0.3.11 release notes include these user-visible changes; no version bump.

Azgaar currently disables pointer events on its iframe. The proposed provider must enable
`pointerEvents: auto` for Magna Urbis to receive navigation events. Endpoint publication and
the actual upstream provider PR are still pending.

## Performance measurements

Production artifact in a cross-origin sandboxed iframe, local HTTP, Edge headless. Values are
wall-clock seconds for first generation; they exclude public Internet transfer costs.

| Phase                      | Brackenford, 2,500 people | Longxi, 3,050 | Karak Ordu, 1,250 |
| -------------------------- | ------------------------: | ------------: | ----------------: |
| Startup                    |                      0.58 |          0.57 |              0.54 |
| Terrain                    |                      0.54 |          0.79 |              0.41 |
| Region                     |                      0.21 |          0.21 |              0.18 |
| City layout                |                      6.71 |          3.18 |              3.39 |
| Parcels                    |                      0.59 |          0.27 |              1.27 |
| Programme                  |                      0.12 |          0.06 |              0.04 |
| Building sites             |                      0.60 |          0.34 |              0.19 |
| Massing                    |                     0.007 |         0.004 |             0.004 |
| Land use, names, transport |                      0.46 |          0.49 |              0.29 |
| Receive and render         |                      0.24 |          0.14 |              0.08 |
| **Total**                  |                 **10.10** |      **6.08** |          **6.43** |
| Drawable buildings         |                     1,508 |           897 |               328 |

Layout takes roughly 52–68% of the total. It includes preliminary cadastral work, capacity
calibration and trimming/occupation checks, not just road drawing. CPU sampling on Brackenford
found these inclusive, **overlapping** groups (do not add them): cadastral generation inside
layout 2.43 s; trim 2.33 s; capacity calibration 1.79 s; polygon booleans 1.76 s; terrain/water
queries 1.31 s. Rendering and JSON handling are minor at these sizes (JSON about 20–100 ms).

Repeating with HTTP state retained but thumbnails and generation products cleared took
10.93 / 6.35 / 6.34 s respectively. Cached thumbnail reopen took about 0.09–0.12 s.
The shipped single-worker WASM was about 24 MB; Internet first download remains unmeasured.

Exploratory Brackenford worker-pool runs reported 8 workers and took 9.37 / 8.01 s versus
10.10 / 10.93 s without the pool. Only two samples per mode, order and system load matter:
this is not a reliable speedup estimate. `rust/bridge/urban.ts` keeps layout and parcel work
serial for a single city; building-site ranges can use helpers. A separate shared-memory
attempt timed out and yielded no qualified result; its unsupported harness branch was removed.

## Next optimization work

1. Inspect reuse of preparatory parcel/capacity results between layout probes, trim and final
   parcels. Existing `probe_cache::Scope` memoization already exists; measure misses/recomputation
   before changing it. Preserve capacity, access, water and terrain correctness.
2. Consider retaining a generation worker and avoiding reload on randomize. Capacity calibration
   has a process-local `OnceLock<Mutex<HashMap<...>>>` in `urban/footprint/capacity.rs`.
   Its key buckets culture/recipe/population/access, not seed/geography. Precomputing safe
   calibrations may also help. Current page reload + worker termination discard that cache.
3. Profile repeated polygon operations and identical terrain/water queries. `segment_dry`
   already has a uniform-segment shortcut and binned edge index; do not blindly add another index.
4. Qualify the non-shared worker pool separately with representative repeated measurements.
   More workers alone will not parallelize the dominant single-city layout phase.

No renderer rewrite is justified by these measurements.

## Validation already completed

- TypeScript no-emit check; 60 targeted embed, Minimal renderer and V2 parity tests passed.
- Production build and `web/scripts/v2_embed_check.mjs`: sandboxed cross-origin/subpath iframe,
  deterministic generation, resize, rich coastal payload, invalid payload, released worker,
  cold/cached navigation, randomizer, V2 shared Minimal render and four changelog sections.
- Native test `urban::small_settlement_tests::requested_monument_keeps_dwellings_in_a_single_block_camp`
  passed (test ~4.23 s). Its filtered test binary rebuild took ~5m42s.
- Single and shared WASM rebuilt sequentially, then Vite rebuilt. Targeted
  `web/scripts/v2_embed_nomad_check.mjs` verified the reported Karak Ordu URL produces 328
  drawable buildings; screenshot inspected.
- Profiling scripts executed against the served production artifact, with no new Rust build.
  Both profiling scripts passed `node --check`.

Do not confuse long Rust/WASM rebuilds with the 6–11 s generation latency above. Current sources
also contain other sessions' edits newer than the measured served build; coordinate before
rebuilding. Follow CLAUDE.md build coordination and CPU/GPU affinity requirements.

## Reproduction and artifacts

Run from `web/` against an existing production preview; endpoint override is
`MAGNA_EMBED_CHECK_URL`, browser channel override is `MAGNA_BROWSER_CHANNEL` (default `msedge`).

```sh
node scripts/v2_embed_check.mjs
node scripts/v2_embed_nomad_check.mjs
node scripts/v2_embed_profile.mjs --pool
node scripts/v2_embed_cpu_profile.mjs
```

Profilers use disposable browser contexts and instrument only those contexts; no production
profiling instrumentation was added. The worker bootstrap must queue messages until the module
has loaded and preserve `instanceof WebAssembly.Instance` when wrapping exports.

Local `web/out/city-embed/` contains `report.json`, `performance.json` (12 successful runs),
`layout.cpuprofile`, `layout-cpu-summary.json` and screenshots including `karak-ordu.png`.
The CPU summary was additionally analyzed by stack ancestry for the overlapping groups above;
the script emits its basic inclusive/exclusive summary, not those extra derived groups.
Chrome/Edge DevTools can load `layout.cpuprofile`. The measured table is retained here because
`web/out/` is ignored and not part of the commit.
