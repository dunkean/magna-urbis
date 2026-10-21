# Recipe architecture in an external cadastral domain

## Objective and inputs

The urban workshop supplies existing cadastral land and a separate buildable
surface, both in metres with explicit polygon holes. Reserves remain unbuilt.
An optional roof-rights surface is distinct from the wall/upper-floor domain;
otherwise roofs remain within cadastral land. Authorized frontage segments,
neighbors, party boundaries, a declared cultural pack, a functional programme
and a UTF-8 seed complete the request. Ground is an explicit physical raster
patch when supplied, with row-major samples and bilinear interpolation. Its
origin is the centre of the first sample. A compatibility fallback is the plane
`z(x,y) = z0 + gx (x-x0) + gy (y-y0)`, separate from optional water elevation.
The terrain adapter owns the raster provenance and fallback approximation.

## Implemented algorithm

The existing Rust house engine resolves a catalogue recipe, its variant,
parameters and its existing architectural `LayoutPlan`. This retained plan is
shared by the volume path and detailed enrichment. The volume path constructs
native structural body/level records and calls the existing native roof builder;
it skips room subdivision, detailed wall/opening booleans and ornament. Native
supports and an access skeleton are produced by shared native methods. Structural
walk domains are passed to the existing access builder without subdividing rooms;
its exterior portal certificate is retained and imposed on compatible detailed
enrichment. It is not a second box generator. Native roof vertices/faces are
retained so renderers need not reproduce architectural roof algorithms.
The volumetric mesh retains the exact native facets but stores only referenced
vertices and face indices, normals, kind, material and roof group, together with
native roof edges/groups and per-level materials. Repeated per-face IDs are
owned by the containing volume and resolved recipe, avoiding a detailed-house
metadata copy on every dome facet. This is lossless mesh compaction, not LOD or
geometric simplification.

Walkable RF-FLAT/RF-STEP roofs consume the same exposed structural RoofSlab
constructor as the detailed native body path. The roof builder clips to that
physical slab, so the lightweight path does not invent overhangs that disappear
during enrichment. Roof-surface identity remains strict; no larger tolerance
substitutes for a shared construction rule.

Up to three recipes of the requested pack are considered. Automatic urban sites
use two seeded residential choices from the contextual land family, followed by
the original cadastral admission recipe if different. Exact Houses models keep
their own recipe and draw. An automatic drawn/occupation
plan is tried first, followed by one native intermediate width/depth target
halfway between that clamped target and the same variant's source minima, then
an explicit source-minimum fallback. The intermediate plan uses the same native
recipe draw and layout rules; it never scales completed footprint geometry. The fallback uses the same canonical layout
seed as the native admission table; source minima alone do not fix seed-dependent
layout spacings. The source-minimum fallback selects the default bundle unless
a variant is explicitly supplied; the earlier attempts retain normal variation. Each accepted plan
is then immutable. For each plan, up to four authorized contacts are considered.
Three positions and three setbacks are bounded by 36 transforms per plan and a
maximum of 108 transforms per recipe, at most 324 per parcel. A retained plan
is transformed rigidly for each candidate; no geometry is clipped to conceal a
failed fit. Width/depth draws are deterministically fitted within the selected
recipe/variant's declared ranges to the frontage and oriented site span before
the layout is built. The explicit inspired/fantasy lot-fitting control allows
simple native plans up to twice the source maximum dimensions. Declared minima
are never reduced. An exact Houses model bypasses automatic recipe alternatives
and lot fitting.
Optional occupation wishes provide coverage, frontage and depth. The target
area is coverage times buildable area; frontage/depth supplies its preferred
aspect. The resulting width/depth are clamped to the selected dimension policy
and available site span, before
the single retained layout is built. They are objectives, not permission to
change a native plan's internal court/corridor proportions or exceed a source
maximum. The minimum fallback remains available when the larger plan fails.
For example, the native strip plan reserves a 1.25 m side passage and a quarter
of its depth as rear open land; a 6 × 18 m declared envelope builds only
4.75 × 13.5 m. A deep parcel cannot be filled by enlarging that recipe beyond
its source range.
Before the four-contact bound, legal contacts are ranked by useful actual portal
width and the entry position that centres the native body, accounting for the
actual portal's offset. A curved frontage split into many short
segments therefore retains central entrance candidates; no artificial chord
replaces the authorized segments.
An optional exact native cadastral witness also supplies four orientations,
centred on the full physical plan, connected to nearby real authorized segments.
This is a search hint: stale witnesses, holes, reserves and neighbors retain all
their normal checks. A connector cannot cross its own body away from the native
portal. Where the recipe declares party walls, bounded candidates aligned
with supplied side boundaries precede centred and witness candidates. Exact
containment and roof rights still decide whether they are legal; no shared-wall
fusion is claimed. The source-minimum fallback is recorded in the retained plan diagnostics.

