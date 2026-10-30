/**
 * Single source of the V2 generation chain: Region → Settlements → Map.
 * Stage ids are the public contract of docs/stage-registry-contract.md and of the scientific
 * atlas anchors (`scientific/index.html#stage-<id>`, `scientific/fr.html#stage-<id>`).
 * This module is pure data: no DOM, no WASM. The UI (stageChain.ts) and the tests read it.
 *
 * Control ids are namespaced so that every existing parameter has exactly one home:
 * - terrain schema paths as written in terrainControlSchema.ts (`terrain.*`, `runtime.*`, `options.*`),
 *   plus the procedural stage recipe (`terrain.procedural.*`, see terrainProceduralStageFields);
 * - `region.<path>` for regionControlFields;
 * - `urban-section:<section>` / `urban-extra:<block>` for the City Bench forms (urbanControlSchema sections);
 * - `render-section:<section>` for the appearance panel sections (renderControls.ts);
 * - `main:<id>` for the settlement/city fields owned by main.ts;
 * - `widget:<id>` for composite widgets (extent, coasts, painted mask, heightmap library…).
 * `SETTINGS_PANEL_CONTROLS` lists the few controls that live in the Settings panel instead of a stage.
 */
import type { V2TownStage } from './contracts';

export type StageFamily = 'region' | 'settlements' | 'map';
export type ReliefSource = 'procedural' | 'neural' | 'heightmap';
export interface Copy { en: string; fr: string }
export interface StageContext {
  relief: ReliefSource;
  /** Classic TypeScript terrain engine: only its original parameters apply. */
  classicTerrain: boolean;
  /** Plain, plateau, volcano, caldera and cavern have no decomposed erosion output. */
  finiteRelief: boolean;
  urban: 'typescript' | 'rust' | 'native';
  hasTerrain: boolean;
  hasRegion: boolean;
  place?: string;
}
export type StageRun =
  | { action: 'terrain' } | { action: 'region' } | { action: 'roads' }
  | { action: 'town'; townStage: V2TownStage } | { action: 'display' } | { action: 'mask' };
export interface StageToggle {
  /** Setting path written by the toggle, or a named behaviour handled by the UI. */
  kind: 'path' | 'coasts' | 'mask' | 'roads' | 'unavailable';
  path?: string;
  /** Default when the path is absent. */
  fallback?: boolean | ((ctx: { compact: boolean; relief: string }) => boolean);
  /** Why the switch cannot be used (kind `unavailable`). */
  reason?: Copy;
}
export interface StageDef {
  id: string;
  family: StageFamily;
  label: Copy;
  summary: Copy;
  optional: boolean;
  toggle?: StageToggle;
  /** Row visibility, following the contract's `when`. */
  when: (ctx: StageContext) => boolean;
  /** Visible but not applicable: returns the reason. */
  unavailable?: (ctx: StageContext) => Copy | undefined;
  controls: readonly string[];
  /** Subset shown on the collapsed row. */
  quick: readonly string[];
  run: StageRun;
  /** Progress stage ids (engine/worker events) attributed to this row for timings. */
  progress?: readonly string[];
}
export const FAMILIES: readonly { id: StageFamily; label: Copy; summary: Copy }[] = [
  { id: 'region', label: { en: 'Region', fr: 'Région' }, summary: { en: 'Climate, relief, coasts, water and natural cover', fr: 'Climat, relief, côtes, eau et couvert naturel' } },
  { id: 'settlements', label: { en: 'Settlements', fr: 'Peuplements' }, summary: { en: 'From settlement sites and roads to individual houses', fr: 'Des implantations et routes aux maisons' } },
  { id: 'map', label: { en: 'Map', fr: 'Carte' }, summary: { en: 'Appearance, names and export', fr: 'Affichage, nommage et export' } },
];

const procedural = (c: StageContext) => c.relief === 'procedural' && !c.classicTerrain;
const neural = (c: StageContext) => c.relief === 'neural' && !c.classicTerrain;
const always = () => true;
const finite = (c: StageContext): Copy | undefined => c.finiteRelief
  ? { en: 'This relief uses its own generator: this stage has no separate output.', fr: 'Ce relief utilise son propre générateur : cette étape n’a pas de sortie séparée.' } : undefined;
