# River synthesis on heightmaps: state of the art and development plan

[Français](synthese_rivieres_heightmap_FR.md)

> **Purpose:** situate Magna Urbis's hydrological pipelines (Rust `rust/crates/core`, TypeScript `web/src/gen/terrain`, neural bench `web/src/ui/riverVectors.ts`) against the literature, and define improvements to implement.
>
> **Date:** 2026-10-12. Baseline before implementation: tag `rivers-neural-best-2026-10-12`. Implementation: section 6.

## 1. Summary

- The extensive literature comes from two communities: **geomorphology / numerical hydrology** (DEMs, GIS, landscape evolution) and **computer graphics** (procedural generation, terrain editing).
- Our extraction components (priority-flood, flats, breaching, D∞, implicit stream power, meander migration) correspond to established methods. Grid hydraulic erosion, common in games (droplets or *pipe model*), does not produce a river network and would be a step backward.
- The weak point is not the river algorithm but the **input**: terrain, especially neural terrain, that is not hydrologically consistent. Accumulated downstream corrections in `riverVectors.ts` (depression-floor crossings, shallows, `uncross`, `despike`, `unfold`) address symptoms.

## 2. Inventory of our pipelines

| Component | Implementation | Reference |
|---|---|---|
| Depression filling | priority-flood (`hydrology.rs`, `erosion.ts`, `simpleHydrology.ts`) | Barnes, Lehman & Mulla 2014 |
| Flats | `hydrology_flats.rs` (symmetric metric costs) | Barnes, Lehman & Mulla 2014b |
| Breaching | bounded to 12 m / 1 km (`hydrology_depressions.rs`) | Lindsay 2016 (least-cost breach) |
| Flow routing | D8; D∞ in erosion | O'Callaghan & Mark 1984; Tarboton 1997 |
| Terrain evolution | implicit stream power + thermal relaxation (`erosion.rs`, `erosion.ts`) | Braun & Willett 2013 |
| Fine tracing | active contour in the thalweg (`riverVectors.ts`) | Kass, Witkin & Terzopoulos 1988 |
| Meanders | Howard & Knutson in the style of meanderpy, cutoffs, oxbows | Howard & Knutson 1984; Sylvester et al. 2019 |
| Width, sinuosity | W ∝ A^0.45, wavelength ≈ 11 W, sinuosity decreases with slope | Leopold & Wolman 1957/1960; Schumm 1963 |
| Lakes | spill basins retained whole, heuristic selection (`hydrology_lakes.rs`) | — |
| Estuaries | drowned channels, no delta (`estuary.ts`) | — |

## 3. Major method families

### 3.1 Terrain first, rivers afterward (our approach)

The network is extracted from an existing DEM. This is GIS tooling: RichDEM (Barnes), WhiteboxTools (Lindsay), TauDEM (Tarboton). Known difficulties are exactly ours: spurious depressions, flats and D8 artifacts at 0°/45°.

### 3.2 Rivers first, terrain afterward

Build the drainage network as a graph, then terrain consistent with it by construction.

- Kelley, Malin & Nielson 1988, *Terrain simulation using a model of stream erosion*.
- Derzapf, Ganster, Guthe & Klein 2011, *River networks for instant procedural planets*.
- **Génevaux, Galin, Guérin, Peytavie & Benes 2013**, *Terrain generation using procedural models based on hydrology* (SIGGRAPH). Channel type is chosen by slope and network position (Rosgen classes: straight, meandering, braided, etc.), and terrain is assembled from primitives along the graph.

### 3.3 Terrain–river coevolution

Tectonic uplift competes with river incision (the *stream-power* law): rivers and terrain emerge together, consistent by construction.

