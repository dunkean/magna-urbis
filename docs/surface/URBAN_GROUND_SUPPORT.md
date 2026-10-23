# Ground beneath source infrastructure

`surface-1.5.3` changes only the derived bare-ground policy. Built/Road/Yard occupation is a conservative raster exclusion, not evidence of laid paving. The compiler now retains the local substrate, sediment and organic-soil mixture beneath these classes. Cultivated plots still use their explicit cultivation recipe. Low-cover opacity and tree exclusions remain unchanged. Legacy composite `material*` fields preserve the older overrides byte for byte.

The physical-context hash stays on its separately named `surface-1.5.2` algorithm version: changing presentation support must not re-identify accepted physical populations. Ground fields have their own content version, and the world identity includes that version. Existing packets are read as saved; neither the legacy500 packet nor the newer419 packet is silently rewritten.

## Cause and source limits

The previous compiler assigned one `built-foundation` mean to every Built cell and one `compacted-road` mean to every Road/Yard cell. In the source419 fixture, canonical cells span15.625m. The cartographic material palette maps those recipes to `urban.yard` and `roadFill` respectively. This turns conservative occupied cells into a broad light-colored surface; the measured source crop contains no physical snow.

Actual infrastructure sources were checked. `magnaUrban.magnaRoads` preserves `meta.roads.segments` paths, widths, surfaces, classes, profiles and source indices. Vector road projectors own their bounded source-width finish. `UrbanStreet` in `gen/types.ts` and `GroundAppearance.streetSources` in `gen/landuse/groundAppearance.ts` describe the existing2D city street/earth-ground presentation; `render/scene.ts` and `render/urban.ts` consume those sources. No literal `StreetSource2D`/`StreetSource3D` type exists in this baseline. An occupation cell alone carries neither a paving polygon nor a physical street access certificate. This patch introduces no streets, paving, access, courtyard surface, or renderer material, and leaves all native plans and road DTOs intact.

The500 accepted legacy plots remain distinct from419 current native exterior realizations and81 explicit native planning refusals. This correction does not reinterpret or complete those refused buildings.

## Measured CPU proof

See [urban-ground-v9.json](evidence/urban-ground-v9.json). A128² real retained crop contains774 Built and423 Road cells. Built goes from one artificial mean to19 local ground means; Road goes from one to42. Natural cells are unchanged. Physical fields, occupation, heights, legacy composite, low cover and population/environment versions are exact between old and new compilation of identical inputs. Source geometry/IDs and roads remain immutable. This is a bounded A/B CPU proof; crop-edge diagnostic routing is rederived identically in both versions, not presented as a new source hydrology network or a full-world rendering qualification.

Reproduce with the immutable source419 packet and a private checkout of baseline9b87392 (no primary checkout):

```powershell
cd web
npx tsx scripts/diagnose_surface_urban_ground.ts --source <native-current-419-source-footprints.surfacebin> --before-compiler <baseline>/web/src/surface/compiler.ts --out <report.json>
npx vitest run tests/surface
npx tsc --noEmit
```

The diagnostic checks the input packet SHA and aborts if it is not the archived source419 fixture. GPU appearance is not claimed by this CPU proof.
