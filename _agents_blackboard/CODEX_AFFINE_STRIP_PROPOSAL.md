# Affine Strip fit — constructive scope before implementation

2026-10-23. Proposal only. New base: `web/out/houses-affine-strip-proposal-workspace/rust` (228 source inputs copied unchanged from the frozen diagnostic copy). No Rust kernel/admission delta, Cargo/native invocation or product/export mutation. Geometry reference: `web/out/native-snapshot-geometry-proof-v2/geometry.json`, SHA `c2fe00f7377bffc7820fd340a1e3ca44f1295010a166f38ba7e4b191cb0a0d13`.

## 1. Actual operator and source meaning

`layouts::build_layout`, `Layout::Strip` branch, directly constructs a body `[0,W−1.25] × [D/4,D]`, court `[0,W] × [0,D/4]`, and passage `[W−1.25,W] × [0,D]`. Their union is the full nominal rectangle; this is a real authored operator, not a box substituted for an arbitrary court.

For these EUR-MED-B02 bundles, `bodies=[1,1]`, `cells=[0,0]`, and the sole `main` component has count/ratios 1. `apply_components` returns immediately for that component; `engine::component_program` also excludes it. Width is the complete nominal Strip envelope here, including its passage, not multiplied by room/unit count. `rooms_per_body` influences physical room/stair minima through `layouts::minimum_domain`; it does not repeat the width. This conclusion is restricted to this operator, not all RECT buildings.

`strip_programme_budget::solve` currently follows one scaled/clamped dimension curve. Its aspect is an algorithmic preference. `source_aspect_budget::SourceAspectBudget::for_candidate` explicitly accepts **Single only**: do not impose `4/18 ≤ W/D ≤ 6/10` as a new Strip rule. Retain the existing axis limits and physical minima, with the already authorized inspired parcel-fit maxima ×2. Catalogue EUR-MED-B02 axes are W `[4,6]`, D `[10,18]`; expanded maxima are 12/36 m, not a new permission. No hard Strip aspect is inferred.

Scope: one retained automatic inspired domestic/mixed source, ground/walled Strip, one whole rectangular body with unchanged upper plates, actual floors/draws/materials/roof/support programme retained. No pins/exact/imposed footprint, overrides, strict mode, disabled fitting or explicit minimum contract. Exclude active `urban_frontage_infill_enabled(parameters,coverage)`, arcades/covered galleries, structural/enclosure/void/setback/jetty programmes and unknown details. These three requests have coverage `.615`, so their source permission for infill remains true but its existing activation predicate is false for every dimension; do not turn the permission off to force eligibility. Plain `side_corridor` is a separate known unroofed gallery/post operator and can be included below.

The first pilot keeps the same 21 requests and the same three preselected conforming snapshots from the preceding proof. It does not broaden source selection to another formerly nonconforming style. Choose the first already exported frame/front for each snapshot before solving (513465: native orientation `226.63133126435667°`); no second frame follows a failure. This frozen-frame input avoids preparing another old-size native graph merely to choose a new fitting angle. Later production frame routing would be a separate integration question.

## 2. Variables and canonical front (rotation, never reflection)

Use body dimensions `u=W−c`, `v=3D/4`, with `c=1.25`, and body front-left position `(X,Y)` in one chosen street frame (+y into the site). Built area is **u·v**, not W·D. Source coordinates map to this frame by:

`q_frame = (X+u, Y+4v/3) + R(π) q_native`.

Thus the body is `[X,X+u]×[Y,Y+v]`, passage is to its **left**, and court is behind it. Compose this half-turn with the single retained world frame; determinant remains +1. No angle pool or mirrored model is permitted.

Axis bounds become `u∈[Wlo−c,Whi−c]`, `v∈[.75Dlo,.75Dhi]`. As in the existing strip inverse, obtain `m=minimum_domain(actual retained parameters)`, then `Wlo≥c+max(m[0],1.8)` and `Dlo≥max(m[1]/.75,1.8/.25)`, as well as coherent source/size minima. Read coherent variant bounds without resolving/drawing a source again. Room counts, floors, wall thickness and stair height remain the retained draws.

Aspect remains an explicitly labelled **soft reference**. First prototype may use the coherent catalogue/wealth centre already defined in `engine::amount`, without sampling: `Wref=swlo+(swhi−swlo)·wealth`, similarly Dref, then `rref=(Wref−c)/(.75Dref)`. Record that origin/formula; it is not claimed to be the unavailable original random dimension draw. Alternatively accept a genuinely captured dimension reference from the draw owner. Never silently substitute the adapted snapshot ratio for a historical hard bound.

## 3. Affine parts and real rights

New model describes affine rectangle corners in `(u,v)`, plus translation `(X,Y)`. Required parts before the native millimetre grid:

- Body: `[0,u]×[0,v]` in body rights B.
- Complete native court/body/passage union: `[-c,u]×[0,4v/3]` in cadastral/occupation rights A.
- Right outer party wall: `[u−.1,u+.1]×[0,v]` in A. The other party wall `[-.1,.1]×[0,v]` is already contained in the full union because `c≥.1`, `u≥.1`; preserve its native thickness from the recognized retained features rather than assuming a different one.
- `features::front_gallery(...,"side_corridor",...)` uses width `.85` beside the body. After rotation it is `[-.85,0]×[0,v]`; its `.1`-radius posts lie within that band under the retained minima. A already contains it; export/postcheck its genuine prepared geometry. No arcade/cover is inferred.
- Roof: an explicit conservative rectangle `[-h,u+h]×[-h,v+h]` in roof rights R, only for the recognized constant-eave RF-GABLE/RF-HIP scope with identical floor plates; `h` must enclose the retained drawn native/cartographic overhang and grid error. Verify that enclosure after reconstruction; detailed native roof realization remains pending. Do not call it a native roof mesh/projection certificate.