- Braun & Willett 2013, O(n) implicit solver (already in `erosion.rs`).
- Cordonnier, Braun, Cani, Benes, Galin, Peytavie & Guérin 2016, *Large scale terrain generation from tectonic uplift and fluvial erosion*.
- Cordonnier, Bovy & Braun 2019, *A versatile, linear complexity algorithm for flow routing in topographies with depressions* (ESurf): routing through depressions using a basin spanning tree, an alternative to filling.
- Schott, Paris, Fournier, Guérin & Galin 2023, *Large-scale terrain authoring through interactive erosion simulation* (TOG).
- **Tzathas, Gailleton, Steer & Cordonnier 2024**, *Physically-based analytical erosion for fast terrain generation* (Eurographics): analytical stream-power solution, with time as a slider.

### 3.4 Drainage-guided neural networks

- Hu et al. 2024, *Terrain Diffusion Network: climatic-aware terrain generation with geological sketch guidance* (AAAI): sketches with rivers, ridges and basins.
- *Earthbender* (Bremen, MIG 2025): sketch → terrain via guided diffusion, including rivers.
- *Authoring Terrestrial Planets with Diffusion Models* (CGF): global network extracted from the sketch and passed as conditioning.
- Goslin 2025, *Terrain Diffusion* (arXiv 2512.08309): the model we use, without hydrological constraint.

No published model **guarantees** drainage consistency: hydrological post-processing is required.

### 3.5 Meanders and beds

- **Paris, Guérin, Collon & Galin 2023**, *Authoring and simulating meandering rivers* (TOG / SIGGRAPH Asia): published vector version of what `riverVectors.ts` does. Curvature-driven migration, cutoffs and oxbows, **avulsions**, path constraints and a **terrain influence term** in the migration equation; validation by sinuosity and wavelength.
- Peytavie, Dupont, Guérin, Cortial, Benes, Gain & Galin 2019, *Procedural Riverscapes* (CGF): channel carving, water surface, waterfalls and rapids.
- Ikeda, Parker & Sawai 1981; Howard & Knutson 1984; Sylvester, Durkin & Covault 2019 (meanderpy).

### 3.6 Lakes and water balance

- **Barnes, Callaghan & Wickert 2021**, *Computing water flow through complex landscapes – Part 3: Fill–Spill–Merge* (ESurf 9, 105–121). Runoff fills each depression; a full depression spills to its neighbor and two full neighbors merge. A depression becomes a lake only if the water balance suffices: endorheic lakes, salt lakes and dry basins emerge naturally. Open-source code (RichDEM, `r.richdem.fsm`).

### 3.7 Validation laws

| Law | Form | Use |
|---|---|---|
| Hack 1957 | L ∝ A^0.6 | main channel length |
| Horton–Strahler | bifurcation ratios ≈ 3–5 | network hierarchy |
| Flint 1974 | S ∝ A^-θ, θ ≈ 0.45 | longitudinal profiles |
| Leopold & Wolman 1957 | braided if S > 0.012 Q^-0.44 | channel style |
| Leopold & Wolman 1960 | λ ≈ 10–14 W | meander wavelength |
| Seybold, Rothman & Kirchner 2017 | confluence angle ≈ 72° humid, ≈ 45° arid | climate-dependent confluence geometry |

### 3.8 What would not be better

- Grid hydraulic erosion (Mei, Decaudin & Hu 2007; droplets): plausible gullies, not a hierarchical network.
- *Optimal channel networks* (Rinaldo, Rodríguez-Iturbe): good statistics but ignore existing terrain.

## 4. Diagnosis

1. **Inconsistent neural terrain.** Raw Terrain Diffusion relief contains 100–260 m depressions with drowned hills; filled D8 crossed them in straight lines. `riverVectors.ts` corrections work around the problem rather than solving it.
2. **Heuristic lakes.** Selection of retained basins does not depend on a water balance.
3. **Only two channel styles** (straight, meandering): no braiding, anastomosis or incised meanders.
4. **Hard meander constraint** (never above water level, otherwise return to thalweg) instead of continuous terrain influence; no avulsion.
5. **Two hydrologies and two benches**: the best pipeline (neural bench) is unavailable to procedural terrain, and vice versa.
6. **Mostly visual validation**: the laws in section 3.7 are not measured.

