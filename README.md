<p align="center">
  <img src="docs/logo_magna_urbis.png" alt="Magna Urbis logo: a city map inside a compass" width="220">
</p>

<h1 align="center">Magna Urbis</h1>

<p align="center">
  <b>Procedural regions, towns and cities for maps and tabletop role-playing games.</b><br>
  Relief, rivers, roads, countryside and 115 urban cultures, from the first hill to the last roof, in 2D and 3D.
</p>

<p align="center">
  <a href="https://magna-urbis.org/"><b>Open the V2 alpha</b></a> ·
  <a href="https://magna-urbis.org/scientific/index.html">How it works?</a> ·
  <a href="https://github.com/dunkean/magna-urbis/releases">Desktop downloads</a> ·
  <a href="https://magna-urbis.org/gallery/v2/">Gallery</a> ·
  <a href="https://github.com/dunkean/magna-urbis/discussions">Discussions</a> ·
  <a href="README_FR.md">Français</a>
</p>

<p align="center">
  <img src="docs/images/readme/hero-italian-comune-3d.webp" alt="3D view of a walled Italian comune of 10,000 inhabitants, with red tile roofs, towers and a river crossing the town" width="100%">
</p>

---

## Magna Urbis V2 is in alpha

**Magna Urbis V2 is now available as an alpha**, in the browser and as a desktop application for Windows and Linux. Create a region, place its settlements, grow their towns, then explore and edit the result as a map or in 3D.

