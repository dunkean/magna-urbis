# V2 terrain controls: Terrainbench parity

The V2 terrain form edits the existing Rust Terrainbench settings. It does not introduce a second terrain generator. English is the default interface language; French can be selected without rebuilding the form, losing a brush stroke, changing a field value or resetting an open section.

## Entry screen

The quick settings expose map width, generation source, region biome, relief type and procedural landform scale. New regions start with a **6 km width**, **10 km landform scale** and **vector hydrology**. Width and landform scale are independent: the first sets the map's bounds; the second controls the physical size of its terrain features. The scale input displays kilometres and saves `terrain.motifSize` in metres.

**Create my region** generates relief, water and natural cover only. Settlement sites, regional roads and towns are separate subsequent operations in the Settlements tab. Recreating the region replaces the previous generated map with terrain only.

Width is a free numeric input in metres or kilometres, with optional automatic sizing and shortcuts. Rust's supported width is **500–100,000 m**. Neural models generate a 40 × 40 km source, then crop or scale it to the requested width. Optional automatic size follows settlement demand for procedural generation and uses the neural model's native 40 km window. Saved recipes without explicit terrain settings retain their historical defaults (3 km landform scale and Rust hydrology).

The illustrated **Coasts** and **Hydrology** buttons expand their parameter panels. Hydrology exposes common settings and every setting of the selected Vector or Rust engine. Its badge follows the selected engine; changing engines retains dormant settings.

Each sea direction is an independent bit in `terrain.coastMask`, in this order: N, NE, E, SE, S, SW, W, NW. Inland is zero; all eight is 255. Island and archipelago buttons select all eight directions and set `terrain.islandMode`. The compass therefore supports combinations such as a north and northeast coast without changing any other direction.

Source selection exposes procedural generation, browser neural generation, the Python/PyTorch service and the Rust neural service. The **Compute and engines** section selects Rust in the browser, the installed native service or the original TypeScript CPU engine, with automatic/CPU/GPU execution preferences. Explicit sampling and generation overrides offer an inherited-default option so an automatic recipe does not falsely claim to use a particular GPU implementation.

## Parameter access matrix

All scalar paths below are editable as labelled form inputs, not only through recipe JSON. Hidden sections retain their values. The exact metadata and bounds are in [`terrainControlSchema.ts`](../web/src/v2/terrainControlSchema.ts).

| Terrainbench family | V2 access | Recipe path |
| --- | --- | --- |
| 11 relief families and region biome | Quick settings | `terrain.relief`, `options.biome` |
| Independent landform scale | Quick settings, in km | `terrain.motifSize` (saved in m) |
| Regional surroundings and mountain mixture | Procedural terrain | `terrain.environment`, `terrain.mountainMix` |
| Overall erosion, source resolution, CPU/GPU sampling and generation modes | Procedural terrain | `terrain.erosion`, `terrain.resolution`, `terrain.compute`, `terrain.generationCompute` |
| Eight coasts; island, archipelago and random-island modes | Compass and Relief and climate | `terrain.coastMask`, `terrain.islandMode` |
| Six climate presets and custom climate | Relief and climate; Detailed climate | `terrain.climate`, `terrain.climateValues` |
| Mean temperature, temperature seasonality, annual precipitation and precipitation variation | Detailed climate | `terrain.climateValues.{temperature,temperatureStd,precipitation,precipitationCv}` |
| Crop/scale, slope preservation, sketch fidelity | Neural generation | `terrain.neuralFit`, `terrain.neuralSlopes`, `terrain.fidelity` |
| Land scale, coarse solver steps, four noise/signal terms, local relief mode/scale/fixed height, five histogram classes, decoder detail | Neural generation | All `terrain.neuralTuning` fields |
| Coarse/base/decoder model catalog for Python and browser assets URL | Models and local services | `terrain.{coarseModel,baseModel,decoderModel}`, `runtime.neuralAssets` |
| Rust native, Rust neural and Python service endpoints | Models and local services | `runtime.{localServer,neuralServer,pythonServer}` |
| 17 optional erosion overrides | Detailed erosion | All `terrain.erosionTuning` fields |
| Fractal toggle and eight detail parameters | Fractal refinement | `terrain.refine`, all `terrain.detailNoise` fields |
| Hydrology enable/engine, erosion processing and conditioning mode/strength/depth/length | Hydrology | Corresponding `terrain.hydrology` fields |
| Main channel, tributary/coastal density, water supply, lake policy/abundance/coverage/size/depth, meanders, estuary, widths, incision, depression/breach policy, grid and compute | Rust hydrology parameters | All Rust-engine `terrain.hydrology` fields |
| River area threshold, water balance, vector/D8 tracing, braiding, anabranches, terrain guidance, avulsions, confluences, deltas, lake thresholds, sinuosity, widths and vector grid | Vector hydrology parameters | All vector-engine `terrain.hydrology` fields |
| Detailed canopy, cover density and clearing fraction | Forest and clearings | `terrain.forest` |
| Painted sea/plain/hills/mountain/high-mountain masks, feathered brush, eraser, fill, example, undo/redo and JSON import/export | Painted-region preview, usable before generation | `terrain.zones` |
| Heightmap JSON and grayscale PNG import, preserve/erode processing, raw/displayed JSON and 16-bit PNG export | Heightmap import/export inside the region editor | `terrain.sketch` |
| Original CPU relief, cardinal/random coast, river, sea offset, settlement biome and grayscale import scaling | Classic CPU terrain settings | The original `options.*` keys |

