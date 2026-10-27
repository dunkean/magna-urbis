# Mapper corrections from V9 to V12

October 24, 2026. The [Opus V8 review](reviews/phase06-followup-v8.md) qualifies the technical prototype and declines artistic acceptance. This document describes the subsequent corrections and their V12 technical qualification. Isolated evidence remains distinct from the [complete fresh V12 campaign](evidence/NATIVE_V12.md); its technical success does not reverse the artistic refusal or earlier failures.

## Forest: a data page no longer bounds the visible forest

Live and offline producers now share pages by family: a complete tree inventory up to 4 km, and other objects in a small window. The radius is reduced when necessary to respect the 100,000-candidate budget, without describing a truncated selection as complete. Trees outside the small fine heightfield use the true parent; fields, seeds, IDs, ranks and acceptances remain canonical. See the [contract](CANDIDATE_PAGES.md).

The renderer requires the page, atlas and resident heights to cover the rays of the entire view and an envelope of loaded heights. Otherwise it uses the mesoscopic representation across the entire image. Two global phases separate the optical transition from mesh appearance: geometry appears only after the transition to exact optics. Old geometry is immediately removed if source or scene lineage changes.

The atlas is world-aligned and its mipmaps use a dyadic grid. Transmittance and coverage share the same filtering kernel. Spatial verification measures pans, not just an average over a canvas. The [retained evidence](evidence/canopy-v9/README.md) includes 9,175,040 samples with no pointwise V>C violation and a reprojection with a maximum deviation of two levels out of 255. In oblique views, the guard may retain meso across the entire view; it does not claim exact geometry where resident support does not cover the frustum.

## Water: explicit symbology before rasterization

The fixed map still uses Magna Urbis contours and levels. The source-map mapper profile now uses a 1.25 screen-pixel outline declared as a cartographic symbol. `--water-symbol-width-px 0` retains the mode without a widened outline. The physical source-levels mode uses no symbol.

Clipped source rings are retained in Float64 and drawn before the raster. The outline applies to polygon shores without inventing a centerline; the sea remains the union of original cells where no vector shoreline exists. Source geometry and symbol areas remain separate in diagnostics. Projection paints only the terrain, never roofs.

The [40 km GPU check](evidence/water-vector-symbols-v9-gpu.json) recovers the 863 shore samples missed by dilation of the first raster: all 182,735 checked samples are visible, and new pixels remain within the rendering band of the actual segments. No triangle, level or hydrological field is changed. This flat-receiver check does not prove flow, geographic topology or a new neural generation. See [parameters and budgets](WATER_SYMBOLS.md).

## City: natural ground persists under coarse occupations

Compiler 1.5.3 removes automatic treatment of Road, Yard and Built cells as paving material. Local ground remains under buildings; roads and buildings retain their own materials and vector footprints. Explicit crops, occupations and vegetation exclusions are preserved. The physical analysis version remains 1.5.2; material derivation and its identities change explicitly.

The [controlled migration of the 419 exteriors](evidence/urban-ground-v9-migration.json) changes only four support arrays on 4,712 infrastructure cells. All natural cells, physical fields, five low-cover arrays, legacy data, candidates, terrain, plans, architectural materials and source archives remain identical. The new page inventory is then an [explicit retained query](evidence/native419-pages-v9.json), without altering the world or inventing heights. Old packages and their evidence remain intact.

## Integrated qualification: V9 failure retained

Contract tests, CPU checks and isolated GPU probes pass. The [three V9 urban views](evidence/native-current-419-v9-render.json) were captured on clean snapshot `ab3c499`, without errors or missing water, with converged canopy and all 419 real native exteriors in the overview.

The [fresh V9 campaign](evidence/native-e2e-v9-negative.json) fails: no new source is actually displayed during the 20.004 seconds of motion. The preview is accepted at the end of motion and displayed afterward. Driver observations measure 13.928 s between neural return and compiled response, then 0.618 s until upload ACK for 9.35 MB; these are not isolated CPU Worker or network measurements. Subsequent native preparation takes another 3.7 s. The tour and probes are not run. The 560 runtime files and HEAD remain identical before and after; no criterion is relaxed.

The [next V10 campaign](evidence/native-e2e-v10-negative.json), on `f4d25e1`, also fails. The bit-exact population correction reduces the observed neural-return-to-compiled-response interval from 13.928 s to 1.223 s. The CPU gain is demonstrated separately by the direct Chromium Worker, not by this callback interval. [Independent verification](evidence/population-optimization-independent-v10.json) preserves outputs over 480 requests and the historical corpus. However, callback/ACK delays and a 10.55 s native freeze still prevent live display during motion. The actual overrun to 27.015 s, followed by final drain, does not satisfy the nominal 20 s criterion. The next blockage must be measured with separate clocks and subphases; observed ACK delays are not presented as a proven causal network cost.

The [V11 campaign](evidence/native-e2e-v11-negative.json) also fails: a preview arrives too late to display during the nominal 20 seconds. PAGE/Worker clocks and later traces distinguish computation, waiting and delivery; a Worker span does not become a CPU measurement. The off-CPU pauses observed in the scheduler diagnosis remain a limitation with no declared resolved cause. No historical gate is changed.

## V12 integrated qualification: complete technical criteria

The [readable evidence](evidence/NATIVE_V12.md) and [structured V12 report](evidence/native-e2e-v12.json) record a complete campaign on frozen clean runtime `bc6579f208ce1e4f05b471a1699de2ba05fae6b8`: fresh Infinite Generation source, strict nominal 20-second navigation, seven zoom captures and two five-frame probes at 10 km and 160 m. All 584 runtime hashes and the asset manifest are identical before and after; driver and supervisor exit zero. The option to retain visuals after a navigation failure is declared but **was not used**. Pre-freeze checks pass: **224 Surface tests / 42 files**, full typecheck and build of 445 modules.

Navigation applies **one distinct** new preview twice, delivered at 128² after a 128 request. Its native spacing is 30 m, LOD 0, `decoderUsed=false`; the first application occurs at 17.018 s. This streaming progress does not demonstrate newly learned neural detail during motion. The final support delivered at 133², at 0.468353 m per sample and **0.46875 m native / `decoderUsed=true`**, appears only during drain. Actual motion takes 20.118 s, its maximum input gap is 1.498 s and drain takes 17.207 s: passing the gate is not a low-latency promise. Environmental context remains at **78.125 m**; 4.88 mm per screen pixel in the 10 m view does not mean 4.88 mm source data.

At 160 m, alpha-positive instances in the CPU frustum are 64 trees, 64 trunks, 288 grasses, 17 shrubs, 61 debris and 31 rocks. The first two counts become zero without trees; grasses, shrubs and debris become zero without low cover, while all 31 rocks persist. Submitted allocations, fields and footprints remain identical between toggles of the same view. These are not GPU visibility counts after occlusion.

Water retains source contours and levels and an explicit 1.25-pixel shoreline symbol projected onto terrain only. Coverage and budget checks pass; conflicts between water levels and terrain remain diagnostics. Fresh/live source archives also pass full strict restoration. The [three retained views of the 419](evidence/native-city419-v12.json) are separate: 15.625 m parent / unknown LOD, unchanged source, existing native realizations, and no new neural city generation. They are byte-identical to V11/V9.

Crowns and small objects remain stylized representations: the 10 m view still shows a uniform proxy crown surface and blocky small vegetation. Forest shadows are optical; ground colors remain constrained by the canonical 78.125 m grid. Artistic parity across all styles, 60 FPS and final adoption of Godot are not established. The Opus review remains independent; V12 rewrites no V9–V11 verdict.