- **Web:** [magna-urbis.org](https://magna-urbis.org/). No account and no install. Generation runs in your browser (Rust compiled to WebAssembly, with WebGPU when available).
- **Desktop:** [GitHub releases](https://github.com/dunkean/magna-urbis/releases) for Windows x64 (installer or portable ZIP) and Linux x64 (AppImage or DEB). It includes the native Rust engine and native neural relief; you do not need Rust, Node.js or Python. macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.
- **V1:** the first version stays online at [v1.magna-urbis.org](https://v1.magna-urbis.org/).

This is an alpha. Results, settings and saved projects may still change between versions. If something breaks, a report with the share code helps a lot.

### What's in the V2 alpha

- **One chain from relief to roof:** procedural, neural or imported relief, rivers and lakes, climate and land cover, settlements, roads, towns and buildings, in 2D and 3D.
- **Credible regions:** settlements placed by access to water, room and culture; a regional population that keeps even alpine, arctic, desert and Underdark maps inhabited; villages with about one dwelling per household; harbours with quays, pontoons and cranes; fields that follow the farms, rivers and roads.
- **Towns on their terrain:** ground, buildings, roads, bridges, quays, walls and moats sit on the drawn relief in 3D, with one shoreline shared by the 2D map and the 3D view.
- **115 cultures**, villages and camps, from medieval Europe to dwarven holds, drow enclaves and myconid towns in the Underdark, mixable in hybrid style sheets.
- **Edit at every level:** city, quarter, block, parcel and building, with a parcel merge tool, editable place names and settlement renaming.
- **Map styles** (parchment, atlas, topographic, cadastre, satellite, painted satellite, minimal), day and night, through the seasons, with snow and pack ice in winter.
- **Neural relief** in the browser on WebGPU and natively in the desktop app, with verified model downloads reused offline.
- **Projects and exports:** binary `.muproj` projects, share codes, recipes, PNG, SVG and heightmaps.

What changed in each desktop version is listed in the [release notes](docs/DESKTOP_RELEASE_NOTES.md).

## What it generates

One chain, from the ground up. Every stage can be rerun, tuned or edited on its own.

1. **Relief**: procedural terrain with erosion, painted zones (plains, hills, mountains), volcanoes and calderas, or **neural relief** from Terrain Diffusion. You can also import a heightmap.
2. **Water and climate**: drainage, rivers, lakes from a climate water budget, river mouths and coasts, then climate-driven vegetation and land cover. An optional **Underdark** layer carves caverns, tunnels and lakes into any relief.
3. **Settlements and roads**: site choice, a rank-size hierarchy, one regional road network, farms, hamlets, chapels, inns, ferries and remote places on summits, islets or cliff ledges.
4. **Towns and cities**: composition and growth phases, quarters and streets, walls, gates and castles, bridges, parcels, a programme of who lives and works where, then building volumes with storeys and composed roofs. Neighbouring towns share their edges. The engine scales from a lone building to a metropolis of a million inhabitants.
5. **Maps**: parchment, atlas, topographic, cadastre, satellite and painted satellite styles, day or night, through the seasons, with names and labels as their own layer. Orbit, walk or fly in 3D.
6. **Edit and export**: change styles per quarter, parcel or building, reroll a scope, edit roads, rivers and labels. Export PNG, SVG, heightmaps, projects and recipes. With the optional local module, turn a view into an illustration or a battlemap.

**115 cultures:** 79 historical, fantasy and camp traditions (medieval Europe, bastides, medinas, Chinese and Japanese plans, Maya, Inca, Swahili, dwarven, elven, drow and many more), 27 modern, 8 futuristic and 1 alien. You can blend them in hybrid style sheets. Browse them all in the [architectural styles catalogue](https://magna-urbis.org/scientific/catalogue-architecture.html).

## Gallery

All images below are unretouched V2 screenshots.

<table>
  <tr>
    <td width="50%"><img src="docs/images/readme/venetian-lagoon-3d.webp" alt="Venetian lagoon town on both banks of a river, with canals and red roofs"><br><sub>Venetian lagoon town, 10,000 inhabitants</sub></td>
    <td width="50%"><img src="docs/images/readme/dwarven-3d.webp" alt="Dwarven town inside an angular stone enclosure, split by a river"><br><sub>Dwarven hold behind its angular wall</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/readme/chinese-3d.webp" alt="Rectangular walled Chinese city on an orthogonal grid, crossed by canals"><br><sub>Planned Chinese city, rectangular plan</sub></td>
    <td><img src="docs/images/readme/bastide-3d.webp" alt="Dense medieval bastide with red roofs in a polygonal wall"><br><sub>Bastide, polygonal plan</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/readme/wizard-city-night-3d.webp" alt="Wizard city at night with lit streets and tall towers"><br><sub>Wizard city at night</sub></td>
    <td><img src="docs/images/readme/tibetan-monastery-3d.webp" alt="Tibetan monastery town of white buildings in snow"><br><sub>Tibetan monastery town in winter</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/readme/persian-3d.webp" alt="Round Persian city inside a circular wall, crossed by a river"><br><sub>Persian round city</sub></td>
    <td><img src="docs/images/readme/drow-enclave-3d.webp" alt="Drow enclave of pale buildings on dark rock"><br><sub>Drow enclave</sub></td>
  </tr>
</table>

### Villages, camps and the countryside

<table>
  <tr>
    <td width="25%"><img src="docs/images/readme/village-norse-ringfort-3d.webp" alt="Norse ringfort village with longhouses inside a palisade"><br><sub>Norse ringfort</sub></td>
    <td width="25%"><img src="docs/images/readme/camp-mongol-ordu-3d.webp" alt="Mongol ordu camp of white yurts on the steppe"><br><sub>Mongol ordu</sub></td>
    <td width="25%"><img src="docs/images/readme/village-venetian-lagoon-3d.webp" alt="Venetian lagoon village with red roofs along a canal"><br><sub>Lagoon village</sub></td>
    <td width="25%"><img src="docs/images/readme/village-elven-3d.webp" alt="Elven village hidden under a dense forest canopy"><br><sub>Elven village</sub></td>
  </tr>
</table>

### Map styles

<table>
  <tr>
    <td width="25%"><img src="docs/scientific/assets/atlas/style-parchment.webp" alt="Town in the parchment style"><br><sub>Parchment</sub></td>
    <td width="25%"><img src="docs/scientific/assets/atlas/style-topographic.webp" alt="Town in the topographic style with contour lines"><br><sub>Topographic</sub></td>
    <td width="25%"><img src="docs/scientific/assets/atlas/style-cadastre.webp" alt="Town in the cadastre style"><br><sub>Cadastre</sub></td>
    <td width="25%"><img src="docs/scientific/assets/atlas/style-satellite.webp" alt="Town in the satellite style"><br><sub>Satellite</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/readme/metropolis-150k-topographic.webp" alt="Dense European metropolis on a river, topographic style"><br><sub>150,000-inhabitant metropolis</sub></td>
    <td><img src="docs/images/readme/medina-150k-atlas.webp" alt="Medina quarters along a river, atlas style"><br><sub>Persian and medina hybrid, atlas</sub></td>
    <td><img src="docs/scientific/assets/atlas/style-night.webp" alt="Town at night with lit streets along a river"><br><sub>Night</sub></td>
    <td><img src="docs/scientific/assets/atlas/underdark.webp" alt="Underdark map of caverns, tunnels and underground lakes"><br><sub>Underdark</sub></td>
  </tr>
</table>

Many more in the [V2 gallery](https://magna-urbis.org/gallery/v2/).

## How it works

- **[How it works? The illustrated atlas](https://magna-urbis.org/scientific/index.html)** ([français](https://magna-urbis.org/scientific/fr.html)): follows one world from the height field to the last roof, stage by stage, with diagrams and sources. Every **?** button in the app opens the matching chapter.
- **[Architectural styles catalogue](https://magna-urbis.org/scientific/catalogue-architecture.html)** ([français](https://magna-urbis.org/scientific/catalogue-architecture-fr.html)): the 115 cultures in 2D and 3D.
- [Technical and scientific overview](docs/TECHNICAL_AND_SCIENTIFIC_OVERVIEW.md): system layers, erosion, hydrology, neural terrain, settlements, references.
- [Method notes](docs/methods/README.md): one short note per implemented technique, with its sources and limits.
- [Documentation index](docs/README.md): rendering, recipes, cultures, designs and studies.

Under the hood: a **Rust** engine (terrain, water, settlements, cities, buildings) compiled twice, as **WebAssembly** for the browser and as a **native** local service for the desktop app. The interface and renderers are **TypeScript** with **WebGL2** and **WebGPU**. Neural relief runs in Rust too, with [Burn](https://burn.dev/) on the desktop and a small dedicated WGSL engine in the browser.

## Inspired by Watabou

Magna Urbis is inspired by **[Watabou (Oleg Dolya)](https://watabou.itch.io/)** and his [Medieval Fantasy City Generator](https://watabou.itch.io/medieval-fantasy-city-generator) ([TownGeneratorOS](https://github.com/watabou/TownGeneratorOS)). The project began as a Python port of TownGeneratorOS. That prototype is long gone, but Watabou's generators remain the reference for what a generated town should feel like: legible, varied and fun to read. Thank you.

## Related projects

Magna Urbis is part of a small family of worldbuilding tools.

### Neural Earth

**[Neural Earth](https://github.com/dunkean/neural-earth)** generates whole procedural planets, from tectonic plates to local terrain. It combines [World Orogen](https://github.com/raguilar011095/planet_heightmap_generation) planetary geography with the learned refinement of [Terrain Diffusion](https://arxiv.org/abs/2512.08309) (Goslin), and adds climate, hydrology, biomes, soils and seasonal rendering, with Python/CUDA or browser Rust/WASM/WebGPU paths.

Magna Urbis's neural relief comes from this work: the Rust port of the Terrain Diffusion chain and the distilled, quantised models published on [Hugging Face](https://huggingface.co/dunkean/neural-earth-distilled). The long-term goal is to place Magna Urbis towns and roads into Neural Earth worlds. That integration has not been delivered yet.

### Other projects

- **[Namebench](https://github.com/dunkean/namebench)**: a sandbox for personal names and place names. Magna Urbis embeds an extract of it (about 550,000 place names and 51 name generators, linked to its cultures) to name settlements, rivers, lakes, relief and regions.
- **[Lineage Lab](https://github.com/dunkean/lineage-lab)**: a sandbox for population histories and genealogies.
- **[Chronos](https://github.com/dunkean/chronos)**: a deterministic Rust history generator and chronology workshop for procedural worlds.
- **[AI RPG Generator](https://github.com/dunkean/AI_RPG_Generator)**: an earlier experiment in RPG content generation with language models and latent diffusion.

## Run from source

Requirements: Node.js LTS and npm, Rust through rustup (the toolchain is pinned in `rust/rust-toolchain.toml`) and `wasm-pack`. On Windows, also install the Visual Studio C++ build tools.

```sh
cd web
npm ci
npm run prepare:v2   # build the Rust terrain and houses WebAssembly packages
npm run dev:v2       # open http://127.0.0.1:5174/v2.html
```

Other commands, from `web/`:

```sh
npm run build:v2       # static site in web/dist-v2
npm run app:v2:dev     # desktop app in development
npm run app:v2:build   # desktop app and installer for this OS
npm run test:v2        # V2 tests
```

The [V2 launch and packaging guide](rust/desktop-v2/README.md) covers the native engine, browser neural relief and the optional Python modules. The [Rust README](rust/README.md) describes the engine crates. Releases follow the [desktop release guide](docs/DESKTOP_RELEASE.md); the web build follows the [web publication guide](docs/WEB_PUBLICATION_FR.md).

```text
rust/crates/terrain/   relief, erosion, hydrology, Underdark
rust/crates/core/      settlements, roads, cities and buildings (re-exports terrain)
rust/crates/local/     native local engine service
rust/crates/neural*/   neural relief: native and browser inference
rust/desktop-v2/       Tauri desktop application
web/src/v2/            V2 application
web/src/render/        shared 2D/3D renderers
docs/                  documentation, method notes and the illustrated atlas
```

## Contributing and feedback

Ideas, questions and generated maps are welcome in [Discussions](https://github.com/dunkean/magna-urbis/discussions). For bugs, open an [issue](https://github.com/dunkean/magna-urbis/issues) with the version, the share code or recipe, and a screenshot if you can. Read the [contribution guide](CONTRIBUTING.md) before a pull request.

Magna Urbis is mostly written by AI coding agents (Claude and Codex) under one human architect and reviewer. The [Ko-fi devlogs](docs/devlog/kofi-devlogs.md) tell how it is built, what broke and what worked.

## License and credits

Magna Urbis is free software under the **GNU Affero General Public License v3 only** (`AGPL-3.0-only`); see [LICENSE](LICENSE). Commercial use is allowed. If you run a modified version as a network service, you must offer its source to its users (section 13).

Third-party code, data, textures and model weights keep their own terms: see the [third-party notices](THIRD_PARTY_NOTICES.md), the [locked dependency inventory](licenses/dependency-inventory.json) and the [retained license texts](licenses/DEPENDENCY_LICENSES.txt). Neural relief models derive from [Terrain Diffusion](https://huggingface.co/xandergos/terrain-diffusion-30m) (MIT). Thank you to Watabou, Alexander Goslin, and every author of the papers, datasets and libraries this project builds on.

## Links

- **Magna Urbis V2:** [magna-urbis.org](https://magna-urbis.org/)
- **Magna Urbis V1:** [v1.magna-urbis.org](https://v1.magna-urbis.org/) ([source](https://github.com/dunkean/magna-urbis-v1))
- **How it works?** [magna-urbis.org/scientific](https://magna-urbis.org/scientific/index.html)
- **Support the project on Ko-fi:** [ko-fi.com/dunkean](https://ko-fi.com/dunkean). The code stays free with no premium tier; donations help pay for the AI agents that build it.
