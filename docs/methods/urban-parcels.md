# Continuous cadastral contacts and four parcel families

## Objective and inputs

Produce deterministic, inspectable cadastral land inside retained urban blocks,
without changing streets, holes or programme reserves. Coordinates, frontage,
depth and witness dimensions are metres; areas are square metres. Inputs are
the applied layout, cultural/phase recipe, parcel overrides and seed.

### Tissue context and occupation (21 October follow-up)

Cultural land defaults do not require the same complete architectural compound
on every parcel. The existing `medina/core` recipe describes souk frontage
(4.6–6 m modules, 380–1100 m² core blocks), whereas native `AF-MAG-B02` is a
complete courtyard with a 29.62 × 30.67 m minimum domain before clearance.
Applying that court to every souk shop is an incompatible domain choice, not
evidence that the city needs larger gardens. Souk frontage now selects existing
`AF-MAG-B01` earth houses; explicitly requested courtyard land retains B02.
Ksar frontage can select existing B05 towers. The B10 tent is never substituted
for permanent urban housing. European dense frontage uses native B02 rows or
B05 mixed houses, while rural/inherited and explicit court contexts keep their
own sources. Period support, native minima and the 0.6 m domain clearance remain
unchanged. Allocation and architectural requests reuse the same contextual rule.

Network pressure also modulates the applied phase rather than replacing it:
`p_core = 0.65 + 0.35 p`, `p_middle = 0.35 + 0.65 p`; peripheral and village
pressure retain their previous values. These are artistic prototype weights,
not measured historical density laws. They prevent the 600 m network scale cap
from turning most of a metropolitan core into peripheral morphology. Streets,
water boundaries and programme reservations remain fixed. Core/edge visual
comparison and actual built capacity must still assess the resulting density.

Architectural requests carry a separate occupation *wish*: mean catalogue
coverage, building depth and frontage in metres for the applied zone. Native
placement may only pursue it within the source recipe's bounds and exact
containment/access rules. Coverage is not a promise of accepted or occupied
area. Actual discrete levels use the tissue's existing `arch.storeys` interval,
clamped to the selected native recipe; floor area never invents household IDs.
The existing exact geometry and refusals remain authoritative.

For a complete settlement with an **automatic population budget**, the gross
density is capped by cadastral cadence before growth. Each existing growth
epoch has its original equal area share (population is subsequently assigned
proportionally to those areas). For each epoch/zone, take mean catalogue
frontage times mean plot depth, bounded below by the actual native module and
minimum domain. Let `A` be their share-weighted mean in m²/household. Then
`density_auto = min(density_catalogue, 4.5 * 10000 * 0.65 / (1.15 * A))`.
The 0.65 residential land share and 1.15 shape/repair margin are explicit
prototype planning assumptions. They do not certify household capacity.
Only the existing positive numerical density guard remains; there is no
universal urban density floor. Manual positive gross density, radius budgets,
existing/imported geometry and parcel-only recalculation retain their inputs.
The native warning states the assumptions and resulting density.

Urban facilities may reserve several existing accessible blocks, using the
applied catalogue block module instead of requiring one block proportional to
the total metropolitan demand. Existing market places are preferred. Explicit
isolated farms and roadside temples instead retain exactly one reserved domain:
one domestic household for a farm, one collective intention and no imposed
housing/common/market demand for a temple. Its source envelope and site's
useful-area intention determine suitability. Surface shortfalls remain deficits;
additional temples are not invented to fill them. Rear land remains within the
retained property, and this programme step never changes streets.

Open commons use this same pre-subdivision reservation mechanism after markets
and constrained built facilities. Several remaining, actually public/collective
street-accessible blocks may supply the existing programme's 0.5 m²/person
intention (2 m²/person in agricultural/communal contexts). These are prototype
programme assumptions, not historical space standards. No architectural witness
is required for open land: capacity is its exact retained area, with holes
excluded, and becomes realised open capacity only from the returned open-space
surfaces. Existing market domains, private or attached gardens, unserved land,
wet blocks and unsuitable slopes are excluded. A seeded 50,000-person regression
reserves several blocks for the 25,000 m² common intention, preserves an existing
market and a private garden, rejects a disconnected reserve, and reconciles the
open result without reporting any built capacity. This is a land/admission
regression; full native 50,000-person visual validation remains separate.

