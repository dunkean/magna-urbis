# Complete family inventories

`candidatePages.version = "surface-candidate-pages-1"` accompanies the existing
candidate columns. `tree`, `shrub`, `boulder`, `grass` and `debris` each declare:

- `bounds`: the actual complete query rectangle in the canonical X/Z frame;
- `requestedBounds`: the initial rectangle before a budget reduction;
- `count`, `complete:true`, `includeOverhang:true`, `retention:1`;
- `limitedBy`: `none`, `candidate-budget` or `slot-budget`.

Completeness means every accepted canonical candidate whose physical radius
intersects that family's declared rectangle is present. A centre may lie outside
the rectangle because its crown overhangs it. There is no rank thinning. It does
not mean that a reduced rectangle covers the camera or the complete territory.
Renderers must check their full visible footprint and halo against the **actual**
tree bounds. A reduced page can still serve a smaller camera entirely contained
inside it. Otherwise a renderer needs its declared distant representation.

The live worker queries trees on the full canonical source world. Tree width is
`min(4000, max(480, requested source extent))` metres. Other families retain a
local rectangle up to480m wide. A shared maximum of100,000 candidates applies;
the local families initially reserve at most one quarter of that budget. A query
that exceeds candidate or potential-slot limits halves its physical width and
retries until the whole accepted inventory fits. It throws if even a complete
focus query cannot fit. The rejected larger query is never published as complete.
`candidateBounds` remains the small local rectangle for legacy consumers.

IDs, rank, acceptance, size, orientation, seed and X/Z positions use exactly the
existing canonical cell process. Sampling eligibility now avoids constructing
material/colour/provenance results for rejected potential slots; nearest
categories and bilinear arithmetic match `sampleSurface`. Frozen pre-layer
candidate fingerprints remain unchanged.

Support heights are separately refined: only points inside the fine grid's
minimum/maximum **sample centres** use that fine source. Other points use the
actual retained parent kernel when available within its support, otherwise the
canonical heightfield. The fine tile edge is never extrapolated over the larger
tree page. `candidatePages.support` identifies the source generations, kernels,
native spacing, supports and counts. This height selection may legitimately
change Y; it cannot change the inventory's other properties or canonical fields.

The worker's canonical context and source/scene epoch validation remain in place.
Candidate pages are additive schema1 metadata; legacy packets may omit them and
must not be interpreted as a newly complete tree inventory. Boundary validation
checks page shapes, family counts, source/context references and support totals.

For a CPU-only retained-source replay and a renderer fixture:

```powershell
node --import tsx scripts/benchmark_surface_candidate_pages.ts `
  --source path/to/fresh-source.surfacebin `
  --refinement path/to/live-refinement.surfacebin `
  --out out/surface/candidate-pages
```

The inputs must contain identical canonical physical fields. The output changes
only candidate columns and their page metadata, keeping world/source/urban and
parents byte-identical. This diagnostic does not generate a new source, request
new fine terrain, qualify GPU rendering or prove that a visual page seam is fixed.
