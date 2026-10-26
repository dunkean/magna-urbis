# High LOD support culling follow-up

The first tree renderer required the **centre** of a tree to be inside the camera
frustum before considering its high LOD. A large crown can intersect a10m map
view with its centre outside the frame. Such a tree incorrectly remained an
impostor even when its physical diameter exceeded the500px high threshold.
The preserved ROOT V13 tour is the negative baseline; earlier GPU evidence is
not relabelled as testing this correction.

The high eligibility test now computes projected physical diameter first and
checks a transformed support AABB only for candidates at or above500px. That
support is the union of the actual imported high mesh and all five shader-generated
impostor quads, rooted at the original candidate position with the original
`(radius,height,radius)` scale and yaw. A plane rejects an AABB only when its
**entire** support lies outside the frustum. A small declared float32 margin is
conservative and can admit extra candidates; it cannot increase the14-tree /
2,000,000-triangle high budget. Remaining retained candidates keep impostors.

The five normalized quads fit local XZ`[-1.1,1.1]²`, Y`[-0.27781746,1.27781746]`.
After yaw their horizontal AABB extent can reach`1.55563492×radius`, so the old
world-axis`±1.1radius` MultiMesh bound was also insufficient. Custom MultiMesh
bounds now use the same transformed union. The independent visibility planner
uses a conservative1.56radius envelope, with source-height−12..+32m bounds.

New `canopyView.treeAssets` fields report:

- `highSupportTested` / `highSupportIntersecting`: eligible-size support queries.
- `highCentresInFrustum` / `highCentresOutsideFrustum`: actual selected high groups,
  classified by their centres **for telemetry only**.
- `highEligibility`: the named support/physical-pixel policy.

Existing `populationInstances.alphaPositiveInFrustum` remains a centre-based
gate and can still be zero while an offscreen-centred crown intersects the view.
Neither the new counters nor the AABB tests claim GPU occlusion, leaf coverage or
alpha-positive raster fragments. The C/V mask, source fields, candidates, root Y,
rank/IDs, budget and canonical optical mean are unchanged.

CPU reproduction (no textures or GPU are loaded):

```powershell
godot --audio-driver Dummy --headless --path viewer-local --script tests/surface_tree_support_test.gd -- <tree-resolved.json>
```

The test covers the source-derived V12 position/radius/height with authored yaw
controls: centre outside a10m frame, physical diameter2176.48px, intersecting
support; fully outside and behind-camera controls; all five quad corners at four
yaws; both±1e9 rebases; root buffers; actual-mesh union; stable IDs/ranking and
14high /26impostor allocation without drops. These CPU tests do not qualify GPU
appearance or a full V14 campaign.

## Dedicated GPU follow-up

After the ROOT V13 campaign released its GPU, two sequential A/B pairs ran on
RTX5090 /Forward+, same retained V12 packet`e9646f0a…079d2c` and same prepared
asset`e3243d0d…f4bde`. A new detached baseline at`a7e44ab` was compared with corrected
`d708ba7`; ROOT6ef and its V13 results were never edited. Both profiles use TOP10m,
1600×1000px, explicit32m camera clearance. Actual native runtime hashes were read
before and after **each** run and matched. [high-support-gpu.json](high-support-gpu.json)
contains the hashes, commands, metrics, physical snapshots and artifact SHA256s.

The first camera at20000/20000 changed0high/26impostors into1high/25impostors,
with all centres still outside. The atlas C/count hash,26IDs, root/terrain/ground
fingerprints and disabled-tree pixels matched. However, opening its PNG showed
**no visible foliage**: this conservative support intersection was a false positive
for actual alpha. All-layers and no-trees images were identical. This mechanical
eligibility test is not presented as an artistic correction.

The second camera was panned to20001.56562328823/19995.02898969222 around the same
existing tree. Its centre is5.2m to the right of a10m-wide frame, while visible
foliage intersects the right side. It again changes0high/26impostors into
1high (134,295triangles)/25impostors, with`highCentresInFrustum=0`. Atlas C/counts,
source/IDs, parent/ground, retained26instances and no-trees/ground central pixels
remain identical. The actual foliage image changes; no alpha-positive centre or
fragment count was invented. Only existing Terrain3D deprecation warnings occur.

- [Same-camera impostor baseline](high-support-before.png)
- [Correctly eligible high tree](high-support-after.png)

This same-camera comparison also **confirms a separate unresolved lighting pop**:
the high foliage is markedly darker than the impostor. The culling correction
does not solve normal/BRDF/albedo parity. No new light/color tuning was added to
hide it, and no physical or artistic final acceptance is claimed. The new runner
`web/scripts/surface_tree_support_gpu.mjs` reproduces the pairs; use
`--x 20001.56562328823 --z 19995.02898969222 --require-visible-change` for the second.
It keeps the original source packet untouched and checks actual runtime hashes,
budget/IDs, atlas and disabled-layer invariants. Both GPU pairs exited, no owned
Godot remained, and the GPU was explicitly released to the other work.