const rustCity = (c: StageContext): Copy | undefined => c.urban === 'typescript'
  ? { en: 'Requires the Rust urban engine (classic TypeScript builds the whole plan at once).', fr: 'Requiert le moteur urbain Rust (le TypeScript classique construit tout le plan d’un coup).' } : undefined;
const rustRegion = (c: StageContext): Copy | undefined => c.classicTerrain
  ? { en: 'Rust regional controls require the Rust terrain engine.', fr: 'Les réglages régionaux Rust exigent le moteur de relief Rust.' } : undefined;
const neuralIntermediate = (): Copy => ({ en: 'This neural engine exposes its decoded terrain only. Preview it with Relief source or Neural decoder.', fr: 'Ce moteur neuronal expose uniquement le terrain décodé. Affichez-le avec Source du relief ou Décodeur neuronal.' });
const enabled = (path: string, fallback: StageToggle['fallback'] = true): StageToggle => ({ kind: 'path', path, fallback });
const U = (section: string) => `urban-section:${section}`;
const R = (section: string) => `render-section:${section}`;
const terrainRun: StageRun = { action: 'terrain' };
const town = (townStage: V2TownStage): StageRun => ({ action: 'town', townStage });
const display: StageRun = { action: 'display' };
const erosion = (keys: string[]) => keys.map(key => `terrain.erosionTuning.${key}`);
const SITE_ARCHETYPE_WEIGHTS = 'region.placement.siteWeights.*', MAIN_SITE_WEIGHTS = 'region.placement.main.sitePrefs.weights.*';

