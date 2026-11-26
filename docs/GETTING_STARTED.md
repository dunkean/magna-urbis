# Getting started

This guide takes you from an empty page to your first town, then shows how to save, share and export it. It takes about ten minutes.

## 1. Open Magna Urbis

- **In the browser:** go to [magna-urbis.org](https://magna-urbis.org/). No account and no install. A recent Chrome, Edge or Firefox with WebGPU is fastest; without WebGPU, generation falls back to the CPU.
- **On the desktop:** download Windows (installer or portable ZIP) or Linux (AppImage or DEB) from [GitHub Releases](https://github.com/dunkean/magna-urbis/releases). The desktop app runs the Rust engine natively and is faster on big maps. A macOS preview for Apple Silicon is available from alpha 0.3.10.

Magna Urbis is an alpha: settings and saved projects can still change between versions.

## 2. Create a region

The first screen is empty on purpose. In the **Topography** step:

1. Pick a **width** (from 500 m to 100 km; new regions start at 6 km).
2. Choose the **coasts** on the compass: inland, one or more sea sides, island, archipelago or peninsula.
3. Pick a **biome** and a **relief type**, or leave the defaults.
4. Click **Create my region**.

This builds only the land: relief, rivers, lakes, coasts and natural cover. No town exists yet. You can paint relief zones (plains, hills, mountains) before generating, or import a grayscale heightmap instead.

## 3. Place settlements and roads

Open the **Settlements** step. Choose how many places you want and how large they are (automatically, by class or from an explicit list), then generate. Magna Urbis picks sites by access to water, room and culture, ranks them from hamlet to city and routes the regional roads between them.

No building is created at this stage. If you only change the road settings, **Recalculate roads** keeps the chosen sites.

## 4. Build the towns

In **Build settlements**, build every place at once or select one place on the map and build only that one. A town grows through its plan, quarters and streets, then parcels, then its programme (who lives and works where), then houses with storeys and roofs.

Select a town to change its **culture** (115 of them, from bastides and medinas to dwarven holds and drow enclaves), its size, walls, density or growth, then rebuild it.

## 5. Explore and edit

- Switch the **map style**: parchment, atlas, topographic, cadastre, satellite, painted satellite, minimal; day or night; any season.
- Tilt into the **3D view** to orbit, walk or fly over the town.
- Edit at any level: town, quarter, block, parcel and building. Merge parcels, rename places, move labels, edit roads and rivers, or reroll just one quarter.

## 6. Save, share and export

- **Project (`.muproj`):** saves the whole map exactly, including your edits. Use it to keep working later.
- **Share code:** a short text code that rebuilds the same map from its seed and the settings you changed. Paste it in **Open a code or link**. Share codes are what to include in bug reports.
- **Export:** PNG or SVG of the whole map or a cropped area, with the style and layers you choose, plus heightmaps. Exporting never reruns generation.

## Start from something that already exists

- **OpenStreetMap:** use **OpenStreetMap** in the top bar to search a real place, preview its elevation and generate a map from its data. You can keep the real streets and let Magna Urbis generate parcels and buildings in the culture of your choice.
- **Azgaar's Fantasy Map Generator:** paste an FMG burg (the export script result or a burgs-overview CSV row) in **Open a code or link**. See [Importing an Azgaar FMG burg](AZGAAR_IMPORT.md).
- **Watabou:** paste a link from Watabou's city or village generator in the same dialog. The town keeps its name, population, walls, river and coast.

## Going further

- [FAQ](FAQ.md): hardware, saving, licence, common problems.
- [Map styles and layers](RENDERING.md), [Underdark](UNDERDARK.md), [V2 workshop reference](V2_WORKSHOP.md).
- [How it works? The illustrated atlas](https://magna-urbis.org/scientific/index.html): every stage explained, with sources. The **?** buttons in the app open the matching chapter.
- Questions and maps to show off: [Discord](https://discord.gg/3yFq8t8Q2W).
