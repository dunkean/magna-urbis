# Underdark

The Underdark (*Outreterre*) is a world layer, not a relief: any relief, procedural or neural, can be carved into a cave system. In V2 it is the **World layer** control (`options.layer`): *Surface* or *Underdark*. Underdark sets `options.biome = 'underdark'`.

## Generation

The finished relief (coasts, sculpt and erosion included) goes through one Rust stage, `magna_urbis_terrain::underdark::carve` (`rust/crates/terrain/src/underdark.rs`), called by `TerrainGenerator::carve_underdark`. The browser engine exposes it as WASM `carve_underdark` and the local service as the `underdark` operation of `/terrain/relief`. The bridge (`rust/bridge/terrain.ts`) runs it once per relief when `TerrainSettings.underdark` is set, then the ordinary hydrology runs on the carved surface.

The relief is read as the floor of the underworld. It is not inverted.

1. **Floor.** The relief, lifted above zero. Its range is compressed above 600 m, which keeps the drainage.
2. **Tunnels.** The drainage of the floor becomes the corridors. Their radius grows with the upstream area, swells into irregular river rooms, and is warped so that D8 diagonals become meanders.
3. **Caverns.** Basins and plains lower than their surroundings, shaped by a broad noise, cover about 20 % of the map. Some rock pillars stand inside.
4. **Galleries.** The zero crossings of a warped noise give a sparse labyrinth of dry passages.
5. **Clean-up.** Small openings close and small rock grains open. Every remaining chamber joins the main network by its cheapest passage (Dijkstra through rock), so roads and rivers can reach every chamber.
6. **Walls.** The smoothed signed distance to the wall drives the rock height. Rock rises continuously from the floor of its nearest opening, starting two cells inside the rock so the display spline puts no step on the floor. Water falling on the rock drains into the nearest gallery.
7. **Lakes and silt.** Some caverns near a large river sink into an 8–18 m bowl. Then every closed basin of middling size (0.04 % to 2 % of the map, at least 4 m deep) stays closed and becomes an underground lake; all other basins, from small pits to huge drowned valleys, fill with sediment into flat cavern floors.

The output is the carved height and a **soft rock field**: 128 on the wall, ±96 per source cell, saturated inside a cell. Interpolated, it draws curved walls at any resolution. The region `caveMask` (0/1) remains for logic; the physical field `cave` (soft) feeds the GPU grounds, the wall polygons and the settlement raster (rock is `>= 128`).

## Consequences

- **Water.** The normal water chain runs: rivers flow in the tunnels and lakes fill the kept basins. Underdark water default: `condMode: 'none'`, since the carve already decided which basins stay (explicit settings win).
- **Settlements and roads.** Rock is class 2 at ground level: it cannot be built on or crossed. Towns settle on cavern floors and roads follow the tunnels.
- **Land use.** No climate forest. Natural cover gives moss and fungal beds (class 7) and bare floor (8). Farms are fungal farms.
- **Cultures.** Choosing Underdark sets the main culture to `drow-enclave`, unless it is already `duergar-hold` or `myconid-colony`.
- **Names.** Summit labels are not generated, because rock masses have no summits. The widest caverns (local maxima of the distance to the rock) are named with the `terrain.cavern` role, so the generic word follows the display language ("Cavern …", « Caverne … »).

## Render

- **Satellite and 3D** (`rust/bridge/terrainRenderUnderdark.ts`, shared by the 2D map shader, its WebGPU twin and the 3D ground):
  - The cave floor is limestone, basalt and wet sediment, under a cold key light.
  - Near-black fractured rock carries a lit ledge at the wall and ambient occlusion onto the floor.
  - Moss, bioluminescent fungi and giant mushroom groves grow on the floor, with stalagmites and debris at close zoom.
  - Fungal farms (champignonnières) ring every town: rectangular lots of compost ridges with rows of pale caps (`uFarmBeds`, from `underdarkFarmBeds`). The underdark plans no rural holdings, so the renderer places them; rock and water hide any that fall off the floor.
  - Water is dark and luminous at its edges.
  - There are no trees, snow, seasons or foam.
  - Towns are lit by the night lamps and cast a warm lantern glow on the cave floor (`uTownGlow`, 2D and 3D).
  - In 3D the sky is the black void of the vault.
- **Map styles.** The overlay draws the exact iso contour of the soft field: marching squares at 0.5 with no blur, so it meets the GPU cut. The underdark palette (`render/biomes.ts`) and the fungal marks (`render/underdark.ts`) apply.

## Tools

- `cargo run -p magna-urbis-terrain --example underdark_probe -- <seed> <width> <relief> <n> <out.ppm>` writes a shaded preview and a slope crop.
- `node scripts/render_board.mjs --recipe-patch '{"options":{"biome":"underdark","culture":"drow-enclave"},"runtime":{"backend":"native"}}' …` shoots a board. Add `--neural` with a neural recipe.