export const STAGES: readonly StageDef[] = [
  // ── Relief ───────────────────────────────────────────────────────────────
  { id: 'relief-source', family: 'region', optional: false, when: always, run: terrainRun,
    label: { en: 'Relief source', fr: 'Source du relief' },
    summary: { en: 'Source preparation and terrain adjustments', fr: 'Préparation de la source et ajustements du relief' },
    controls: ['widget:source-mode', 'widget:seed', 'widget:extent', 'widget:heightmap-library', 'widget:heightmap-import',
      'terrain.relief', 'terrain.motifSize', 'terrain.procedural.preset', 'terrain.environment', 'terrain.mountainMix', 'terrain.erosion',
      'options.relief', 'options.coast', 'options.river', 'options.seaLevel', 'options.biome', 'widget:coasts', 'terrain.islandMode'],
    quick: ['widget:source-mode', 'widget:extent-km', 'options.biome', 'terrain.relief'],
    progress: ['compute', 'runtime-download', 'runtime-compile', 'runtime-ready', 'gpu-device', 'terrain-module', 'relief-engine', 'terrain-generation', 'terrain-import', 'pipeline:prepare', 'terrain-cache', 'terrain-projection', 'terrain-retain', 'terrain-sampling', 'gpu-sampling-compile', 'pipeline:retain', 'pipeline:sampling'] },
  { id: 'relief-climate', family: 'region', optional: false, when: c => !c.classicTerrain, run: terrainRun,
    label: { en: 'Input climate', fr: 'Climat de départ' },
    summary: { en: 'Temperature and rain condition neural generation, climate-driven erosion, water and vegetation', fr: 'Température et pluie conditionnent le neuronal, l’érosion climatique, l’eau et la végétation' },
    controls: ['terrain.climate', 'terrain.climateValues.temperature', 'terrain.climateValues.temperatureStd', 'terrain.climateValues.precipitation', 'terrain.climateValues.precipitationCv'],
    quick: ['terrain.climate'] },
  { id: 'relief-mask', family: 'region', optional: true, toggle: { kind: 'mask' }, when: procedural, run: { action: 'mask' },
    label: { en: 'Custom mask', fr: 'Masque personnalisé' },
    summary: { en: 'Paint relief zones, brushes, import / export', fr: 'Zones peintes, pinceaux, import / export' },
    controls: ['widget:sketch'], quick: ['widget:paint'] },
  { id: 'relief-grids', family: 'region', optional: false, when: procedural, unavailable: finite, run: terrainRun,
    label: { en: 'Grids and buffers', fr: 'Grilles et tampons' }, summary: { en: 'Regional and surface grids, output sampling', fr: 'Grilles régionale et de surface, échantillonnage' },
    controls: ['terrain.resolution', 'terrain.phasor.quality', 'terrain.procedural.regionalN', 'terrain.procedural.surfaceN'], quick: ['terrain.resolution'], progress: ['pipeline:grids'] },
  { id: 'relief-noise', family: 'region', optional: false, when: procedural, unavailable: finite, run: terrainRun,
    label: { en: 'Initial noise and uplift', fr: 'Bruit initial et soulèvement' }, summary: { en: 'Regional noise scale and crest strength', fr: 'Échelle du bruit régional et force des crêtes' },
    controls: ['terrain.procedural.noiseScale', 'terrain.procedural.crest'], quick: ['terrain.procedural.noiseScale'], progress: ['pipeline:initialize'] },
  { id: 'relief-regional', family: 'region', optional: false, when: procedural, unavailable: finite, run: terrainRun,
    label: { en: 'Regional evolution', fr: 'Évolution régionale' }, summary: { en: 'Uplift, drainage, incision, thermal, diffusion', fr: 'Soulèvement, drainage, incision, thermique, diffusion' },
    controls: ['terrain.procedural.uplift', 'terrain.procedural.regionalThermal', 'terrain.procedural.regionalDiffusion', 'terrain.procedural.biome',
      ...erosion(['iterations', 'incision', 'incisionSlope', 'fill', 'carve', 'talus', 'thermal', 'diffusion']), 'widget:erosion-reset'],
    quick: ['terrain.erosionTuning.iterations', 'terrain.procedural.uplift'], progress: ['pipeline:regional'] },
  { id: 'relief-relax', family: 'region', optional: true, toggle: enabled('terrain.procedural.enabled.regionalFinish'), when: procedural, unavailable: finite, run: terrainRun,
    label: { en: 'Final regional relaxation', fr: 'Relaxation régionale finale' }, summary: { en: 'Final sill carving, thermal relaxation, drainage', fr: 'Entaille finale des seuils, relaxation, drainage' },
    controls: erosion(['finalCarve']), quick: ['terrain.erosionTuning.finalCarve'], progress: ['pipeline:regionalFinish'] },
  { id: 'relief-reconstruct', family: 'region', optional: false, when: procedural, unavailable: finite, run: terrainRun,
    label: { en: 'Reconstruction', fr: 'Reconstruction' }, summary: { en: 'Bicubic or B-spline upsampling, domain warp', fr: 'Suréchantillonnage bicubique ou B-spline, déformation' },
    controls: ['terrain.procedural.reconstruction', ...erosion(['warp'])], quick: ['terrain.procedural.reconstruction'], progress: ['pipeline:reconstruct'] },
  { id: 'relief-calibrate', family: 'region', optional: true, toggle: enabled('terrain.procedural.enabled.amplitude'), when: procedural, unavailable: finite, run: terrainRun,
    label: { en: 'Amplitude calibration', fr: 'Calibration de l’amplitude' }, summary: { en: 'p99 rescaling to the relief family amplitude', fr: 'Remise à l’échelle p99 sur l’amplitude de la famille' },
    controls: [], quick: [], progress: ['pipeline:amplitude'] },
  { id: 'relief-detail', family: 'region', optional: true, when: procedural, unavailable: finite, run: terrainRun,
    toggle: enabled('terrain.procedural.enabled.ridged', ({ compact }) => !compact),
    label: { en: 'Ridged detail', fr: 'Détail ridgé' }, summary: { en: 'Classical ridged detail before surface erosion', fr: 'Détail ridgé classique avant l’érosion de surface' },
    controls: erosion(['detail']), quick: ['terrain.erosionTuning.detail'], progress: ['pipeline:ridged'] },
  { id: 'relief-surface', family: 'region', optional: true, when: procedural, unavailable: finite, run: terrainRun,
    toggle: enabled('terrain.procedural.enabled.surface', ({ compact, relief }) => !compact || relief === 'canyon'),
    label: { en: 'Surface erosion', fr: 'Érosion de surface' }, summary: { en: 'Cycles, routed incision, carving, thermal, diffusion', fr: 'Cycles, incision routée, entailles, thermique, diffusion' },
    controls: erosion(['surfaceIterations', 'surfaceIncision', 'surfaceCarve', 'surfaceRouted', 'surfaceThermal', 'surfaceDiffusion']), quick: ['terrain.erosionTuning.surfaceIterations'], progress: ['pipeline:surface'] },
  { id: 'relief-datum', family: 'region', optional: true, toggle: enabled('terrain.procedural.enabled.normalize'), when: procedural, unavailable: finite, run: terrainRun,
    label: { en: 'Datum normalisation', fr: 'Normalisation du datum' }, summary: { en: 'p1 shift to 1 m, positive land floor', fr: 'Décalage p1 à 1 m, plancher terrestre positif' },
    controls: [], quick: [], progress: ['pipeline:normalize'] },
  { id: 'relief-phasor', family: 'region', optional: true, when: procedural, unavailable: finite, run: terrainRun,
    toggle: enabled('terrain.procedural.enabled.phasor', ({ compact }) => compact),
    label: { en: 'Phasor detail', fr: 'Détail Phasor' }, summary: { en: 'Oriented detail on either preset', fr: 'Détail orienté sur les deux préréglages' },
    controls: ['terrain.procedural.enabled.phasor', 'terrain.phasor.intensity'], quick: ['terrain.phasor.intensity'], progress: ['pipeline:phasor'] },
  { id: 'relief-neural-coarse', family: 'region', optional: false, when: neural, unavailable: neuralIntermediate, run: terrainRun,
    label: { en: 'Neural coarse diffusion', fr: 'Diffusion neuronale grossière' }, summary: { en: 'Coarse climate and relief conditioning', fr: 'Conditionnement grossier du climat et du relief' },
    controls: ['terrain.coarseModel', 'terrain.fidelity', 'terrain.neuralTuning.landScale', 'terrain.neuralTuning.steps', 'terrain.neuralTuning.noiseTemperature', 'terrain.neuralTuning.noiseTemperatureStd', 'terrain.neuralTuning.noisePrecipitation', 'terrain.neuralTuning.noisePrecipitationCv'],
    quick: ['terrain.neuralTuning.steps'] },
  { id: 'relief-neural-base', family: 'region', optional: false, when: neural, unavailable: neuralIntermediate, run: terrainRun,
    label: { en: 'Neural base diffusion', fr: 'Diffusion neuronale de base' }, summary: { en: 'Local relief conditioning and histogram', fr: 'Conditionnement du relief local et histogramme' },
    controls: ['terrain.baseModel', 'terrain.neuralTuning.reliefMode', 'terrain.neuralTuning.reliefScale', 'terrain.neuralTuning.reliefFixed', ...[0, 1, 2, 3, 4].map(i => `terrain.neuralTuning.histogram.${i}`), 'widget:histogram-presets'],
    quick: ['terrain.neuralTuning.reliefMode'] },
  { id: 'relief-neural-decoder', family: 'region', optional: false, when: neural, run: terrainRun,
    label: { en: 'Neural decoder', fr: 'Décodeur neuronal' }, summary: { en: 'Decoding, amplification and extent fitting', fr: 'Décodage, amplification et adaptation de l’étendue' },
    controls: ['terrain.decoderModel', 'terrain.neuralTuning.detail', 'terrain.neuralFit', 'terrain.neuralSlopes'], quick: ['terrain.neuralFit'] },
  { id: 'relief-heightmap-fit', family: 'region', optional: false, when: c => c.relief === 'heightmap', run: terrainRun,
    label: { en: 'Heightmap fit', fr: 'Ajustement de la heightmap' }, summary: { en: 'Resample, vertical scale, datum, crop', fr: 'Rééchantillonnage, échelle verticale, datum, recadrage' },
    controls: ['widget:heightmap-fit', 'options.heightScale', 'options.importSea'], quick: ['widget:heightmap-scale'] },
  { id: 'relief-refine', family: 'region', optional: true, toggle: enabled('terrain.refine'), when: c => !c.classicTerrain, run: terrainRun,
    label: { en: 'Fractal refinement', fr: 'Raffinement fractal' }, summary: { en: 'Slope-dependent detail below the source cell', fr: 'Détail dépendant de la pente sous la cellule source' },
    controls: ['terrain.refine', 'terrain.detailNoise.amplitude', 'terrain.detailNoise.hurst', 'terrain.detailNoise.lacunarity', 'terrain.detailNoise.octaves', 'terrain.detailNoise.start', 'terrain.detailNoise.slope', 'terrain.detailNoise.flat', 'terrain.detailNoise.shore', 'widget:detail-reset'],
    quick: ['terrain.detailNoise.amplitude'] },
  { id: 'relief-conditioning', family: 'region', optional: true, toggle: enabled('terrain.procedural.enabled.posterior'), when: procedural, unavailable: finite, run: terrainRun,
    label: { en: 'Posterior fluvial conditioning', fr: 'Conditionnement fluvial a posteriori' }, summary: { en: 'Fluvial erosion and depression breaching', fr: 'Érosion fluviale et ouverture des dépressions' },
    controls: ['terrain.procedural.posterior.mode', 'terrain.procedural.posterior.strength', 'terrain.procedural.posterior.maxDepth', 'terrain.procedural.posterior.maxLength'], quick: ['terrain.procedural.posterior.mode'], progress: ['pipeline:posterior'] },
  { id: 'relief-aeolian', family: 'region', optional: true, toggle: enabled('terrain.procedural.enabled.wind'), when: procedural, unavailable: finite, run: terrainRun,
    label: { en: 'Aeolian transport', fr: 'Transport éolien' }, summary: { en: 'Wind passes, direction, transported metres', fr: 'Passes de vent, direction, mètres transportés' },
    controls: ['terrain.procedural.wind.iterations', 'terrain.procedural.wind.azimuth', 'terrain.procedural.wind.transport'], quick: ['terrain.procedural.wind.iterations'], progress: ['pipeline:wind'] },
  { id: 'relief-coasts', family: 'region', optional: false, when: procedural, unavailable: finite, run: terrainRun,
    label: { en: 'Coastal finishing', fr: 'Finition côtière' }, summary: { en: 'Coastal erosion on the land/sea mask chosen above; zero cycles disables erosion', fr: 'Érosion du littoral sur le masque terre/mer choisi en haut ; zéro cycle désactive l’érosion' },
    controls: ['terrain.procedural.coastIterations', 'terrain.procedural.coastIncision', 'terrain.procedural.coastThermal', 'terrain.procedural.coastDiffusion'],
    quick: ['terrain.procedural.coastIterations'], progress: ['terrain-coast', 'pipeline:coasts'] },
  // ── Water and natural cover ──────────────────────────────────────────────
  { id: 'water-hydrology', family: 'region', optional: true, toggle: enabled('terrain.hydrology.enabled'), when: c => !c.classicTerrain, run: terrainRun,
    label: { en: 'Rivers, lakes and riverbeds', fr: 'Rivières, lacs et lits' }, summary: { en: 'Final drainage, climate water budgets, rivers and riverbed incision', fr: 'Drainage final, bilans hydriques du climat, rivières et incision des lits' },
    controls: ['terrain.hydrology.*'], quick: ['terrain.hydrology.engine', 'terrain.hydrology.main'],
    progress: ['terrain-conditioning', 'terrain-drainage', 'terrain-water', 'terrain-carving', 'pipeline:hydrology'] },
  { id: 'cover-climate', family: 'region', optional: true, toggle: enabled('terrain.forest.enabled'), when: always, run: terrainRun,
    label: { en: 'Natural cover', fr: 'Couvert naturel' }, summary: { en: 'Forest and clearings from the input climate, relief and water', fr: 'Forêt et clairières selon le climat de départ, le relief et l’eau' },
    controls: ['terrain.forest.enabled', 'terrain.forest.density', 'terrain.forest.clearings'],
    quick: ['terrain.forest.density'], progress: ['biome'] },
  // ── Settlements ──────────────────────────────────────────────────────────
  { id: 'settle-sites', family: 'settlements', optional: false, when: always, unavailable: rustRegion, run: { action: 'region' },
    label: { en: 'Sites and urban reserves', fr: 'Sites et réserves urbaines' }, summary: { en: 'Where places settle, spacing and site scoring', fr: 'Où s’installent les lieux, espacement et critères' },
    controls: ['main:town-count', 'main:culture', 'region.placement.main.name', 'region.placement.main.siteType', 'region.placement.main.position.x', 'region.placement.main.position.y',
      'region.placement.main.sitePrefs.mountainFace', 'region.placement.main.sitePrefs.woodland', MAIN_SITE_WEIGHTS, 'region.placement.density', 'region.placement.spread', 'region.placement.mainClear', 'region.placement.clustering', 'region.placement.edgeMargin',
      'region.placement.*Weight', 'region.placement.elevation', SITE_ARCHETYPE_WEIGHTS, 'region.resolution', 'widget:region-list'],
    quick: ['main:town-count', 'region.placement.density'], progress: ['sites'] },
  { id: 'settle-hierarchy', family: 'settlements', optional: false, when: always, unavailable: rustRegion, run: { action: 'region' },
    label: { en: 'Place hierarchy', fr: 'Hiérarchie des lieux' }, summary: { en: 'Composition, population law, classes', fr: 'Composition, loi des populations, classes' },
    controls: ['main:population', 'region.placement.mode', 'region.placement.distribution', 'region.placement.zipfExponent', 'region.placement.minPopulation', 'region.placement.populationJitter', 'region.placement.counts.*'],
    quick: ['main:population', 'region.placement.distribution'] },
  { id: 'settle-roads', family: 'settlements', optional: true, toggle: { kind: 'roads' }, when: always, unavailable: rustRegion, run: { action: 'roads' },
    label: { en: 'Regional roads', fr: 'Routes régionales' }, summary: { en: 'Cost fields, A*, crossings and bridges', fr: 'Champs de coût, A*, franchissements et ponts' },
    controls: ['region.roads.*'], quick: ['region.roads.level', 'region.roads.surface'], progress: ['roads', 'network'] },
  // ── City (selected place) ────────────────────────────────────────────────
  { id: 'city-composition', family: 'settlements', optional: false, when: always, run: town('layout'),
    label: { en: 'Composition', fr: 'Composition' }, summary: { en: 'Footprint, macroplan, harbour, fortification', fr: 'Emprise, macroplan, port, fortification' },
    controls: ['main:sprawl', 'main:walls', 'main:moat', 'main:castle', 'main:cathedral', 'main:palace', 'main:monasteries', 'main:port', 'main:arena', 'main:activities', 'main:suburbs',
      U('layout'), U('footprint'), U('growth'), U('fortifications'), U('ports'), 'urban-extra:header', 'urban-extra:phases', 'urban-extra:archetypes'],
    quick: ['main:walls'], progress: ['urban-engine', 'town'] },
  { id: 'city-quarters', family: 'settlements', optional: false, when: always, unavailable: rustCity, run: town('layout'),
    label: { en: 'Quarters and streets', fr: 'Quartiers et rues' }, summary: { en: 'Streets, split, blocks, bridges', fr: 'Rues, découpage, îlots, ponts' },
    controls: [U('streets')], quick: ['urban.layout.tissue'], progress: ['urban-layout', 'layout'] },
  { id: 'city-trim', family: 'settlements', optional: true, when: always, unavailable: rustCity, run: town('layout'),
    toggle: { kind: 'unavailable', reason: { en: 'No independent switch: the engine trims unbuilt blocks unless the growth mechanism is Legacy (Composition).', fr: 'Pas d’interrupteur indépendant : le moteur retire les îlots non bâtis sauf avec le mécanisme de croissance Legacy (Composition).' } },
    label: { en: 'Trim unbuilt blocks', fr: 'Retrait des îlots non bâtis' }, summary: { en: 'Blocks nobody builds on return to the fields', fr: 'Les îlots que personne ne bâtit retournent aux champs' },
    controls: [], quick: [] },
  { id: 'city-parcels', family: 'settlements', optional: false, when: always, unavailable: rustCity, run: town('parcels'),
    label: { en: 'Parcels', fr: 'Parcelles' }, summary: { en: 'Cadastre operators, lot shapes and access', fr: 'Opérateurs cadastraux, formes de lots et desserte' },
    controls: [U('parcels')], quick: ['urban.parcels.operator'], progress: ['urban-parcels'] },
  { id: 'city-programme', family: 'settlements', optional: false, when: always, unavailable: rustCity, run: town('programme'),
    label: { en: 'Programme', fr: 'Programme' }, summary: { en: 'Roles, functions, demands and capacities', fr: 'Rôles, fonctions, besoins et capacités' },
    controls: [U('programme')], quick: ['urban.layout.programme.intent'], progress: ['urban-programme'] },
  { id: 'city-buildings', family: 'settlements', optional: false, when: always, unavailable: rustCity, run: town('buildings'),
    label: { en: 'Building sites and massing', fr: 'Emprises et volumes bâtis' }, summary: { en: 'One house request per lot, floors, typology', fr: 'Une demande de maison par lot, étages, typologie' },
    controls: [U('placement')], quick: ['urban.houses.floors'], progress: ['urban-building-sites', 'urban-built-capacity'] },
  { id: 'city-houses', family: 'settlements', optional: true, when: always, unavailable: rustCity, run: town('buildings'),
    toggle: { kind: 'unavailable', reason: { en: 'Houses are produced by the buildings stage; use “Generate through” to stop before them.', fr: 'Les maisons sont produites par l’étape des bâtiments ; « Générer jusqu’à » permet de s’arrêter avant.' } },
    label: { en: 'Architecture and houses', fr: 'Architecture et maisons' }, summary: { en: 'Recipes, materials, roofs, mixed styles, workshop', fr: 'Recettes, matériaux, toits, styles mélangés, atelier' },
    controls: [U('house'), U('workshop'), 'urban-extra:mixtures', 'urban-extra:catalogue'], quick: [], progress: ['urban-buildings', 'urban-complete'] },
  // ── Display ──────────────────────────────────────────────────────────────
  { id: 'display-terrain', family: 'map', optional: false, when: always, run: display,
    label: { en: 'Terrain shading and palette', fr: 'Ombrage et palette du relief' }, summary: { en: 'Style, colours, light, 2D / 3D, diagnostics', fr: 'Style, couleurs, lumière, 2D / 3D, diagnostics' },
    controls: [R('ground'), R('relief'), R('diagnostics'), 'widget:style', 'widget:view3d'], quick: ['widget:style', 'widget:view3d', 'toggle:appearance.lighting.enabled'] },
  { id: 'display-water', family: 'map', optional: false, when: always, run: display,
    label: { en: 'Water', fr: 'Eau' }, summary: { en: 'Rivers, lakes, oxbows and sea', fr: 'Rivières, lacs, bras morts et mer' },
    controls: [R('water')], quick: ['toggle:appearance.terrainLayers.water', 'toggle:appearance.lakes'] },
  { id: 'display-vegetation', family: 'map', optional: false, when: always, run: display,
    label: { en: 'Vegetation and contours', fr: 'Végétation et courbes' }, summary: { en: 'Land cover, canopy, painted textures, contours', fr: 'Couvert, canopée, textures peintes, courbes' },
    controls: [R('cover'), 'widget:layer-contours', 'widget:layer-landuse'], quick: ['widget:layer-contours', 'widget:layer-landuse'] },
  { id: 'display-roads', family: 'map', optional: false, when: always, run: display,
    label: { en: 'Roads and ground', fr: 'Routes et sols' }, summary: { en: 'Regional roads, streets, ground blending', fr: 'Routes régionales, rues, intégration des sols' },
    controls: [R('roads')], quick: ['toggle:appearance.roads', 'seg:appearance.city.groundBlend'] },
  { id: 'display-buildings', family: 'map', optional: false, when: always, run: display,
    label: { en: 'Buildings', fr: 'Bâtiments' }, summary: { en: '2D / 3D, roofs, colours, city layers', fr: '2D / 3D, toits, couleurs, couches urbaines' },
    controls: [R('buildings')], quick: ['toggle:appearance.buildings', 'seg:appearance.city.colors', 'seg:appearance.city.buildingStyle'] },
  { id: 'display-labels', family: 'map', optional: false, when: always, run: display,
    label: { en: 'Labels and icons', fr: 'Toponymes et icônes' }, summary: { en: 'Place names, legend, cartouche, frame', fr: 'Toponymes, légende, cartouche, cadre' },
    controls: [R('general'), 'widget:layer-labels'], quick: ['widget:layer-labels', 'toggle:appearance.legend'] },
  { id: 'map-naming', family: 'map', optional: false, when: always, run: display,
    label: { en: 'Map title and toponyms', fr: 'Titre et toponymes' }, summary: { en: 'Name the map and its places without rebuilding the region', fr: 'Nommer la carte et ses lieux sans reconstruire la région' },
    controls: ['widget:naming'], quick: [] },
  { id: 'map-export', family: 'map', optional: false, when: always, run: display,
    label: { en: 'Export', fr: 'Export' }, summary: { en: 'Image, SVG, heightmap, project or reusable recipe', fr: 'Image, SVG, heightmap, projet ou recette réutilisable' },
    controls: ['widget:export'], quick: [] },
];

