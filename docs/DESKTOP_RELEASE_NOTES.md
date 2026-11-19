## Alpha 0.3.11

- Tilt, fly and walk through the map with one continuous camera; lock the view to 2D and adjust the viewing depth.
- Keep loaded towns and contour lines cached across map styles and camera changes, with sharper navigation and faster map preparation.
- Draw parchment woods on the GPU and simplify light map styles; choose an initial style suited to the device's graphics capabilities.
- Extend the tree viewing range to 5 km, fade distant trees and keep trunks off building footprints.
- Edit roads and contour lines directly on the map, with persistent road controls and coordinated updates to affected town blocks and farmland.
- Limit automatic settlements to 20,000 inhabitants, improve mountain villages and preserve manually placed foundations.
- Confirm resets and town moves inside the app, and keep generation progress visible independently of settlement generation.
- Open the four latest versions' release notes from the top bar.
- Keep 3D harbour structures, boats and equipment on the displayed terrain and water instead of outdated planning heights, including exposed dry riverbeds; anchor pier piles in the bed.
- Choose beaches, cliffs or a mixed coast with low coves between rocky stretches. Adjust cliff coverage, coastal smoothing and transition width independently of coves, headlands and relief influence, including on painted and hand-drawn coastlines.
- Preserve dwellings when a major landmark is requested in a camp or another settlement with a single residential block.
- Embed a compact city preview in an iframe using Azgaar burg data or city URL parameters, with automatic generation and a link to the full editor.
- Explore varied city previews with a randomize button, and distinguish individual buildings with clearer outlines and contrasting landmark colors in the Minimal map style.
- Pan and zoom inside city previews with mouse, touch and keyboard controls, including cached thumbnails, and reset the view to frame the city.
- Harmonize building daylight in 2D and 3D: domes, pitched roofs, flat roofs and walls share softer, consistent shading across architectural styles.
- Walk mode collides with house exteriors and fortifications, slides along walls and keeps gate passages open.
- Fix startup and reloads getting stuck when the browser GPU driver does not answer. Native procedural generation no longer waits for an unused browser GPU.
- Keep generation settings and imported heightmaps when reloading during an interrupted or unfinished restoration.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.10

Replaces 0.3.9, whose build stopped on an outdated test before publication (no 0.3.9 packages exist).

- Open a city from another generator: the import dialog ("Open a code or link") accepts a watabou city or village generator link, or an Azgaar Fantasy Map Generator burg (a row of the burgs-overview CSV, header optional, or the JSON of the new Azgaar export script, copied from the dialog). The town keeps its name, population, walls, citadel, temple, port, river and coast; Azgaar burgs also bring relief, biome, climate and culture. The FMG culture name base and type choose a fitting Magna Urbis culture, drawn per town, and the toponym language. See `docs/AZGAAR_IMPORT.md`.
- An imported town is a single place on a map sized for it (about 3 km at 2,500 inhabitants, 6 km at 12,000).
- Opening a code or link now runs the whole generation instead of waiting for a click; the map is drawn even when the code is opened from the 3D view.
- The map recovers from a lost GPU context, and a superseded map display no longer repaints over a newer one.
- The Illustrate button is withdrawn for now.

Source validation: TypeScript type-check passed; the import, city code and city parity suites passed (83 tests) and the release integration suites passed locally (40 tests). The opened-from-3D blank map was reproduced and fixed in a headless browser. The Azgaar export script has only been syntax-checked, not yet run in a live FMG page. The same sources are live on magna-urbis.org and passed the full live check on a real GPU.

Package validation: pending on the published assets.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.8

- Faster display: the GPU vector engine no longer demotes itself to the CPU for the whole session (its tile timing was inflated by a synchronous error read). On a 40 km map, switching to parchment drops from about 35 s to 17 s and parchment pan/zoom stalls are halved; on a 10 km map the parchment switch drops from 6 s to 3 s.
- Lighter 3D opening and town plans: one water clipper per ground, indexed ring tests for moats and footings, memoised wall ground samples, building meshes written straight into typed arrays, plan clipping on the building workers.

