# Native layer and canopy evidence

These measurements use Godot 4.7.2, Terrain3D 1.0.2 and the real Forward+ RTX 4090 backend, except the explicitly labelled CPU check.

- `layers-real-cpu.json`: retained teacher 512², compiler 1.5.1, independent images/premultiplied means and immutable-image cache; no neural-generation claim.
- `opacity-gpu-report.json`: **authored, non-IG** 17² fixture uses the nine new fields through production Data/main/shader bindings. Actual PBR beauty, mean, roughness and normal are unchanged at opacity 0 when low cover is hidden and at opacity 1 when ground is hidden. The independent linear mean transition differs by at most 0.587 byte.
- `canopy-meso-gpu.json`: 90 seed/cover/footprint cases and two source-ID/LOD/refinement changes at world origins 20 Mm and 1e9 m. This measures only the calibrated renderer approximation, never source candidate positions.
- `canopy-page-gpu.json`: exact retained 476-tree page, 175 selected IDs, seven footprints; composite optical coverage differs from the target by at most 0.334 percentage point. Flat canvas area proof, no physical-shadow claim.
- `canopy-shadow-gpu.json`: actual sphere caster versus optical-disc shadow direction, plus production canopy shader with a subpixel main-camera LOD and independently resolved observer/light cascade. The invisible caster matches the absent-caster image exactly. Orientation is tested; energy, penumbra and nonflat receivers are outside scope.
- `ground-mean-v151.json` and `ground-mean-v152.json`: saved GPU raw-ground images match an independent canonical bilinear CPU reconstruction within 0.611 byte. This isolates the old green steps to the source material mean, rather than UV, normals, illumination or native height import. The second source uses the continuous brown organic-soil recipe. Neither packet is a new V6 neural generation.

The GPU tests are reproducible with the scripts under `viewer-local/diagnostics/`. Full retained-source packets and screenshot sets remain generated outputs under `viewer-local/captures/` and the model worktree; report hashes identify their bytes. A final live campaign must use a newly frozen integrated snapshot.