## 5. Development plan

In priority order, all stages remaining optional in the bench.

1. **“Pre-hydric” terrain conditioning** before extraction:
   - a few low-resolution implicit stream-power iterations with weak uplift, applied to neural or procedural terrain: false depressions are incised at their sills instead of filled;
   - alternative: least-cost breaching (Lindsay) with broad bounds, then fill the remainder.
2. **Water-balance lakes** (Fill–Spill–Merge): climate-derived P−E runoff, each lake's level, endorheic basins and dry depressions.
3. **Channel style by slope and discharge**: Leopold & Wolman threshold for braiding, anastomosis on very flat plains, incised meanders in sinuous valleys.
4. **Continuous terrain influence on migration** (Paris et al. 2023) instead of the hard constraint; avulsions.
5. **Unified bench**: terrain bench with generator choice (procedural Rust ± erosion, neural), neural bench vector hydrology by default, old Rust hydrology as an option; neural terrain cropped or scaled and refined on zoom.
6. **Measurements**: Hack, Horton, Flint, wavelength and confluence angles, calculated in verification scripts.
7. Later: deltas (procedural bifurcation tree, without going as far as DeltaRCM).

## 6. Implementation (2026-10-12)

The neural bench is merged into Terrain Bench (`terrainbench.html`; `neuralbench.html` redirects while retaining old-link settings). Everything is optional and shareable by link.

| Plan item | Where | Status |
|---|---|---|
| Terrain choice | Relief stage: procedural source (± Rust erosion) or neural | done |
| Neural terrain on the map | *crop* extent (map-sized window shifted toward coasts) or *scale* (± slopes retained) | done |
| Neural families | family-specific local relief in Auto mode: plain 20 m, hill 110 m, plateau 100 m (measured on seeds 42, 7, 1234) | done |
| Zoom pixelation | regional resampling by Rust engine + optional fractal refinement below source spacing (Hurst 0.8, amplitude ∝ slope) | done |
| Neural network settings | “Neural networks” (elevation ×, spacing, noise, local relief, histogram, decoder detail) and “Detailed climate” | done |
| 1 · Pre-hydric conditioning | `web/src/ui/reliefConditioning.ts`: implicit stream power at 512² (base level = water surface) + full-resolution sill opening; adjustable strength, depth and length; “Pre-hydric conditioning” diagnostic | done, for both engines |
| 2 · Water-balance lakes | `waterBalance.ts`: Turc–Pike, priority-flood routing depressions, fill/spill passes, closed lakes at e·A = Q; undrawable micro-depressions filled first | done |
| 3 · Channel styles | `riverVectors.ts`: braiding (Leopold & Wolman threshold, unconfined valley), anastomosis (flat humid plains), incised meanders via thalweg | done |
| 4 · Terrain influence, avulsions | migration slowed by bank height above water; avulsions leave old channels | done |
| Confluence angles | redraw tributary approach at 45–72° according to aridity | done |
| 5 · Unified bench | *Vector* hydrology engine (default) or *Rust (legacy)*; diagnostics for both pipelines; Terrain Bench renderings | done |
| 6 · Measurements | `riverMetrics.ts`, “Measurements” panel: Hack, Flint, Horton, wavelength, sinuosity, confluences | done |
| 7 · Deltas | distributaries following the lowest path to the sea from an apex where water-surface slope falls below 1.5 m/km | done, rare on current terrain |

Measurements on neural *hill* terrain, seed 42, 40 km, temperate climate:

| Law | Without conditioning | With (default) | Real |
|---|---|---|---|
| Hack h | 0.53 | 0.54 | 0.5–0.6 |
| Horton R_b | 4.4 | 3.9 | 3–5 |
| Flint θ | 0.10 | 0.24 | 0.35–0.6 |
| Confluences | 52° | 62° (target 71°) | 45–72° |
| Depressions > 1 m (1024² grid) | 1,003 (4,570 hm³) | 504 (164 hm³) | — |
| Lakes drawn | 112 (122 km²) | 26 (53 km²) | — |