Source validation: TypeScript type-check and the render suites passed (city parity, vector engine, city ground, building ground, 3D heights). Each engine's output is pixel-identical before and after; keeping the GPU engine instead of the CPU fallback changes anti-aliasing slightly (satellite 0.4–0.6 % of pixels, parchment line edges).

Package validation: pending on the published assets.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.7

- Fix procedural relief on the in-app browser engine with WebGPU: the erosion shader no longer uses `from`, which recent WebView2/Chromium versions reserve ("485: 'from' is a reserved keyword"). A test now rejects reserved words in every WGSL source.
- Faster release builds: the desktop packages skip the multithreaded browser core, which the native app does not use.

Source validation: the WGSL reserved-word test passes; a WebGPU procedural generation completes in Chrome 157 on a real GPU. The same fix is live on magna-urbis.org.

Package validation: pending on the published assets.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.6

- A spinner beside the view selector turns until the view is fully drawn (style, shaders, textures, tiles, 3D opening), so a view still loading its textures is not mistaken for a broken one.
- The measure button shows its ruler icon only.
- Web edition: Automatic, WebGPU and CPU are all selectable (WebGPU greyed only without an adapter); an explicit CPU choice is kept, so neural relief is refused before any download with a WebGPU message.
- The web page gains search metadata in eight languages, link preview cards, a web app manifest and icons.

Source validation: TypeScript type-check and the targeted frontend suites passed (runtime choices 62, view loading, localisation, city parity). The public web build passed the static check and the full live check on a real GPU (neural download and WebGPU generation, complete map with towns, 3D, house roof edit, save/reopen, styles and language, GPU cancel, offline model cache).

Package validation: pending on the published assets.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.5

