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
14high /26impostor allocation without drops. The real-source/full-tour GPU correction is
not yet qualified by these CPU tests. A dedicated rerun must follow the frozen
ROOT V13 campaign; no GPU or long benchmark was run for this patch.
