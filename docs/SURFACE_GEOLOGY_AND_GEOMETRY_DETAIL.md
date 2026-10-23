# Explicit geological scenario and real geometry detail

These are optional renderer-neutral modules. They do not change Magna's default
uniform substrate, source terrain, mapper styles or compiler automatically.

## Geological scenario

`surface/geologyScenario.ts` exports `createTiltedStrataScenario(options)` and
`geologyFromScenario(terrain, scenario)`. The latter returns a normal `GeologyInput`
plus its complete serializable `scenario` descriptor: catalogue, physical layer
thicknesses, granite basement, strike/dip, fixed world anchor, version and explicit
authored provenance. Assign that result to `SurfaceCompileInput.geology` to opt in.

```ts
const scenario = createTiltedStrataScenario({
  originX: 20_000, originZ: 20_000,
  basalContactElevationM: canonicalHeightAtCentre, // authored anchor, chosen once
  strikeRadians: 35 * Math.PI / 180,
  dipRadians: 8 * Math.PI / 180,
});
const world = compileSurfaceWorld({ ...input,
  geology: geologyFromScenario(input.terrain, scenario),
});
```

This is **a declared geological demonstration**, never geology inferred from
climate, biome colours, plates or noise. It intersects the unchanged actual source
surface with physical parallel beds. Let `a` be horizontal distance toward
`strike + pi/2`, the downward dip direction. The signed normal distance above
the basal contact is `q=(height-datum)*cos(dip)+a*sin(dip)`. Thus a basal contact
falls in elevation along the dip direction. `q<0` is granite; positive `q` passes
through the finite beds (default sandstone120m, carbonate80m) then an explicitly
unbounded marl cap. Finite thicknesses are normal to the bedding, not vertical.
Contacts use half-open intervals. No folding, faults, erosion history or observed
geological accuracy is claimed. Keep the same descriptor for all tile shapes and
zoom levels; choosing a new anchor from each patch would change the model.

The small committed neural fixture contains 64 exact raw teacher heights extracted
from the genuine 40km source captured on2026-10-23, with global SHA256, pixel crop,
spacing and model revision. Tests exercise three substrates under the same climate,
unchanged source bytes, mineral fractions, source-rock catalogue membership,
overlapping tile shapes,20Mm translations, boundaries, budgets and versioning.
This supports B07's explanatory-contact prototype. B09 still depends on the actual
drainage/upstream provenance and transport context; strata alone do not simulate
sediment transport or produce a scientifically complete valley.

## Fine geometry detail

`surface/geometryDetail.ts` exports `deriveSurfaceGeometryDetail(fineTerrain,
{canonicalContextId?,supportM?,geologyScenario?,signal?,memoryBudgetBytes?})` and a continuous
`sampleSurfaceGeometryDetail` query. Its separate readonly contract carries the
real source identity/version/native spacing, source reconstruction kernel,
physical derivative support, unit normals, slope/aspect, edge confidence and a
declared geometry-only rock-exposure **potential**. Its numeric storage remains
typed arrays for binary transport. It does not retain or mutate source heights.

Derivative support cannot be smaller than the native physical source spacing or
the sample spacing. Finite differences evaluate the actual source kernel, including
cubic B-spline controls when declared. Padded overlapping source patches give the
same derivatives at shared supported coordinates; incomplete edge support is
reported rather than hidden. The source's opaque LOD is never used as a comparable
physical scale. Derivation is synchronous; use the existing compiler worker for
interruptible large jobs. No renderer or UI integration is implicit.

The module does not modify canonical bedrock/soil/hydrology/climate/cover, stable
candidate marks or their acceptance. A real fine ridge can have a steep local
normal while the78m canonical cell remains flat. The tests demonstrate that
distinction and verify stable candidate IDs/positions/ranks and unmodified soil.
Exposure potential is a declared22–60degree steepness response, not a bare-rock
measurement. A renderer must condition it on canonical soil/deposit thickness,
occupation, water and cover before using it to expose a rock material.
`bedrockExposure` gates that potential by physical source-edge confidence.
`treeSupport` is a byte mask: zero only on fully supported source slopes above
65degrees; uncertain edges remain one (no veto). It is a visual support subset,
not a change to candidate inventory or acceptance. A renderer removes those IDs
from both its visual geometry and canopy atlas, while retaining canonical IDs.
The optional explicit `geologyScenario` also produces `localBedrockUnitId` on
the actual refined heights, retaining the descriptor/provenance. It cannot
silently create local geology when no scenario was supplied.
`localBedrockUnitId` contains catalogue unit IDs, not packed palette indices.
`supportDescriptor` binds this visual-support decision to the actual source and
geometryDetailId. The optional Godot visual packet accepts `_unsupportedTreeIDs`
as a dictionary of IDs: population selection and canopy union omit those IDs
without deleting or reseeding the canonical candidate inventory. Its atlas cache
also compares that mask to prevent a stale support subset.

## What remains necessary for “where / what”

Fixed canonical context prevents camera-dependent climate, drainage, geology and
object identities. A78m context cannot locate a2m bank, fine colluvial toe, narrow
geological contact or soil boundary just because a0.468m neural source arrives.
The present local-detail module improves geometric support and normals; it cannot
recover those missing environmental observations or process geometry.

The next integration must separate authoritative world-space contact/shoreline/
occupation geometry and basin routing from display sampling. Evaluate those fixed
geometries or declared subcell recipes at the actual world position, and combine
real local slope with canonical process budgets/provenance. Do not rerun D8,
soil formation or population acceptance per camera patch. Recompute a canonical
analysis only as an explicit source/context revision, with padded physical support
and external basin inputs where needed. Imported lithology requires a real mapped
package; an authored scenario must remain labelled as such in exported provenance.