The erosion overrides are `iterations`, `incision`, `incisionSlope`, `fill`, `carve`, `finalCarve`, `talus`, `thermal`, `diffusion`, `detail`, `warp`, `surfaceIterations`, `surfaceIncision`, `surfaceCarve`, `surfaceRouted`, `surfaceThermal`, and `surfaceDiffusion`. Empty inputs remove an override and restore the relief family's own default; zero remains a deliberate override.

Lake coverage, individual-lake area limits, forest density and clearings display percentages and save fractions. Distances retain the core's original units: metres, square metres, kilometres squared or hectares as shown beside each input. The model identifiers and recipe paths are never translated.

## Runtime constraints

- The browser neural engine has a fixed **coarse4 / nf4_b75 / decoder64** profile. The Rust neural service loads its model set at startup. Model selectors are enabled for **Python/PyTorch only**; browser/Rust profiles are explained and retain dormant model choices in the recipe.
- Current neural runtimes require WebGPU or a GPU service. The procedural Rust generator remains available on CPU. A missing GPU or missing model must produce an explicit runtime message.
- Caverns and the geological volcano/caldera families are procedural. Unsupported neural relief choices are disabled. A source change preserves the selected recipe rather than inventing a replacement relief.
- A native procedural generation override requires the native Rust backend; choosing that override selects the native backend. Local URLs keep their separate default ports: Rust **8791**, Rust neural **8792**, Python **8793**.
- The classic TypeScript engine has its own original controls. The complete Rust control set is shown when a Rust engine is selected.
- The painted preview is an input-mask view, not a second terrain computation. Generating terrain applies the masks using the selected existing core. Imported heightmaps replace the older pixel input when selected in this editor.

Rendering modes, hillshade/lighting, camera controls, 3D refinement, pins, seasonal diagnostics and urban controls belong to their respective V2 map and city panels; this matrix covers terrain generation inputs.

## Verification

[`v2TerrainControls.test.ts`](../web/tests/v2TerrainControls.test.ts) verifies that every core hydrology, neural and fractal key has a form field, all 17 erosion overrides exist, numeric UI bounds pass recipe validation, coast bits remain independent, optional overrides can be removed, percentages round-trip and every label/option/help has French copy.

[`v2_terrain_controls_check.mjs`](../web/scripts/v2_terrain_controls_check.mjs) exercises the real browser form: editable width, coast combinations, archipelago presets, neural configuration, live language changes, painting before generation, 16-bit PNG import/export and mobile layout. It writes screenshots and a report under `web/out/v2-terrain-controls`.

## Français : accès et conventions

Les réglages rapides exposent la largeur, le moteur, le biome, le type de relief et son échelle procédurale. Les nouvelles régions démarrent avec une largeur de **6 km**, une échelle de relief de **10 km** et l’hydrologie **vectorielle**. L’échelle des formes est indépendante de la largeur de carte ; elle est affichée en kilomètres et conservée en mètres dans la recette. Les anciennes recettes sans réglages explicites gardent leurs valeurs historiques.

**Créer ma région** génère uniquement le relief, l’eau et la couverture naturelle. Les implantations, routes régionales et villes viennent ensuite, depuis l’onglet Peuplements. Relancer la création de région remplace la carte précédente par ce terrain seul.

La taille peut être automatique ou saisie librement, en mètres ou kilomètres, entre **500 m et 100 km**. Les raccourcis ne limitent pas les valeurs possibles. Deux boutons illustrés ouvrent les panneaux Côtes et Hydrologie, avec tous leurs réglages. Chaque direction maritime est indépendante ; les boutons Île et Archipel sélectionnent les huit directions.

Les accordéons donnent accès aux paramètres réels du Terrainbench : onze familles de relief, climat détaillé, génération neuronale, modèles et services, dix-sept réglages d’érosion, huit réglages fractals, tous les paramètres hydrologiques et la forêt. Les valeurs masquées restent conservées. Un champ d’érosion vide rétablit la valeur propre au relief ; zéro reste une modification explicite.

Le panneau de peinture fonctionne avant toute génération. Il réutilise les pinceaux, masques, transitions, annulations et imports du Terrainbench. Les heightmaps JSON et PNG 8/16 bits peuvent être conservées ou érodées ; l’export PNG conserve 16 bits et les métadonnées d’altitude. Les pourcentages visibles sont enregistrés comme fractions lorsque le moteur l’exige.

Le choix EN/FR change les textes sans remplacer les champs ni modifier leurs identifiants ou valeurs. Les limites réelles restent explicites : profil neuronal fixe dans le navigateur, modèles Rust chargés au démarrage du service, GPU requis pour les moteurs neuronaux actuels, choix des checkpoints pour Python/PyTorch et contrôles propres à l’ancien moteur TypeScript CPU.
