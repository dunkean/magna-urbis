# Building inspector helper — ready for Opus

Pure TypeScript, no DOM, mesh traversal, archive decode, network request or style inference:

```ts
import { describeUrbanBuilding } from '../render/buildingInspection';
const info = describeUrbanBuilding(selectedBuilding, optionalAlreadyLoadedStyleIndex);
// inspectBuilding is an alias; both return BuildingInspection.
```

## Stable return contract

| Field | Meaning |
| --- | --- |
| `id`, `parcelId`, `recipeId`, `variantId` | Exact retained identities. |
| `label`, `variantLabel` | Authored recipe/variant labels, or `null` without an exact supplied index match. |
| `culture` | Copy of `{culture, pack, mode, borrowing}` from the building. The style index has no culture display-label field, so no translated label is invented. |
| `function` | Retained architecture function. |
| `programme` | Optional city metadata `{role?, district_role?, wealth?, landmark?, households?}`, or `null`. Household wishes remain programme data. |
| `geometry.footprintAreaM2` | Plan area, outer rings minus holes. |
| `geometry.roofAreaM2` | Projected roof-envelope area, outer rings minus holes; not the sloped roofing surface. |
| `geometry.perimeterM` | Total footprint boundary, including courtyard/other inner rings. |
| `geometry.courtyardAreaM2` | Explicit semantic courtyard area only. Other footprint holes are not reclassified as courts. |
| `geometry.widthM`, `depthM` | Footprint extents after inverse building rotation, along local X/Y; `null` for empty footprint. No world-AABB distortion on angled buildings. |
| `geometry.bodies` | Count of retained volumes. A city preview may have zero volumes. |
| `geometry.floors` | Maximum distinct level count of one body, or `null` if no retained levels. |
| `geometry.heightM` | Cartographic height if explicitly present; otherwise maximum volume top above `ground_z_m`; `null` when unknown. The validation flag still marks a cartographic value as plan-only. |
| `materials.ids` | Sorted native material IDs from body/level slots and structural feature/roof attachment materials. No catalogue-default substitution or roof-mesh parsing. |
| `materials.bySlot` | Sorted IDs per `frame`, `infill`, `coating`, `cladding`, `base`, `roof_frame`. |
| `roofSystems` | Sorted actual retained volume/cartographic roof-system IDs. |
| `validation` | `preview`, `plan_only`, or `native`, from the explicit city silhouette markers, simplification and cartographic validation. Less detailed markers take precedence. |
| `capacity` | `{status: 'native'|'unknown', domesticUnits: number|null, usefulAreaM2: number|null}`. Preview and plan-only always have **null capacity**, even when an estimated number exists in their transport fields. Native zero is preserved as zero. |
| `style` | Exact read-only `BuildingStyleEntry` from the supplied index, matching both recipe and variant; otherwise `null`. Includes `profile`, `typology`, `morphology`, `footprint_family`, `roof_system`, `temporal`, `confidence`, `sources` and all other declared facets. No fallback to another variant or implied historical claim. |
| `diagnostics` | Copy of native/preview diagnostic strings; remains authoritative together with native inspection. |

The helper describes the retained result. `native` does not claim that an arbitrary programme, dwelling capacity of a plan-only proxy, or later interior operation has been certified. Consumers should keep existing native snapshot/body diagnostics and later realization refusals visible.

## Minimal validation

One focused Vitest case: rotated 10×6 m footprint with a 2×2 m hole gives net 56 m², perimeter 40 m, local width/depth 10/6 m; roof and explicit court areas checked. Plan-only capacity stays null, native zero remains valid, preview unknown fields stay null, source labels require exact index identity. Poison getters prove the helper does not read roof meshes or retained archives.

Command: `cd web; npx vitest run tests/buildingInspection.test.ts` — passed. No UI files modified.
