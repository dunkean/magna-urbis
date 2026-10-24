# V12 retained tree-page replay

This explicit CPU replay replaces only candidate columns, family-page metadata and the backward-compatible candidate bounds. It does not generate/register Infinite Generation, recompile the physical world, retarget heights, migrate ground layers, or replace source archives.

The input is V12's retained `live-refinement.surfacebin`. `recoverRetainedPopulationSampler` requires the original population recipe and a stored parent reproducing the exact canonical terrain hash. The query then requests a complete 4 km tree page centered at (20000,20000), with small pages for other families. Candidate Y uses the existing fine field strictly inside its center support, otherwise the actual retained parent.

| Result | Value |
| --- | --- |
| Output bytes | 75,105,689 |
| Output SHA256 | `e9646f0aadfc2d69cac78e64977389201ff8ef87360ff2f52f72bc37cb079d2c` |
| Tree page | [18000,22000]², complete, includeOverhang, retention=1, limitedBy=none |
| Tree count / total candidates | 67,221 / 75,260 |
| Old records preserved exactly | All 1,059, including XYZ/Y, IDs, size, radius, yaw, rank and variant |
| Fine-supported / parent-supported records | 58 / 75,202 |

The original world, source, terrain parents, urban data, presentation and raw archives have identical independently encoded object hashes before/after hydration, replay and output decode. The original packet stays untouched. Repeating the final tool produced the same output SHA.

The fine terrain remains the original 64², 40 m query: center support [19980.3125,20019.6875]², delivered spacing .625 m and source native spacing .46875 m. Outside it, the saved parent has 78.125 m control spacing and its declared cubic B-spline reconstruction. A larger inventory does **not** make the whole 4 km a fine neural source. A 640 m A/B must use this same packet for baseline and asset rendering.

The output is retained diagnostic evidence, not a new live refinement or fresh source. The pre-existing 84.8 MB V12 canonical export already has a 4 km page and is another valid coarse-source control, but lacks this local neural child.

From `web`:

```powershell
node --import tsx scripts/replay_retained_candidate_pages.ts --source SAVED_V12_LIVE_PACKET --out NEW_DIRECTORY --x 20000 --z 20000 --width 4000
```

The tool refuses missing/hash-mismatched parents, changed population recipes, nonmatching old intersecting records, vacuous overlap, translated or cropped/unknown frames, and oversized packets. Its frame scope is deliberately bounded; the existing `refresh_surface_candidate_pages.ts` remains unchanged for its distinct frame-aware workflow.

The [compact replay report](evidence/tree-v12-retained-page-replay.json) records the original/output hashes, all unchanged object hashes and complete support/page metadata. Ignored working output is `web/out/surface/tree-optical-audit/v12-live-page4000/` in the independent audit worktree.
