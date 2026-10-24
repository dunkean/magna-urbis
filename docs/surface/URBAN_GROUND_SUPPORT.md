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


## Explicit retained419 derivative

`web/scripts/migrate_surface_natural_ground.ts` creates a distinct1.5.3 packet from the pinned immutable419 source. It shares `groundSupport.ts` with the compiler, reconstructs the same colluvial accumulation from the retained samples and canonical source graph, and derives only the four bare-ground arrays. It never derives soil by subtracting the legacy composite. Five low-cover arrays and every physical/context field remain byte-exact.

The migration requires the exact source packet SHA, matching retained parent, original climate and the recorded absent process masks/default floodplain and colluvial parameters. It refuses a mismatch in any natural ground cell. It is deliberately a pinned evidence tool, not an automatic migration of arbitrary old saves whose generation parameters may be unknown.

The complete1024² context has3,604 Road and1,108 Built cells. Road now has52 distinct ground means and Built30; the1,043,864 natural cells retain exactly the same ground values. The explicit canonical/parent/source references and derived world identity are updated; native urban identity,419 realizations,81 refusals, terrain source identities, legacy composition, populations and archives are unchanged. Binary encode/decode/hydration verifies the resulting packet. See [urban-ground-v9-migration.json](evidence/urban-ground-v9-migration.json).

```powershell
cd web
npx tsx scripts/migrate_surface_natural_ground.ts --source <native-current-419-source-footprints.surfacebin> --out <native-current-419-ground-1.5.3.surfacebin> --report <migration-report.json>
```

Comparable plan400m, aerial oblique600m and overall8400m captures on the frozen integrated renderer are recorded in [native-current-419-v9-render.json](evidence/native-current-419-v9-render.json). The actual oblique comparison shows the pale grey occupied ground replaced by beige mineral support. Canopy/water rendering and candidate pages also changed, so the screenshots do not isolate the ground shader; the independent CPU proof isolates the four derived arrays.