/** Controls that belong to the Settings panel (machine-level endpoints), not to a stage row. */
/** Execution block of the Settings dialog (see runtimeChoices.ts) plus service addresses. */
export const SETTINGS_PANEL_CONTROLS = ['runtime.source', 'runtime.backend', 'runtime.compute', 'terrain.compute', 'terrain.generationCompute', 'terrain.hydrology.compute', 'main:urban-backend', 'runtime.neuralAssets', 'runtime.localServer', 'runtime.neuralServer', 'runtime.pythonServer'] as const;

export const stageById = new Map(STAGES.map(stage => [stage.id, stage]));
export const stagesOf = (family: StageFamily): StageDef[] => STAGES.filter(stage => stage.family === family);
export const stageAnchor = (id: string): string => `stage-${id}`;
/** Atlas section for a stage, following the app language (EN index.html, FR fr.html). */
export function stageDocUrl(id: string, language: 'en' | 'fr', base = './scientific/'): string {
  return `${base}${language === 'fr' ? 'fr.html' : 'index.html'}#${stageAnchor(id)}`;
}

/** Glob-style control patterns (`terrain.hydrology.*`, `region.placement.*Weight`). */
function matches(pattern: string, id: string): boolean {
  if (!pattern.includes('*')) return pattern === id;
  const regex = new RegExp('^' + pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^.]*') + '$');
  return regex.test(id);
}
/** Every stage claiming a control id; the UI and the parity test require exactly one. */
export function stagesForControl(id: string): string[] {
  if ((SETTINGS_PANEL_CONTROLS as readonly string[]).includes(id)) return ['settings'];
  const owners = STAGES.filter(stage => stage.controls.some(pattern => matches(pattern, id))).map(stage => stage.id);
  return owners;
}
export const stageForControl = (id: string): string | undefined => { const owners = stagesForControl(id); return owners.length === 1 ? owners[0] : undefined; };

