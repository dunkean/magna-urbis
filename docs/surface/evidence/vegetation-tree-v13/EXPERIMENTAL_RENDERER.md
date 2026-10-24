# Experimental tree consumer

`--tree-assets <resolved.json>` opts into the prepared CC0 tree in aerial views.
The default remains the previous renderer. Cartographic views never attach the
asset descriptor to population preparation and keep their source palette/glyphs.
No canonical field, candidate ID, acceptance, position, size, rotation or rank is
changed. The CPU descriptor is attached only to a private packet wrapper; GPU
textures are created by the UI consumer. Packed buffers are borrowed read-only
by ownership convention, not a claim that Godot freezes array elements.

The same derivative supplies the 1024² binary top mask (constant alpha threshold
0.5), root pivot, atlas C, four selected-count bins, top impostor and high tree.
The calibrated mesoscopic mean uses the unchanged candidate process and rotated
mask, including overlaps, rather than scaling potential cover by one opacity.
The independent Monte Carlo audit is separate evidence; it establishes a bounded
mean error, not exact/unbiased calibration or GPU equivalence.

The nearest LOD has 134,295 measured triangles. Only trees with projected physical
crown diameter at least 500 pixels qualify; stable sorting caps the group at
14 trees / 1,880,130 triangles. Every other retained tree has a two-triangle,
five-view impostor from the same derivative. Old high trees switch to that same
mask impostor during a pending-atlas transition before the new high group is
allocated. This keeps the submitted high budget bounded without removing IDs.
Both models use the original candidate root and nonuniform `(radius,size,radius)`
scaling, rather than the legacy sphere's raised crown transform.

Exact C may use its entire mip chain. Selected V uses a bounded 8×8 dyadic kernel.
A whole-view certificate therefore caps phase at 1 (geometry weight zero) whenever
the maximum pixel footprint divided by **active** atlas spacing exceeds 8, or the
corresponding limit of a smaller texture. There is no `min(C,V)` correction.
The certificate bounds the shader's finite one-metre screen differences over the
entire horizontal rectangle of the frustum/height envelope. The numerator is an
affine vector in the other horizontal coordinate; its minimum norm is computed
analytically, including possible interior minima. Endpoints behind the camera
invalidate the certificate. A declared 0.1% relative plus 1 µm absolute margin
covers measured float32 probes; this is not an unbounded floating-point theorem.
General yaw/roll can make the rectangle bound conservative and disable geometry.

CPU checks exercise the reported oblique counterexamples, resized viewports,
rotated poses, stale active spacing and dense finite-step samples. They also test
real imported triangle counts, root/rebase transforms, budget/ID conservation,
asset masks/counts and cartographic packet exclusion. These checks are not GPU
silhouette or artistic qualification.

The optical shadow uses total C and a declared 0.53° solar angular diameter with
the existing 9.8039 m reference height (roughly 0.091 m footprint floor). It remains
an approximate ground transfer; native tree casting stays disabled. Ground,
low-cover and tree toggles remain independent. The five-view impostor has planar
depth, discrete view changes and approximate oblique silhouette/occlusion. Only
top mask/count consistency is intended for the initial C/V qualification; this
does not establish physically exact 3D coverage, parallax or forest shadows.

Reproduce the CPU checks with the pinned Godot 4.7.2 executable:

```powershell
godot --audio-driver Dummy --headless --path viewer-local --script diagnostics/check.gd
godot --audio-driver Dummy --headless --path viewer-local --script tests/surface_tree_filter_test.gd
godot --audio-driver Dummy --headless --path viewer-local --script tests/surface_tree_branch_test.gd -- <resolved.json>
```

GPU qualification and full navigation performance are pending for this commit.