Here B=`buildable−reserves−neighbours`, A=`cadastral−reserves−neighbours`, R=`roof_domain−reserves` (retain existing neighbour policy separately). Use exact supplied boolean domains and the one fixed frame. Default portal position/passage may change with dimensions; it is **not** assumed to have a universal .2 m bound. The model certifies structural rights only; actual native portal/connector checks remain pending.

Each actual convex-rights edge `nx·x+ny·y≤b` gives one inequality per affine part's supporting corner: `aX+bY+cu+dv≤e`. A union of affine parts means all its parts must satisfy their assigned domain. No hull, court resizing, source feature deletion or approximate parcel is introduced.

Two real input rights remain nonconvex: they must return `Unsupported` in this convex tranche. Only 513465 and explicit convex fixtures enter it. Handling the other two would require a separately authorized exact nonconvex/disjunctive method; triangles/inner cells cannot be presented as the original domain or global impossibility.

## 4. Kernel functions and deterministic objective

Add a child module `direct_affine_fit.rs` under `direct_convex_fit`, exposing a new affine API while leaving `solve_rectangle` and its existing behaviour/tests unchanged. The child can reuse existing private `convex_planes`, `clip`, `area_extrema`, and `area_roots` without refactoring the old solver.

Planned functions:

1. `affine_part_constraints`: validate affine extent order over the bounded dimension box and emit the four-variable inequalities above.
2. `translation_obstruction_pairs` / `translation_obstruction_triangles`: project `(X,Y)` away using opposed pairs and triples of translation normals with nonnegative weights summing to zero. Their weighted RHS is affine in `(u,v)`. This is the same obstruction principle as the three-constraint fixed-translation certificate; retain source-plane/weight witnesses. Degenerate/uncertain numerical cases return `Unsupported`, never a guessed emptiness proof. Finite plane/triple/projected-constraint caps are explicit; exhausting a cap is unsupported.
3. `dimension_region`: clip source/minimum bounds by those projected half-planes. In positive `(u,v)`, area extrema occur on vertices or stationary points of edges, as in the existing `area_extrema` argument.
4. `dimensions_at_area`: clamp the wished area to the attainable interval, enumerate the ideal-reference point and **all** boundary `area_roots` for that area (including extreme-area ties), and rank by aspect. No scalar aspect curve or native trial is used.
5. `closest_translation_for_dimensions`: substitute dimensions into original half-planes; recover their actual feasible translation polygon and its Euclidean projection of the retained reference origin. Reuse the bounded clipping/nearest-point mathematics of `rigid_translation_fit`; do not construct trial native bodies to do this.
6. `quantized_strip_corners`: at most four scalar pairs: `(floor W, floor4 D)`, `(floor W, ceil4 D)`, `(ceil W, floor4 D)`, `(ceil W, ceil4 D)`. Remove duplicates, validate source/minimum bounds, recover translation against the same original constraints and verify every inequality before native construction.

For continuous and quantized choices, priority is target area error, then `|log((u/v)/rref)|`, then squared displacement from the retained reference origin. Remaining ties use `(u,v,X,Y,corner_index)` in that fixed order. A corner's translation recovery is algebra, not another native pose/admission. No raster/portal outcome participates in selection.

Quantization is **W on 1 mm, D on 4 mm**; therefore u is on 1 mm, v on 3 mm and the quarter court v/3 on 1 mm. This avoids treating `snap(D/4)` as an exactly affine function on arbitrary D. `domestic_budget_shape.court_fraction` measured from an already snapped snapshot is not exactly .25; do not reuse that measured fraction as the raw authored operator. Final world translation is not snapped, matching existing rigid transform semantics.

## 5. Exactly one native reconstruction/admission

Select one source and frame before solving. If no scalar quantized candidate meets the required target tolerance, return that explicit bounded result; do not construct a minimum or another source. Clone the retained resolved parameter bundle and replace only parent nominal W/D, clear stale entrance geometry, then call the actual `layouts::build_layout(recipe,&parameters,native_layout_seed)` **once**. A small engine-owned rebuild helper must own/validate the original non-minimum unit-0 layout seed (`engine::selected_draws` supplies it); no `resolve_draws`, `resolve_architecture` or config re-resolution is permitted. Config wealth/seed, floors/body/component counts, materials, pitch/eaves and every other non-dimensional field remain unchanged. Unsupported provenance means no reconstruction.

Check actual reconstructed rectangle, court, passage, levels, native features and conservative roof/support enclosure against the descriptor. One `PreparedPlan::with_native_entry` and **one** normal admission at the solved transform then verify the exact site, terrain/water, native supports/portal/connector and cartographic roof rights. No second construction, alternate door, reduced size, angle or source follows failure. Household capacity stays unknown; detailed native exterior replay remains a separate verification.

Required tests before any promotion: old rectangle kernel suite unchanged; affine triangle/trapezoid fixtures where the previous aspect curve misses a feasible target; obstruction-pair/triple projection and extreme-area tie cases; π-transform side/court handedness; exact grid/native area identity and four-corner bound; active infill/arcade/multi-body/void/unknown support exclusion; source-axis/minimum preservation without invented Strip ratio; one reconstruction/admission counters; real rights/roof/terrain/access negatives; all 21 archived cases, recording the two honest convexity exclusions. No gain or global <3% refusal result is assumed.
