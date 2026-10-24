# Vegetation renderer assets

The catalogue pins CC0 source bytes; it is renderer data, independent of terrain,
population identities, canonical materials and presentation palettes.

From the repository root:

```sh
node web/scripts/surface_vegetation_assets.mjs
node web/scripts/surface_vegetation_assets.mjs --offline
node --test web/scripts/surface_vegetation_assets.test.mjs
```

The ingestion step downloads only the pinned grass collection and its four 1k
maps, verifies SHA256 and byte lengths, and prepares the named 28/40/79-triangle
tufts under ignored `web/out/vegetation-assets/`. It extracts geometry without
loading the source collection into the renderer. Collection display offsets are
excluded; measured height is normalized to one and the bottom is centered at
Y=-0.5 to match the existing grass candidate transform. Source normals and UVs
remain intact; winding is converted from glTF CCW to Godot CW and tangent
handedness is derived before that conversion. No population or physical field is
generated or altered.

The resolved manifest and prepared mesh product use relative paths and a
path-independent digest. Both source and prepared hashes are recorded. Missing
or edited sources fail offline ingestion rather than silently changing an asset.

## Source and license

[Grass Medium 01](https://polyhaven.com/a/grass_medium_01), by Rob Tuytel and Rico
Cilliers, from Poly Haven. All source geometry/maps are **CC0-1.0** according to
the [official asset license](https://polyhaven.com/license). Modification and
redistribution are allowed. Generated products retain this provenance.

Powered by Poly Haven: the ingestion tool uses its
[public API/download service](https://github.com/Poly-Haven/Public-API). The viewer
loads local prepared files and does not call that API.

Only CPU extraction/hash/parity tests are qualified at the first ingestion
commit. Rendering, alpha filtering, normal maps, layers and performance need
pinned-engine validation before claiming an artistic improvement. Tree assets
are deliberately absent: their raw exports contain millions of triangles and
require offline LOD/impostor preparation plus new shared C/V coverage tests.
