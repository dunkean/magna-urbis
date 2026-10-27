# Settlements & City Bench: map on the left, city on the right

Date: 2026-10-25. Replaces the layout in `2026-10-25-city-panel-design.md` (the “most specific wins” rule and house mixing remain).

## Intent

The user changes their city **live, without opening 15 menus**. Visual changes are **one click** away; everything else is in **⚙ Advanced**. The interface is **compact**: no space-consuming titles, **icons** where obvious, dense rows. Clearly distinguish **map** settings (all settlements) from **city** settings (the selected settlement).

## Layout (Settlements and City Bench, same code)

```
[ map bar: display, views, layers ]
[ Map (left ~230px) | map | City inspector (right ~340px) ]
```

### Map panel (left): settings for the whole map

Compact groups (one icon + one row, no section heading; ⚙ on the right opens details in place):

- ⛰ **Terrain**: loaded terrain (City Bench: catalogue + load).
- 🏘 **Settlements**: counts by class in numeric badges (city / town / village / hamlet / farm), default culture. ⚙: mode, distribution, population, spacing, geographic weights, site types.
- 🛣 **Routes**: exits (0–16), network (level), density. ⚙: surfaces, road culture, routing, rendering.
- 🌾 **Land use**: “auto” checkbox **off by default** (no automatic generation); everything else behind ⚙.
- Settlement **list** as badges (class icon, name, population); click selects (same effect as clicking the map); ＋ place.
- City Bench: Terrain and Routes only (one city in the centre, edited in the inspector).

### City inspector (right): selected settlement

1. **Header**: class icon, name, population (editable), city type (Auto → resolved, or forced); **Plan · Lots · Houses** stage badges (state, click reruns that stage and subsequent ones); **⟳ Auto**; **▶ Generate**. “Apply to all settlements” link (replaces the “All” scope selector).
2. **General row**: 🎨 culture (default “from place”), 🧱 enclosure; “+ influence” (other culture, share, distribution) collapsed while empty.
3. **Phase grid**: rows = aspects 🎨 Plan · ╬ Streets · ▦ Blocks · ▤ Lots · ⌂ Houses; columns = All · ◉ Core · ◎ Ext. · ○ Per. · ⋯ Suburbs (Village for small types, absent phases greyed out).
   - Inherited cell: grey italic “↳” (source on hover). Chosen cell: orange, ↺ on hover.
   - Clicking a cell opens a small inline choice list (popover), one click to choose.
   - Houses opens the existing mix editor.
   - Blocks: shape of quarters/blocks (phase recipe if present; otherwise remove the column, at the implementer's discretion according to what the engine already exposes).
4. **Selected quarter** (click a quarter): add a “Quarter n” row below the grid, same columns.
5. **⚙ Advanced**: one drawer, organised by stage, containing everything else: composition and footprint (hidden by default), detailed skeleton (axes, exits, ring road, suburbs), slopes and stairs, recipes, presets, JSON parameters, seeds, programme and building detail.

Display (Tissue/Uses/Parcels/Buildings/Roles views, layers) stays in the bar above the map: it is not generation.

## Regional roads: more than four exits

- Exits are no longer “one per edge”: N exits (0–16) distributed by **angular sectors** around the main city, each targeting the edge point in its sector (lowest cost / closest), with minimum edge spacing.
- Two nearby exits can **join**: existing trunk sharing / A* reuse naturally merges them.
- **Different widths**: class comes from traffic as today; exits have decreasing weight (the first is a major road, subsequent ones secondary), so they do not all have the same size.
- Old links (exits ≤ 4) remain valid; geometry may change.

## Non-goals

- No change to urban generation (plan, parcels, houses).
- No settings removed: everything not one click away remains accessible through ⚙.

[Original French version](2026-10-25-settlements-ui-redesign_FR.md).
