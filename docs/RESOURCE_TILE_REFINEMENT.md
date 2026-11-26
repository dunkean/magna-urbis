# Resources: Tile Refinement and Consumption by Cities

Date: 26 October 2026. Short note, companion to `docs/RESOURCE_LAYERS.md` in the Neural Earth repository (branch `resources-layers`). Status: **proposed**; no code in this repository is modified.

## 1. Place of this repository in the chain

Neural Earth is the only multi-scale system, from the planet down to the centimetre. Resource authority is computed at LOD 10 (30.72 km) from Orogen. Deposit positions and surface budgets are distributed at LOD 3 (240 m). The 40 km tile at 30 m (LOD 0) only distributes what LOD 3 has committed.

`godot-render/tools/surface_context.py`, `ground_surface.py` and the texture selection constitute this LOD 0 processing, hosted here provisionally and intended to migrate into Neural Earth. Magna Urbis remains the city module: it **consumes** local resources and does not recompute them.

## 2. Findings on `geology()`

`geology(n, width, seed, scenario)` produces five continuous fractions: granite, limestone, sandstone, argillo-marl, basalt. They have folded strata, intrusions and flows, at scales from 70 m to 8 km. However, the function has three defects for the chain:

1. **Fixed proportions.** The phase bands (0.20 / 0.56 / 0.86) and the intrusion thresholds are the same everywhere. A craton tile and an arc tile have the same geology.
2. **Tile-local randomness.** `default_rng(sha256(seed))` fills noise grids sized to the tile. This noise cannot be evaluated at a point in the world, and two neighbouring tiles do not join up.
3. **No link to the world.** The tile seed is not a coordinate.

## 3. Migration to refinement of the parent

1. **Georeference the tile on the LOD 0 grid**:
   - origin `(i0, j0)` in exact 30 m cells, instead of 29.985 m today;
   - width extended from 1,334 to 1,336 cells, i.e. 167 complete blocks of 240 m;
   - the tile refines only complete blocks; cells outside the display footprint serve as a halo.
2. **Replace the noise with addressed noise**:
   - `value_noise(seed, "geology-<scale>", LOD, x, y)` from Neural Earth (`terrain_resources.value_noise`), which uses the Chronos key;
   - same physical scales (8,000 m → LOD 8, …, 70 m → LOD 1);
   - the value at a point no longer depends on the tile: no more seams and no more random state.
3. **Condition the proportions on the parent**:
   - Neural Earth provides, for each 240 m block, the fractions of the 8 rock classes, interpolated from LOD 10.
   - `geology()` keeps its structure (folds, contacts, intrusions, flows). It computes per-block factors `α_k` so that the mean of the fine fractions within the block equals the target: `w'_k = w_k·α_k / Σ_j w_j·α_j`, in 3 to 5 proportional adjustment iterations.
   - The `α` values are interpolated between block centres to avoid visible steps. The residual per-block mean deviation is to be measured; proposed target: less than 0.02. It is accepted, because a rock fraction is an intensity, not a conserved budget.
   - Extensive quantities remain exact (§4).
4. **Classes**: move from 5 to 8 classes (metamorphic, ultramafic, evaporites), or failing that, project the 8 classes onto 5:
   - metamorphic → granite 0.5 / argillo-marl 0.3 / sandstone 0.2;
   - ultramafic → basalt;
   - evaporites → argillo-marl, with an O1 flag that preserves the information for textures.
5. **Deposits impose their host rock.** Within the footprint of a deposit, the host-rock fraction is raised to a minimum: granite cupola for Sn-W, limestone for Mississippi-type Pb-Zn, basalt for massive sulphides. The parent fact takes precedence over fine noise, never the reverse.

## 4. Budgets and objects at LOD 0

- **Exact apportionment** of each 240 m block budget among its 64 cells by `apportion` (integers, ties broken by identifier). The weights come from the tile fields:

| Budget | Weight |
|---|---|
| Arable land | `exp(−slope/10°) × soilDepth × (1 − stoniness) × acceptable drainage` |
| Timber | `forestPotential` |
| Clay | `clay × low slope × (alluvial + argillo-marl)` |
| Stone | `exposedRock × hardness × access` |
| Peat | `drainage = 1 × organic × low HAND` |

- **Fine position of a deposit**: choice weighted by an addressed exponential race among the 64 cells of its LOD 3 block. The weight is the host rock × a low cover (small `depositDepth`). The footprint is an ellipse oriented by `structureAzimuth`, sized according to tonnage.
- **Visible outcrop**: only if the top is less than 5 m deep and the local unconsolidated deposit does not mask it. An iron cap (gossan) follows the `gossan` flag of the deposit.
- **Placers**: transport of the eroded mass of the footprints along the tile's receiver graph, modelled on `route_context`. These are the "fine" placers. Their total remains that of the LOD 10 placers positioned within the tile.

## 5. Re-injection into `ground_surface.py`

The insertion points are in `scores_for_chunk`, without a new palette draw (`ground_textures.gd` draws once per type):

- **Group B**: B11 "Warm ochre or reddish earth" receives `oxide × heat` within iron-cap footprints. B02 and H02 receive `peat`.
- **Group R**: the weights of the parents R01–R20 come from the conditioned fractions.
- **New catalogue types** to be provided: saline crust (M15), gypsum (M16), exposed peat (M10). They are absent from the 90 current types and must only activate when salt, gypsum or peat is declared.

The doctrine follows `GROUND_MATERIAL_MAPPING.md` §5.3 and the table in §12 of the Neural Earth study.

## 6. What cities and settlements consume

| Need | Read from Neural Earth | Granularity | Remark |
|---|---|---|---|
| Dressed stone, lime, slate | LOD 10 potentials, exposed rock and hardness at LOD 0, per-block "stone" budgets | 240 m blocks, then 30 m | quarry candidate = hard exposed rock within transport range |
| Clay (brick, pottery, wattle and daub) | clay potential, per-block budget | 240 m → 30 m | clay pits in valley bottoms |
| Timber for construction and fuel | stock, growth, share of construction timber, share of conifers, felling and skidding months | region → block | felling and clearing = Chronos deltas |
| Water | Neural Earth hydrology (monthly flows, navigability) | reaches | no local water invented |
| Arable land and pasture | surface budgets at LOD 3, then LOD 0; monthly livestock-unit (LU) capacity | village land (finage) | actual cultivated area is a Chronos delta |
| Salt, iron, metals | deposits (outcrop, medieval accessibility), marine salt | objects | exploitation is dated by Chronos |

`programme.resources`, which reacts to the timber, stone, ore and clay triggers to add workshops, should read these values instead of declarative triggers.
## 7. Not done

- No changes to `surface_context.py`, `ground_surface.py`, the catalogue or the shaders. No tests on the Magna Urbis side.
- The per-block mean deviation after conditioning and the cost per tile (about 1.8 M cells) remain to be measured.