Reproduce with `node scripts/urban_occupation_native_check.mjs EXE --placements`
from `web/` (retained medina streets/blocks), or `--population 50000` for the
complete native population-budgeted settlement. The script records timing,
reason areas, requested/land/built capacities and native recipe IDs separately
under ignored `web/out/urban-occupation/`. A larger population is not a capped
or implied building-count validation. Targeted Rust regressions cover source
selection, explicit courts, existing market places and private garden exclusion.

First native follow-up measurement, before cadence-budget recalibration:
the retained medina reference has 74 blocks, 72 streets and 58,409.55 m² of land.
The contextual source correction changes 4 accepted buildings / 1 refusal to
148 / 13, including 38 in the core and 36 in the middle zone (previously zero).
Footprint coverage rises from 2.17% to 10.60%; core coverage is still only 15.9%,
so this is not a claim that dense souk occupation has been reproduced.
The first complete 50,000-person case took 3.12 s for quarters, 14.36 s for
parcels and 4.64 s for placement requests on the native review machine. It had
6,188 parcels but only 5,336 indicative household slots against 11,111 requested.
This contradiction motivated the automatic cadence budget above; these figures
must not be presented as a successful 50,000-person built-city validation.
A one-million-person quarters-only call exceeded the probe's 240 s limit;
its private process was stopped, and no metropolitan performance result is
claimed. Exact inputs/reports and before/after illustrations are retained in
`web/out/urban-occupation/`; the native executable must be rebuilt to measure
subsequent source changes. The current focused urban Rust suite passes 93 tests.

The second native candidate still had 17.97% core footprint coverage. Among its
43 core plots, median area/frontage/depth were 138.6 m² / 8.53 m / 13.78 m;
32 plots exceeded the B01 source's 12 m maximum body depth. Of 37 accepted core
bodies, 33 were the canonical 5 × 7 m plan and four were 9 × 12 m, with no
intermediate body. Parcel cadence and native dimension search therefore both
need attention; increasing a source beyond its bounds is not a remedy.

For unforced `medina-souk` core/middle land only, keep the local catalogue depth
instead of interpolating it toward peripheral 35–65 m depths, with the native
minimum still authoritative. A repaired plot of at least two native minimum
domains gets one attempt with the existing oriented-cut operator and native
domain module. Retain the attempt only if it produces 2–8 admissible children,
each with a real access and exact contained witness, and their union and holes
match the parent without overlap. Otherwise retain the parent. Explicit
gardens, residuals, reservations and other families are untouched. Child IDs
retain the canonical repaired parent and a `native-domain-repartition`
provenance record. The retained three-block fixture
`parcels/fixtures/medina-repaired-core.json` verifies increased valid-lot cadence,
exact union/containment, access and deterministic replay. A fresh native build
is required to judge the resulting whole-core coverage visually.

