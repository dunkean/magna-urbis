# FAQ

## General

**Is Magna Urbis really free?**
Yes. The web app, the desktop app and the source code are free, with no account, no paywall and no premium tier. The project is funded by donations on [Ko-fi](https://ko-fi.com/dunkean).

**Can I use the maps I make in my game, book or commercial product?**
Yes. Commercial use is allowed. The AGPL licence covers the software itself: if you run a modified version of Magna Urbis as a public web service, you must share its source code. It does not restrict the maps you generate. Crediting Magna Urbis is appreciated but not required.

**Does it use generative AI for the images?**
No. Maps, towns and buildings are procedural: rules, geometry and simulation, written in Rust. The only machine-learning part is the optional **neural relief**, a terrain model (derived from [Terrain Diffusion](https://huggingface.co/xandergos/terrain-diffusion-30m), MIT) that produces height fields. You can use procedural relief only.

The code itself is largely written with AI coding agents under a human architect and reviewer; the [devlogs](devlog/kofi-devlogs.md) tell that story.

**How does it compare with Watabou or Azgaar's FMG?**
It's complementary. [Watabou's generators](https://watabou.itch.io/) inspired the project and make wonderful quick town maps. [Azgaar's FMG](https://azgaar.github.io/Fantasy-Map-Generator/) builds whole continents, states and histories. Magna Urbis sits in between: a region of up to 100 km, its terrain, water and roads, and every settlement down to parcels and roofs, in 2D and 3D. You can import a Watabou link or an FMG burg to build that town in detail.

## Hardware and performance

**What do I need to run it?**
A recent desktop browser. Chrome or Edge with **WebGPU** gives the fastest generation and rendering; Firefox and Safari work, with more on the CPU. Phones and tablets work for small maps. For large regions and big cities, the desktop app is faster because the Rust engine runs natively.

**It's slow or my browser tab crashes.**
- Reduce the region width or the number and size of settlements.
- Build one town at a time instead of the whole region.
- Switch the engine from WebGPU to CPU (or back) if the GPU driver struggles; a software WebGPU adapter is detected and avoided automatically.
- On large maps, use the desktop app.

If it still fails, report it with your browser, GPU and a share code (see below).

**The neural relief downloads something. What is it?**
The model weights, about 160 MB, downloaded once, checked, and then reused offline. Procedural relief needs no download.

## Saving and sharing

**What's the difference between a project, a share code and a recipe?**
- A **project** (`.muproj`) is the complete, exact map including all your edits. Use it to keep working.
- A **share code** is a short text that rebuilds the map from its seed and the settings that differ from the defaults, including most edits. Use it to share or to report bugs.
- A **recipe** (`MU.…` code or `.murecipe` file) is the full set of parameters of a workshop. See [Sharing recipes](MAP_RECIPES.md).

**Will my saved maps open in the next version?**
Not always: this is an alpha. A `.muproj` keeps the exact result; share codes and recipes regenerate the map and can produce a different result after engine changes. Keep the project file for anything you care about.

**Where are my maps stored?**
On your machine only. The web app keeps its cache in the browser; nothing is uploaded. The desktop app stores settings and caches in your user folder.

## Imports and exports

**Can I import a real city?**
Yes: **OpenStreetMap** in the top bar searches a place by name or coordinates and builds the map from its streets, water and elevation. You can keep the real streets and let Magna Urbis generate the buildings in any culture.

**Can I use it with Azgaar's FMG?**
Yes. Paste a burg from FMG in **Open a code or link** to build that town; see [Importing an Azgaar FMG burg](AZGAAR_IMPORT.md). FMG can also show a live Magna Urbis preview of a burg; see [City iframe preview](AZGAAR_EMBED.md).

**What can I export?**
PNG and SVG of the whole map or a cropped area, with the style and layers you choose (for example streets and buildings on a transparent background), plus heightmaps (16-bit PNG with min/max metadata).

**Does it export to Foundry, Owlbear or other VTTs?**
Not yet. A PNG export works today as a battlemap background; dedicated VTT exports are planned.

## Getting help and helping

**I found a bug.**
Post it in `#bug-reports` on [Discord](https://discord.gg/3yFq8t8Q2W) or open a [GitHub issue](https://github.com/dunkean/magna-urbis/issues), with the version (web or desktop and its number), your browser and GPU, the **share code**, and a screenshot. A share code lets us rebuild exactly what you see.

**Can I contribute?**
Yes. See the [contribution guide](../CONTRIBUTING.md) and say hello in `#contributors` on Discord. Translations are plain JSON files in `web/src/locales/`.
