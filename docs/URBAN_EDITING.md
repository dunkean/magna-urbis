# Urban Editing Contract

This document defines the commands and their scope in V2. The main panel must reflect this contract, without requiring knowledge of packs, role identifiers or the engine's internal steps.

## Hierarchy and main commands

**City → quarter → block → parcel → building.** A quarter contains several blocks; a block contains several parcels; a parcel may contain several buildings.

| Selection | Main settings | What is rebuilt | What acts as a limit |
|---|---|---|---|
| City | Culture, population, density, growth, street pattern | Urban layout, quarters, streets, blocks, parcels and buildings | Terrain, regional siting and external connections |
| Quarter | Culture, density, interior street pattern | Interior streets, blocks, parcels and buildings of the quarter | Quarter outline and the roads that bound it |
| Block | Culture, density, parcel division, building type | Parcels and buildings of this block | Block outline and peripheral streets |
| Parcel | Culture, building type, domestic occupancy if relevant | Program and buildings of the parcel | Available terrain, access and parcel outline |
| Building | Culture, building type, roof and floors if compatible | Selected building, for its architectural settings | Parcel, access and neighbouring constructions |

**Current limit on type from a building:** the program is carried by the parcel. Changing its type therefore acts on its parcel and its buildings. The panel must announce this, rather than pretend to modify a single building when several occupy the same terrain. Roof, floor and variation settings remain specific to the selected building.

A quarter is not an enlarged building: it may be given a dominant function in advanced settings, but it must not offer "arena" as though it were a quarter type. A whole block may accommodate a single complex if its division is "whole block"; otherwise, its type is applied to each of its parcels.

## Three actions, without ambiguity

- **Regenerate** applies the settings of the selection with the current seed. Same engine version, same inputs and same seed: same result.
- **The big die** chooses a new local seed and regenerates the selection and its descendants with the chosen settings. It never means "only the houses".
- **Parent settings** removes the local changes of this scope and its descendants, then regenerates with the inherited values. There is only one command of this type per selection.

Modifying a control prepares a change; the panel displays **pending changes** until regeneration. The command indicates the selection concerned. A successful regeneration replaces the result all at once. A refusal keeps the previous map and explains the blockage.

## Systematic propagation downwards

A change applied at one level replaces the edits of the lower levels in **this selection only**. Neighbouring selections and higher levels keep their settings.

1. Identify the selection and its descendants from the engine's links, not from displayed names.
2. Keep the explicit settings of the selected level.
3. Remove the overrides of its descendants: cultures, types, imposed models and seeds specific to the former objects.
4. Recalculate from the first affected product down to the buildings.
5. Reinstall the result and restore the selection if it still exists.

**Changing the culture** means changing the entire identity of the selection: cultural street pattern where interior streets exist, cultural division and architecture. Former packs, recipes and architectural cultures imposed at this level are removed; a street pattern or division from the former culture reverts to the cultural choice. A type explicitly requested, for example a temple, is re-evaluated within the new culture and must be compatible.

Rendering remains independent: textures, detail, palette, 2D/3D display, season and lighting are not reset by an urban edit.

## Compatible options and displayed values

A main list is **never the raw list of catalogue labels**. The presence of the word "arena" in a file proves neither that a source is available for the culture nor that there is enough room on the selected terrain.

To propose a type, check:

- its effective declaration in the generation catalogue and the culture concerned;
- the historical policy and the required context, notably navigable access;
- the available area, with a per-parcel requirement if several are modified;
- the engine's final validation on the real outline, access, relief and neighbours.

The main controls propose the types declared for the culture and compatible with the known area. Final geometric validation belongs to the engine: an entry that is compatible on paper may still be refused on a narrow or poorly served parcel. The refusal must be explained and must not silently turn the selection into empty terrain. A known incompatibility must not be presented as a normal option.

Controls display the effective value or an explicitly named automatic choice. "Follow the culture" is an inherited rule, not missing data. Do not invent a single value when the buildings of an area have different values. Lists and labels follow the interface language; internal identifiers remain stable in the data.

## Interface layout

The main panel contains only the table settings, the big die, Regenerate, the return to parent and the state of pending changes. The street pattern is chosen by icons, without an identical dropdown list beside it.