This implementation adapts frontage-constrained partitioning and oriented cuts
discussed by [Vanegas et al. (2012)](https://twak.org/project/parcels/).
It does **not** implement their complete hybrid straight-skeleton algorithm or
interactive identity matching. The existing competing frontage planes are an
oriented-distance partition, not a straight skeleton.

## Contact contract

For each oriented block edge `a + t(b-a)`, project onto candidate street
segments. Street half-width is interpolated linearly on the segment. Clip the
parameter interval to the segment's projection range and to an outward contact
band of `max(0.8 m, 0.3 * halfWidth)`. The centreline must lie outside the land;
contacts farther than 14 m or differing in direction by more than 20 degrees
are rejected. All constraints are affine: clip their exact intervals, union
over consecutive street segments, then merge redundant collinear boundary
pieces. Rank and street index resolve overlapping candidates deterministically.

Parcel contacts are intersections of these continuous intervals with **both**
parcel and block boundaries. Either boundary may have redundant vertices.
Useful length, primary qualified frontage and access derive from this same
contact list. Contact length is the union length, never the sum of duplicated
street segments. Curved contacts retain their exact individual segments. For admission, a local
support joins only endpoints within 1e-5 m, on the same street/rank/access class,
and directions within 20 degrees of the candidate tangent. Its projected span
supports a straight building set back inside the curved boundary; disjoint fronts
and corners do not add. Candidate supports are ranked by useful span before
limiting the search to twelve. Every rectangle still passes exact polygon
containment, including holes. This corrects two replayed halfling village lots
(1005 and 2048 m²) whose street curves were sampled in roughly 5 m pieces.

The absolute/proportional bands are tolerances for the existing street ribbons,
not statutory setbacks. Clipping retains street endpoints rather than extending
their centreline indefinitely. A true bend or a width-profile change can change
the cadastre; adding a collinear point with interpolated width cannot.

## Four operators

- **Frontage series:** retain the existing inward bands and maximum cultural
  depth. One recipe midpoint module with ±6% front variation sets the dominant
  rhythm; a bounded correlated recurrence
  `r(i+1) = 0.75 r(i) + 0.25 U(0.85, 1.15)` sets neighbouring widths.
  There is no independent lottery for oversized properties. Coverage smoothly
  interpolates depth pressure; the previous abrupt 0.68 switch is removed.
  A squared closure blend over the final 7 m avoids a second abrupt rear-seam
  switch when the opposite boundary is almost reached.
- **Compact oriented lots:** recursive exact cuts follow the retained block
  frame, trying a bounded set of balanced positions. Components must retain
  useful access; impossible rear cuts stay explicit land.
- **Courts/enclosures:** when shared access is culturally permitted or explicitly
  selected, reserve one connected passage and court as cadastral `court` land.
  The court must contact an actual street. Its reverse boundary supplies
  collective contacts to adjacent lots; all retain the originating street ID.
  Clipping must leave one connected component, and its entire minimum-width
  access spine must fit inside retained land including holes. No street is silently added.
  Small domains or rejected corridors retain the existing enclosure subdivision.
- **Inherited land:** cut wider ancestral frontage domains, retain domains
  according to local occupation pressure, subdivide the others and occasionally consolidate an adjacent pair.
  Operations preserve ancestral structural boundaries and record parent IDs;
  they do not perturb every vertex. This is a stylized deterministic history,
  inspired by the continuity/change documented by
  [Scrase (1989)](https://www.sciencedirect.com/science/article/abs/pii/0305748889900017),
  not a reconstruction of Wells or a universal historical law.

The cooperative access objective is related to
[Chen, Song and Ortner (2024)](https://sutd-cgl.github.io/supp/Publication/projects/2024-EG-UrbanModeling/index.html).
Their hierarchical street co-generation/global optimization is not implemented:
the parcel stage keeps the retained network immutable.

## Smooth urban/rural pressure

One [Dijkstra shortest-path pass (1959)](https://doi.org/10.1007/BF01386390)
on the retained pedestrian street graph measures access
from the layout's actual nucleus and subcentres. Sources are projected onto
segments; their direct along-street distance is retained so inserting a
collinear street vertex cannot shorten the measured journey. Existing native
junction vertices define connectivity; the parcel stage does not invent
crossings or bridge gaps. Major/minor path length has unit weight, narrow
rank-3+ paths weight 1.15. With `R = clamp(sqrt(blockArea / pi), 60 m, 600 m)`,
pressure is `0.12 + 0.88 exp(-networkDistance / R)` for reachable land and zero
otherwise. The programme stage attenuates it by `1 / (1 + 3 * slope)` and makes
wet land zero. This is an explicit artistic accessibility model, not calibrated
pedestrian traffic or a historical population model.

Pressure interpolates frontage scale from 1.35 at the edge to 0.88 at a centre,
depth from 1.0 to 0.9, house-area target from 1.25 to 0.95 and coverage from
0.62 to 1.03. Cultural building-envelope minima bound dimensions before cuts.
Planned grids apply only 22% of these variations, preserving their regular
cadence; walls, river boundaries and reserved land remain exact constraints.
For unplanned urban zones, core/edge recipe ranges are interpolated by pressure
before these scales, so merely changing a core/middle/edge label does not create
a cadastral step. Village recipes and explicitly planned zones retain their
separate cultural scale.
Lower pressure leaves larger properties and more rear garden; inherited land
has a deterministic division probability `0.2 + 0.75 * pressure`, retaining
more ancestral domains at the edge. The same pressure is exported to allocation
and inspection; this calculation never adds a street during parcel replay.

## Admission, repair and identity

The culture mapping supplies minimum frontage, area and depth, and shared-access
rights. There is no universal building rectangle. A proposed `plot` must contain
a rectangle of that profile's frontage by depth, placed from an allowed contact.
Public frontage uses the cultural frontage module; private/collective entry
uses a separate `minAccessWidth` derived from the recipe's gate dimensions.
A gate is not the building's width: behind an adequate gate, an additional bounded
interior search checks the complete cultural body rectangle. Public contacts
retain frontage alignment. The search tries at most 12 contacts, five longitudinal
positions and four setbacks, plus 25 interior stations for private/collective gates. Polygon difference, including holes, must be below
`max(1e-5 m², witnessArea * 1e-8)`. The accepted witness is exported as
`envelope`. This is a minimal insertion witness; the architecture stage still
checks its actual recipe, terrain, circulation and neighbour constraints.

At most two repair passes try the eight strongest adjacent plot boundaries.
Only a connected union containing a valid witness is accepted; depth limits
remain in force outside enclosure families. Reserves, intentional gardens and
shared courts cannot be consumed. Existing boolean holes stay holes.

Every parcel carries a stable geometry ID, `parentIds` (legacy `parent_ids`
accepted by the boundary), operation provenance, family and result reason.
IDs ignore ring start, winding and redundant collinear vertices; only ID hashing
rounds coordinates to 0.1 mm. Geometry is not rounded. These IDs persist for
equivalent segmentation and reordered blocks. Layout-key and canonical block
geometry namespace parcel IDs and RNG; the array index remains a lookup only.
Editing a block's geometry changes its identity and descendants deliberately.
Historical ancestors may no longer be emitted as active parcels.

Reasons distinguish intentional gardens, retained back land, rear land attached
to an accessible property's ID, unserved blocks and failed envelopes. An
attachment is ownership metadata, not a fabricated street facade. A failed
building candidate remains `residual` with a reason, never a silent garden.

## Replay and validation

Run from `rust/`:

```sh
cargo test -p magna-urbis-core urban::parcels --lib
```

The versioned 100 × 40 m fixture uses seed `segmentation-regression`, an
8–12 m frontage range, 20–30 m depth, 130–400 m² house-area range and 0.4–0.6
coverage. It compares no extra vertex, a street-only vertex, a block-only vertex
and both. The frontage, compact, shared-court and inherited operators compare
active parcel IDs, parentage, uses/reasons, access and frontage length. Matched
shapes must have symmetric difference below `max(0.01 m², area * 1e-6)`.
Other targeted cases cover rank ties, holes, deep concave territories, connected
collective courts, intentional gardens and explained refusals.

Native spot checks on 2026-10-21, seed `urban-refonte-v1`, release build:

| Reference | Population | Active parcels | Quarter stage | Parcel stage | Replay |
| --- | ---: | ---: | ---: | ---: | --- |
| Linear village / curved road | 200 | 34 | 58.8 ms | 10.2 ms | identical |
| Rectangle town / flat | 2,500 | 714 | 84.8 ms | 236.1 ms | identical |

These are single native observations, not medians, p95 or WASM results; other
concurrent build/browser work was running. Both have no parcel warnings. The
rectangle has 0.00596 m² coverage discrepancy and 0.00190 m² overlap over about
325,308 m² of cadastral land. Regenerate the reports and complete geometry with:

```sh
cargo run --release -p magna-urbis-core --example urban_refonte -- --case rectangle --population 2500 --repeat --out out/urban-cadastre-final-city.json --geometry out/urban-cadastre-final-city-geometry.json
cargo run --release -p magna-urbis-core --example urban_refonte -- --case linear --population 200 --repeat --out out/urban-cadastre-final-village.json --geometry out/urban-cadastre-final-village-geometry.json
```

## Scale and limitations

All operations execute on cadastral geometry, independently of camera, style
and display LOD. Searches and repairs are bounded, but adjacency remains local
linear scanning; very large blocks need profiling before adding an index.
There is no measured WASM timing guarantee in this note. Geometric admission
does not certify economic capacity, historic authenticity, circulation through
a detailed house or terrain compatibility. Arbitrarily curved boundaries can
fail the straight witness even when another architectural plan could fit; the
refusal is deliberately explicit and preserves the exact land.


The versioned UI references use `urban-refonte-v1`: village population 200,
`halfling/village`, radius 120 m, three quarters, hill 8%; town population 2500,
`bastide/core`, radius 330 m, six rectangular quarters. Cultural phase recipes
(core/village/etc.) retain the mapped land family. Explicit parcel operators,
presets and `plotOp` parameter overrides keep priority. Before the curved-support
and phase-family fixes, the browser exports held respectively 6 buildings / 0
refusals and 236 buildings / 16 refusals; their capacity deficits were explicit.
These are regression observations, not claims of adequate population capacity.

The applied programme period selects the native admission profile before any
cuts. A known culture without a recipe for that period keeps the entire block
as `residual / unsupported-period-profile`; it never receives the neutral
fixture profile. Reserved land remains reserved independently of this decision.
