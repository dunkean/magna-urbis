# City panel: one rule, one table, mixed house styles

Date: 2026-10-25. Replaces the `81b3a41` arrangement (“City generation” + “Advanced options”).

## Intent

The user should **understand and act on their city** without wondering which setting overrides which. Currently culture is configured in five places, some global settings override phase choices (recipe, preset, zone) while others do not (mesh, operator), houses follow the phase culture without mixing or logic, and villages silently ignore phases.

## One rule (engine and interface)

**The most specific setting wins: place culture → City → Phase → Quarter → Lot.** An unselected value inherits from the level above; the interface always shows the effective value and its source.

Engine consequences (small, with serde defaults to preserve old links):

1. An overridden phase (`phaseOverrides[zone]` with culture or recipe) **ignores** global `recipe`, `preset` (when not `culture`) and `zone` (when not `auto`) in both `LayoutConfig` **and** `ParcelConfig` for its phases. Non-overridden phases keep current behaviour. (Currently `composition::phase_morph` takes `cfg.recipe` whenever it is not `auto`, and `resolve` takes `cfg.preset` whenever it is not `culture`: this inversion must be corrected in `quarters.rs` and `parcels.rs`.)
2. Mesh and operator already follow the rule (quarter > phase > global > recipe): do not change them.

## Houses: mixed styles

New building setting (in built-scene settings, passed to the engine along the existing `architectureCulture` / `architecture_culture` path in `building_sites.rs`):

```
houses: {
  city?:     HouseMix,                 // “Whole city” row
  zones?:    { [zone]: HouseMix },     // core, middle, edge, faubourg, village
  quarters?: { [quarterIndex]: HouseMix } // quarter inspector
}
HouseMix = { styles: [{ culture: string, weight: number }], spread: 'lot' | 'block' | 'quarter' }
```

- Resolve per lot: quarter → block zone → city → current lot culture (`allocation.culture`, therefore the phase culture). An empty or absent mix means inherit.
- **Deterministic** weighted draw: scene seed + key determined by `spread` (lot ID, block ID or quarter index). `block`/`quarter` produce coherent groups (one community per block or quarter); `lot` mixes house by house.
- The drawn culture replaces `building_culture` in `building_sites.rs` (the same path as the existing override, so `parcel_mapping`, admission, architecture pack and `massing.rs` volumes follow without further changes). If the drawn pack rejects the lot, fall back to the lot culture (the mix adds no rejection).
- The old “Building cultural profile · override” becomes `houses.city` with one style at 100% (migrate when reading old links).
- One Rust test: same seed → same draw; weights 0/100; `block` yields one culture per block; old setting is read as `city`.

## Interface (CityBench and Settlements, same component)

A single compact **“City”** panel, from top to bottom:

1. **Action bar** (sticky at the top of the panel): scope `All · all settlements | <city>` (hidden in CityBench) · `⟳ Auto` (one switch, also covering settlements and routes auto-refresh) · **Generate** button · three stage badges **Plan · Parcels · Houses**: state (current / needs rebuilding / running / error); clicking a badge reruns that stage and subsequent ones.
2. **City**: Culture (default “Place culture (x)”) · City type (`Auto → <resolved type>` or forced) · Influence of another culture (culture, share, by phases/sectors; collapsed while empty). For a village or smaller: a line “Simplified form: phases do not apply; only the Whole city row matters”.
3. **Skeleton** (one collapsible row with visible summary: “Enclosure by culture · 3 roads · regional axes”): enclosure/fortification, enclosure style, axes, exits, ring road, suburbs. These come from culture and roads and are distinct from quarter mesh.
4. **Phase table** — rows: **Whole city**, Core, Expansion, Periphery, Suburbs (Village for small types); columns: **Plan** (culture/recipe), **Streets** (mesh), **Lots** (subdivision), **Houses** (mix).
   - Inherited cell: grey “↳ organic” text (hover source: “from Whole city” / “from culture”). Chosen cell: normal text + `↺`.
   - The Whole city row carries former globals: `tissue`, `operator`, building override → `houses.city`.
   - Houses cell: summary “European 70% · Hanseatic 30% · per block”; click opens a small inline editor (list of weighted styles, add/remove, lot/block/quarter distribution).
   - Phases absent from the displayed city are greyed out, not hidden.
   - House style therefore no longer belongs in advanced settings; building display mode (Volumes / compact / detailed) is a selector next to the Houses badge.
5. **Selected quarter** (appears when a quarter is clicked on the map, using the existing inspector): the same four columns for that quarter (existing `overrides.quarters` for culture/mesh; `houses.quarters` for houses), with ↺.
6. **Details** (a button): everything else, grouped by stage, without removing anything. Global recipe / preset / zone / JSON parameters remain here, labelled “for phases not selected in the table”.

The display panel (Tissue/Uses/Parcels/Buildings/Roles views, layers) remains separate: it is not a generation setting.

## Non-goals

- No new house typology (row/courtyard/detached) in the mix: styles (cultures) only. Existing typology remains in Details.
- No redesign of Terrain/Settlements/Routes stages beyond the shared Auto switch.
- No geometry change for links that use none of the new fields.

## Left to the implementer

Fine layout, CSS, exact wording in the spirit above; module boundaries (`urbanMainPanel.ts` may be rewritten); anything supporting the single rule without expanding it.

[Original French version](2026-10-25-city-panel-design_FR.md).
