# Settlement styles and independent generation stages

## Objective and inputs

A cultural choice initializes a coherent settlement. Spatial composition, cadastral
fabric and building culture remain independently editable afterwards. Inputs are
the retained terrain in metres, planning population, seeded urban configurations
and optional architectural overrides. Population is a planning budget, not proof
of built capacity.

## Applied settings

The style controls select existing native methods; they introduce no new growth
simulation. A dense core uses one nucleus, one epoch, core recipes throughout,
density multiplier 2, contiguous frontage strips, a planning budget of 300 inhabitants/ha,
5–8 m requested frontages, 14–24 m requested plot depths, coverage 0.92–0.97,
2,400–3,600 m² target blocks, 60 m grid lanes and 120 m grid streets,
8,000 m² wards, 350 m² minimum blocks and a 12 m minimum cut width,
continuous growth and no satellites. Native architectural minima can increase
the requested parcel dimensions. A wall is an explicit
independent choice. A growing town retains the cultural age gradient; a village
uses village recipes throughout. Selecting a culture or cultural defaults clears
previous presets and parameter overrides across the three stages. Selecting an
individual architectural culture changes only placement requests.

Layouts retain their applied layout configuration, and partitions retain their
applied parcel configuration. Building occupation is resolved from these retained
inputs, including density, zone, recipe and explicit parameter overrides. It is
not reconstructed with an implicit density of one. Old snapshots without retained
configurations use the former cultural fallback.

The automatic building palette is seeded per stable parcel identity. It considers
residential recipes in the selected pack and land family, or the explicitly chosen
typology, and respects era and late-tradition restrictions. It tries at most two
seeded recipes plus the original cadastral admission recipe. Variants are drawn
normally; the canonical default remains the final minimum-envelope fallback.
Every candidate still undergoes the native containment, access, terrain and roof
checks. Exact Houses replays keep their recipe, dimensions and native plan.

**Fit dimensions to the lot** is independently editable. In inspired/fantasy
mode, automatic single, strip and simple court layouts can fit the occupation
target up to twice the source maximum width/depth. Source minima, requested
levels, culture, materials, roof rules and final geometric admission remain
binding. This is an explicit artistic urban adaptation; strict historical mode
and exact Houses models do not use it. Turning it off retains the catalogue's
dimension ranges. It does not scale already generated geometry: the native plan
is constructed at the selected dimensions and retained for enrichment.
When one site span limits the preferred cultural width/depth ratio, the remaining
requested area is redistributed along the other axis. Placement aligns the full
physical envelope (including roofs, courts and passages) with the lot and street;
an off-centre door no longer forces an otherwise fitting row house back to its
canonical minimum. Concave land and every access/containment check remain binding.

## Determinism, scale and limitations

The same inputs and seeds reproduce the same configuration and placement. Display
style, zoom and 2D/3D projection never reroll it. No LOD-specific generation rule
is added. A manually chosen building can fail to fit an independently chosen
parcel: selecting Chinese architecture does not enlarge an existing small lot to
hold a complete siheyuan. Chinese frontage parcels can use native shop houses;
court parcels retain their complete court recipe. Refusals remain visible.

The TypeScript reference also supports the burgage cycle, corner conformity and
perimeter-block infill. The style selector alone does not claim full geometric
parity with those operators. Dense native frontage infill is described with the
architecture placement method when enabled.

## Implementation sources and validation

Primary implementation references are `web/src/gen/urban/morphology.ts`,
`web/src/gen/urban/buildings.ts`, `rust/crates/core/src/urban/composition.rs`,
`rust/crates/core/src/urban/culture.rs`, and
`rust/crates/houses/src/placement.rs`. Presets are artistic procedural settings,
not measured historical reconstructions.
For the conceptual town-plan context of frontage infill, see M. R. G. Conzen,
[Alnwick, Northumberland: A Study in Town-Plan Analysis (1960)](https://doi.org/10.2307/621094).
The preset numbers and bounded native rules are our artistic adaptations;
the publication is not a source for these numerical settings.

Reproduce the dense case with Chinese culture, 3,000 inhabitants, seed
`42`, the dense walled style, and flat dry terrain. Reproduce
independence with a tentacular form, no suburbs, dense frontage parcels and
Chinese building culture. Validation records are generated under ignored
`web/out/buildings-parity/`.

Validated on 22 October 2026: 96 native urban tests, 20 placement tests, the
native range/partition integration regression, and 35 focused web tests passed.
Native Clippy with warnings denied, targeted rustfmt checks and TypeScript
typecheck passed. The standalone application and bench builds passed. Both
WASM and Local/Rust completed the dense Chinese and independent tentacular
cases without JavaScript errors. Local/Rust also completed a 200-person Chinese
village; the current script checks all three cases and preserves planning
population through style changes:

```sh
node scripts/urban_settlement_styles_ui_check.mjs
node scripts/urban_workshop_ui_check.mjs http://127.0.0.1:5173/urbanbench.html?profile=local
```

The native API check also verified retained terrain, programme allocation,
placement, exact chunk-size invariance and detailed enrichment. All 53 declared
cultures have core/village presets and native mappings; this is contract coverage,
not an exhaustive visual review of every culture, population and override.