/** Engine/worker progress ids → registry stage, for per-stage timings of the last run. */
export function stageForProgress(progressStage: string): string | undefined {
  for (const stage of STAGES) if (stage.progress?.includes(progressStage)) return stage.id;
  return undefined;
}

/** Procedural generator stages (rust/bridge/terrainGenerationRecipe.ts) → registry rows. */
export const GENERATION_STAGE_ROWS: Record<string, string> = {
  prepare: 'relief-source', grids: 'relief-grids', initialize: 'relief-noise', regional: 'relief-regional', regionalFinish: 'relief-relax',
  reconstruct: 'relief-reconstruct', amplitude: 'relief-calibrate', ridged: 'relief-detail', surface: 'relief-surface', normalize: 'relief-datum',
  phasor: 'relief-phasor', posterior: 'relief-conditioning', wind: 'relief-aeolian', retain: 'relief-source', coasts: 'relief-coasts',
  sampling: 'relief-source', hydrology: 'water-hydrology', render: 'display-terrain',
};

/** Rows recomputed by a generation action (timings and staleness of the last run). */
export function stagesForAction(action: string, townStage?: V2TownStage, terrainStage?: string): string[] {
  const of = (family: StageFamily) => stagesOf(family).map(stage => stage.id);
  if (action === 'terrain') { const ids = of('region'); return terrainStage ? ids.slice(0, ids.indexOf(terrainStage) + 1) : ids; }
  if (action === 'settlements') return of('settlements');
  if (action === 'region') return STAGES.filter(stage => stage.run.action === 'region' || stage.run.action === 'roads').map(stage => stage.id);
  if (action === 'roads') return ['settle-roads'];
  if (action === 'town' || action === 'towns') {
    const order: V2TownStage[] = ['layout', 'parcels', 'programme', 'buildings'], last = order.indexOf(townStage ?? 'buildings');
    return STAGES.filter(stage => stage.run.action === 'town' && order.indexOf(stage.run.townStage) <= last).map(stage => stage.id);
  }
  if (action === 'all') return STAGES.filter(stage => stage.family !== 'map').map(stage => stage.id);
  return [];
}