Findings: raw neural terrain has longitudinal profiles that are too weakly concave (θ ≈ 0.1). Conditioning makes them more concave without reaching real values: only longer terrain evolution would achieve that. Deltas require a low coastal plain that neither the neural sketch (tanh coast) nor procedural terrain yet produces. Without GPU, full computation takes 10–25 s for a 1024² grid.

## 7. References

- Barnes, Lehman & Mulla 2014, *Priority-flood: an optimal depression-filling and watershed-labeling algorithm*, Computers & Geosciences 62.
- Barnes, Lehman & Mulla 2014, *An efficient assignment of drainage direction over flat surfaces in raster digital elevation models*, Computers & Geosciences 62.
- [Barnes, Callaghan & Wickert 2021, Fill–Spill–Merge](https://esurf.copernicus.org/articles/9/105/2021/), Earth Surface Dynamics 9 · [GRASS r.richdem.fsm](https://grass.osgeo.org/grass85/manuals/addons/r.richdem.fsm.html).
- Braun & Willett 2013, *A very efficient O(n), implicit and parallel method to solve the stream power equation*, Geomorphology 180–181.
- Cordonnier, Bovy & Braun 2019, *A versatile, linear complexity algorithm for flow routing in topographies with depressions*, Earth Surface Dynamics 7.
- Cordonnier et al. 2016, *Large scale terrain generation from tectonic uplift and fluvial erosion*, Computer Graphics Forum 35(2).
- [Génevaux et al. 2013, Terrain generation using procedural models based on hydrology](https://hal.archives-ouvertes.fr/hal-01339224) · [PDF](https://www.cs.purdue.edu/homes/bbenes/papers/Genevaux13ToG.pdf).
- Howard & Knutson 1984, *Sufficient conditions for river meandering: a simulation approach*, Water Resources Research 20.
- Kelley, Malin & Nielson 1988, *Terrain simulation using a model of stream erosion*, SIGGRAPH.
- Leopold & Wolman 1957, *River channel patterns: braided, meandering and straight*, USGS PP 282-B.
- Lindsay 2016, *Efficient hybrid breaching-filling sink removal methods for flow path enforcement in digital elevation models*, Hydrological Processes 30.
- [Paris, Guérin, Collon & Galin 2023, Authoring and simulating meandering rivers](https://hal.univ-lorraine.fr/hal-04227965v1), ACM TOG 42(6).
- [Peytavie et al. 2019, Procedural riverscapes](https://diglib.eg.org/handle/10.1111/cgf13814), Computer Graphics Forum 38(7).
- Schott et al. 2023, *Large-scale terrain authoring through interactive erosion simulation*, ACM TOG.
- Seybold, Rothman & Kirchner 2017, *Climate's watermark in the geometry of stream networks*, Nature Geoscience 10.
- Sylvester, Durkin & Covault 2019, *High curvatures drive river meandering*, Geology 47 (meanderpy).
- Tarboton 1997, *A new method for the determination of flow directions and upslope areas in grid digital elevation models*, Water Resources Research 33.
- [Tzathas, Gailleton, Steer & Cordonnier 2024, Physically-based analytical erosion for fast terrain generation](https://diglib.eg.org/handle/10.1111/cgf15033), Computer Graphics Forum 43(2).
- [Hu et al. 2024, Terrain Diffusion Network](https://ojs.aaai.org/index.php/AAAI/article/view/29150), AAAI.
- [Earthbender, MIG 2025](https://cgvr.cs.uni-bremen.de/papers/mig2025/earthbender-paper.pdf).
- [Authoring Terrestrial Planets with Diffusion Models](https://diglib.eg.org/handle/10.1111/cgf70390), Computer Graphics Forum.
- [Goslin 2025, Terrain Diffusion](https://arxiv.org/abs/2512.08309), arXiv.