Whole upper-level domains must fit the buildable surface minus reserves. Courts
must remain in cadastral land. Native projected roofs must fit their separate
rights surface. A straight entrance connection must remain in cadastral land
and avoid reserves and previously accepted bodies. Authored circulation is
checked as well as the external connection. Neighbor intersections are
rejected. A deterministic 64 m broad-phase grid indexes accepted local surfaces,
including structures, courts and circulation. Each request unions only entries
whose bounding boxes meet its cadastral envelope; all final intersection tests
remain exact polygon operations with holes. Very large envelopes use a bounded
index overflow list rather than allocating arbitrarily many grid cells. There
is no population or parcel-count rejection in this placement function; transport
and presentation budgets belong to their callers. The small area tolerance is `max(0.0001 m², 1e-8 × tested area)`.

A horizontal foundation uses the maximum physical ground under the bodies
and their authored structural surfaces, including enclosures, supports and
circulation structures. The terrain slope and foundation-step tests inspect
this complete bearing domain. Each structural surface has an explicit plinth
from the checked minimum minus 0.15 m to that common ground plane; elevated
galleries are not filled up to their upper floor. This conservative solver
refuses an enclosure whose terrain range exceeds the declared foundation limit
rather than floating it above the valley or intersecting an uphill slope.
For raster terrain, the complete footprint is intersected with each covered grid
cell. Bilinear extrema occur on the clipped boundary; along each boundary segment
the interpolant is quadratic, so its endpoints and any internal critical point
are evaluated. This also finds interior peaks absent from the footprint corners.
Slope is evaluated from the bilinear gradient at clipped polygon vertices.
A continuous
plinth extends from the minimum sample minus 0.15 m to that foundation. Slopes
over 12 degrees or a foundation height difference over the request's explicit
limit are refused. Water is never substituted for ground; unsupported submerged
foundations are refused. These limits describe this implementation, not
historical construction rules.

## Programme, culture and enrichment

Domestic and mixed programmes use the pack's own admitted domestic recipes.
An optional `settings.house_config` reuses a real Houses configuration for
domestic/mixed uses. A cultural model requires the same architectural pack;
a contradictory explicit storey control produces a refusal. Other functions keep
their programme configuration and report that the template was outside its
scope. Placement owns parcel identity, count, seed and rigid transform. The
existing autonomous resolver runs exactly once for an explicit model: parameters,
variant and plan are retained without occupation fitting, intermediate targets,
source-minimum fallback or an implicit default-bundle/recipe pin. A model which
does not fit is refused. This reuses configuration, not a copied detailed unit.
A free native workshop preset uses the existing `house_config.workshop`
discriminant and is accepted only when BOTH source configuration and urban site
explicitly select Fantasy. Its native `atelier` pack, preset ID, dimensions,
materials and supports pass unchanged through the same resolver; site culture
remains site context rather than a claim of cultural provenance. No atlas recipe
or cultural mapping is fabricated. The same exact volume/physical/access and
enrichment checks apply; a valid standalone model can still be refused by a
particular parcel or unsupported detailed enrichment.
Workshop, warehouse and collective requests are explicitly labelled simplified
non-domestic programme volumes adapted before layout construction: open-span
single-storey workshops, taller single-storey warehouses, and collective halls
using the source's declared level capacity. Domestic annex programmes are
removed; materials, roof system and supports retain the cultural recipe.
Strict mode preserves source storey heights and refuses an undeclared compound
reorganization. These are simplified functional envelopes and contribute no
domestic units. They do not claim a detailed interior recipe.
Open-space requests remain empty. Declared borrowing is rejected in
strict historical mode. Cultural correspondences are provided by urban programme
data, never inferred from a similar name in this module.

