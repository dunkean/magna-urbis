# Fantasy brushes guided by territory occupation

## Objective and inputs

Optionally illustrate the retained land-use polygons with watercolor or ink
brushes, without changing terrain, occupation, water or urban geometry.
Inputs are the seed, map extent and coordinates in metres, altitude in metres,
slope as a rise/run ratio, temperature in degrees Celsius, annual precipitation
in millimetres, and the generated occupation polygons with their holes.

## Implemented method

The existing world-anchored jittered grids and seeded hashes own the candidate
positions. A 64-by-64 uniform spatial index selects polygon candidates, then
the existing `pointInRing` crossing test classifies the exact position. Polygon
holes are tested separately and excluded. This uses the even-odd principle
described by [W. Randolph Franklin, PNPOLY](https://wrfranklin.org/Research/Short_Notes/pnpoly.html);
it reuses the repository's implementation rather than importing Franklin's code.

With `brush_landuse=1`, forest anchors accept individual tree brushes; fields
and gardens accept crops; orchards accept orchard motifs; marshes accept
wetland motifs; meadow, pasture and commons accept sparse grasses. Unclassified
positions receive no occupation brushes. Climatic tree families remain selected
from temperature and rain. Mountains and hills continue to follow relief.
With the option off, the existing climate-based suitability rules apply.

Tree anchors are rejected where the mountain suitability exceeds 0.16. In
addition, summit stamps populate a spatial index of conservative silhouette
rectangles. A candidate tree is rejected if its conservative rectangle overlaps
a summit rectangle, including when its anchor is on neighbouring low terrain.
These rectangles are a project-specific visual rule, not a physical vegetation
or ecological model. They do not implement pixel-perfect alpha-mask collisions.

All motif widths are multiplied by 0.55, a 45 percent reduction relative to
the previous scale. Candidate spacing and density remain independent. The
additional size control ranges from 0.1 to 2.0.

## Determinism, display and scale

Changing visibility, opacity, or the per-kind display filters does not alter
the occupation sampler. Hidden forests can therefore still guide fantasy trees.
Regenerating or disabling occupation invalidates the retained painting context.
The option and display controls are serialized with the displayed map settings.
The same planned stamps feed SVG and Canvas, including the flyover texture.
Camera changes retain the whole-map scene; this change adds no zoom-dependent
randomness. Existing candidate and stamp budgets still apply.

The global occupation opacity includes its fills, vegetation, field marks,
hedges, agricultural paths and farm objects. Per-kind visibility filters the
display copy only. Forest, orchard, field, garden, meadow, pasture, marsh and
commons are independently selectable; farm objects have a separate toggle.

## Limits and reproducible validation

Enable occupation generation in Settlements before enabling its guidance.
If no occupation is available, guidance draws relief only, rather than inventing
forest. Polygon classification constrains anchors; brush edges may overhang
occupation boundaries. Mountain exclusion is conservative and may leave small
clearings. This does not regenerate occupation or model treelines physically.

From `web/`, run:

```sh
npx vitest run --project fast tests/fantasyPainting.test.ts tests/fantasyUrban.test.ts
node scripts/fantasy_occupation_ui_check.mjs http://127.0.0.1:5173/terrainbench.html
```

On 2026-10-21, all 11 focused tests passed. Fixtures include seed `fantasy-42`,
150 m pitch, forest/field/orchard strips, missing occupation, a 2,000 m ridge
beside low forest, a concave polygon with a hole, overlapping crop replay,
water/quarter exclusion, and terrain-input preservation.

The Chrome check also passed on an isolated working copy with the retained
`d001-hills-inland-hamlet` decor: hiding occupation preserves the brush scene,
display filters do not regenerate occupation, settings survive a reload, SVG
embeds the displayed occupation canvas and opacity, and the bundled method
help opens without JavaScript errors. Screenshots are in `web/out/fantasy/`.