**Advanced** contains quarter functions, fine growth parameters, manual seeds, architectural models, recipes, materials, historical policy and diagnostics. A pack is a library of models; a recipe is a particular model; they do not constitute a second culture. Technical loading of the catalogue is not a primary action.

No table of vertices, coordinates or outline editing tool is exposed at this stage.

The 2D selection outline disappears when "select on map" is deactivated and when switching to 3D. The season and lighting controls remain accessible in 3D when they drive the rendering.
## Sharing and verification

The sharing code preserves the settings of each perimeter, the chosen types, the local seeds, and the rendering and scene choices. It carries a recipe, not the computed geometries. Reproduction is guaranteed only with the same engine version.

Validation covers the round trip of the code, the isolation of a city-block edit, culture propagation, deterministic regeneration of interior streets, compatible type changes, refusal of an impossible type without empty terrain, and preservation of the textured complex rendering.

The elven profile favours tree-dwelling dwellings: target share of 85%, against 15% ordinary houses, with a reproducible draw per parcel.

## Regional distribution and generation limits

The regional population is a budget of inhabitants, not an instruction to multiply small places. Automatic counts are bounded both by the map area and by a square-root growth of the population. A large population first fills the capacities of existing places; if necessary, a larger centre is added within the same ceilings. The usual cultural ceiling guides the initial composition, but no longer forces an imposed population to be dispersed across hundreds of camps or farms.

| Class | Area quota: one place per slice of | Automatic maximum per map |
| --- | ---: | ---: |
| City | 200 km² | 32 |
| Town | 100 km² | 8 |
| Village | 50 km² | 10 |
| Hamlet | 100 km² | 6 |
| Inhabited farm | 150 km² | 4 |
| Isolated site without inhabitants | 50 km² | 16 |

Slices are rounded up. The area quota is a ceiling, not a target: population, culture and available terrain may yield fewer places. Isolated sites likewise follow the population by square root; their density cannot exceed the automatic ceiling.

Deterministic example, European culture, temperate plain, seed `42`, a 40 × 40 km map and an imposed population of 10,000: one town, two villages, one hamlet, one inhabited farm and three isolated sites. The 10,000 inhabitants remain distributed across the five inhabited places. The farm does not receive a separate agricultural budget; the cultivated area remains tied to the population.

Explicitly entered counts or a manual list remain the user's choices. Editing a count imposes only that category. Editing the regional population or the density immediately recalculates the entire distribution and removes the previously imposed counts, including isolated sites. Population and density express the same budget: the last value edited takes precedence. "**Restore automatic distribution**" removes these imposed counts. If the area ceilings, the imposed counts or the fixed local populations cannot accommodate the whole requested population, the panel shows the population actually distributed; the calculation does not bypass the ceilings by adding hundreds of small places. The engine's ceiling for a single place remains five million inhabitants.

Choices and local populations remain stored in the MU3 code; automatic counts are recalculated deterministically with the generator version. A new regional generation invalidates the previous distributions stored by the engine.

Automatic construction of small places processes up to **32 places or 8,000 inhabitants per batch**, with land occupation, renaming and redrawing shared across the batch. The four sessions of the native engine keep the terrain between batches, then are released at the end or on interruption of the pass. A native thread takes a place whose prior neighbours are ready; independent places may advance while another waits for its neighbour. Installing the results preserves the canonical order. The WASM browser uses a single retained urban engine, to avoid four copies of the terrain and four worker pools on the same JavaScript thread; the engine may parallelise its internal steps.

Automatic batches respect neighbourhood dependencies: larger places go before their smaller neighbours. A place that would impose an unselected city, the reconstruction of neighbours already built, or exceeding the budget is deferred. It remains available for explicit construction in the Cities tab. Explicitly requested modifications and constructions keep their normal propagation.

The reproducible benchmark `web/scripts/v2_small_places_bench.mjs` measures only urban computation and exchanges with the native engine, with identical geometry. On the local test of 32 farms and 142 buildings, after warm-up and in ABBA order, reusing sessions reduces the mean time from 915 to 761 ms (about 17%) and the raster data sent from 4.46 to 1.12 MB. This figure excludes rendering and land occupation; grouping 64 small farms into two batches instead of eight also reduces the number of these regional processings. The total cost is not guaranteed to be identical to that of a large city: each place keeps its own siting and its own layout.