The retained resolved plan is carried with the placed building. Enrichment
constructs detail without rerolling recipe, variant, parameters or layout and
checks body/level and native physical roof-surface identity. Vertical gable infill
may be subdivided or cut by the detailed native openings, as facade walls are;
the structural roof pans retain identical vertices. An incompatible version, altered structural plan,
unsupported non-domestic interior, or incompatible entrance produces an explicit
refusal while preserving the city placement. The autonomous house API remains
available independently.

Before enrichment, the stored city roof meshes are also compared to the
lightweight native reconstruction in world coordinates, including physical
ground elevation, rigid transform, face kind, material and vertices. The same
micrometre representation used by the existing native identity check removes
only JSON roundtrip noise. An older imported overhang or edited stored vertex is
refused even when its opaque resolved plan is unchanged.

## Determinism, scale and limitations

IDs and seed define architecture; request order defines deterministic collision
priority. Style, camera and LOD are presentation inputs and do not enter this
algorithm. Coordinates, elevations and heights remain physical metres. Detailed
enrichment is on demand; city volumes include native roofs but no room mesh.

A public connector and a body entrance are distinct native access interfaces.
For a perimeter enclosure, the connector terminates at the declared gate actually
cut by the existing enclosure/access operators. The gate must join the native
exterior walk component from which the retained body portal is reachable; no
interior paving or new wall opening is synthesized. Placement additionally tests
the connector against native wall sections at walking elevation. A blocked gate
or absent native connection produces an explicit refusal. The body portal is
retained separately so on-demand interior enrichment preserves its original cut.


The profile endpoint exposes recipe parameter ranges and native minimum-domain
envelopes, access widths and refusals without interior generation. Some compound recipes enlarge their envelope during the existing
layout calculation. The versioned `houses/data/urban-admission.json` table is
generated by the native `admission` example from minimum native default-bundle
plans, roofs, enclosures, supports, galleries and the access skeleton. Its
metre envelope bounds all those physical parts, without the solver's additional
0.3 m clearance on each side. Entries explicitly record a supported minimum or
a refusal; the table hashes the source catalogue and has a native drift check.
Source floor ranges and declared eras accompany each profile, so coarse cultural
selection can choose a source-compatible height and period before cutting land.
For example, a courtyard whose raw width minimum is 16 m can require a whole
envelope about 30 m wide after circulation and wing constraints. Urban cutting
uses the complete witness rather than the raw dimension. Only final resolved
placement proves admissibility for a drawn variant. The local
minimum witness certifies the source-minimum storey count, not every higher
storey option. A real AF-MAG-B02 two-storey request required a 29.62 × 36.84 m
access envelope where the one-storey minimum needed 29.62 × 30.67 m. The same
parcel accepts one storey and explicitly refuses that two-storey entrance;
no requested level is silently removed.
The local
plane fallback is not a terrain raster. Retaining terraces, party
wall fusion and optimized negotiation between adjoining buildings remain
unsupported. Supplied party boundaries are retained as context and diagnosed;
the current solver does not claim exact shared-wall construction. Simple
non-domestic envelopes do not reconstruct workshops or institutions internally.

This is a bounded engineering search over the project's existing recipes, not a
port of a published urban synthesis method. The architectural source inventory
and recipe provenance remain in `rust/crates/houses/data/recipes.json`.

## Reproduction and validation