- Place settlements from probability layers: walked distance to water (cliffs count), access from the map edges, culture-weighted attraction to water (dwarves and duergar keep off the shore), room for the population and repulsion by size. The main town always stands on the largest land mass, towns of 1,000 inhabitants or more never stand on a disconnected island, and a place too large for the room left is lowered one class, with a notice.
- Keep harsh maps (alpine, arctic, desert, Underdark) inhabited with a minimum regional population per map size. The list of places now drives the population: adding a town adds its inhabitants. Population edits are recalculated and rural density is bounded.
- Build credible villages: about one dwelling per household, with communal houses capped (plank houses hold 2 households, longhouses up to 20 people). A village that cannot house its households is laid out again with more room. Labels, camera and picking follow the built core. Add street villages, whose lanes end at their last plot with square ends.
- Rebuild harbours as a simple quay band hugging the water, 1 m above it and drawn above streets, with pontoons, boats and cranes, closed Hanseatic basins and cliff-foot landings. The chance of a coastal port depends on the culture and the room available. The engine, 2D and 3D share one shoreline, so no buildings stand in the water in 3D.
- Roads never cross the sea or lakes; bridge spans are limited by road rank and bridges continue the road (no aqueducts). Remove dead ends without a destination and request regional map exits per road class. Satellite and Rendered roads blend into the ground, tropical earth tracks most discreetly.
- Cut fields by the drawn rivers, lakes and roads (no fields on rivers, no staircase along the water). Cultivated land follows the farming households and their reach; fields without a farm revert to pasture.
- Lay town ground, buildings, roads, bridges, quays and moats on the drawn terrain in 3D (no floating towns).
- Fortifications: fewer gates, budgeted by population, no ungated openings, dead gates closed without cutting suburb access, continuous moats, dug moats in 3D, and new Moat and Fortification style options.
- Editor: per-level fields (quarter: culture, urban plan, growth zone and phase, density with a real effect up to ×10; block: culture, density, parcelling; parcel: content with every building type, fence; house: type, roof, storeys) plus an Advanced section, a parcel merge tool and a sticky map selection. Edit toponyms (name, visibility, reset to the culture's name) and rename settlements.
- Underdark: natural and dug tunnels, a cavern look in 3D, mushrooms of many shapes (myconid towns with amanita caps), drow and duergar looks with webs and forges, rock-walled towns and no fields. Modern towns get a few towers.
- Smooth rivers at the source scale (no grid staircase), with meanders sized in metres and display by discharge. The lakes slider goes up to 4. In winter, snow covers town ground and fields; arctic summers keep pack ice, adjustable per season.
- Save and open binary `.muproj` projects, with a higher project size limit.
- The web edition generates on WebGPU or the CPU. The local profile picks native, then Python, then browser neural relief automatically and falls back to the browser when the native engine is unreachable; model setup opens from the source selection. Results are recomputed when the engine changes, a restarted engine gets its terrain back transparently, and a Reset button restores every setting.

- Performance: no more freeze while drawing large maps with rivers (a 32 s main-thread task on a 40 km map is gone); faster naming, occupation and 3D opening; the local engine is deployed as a release build again.

Source validation: Rust tests passed for settlements (52), land use (18), terrain (71), the local engine (12) and urban (744 of 746; the two known failures are a 1–2 m street-village lane tolerance and a single-quarter redraw locality case that predates this release). TypeScript type-check and the targeted frontend suites for every change passed; a full frontend run was interrupted and two heavy town-quality suites remain to be reviewed. A local Windows build produced the NSIS installer.

Package validation: pending on the published assets (download, model download, native neural inference, save/reopen and offline reuse).

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.4

- Edit the full hierarchy: city, quarter, block, parcel and building. Regeneration applies the current seed; the dice chooses a new local seed. Parent edits systematically replace descendant overrides within the selected area.
- Culture changes propagate to street patterns, parcel layouts and architecture. Quarter street patterns rebuild interior streets. Keep rendering, textures and lighting choices during regeneration, and preserve editing settings in share codes.
- Simplify the inspector, localize building types, populate advanced settings and filter types by culture, available architecture and parcel area. Failed building requests retain the previous scene. Building-type changes selected from a house currently apply to its parcel, as indicated in the interface.
- Target 85% tree dwellings in the elven profile. Reduce automatic farmstead and hamlet counts while preserving regional population; build small places in groups of up to eight with four generation lanes and one regional update per group.
- Add the minimal map renderer and its composition controls, including contour lines. Correct night lighting of detailed buildings' own window materials.

Source validation: 688 Rust urban tests and 208 targeted frontend/integration tests passed, along with TypeScript, version alignment and portable/checksum checks. A real native-engine browser run covered block editing, renderer retention, localized options, selection cleanup and nine farmsteads built in two groups (eight plus one).

The published portable Windows app passes procedural generation, exact save/reopen, complete native city generation, 3D, verified model download and real native Rust/Vulkan inference on an RTX 5090, followed by deterministic offline restart and owned-service shutdown. The extracted Windows installer payload passes startup and native-service checks. The Linux AppImage and extracted DEB app pass procedural generation, exact save/reopen and service shutdown under Ubuntu 22.04/WSL2; native GPU inference is not newly qualified on Linux. The public website passes real WebGPU generation, editing, 3D and offline model-cache reuse on the RTX 5090. All 14 public downloads pass size, link and SHA-256 checks. See the [0.3.4 verification record](https://github.com/dunkean/magna-urbis/blob/main/docs/DESKTOP_RELEASE_0.3.4_VERIFICATION.md) for methods and limits. Existing 0.3.3 results below describe that version only.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.3

- Include the Python/CUDA service's `neural_sampling.py` dependency in both desktop packages. Staging and package validation now share the service-module inventory, with a regression check for adjacent imports.
- Clear inherited `PYTHONHOME` and `PYTHONPATH` when launching optional Python environments. AppImage launchers can otherwise redirect an existing venv to the bundle's incomplete Python library tree.

Final package validation: the published AppImage (direct FUSE launch) and installed DEB both generated terrain through the packaged interface using an existing WSL Ubuntu 22.04 venv, PyTorch 2.11.0+cu128 and an NVIDIA GeForce RTX 5090. The interpreter was configured through the application, with no wrapper or package modification. Cached Python model files were reused with Hugging Face offline mode enabled; exact project save/reopen and owned-service shutdown passed. Windows portable and extracted installer payload tests passed; native Rust/Vulkan inference on an RTX 4090 reused the previous app version's verified weights and produced identical results after an offline restart. All 14 public downloads passed size, link and SHA-256 checks. See the [0.3.3 verification record](https://github.com/dunkean/magna-urbis/blob/main/docs/DESKTOP_RELEASE_0.3.3_VERIFICATION.md) for methods and limits.

## Alpha 0.3.2

Known optional-module issue: the published Python/CUDA service omits `neural_sampling.py`, and the AppImage launcher can override a configured venv's Python paths. Alpha 0.3.3 addresses these packaging and launch issues. The source and published package files for 0.3.2 remain unchanged.

- Edit architectural styles, packs and generation parameters independently for quarters, parcels and individual buildings. Reroll a selected scope or its descendants while retaining local style choices.
- Procedural roof and storey edits retain the existing footprint. Failed architectural changes keep the previous scene. Selected buildings have a red outline.
- Show fewer map names by default. The top toolbar's Advanced panel provides category toggles, a detail slider and individual name visibility. Selection titles use the current name locale without translating proper names.
- Browser neural generation asks before downloading models, verifies same-origin model chunks and reuses verified model and runtime caches. Native desktop and optional Python model downloads remain separate.
- Improve desktop download links, map relief controls and small-settlement generation.

Source validation: 683 Rust urban tests and 156 TypeScript integration tests passed. Packaged Windows 11 tests cover procedural generation, exact save/reopen, verified model download, real native inference on an NVIDIA GeForce RTX 4090, deterministic offline restart and owned-service shutdown. Ubuntu 22.04.5 under WSL2 passes the DEB and AppImage tests, including direct FUSE launch, procedural generation, exact save/reopen and shutdown. Native Rust/Vulkan GPU inference on Linux is not qualified: this WSL installation exposes only a software Vulkan adapter. This limitation does not describe the separate Python/CUDA runtime. All 14 public downloads match their SHA-256 digests and expected sizes. See the [release verification record](https://github.com/dunkean/magna-urbis/blob/main/docs/DESKTOP_RELEASE_0.3.2_VERIFICATION.md) for methods and limits. GitHub-hosted runners do not validate GPU inference or every Linux distribution.

Magna Urbis V2 is an experimental alpha for Windows x64 and Linux x64.

- Includes the procedural Rust engine and a native Rust GPU inference service. Users do not need Rust, Node.js, Python or CUDA for these engines.
- Native neural terrain uses the same coarse4 / NF4 B75 / distilled decoder profile as browser V2. On first use, the app downloads and verifies approximately 162 MB of model weights. Settings also provides an explicit download button. Verified files are reused after restarting the app, including offline.
- Native inference needs a compatible GPU and driver. A smaller download does not imply equally small GPU memory usage. Procedural CPU generation remains available.
- The experimental 99 MB native climatic base uses a different mixed 3/4-bit format and is not supported by this Rust loader. It is not offered as an installable desktop profile.
- Optional Python/CUDA terrain and illustration modules remain separate downloads.

**Windows:** use the setup EXE for installation, including offline WebView2 setup if required. Alternatively, extract the complete portable ZIP and run `magna-urbis-v2-desktop.exe`; keep its resources alongside it. The portable edition requires WebView2 already installed. Packages are unsigned and Windows may display a warning.

**Linux:** AppImage and DEB are built on Ubuntu 22.04 (glibc 2.35). Compatibility also depends on your distribution, graphical environment and GPU drivers. Make the AppImage executable before running it. GitHub-hosted build runners do not validate GPU inference; see the release verification record for hardware actually tested.

**macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.**

Application updates are announced in Settings and downloaded through the system browser. Close the app before installing an update. Back up projects before upgrading; alpha project formats and generated results may change.

SHA-256 checksums, the supported model profile and build commit metadata accompany the downloads. Model weights retain the MIT teacher attribution in `LICENSE-NEURAL-MODELS.txt`.