Native regression seed: `urban-placement-regression`, cultural pack `EUR-MED`,
80 × 60 m cadastral land, public southern frontage, physical ground 143 m.
The focused `placement::tests` cases check exact retained levels/height,
deterministic replay, native roofs, a concave domain with a hole and a reserve,
explicit tiny-lot/access/slope/water refusals, and non-domestic/open-space roles.
They also retain two real Elven parcel cases that exposed sequential floating
roof-projection overlays. Roof faces are now united in one explicit nonzero
native operation before world rotation; the mesh itself is unchanged.
Run `cargo test -p magna-urbis-houses placement::tests` from `rust/`.
These contract checks do not establish historical fidelity or whole-city visual
quality; those require inspection in the urban workshop.
# Dense frontage ranges (22 October 2026)

In inspired/fantasy automatic urban placement, a simple native strip can receive
seeded side and rear ranges when applied occupation is at least 0.66 / 0.84.
This is a bounded adaptation of the existing TypeScript burgage operator in
`web/src/gen/urban/buildings.ts`, not a historical reconstruction. Its inputs are
metric native house width/depth, applied coverage and the stable parcel seed.
The primary conceptual town-plan reference is M. R. G. Conzen (1960),
[Alnwick, Northumberland: A Study in Town-Plan Analysis](https://doi.org/10.2307/621094),
*Transactions and Papers, Institute of British Geographers*, 27. The numerical
thresholds below are artistic implementation choices, not values calibrated from
that study; no historical parcel lifecycle or economic process is simulated.
The 1.25 m side corridor is retained. Arcaded recipes keep their existing
structural programme instead of receiving these extra ranges. A side range requires 2.2 m of built width
and at least 1.8 m of remaining court width. A rear range leaves at least 1.8 m
between front and rear. Ranges stay inside the selected native plan dimensions and
are separate native bodies with their own roofs. The retained courts/paths are
their Boolean differences; no renderer-side deformation is used. The exact plan
is enriched later without regeneration. Canonical minimum admission, strict
historical recipes and explicit Houses models retain their original plans.

The rule has no zoom dependency. Small lots may keep a single body; it does not
fill arbitrary cadastral corners or reproduce the full TypeScript perimeter
operator. The optional lot-fitting control can extend the native dimensional
ranges as described in `urban-settlement-styles.md`; without it the original
source ranges remain binding. Native regression `dense_native_rows_keep_side_ranges_courts_and_exact_replay`
checks ranges, retained courts, detailed enrichment and seeded identity.

For automatic lot fitting, let `A = cadastral area × requested coverage`,
`r = preferred frontage / preferred depth`, and `e` be the frontage-aligned site
spans with a 0.6 m lateral / 0.9 m longitudinal total clearance allowance around
an admitted rectangle (0.9 m on both axes for a bounding-box fallback). The initial `sqrt(A r)` width is
limited by `e.x`; depth becomes `min(A / width, e.y)`, then width is recomputed
as `min(A / depth, e.x)`. The existing source-range limits still apply. This
redistributes area into the available depth of a narrow lot rather than leaving
the cultural ratio as a permanent vacant backyard. The clearance is a fitting
heuristic; only the final physical geometry checks establish admission.
Where a rectangular cadastral admission witness is supplied, its real front
edge and orientation seed a conservative usable rectangle. Twelve bisection
steps expand depth, then the left and right sides, testing full polygon
containment at each step. This avoids treating a small side protrusion as usable
width throughout a concave lot. It is bounded coordinate-wise expansion, not a
global maximum-rectangle solver. The minimum fallback retains the original
admission witness.
World cadastral edges and unit directions remain unsnapped during this search;
the architectural millimetre grid is not reapplied to a retained street edge.
Both rectangle orientations are ranked by area after the recipe's dimensional
limits. This prevents a long side-street certificate from truncating a deep
house to the recipe's maximum width; authorized access is still checked after
rotation.

Up to four additional transforms align the entire native physical envelope to
the street plane and centre it across the projected lot. Their public connector
uses the actual off-centre portal. They share the existing bounded candidate
budget and the same roof, reserve, passage, foundation and neighbor tests.
Regression `narrow_dense_frontage_uses_the_lot_instead_of_a_minimum_house`
requires over 50% built occupation on a 7 × 32 m Chinese frontage lot with a
5 × 2 m side protrusion, valid
roof rights and exact native enrichment.
