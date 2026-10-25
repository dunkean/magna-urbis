import { TERRAIN_LAYER_CONTROLS, DISPLAY_VOCABULARY } from '../render/displayLayers';
import { seaDistanceSurface } from '../render/terrainWater';
import { isFantasyStyle, prepareFantasyTerrain, renderFantasyTerrain, registerFantasyBrushes, DEFAULT_FANTASY_OPTIONS } from '../../../rust/bridge/fantasyTerrain';
import { createFantasyTerrainLayer } from '../../../rust/bridge/fantasyTerrainLayer';
import { fantasyLibraries } from '../render/fantasyBrushAssets';
import { TERRAIN_STYLE_LIST, isTerrainStyle, isRender3dStyle, terrainStyle } from '../render/terrainStyle';
import { DIAGNOSTICS, diagnosticAvailable, diagnosticDefinition } from '../render/displayDiagnostics';
import { DEFAULT_TERRAIN_LAYERS, DEFAULT_TERRAIN_LIGHTING, type TerrainLayers, type TerrainLighting } from '../render/terrainLighting';
import { createTerrainSketchEditor } from './terrainSketchEditor';
import { installTerrainHelp } from './terrainHelp';
import { decodeSketch, encodeSketch, decodeZones, encodeZones, sketchQuery, placeSketchInFragment, INLINE_SKETCH_LIMIT, storeSketch, readStoredSketch } from './terrainSketchSharing';
import type { TerrainZones } from '../../../rust/bridge/terrainZones';
import type { TerrainSketch } from '../../../rust/bridge/terrainSketch';
import TerrainWorker from './terrainWorker?worker&inline';
import { reliefStatistics, sampleRustTerrain, EROSION_SETTINGS, type ErosionSetting, type ErosionTuning, RELIEFS, GEOLOGICAL_RELIEFS, ENVIRONMENT_RELIEFS, COMPUTE_MODES, type TerrainEnvironment, type TerrainCompute, type TerrainData, type TerrainSettings, type TerrainRequest, type TerrainResponse, type TerrainRelief, type TerrainRegion } from '../../../rust/bridge/terrain';
import { renderRustTerrain, terrainContourWidths, type TerrainStyle, type TerrainScene } from '../../../rust/bridge/terrainRender';
import { DEFAULT_HYDROLOGY, riverAreaFor, type HydrologySettings, type HydrologyOverlay } from '../../../rust/bridge/hydrology';
import { CLIMATE_VALUES, DEFAULT_NEURAL_TUNING, NEURAL_RELIEF_DEFAULTS, climateOf, type ClimateValues, type NeuralTuning } from '../../../rust/bridge/terrain';
import { lakeColour, riverSegments, vectorOverlayPixels, vectorOverlaySvg, vectorWaterSvg, VECTOR_LEGENDS, VECTOR_OVERLAYS, type VectorOverlay } from './vectorWaterRender';
import { lakeField } from './lakeGeometry';
import { TerrainGl, type TerrainLook } from './terrainGl';
import { Terrain3d, TERRAIN_3D_FOV, TERRAIN_GROUND_MAX_SCALE, type Terrain3dCamera, type Terrain3dTile } from './terrain3d';
import { terrain3dTexture } from './terrain3dTexture';
import { withBuildingOccupation } from './forestOccupation';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import { city3dScene, rasterHeight } from '../render/city3dMeshes';
import { TerrainRefinementSession, type TerrainRefinement } from './terrainRefinement';
import neuralModels from '../../../rust/models/neural-earth/catalog.json';
import { CONTOUR_INTERVAL } from '../render/contours';
import { DEFAULT_FRACTAL_DETAIL, neuralWindow, seedHash, type FractalDetail } from '../../../rust/bridge/terrainAdjust';
import { renderHydrology, hydrologySegments, hydrologyWaterColour, HYDROLOGY_LEGENDS } from '../../../rust/bridge/hydrologyRender';
import { createPins } from './pins';
import { createRuler } from './ruler';
import { createTerrainSettlements } from './terrainSettlements';
import { settlementRaster } from '../../../rust/bridge/settlements';
import { buildForestField, DEFAULT_FOREST_SETTINGS, type ForestField, type ForestFieldInput, type ForestOccupation, type ForestSettings } from '../../../rust/bridge/terrainForest';
import { forestDisplayWater, forestRetainedWater, forestRiverSegments } from '../../../rust/bridge/terrainForestWater';
import { forestRetainedRiverSegments } from '../../../rust/bridge/terrainForestRiparian';
import type { ForestRaster } from '../../../rust/bridge/terrainMaterialRaster';
import ForestWorker from './forestWorker?worker&inline';
import type { ForestReply, ForestRequest } from './forestWorker';
import { pinsFromString, pinsToString, viewFromString, viewToString } from './share';
import { clampView, fitView, panBy, screenToWorld, worldToScreen, zoomAt, type View } from '../render/view';
import { COAST_DIRECTIONS, ISLAND_MODES, type IslandMode, TERRAIN_SOURCES, NEURAL_RELIEFS, NEURAL_CLIMATES, NEURAL_EXTENT, DEFAULT_NEURAL_SERVER, DEFAULT_PYTHON_SERVER, neuralServerForSource, isNeuralSource, type TerrainSource, type NeuralClimate } from '../../../rust/bridge/terrain';
import { captureDecorData, downloadBytes } from './decorCapture';
import type { Decor } from './decor';
import { createHistoryPanel, downloadHistory, openBench, readHistory, saveHistory, syncBenchUrl } from './benchHistory';
import { createTerrainDecorLibrary } from './terrainDecorLibrary';
import { cropCityDecor, cropTerrain, terrainFromDecor } from './benchTerrainTransfer';
import { decorWaterSvg } from './decorWater';
import { chooseExportCrop } from './exportCrop';
import { exportPng } from './pngExport';
import type {} from './benchContext';
import { installRecipeSharing, portableRecipe } from './recipeSharing';
import { executionRuntime, executionProfiles, applyExecutionProfile, installExecutionProfile } from './executionProfile';
import { initialTerrainSource } from './terrainStartupState';
import { terrainLoading } from './terrainStartup';
import { mountIllustration, captureViewport } from '../../../illustration/web/index.mjs';
import { illustrationContext } from './illustrationContext';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const profileDefaults = executionProfiles[executionRuntime.profile];
installExecutionProfile(document.querySelector('header')!);
if (executionRuntime.profile === 'local') el<HTMLSelectElement>('generationCompute').add(new Option('Rust natif', 'native'));
const preferredNeural = el<HTMLSelectElement>('terrainSource').querySelector<HTMLOptionElement>(`option[value="${profileDefaults.neural}"]`);
if (preferredNeural) preferredNeural.textContent += ' · profil';
registerFantasyBrushes(fantasyLibraries);
const input = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const map = document.getElementById('map') as unknown as SVGSVGElement;
const viewport = el('viewport');
// GPU renderer; the SVG keeps the legacy Rust hydrology diagnostics and serves as the event surface.
let gpu: TerrainGl | undefined;
const fantasyTiles = createFantasyTerrainLayer(error => status(`Brushes: ${error instanceof Error ? error.message : error}`, true));
const fantasyOptions = { ...DEFAULT_FANTASY_OPTIONS };
for (const key of ['density', 'size', 'spacing'] as const) {
  const value = Number(new URLSearchParams(location.search).get(`brush_${key}`));
  if (value > 0 && Number.isFinite(value)) fantasyOptions[key] = Math.max(key === 'size' ? .1 : .3, Math.min(2, value));
}
fantasyOptions.followLanduse = new URLSearchParams(location.search).get('brush_landuse') === '1';
if (new URLSearchParams(location.search).get('render') !== 'svg') {
  try { gpu = new TerrainGl(el<HTMLCanvasElement>('gl')); viewport.classList.add('gl'); }
  catch (error) { console.warn('WebGL2 rendering unavailable, falling back to SVG:', error); }
}
if (!gpu) el('gl').remove();
else {
  // A lost context (driver reset, GPU switch) comes back empty: rebuild and re-upload.
  el('gl').addEventListener('webglcontextlost', event => { event.preventDefault(); gpu?.dispose(); });
  el('gl').addEventListener('webglcontextrestored', () => {
    try { gpu?.dispose(); gpu = new TerrainGl(el<HTMLCanvasElement>('gl')); uploaded = undefined; displayedDetail = undefined; render(); }
    catch (error) { status(`WebGL2 rendering lost: ${error instanceof Error ? error.message : error}`, true); }
  });
}
const query = sketchQuery(new URL(location.href));
for (const [field, entries] of [['coarseModel', neuralModels.coarse], ['baseModel', neuralModels.base], ['decoderModel', neuralModels.decoder]] as const) {
  const control = el<HTMLSelectElement>(field);
  control.replaceChildren(...entries.map(entry => new Option(entry.label, entry.id)));
  const selected = query.get(field) ?? neuralModels.defaults[field];
  control.value = entries.some(entry => entry.id === selected) ? selected : neuralModels.defaults[field];
}
if (el<HTMLSelectElement>('baseModel').value === 'residual8k') {
  el<HTMLSelectElement>('coarseModel').value = 'coarse2';
  if (el<HTMLSelectElement>('decoderModel').value === 'original') el<HTMLSelectElement>('decoderModel').value = 'decoder64';
}
const pipelineStage = query.get('stage') === 'settlements' ? 'settlements' : 'terrain';
// Compatibility for the offline catalogue exporter, which intentionally runs all upstream stages.
const legacyPipeline = query.get('pipeline') === 'legacy';
let retainedDecor: Decor | undefined, lastExport: Decor | undefined;
let lastExportState: ReturnType<typeof capturePipelineState> | undefined;
let drawTransferSelection: (() => void) | undefined;
const finite = (value: string | null, fallback: number): number => value !== null && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
const bounded = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
el<HTMLSelectElement>('style').replaceChildren(...TERRAIN_STYLE_LIST.map(style => {
  const option = document.createElement('option'); option.value = style.id; option.textContent = style.label; return option;
}));
for (const control of TERRAIN_LAYER_CONTROLS) {
  const field = input(control.id), label = field.closest('label')!;
  label.title = control.description; label.dataset.displayKind = 'layer';
  for (const node of Array.from(label.childNodes)) if (node.nodeType === Node.TEXT_NODE) node.textContent = control.label;
}
el('style').title = DISPLAY_VOCABULARY.style; el('style').dataset.displayKind = 'style';
const diagnosticSelect = el<HTMLSelectElement>('hydroOverlay');
diagnosticSelect.title = DISPLAY_VOCABULARY.diagnostic; diagnosticSelect.dataset.displayKind = 'diagnostic';
diagnosticSelect.replaceChildren();
for (const definition of DIAGNOSTICS) {
  let parent: HTMLSelectElement | HTMLOptGroupElement = diagnosticSelect;
  if (definition.group) {
    const group = Array.from(diagnosticSelect.querySelectorAll('optgroup')).find(group => group.label === definition.group) ?? document.createElement('optgroup');
    group.label = definition.group; if (!group.parentElement) diagnosticSelect.append(group); parent = group;
  }
  const option = document.createElement('option'); option.value = definition.id; option.textContent = definition.label; option.title = definition.legend; parent.append(option);
}
const brushPanel = document.createElement('fieldset');
brushPanel.innerHTML = '<legend>Fantasy · Brushes</legend>';
for (const [key, label] of [['density', 'Densité'], ['size', 'Taille'], ['spacing', 'Espacement']] as const) {
  const row = document.createElement('label'), slider = document.createElement('input');
  row.textContent = label; slider.type = 'range'; slider.min = key === 'size' ? '.1' : '.3'; slider.max = '2'; slider.step = '.05'; slider.value = String(fantasyOptions[key]); slider.id = `brush_${key}`;
  slider.oninput = () => { fantasyOptions[key] = Number(slider.value); render(); deferSave(); };
  row.append(slider); brushPanel.append(row);
}
el('lightingControls').querySelector('.lighting-fields')!.append(brushPanel);
const followLanduseRow = document.createElement('label');
followLanduseRow.innerHTML = '<input id="brush_landuse" type="checkbox">Suivre l’occupation du territoire';
const followLanduse = followLanduseRow.querySelector('input')!;
followLanduse.checked = !!fantasyOptions.followLanduse;
followLanduse.onchange = () => { fantasyOptions.followLanduse = followLanduse.checked; render(); deferSave(); };
followLanduseRow.title = 'Utilise les zones générées à l’étape Settlements, même masquées. Arbres en forêt, cultures dans les champs, vergers et marais dans leurs zones. Sans occupation générée, seuls les motifs de relief restent.';
brushPanel.append(followLanduseRow);
for (const format of ['svg', 'png'] as const) {
  const button = document.createElement('button'); button.id = `fantasyExport_${format}`; button.textContent = format === 'svg' ? 'Exporter SVG' : 'Exporter PNG · 4K';
  button.type = 'button'; button.style.width = 'auto'; button.style.flex = '0 0 auto'; button.style.padding = '2px 8px';
  button.id = `fantasyExport_${format}`; button.onclick = async () => {
    if (!terrain || !isFantasyStyle(style)) return;
    button.disabled = true;
    try {
      const scene = renderRustTerrain(terrain, style, true, settings, false, 'export', lighting, layers, fantasyOptions, false, baseStyle);
      const svg = map.cloneNode(true) as SVGSVGElement;
      for (const id of ['terrainOverview', 'terrainDetail', 'fantasyPainting']) svg.querySelector(`#${id}`)?.remove();
      svg.setAttribute('viewBox', `0 0 ${terrain.width} ${terrain.width}`); svg.setAttribute('width', '4096'); svg.setAttribute('height', '4096');
      const ground = document.createElementNS('http://www.w3.org/2000/svg', 'g'); ground.innerHTML = scene.svg; svg.prepend(ground);
      if (layers.relief) {
        const painting = document.createElementNS('http://www.w3.org/2000/svg', 'g'); painting.innerHTML = renderFantasyTerrain(terrain, style, settings, fantasyOptions, settlements.paintingContext);
        svg.insertBefore(painting, svg.querySelector('#landuseLayer, #hydrologyOverlay, #settlementOverlay'));
      }
      // Canvas children do not survive SVG serialization; embed the displayed overlay.
      const sources = map.querySelectorAll('foreignObject');
      svg.querySelectorAll('foreignObject').forEach((host, i) => {
        const canvas = sources[i]?.querySelector('canvas');
        if (!canvas) return;
        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        for (const key of ['x', 'y', 'width', 'height']) image.setAttribute(key, host.getAttribute(key) ?? '0');
        image.setAttribute('href', canvas.toDataURL('image/png')); host.replaceWith(image);
      });
      const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
      const cropped = await chooseExportCrop(blob, 4096);
      if (!cropped) return;
      let exported = cropped.blob;
      if (format === 'png') {
        exported = await exportPng(cropped.blob, cropped, () => {});
      }
      const url = URL.createObjectURL(exported), a = document.createElement('a'); a.href = url; a.download = `magna-urbis-${style}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) { status(`Export: ${error instanceof Error ? error.message : error}`, true); }
    finally { button.disabled = false; }
  }; brushPanel.append(button);
}
const layerFields = { relief: 'showRelief', hypsometry: 'showHypsometry', frame: 'showFrame' } as const;
let layers: TerrainLayers = { ...DEFAULT_TERRAIN_LAYERS };
for (const [key, id] of Object.entries(layerFields)) {
  layers[key as keyof TerrainLayers] = query.get(`layer_${key}`) !== '0'; input(id).checked = layers[key as keyof TerrainLayers] !== false;
}
input('showLegend').checked = query.get('legend') !== '0';
const lightingFields = { azimuth: ['lightAzimuth', 0, 360], elevation: ['lightElevation', 5, 90], strength: ['lightStrength', 0, 3], exaggeration: ['lightExaggeration', 0, 10] } as const;
let lighting: TerrainLighting = { ...DEFAULT_TERRAIN_LIGHTING, enabled: query.get('shading') !== '0' };
for (const [key, [id, min, max]] of Object.entries(lightingFields)) {
  const property = key as keyof typeof lightingFields;
  lighting[property] = bounded(finite(query.get(`light_${key}`), DEFAULT_TERRAIN_LIGHTING[property]), min, max);
  input(id).value = String(lighting[property]);
}
input('showShading').checked = lighting.enabled;
const initialRelief = query.get('relief') as TerrainRelief;
const geological = (relief: string): boolean => (GEOLOGICAL_RELIEFS as readonly string[]).includes(relief);
const initialEnvironment = query.get('environment') as TerrainEnvironment;
// Bare legacy neural links follow Python/CUDA; an explicit endpoint retains native replay.
const initialSource = initialTerrainSource(query, profileDefaults.neural);
const neuralRelief = (relief: string): boolean => (NEURAL_RELIEFS as readonly string[]).includes(relief);
// A custom endpoint belongs to the backend selected by the link, not subsequent modes.
const neuralServerFor = (source?: TerrainSource): string => neuralServerForSource(source, source === initialSource ? query.get('neural') : undefined);
const neuralAssets = new URL('./neural/', location.href).href;
const climateFields = { temperature: 'climTemperature', temperatureStd: 'climTemperatureStd', precipitation: 'climPrecipitation', precipitationCv: 'climPrecipitationCv' } as const;
const tuningFields = {
  landScale: 'nLandScale', steps: 'nSteps', noiseTemperature: 'nNoiseTemperature', noiseTemperatureStd: 'nNoiseTemperatureStd',
  noisePrecipitation: 'nNoisePrecipitation', noisePrecipitationCv: 'nNoisePrecipitationCv', reliefScale: 'nReliefScale', reliefFixed: 'nReliefFixed', detail: 'nDetail',
} as const;
// Detail noise of the fractal refinement: display only, applied live by the WebGL renderer.
const detailNoiseFields = {
  amplitude: ['dnAmplitude', 0, 2], hurst: ['dnHurst', 0, 1.5], lacunarity: ['dnLacunarity', 1.2, 4], octaves: ['dnOctaves', 1, 12],
  start: ['dnStart', 0.25, 8], slope: ['dnSlope', 0, 2], flat: ['dnFlat', 0, 0.5], shore: ['dnShore', 0, 50],
} as const satisfies Record<keyof FractalDetail, readonly [string, number, number]>;
// Procedural erosion settings: an empty field keeps the relief default, shown as placeholder.
const erosionFields: Record<ErosionSetting, readonly [label: string, title: string, min: number, max: number, step: number]> = {
  iterations: ['Evolution steps', 'Uplift and erosion steps of the coarse landscape evolution', 1, 200, 1],
  incision: ['Incision ×', 'Stream-power incision rate (K) of the landscape evolution', 0, 10, 0.05],
  incisionSlope: ['Incision onset slope', 'Slope (m/m) at which channel incision reaches half strength; lower values cut plains too', 0.01, 2, 0.01],
  fill: ['Pit fill ×', 'Sediment deposited each step in closed depressions, as a share of their depth', 0, 10, 0.05],
  carve: ['Sill carving', 'Share of each closed depression’s depth cut at its outlet sill each step; 0 keeps closed basins', 0, 1, 0.05],
  finalCarve: ['Final sill carving', 'Sill carving of the two final drainage passes', 0, 1, 0.05],
  talus: ['Talus slope', 'Critical slope (m/m) of thermal relaxation', 0.01, 3, 0.01],
  thermal: ['Thermal ×', 'Rate of thermal relaxation (landslides above the talus slope)', 0, 10, 0.05],
  diffusion: ['Hillslope diffusion', 'Soil creep smoothing hillslopes (channels are spared)', 0, 3, 0.01],
  detail: ['Ridge detail', 'Ridged detail added after the evolution on slopes outside channels, as a share of relief', 0, 0.5, 0.005],
  warp: ['Domain warp ×', 'Warp of the reconstruction from the coarse grid; it breaks grid alignment but adds pits', 0, 4, 0.05],
  surfaceIterations: ['Surface steps', 'Steps of the surface erosion at landform resolution', 0, 100, 1],
  surfaceIncision: ['Surface incision ×', 'Incision rate of the surface erosion', 0, 10, 0.05],
  surfaceCarve: ['Surface sill carving', 'Sill carving of each surface step (routed surface only)', 0, 1, 0.05],
  surfaceRouted: ['Routed surface', 'Surface water crosses depressions to their spill (1); 0 keeps strict downhill flow and closed bowls', 0, 1, 1],
  surfaceThermal: ['Surface thermal ×', 'Thermal relaxation rate of the surface erosion', 0, 10, 0.05],
  surfaceDiffusion: ['Surface diffusion ×', 'Hillslope diffusion of the surface erosion', 0, 10, 0.05],
};
for (const name of EROSION_SETTINGS) {
  const [text, title, min, max, step] = erosionFields[name];
  const label = document.createElement('label'), field = document.createElement('input');
  label.title = title; field.id = `er_${name}`; field.type = 'number'; field.min = String(min); field.max = String(max); field.step = String(step);
  label.append(`${text} `, field); el('erosionFields').insertBefore(label, el('erReset'));
}
const readErosionTuning = (value: (name: ErosionSetting) => string | null): ErosionTuning => {
  const tuning: ErosionTuning = {};
  for (const name of EROSION_SETTINGS) {
    const raw = value(name)?.trim(), [, , min, max] = erosionFields[name];
    if (raw && Number.isFinite(Number(raw))) tuning[name] = bounded(Number(raw), min, max);
  }
  return tuning;
};
const readDetailNoise = (value: (key: keyof FractalDetail, id: string) => string | null): FractalDetail => Object.fromEntries(
  (Object.entries(detailNoiseFields) as [keyof FractalDetail, readonly [string, number, number]][])
    .map(([key, [id, min, max]]) => [key, bounded(finite(value(key, id), DEFAULT_FRACTAL_DETAIL[key]), min, max)])) as unknown as FractalDetail;
const initialClimate = query.get('climate') ?? 'temperate';
const initialClimateValues: ClimateValues = { ...CLIMATE_VALUES[(NEURAL_CLIMATES as readonly string[]).includes(initialClimate) ? initialClimate as NeuralClimate : 'temperate'] };
if (initialClimate === 'custom') for (const key of Object.keys(climateFields) as (keyof ClimateValues)[]) initialClimateValues[key] = finite(query.get(key), initialClimateValues[key]);
const initialTuning: NeuralTuning = { ...DEFAULT_NEURAL_TUNING, histogram: [...DEFAULT_NEURAL_TUNING.histogram] };
if (initialSource === 'neural-python' && !query.has('n_steps')) initialTuning.steps = neuralModels.coarse.find(model => model.id === el<HTMLSelectElement>('coarseModel').value)?.steps ?? initialTuning.steps;
for (const key of Object.keys(tuningFields) as (keyof typeof tuningFields)[]) initialTuning[key] = finite(query.get(`n_${key}`), initialTuning[key]);
if (['auto', 'scale', 'fixed'].includes(query.get('n_reliefMode') ?? '')) initialTuning.reliefMode = query.get('n_reliefMode') as NeuralTuning['reliefMode'];
if (query.get('n_histogram')) initialTuning.histogram = query.get('n_histogram')!.split(',').slice(0, 5).map(v => finite(v, 0));
while (initialTuning.histogram.length < 5) initialTuning.histogram.push(0);
// Version 3 links chose the sketch noise from three presets.
const initialFidelity = bounded(finite(query.get('fidelity'), 0.05), 0.001, 2);
let sketchLinkError: string | undefined;
let initialSketch: TerrainSketch | undefined;
let initialZones: TerrainZones | undefined;
try { initialZones = decodeZones(query.get('zones')); }
catch (error) { sketchLinkError = String(error); }
try { initialSketch = query.has('heightmap') ? await readStoredSketch(query.get('heightmap')!) : decodeSketch(query.get('sketch')); }
catch (e) { sketchLinkError = `Entrée du lien indisponible : ${e instanceof Error ? e.message : String(e)}`; }
let appliedSketchRef: { sketch: TerrainSketch; id: string } | undefined = initialSketch && query.has('heightmap') ? { sketch: initialSketch, id: query.get('heightmap')! } : undefined;
let storingSketch: { sketch: TerrainSketch; promise: Promise<void> } | undefined;
async function retainAppliedSketch(): Promise<void> {
  const sketch = settings.sketch;
  if (!sketch || appliedSketchRef?.sketch === sketch || encodeSketch(sketch).length <= INLINE_SKETCH_LIMIT) return;
  if (storingSketch?.sketch === sketch) return storingSketch.promise;
  const promise = storeSketch(sketch).then(id => { if (settings.sketch === sketch) appliedSketchRef = { sketch, id }; });
  storingSketch = { sketch, promise }; return promise;
}
let settings: TerrainSettings = {
  zones: initialZones,
  sketch: initialSketch,
  seed: query.get('seed')?.slice(0, 120) || '42',
  width: bounded(finite(query.get('width'), 2400), 500, 100000),
  // Version 1 links had no independent physical motif scale.
  motifSize: bounded(finite(query.get('motif'), 3000), 250, 50000),
  relief: RELIEFS.includes(initialRelief) ? initialRelief : 'flat',
  environment: ENVIRONMENT_RELIEFS.includes(initialEnvironment) ? initialEnvironment : 'mixed',
  coastMask: (query.get('coasts') ?? '').split(',').reduce((mask, direction) => {
    const index = (COAST_DIRECTIONS as readonly string[]).indexOf(direction);
    return index < 0 ? mask : mask | (1 << index);
  }, 0),
  islandMode: ISLAND_MODES.includes(query.get('islands') as IslandMode) ? query.get('islands') as IslandMode : 'island',
  mountainMix: bounded(finite(query.get('mix'), 0.5), 0, 1),
  erosion: bounded(finite(query.get('erosion'), 1), 0, 2), resolution: 512,
  compute: COMPUTE_MODES.includes(query.get('compute') as TerrainCompute) ? query.get('compute') as TerrainCompute : profileDefaults.compute as TerrainCompute,
  generationCompute: ['cpu', 'gpu', 'gpu-all', 'gpu-erosion', ...(executionRuntime.profile === 'local' ? ['native'] : [])].includes(query.get('generation') ?? '') ? query.get('generation') as TerrainSettings['generationCompute'] : profileDefaults.generation as TerrainSettings['generationCompute'],
  source: initialSource,
  climate: NEURAL_CLIMATES.includes(query.get('climate') as NeuralClimate) ? query.get('climate') as NeuralClimate : 'temperate',
  climateValues: initialClimateValues,
  fidelity: initialFidelity,
  neuralServer: neuralServerFor(initialSource), neuralAssets,
  neuralTuning: initialTuning,
  coarseModel: el<HTMLSelectElement>('coarseModel').value, baseModel: el<HTMLSelectElement>('baseModel').value, decoderModel: el<HTMLSelectElement>('decoderModel').value,
  neuralFit: query.get('fit') === 'scale' ? 'scale' : 'crop',
  neuralSlopes: query.get('slopes') !== '0',
  refine: query.get('refine') !== '0',
  detailNoise: readDetailNoise(key => query.get(`d_${key}`)),
  erosionTuning: readErosionTuning(name => query.get(`e_${name}`)),
};
// Only old versioned neural links had a fixed 40 km extent; fresh maps stay small.
if (isNeuralSource(settings.source)) {
  if (['2', '3'].includes(query.get('v') ?? '')) settings.width = NEURAL_EXTENT;
  if (!neuralRelief(settings.relief)) settings.relief = 'mixed';
}
const hydroFields = {
  enabled: 'hydroEnabled', main: 'hydroMain', density: 'hydroDensity', coastalStreams: 'hydroCoastal', wetness: 'hydroWetness', lakes: 'hydroLakes',
  erosionEnabled: 'hydroErosionEnabled', showErosion: 'hydroShowErosion',
  meanders: 'hydroMeanders', meanderIntensity: 'hydroMeanderIntensity', estuary: 'hydroEstuary', widthScale: 'hydroWidthScale',
  incision: 'hydroIncision', minLakeArea: 'hydroMinLakeArea', minLakeDepth: 'hydroMinLakeDepth', resolution: 'hydroResolution', compute: 'hydroCompute',
  lakeAbundance: 'hydroLakeAbundance', lakeCoverage: 'hydroLakeCoverage', maxLakeArea: 'hydroMaxLakeArea',
  depressionPolicy: 'hydroDepressionPolicy', maxBreachDepth: 'hydroMaxBreachDepth', maxBreachLength: 'hydroMaxBreachLength',
  engine: 'hydroEngine', condMode: 'hydroCondMode', condStrength: 'hydroCondStrength', condDepth: 'hydroCondDepth', condLength: 'hydroCondLength',
  riverArea: 'hydroRiverArea', lakeDepth: 'hydroLakeDepth', lakeArea: 'hydroLakeArea', riverMode: 'hydroRiverMode', flatSlope: 'hydroFlatSlope',
  sinuosity: 'hydroSinuosity', vectorWidth: 'hydroVectorWidth', vectorResolution: 'hydroVectorResolution', balance: 'hydroBalance', braiding: 'hydroBraiding',
  anabranching: 'hydroAnabranching', terrainInfluence: 'hydroTerrainInfluence', avulsions: 'hydroAvulsions', confluence: 'hydroConfluence', deltas: 'hydroDeltas',
} as const;
const hydroPercentFields = new Set(['lakeCoverage', 'maxLakeArea']);
function readHydrology(): HydrologySettings {
  const values = Object.fromEntries(Object.entries(hydroFields).map(([key, id]) => {
    const control = el<HTMLInputElement | HTMLSelectElement>(id);
    const fallback = DEFAULT_HYDROLOGY[key as keyof HydrologySettings];
    let value: boolean | number | string = typeof fallback === 'boolean' ? input(id).checked : control.value;
    if (typeof fallback === 'number') {
      const scale = hydroPercentFields.has(key) ? 100 : 1;
      const numeric = finite(control.value, fallback * scale);
      value = control instanceof HTMLInputElement
        ? bounded(numeric, control.min === '' ? 0 : Number(control.min), control.max === '' ? Number.MAX_SAFE_INTEGER : Number(control.max))
        : numeric;
      value = Number(value) / scale;
    }
    return [key, value];
  }));
  return values as unknown as HydrologySettings;
}
const initialHydrology = { ...DEFAULT_HYDROLOGY };
for (const [key, id] of Object.entries(hydroFields)) {
  const property = key as keyof HydrologySettings;
  const fallback = DEFAULT_HYDROLOGY[property];
  const raw = query.get(`hydro_${key}`);
  const control = el<HTMLInputElement | HTMLSelectElement>(id);
  if (typeof fallback === 'boolean') input(id).checked = raw === null ? key === 'enabled' && query.get('engine') === 'rust' && query.get('v') === '2' ? false : fallback : raw !== '0';
  else if (typeof fallback === 'number') {
    const scale = hydroPercentFields.has(key) ? 100 : 1;
    const numeric = finite(raw, fallback) * scale;
    control.value = String(numeric);
    if (control instanceof HTMLInputElement) {
      control.value = String(bounded(numeric, control.min === '' ? 0 : Number(control.min), control.max === '' ? Number.MAX_SAFE_INTEGER : Number(control.max)));
    }
    if (!control.value) control.value = String(fallback * scale);
  } else {
    control.value = raw ?? fallback;
    if (!control.value) control.value = fallback;
  }
}
if (query.get('v') === '3' || query.get('v') === '2') {
  if (query.get('hydro_engine') === null) el<HTMLSelectElement>('hydroEngine').value = 'rust';
  if (query.get('hydro_condMode') === null) el<HTMLSelectElement>('hydroCondMode').value = 'none';
}
Object.assign(initialHydrology, readHydrology());
settings.hydrology = initialHydrology;
const overlays: (HydrologyOverlay | VectorOverlay)[] = ['none', 'basins', 'accumulation', 'flow', 'depressions', 'lakes', 'channels', 'raw-basins', 'raw-accumulation', 'raw-flow', 'raw-depressions', 'flats', 'flat-rank', ...VECTOR_OVERLAYS];
let hydroOverlay: HydrologyOverlay | VectorOverlay = overlays.includes((query.get('diagnostic') ?? query.get('overlay')) as HydrologyOverlay) ? (query.get('diagnostic') ?? query.get('overlay')) as HydrologyOverlay : 'none';
const isVectorOverlay = (overlay: string): overlay is VectorOverlay => (VECTOR_OVERLAYS as string[]).includes(overlay);
input('showLakes').checked = query.get('lakes') !== '0'; input('showOxbows').checked = query.get('oxbows') !== '0';
el<HTMLSelectElement>('hydroOverlay').value = hydroOverlay;
input('showWater').checked = query.get('water') !== '0'; layers.water = input('showWater').checked;
let baseStyle: TerrainStyle = isTerrainStyle(query.get('style')) && query.get('style') !== 'copernicus' ? query.get('style') as TerrainStyle : 'parchment';
let elevationDiagnostic = query.get('diagnostic') === 'elevation' || query.get('style') === 'copernicus';
let style: TerrainStyle = elevationDiagnostic ? 'copernicus' : baseStyle;
diagnosticSelect.value = elevationDiagnostic ? 'elevation' : hydroOverlay;

let view: View = viewFromString(query.get('view')) || fitView(settings.width, viewport.clientWidth, viewport.clientHeight);
let terrain: TerrainData | undefined;
let sketchEditor: ReturnType<typeof createTerrainSketchEditor> | undefined;
let zoningWasActive = !!initialZones, zoningSource = initialSource;
let pinMode = false, generation = 0, requestId = 0, terrainGeneration = 0;
let overviewRequest: TerrainRequest | undefined, detailRequest: TerrainRequest | undefined;
let overviewPending = false, generationError: string | undefined;
let generationTimer: ReturnType<typeof setTimeout> | undefined, detailTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let renderingMs = 0, contourStep = 0, detailSamplingMs = 0;
let rasterWaterMask: TerrainScene['waterMask'];
interface DetailTile {
  terrain: Pick<TerrainData, 'x' | 'y' | 'width' | 'resolution' | 'height' | 'caveMask' | 'generationMs' | 'backend' | 'backendReason' | 'prepareMs' | 'samplingMs' | 'gpuSetupMs'>;
  style: TerrainStyle; key: string;
  /** SVG fallback only. */
  scene?: TerrainScene; image?: HTMLImageElement; ready: Promise<void>;
}
const detailCache = new Map<string, DetailTile>();
let displayedDetail: DetailTile | undefined;
let cursor: [number, number] | undefined;
let perspective = false, terrain3d: Terrain3d | undefined;
let refinement3d: TerrainRefinement = query.get('refinement3d') === 'source' ? 'source' : query.get('refinement3d') === 'neural-earth' ? 'neural-earth' : 'noise';
let refinementTerrain: TerrainData | undefined, refinementReady: Promise<TerrainRefinementSession> | undefined;
let refinementSession: TerrainRefinementSession | undefined, refinement2dTimer: ReturnType<typeof setTimeout> | undefined, refinement2dKey = '';
let refinementEpoch = 0, refinement2dWanted = '';
let refinementError = '';
el<HTMLSelectElement>('refinement3d').value = refinement3d;
// Render3D forest: display-only settings, outside TerrainSettings. One canonical
// field per input set feeds the map and the perspective; edits never regenerate.
let forest: ForestSettings = {
  enabled: query.get('forest') !== '0',
  density: bounded(finite(query.get('forestDensity'), DEFAULT_FOREST_SETTINGS.density), 0, 2),
  clearings: bounded(finite(query.get('forestClearings'), DEFAULT_FOREST_SETTINGS.clearings), 0, 1),
};
interface ForestEntry { field: ForestField; occupation?: ForestOccupation; source: Float32Array }
interface ForestJob { key: string; data: TerrainData; input: ForestFieldInput; settings: ForestSettings }
let forestOccupation: ForestOccupation | undefined, forestShown: ForestEntry | undefined, forestWanted = '';
let appliedBuildingScene: PlacementBatch | undefined;
let buildingOccupationSource: ForestOccupation | undefined, buildingOccupationScene: PlacementBatch | undefined, buildingOccupation: ForestOccupation | undefined;
let scene3dOf: [PlacementBatch | undefined, Decor | undefined] | undefined, scene3d: PlacementBatch | undefined;
/** The 3D view shows the city as City Bench does (render/city3dMeshes.ts):
 * silhouettes raised with the same massing volumes and roofs as the 2D map. */
function buildings3d(scene: PlacementBatch | undefined): PlacementBatch | undefined {
  if (!scene3dOf || scene3dOf[0] !== scene || scene3dOf[1] !== retainedDecor) {
    const r = retainedDecor?.raster;
    scene3dOf = [scene, retainedDecor];
    scene3d = scene && city3dScene(scene, { heightAt: r ? rasterHeight(r.height, r.n, r.width) : undefined });
  }
  return scene3d;
}
/** Accepted physical footprints clear the same canopy in 2D and exported rasters. */
function displayedForestOccupation(source: ForestOccupation | undefined): ForestOccupation | undefined {
  if (source !== buildingOccupationSource || appliedBuildingScene !== buildingOccupationScene) {
    buildingOccupationSource = source; buildingOccupationScene = appliedBuildingScene;
    buildingOccupation = withBuildingOccupation(source, appliedBuildingScene);
  }
  return buildingOccupation;
}
let forestTimer: ReturnType<typeof setTimeout> | undefined, forestQueued: ForestJob | undefined, forestRunning = false, forestRendering = false;
// One reusable worker; without it (or after it fails) the field is built on the UI thread, with a notice.
let forestWorker: Worker | undefined, forestReply: ((reply: ForestReply | undefined) => void) | undefined;
try {
  forestWorker = new ForestWorker();
  forestWorker.onmessage = (event: MessageEvent<ForestReply>) => forestReply?.(event.data);
  forestWorker.onerror = event => { event.preventDefault(); forestWorker?.terminate(); forestWorker = undefined; forestReply?.(undefined); };
} catch (error) { console.warn('Forest worker unavailable, building on the UI thread:', error); }
const forestCache = new Map<string, ForestEntry>(), forestWaterCache = new WeakMap<TerrainData, Uint8Array>(), forestIds = new WeakMap<object, number>();
let forestIdCount = 0;
const forestId = (value: object | undefined): number => {
  if (!value) return 0;
  let id = forestIds.get(value);
  if (!id) forestIds.set(value, id = ++forestIdCount);
  return id;
};
input('forestEnabled').checked = forest.enabled;
input('forestDensity').value = String(Math.round(forest.density * 100));
input('forestClearings').value = String(Math.round(forest.clearings * 100));
let texture3dTimer: ReturnType<typeof setTimeout> | undefined, texture3dEpoch = 0;
let surface3d: TerrainData | undefined, surface3dWater: unknown, surface3dVisibility = '';
let camera3d: Terrain3dCamera | undefined;
let selectingPortion = false;
const cameraValues = (query.get('camera3d') ?? '').split(',').map(Number);
if (cameraValues.length === 6 && cameraValues.every(Number.isFinite)) {
  const [x, y, distance, yaw, pitch, exaggeration] = cameraValues;
  camera3d = { x, y, distance, yaw, pitch, exaggeration };
}

function camera3dChanged(): void {
  if (!terrain3d) return;
  camera3d = terrain3d.getCamera();
  if (pipelineStage === 'settlements') { settlements.urban.buildingState.camera = camera3d; settlements.urban.buildingState.projection = perspective; }
  input('exaggeration3d').value = String(camera3d.exaggeration);
  el('exaggeration3dValue').textContent = camera3d.exaggeration.toFixed(1).replace('.0', '');
  el('terrain3dInfo').textContent = `Distance ${(camera3d.distance / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km · inclinaison ${Math.round(camera3d.pitch * 180 / Math.PI)}°`;
  if (perspective) scheduleDetail();
  deferSave();
}

const perspectiveScale = (camera: Terrain3dCamera): number => viewport.clientHeight / (2 * Math.tan(TERRAIN_3D_FOV / 2) * camera.distance);

function refinementStatus(message: string): void {
  el('refinement3dStatus').textContent = message;
  el('refinement3dStatus').hidden = refinement3d !== 'neural-earth' || !(perspective || isRender3dStyle(style));
  el('retryRefinement').hidden = !refinementError || refinement3d !== 'neural-earth' || !(perspective || isRender3dStyle(style));
}

function reportRefinementError(error: unknown): void {
  if ((error as Error)?.name === 'AbortError') return;
  refinementError = error instanceof Error ? error.message : String(error);
  refinementStatus(refinementError);
}

function ensureRefinement(): Promise<TerrainRefinementSession> {
  if (!terrain) return Promise.reject(new Error('Terrain indisponible.'));
  if (refinementTerrain !== terrain || !refinementReady) {
    refinementSession?.dispose(); refinementSession = undefined; refinementTerrain = terrain; refinementError = '';
    const epoch = ++refinementEpoch;
    const retained = terrain, field = retained.field;
    refinementStatus('Neural Earth · préparation…');
    const server = settings.source === 'neural-python' ? settings.neuralServer ?? DEFAULT_PYTHON_SERVER : DEFAULT_PYTHON_SERVER;
    refinementReady = TerrainRefinementSession.create(server, { x: 0, y: 0, width: retained.width, n: field?.n ?? retained.resolution, data: field?.data ?? retained.height }, {
      seed: retained.neural?.neuralSeed ?? String(seedHash(settings.seed) >>> 0), source: settings.source, neuralToken: retained.neural?.neuralToken,
      neuralWindow: isNeuralSource(settings.source) ? neuralWindow(NEURAL_EXTENT, retained.width, settings.neuralFit ?? 'crop', settings.neuralSlopes ?? true, settings.coastMask ?? 0) : undefined,
    }).then(session => {
      if (refinementTerrain !== retained || epoch !== refinementEpoch) { session.dispose(); throw new DOMException('Terrain remplacé', 'AbortError'); }
      refinementSession = session;
      refinementStatus(`Neural Earth · ${session.registration.decoderUsed ? 'décodeur + noise' : 'noise sur relief retenu'} · jusqu’à ${session.registration.minMpp.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} m`);
      return session;
    }).catch(error => {
      if (refinementTerrain === retained && epoch === refinementEpoch) { refinementError = error instanceof Error ? error.message : String(error); refinementStatus(refinementError); }
      throw error;
    });
  }
  return refinementReady;
}

function schedule2dRefinement(): void {
  clearTimeout(refinement2dTimer);
  if (perspective || !isRender3dStyle(style) || refinement3d !== 'neural-earth' || !terrain || !gpu || (refinementError && refinementTerrain === terrain)) return;
  const currentTerrain = terrain, extent = Math.max(viewport.clientWidth, viewport.clientHeight) / view.scale * 1.5;
  const step = extent / 8, x = Math.floor((view.cx - extent / 2) / step) * step, y = Math.floor((view.cy - extent / 2) / step) * step;
  const key = `${generation}:${x}:${y}:${extent}`;
  refinement2dWanted = key;
  if (key === refinement2dKey) return;
  refinement2dTimer = setTimeout(() => {
    void ensureRefinement().then(session => session.tile({ x, y, width: extent }, 768)).then(height => {
      if (terrain !== currentTerrain || perspective || !isRender3dStyle(style) || refinement3d !== 'neural-earth' || key !== refinement2dWanted) return;
      refinement2dKey = key; gpu?.setEnhancedDetail(height);
    }).catch(error => {
      if (terrain === currentTerrain && !perspective && isRender3dStyle(style) && refinement3d === 'neural-earth' && key === refinement2dWanted) reportRefinementError(error);
    });
  }, 160);
}

/** Keep the applied water, cadastral ground and roads in texture order. Buildings
 * stay in their physical 3D pass, so roofs never become painted ground. */
let groundOverlayEpoch = -1, groundOverlaySvg = '';
function appliedGroundOverlay(): string {
  if (groundOverlayEpoch === texture3dEpoch) return groundOverlaySvg;
  // Omit the building subtree before cloning. A roof scene may contain hundreds
  // of thousands of nodes and never contributes to a ground material texture.
  const groundCopy = (node: Node): Node | undefined => {
    if (node instanceof Element && node.matches('[data-urban-buildings], [data-urban-building]')) return undefined;
    // The city canvas only holds the 2D framing: load3dTile paints the plan per tile instead.
    if (node instanceof Element && node.matches('[data-city-canvas]')) return undefined;
    // An SVG foreignObject taints Canvas/WebGL even when empty. Preserve retained
    // rural paint as a plain image instead of cloning its HTML canvas subtree.
    if (node instanceof Element && node.localName === 'foreignObject') {
      const canvas = node.querySelector('canvas');
      if (!canvas || !canvas.width || !canvas.height) return undefined;
      const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      for (const key of ['x', 'y', 'width', 'height']) image.setAttribute(key, node.getAttribute(key) ?? '0');
      image.setAttribute('href', canvas.toDataURL('image/png')); return image;
    }
    const copy = node.cloneNode(false);
    for (const child of Array.from(node.childNodes)) {
      const kept = groundCopy(child); if (kept) copy.appendChild(kept);
    }
    return copy;
  };
  groundOverlaySvg = Array.from(map.querySelectorAll<SVGGElement>('#hydrologyOverlay, #urbanOverlay, #roadOverlay'))
    .map(layer => (groundCopy(layer) as SVGGElement).outerHTML).join('');
  groundOverlayEpoch = texture3dEpoch;
  return groundOverlaySvg;
}

async function load3dTile(tile: Terrain3dTile) {
  const epoch = texture3dEpoch;
  // Leave input and rendering a frame between material tiles.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  if (!perspective || !terrain || !gpu || epoch !== texture3dEpoch) throw new DOMException('Tuile remplacée', 'AbortError');
  // The map canvas is hidden during flyover; restore it when returning to 2D,
  // rather than repainting the entire map after every small material tile.
  let height;
  try { height = refinement3d === 'neural-earth' ? await (await ensureRefinement()).tile(tile, tile.pixels) : undefined; }
  catch (error) { if (epoch === texture3dEpoch) reportRefinementError(error); throw error; }
  if (!perspective || epoch !== texture3dEpoch) throw new DOMException('Tuile remplacée', 'AbortError');
  // Sample real neighbours into a gutter, rather than duplicating the edge
  // texel. Adjacent tiles then interpolate the same world-space samples.
  const gutter = 2, pad = tile.width / tile.pixels * gutter;
  const region = { x: tile.x - pad, y: tile.y - pad, width: tile.width + 2 * pad };
  const canvas = gpu.captureRegion(region, tile.pixels + 2 * gutter, true, false, height, ground3dEnabled());
  const result = await terrain3dTexture(canvas, terrain, style, settings, fantasyOptions, layers.relief, appliedGroundOverlay(), region, settlements.paintingContext,
    ctx => settlements.urban.drawGround(ctx, region, canvas.width));
  if (!perspective || epoch !== texture3dEpoch) throw new DOMException('Tuile remplacée', 'AbortError');
  // Crown centres can lie outside the displayed patch. A separate, globally
  // aligned 1 m mask retains a 64 m halo without enlarging the fine colour tile.
  let canopyWater;
  if(ground3dEnabled() && layers.water !== false && tile.width<=2048){
    const x=Math.floor(tile.x-64),y=Math.floor(tile.y-64);
    const width=Math.max(Math.ceil(tile.x+tile.width+64)-x,Math.ceil(tile.y+tile.width+64)-y);
    canopyWater={x,y,width,n:width,alpha:gpu.captureWaterMask({x,y,width})};
  }
  return { texture: result, height, gutter, water: canopyWater };
}

function ground3dEnabled(): boolean { return isRender3dStyle(style) && layers.relief && layers.hypsometry; }
/** The forest replaces the legacy macro canopy only where Render3D shows its ground material. */
function forestActive(): boolean { return forest.enabled && ground3dEnabled(); }
/** The shown canonical field for Render3D rasters (no TerrainGl); undefined keeps the legacy canopy. */
function forestRaster(region = terrain): ForestRaster | undefined {
  if (!isRender3dStyle(style) || !forestShown || !terrain || !region) return undefined;
  return { field: forestShown.field, occupation: displayedForestOccupation(forestShown.occupation), brushes: style === 'render3d-brush',
    water: !input('showWater').checked ? undefined : retainedDecor ? forestRetainedWater(retainedDecor.meta.waterSvg, terrain.width, region, input('showLakes').checked)
      : forestDisplayWater(terrain, { showLakes: input('showLakes').checked, showOxbows: input('showOxbows').checked,
        riverArea: riverAreaFor(settings.hydrology ?? DEFAULT_HYDROLOGY, settings.width), riverMode: settings.hydrology?.riverMode ?? 'vector' }, region) };
}
/** Keep the applied terrain recipe while recording its displayed style and forest controls. */
function withForestQuery(d: Decor): Decor {
  const params = new URLSearchParams(d.meta.query);
  params.set('style', baseStyle);
  params.set('forest', forest.enabled ? '1' : '0');
  for (const key of ['forestDensity', 'forestClearings'] as const) {
    const value = key === 'forestDensity' ? forest.density : forest.clearings;
    if (value !== DEFAULT_FOREST_SETTINGS[key === 'forestDensity' ? 'density' : 'clearings']) params.set(key, String(value)); else params.delete(key);
  }
  return { ...d, meta: { ...d.meta, query: params.toString() } };
}
function updateForestControls(): void {
  el('forestControls3d').hidden = !isRender3dStyle(style);
  input('forestDensity').disabled = input('forestClearings').disabled = !forest.enabled;
  el('forestDensityValue').textContent = `${Math.round(forest.density * 100)} %`;
  el('forestClearingsValue').textContent = `${Math.round(forest.clearings * 100)} %`;
}
function showForest(entry: ForestEntry | undefined): void {
  const changed = entry !== forestShown;
  forestShown = entry;
  gpu?.setForest(entry?.field, displayedForestOccupation(entry?.occupation));
  // Terrain3d merges its applied building scene internally; pass the base only.
  terrain3d?.setForest(entry?.field, entry?.occupation);
  // Without TerrainGl, the Render3D raster carries the field: redraw it once per change.
  if (changed && !gpu && !forestRendering && terrain && isRender3dStyle(style)) render();
}
/** Sea, lakes and rivers on the height grid: the applied raster, else the displayed water geometry. */
function forestWater(data: TerrainData, n: number): Uint8Array | undefined {
  const raster = retainedDecor?.raster;
  if (raster && data === terrain && raster.n === n && raster.water.length === n * n) return raster.water;
  let water = forestWaterCache.get(data);
  if (!water) {
    const adapted = settlementRaster(data, n);
    if (adapted.n !== n) return undefined;
    forestWaterCache.set(data, water = adapted.water);
  }
  return water;
}
/** Displayed river geometry for the narrow gallery envelope: retained bank paths, else live water. */
function forestRivers(data: TerrainData): Float32Array | undefined {
  if (retainedDecor) return forestRetainedRiverSegments(retainedDecor.meta.waterSvg, data.width);
  return forestRiverSegments(data, { showLakes: input('showLakes').checked, showOxbows: input('showOxbows').checked,
    riverArea: riverAreaFor(settings.hydrology ?? DEFAULT_HYDROLOGY, settings.width), riverMode: settings.hydrology?.riverMode ?? 'vector' });
}
/** Runs the latest queued build, one at a time; stale results are cached but not shown. */
function runForest(): void {
  const job = forestQueued;
  if (forestRunning || !job) return;
  forestQueued = undefined;
  if (forestWanted !== job.key || terrain !== job.data || !forestActive()) return;
  forestRunning = true;
  const started = performance.now();
  const done = (field: ForestField | undefined, ms: number, thread: string, error?: string): void => {
    forestRunning = false;
    if (field) {
      const entry = { field, occupation: job.input.occupation, source: job.input.height.data };
      forestCache.set(job.key, entry);
      while (forestCache.size > 3) forestCache.delete(forestCache.keys().next().value!);
      const controls = el('forestControls3d');
      controls.dataset.buildMs = ms.toFixed(1); controls.dataset.waitMs = (performance.now() - started).toFixed(1); controls.dataset.thread = thread;
      controls.title = `Champ forestier ${field.n}² · ${ms.toFixed(0)} ms${thread === 'main' ? ' (fil principal)' : ''}`;
      if (forestWanted === job.key && terrain === job.data && forestActive()) showForest(entry);
    } else if (forestWanted === job.key) status(`Forêt : ${error}`, true);
    runForest();
  };
  const onMain = (): void => {
    const t = performance.now();
    try { done(buildForestField(job.input, job.settings), performance.now() - t, 'main'); }
    catch (error) { done(undefined, 0, 'main', error instanceof Error ? error.message : String(error)); }
  };
  if (!forestWorker) { setTimeout(onMain); return; }
  forestReply = reply => {
    forestReply = undefined;
    if (!reply) { status('Forêt : worker indisponible, calcul sur le fil principal.', true); onMain(); }
    else if ('field' in reply) done(reply.field, reply.ms, 'worker');
    else done(undefined, 0, 'worker', reply.error);
  };
  // Structured clone copies heights, water and occupation: the bench keeps its retained arrays.
  forestWorker.postMessage({ input: job.input, settings: job.settings } satisfies ForestRequest);
}
/** Coalesced build in the forest worker; the key covers every input of the field. */
function scheduleForest(delay = 0): void {
  clearTimeout(forestTimer);
  if (!terrain || !forestActive()) { forestWanted = ''; if (forestShown) showForest(undefined); return; }
  const data = terrain, field = data.field, n = field?.n ?? data.resolution;
  const height = { x: 0, y: 0, width: data.width, n, data: field?.data ?? data.height };
  const climate = climateOf(settings), seed = seedHash(settings.seed), occupation = forestOccupation, chosen = { ...forest };
  const riverSegments = forestRivers(data);
  const key = [forestId(height.data), forestId(data), n, data.width, seed, climate.temperature, climate.precipitation, forestId(retainedDecor?.raster), forestId(riverSegments), chosen.density, chosen.clearings, occupation?.key ?? ''].join(':');
  forestWanted = key;
  const cached = forestCache.get(key);
  if (cached) { forestCache.delete(key); forestCache.set(key, cached); showForest(cached); return; }
  // Setting edits keep the current stand of the same relief until the new field is ready.
  showForest(forestShown?.source === height.data ? forestShown : undefined);
  forestTimer = setTimeout(() => {
    if (forestWanted !== key || terrain !== data || !forestActive()) return;
    forestQueued = { key, data, input: { seed, climate: [climate.temperature, climate.precipitation], height, water: forestWater(data, n), riverSegments, occupation }, settings: chosen };
    runForest();
  }, delay);
}
function forestChanged(): void {
  forest = { enabled: input('forestEnabled').checked, density: bounded(Number(input('forestDensity').value) / 100, 0, 2), clearings: bounded(Number(input('forestClearings').value) / 100, 0, 1) };
  updateForestControls(); scheduleForest(120); settlements.refreshForestMaterial(); deferSave();
}
for (const id of ['forestEnabled', 'forestDensity', 'forestClearings']) input(id).addEventListener('input', forestChanged);
updateForestControls();

function setPerspective(active: boolean): void {
  active &&= !legacyPipeline && !!gpu;
  if (active && !terrain3d) {
    try { terrain3d = new Terrain3d(el<HTMLCanvasElement>('terrain3d'), camera3dChanged, () => ruler.update()); terrain3d.setTileLoader(load3dTile, refinement3d === 'neural-earth'); terrain3d.setForest(forestShown?.field, forestShown?.occupation); }
    catch (error) { status(`Vue 3D : ${error instanceof Error ? error.message : error}`, true); active = false; }
  }
  if (active) {
    if (!perspective) { gpu?.setDetail(undefined); displayedDetail = undefined; }
    if (!perspective && surface3d && terrain3d) {
      terrain3d.setCamera({ ...terrain3d.getCamera(), x: view.cx, y: view.cy, distance: viewport.clientHeight / (2 * Math.tan(TERRAIN_3D_FOV / 2) * view.scale) });
      camera3dChanged();
    }
    selectingPortion = false; document.getElementById('transferPick')?.setAttribute('aria-pressed', 'false');
    sketchEditor?.setEditing(false); settlements.cancelPicking();
    pinMode = false; el('pinMode').setAttribute('aria-pressed', 'false'); viewport.classList.remove('pin-mode');
  } else if (perspective && terrain3d) {
    camera3d = terrain3d.getCamera();
    view = { cx: camera3d.x, cy: camera3d.y, scale: perspectiveScale(camera3d) };
  }
  perspective = active;
  viewport.classList.toggle('perspective', active);
  el('projection3d').setAttribute('aria-pressed', String(active));
  el('projection3d').textContent = active ? '2D' : '3D';
  el('projection3d').title = active ? 'Revenir à la carte 2D' : 'Survoler le relief en 3D';
  el('perspectiveControls').hidden = !active;
  el('refinement3dControl').hidden = !active && !isRender3dStyle(style);
  el('refinement3dStatus').hidden = refinement3d !== 'neural-earth' || (!active && !isRender3dStyle(style));
  el('retryRefinement').hidden = !refinementError || refinement3d !== 'neural-earth' || (!active && !isRender3dStyle(style));
  el('terrain3d').setAttribute('aria-hidden', String(!active));
  el('terrain3d').tabIndex = active ? 0 : -1;
  terrain3d?.setActive(active);
  if (active) { terrain3d?.resize(viewport.clientWidth, viewport.clientHeight); schedule3dTexture(); }
  else { ++texture3dEpoch; clearTimeout(texture3dTimer); updateView(); }
  ruler.update();
  deferSave();
}

function schedule3dTexture(): void {
  // Only scene changes invalidate the LOD cache; camera motion selects reusable tiles.
  ++texture3dEpoch;
  clearTimeout(texture3dTimer);
  if (!perspective || !terrain || !gpu || !terrain3d) return;
  const epoch = texture3dEpoch;
  texture3dTimer = setTimeout(() => { void refresh3dTexture(epoch); }, 60);
}

async function refresh3dTexture(epoch: number): Promise<void> {
  if (!perspective || !terrain || !gpu || !terrain3d || epoch !== texture3dEpoch) return;
  try {
    const ground = ground3dEnabled();
    const buildings = settlements.urban.buildingState;
    terrain3d.setBuildings(buildings3d(buildings.scene), buildings.appearance, settlements.urban.buildingVisible);
    // Establish the style's zoom range before restoring a shared camera.
    terrain3d.setGroundMaterial(ground ? {
      seed: seedHash(settings.seed), climate: climateOf(settings),
      sourceCell: retainedDecor?.meta.terrainDisplay?.sourceCell ?? settings.width / 1024,
      lighting, displacement: refinement3d !== 'source', forestBrushes: style === 'render3d-brush',
      contours: input('showContours').checked && contourInterval()>0 ? {
        step: contourInterval(), color: terrainStyle(style).palette.contour,
        opacity: terrainStyle(style).palette.contourOpacity, flat: settings.relief === 'flat',
      } : undefined,
    } : undefined);
    const waterVisible = input('showWater').checked, lakesVisible = waterVisible && input('showLakes').checked;
    const water = terrain.water, hydro = terrain.hydrology, retained = retainedDecor?.raster;
    const waterSource = retained ?? water ?? hydro;
    const visibility = `${waterVisible}:${lakesVisible}`;
    if (surface3d !== terrain || surface3dWater !== waterSource || surface3dVisibility !== visibility) {
      let lake: { n: number; mask: Float32Array; levels: Float32Array } | undefined;
      if (lakesVisible && retained) lake = { n: retained.n, mask: Float32Array.from(retained.water, value => value === 2 ? 1 : -1), levels: retained.waterLevel };
      else if (lakesVisible && water) lake = { n: water.hydro.n, mask: lakeField(water.lake, water.hydro.n).values, levels: water.lakeLevel ?? water.hydro.filled };
      else if (lakesVisible && hydro) {
        const levels = new Map<number, number>();
        for (let i = 0; i < hydro.lakeMeta.length; i += 6) levels.set(hydro.lakeMeta[i], hydro.lakeMeta[i + 1]);
        lake = { n: hydro.resolution, mask: hydro.waterField, levels: Float32Array.from(hydro.lakeLabels, label => levels.get(label) ?? NaN) };
      }
      const field = terrain.field;
      terrain3d.setSurface({ x: 0, y: 0, width: terrain.width, n: field?.n ?? terrain.resolution, data: field?.data ?? terrain.height }, lake, waterVisible);
      if (!surface3d) {
        if (camera3d) terrain3d.setCamera(camera3d);
        else terrain3d.fit(view.cx, view.cy, Math.max(viewport.clientWidth, viewport.clientHeight) / view.scale);
      } else if (surface3d.width !== terrain.width) terrain3d.fit();
      surface3d = terrain; surface3dWater = waterSource; surface3dVisibility = visibility;
      camera3dChanged();
    }
    const canvas = gpu.captureMap(2048, ground);
    const texture = await terrain3dTexture(canvas, terrain, style, settings, fantasyOptions, layers.relief, appliedGroundOverlay(), undefined, settlements.paintingContext);
    if (perspective && epoch === texture3dEpoch) {
      terrain3d.setTileBoundaries(input('tileBounds3d').checked);
      terrain3d.setHeightSampler(gpu.createSurfaceSampler());
      terrain3d.invalidateTiles();
      terrain3d.setTexture(texture);
    }
  } catch (error) {
    if (epoch !== texture3dEpoch) return;
    setPerspective(false);
    status(`Vue 3D : ${error instanceof Error ? error.message : error}`, true);
  }
}

function updateCoordinates(): void {
  if (perspective) return;
  if (!cursor) return;
  const [x, y] = screenToWorld(view, viewport.clientWidth, viewport.clientHeight, ...cursor);
  const contains = (data: DetailTile['terrain']): boolean => x >= data.x && y >= data.y && x <= data.x + data.width && y <= data.y + data.width;
  const data = displayedDetail && contains(displayedDetail.terrain) ? displayedDetail.terrain : terrain;
  let z = '—';
  const shown = gpu?.heightAt(x, y);
  if (shown !== undefined) z = shown.toFixed(1);
  else if (data && contains(data)) {
    // Samples lie at cell centers; interpolate the displayed elevation grid.
    const n = data.resolution;
    const gx = bounded((x - data.x) / data.width * n - 0.5, 0, n - 1);
    const gy = bounded((y - data.y) / data.width * n - 0.5, 0, n - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1);
    const tx = gx - x0, ty = gy - y0;
    const top = data.height[y0 * n + x0] * (1 - tx) + data.height[y0 * n + x1] * tx;
    const bottom = data.height[y1 * n + x0] * (1 - tx) + data.height[y1 * n + x1] * tx;
    z = (top * (1 - ty) + bottom * ty).toFixed(1);
  }
  let diagnostic = '';
  const water = terrain?.water;
  if (water && x >= 0 && y >= 0 && x < water.hydro.width && y < water.hydro.width) {
    const h = water.hydro, c = Math.floor(y / h.width * h.n) * h.n + Math.floor(x / h.width * h.n), depth = h.filled[c] - h.height[c];
    diagnostic = ` · upstream ${(h.accumulation[c] / 1e6).toFixed(2)} km²${depth > 0 && !h.sea[c] ? ` · depression ${depth.toFixed(1)} m` : ''}`;
    if (water.lakeKind?.[c]) diagnostic += ` · ${water.lakeKind[c] === 2 ? 'closed' : 'open'} lake, level ${water.lakeLevel![c].toFixed(1)} m`;
    const cond = terrain?.conditioning;
    if (cond && hydroOverlay === 'v-conditioning') {
      const k = Math.floor(y / h.width * cond.n) * cond.n + Math.floor(x / h.width * cond.n);
      diagnostic += ` · conditioning ${cond.delta[k] >= 0 ? '+' : ''}${cond.delta[k].toFixed(1)} m`;
    }
  }
  const hydro = terrain?.hydrology;
  if (hydro && hydroOverlay !== 'none' && x >= 0 && y >= 0 && x < hydro.width && y < hydro.width) {
    const n = hydro.resolution, i = Math.floor(y / hydro.width * n) * n + Math.floor(x / hydro.width * n);
    if (hydroOverlay === 'basins') diagnostic = ` · watershed ${hydro.basins[i]}`;
    else if (hydroOverlay === 'raw-basins') diagnostic = ` · raw watershed ${hydro.rawBasins[i]}`;
    else if (hydroOverlay === 'raw-accumulation') diagnostic = ` · raw drained area ${(hydro.rawAccumulation[i] / 1e6).toFixed(3)} km²`;
    else if (hydroOverlay === 'flats' || hydroOverlay === 'flat-rank') diagnostic = hydro.flatLabels[i] ? ` · flat area ${hydro.flatLabels[i]} · rank ${hydro.flatRank[i]}` : ' · outside flat areas';
    else if (hydroOverlay === 'accumulation' || hydroOverlay === 'channels') diagnostic = ` · drained area ${(hydro.accumulation[i] / 1e6).toFixed(3)} km²`;
    else if (hydroOverlay === 'depressions') diagnostic = ` · depression ${Math.max(0, hydro.filled[i] - hydro.drainageHeight[i]).toFixed(2)} m`;
    else if (hydroOverlay === 'raw-depressions') diagnostic = ` · raw depression ${Math.max(0, hydro.rawFilled[i] - hydro.rawDrainageHeight[i]).toFixed(2)} m`;
    else if (hydroOverlay === 'lakes') diagnostic = ` · lake ${hydro.lakeLabels[i]} · depth ${hydro.lakeDepth[i].toFixed(2)} m`;
    else if (hydroOverlay === 'flow' || hydroOverlay === 'raw-flow') {
      const receiver = (hydroOverlay === 'raw-flow' ? hydro.rawReceivers : hydro.receivers)[i];
      const dx = receiver % n - i % n, dy = Math.floor(receiver / n) - Math.floor(i / n);
      diagnostic = receiver >= n * n ? ' · outlet' : ` · flow ${dy < 0 ? 'N' : dy > 0 ? 'S' : ''}${dx < 0 ? 'W' : dx > 0 ? 'E' : ''}${dx === 0 && dy === 0 ? 'stationary' : ''}`;
    }
  }
  el('coordinates').textContent = `x ${x.toFixed(1)} · y ${y.toFixed(1)} · z ${z} m${diagnostic}`;
}

input('width').value = String(settings.width); input('motifSize').value = String(settings.motifSize);
input('mountainMix').value = String(settings.mountainMix);
input('seed').value = settings.seed; input('erosion').value = String(settings.erosion);
el<HTMLSelectElement>('relief').value = settings.relief; el<HTMLSelectElement>('style').value = baseStyle;
el<HTMLSelectElement>('environment').value = settings.environment!;
el<HTMLSelectElement>('compute').value = settings.compute!;
el<HTMLSelectElement>('generationCompute').value = settings.generationCompute!;
if (settings.source === 'neural') {
  const legacy = document.createElement('option'); legacy.value = 'neural'; legacy.textContent = 'Rust natif · ancien lien'; el('terrainSource').append(legacy);
}
el<HTMLSelectElement>('terrainSource').value = settings.source!;
window.dispatchEvent(new Event('bench-source-change'));
el<HTMLSelectElement>('climate').value = initialClimate === 'custom' ? 'custom' : settings.climate!;
for (const [key, id] of Object.entries(climateFields)) input(id).value = String(initialClimateValues[key as keyof ClimateValues]);
input('fidelity').value = String(settings.fidelity);
for (const [key, id] of Object.entries(tuningFields)) input(id).value = String(initialTuning[key as keyof typeof tuningFields]);
el<HTMLSelectElement>('nReliefMode').value = initialTuning.reliefMode;
initialTuning.histogram.forEach((v, k) => { input(`nH${k}`).value = String(v); });
el<HTMLSelectElement>('neuralFit').value = settings.neuralFit!; input('neuralSlopes').checked = settings.neuralSlopes!;
input('refine').checked = settings.refine!;
for (const [key, [id]] of Object.entries(detailNoiseFields)) input(id).value = String(settings.detailNoise![key as keyof FractalDetail]);
input('auto').checked = query.get('auto') !== '0'; input('showPins').checked = query.get('showPins') !== '0';
input('showContours').checked = query.get('contours') !== '0';
function updateContourControl(): void {
  const shaded = style !== 'copernicus' && layers.relief;
  input('showShading').disabled = !shaded;
  input('showHypsometry').disabled = !shaded;
  for (const [id] of Object.values(lightingFields)) input(id).disabled = !shaded || !lighting.enabled;
  input('showContours').disabled = isFantasyStyle(style) || style === 'copernicus' || settings.relief === 'cavern';
  map.dataset.contours = String(input('showContours').checked && !input('showContours').disabled);
}
updateContourControl();
let draftCoastMask = settings.coastMask ?? 0;
const coastButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-coast]'));
el<HTMLSelectElement>('islandMode').value = settings.islandMode!;
function updateCoastControl(): void {
  const cavern = el<HTMLSelectElement>('relief').value === 'cavern';
  coastButtons.forEach(button => {
    const index = (COAST_DIRECTIONS as readonly string[]).indexOf(button.dataset.coast!);
    button.setAttribute('aria-pressed', String((draftCoastMask & (1 << index)) !== 0));
    button.disabled = cavern;
  });
  el<HTMLButtonElement>('coastAll').disabled = cavern;
  el('coastAll').setAttribute('aria-pressed', String(draftCoastMask === 255));
  el('coastControl').title = cavern ? 'No coasts in caverns' : 'Choose the directions covered by the sea';
  el('islandControl').hidden = cavern || draftCoastMask !== 255;
}
function updateHydrologyControl(): void {
  const cavern = el<HTMLSelectElement>('relief').value === 'cavern';
  for (const id of Object.values(hydroFields)) {
    el<HTMLInputElement | HTMLSelectElement>(id).disabled = cavern || (id !== 'hydroEnabled' && !input('hydroEnabled').checked);
  }
  el<HTMLButtonElement>('generateHydrology').disabled = cavern;
  el<HTMLButtonElement>('generateCoasts').disabled = cavern;
  el('hydroControls').title = cavern ? 'Hydrology is disabled in caverns; settings are preserved.' : '';
  el('hydroDensityValue').textContent = `${Math.round(Number(input('hydroDensity').value) * 100)} %`;
  el('hydroCoastalValue').textContent = `${Math.round(Number(input('hydroCoastal').value) * 100)} %`;
  el('hydroCondStrengthValue').textContent = `${Math.round(Number(input('hydroCondStrength').value) * 100)} %`;
  const rust = el<HTMLSelectElement>('hydroEngine').value === 'rust';
  el('vectorControls').hidden = rust; el('rustControls').hidden = !rust;
  for (const id of ['hydroCondMode', 'hydroCondStrength', 'hydroCondDepth', 'hydroCondLength', 'hydroIncision', 'hydroMaxBreachDepth', 'hydroMaxBreachLength']) {
    el<HTMLInputElement | HTMLSelectElement>(id).disabled ||= !input('hydroErosionEnabled').checked;
  }
  input('hydroCondStrength').disabled ||= !['erosion', 'both'].includes(el<HTMLSelectElement>('hydroCondMode').value);
  for (const option of Array.from(el<HTMLSelectElement>('hydroOverlay').options)) option.disabled = !diagnosticAvailable(option.value, rust ? 'rust' : 'vector');
  el('hydroLakeAbundanceValue').textContent = `× ${Number(input('hydroLakeAbundance').value).toFixed(2)}`;
  el('hydroLakeAbundanceControl').hidden = el<HTMLSelectElement>('hydroLakes').value !== 'some';
}
const isNeural = (): boolean => !sketchEditor?.snapshot()?.processing && isNeuralSource(el<HTMLSelectElement>('terrainSource').value as TerrainSource);
/** Neural relief: 40 km surface cropped or scaled to the map, regional families only, no procedural motif or erosion. */
function updateSourceControl(): void {
  const inputProcessing = sketchEditor ? sketchEditor?.snapshot()?.processing : settings.sketch?.processing;
  const neural = isNeural() && !inputProcessing, relief = el<HTMLSelectElement>('relief');
  el<HTMLSelectElement>('terrainSource').disabled = !!inputProcessing;
  for (const option of Array.from(relief.options)) option.disabled = neural && !neuralRelief(option.value);
  if (neural && !neuralRelief(relief.value)) relief.value = 'mixed';
  input('width').title = neural ? 'Map width: cropped window or scaled version of the 40 km neural surface' : '';
  el('motifControl').hidden = neural || inputProcessing === 'surface';
  el('erosionControl').hidden = neural || inputProcessing === 'surface';
  el('erosionAdvanced').hidden = neural || inputProcessing === 'surface';
  el('fidelityControl').hidden = !neural;
  el('neuralFitControl').hidden = !neural;
  el('neuralSlopesControl').hidden = !neural || el<HTMLSelectElement>('neuralFit').value !== 'scale';
  el('neuralAdvanced').hidden = !neural;
  const pythonModels = el<HTMLSelectElement>('terrainSource').value === 'neural-python';
  const compactBase = el<HTMLSelectElement>('baseModel').value === 'residual8k';
  input('nSteps').disabled = pythonModels && compactBase;
  for (const id of ['coarseModel', 'baseModel', 'decoderModel']) el<HTMLSelectElement>(id).disabled = !pythonModels;
  if (pythonModels && compactBase) {
    el<HTMLSelectElement>('coarseModel').value = 'coarse2'; el<HTMLSelectElement>('coarseModel').disabled = true;
    if (el<HTMLSelectElement>('decoderModel').value === 'original') el<HTMLSelectElement>('decoderModel').value = 'decoder64';
    for (const option of Array.from(el<HTMLSelectElement>('decoderModel').options)) option.disabled = option.value === 'original';
  } else for (const option of Array.from(el<HTMLSelectElement>('decoderModel').options)) option.disabled = false;
  el('neuralModelNote').textContent = !pythonModels ? 'Navigateur : profil fixe coarse4 → NF4 B75 → décodeur 64.' : compactBase ? 'Base compacte expérimentale : coarse2 requis, génération Tile40. Raffinement Neural Earth procédural sur cette sortie.' : 'Checkpoints complets sous 100 Mo conservés dans le dépôt ; base originale externe.';
  const mode = el<HTMLSelectElement>('nReliefMode').value;
  el('nReliefScaleControl').hidden = mode !== 'scale'; el('nReliefFixedControl').hidden = mode !== 'fixed';
  el('nReliefMode').title = `Auto: ${Object.entries(NEURAL_RELIEF_DEFAULTS).map(([k, v]) => `${k} ${v} m`).join(', ')} fixed; free elsewhere.`;
  el<HTMLSelectElement>('generationCompute').disabled = neural || !!inputProcessing || !!sketchEditor?.zones();
  el('neuralState').hidden = !neural;
  if (neural) void pollNeural();
  for (const button of coastButtons) button.disabled ||= !!inputProcessing;
  el<HTMLButtonElement>('coastAll').disabled ||= !!inputProcessing;
  el<HTMLButtonElement>('generateCoasts').disabled = !!inputProcessing || relief.value === 'cavern';
  window.dispatchEvent(new Event('bench-source-change'));
}
let neuralPolling: TerrainSource | undefined;
let neuralPollId = 0;
async function pollNeural(): Promise<void> {
  if (el<HTMLSelectElement>('terrainSource').value === 'neural-wasm') {
    neuralPolling = undefined; ++neuralPollId;
    el('neuralState').textContent = 'WASM / WebGPU · environ 162 Mo de poids au premier chargement, puis cache navigateur'; return;
  }
  const polledSource = el<HTMLSelectElement>('terrainSource').value as TerrainSource;
  const neuralServer = neuralServerFor(polledSource);
  if (neuralPolling === polledSource) return;
  neuralPolling = polledSource;
  const pollId = ++neuralPollId;
  const state = el('neuralState');
  try {
    while (pollId === neuralPollId && isNeural() && el<HTMLSelectElement>('terrainSource').value === polledSource) {
      let settled = false;
      try {
        const status = await (await fetch(`${neuralServer}/status`, { cache: 'no-store' })).json() as { state: string; message: string };
        if (pollId !== neuralPollId || el<HTMLSelectElement>('terrainSource').value !== polledSource) break;
        state.dataset.state = status.state;
        state.textContent = `Neural service: ${status.message}`;
        settled = status.state === 'ready' || status.state === 'error';
      } catch {
        if (pollId !== neuralPollId || el<HTMLSelectElement>('terrainSource').value !== polledSource) break;
        state.dataset.state = 'error';
        state.textContent = `Neural service unavailable (${neuralServer}): run “npm run ${el<HTMLSelectElement>('terrainSource').value === 'neural-python' ? 'neural:python' : 'neural:serve'}” from web/`;
      }
      if (settled && el('generate').getAttribute('aria-busy') !== 'true') break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally { if (pollId === neuralPollId) neuralPolling = undefined; }
}
function updateErosionControl(): void {
  const surfaceEditing = el<HTMLSelectElement>('relief').value !== 'cavern';
  sketchEditor?.setAvailable(surfaceEditing);
  const editButton = document.getElementById('editTerrain') as HTMLButtonElement | null;
  if (editButton) editButton.disabled = !surfaceEditing;
  updateCoastControl();
  updateHydrologyControl();
  updateSourceControl();
  if (el<HTMLSelectElement>('relief').value === 'cavern') sketchEditor?.setEditing(false);
  el('environmentControl').hidden = !geological(el<HTMLSelectElement>('relief').value);
  el('mountainMixControl').hidden = el<HTMLSelectElement>('relief').value !== 'mixed';
  el('mountainMixValue').textContent = `${Math.round(Number(input('mountainMix').value) * 100)} %`;
  const cavern = el<HTMLSelectElement>('relief').value === 'cavern';
  input('erosion').disabled = cavern;
  input('erosion').title = cavern ? 'No erosion in caverns' : 'Erosion intensity';
  el('erosionValue').textContent = cavern ? '—' : `${Math.round(Number(input('erosion').value) * 100)} %`;
}
updateErosionControl();

function status(message: string, error = false): void {
  el('status').textContent = message; el('status').dataset.error = String(error);
  if (error && (overviewPending || !terrain)) terrainLoading('error', message);
}
function shareQuery(): string {
  const params = new URLSearchParams({ brush_density: String(fantasyOptions.density), brush_size: String(fantasyOptions.size), brush_spacing: String(fantasyOptions.spacing), engine: 'rust', v: '4', seed: settings.seed, width: String(settings.width), motif: String(settings.motifSize), relief: settings.relief, erosion: String(settings.erosion), style: baseStyle, auto: input('auto').checked ? '1' : '0' });
  if (!gpu) params.set('render', 'svg');
  params.set('brush_landuse', fantasyOptions.followLanduse ? '1' : '0');
  for (const [key, value] of Object.entries(settings.hydrology ?? DEFAULT_HYDROLOGY)) params.set(`hydro_${key}`, typeof value === 'boolean' ? value ? '1' : '0' : String(value));
  params.set('diagnostic', elevationDiagnostic ? 'elevation' : hydroOverlay); params.set('overlay', hydroOverlay); params.set('water', input('showWater').checked ? '1' : '0');
  params.set('contours', input('showContours').checked ? '1' : '0');
  for (const [key, value] of Object.entries(layers)) params.set(`layer_${key}`, value ? '1' : '0');
  params.set('legend', input('showLegend').checked ? '1' : '0');
  params.set('shading', lighting.enabled ? '1' : '0');
  for (const key of Object.keys(lightingFields) as (keyof typeof lightingFields)[]) params.set(`light_${key}`, String(lighting[key]));
  if (settings.relief === 'mixed') params.set('mix', String(settings.mountainMix));
  if (geological(settings.relief)) params.set('environment', settings.environment ?? 'mixed');
  const climate = climateOf(settings), preset = CLIMATE_VALUES[settings.climate ?? 'temperate'];
  const custom = (Object.keys(preset) as (keyof ClimateValues)[]).some(key => preset[key] !== climate[key]);
  params.set('climate', custom ? 'custom' : settings.climate ?? 'temperate');
  if (custom) for (const [key, value] of Object.entries(climate)) params.set(key, String(value));
  params.set('refine', settings.refine ? '1' : '0');
  params.set('refinement3d', refinement3d);
  params.set('forest', forest.enabled ? '1' : '0');
  if (forest.density !== DEFAULT_FOREST_SETTINGS.density) params.set('forestDensity', String(forest.density));
  if (forest.clearings !== DEFAULT_FOREST_SETTINGS.clearings) params.set('forestClearings', String(forest.clearings));
  if (input('tileBounds3d').checked) params.set('tiles3d', '1');
  for (const [key, value] of Object.entries(settings.detailNoise ?? DEFAULT_FRACTAL_DETAIL)) if (value !== DEFAULT_FRACTAL_DETAIL[key as keyof FractalDetail]) params.set(`d_${key}`, String(value));
  params.set('water', input('showWater').checked ? '1' : '0'); params.set('lakes', input('showLakes').checked ? '1' : '0'); params.set('oxbows', input('showOxbows').checked ? '1' : '0');
  if (!isNeuralSource(settings.source)) for (const [name, value] of Object.entries(settings.erosionTuning ?? {})) params.set(`e_${name}`, String(value));
  if (isNeuralSource(settings.source)) {
    if (settings.source === 'neural-python') for (const key of ['coarseModel', 'baseModel', 'decoderModel'] as const) if (settings[key]) params.set(key, settings[key]!);
    params.set('source', settings.source!); params.set('fidelity', String(settings.fidelity ?? 0.05));
    params.set('fit', settings.neuralFit ?? 'crop'); params.set('slopes', settings.neuralSlopes ? '1' : '0');
    const tuning = settings.neuralTuning ?? DEFAULT_NEURAL_TUNING;
    for (const key of Object.keys(tuningFields) as (keyof typeof tuningFields)[]) if (tuning[key] !== DEFAULT_NEURAL_TUNING[key]) params.set(`n_${key}`, String(tuning[key]));
    if (tuning.reliefMode !== 'auto') params.set('n_reliefMode', tuning.reliefMode);
    if (tuning.histogram.some(v => v)) params.set('n_histogram', tuning.histogram.join(','));
    if (settings.neuralServer && settings.neuralServer !== (settings.source === 'neural-python' ? DEFAULT_PYTHON_SERVER : DEFAULT_NEURAL_SERVER)) params.set('neural', settings.neuralServer);
  }
  if (settings.relief !== 'cavern' && settings.coastMask) {
    params.set('coasts', COAST_DIRECTIONS.filter((_, i) => settings.coastMask! & (1 << i)).join(','));
    params.set('islands', settings.islandMode ?? 'island');
  }
  if (settings.sketch) {
    if (appliedSketchRef?.sketch === settings.sketch) params.set('heightmap', appliedSketchRef.id);
    else params.set('sketch', encodeSketch(settings.sketch));
  }
  if (settings.zones) params.set('zones', encodeZones(settings.zones));
  params.set('compute', settings.compute ?? 'gpu-f32');
  params.set('generation', settings.generationCompute ?? 'gpu-erosion');
  if (pipelineStage === 'settlements') params.set('stage', pipelineStage);
  if (legacyPipeline) params.set('pipeline', 'legacy');
  if (retainedDecor) params.set('artifact', retainedDecor.meta.id);
  settlements.share(params);
  if (pins.pins.length) params.set('pins', pinsToString(pins.pins));
  if (!input('showPins').checked) params.set('showPins', '0');
  if (!legacyPipeline) {
    const camera = surface3d ? terrain3d?.getCamera() ?? camera3d : camera3d;
    if (perspective) params.set('projection', '3d');
    if (camera) params.set('camera3d', [camera.x, camera.y, camera.distance, camera.yaw, camera.pitch, camera.exaggeration].map(value => Number(value.toFixed(6))).join(','));
  }
  params.set('view', viewToString(view)); return applyExecutionProfile(new URL(`?${params}`, location.href)).searchParams.toString();
}
function save(): void {
  clearTimeout(saveTimer);
  if (settings.sketch && appliedSketchRef?.sketch !== settings.sketch && encodeSketch(settings.sketch).length > INLINE_SKETCH_LIMIT) {
    void retainAppliedSketch().then(save).catch(error => status(String(error), true)); return;
  }
  try { const url = new URL(location.href); url.search = shareQuery(); if (query.get('standalone') === '1') url.searchParams.set('standalone', '1'); url.hash = ''; history.replaceState(null, '', placeSketchInFragment(url)); syncBenchUrl(); } catch { /* file:// may reject replaceState; copied links still carry all inputs. */ }
}
function deferSave(): void { clearTimeout(saveTimer); saveTimer = setTimeout(save, 150); }
const pins = createPins({
  map: viewport, layer: el('pinLayer'), pop: el('pinPopover'), list: el('pins'),
  onChange: deferSave,
  onFocus: pin => { setPerspective(false); setView({ ...view, cx: pin.x, cy: pin.y }); },
});
pins.set(pinsFromString(query.get('pins')));
const pinInput = el('pinPopover').querySelector('input')!; pinInput.placeholder = 'Pin note'; pinInput.setAttribute('aria-label', 'Pin note');
const pinDelete = el('pinPopover').querySelector('button')!; pinDelete.textContent = 'Delete'; pinDelete.title = 'Delete this pin';

const ruler = createRuler({ container: viewport, surface: map, getView: () => view,
  getSurface: () => perspective ? el('terrain3d') : map,
  screenToWorld: (x, y) => perspective ? terrain3d?.screenToWorld(x, y) ?? null : screenToWorld(view, viewport.clientWidth, viewport.clientHeight, x, y),
  worldToScreen: (x, y) => perspective ? terrain3d?.worldToScreen(x, y) ?? null : worldToScreen(view, viewport.clientWidth, viewport.clientHeight, x, y),
  onEnable: () => {
  sketchEditor?.setEditing(false);
  settlements.cancelPicking();
  pinMode = false; el('pinMode').setAttribute('aria-pressed', 'false'); viewport.classList.remove('pin-mode');
} });

const settlements = createTerrainSettlements({ map, viewport, getTerrain: () => terrain, getSettings: () => settings,
  active: pipelineStage === 'settlements' || legacyPipeline,
  parcelDefault: legacyPipeline,
  getRaster: pipelineStage === 'settlements' ? () => retainedDecor?.raster : undefined,
  getDecor: () => retainedDecor,
  getView: () => view, getAuto: () => input('auto').checked, getQuery: shareQuery, onChange: deferSave,
  useForestMaterial: forestActive,
  onForestOccupation: occupation => { forestOccupation = occupation; scheduleForest(); },
  onPlanChange: () => queueMicrotask(() => {
    // Initial settlement construction can call back before its binding exists.
    const b = settlements.urban.buildingState;
    appliedBuildingScene = b.scene;
    gpu?.setForest(forestShown?.field, displayedForestOccupation(forestShown?.occupation));
    terrain3d?.setBuildings(buildings3d(b.scene), b.appearance, settlements.urban.buildingVisible);
    refreshUrbanPainting();
    if (!gpu && terrain && isRender3dStyle(style)) render();
    if (perspective) schedule3dTexture();
  }),
  onProjection: (active, camera) => { if (camera) camera3d = camera; setPerspective(active); if (camera) terrain3d?.setCamera(camera); return perspective; },
  onFocus: (center, radius) => setView({ cx: center.x, cy: center.y, scale: Math.min(viewport.clientWidth, viewport.clientHeight) / Math.max(100, radius * 2.6) }),
  onPicking: () => {
    sketchEditor?.setEditing(false);
    pinMode = false; el('pinMode').setAttribute('aria-pressed', 'false'); viewport.classList.remove('pin-mode'); ruler.setEnabled(false);
  },
});

function refreshUrbanPainting(): void {
  const layer = map.querySelector<SVGGElement>('#fantasyPainting');
  if (!terrain || !layer || !isFantasyStyle(style) || !layers.relief) { fantasyTiles.clear(); return; }
  fantasyTiles.setScene(layer, prepareFantasyTerrain(terrain, style, settings, fantasyOptions, settlements.paintingContext));
}

function updateView(): void {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  view = clampView(view, terrain?.width ?? settings.width, w, h, isRender3dStyle(style) ? TERRAIN_GROUND_MAX_SCALE : 8);
  const contourWidths = terrainContourWidths(style, view.scale);
  map.style.setProperty('--terrain-contour-width', `${contourWidths.thin}px`);
  map.style.setProperty('--terrain-contour-index-width', `${contourWidths.index}px`);
  map.setAttribute('viewBox', `${view.cx - w / (2 * view.scale)} ${view.cy - h / (2 * view.scale)} ${w / view.scale} ${h / view.scale}`);
  fantasyTiles.setView(view, w, h);
  gpu?.setView(view, w, h);
  terrain3d?.resize(w, h);
  pins.update(view, w, h);
  ruler.update();
  settlements.updateView();
  drawTransferSelection?.();
  sketchEditor?.updateView();
  const sampling = displayedDetail ? `${(displayedDetail.terrain.width / displayedDetail.terrain.resolution).toFixed(2)} m / sample` : terrain?.field?.exact && gpu ? `raster ${(terrain.width / terrain.field.n).toFixed(1)} m + GPU detail` : 'overview';
  el('scale').textContent = `${(1 / view.scale).toFixed(1)} m / px · ${sampling}`;
  updateCoordinates();
  scheduleDetail();
  schedule2dRefinement();
}
function setView(next: View): void { view = next; updateView(); deferSave(); }
function fit(): void {
  if (perspective && terrain3d) { terrain3d.fit(); camera3dChanged(); return; }
  setView(fitView(terrain?.width ?? settings.width, viewport.clientWidth, viewport.clientHeight));
}
function local(event: MouseEvent | PointerEvent | WheelEvent): [number, number] {
  const bounds = viewport.getBoundingClientRect(); return [event.clientX - bounds.left, event.clientY - bounds.top];
}
function point(event: MouseEvent): [number, number] { const [x, y] = local(event); return screenToWorld(view, viewport.clientWidth, viewport.clientHeight, x, y); }
function zoom(factor: number, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2): void {
  if (perspective && terrain3d) { terrain3d.zoom(factor); return; }
  const limited = bounded(view.scale * factor, Math.min(viewport.clientWidth, viewport.clientHeight) / (terrain?.width ?? settings.width) * 0.5, isRender3dStyle(style) ? TERRAIN_GROUND_MAX_SCALE : 8) / view.scale;
  setView(zoomAt(view, limited, x, y, viewport.clientWidth, viewport.clientHeight));
}
function showPins(): void {
  el('pinLayer').hidden = !input('showPins').checked;
  if (!input('showPins').checked) el('pinPopover').hidden = true;
}
showPins();

function renderedStatus(): void {
  if (generationError) { status(`Rust engine error: ${generationError}`, true); return; }
  if (overviewPending) return;
  if (!terrain || terrainGeneration !== generation) return;
  const name = el<HTMLSelectElement>('relief').querySelector<HTMLOptionElement>(`option[value="${settings.relief}"]`)!.textContent;
  const environment = geological(settings.relief) ? ` · surroundings ${el<HTMLSelectElement>('environment').querySelector<HTMLOptionElement>(`option[value="${settings.environment ?? 'mixed'}"]`)!.textContent}` : '';
  const detail = displayedDetail ? ` · detail ${displayedDetail.terrain.resolution}² (${(displayedDetail.terrain.width / displayedDetail.terrain.resolution).toFixed(2)} m) · sampling ${detailSamplingMs.toFixed(0)} ms` : '';
  const data = displayedDetail?.terrain ?? terrain;
  const backend = data.backend === 'native' ? 'Rust natif' : data.backend === 'wasm' ? `CPU Rust${data.backendReason ? ` (${data.backendReason})` : ''}` : 'GPU FP32';
  const generationBackend = terrain.generationBackend === 'native' ? 'Rust natif' : terrain.generationBackend === 'gpu-erosion-f32' ? 'GPU FP32 erosion' : terrain.generationBackend === 'gpu-noise-all-f32' ? 'all GPU FP32 noise + CPU erosion' : terrain.generationBackend === 'gpu-noise-f32' ? 'fine GPU FP32 noise + CPU erosion' : 'CPU generation';
  const preparation = terrain.prepareMs === undefined ? '' : ` · preparation ${terrain.prepareMs.toFixed(0)} ms (${generationBackend}${terrain.gpuSimulationMs ? `, GPU simulation ${terrain.gpuSimulationMs.toFixed(0)} ms` : ''}${terrain.nativeEnvironmentMs ? `, CPU surroundings ${terrain.nativeEnvironmentMs.toFixed(0)} ms` : ''}${terrain.noiseMs ? `, noise ${terrain.noiseMs.toFixed(0)} ms, Rust remainder ${terrain.erosionMs!.toFixed(0)} ms` : ''})${terrain.generationReason ? ` · ${terrain.generationReason}` : ''}`;
  const setup = terrain.gpuSetupMs ? ` · GPU initialization ${terrain.gpuSetupMs.toFixed(0)} ms` : '';
  const coast = terrain.coastBackend ? ` · coast + erosion ${terrain.coastBackend === 'gpu-f32' ? 'GPU FP32' : 'Rust CPU'}${terrain.coastMs ? ` ${terrain.coastMs.toFixed(0)} ms` : ''}${terrain.coastReason ? ` (${terrain.coastReason})` : ''}` : '';
  const hydro = terrain.hydrology;
  const hydroStatus = el('hydrologyStatus');
  hydroStatus.hidden = !hydro && !terrain.hydrologyError;
  if (terrain.hydrologyError) hydroStatus.textContent = `Hydrology unavailable for this neural terrain: ${terrain.hydrologyError}`;
  const water = terrain.water, cond = terrain.conditioning;
  hydroStatus.hidden &&= !water;
  if (water) {
    const r = water.rivers;
    hydroStatus.textContent = `Vector water · drainage ${water.hydro.n}² ${water.hydrologyMs.toFixed(0)} ms${water.balanceMs ? ` · water balance ${water.balanceMs.toFixed(0)} ms (aridity ${water.runoff.aridity.toFixed(2)}, runoff ${water.runoff.r0.toFixed(0)} mm, evaporation ${water.runoff.e0.toFixed(0)} mm)` : ''} · ${water.lakes} lakes${water.closedLakes ? `, ${water.closedLakes} closed` : ''} (${water.lakeAreaKm2.toFixed(1)} km²)${r ? ` · ${r.rivers.length} channels, ${r.lengthKm.toFixed(0)} km · meanders ${r.meanderKm.toFixed(0)} km, ${r.oxbows.length} oxbows, ${r.avulsions} avulsions · braids ${r.braidedKm.toFixed(1)} km · ${r.deltas} deltas · tracing ${r.ms.toFixed(0)} ms` : ''}${cond ? ` · pre-hydrology ${cond.stats.before.depressions} → ${cond.stats.after.depressions} depressions > 1 m (${cond.stats.ms.toFixed(0)} ms)` : ''}`;
  }
  if (hydro) hydroStatus.textContent = `Hydrology · ${hydro.backend === 'gpu-f32' ? 'GPU FP32 + Rust finalization' : 'Rust CPU'} · ${hydro.riverCount} segments · ${hydro.lakeCount} lakes${hydro.closedLakeCount ? `, ${hydro.closedLakeCount} closed` : ''} (${(hydro.lakeFraction * 100).toFixed(1)}% of land) · ${hydro.basinCount} watersheds · grid ${hydro.resolution}² · ${hydro.breachCount} bounded breaches · drainage prepared in ${hydro.drainageMs.toFixed(0)} ms · finalization ${hydro.vectorMs.toFixed(0)} ms${hydro.backendReason ? ` · ${hydro.backendReason}` : ''}`;
  const neural = terrain.neural;
  if (neural) {
    el('neuralState').dataset.state = 'ready';
    el('neuralState').textContent = `${neural.backend ?? 'Rust natif'} · ${neural.profile} · ${neural.totalMs.toFixed(0)} ms`;
    const contours = contourStep && map.dataset.contours === 'true' ? `contours ${contourStep} m` : 'no contours';
    const fit = settings.width === NEURAL_EXTENT ? '40 km' : settings.neuralFit === 'scale' || settings.width > NEURAL_EXTENT ? `40 km scaled to ${(settings.width / 1000).toLocaleString('en-US')} km` : `${(settings.width / 1000).toLocaleString('en-US')} km window over 40`;
    status(`${name} · neural ${neural.profile} · evaluations ${neural.evaluations.join('/')} (coarse/base/decoder) · service ${neural.totalMs.toFixed(0)} ms (coarse ${neural.coarseMs.toFixed(0)}, base ${neural.baseMs.toFixed(0)}, decoder ${neural.decoderMs.toFixed(0)}, reconstruction ${neural.reconstructionMs.toFixed(0)}) · request ${neural.requestMs.toFixed(0)} ms · land ${(neural.land * 100).toFixed(0)}% · ${backend} · map ${fit} · overview ${terrain.resolution}² · ${contours} · generation + overview ${terrain.generationMs.toFixed(0)} ms${detail} · rendering ${renderingMs.toFixed(0)} ms`);
    return;
  }
  status(`${name}${environment} · ${backend} · map ${settings.width.toLocaleString('en-US')} m · landform scale ${settings.motifSize.toLocaleString('en-US')} m · overview ${terrain.resolution}² · ${contourStep && map.dataset.contours === 'true' ? `contours ${contourStep} m` : 'no contours'}${preparation}${coast}${setup} · generation + overview ${terrain.generationMs.toFixed(0)} ms${detail} · rendering ${renderingMs.toFixed(0)} ms`);
}
/** Only water is masked by resolved crowns; diagnostics remain readable above it. */
function svgWaterLayer(water: string, diagnostic = ''): string {
  return (water && rasterWaterMask && !gpu ? `<g mask="url(#${rasterWaterMask.id})">${water}</g>` : water) + diagnostic;
}
/** SVG fallback ink follows the same topmost terrain order as the GPU path. */
function liftTerrainContours(): void {
  let overlay = map.querySelector<SVGGElement>('#terrainContourOverlay');
  if (!overlay) { overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g'); overlay.id = 'terrainContourOverlay'; map.querySelector('#hydrologyOverlay')?.after(overlay); }
  overlay.replaceChildren();
  for (const source of Array.from(map.querySelectorAll<SVGGElement>('#terrainOverview .layer-contours, #terrainDetail .layer-contours'))) {
    const copy = source.cloneNode(true) as SVGGElement; copy.removeAttribute('display');
    const transforms: string[] = []; let parent: Element | null = source.parentElement;
    while (parent && parent !== map) { const transform = parent.getAttribute('transform'); if (transform) transforms.unshift(transform); parent = parent.parentElement; }
    if (transforms.length) copy.setAttribute('transform', transforms.join(' '));
    source.setAttribute('display', 'none'); overlay.append(copy);
  }
}
/** Retained water without its rivers: lake shapes, their material and any crop wrappers. */
function lakesOnlySvg(svg: string): string {
  if (!svg) return '';
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); host.innerHTML = svg;
  for (const node of Array.from(host.querySelectorAll('path,circle,polygon,rect'))) {
    if (!node.closest('defs,clipPath,mask') && !node.classList.contains('water-lakes')) node.remove();
  }
  return host.innerHTML;
}
function renderWater(): void {
  schedule3dTexture();
  const layer = document.getElementById('hydrologyOverlay');
  const source = retainedDecor ? 'none' : terrain?.water ? 'vector' : terrain?.hydrology ? 'rust' : 'none';
  for (const option of Array.from(diagnosticSelect.options)) option.disabled = !diagnosticAvailable(option.value, source);
  if (!diagnosticAvailable(hydroOverlay, source)) { hydroOverlay = 'none'; diagnosticSelect.value = elevationDiagnostic ? 'elevation' : 'none'; }

  if (retainedDecor && layer) {
    gpu?.setWater(undefined); gpu?.setOverlay(undefined);
    const retainedWater = input('showWater').checked ? decorWaterSvg(retainedDecor, baseStyle, input('showLakes').checked) : '';
    if (gpu && style === 'render') {
      // Render: the GPU paints the rivers (depth, banks); lakes keep their SVG material above.
      gpu.setRetainedWater(input('showWater').checked ? decorWaterSvg(retainedDecor, baseStyle, false) : '', retainedDecor.raster.width);
      layer.innerHTML = svgWaterLayer(lakesOnlySvg(retainedWater));
    } else if (gpu && isRender3dStyle(style)) {
      gpu.setRetainedWater(retainedWater, retainedDecor.raster.width); layer.innerHTML = '';
    } else { gpu?.setRetainedWater(undefined); layer.innerHTML = svgWaterLayer(retainedWater); }
    el('hydrologyLegend').hidden = !elevationDiagnostic || !input('showLegend').checked;
    el('hydrologyLegend').textContent = diagnosticDefinition(elevationDiagnostic ? 'elevation' : 'none').legend;
    el('hydrologyLegend').hidden = true; report(); return;
  }
  if (!layer) return;
  gpu?.setRetainedWater(undefined);
  const water = terrain?.water;
  if (gpu && isFantasyStyle(style)) { gpu.setWater(undefined); gpu.setOverlay(undefined); }
  if (gpu && !isFantasyStyle(style)) {
    const vectorOverlay = water && isVectorOverlay(hydroOverlay) ? hydroOverlay : 'none';
    const cond = terrain?.conditioning;
    const display = { style: baseStyle, showLakes: input('showLakes').checked, showOxbows: input('showOxbows').checked, riverArea: riverAreaFor(settings.hydrology ?? DEFAULT_HYDROLOGY, settings.width), riverMode: settings.hydrology?.riverMode ?? 'vector', overlay: vectorOverlay };
    const shown = input('showWater').checked, hydrology = !water && !terrain?.hydrologyError ? terrain?.hydrology : undefined;
    if (water && shown) gpu.setWater({ lake: display.showLakes ? lakeField(water.lake, water.hydro.n).values : undefined, n: water.hydro.n, rivers: riverSegments(water, display) });
    else if (hydrology && shown) {
      // The Rust network on the GPU: its lakes' shore field, as the SVG rings contour it.
      const colour = hydrologyWaterColour(baseStyle);
      gpu.setWater({ lake: display.showLakes ? hydrology.waterField : undefined, shore: 'exact', n: hydrology.resolution, rivers: hydrologySegments(hydrology, colour) });
    } else gpu.setWater(undefined);
    gpu.setOverlay(water ? vectorOverlayPixels(water, vectorOverlay, cond ? { values: cond.delta, n: cond.n } : undefined) : undefined);
    layer.innerHTML = hydrology && !isVectorOverlay(hydroOverlay) ? renderHydrology(hydrology, hydroOverlay, false, style) : '';
  } else if (water) {
    const vectorOverlay = isVectorOverlay(hydroOverlay) ? hydroOverlay : 'none';
    const cond = terrain?.conditioning;
    layer.innerHTML = svgWaterLayer(input('showWater').checked ? vectorWaterSvg(water, { style: baseStyle, showLakes: input('showLakes').checked, showOxbows: input('showOxbows').checked, riverArea: riverAreaFor(settings.hydrology ?? DEFAULT_HYDROLOGY, settings.width), riverMode: settings.hydrology?.riverMode ?? 'vector', overlay: vectorOverlay }) : '',
      vectorOverlaySvg(water, vectorOverlay, cond ? { values: cond.delta, n: cond.n } : undefined));
  } else layer.innerHTML = terrain?.hydrology && (hydroOverlay === 'none' || !isVectorOverlay(hydroOverlay)) ? svgWaterLayer(input('showWater').checked ? renderHydrology(terrain.hydrology, 'none', true, baseStyle) : '',
    hydroOverlay === 'none' ? '' : renderHydrology(terrain.hydrology, hydroOverlay, false, baseStyle)) : '';
  const legend = el('hydrologyLegend');
  const diagnostic = diagnosticDefinition(elevationDiagnostic ? 'elevation' : hydroOverlay);
  legend.hidden = !input('showLegend').checked || diagnostic.id === 'none' || (diagnostic.source === 'vector' ? !water : diagnostic.source === 'rust' ? !terrain?.hydrology : false);
  legend.textContent = diagnostic.legend;
  report();
}

/** Measurement panel: neural networks, relief, water and the river laws. */
function report(): void {
  if (!terrain) return;
  const rows: [string, string][] = [], m = (v: number): string => `${Math.round(v)} m`;
  const neural = terrain.neural as (typeof terrain.neural & { coarse?: { sketch: number; elevation: number; relief: number; reliefUsed: number } }) | undefined;
  if (neural) {
    rows.push(['Service', `${Math.round(neural.requestMs)} ms · coarse ${Math.round(neural.coarseMs)} · base ${Math.round(neural.baseMs)} · decoder ${Math.round(neural.decoderMs)}`], ['Evaluations', `${neural.evaluations.join(' / ')} · ${neural.profile}`]);
    const c = neural.coarse;
    if (c) rows.push(['Sketch (mean)', m(c.sketch)], ['Coarse elevation (mean)', m(c.elevation)], ['Coarse local relief', m(c.relief)], ['Local relief → base', m(c.reliefUsed)]);
  }
  const cell = terrain.width / terrain.resolution, stats = terrain.relief ?? reliefStatistics(terrain);
  if (stats.land) rows.push(['Land elevations', `p5 ${m(stats.p5)} · median ${m(stats.p50)} · p95 ${m(stats.p95)}`],
    ['Mean slope', `${(stats.slope * 180 / Math.PI).toFixed(1)}° (${cell.toFixed(0)} m cell)`]);
  rows.push(['Land', `${(stats.land * 100).toFixed(1)}%`]);
  const cond = terrain.conditioning;
  if (cond) rows.push(['Pre-hydrology', `${cond.stats.before.depressions} → ${cond.stats.after.depressions} depressions > 1 m · ${(cond.stats.before.volume / 1e6).toFixed(0)} → ${(cond.stats.after.volume / 1e6).toFixed(0)} hm³ · ${cond.stats.steps} steps, ${cond.stats.breaches} breached sills`]);
  const water = terrain.water;
  if (water) {
    rows.push(['Lakes', `${water.lakes}${water.closedLakes ? ` (${water.closedLakes} closed)` : ''} · ${water.lakeAreaKm2.toFixed(1)} km²`]);
    rows.push(['Climate', `aridity P/PET ${water.runoff.aridity.toFixed(2)} · runoff ${water.runoff.r0.toFixed(0)} mm${water.confluenceAngle ? ` · confluences ${water.confluenceAngle.toFixed(0)}°` : ''}`]);
    const r = water.rivers, k = water.metrics, f = (v: number | undefined, d = 2): string => v === undefined ? '—' : v.toFixed(d);
    if (r) rows.push(['Rivers', `${r.rivers.length} channels · ${r.lengthKm.toFixed(0)} km · ${Math.round(r.ms)} ms`],
      ['Meanders', `${r.meanderRuns} reaches · ${r.meanderKm.toFixed(0)} km · ${r.oxbows.length} oxbows · ${r.avulsions} avulsions`],
      ['Braids, deltas', `${r.braidedKm.toFixed(1)} km braided · ${r.braids.length} branches · ${r.deltas} deltas (${r.distributaries.length} distributaries)`]);
    rows.push(['Hack’s law L ∝ A^h', `h = ${f(k.hack)} (observed 0.5–0.6)`], ['Flint’s law S ∝ A^−θ', `θ = ${f(k.flint)} (observed 0.35–0.6)`],
      ['Horton–Strahler', `R_b = ${f(k.bifurcation)} (observed 3–5) · order ${k.order}`],
      ['Meanders', `λ = ${f(k.wavelength, 1)} W (observed 10–14) · sinuosity ${f(k.sinuosity)}`], ['Confluences', `${f(k.confluence, 0)}° (45° arid – 72° humid)`]);
  }
  el('report').innerHTML = rows.map(([key, value]) => `<p><small><b>${key}</b><br>${value}</small></p>`).join('');
}
let uploaded: TerrainData | undefined;
/** Contour interval of the bench: shared intervals, doubled in mountains; none in caverns. */
function contourInterval(): number {
  if (!terrain || terrain.caveMask.length || isFantasyStyle(style) || style === 'copernicus') return 0;
  const relief = settings.relief === 'flat' || settings.relief === 'hills' || settings.relief === 'valley' ? settings.relief : 'mountains';
  return CONTOUR_INTERVAL[relief] * (relief === 'mountains' ? 2 : 1);
}
function renderGpu(): void {
  if (!terrain || !gpu) return;
  rasterWaterMask = undefined;
  const start = performance.now(), field = terrain.field;
  if (uploaded !== terrain) {
    refinement2dKey = ''; refinement2dWanted = '';
    // A new landscape: its control grid replaces every layer.
    const base = field ?? { n: terrain.resolution, data: terrain.height, exact: false, floor: 0, cave: terrain.caveMask.length ? terrain.caveMask : undefined };
    gpu.setBase({ x: 0, y: 0, width: terrain.width, n: base.n, data: base.data, cave: base.cave, waterSurface: terrain.waterSurface });
    uploaded = terrain; displayedDetail = undefined;
    map.innerHTML = '<g id="hydrologyOverlay"></g>';
  }
  contourStep = contourInterval();
  const look: TerrainLook = {
    refinement3d,
    style, waterStyle: baseStyle, lighting: isFantasyStyle(style) ? { ...lighting, strength: .12 } : lighting, layers: isFantasyStyle(style) ? { ...layers, hypsometry: false } : layers, climate: climateOf(settings), mapWidth: terrain.width, globalMin: terrain.globalMinHeight, globalMax: terrain.globalMaxHeight,
    contours: layers.relief && !isFantasyStyle(style) && input('showContours').checked && contourStep > 0, contourStep, flatRelief: settings.relief === 'flat',
    refine: !!settings.refine && !terrain.caveMask.length, sourceCell: retainedDecor?.meta.terrainDisplay?.sourceCell ?? settings.width / 1024, seed: seedHash(settings.seed),
    detail: settings.detailNoise ?? DEFAULT_FRACTAL_DETAIL,
    floor: field?.floor ?? 0, frame: layers.frame, background: '#f1f0e9',
  };
  gpu.setLook(look);
  let fantasy: Element | null = document.getElementById('fantasyPainting');
  if (isFantasyStyle(style) && layers.relief) {
    if (!fantasy) { fantasy = document.createElementNS('http://www.w3.org/2000/svg', 'g'); fantasy.id = 'fantasyPainting'; fantasy.setAttribute('pointer-events', 'none'); map.append(fantasy); }
  } else fantasy?.remove();
  refreshUrbanPainting();
  renderWater();
  scheduleForest();
  renderingMs = performance.now() - start;
  updateView(); renderedStatus();
}
function render(preparedScene?: TerrainScene, preparationMs = 0): void {
  brushPanel.hidden = !isFantasyStyle(style);
  if (!terrain) return;
  if (gpu) { updateContourControl(); renderGpu(); return; }
  updateContourControl();
  // Hide a stale stand before drawing; a new field redraws through showForest.
  forestRendering = true; try { scheduleForest(); } finally { forestRendering = false; }
  const forestScene = forestRaster();
  const start = performance.now(), scene = (!isFantasyStyle(style) && !forestScene ? preparedScene : undefined) ?? renderRustTerrain(terrain, style, true, { ...settings, forest: forestScene }, input('showContours').checked, 'main', lighting, layers, fantasyOptions, false, baseStyle);
  rasterWaterMask = scene.waterMask;
  map.innerHTML = `<g id="terrainOverview">${scene.svg}</g><g id="terrainDetail"></g><g id="hydrologyOverlay"></g>${isFantasyStyle(style) && layers.relief ? '<g id="fantasyPainting" pointer-events="none"></g>' : ''}`;
  refreshUrbanPainting();
  renderWater();
  liftTerrainContours();
  contourStep = scene.contourStep; renderingMs = preparationMs + performance.now() - start;
  displayedDetail = undefined;
  viewport.style.background = style === 'parchment' ? '#f1f0e9' : '#e7e8e2';
  updateView(); renderedStatus();
}
function regionForView(): TerrainRegion {
  const width = settings.width;
  const camera = perspective ? terrain3d?.getCamera() : undefined;
  const scale = camera ? perspectiveScale(camera) : view.scale;
  const desired = Math.max(viewport.clientWidth, viewport.clientHeight) / scale * (camera ? 1.5 / Math.max(.4, Math.sin(camera.pitch)) : 1.3);
  // A small scale/position lattice reuses sampled regions during gentle pans.
  const extent = Math.min(width, Math.max(1, 2 ** (Math.ceil(Math.log2(Math.max(1, desired)) * 4) / 4)));
  const step = extent / 32;
  const x = bounded(Math.round(((camera?.x ?? view.cx) - extent / 2) / step) * step, 0, width - extent);
  const y = bounded(Math.round(((camera?.y ?? view.cy) - extent / 2) / step) * step, 0, width - extent);
  return { x, y, extent, resolution: 768 };
}
function detailKey(region: TerrainRegion): string { return `${generation}:${region.x}:${region.y}:${region.extent}:${region.resolution}${gpu ? '' : `:${style}:${input('showContours').checked ? 1 : 0}:${JSON.stringify(lighting)}:${JSON.stringify(layers)}:${forestRaster()?.field?.key ?? ''}`}`; }
/** The GPU draws exact rasters at every zoom: no camera regions. */
const needsDetail = (): boolean => {
  // Enhanced views refine the immutable retained field in their own tile
  // pipeline. Legacy camera samples must not replace that field mid-flight.
  if (perspective || isRender3dStyle(style)) return false;
  if (retainedDecor || (gpu && terrain?.field?.exact)) return false;
  const region = regionForView();
  return !gpu || !terrain?.field || region.extent / region.resolution < terrain.width / terrain.field.n;
};
async function applyDetail(tile: DetailTile): Promise<void> {
  if (gpu) {
    if (terrainGeneration !== generation || tile.key !== detailKey(regionForView()) || displayedDetail?.key === tile.key) return;
    const t = tile.terrain;
    gpu.setDetail({ x: t.x, y: t.y, width: t.width, n: t.resolution, data: t.height, cave: t.caveMask.length ? t.caveMask : undefined });
    displayedDetail = tile; detailSamplingMs = t.generationMs;
    if (perspective) schedule3dTexture();
    updateCoordinates();
    el('scale').textContent = `${(1 / view.scale).toFixed(1)} m / px · ${(t.width / t.resolution).toFixed(2)} m / sample`;
    renderedStatus();
    return;
  }
  try { await tile.ready; }
  catch {
    if (tile.key === detailKey(regionForView())) status('Failed to decode the detailed image.', true);
    return;
  }
  if (terrainGeneration !== generation || tile.key !== detailKey(regionForView()) || displayedDetail?.key === tile.key) return;
  const layer = document.getElementById('terrainDetail'); if (!layer) return;
  const previous = Array.from(layer.children);
  const next = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  next.setAttribute('transform', `translate(${tile.terrain.x},${tile.terrain.y})`);
  next.style.opacity = '0'; next.innerHTML = tile.scene!.svg;
  const raster = next.querySelector('image')!;
  const loaded = new Promise<void>((resolve, reject) => {
    raster.addEventListener('load', () => resolve(), { once: true });
    raster.addEventListener('error', () => reject(new Error('SVG image unavailable')), { once: true });
  });
  layer.append(next);
  try { await loaded; }
  catch { next.remove(); return; }
  // Keep the current tile while the SVG image enters the browser's paint tree.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (!next.isConnected) return;
  if (tile.key !== detailKey(regionForView()) || terrainGeneration !== generation) { next.remove(); return; }
  next.style.opacity = '1';
  const fade = next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
  const cleanup = (): void => { previous.forEach(node => node.remove()); };
  void fade.finished.then(() => { cleanup(); liftTerrainContours(); }, () => { cleanup(); liftTerrainContours(); });
  liftTerrainContours();
  displayedDetail = tile; detailSamplingMs = tile.terrain.generationMs;
  updateCoordinates();
  // Only replace the regional scene: no fit, new generation or camera callback.
  const sampling = (tile.terrain.width / tile.terrain.resolution).toFixed(2);
  el('scale').textContent = `${(1 / view.scale).toFixed(1)} m / px · ${sampling} m / sample`;
  renderedStatus();
}
function cacheDetail(tile: DetailTile): void {
  detailCache.delete(tile.key); detailCache.set(tile.key, tile);
  while (detailCache.size > 6) detailCache.delete(detailCache.keys().next().value!);
}
function scheduleDetail(): void {
  clearTimeout(detailTimer);
  if (!terrain || terrainGeneration !== generation || !needsDetail()) return;
  const region = regionForView(), key = detailKey(region);
  if (displayedDetail?.key === key || (detailRequest && detailKey(detailRequest.region) === key)) return;
  detailTimer = setTimeout(() => requestDetail(), 120);
}
function requestDetail(): void {
  if (retainedDecor) return;
  if (!terrain || terrainGeneration !== generation) return;
  const region = regionForView(), key = detailKey(region), cached = detailCache.get(key);
  if (cached) { cacheDetail(cached); void applyDetail(cached); return; }
  if (detailRequest && detailKey(detailRequest.region) === key) return;
  detailRequest = { id: ++requestId, generation, kind: 'detail', settings, region };
  dispatch(detailRequest);
}
function receive(response: TerrainResponse): void {
  if (response.generation !== generation) return;
  if ('progress' in response) {
    el('neuralState').textContent = response.progress; status(response.progress);
    if (response.kind === 'overview' && overviewPending) terrainLoading('generation', response.progress);
    return;
  }
  if (response.kind === 'detail') {
    if (!detailRequest || response.id !== detailRequest.id) return;
    const request = detailRequest; detailRequest = undefined;
    if ('error' in response) { if (!overviewPending && !generationError) status(`Rust detail error: ${response.error}`, true); return; }
    // The camera can move again while Rust samples the previous region.
    if (detailKey(request.region) !== detailKey(regionForView())) { scheduleDetail(); return; }
    if (gpu) {
      const data = response.terrain;
      const tile: DetailTile = {
        terrain: { x: data.x, y: data.y, width: data.width, resolution: data.resolution, height: data.height, caveMask: data.caveMask, generationMs: data.generationMs, backend: data.backend, backendReason: data.backendReason, prepareMs: data.prepareMs, samplingMs: data.samplingMs, gpuSetupMs: data.gpuSetupMs },
        style, key: detailKey(request.region), ready: Promise.resolve(),
      };
      cacheDetail(tile); void applyDetail(tile);
      return;
    }
    try {
      const start = performance.now();
      const data = response.terrain;
      const prepared = request.scene?.style === style && request.scene.waterStyle === baseStyle && request.scene.showContours === input('showContours').checked && JSON.stringify(request.scene.lighting) === JSON.stringify(lighting) && JSON.stringify(request.scene.layers) === JSON.stringify(layers);
      if (terrain) data.waterSurface = seaDistanceSurface(terrain, settings.width);
      // Detail crops sample the same full-tile forest field; the worker scenes carry none.
      const forestScene = forestRaster(data);
      const scene = prepared && response.scene && !forestScene ? response.scene : renderRustTerrain(data, style, false, { ...settings, forest: forestScene }, input('showContours').checked, 'detail', lighting, layers, fantasyOptions, false, baseStyle), image = new Image();
      image.src = scene.imageUrl;
      const tile: DetailTile = {
        terrain: { x: data.x, y: data.y, width: data.width, resolution: data.resolution, height: data.height, caveMask: data.caveMask, generationMs: data.generationMs, backend: data.backend, backendReason: data.backendReason, prepareMs: data.prepareMs, samplingMs: data.samplingMs, gpuSetupMs: data.gpuSetupMs },
        style, scene, image, ready: image.decode(), key: detailKey(request.region),
      };
      renderingMs = (prepared ? response.scenePreparationMs ?? 0 : 0) + performance.now() - start; cacheDetail(tile); void applyDetail(tile);
    } catch (error) { status(`Detailed rendering error: ${error instanceof Error ? error.message : error}`, true); }
    return;
  }
  if (!overviewRequest || response.id !== overviewRequest.id) return;
  if ('partial' in response && response.partial) {
    // The relief first; the waters follow in the same generation.
    const previousWidth = terrain?.width;
    terrain = response.terrain; settings = overviewRequest.settings; terrainGeneration = generation;
    if (previousWidth !== undefined && previousWidth !== terrain.width) view = fitView(terrain.width, viewport.clientWidth, viewport.clientHeight);
    try { render(); } catch (error) { status(`Rendering error: ${error instanceof Error ? error.message : error}`, true); return; }
    status(`Terrain displayed in ${terrain.generationMs.toFixed(0)} ms · computing water…`);
    return;
  }
  if ('error' in response) {
    el('generate').removeAttribute('aria-busy'); overviewPending = false;
    generationError = response.error;
    settlements.terrainFailed(response.error);
    terrainLoading('error', response.error);
    status(`Rust engine error: ${response.error}`, true);
    return;
  }
  const previousWidth = terrain?.width;
  terrain = response.terrain; settings = overviewRequest.settings; terrainGeneration = generation;
  sketchEditor?.refresh(settings.sketch, settings.zones);
  if (previousWidth !== undefined && previousWidth !== terrain.width) view = fitView(terrain.width, viewport.clientWidth, viewport.clientHeight);
  if (terrain.erosionDefaults) showErosionDefaults(terrain.erosionDefaults);
  settlements.terrainReady();
  updateStageStates();
  const prepared = overviewRequest.scene?.style === style && overviewRequest.scene.waterStyle === baseStyle && overviewRequest.scene.showContours === input('showContours').checked && JSON.stringify(overviewRequest.scene.lighting) === JSON.stringify(lighting) && JSON.stringify(overviewRequest.scene.layers) === JSON.stringify(layers);
  terrainLoading('rendering', 'Le terrain est calculé. Préparation de la carte et des couches…');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (response.generation !== generation) return;
    overviewPending = false;
    try {
      render(prepared ? response.scene : undefined, prepared ? response.scenePreparationMs : 0); save();
      terrainLoading('ready');
    } catch (error) {
      const message = `Rendering error: ${error instanceof Error ? error.message : error}`;
      status(message, true); terrainLoading('error', message);
    } finally { el('generate').removeAttribute('aria-busy'); }
  }));
}
let worker: Worker | undefined;
async function runOnMain(request: TerrainRequest): Promise<void> {
  const meta = { id: request.id, generation: request.generation, kind: request.kind };
  try { receive({ ...meta, terrain: await sampleRustTerrain(request, undefined, progress => receive({ ...meta, progress })) }); }
  catch (error) { receive({ ...meta, error: error instanceof Error ? error.message : String(error) }); }
}
function dispatch(request: TerrainRequest): void {
  request.runtime = executionRuntime;
  if (gpu) request.display = 'gl';
  // The forest field lives on the UI thread, so Render3D with forest renders its scenes here.
  else if (!isFantasyStyle(style) && !forestActive()) request.scene = { style, waterStyle: baseStyle, lighting, layers, showContours: input('showContours').checked };
  if (worker) worker.postMessage(request); else void runOnMain(request);
}
try {
  worker = new TerrainWorker(); worker.onmessage = (event: MessageEvent<TerrainResponse>) => receive(event.data);
  worker.onerror = event => {
    event.preventDefault(); worker?.terminate(); worker = undefined;
    const request = overviewPending ? overviewRequest : detailRequest;
    if (request) void runOnMain(request);
  };
} catch { worker = undefined; }

function readSettings(stage: GenerationStage = 'all', reportError = true): TerrainSettings | undefined {
  if (stage === 'hydrology') return { ...settings, hydrology: readHydrology() };
  if (stage === 'coasts') return { ...settings, coastMask: settings.relief === 'cavern' ? 0 : draftCoastMask, islandMode: el<HTMLSelectElement>('islandMode').value as IslandMode };
  const source = el<HTMLSelectElement>('terrainSource').value as TerrainSource;
  const width = Number(input('width').value), motifSize = Number(input('motifSize').value), seed = input('seed').value.trim();
  if (!Number.isFinite(width) || width < 500 || width > 100000 || !seed) {
    if (reportError) status('Enter a width between 500 and 100,000 m and a seed.', true); return;
  }
  if (!Number.isFinite(motifSize) || motifSize < 250 || motifSize > 50000) {
    if (reportError) status('Enter a landform scale between 250 and 50,000 m.', true); return;
  }
  const relief = el<HTMLSelectElement>('relief').value as TerrainRelief;
  if (!RELIEFS.includes(relief)) { if (reportError) status('Choose a terrain type from the menu.', true); return; }
  if (!sketchEditor?.snapshot()?.processing && isNeuralSource(source) && !neuralRelief(relief)) { if (reportError) status('This terrain type is unavailable with the neural source.', true); return; }
  const environment = el<HTMLSelectElement>('environment').value as TerrainEnvironment;
  if (!ENVIRONMENT_RELIEFS.includes(environment)) { if (reportError) status('Choose the surrounding terrain from the menu.', true); return; }
  return { zones: relief === 'cavern' ? undefined : sketchEditor?.zones(), sketch: relief === 'cavern' ? undefined : sketchEditor?.snapshot(), seed, width, motifSize, relief, environment, coastMask: relief === 'cavern' ? 0 : draftCoastMask, islandMode: el<HTMLSelectElement>('islandMode').value as IslandMode, erosion: Number(input('erosion').value), mountainMix: Number(input('mountainMix').value), resolution: 512, hydrology: readHydrology(), compute: el<HTMLSelectElement>('compute').value as TerrainCompute, generationCompute: el<HTMLSelectElement>('generationCompute').value as TerrainSettings['generationCompute'], source, climate: readClimate(), climateValues: readClimateValues(), fidelity: bounded(finite(input('fidelity').value, 0.05), 0.001, 2), neuralServer: neuralServerFor(source), neuralAssets,
    neuralTuning: readTuning(), coarseModel: el<HTMLSelectElement>('coarseModel').value, baseModel: el<HTMLSelectElement>('baseModel').value, decoderModel: el<HTMLSelectElement>('decoderModel').value, neuralFit: el<HTMLSelectElement>('neuralFit').value === 'scale' ? 'scale' : 'crop', neuralSlopes: input('neuralSlopes').checked, refine: input('refine').checked,
    detailNoise: readDetailNoise((_, id) => input(id).value), erosionTuning: readErosionTuning(name => input(`er_${name}`).value) };
}
function readClimate(): NeuralClimate {
  const value = el<HTMLSelectElement>('climate').value;
  return NEURAL_CLIMATES.includes(value as NeuralClimate) ? value as NeuralClimate : settings.climate ?? 'temperate';
}
function readClimateValues(): ClimateValues {
  return Object.fromEntries(Object.entries(climateFields).map(([key, id]) => [key, finite(input(id).value, CLIMATE_VALUES.temperate[key as keyof ClimateValues])])) as unknown as ClimateValues;
}
function readTuning(): NeuralTuning {
  const tuning = { ...DEFAULT_NEURAL_TUNING } as NeuralTuning;
  for (const [key, id] of Object.entries(tuningFields)) (tuning as unknown as Record<string, number>)[key] = finite(input(id).value, DEFAULT_NEURAL_TUNING[key as keyof typeof tuningFields]);
  tuning.reliefMode = el<HTMLSelectElement>('nReliefMode').value as NeuralTuning['reliefMode'];
  tuning.histogram = [0, 1, 2, 3, 4].map(k => finite(input(`nH${k}`).value, 0));
  return tuning;
}
type GenerationStage = 'all' | 'relief' | 'coasts' | 'hydrology';
function generate(stage: GenerationStage = 'all'): void {
  clearTimeout(generationTimer);
  if (pipelineStage === 'settlements') { settlements.terrainReady(); return; }
  const draft = readSettings(stage); if (!draft) return;
  retainedDecor = undefined; lastExport = undefined;
  if (stage === 'all') try { settlements.applyUrbanChanges(); }
  catch (error) { status(String(error), true); return; }
  // The climate of a procedural relief only drives the water budget.
  const next = stage === 'hydrology' ? { ...settings, hydrology: draft.hydrology, ...(isNeuralSource(settings.source) ? {} : { climate: draft.climate, climateValues: draft.climateValues }) }
    : stage === 'coasts' ? { ...settings, coastMask: draft.coastMask, islandMode: draft.islandMode }
    : stage === 'relief' ? { ...settings, seed: draft.seed, width: draft.width, motifSize: draft.motifSize, relief: draft.relief, environment: draft.environment, erosion: draft.erosion, mountainMix: draft.mountainMix, compute: draft.compute, generationCompute: draft.generationCompute, source: draft.source, climate: draft.climate, climateValues: draft.climateValues, fidelity: draft.fidelity, zones: draft.zones, sketch: draft.sketch, neuralTuning: draft.neuralTuning, coarseModel: draft.coarseModel, baseModel: draft.baseModel, decoderModel: draft.decoderModel, neuralFit: draft.neuralFit, neuralSlopes: draft.neuralSlopes, refine: draft.refine, detailNoise: draft.detailNoise, erosionTuning: draft.erosionTuning }
    : draft;
  generation++; clearTimeout(detailTimer); detailRequest = undefined; detailCache.clear(); settlements.terrainPending();
  overviewPending = true; generationError = undefined;
  overviewRequest = { id: ++requestId, generation, kind: 'overview', settings: next, region: { x: 0, y: 0, extent: next.width, resolution: 512 } };
  el('generate').setAttribute('aria-busy', 'true');
  const neural = !next.sketch?.processing && isNeuralSource(next.source) && stage !== 'hydrology';
  status(neural ? 'Neural generation (coarse → base → decoder), then water…' : stage === 'hydrology' ? 'Recalculating water… terrain and coasts preserved.' : stage === 'coasts' ? 'Recalculating coasts and water… terrain preserved.' : 'Generating terrain and the water network in Rust…');
  terrainLoading('generation', neural ? 'Vérification des modèles, puis calcul neuronal et réseau d’eau…' : 'Calcul du relief et du réseau d’eau…');
  if (neural) void pollNeural();
  const request = overviewRequest;
  requestAnimationFrame(() => requestAnimationFrame(() => { if (request.generation === generation) dispatch(request); }));
}
function updateStageStates(): void {
  const draft = readSettings('all', false);
  if (!draft) {
    el('reliefState').textContent = 'incomplete settings';
    el('coastState').textContent = 'recalculate after terrain';
    el('hydroState').textContent = 'recalculate after upstream stage';
    return;
  }
  const neural = isNeuralSource(draft.source);
  const climateChanged = JSON.stringify(draft.climateValues) !== JSON.stringify(settings.climateValues);
  const reliefChanged = JSON.stringify(draft.zones) !== JSON.stringify(settings.zones) || (draft.sketch !== settings.sketch && JSON.stringify(draft.sketch) !== JSON.stringify(settings.sketch)) || JSON.stringify(draft.detailNoise) !== JSON.stringify(settings.detailNoise) || (neural && (climateChanged || JSON.stringify(draft.neuralTuning) !== JSON.stringify(settings.neuralTuning)))
    || (!neural && JSON.stringify(draft.erosionTuning) !== JSON.stringify(settings.erosionTuning ?? {}))
    || ['seed', 'width', 'motifSize', 'relief', 'environment', 'mountainMix', 'erosion', 'compute', 'generationCompute', 'source', 'fidelity', 'neuralFit', 'neuralSlopes', 'refine', 'coarseModel', 'baseModel', 'decoderModel'].some(key => draft[key as keyof TerrainSettings] !== settings[key as keyof TerrainSettings]);
  const coastChanged = draft.coastMask !== settings.coastMask || draft.islandMode !== settings.islandMode;
  const hydroChanged = JSON.stringify(draft.hydrology) !== JSON.stringify(settings.hydrology) || (!neural && climateChanged);
  el('reliefState').textContent = reliefChanged ? 'changed' : '';
  el('coastState').textContent = reliefChanged ? 'recalculate after terrain' : coastChanged ? 'changed' : '';
  el('hydroState').textContent = reliefChanged || coastChanged ? 'recalculate after upstream stage' : hydroChanged ? 'changed' : '';
}
function parameterChanged(): void {
  const zoned = !!sketchEditor?.zones(), source = el<HTMLSelectElement>('terrainSource').value as TerrainSource;
  if (zoned && (!zoningWasActive || source !== zoningSource) && isNeuralSource(source)) el<HTMLSelectElement>('neuralFit').value = 'scale';
  zoningWasActive = zoned; zoningSource = source;
  sketchEditor?.refresh(settings.sketch, settings.zones);
  updateErosionControl(); updateStageStates(); clearTimeout(generationTimer);
  if (input('auto').checked) generationTimer = setTimeout(() => generate(), 220);
  else status('Settings changed · recalculating a stage preserves upstream settings; Generate applies everything.');
}
for (const name of EROSION_SETTINGS) {
  const value = settings.erosionTuning?.[name];
  input(`er_${name}`).value = value === undefined ? '' : String(value);
  el(`er_${name}`).addEventListener('input', parameterChanged);
}
el('erReset').onclick = () => { for (const name of EROSION_SETTINGS) input(`er_${name}`).value = ''; parameterChanged(); };
/** Placeholders: the erosion settings of the displayed relief. */
function showErosionDefaults(values: number[] | undefined): void {
  EROSION_SETTINGS.forEach((name, i) => { input(`er_${name}`).placeholder = values ? String(Math.round(values[i] * 1000) / 1000) : ''; });
}
for (const id of ['width', 'motifSize', 'relief', 'environment', 'mountainMix', 'erosion', 'seed', 'islandMode', 'terrainSource', 'fidelity', 'neuralFit', 'neuralSlopes', 'refine', 'nReliefMode', ...Object.values(tuningFields), 'nH0', 'nH1', 'nH2', 'nH3', 'nH4']) el(id).addEventListener('input', parameterChanged);
for (const id of ['coarseModel', 'baseModel', 'decoderModel']) el(id).addEventListener('change', () => {
  updateErosionControl();
  const selected = neuralModels.coarse.find(model => model.id === el<HTMLSelectElement>('coarseModel').value);
  if (selected) input('nSteps').value = String(selected.steps);
  parameterChanged();
});
// The GL renderer applies the detail noise live; the SVG fallback bakes it into the relief.
function detailNoiseChanged(): void {
  if (!gpu) { parameterChanged(); return; }
  settings.detailNoise = readDetailNoise((_, id) => input(id).value);
  // A pending generation must not bring back the previous values when it lands.
  if (overviewRequest) overviewRequest.settings.detailNoise = settings.detailNoise;
  if (terrain) renderGpu();
  deferSave();
}
for (const [id] of Object.values(detailNoiseFields)) el(id).addEventListener('input', detailNoiseChanged);
el('dnReset').onclick = () => {
  for (const [key, [id]] of Object.entries(detailNoiseFields)) input(id).value = String(DEFAULT_FRACTAL_DETAIL[key as keyof FractalDetail]);
  detailNoiseChanged();
};
el('climate').addEventListener('input', () => {
  const preset = CLIMATE_VALUES[el<HTMLSelectElement>('climate').value as NeuralClimate];
  if (preset) for (const [key, id] of Object.entries(climateFields)) input(id).value = String(preset[key as keyof ClimateValues]);
  parameterChanged();
});
for (const id of Object.values(climateFields)) el(id).addEventListener('input', () => { el<HTMLSelectElement>('climate').value = 'custom'; parameterChanged(); });
el('histogramHero').onclick = () => { [0, 0, 0, 1, 1.5].forEach((v, k) => { input(`nH${k}`).value = String(v); }); parameterChanged(); };
el('histogramZero').onclick = () => { [0, 1, 2, 3, 4].forEach(k => { input(`nH${k}`).value = '0'; }); parameterChanged(); };
for (const id of Object.values(hydroFields)) el(id).addEventListener('input', parameterChanged);
coastButtons.forEach(button => { button.onclick = () => {
  draftCoastMask ^= 1 << (COAST_DIRECTIONS as readonly string[]).indexOf(button.dataset.coast!);
  parameterChanged();
}; });
el('coastAll').onclick = () => { draftCoastMask = draftCoastMask === 255 ? 0 : 255; parameterChanged(); };
el('generate').onclick = () => generate();
el('generateRelief').onclick = () => generate('relief');
el('generateCoasts').onclick = () => generate('coasts');
el('generateHydrology').onclick = () => generate('hydrology');
el<HTMLSelectElement>('compute').onchange = parameterChanged;
el<HTMLSelectElement>('generationCompute').onchange = parameterChanged;
input('auto').onchange = () => { clearTimeout(generationTimer); save(); if (input('auto').checked) generate(); };
el('randomSeed').onclick = () => { input('seed').value = crypto.getRandomValues(new Uint32Array(1))[0].toString(36); generate(); };
el<HTMLSelectElement>('style').onchange = () => {
  baseStyle = el<HTMLSelectElement>('style').value as TerrainStyle; style = elevationDiagnostic ? 'copernicus' : baseStyle; brushPanel.hidden = !isFantasyStyle(style);
  if (isRender3dStyle(style)) { gpu?.setDetail(undefined); displayedDetail = undefined; }
  detailRequest = undefined; render(); save();
  el('refinement3dControl').hidden = !perspective && !isRender3dStyle(style);
  el('refinement3dStatus').hidden = refinement3d !== 'neural-earth' || (!perspective && !isRender3dStyle(style));
  el('retryRefinement').hidden = !refinementError || refinement3d !== 'neural-earth' || (!perspective && !isRender3dStyle(style));
  updateForestControls(); settlements.refreshForestMaterial();
};
function changeRefinement(): void {
  refinement3d = el<HTMLSelectElement>('refinement3d').value as TerrainRefinement;
  ++refinementEpoch;
  refinementSession?.dispose(); refinementSession = undefined; refinementReady = undefined; refinementTerrain = undefined; refinementError = ''; refinement2dKey = '';
  gpu?.setEnhancedDetail(undefined); terrain3d?.setTileLoader(load3dTile, refinement3d === 'neural-earth');
  render(); schedule3dTexture(); schedule2dRefinement(); deferSave();
  el('refinement3dStatus').hidden = refinement3d !== 'neural-earth' || (!perspective && !isRender3dStyle(style));
  el('retryRefinement').hidden = true;
}
el<HTMLSelectElement>('refinement3d').onchange = changeRefinement;
el('retryRefinement').onclick = changeRefinement;
el('fit').onclick = fit;
el('terrain3dControls').hidden = legacyPipeline;
el('refinement3dControl').hidden = !perspective && !isRender3dStyle(style);
el<HTMLButtonElement>('projection3d').disabled = !gpu;
if (!gpu) el('projection3d').title = 'La vue 3D nécessite le rendu WebGL2.';
el('projection3d').onclick = () => setPerspective(!perspective);
const capture3d = document.createElement('button'); capture3d.id = 'capture3d'; capture3d.type = 'button'; capture3d.textContent = 'Capturer PNG';
capture3d.style.width = 'auto'; capture3d.style.whiteSpace = 'nowrap';
capture3d.title = 'Exporter la vue 3D affichée avec ses bâtiments';
capture3d.onclick = async () => {
  if (!terrain3d || !perspective || capture3d.disabled) return;
  capture3d.disabled = true;
  try {
    const image = await terrain3d.capture(), url = URL.createObjectURL(image);
    const link = document.createElement('a'); link.href = url; link.download = `magna-urbis-3d-${settings.seed.replace(/[^a-z0-9_-]/gi, '_')}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Capture 3D PNG exportée.');
  } catch (error) { status(`Capture 3D : ${error instanceof Error ? error.message : error}`, true); }
  finally { capture3d.disabled = false; }
};
el('perspectiveControls').append(capture3d);
let buildingPickStart: [number, number] | undefined;
el<HTMLCanvasElement>('terrain3d').addEventListener('pointerdown', event => { buildingPickStart = [event.clientX, event.clientY]; });
el<HTMLCanvasElement>('terrain3d').addEventListener('pointerup', event => {
  if (perspective && buildingPickStart && Math.hypot(event.clientX - buildingPickStart[0], event.clientY - buildingPickStart[1]) < 4) {
    const rect = el('terrain3d').getBoundingClientRect(), id = terrain3d?.pickBuilding(event.clientX - rect.left, event.clientY - rect.top);
    if (id) settlements.urban.selectBuilding(id);
  }
  buildingPickStart = undefined;
});
el('north3d').onclick = () => terrain3d?.north();
input('exaggeration3d').oninput = () => {
  if (terrain3d) { terrain3d.setCamera({ ...terrain3d.getCamera(), exaggeration: Number(input('exaggeration3d').value) }); camera3dChanged(); }
};
input('tileBounds3d').checked = query.get('tiles3d') === '1';
input('tileBounds3d').onchange = () => { terrain3d?.setTileBoundaries(input('tileBounds3d').checked); deferSave(); };
el('terrain3d').addEventListener('webglcontextrestored', () => { surface3d = undefined; schedule3dTexture(); });
el('pinMode').onclick = () => { setPerspective(false); sketchEditor?.setEditing(false); pinMode = !pinMode; if (pinMode) { ruler.setEnabled(false); settlements.cancelPicking(); } el('pinMode').setAttribute('aria-pressed', String(pinMode)); viewport.classList.toggle('pin-mode', pinMode); };
input('showPins').onchange = () => { showPins(); save(); };
for (const [key, id] of Object.entries(layerFields)) input(id).onchange = () => {
  layers = { ...layers, [key]: input(id).checked }; detailRequest = undefined; render(); save();
  settlements.refreshForestMaterial();
};
input('showLegend').onchange = () => { renderWater(); save(); };
function changeLighting(): void {
  lighting = { ...lighting, enabled: input('showShading').checked };
  for (const [key, [id, min, max]] of Object.entries(lightingFields)) {
    const property = key as keyof typeof lightingFields;
    lighting[property] = bounded(finite(input(id).value, lighting[property]), min, max);
  }
  detailRequest = undefined; render(); save();
}
input('showShading').onchange = changeLighting;
for (const [id] of Object.values(lightingFields)) input(id).oninput = changeLighting;
el('resetLighting').onclick = () => {
  lighting = { ...DEFAULT_TERRAIN_LIGHTING };
  input('showShading').checked = lighting.enabled;
  for (const [key, [id]] of Object.entries(lightingFields)) input(id).value = String(lighting[key as keyof typeof lightingFields]);
  changeLighting();
};
input('showWater').onchange = () => { layers = { ...layers, water: input('showWater').checked }; detailRequest = undefined; render(); save(); };
input('showLakes').onchange = () => { renderWater(); scheduleForest(); save(); };
input('showOxbows').onchange = () => { renderWater(); scheduleForest(); save(); };
diagnosticSelect.onchange = () => {
  elevationDiagnostic = diagnosticSelect.value === 'elevation';
  hydroOverlay = elevationDiagnostic ? 'none' : diagnosticSelect.value as HydrologyOverlay | VectorOverlay;
  style = elevationDiagnostic ? 'copernicus' : baseStyle;
  detailRequest = undefined; render(); updateCoordinates(); save();
  updateForestControls(); settlements.refreshForestMaterial();
};
input('showContours').onchange = () => {
  updateContourControl();
  if (gpu) render();
  else if (input('showContours').checked && terrain && (!map.querySelector('#terrainOverview .layer-contours') || (displayedDetail && !map.querySelector('#terrainDetail .layer-contours')))) render();
  renderedStatus(); save();
};

function link(): string { save(); const url = new URL(location.href); url.search = shareQuery(); url.hash = ''; return placeSketchInFragment(url).href; }
async function copy(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); status(appliedSketchRef && appliedSketchRef.sketch === settings.sketch ? 'Lien copié · heightmap conservée dans ce navigateur. Pour une autre machine, partagez le JSON/PNG ou le fichier .decor.' : 'Copied: terrain, settings, pins and view.'); }
  catch { window.prompt('Copy', text); }
}
el('copy').onclick = () => { void retainAppliedSketch().then(() => copy(link())).catch(error => status(String(error), true)); };
el('copyReport').onclick = async () => {
  try { await retainAppliedSketch(); } catch (error) { status(String(error), true); return; }
  const erosion = settings.relief === 'cavern' ? 'not applicable (cavern)' : `${Math.round(settings.erosion * 100)}%`;
  const lines = ['Magna Urbis · Rust/WASM terrain and water prototype v3', link(), '', `Seed: ${settings.seed}`, `Map width: ${settings.width} m · landform scale: ${settings.motifSize} m · terrain: ${settings.relief} · erosion: ${erosion}`, `Rendering: ${style} · view: ${viewToString(view)}`, '', ...pins.pins.map((pin, i) => `Pin ${i + 1}: ${pin.x.toFixed(1)}, ${pin.y.toFixed(1)} m — ${pin.note || '(no note)'}`)];
  if (geological(settings.relief)) lines.splice(5, 0, `Surrounding terrain: ${settings.environment ?? 'mixed'}`);
  lines.push(`Hydrology: ${JSON.stringify(settings.hydrology)} · diagnostic: ${hydroOverlay} · water: ${input('showWater').checked ? 'visible' : 'hidden'}`);
  lines.push(`Contour lines: ${map.dataset.contours === 'true' ? 'visible' : 'hidden'}`);
  if (settings.coastMask) lines.push(`Coasts: ${COAST_DIRECTIONS.filter((_, i) => settings.coastMask! & (1 << i)).join(', ')} · islands: ${settings.islandMode}`);
  if (terrain) lines.push('', `Physical source: 1024² · overview: ${terrain.resolution}² · generation: ${terrain.generationMs.toFixed(1)} ms · rendering: ${renderingMs.toFixed(1)} ms`);
  if (displayedDetail) lines.push(`Detailed region: ${displayedDetail.terrain.x}, ${displayedDetail.terrain.y}, ${displayedDetail.terrain.width} m · ${displayedDetail.terrain.resolution}² · sampling: ${detailSamplingMs.toFixed(1)} ms`);
  void copy(lines.join('\n'));
};

const pointers = new Map<number, [number, number]>();
let dragging = false, moved = false;
const gesture = (): { mid: [number, number]; distance: number } => { const [a, b] = [...pointers.values()]; return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], distance: Math.hypot(a[0] - b[0], a[1] - b[1]) }; };
map.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pinMode || event.altKey || settlements.isPicking()) return;
  if (!pointers.size) moved = false;
  pointers.set(event.pointerId, local(event)); dragging = true; map.classList.add('drag');
});
map.addEventListener('pointermove', event => {
  cursor = local(event);
  updateCoordinates();
  const previous = pointers.get(event.pointerId); if (!previous) return;
  const current = local(event), oldGesture = pointers.size === 2 ? gesture() : undefined;
  const dx = current[0] - previous[0], dy = current[1] - previous[1];
  moved ||= Math.abs(dx) + Math.abs(dy) > 1;
  // Preserve the original SVG target on a click; capture only an actual pan.
  if (moved && !map.hasPointerCapture(event.pointerId)) map.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, current);
  if (oldGesture) {
    const next = gesture(); setView(panBy(view, next.mid[0] - oldGesture.mid[0], next.mid[1] - oldGesture.mid[1]));
    if (oldGesture.distance > 0 && next.distance > 0) zoom(next.distance / oldGesture.distance, next.mid[0], next.mid[1]);
  } else setView(panBy(view, dx, dy));
});
const stopDrag = (event: PointerEvent): void => { pointers.delete(event.pointerId); dragging = pointers.size > 0; if (!dragging) map.classList.remove('drag'); };
map.addEventListener('pointerup', stopDrag); map.addEventListener('pointercancel', stopDrag);
map.addEventListener('click', event => {
  if (moved) { moved = false; return; }
  if (settlements.click(event)) return;
  if (!terrain || !(pinMode || event.altKey)) return;
  const [x, y] = point(event); if (x < 0 || y < 0 || x > terrain.width || y > terrain.width) return;
  input('showPins').checked = true; showPins(); pins.add(x, y);
});
map.addEventListener('wheel', event => {
  event.preventDefault(); const [x, y] = local(event);
  const dy = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
  zoom(Math.exp(-bounded(dy, -1000, 1000) * 0.0015), x, y);
}, { passive: false });
map.addEventListener('dblclick', event => { if (!pinMode && !event.altKey && !settlements.isPicking() && !(event.target as Element).closest('[data-settlement]')) { const [x, y] = local(event); zoom(event.shiftKey ? 0.5 : 2, x, y); } });
window.addEventListener('keydown', event => {
  if ((event.target as HTMLElement).closest('input,select,textarea,button')) return;
  if (event.key === '+' || event.key === '=') zoom(1.4);
  else if (event.key === '-' || event.key === '_') zoom(1 / 1.4);
  else if (event.key === '0') fit();
  else return;
  event.preventDefault();
});
new ResizeObserver(updateView).observe(viewport);
// Camera hook for screenshot scripts: centre in metres, scale in px per metre.
(window as unknown as { __setView: (cx: number, cy: number, scale: number) => void }).__setView = (cx, cy, scale) => setView({ cx, cy, scale });
(window as unknown as { __terrain3dLod: () => unknown }).__terrain3dLod = () => terrain3d?.getLodInfo();
sketchEditor = createTerrainSketchEditor(el('terrainSketchEditor'), settings.sketch, () => terrain?.field?.exact ? { height: terrain.field.data, resolution: terrain.field.n, width: terrain.width } : terrain, parameterChanged, sketchLinkError, () => clearTimeout(generationTimer), {
  viewport, surface: map,
  bounds: () => ({ left: viewport.clientWidth / 2 - view.cx * view.scale, top: viewport.clientHeight / 2 - view.cy * view.scale, size: Number(input('width').value) * view.scale }),
  width: () => Number(input('width').value), setWidth: width => { input('width').value = String(width); },
  onEnable: () => { setPerspective(false); clearTimeout(generationTimer); ruler.setEnabled(false); settlements.cancelPicking(); pinMode = false; el('pinMode').setAttribute('aria-pressed', 'false'); viewport.classList.remove('pin-mode'); },
  apply: () => generate('relief'),
}, initialZones);
const editMapButton = document.createElement('button'); editMapButton.id = 'editTerrain'; editMapButton.textContent = 'Zones de relief'; editMapButton.style.width = 'auto'; editMapButton.style.flex = 'none';
editMapButton.hidden = pipelineStage !== 'terrain' && !legacyPipeline;
document.querySelector('nav')!.append(editMapButton);
editMapButton.onclick = () => {
  const details = el('terrainSketchEditor').querySelector('details')!;
  for (let parent = details.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  details.open = true; details.scrollIntoView({ block: 'nearest' });
  el('terrainSketchEditor').querySelector<HTMLButtonElement>('[data-id=edit]')!.click();
};
installTerrainHelp();
updateErosionControl();
// Successive benches exchange frozen, portable snapshots, never generation drafts.
document.querySelector('.brand')!.textContent = pipelineStage === 'terrain' ? 'Terrain · étapes 1–3' : 'Settlements · routes et quartiers';
const stagePanels = Array.from(document.querySelectorAll<HTMLElement>('.stages > .stage'));
for (const panel of stagePanels) {
  const downstream = ['settlementStage', 'roadStage', 'urbanMainStage', 'urbanAdvancedFrame', 'urbanQuarterStage', 'urbanParcelStage', 'urbanProgrammeStage', 'urbanBuildingStage', 'landuseStage'].includes(panel.id);
  panel.hidden = legacyPipeline ? false : pipelineStage === 'terrain' ? downstream : !downstream;
}
if (pipelineStage === 'settlements') {
  for (const control of Array.from(document.querySelectorAll<HTMLElement>('header > :not(.brand), .stages > .backend, #terrainSketchEditor'))) control.hidden = true;
  const display = document.getElementById('style')?.closest<HTMLElement>('.control-group'); if (display) display.hidden = false;
  el('terrain3dControls').hidden = legacyPipeline;
  input('auto').checked = false;
  document.body.classList.add('stage-settlements');
  document.querySelector('#urbanQuarterStage summary')!.childNodes[0].textContent = '5 · Quartiers et îlots ';
  document.querySelector('#urbanParcelStage summary')!.childNodes[0].textContent = 'Parcelles · optionnel ';
}
// The city inspector (right column) belongs to the Settlements page only.
if (pipelineStage !== 'settlements') document.getElementById('cityInspector')?.remove();
const transfer = document.createElement('details'); transfer.className = 'stage'; transfer.open = true; transfer.id = 'pipelineTransfer';
transfer.innerHTML = `<summary>${pipelineStage === 'terrain' ? 'Terrain → settlements' : 'Ville → atelier Ville'}</summary><div class="stage-controls">
  ${pipelineStage === 'terrain' ? '<label>Étendue<select id="transferExtent"><option value="all">Tout le terrain</option><option value="crop">Portion carrée</option></select></label><div id="transferCrop" hidden><label>X m<input id="transferX" type="number" min="0" value="0"></label><label>Y m<input id="transferY" type="number" min="0" value="0"></label><label>Côté m<input id="transferWidth" type="number" min="1" value="1200"></label><button id="transferPick">Placer la portion sur la carte</button><small>Découpe alignée sur les cellules, sans rééchantillonnage.</small></div>' : '<small>Choisissez la ville dans « Quartiers et îlots ». Le plan affiché est transmis avec ses rues et ses îlots.</small>'}
  <div class="settlement-actions"><button id="pipelineSave">Conserver cet export</button><button id="pipelineNext">${pipelineStage === 'terrain' ? 'Envoyer aux settlements' : 'Ouvrir la ville dans l’atelier'}</button><button id="pipelineDownload">Partager .decor</button></div><small id="pipelineStatus" role="status"></small></div>`;
document.querySelector('.stages')!.append(transfer);
createTerrainDecorLibrary({ before: transfer, onOpen: d => { const params = new URLSearchParams(d.meta.query); params.set('artifact', d.meta.id); params.set('stage', 'settlements'); openBench('settlements', params); } });
const historyPanel = createHistoryPanel({ before: transfer, current: () => lastExport ?? retainedDecor,
  onOpen: d => { const params = new URLSearchParams(d.meta.query); params.set('artifact', d.meta.id); if (pipelineStage === 'settlements') params.set('stage', pipelineStage); else params.delete('stage'); openBench(pipelineStage, params); } });
if (pipelineStage === 'terrain') {
  const extent = el<HTMLSelectElement>('transferExtent');
  extent.onchange = () => { el('transferCrop').hidden = extent.value !== 'crop'; drawTransferSelection?.(); };
  drawTransferSelection = () => {
    map.querySelector('#transferSelection')?.remove();
    if (extent.value !== 'crop') return;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); rect.id = 'transferSelection';
    for (const [attr, value] of Object.entries({ x: input('transferX').value, y: input('transferY').value, width: input('transferWidth').value, height: input('transferWidth').value, fill: '#348c6130', stroke: '#205f45', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' })) rect.setAttribute(attr, value);
    map.append(rect);
  };
  for (const id of ['transferX', 'transferY', 'transferWidth']) input(id).oninput = () => drawTransferSelection?.();
  el('transferPick').onclick = () => { setPerspective(false); sketchEditor?.setEditing(false); selectingPortion = !selectingPortion; el('transferPick').setAttribute('aria-pressed', String(selectingPortion)); };
  map.addEventListener('pointerdown', event => { if (selectingPortion) event.stopImmediatePropagation(); }, true);
  map.addEventListener('click', event => {
    if (!selectingPortion || !terrain) return;
    event.stopImmediatePropagation(); event.preventDefault();
    const bounds = viewport.getBoundingClientRect(), [px, py] = screenToWorld(view, bounds.width, bounds.height, event.clientX - bounds.left, event.clientY - bounds.top);
    const width = Math.min(terrain.width, Number(input('transferWidth').value));
    input('transferWidth').value = String(width);
    input('transferX').value = String(Math.round(Math.max(0, Math.min(terrain.width - width, px - width / 2))));
    input('transferY').value = String(Math.round(Math.max(0, Math.min(terrain.width - width, py - width / 2))));
    selectingPortion = false; el('transferPick').setAttribute('aria-pressed', 'false'); drawTransferSelection?.();
  }, true);
}
/** Compare cheap applied inputs and immutable native result identities, never
 * serialize the city to decide whether its persisted bytes can be reused. */
function capturePipelineState() {
  return { query: shareQuery(), workshop: JSON.stringify(settlements.urban.workshopSettings()), draft: JSON.stringify(settlements.urban.workshopDraft()), terrain, context: settlements.paintingContext, layouts: settlements.urban.layouts, scene: settlements.urban.buildingState.scene };
}
function pipelineCapture(): Decor {
  if (!terrain || overviewPending || generationError || terrain.hydrologyError) throw new Error('Attendez la fin de la génération du terrain et de l’eau.');
  if (pipelineStage === 'settlements') {
    if (settlements.urban.layoutPending || settlements.urban.generationPending) throw new Error('Attendez le calcul des quartiers et des parcelles activées.');
    return settlements.captureData();
  }
  let d = retainedDecor ? withForestQuery(retainedDecor) : captureDecorData(terrain, settings, { settlements: [], warnings: [], requested: 0, usableKm2: 0, ms: 0 }, undefined, null, { query: shareQuery() });
  if (!retainedDecor) d = { ...d, meta: { ...d.meta, regeneration: { query: shareQuery(), crops: [] } } };
  d = { ...d, meta: { ...d.meta, settlements: [], roads: null, roadConfig: null, pipeline: { stage: 'terrain', parent: retainedDecor?.meta.id } } };
  if (el<HTMLSelectElement>('transferExtent').value === 'crop') {
    d = cropTerrain(d, Number(input('transferX').value), Number(input('transferY').value), Number(input('transferWidth').value));
    const crop = d.meta.pipeline!.crop!;
    input('transferX').value = String(crop.x); input('transferY').value = String(crop.y); input('transferWidth').value = String(crop.width);
    drawTransferSelection?.();
  }
  return d;
}
async function exportPipeline(action: 'save' | 'next' | 'download'): Promise<void> {
  const buttons = Array.from(transfer.querySelectorAll<HTMLButtonElement>('button'));
  buttons.forEach(b => { b.disabled = true; });
  try {
    const current = capturePipelineState(), saved = lastExportState;
    if (action === 'download' && pipelineStage === 'settlements' && settlements.ready() && lastExport && saved && terrain && !overviewPending && !generationError && !terrain.hydrologyError
      && !settlements.urban.layoutPending && !settlements.urban.generationPending
      && current.query === saved.query && current.workshop === saved.workshop && current.draft === saved.draft
      && current.terrain === saved.terrain && current.context === saved.context && current.layouts === saved.layouts && current.scene === saved.scene) {
      await downloadHistory(lastExport.meta.id);
      return;
    }
    el('pipelineStatus').textContent = 'Préparation de l’export…';
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (pipelineStage === 'settlements' && action === 'next') {
      el('pipelineStatus').textContent = 'Préparation du plan de la ville…';
      const deadline = Date.now() + 60000;
      while ((settlements.urban.layoutPending || settlements.urban.generationPending) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    }
    const capturedState = capturePipelineState();
    let d = pipelineCapture();
    if (action === 'next' && pipelineStage === 'settlements') {
      const target = settlements.urban.target, plan = d.meta.pipeline?.urban;
      if (target === 'all' || !plan?.layouts?.some(l => l.key === target)) throw new Error('Choisissez une ville et générez ses quartiers avant d’ouvrir l’atelier.');
      d = await saveHistory(d);
      d.meta.pipeline!.city = target;
      d.meta.pipeline!.urban = { ...plan, layouts: plan.layouts.filter(l => l.key === target), partitions: plan.partitions?.filter(p => p.key === target) };
      d = cropCityDecor(d, target);
      d.meta.pipeline!.syncSource = retainedDecor?.meta.pipeline?.syncSource ?? retainedDecor?.meta.id;
    }
    d = await saveHistory(d); lastExport = d; lastExportState = action === 'next' ? undefined : capturedState; await historyPanel.refresh(d.meta.id);
    el('pipelineStatus').textContent = `Export conservé · ${d.raster.n}² · ${(d.raster.width / d.raster.n).toFixed(2)} m/cellule.`;
    if (action === 'download') await downloadHistory(d.meta.id);
    if (action === 'next') {
      const params = new URLSearchParams(d.meta.query); params.delete('view'); params.set('artifact', d.meta.id);
      if (pipelineStage === 'terrain') { params.set('stage', 'settlements'); openBench('settlements', params); }
      // The city atelier is City Bench: the cropped map, its plan and the city key travel in the decor.
      else openBench('city', new URLSearchParams({ artifact: d.meta.id }));
    }
  } catch (e) { el('pipelineStatus').textContent = e instanceof Error ? e.message : String(e); }
  finally { buttons.forEach(b => { b.disabled = false; }); }
}
el('pipelineSave').onclick = () => void exportPipeline('save');
el('pipelineNext').onclick = () => void exportPipeline('next');
el('pipelineDownload').onclick = () => void exportPipeline('download');
updateView();
terrainLoading('ready');
if (query.get('artifact')) void readHistory(query.get('artifact')!).then(d => {
  retainedDecor = d; lastExport = d; settings = { ...settings, seed: d.meta.seed, width: d.raster.width, refine: d.meta.terrainDisplay?.refine ?? false };
  input('refine').checked = !!settings.refine;
  input('width').value = String(settings.width); input('seed').value = settings.seed;
  terrain = terrainFromDecor(d); terrainGeneration = generation; overviewPending = false;
  if (!query.has('view')) view = fitView(d.raster.width, viewport.clientWidth, viewport.clientHeight);
  render();
  if (pipelineStage === 'settlements') settlements.restoreDecor(d);
  save();
}).catch(e => status(String(e), true));
else if (pipelineStage === 'terrain' && !sketchLinkError) generate();
else if (sketchLinkError) status(sketchLinkError, true);
else status('Chargez un export de terrain dans l’historique ou importez son fichier .decor.');

window.magnaBenchContext = {
  ready: () => !overviewPending && (!query.has('artifact') || !!retainedDecor) && (pipelineStage === 'terrain' || !retainedDecor || settlements.contextReady()),
  capture: () => {
    const editor = sketchEditor?.captureContext();
    return { view: { ...view }, perspective, camera3d: surface3d ? terrain3d?.getCamera() ?? camera3d : camera3d, pins: pins.pins.map(pin => ({ ...pin })), coastMask: draftCoastMask, settlements: settlements.captureContext(), editor: editor && { ...editor, mask: encodeZones(editor.mask), heightmap: editor.heightmap && encodeSketch(editor.heightmap) } };
  },
  restore: saved => {
    if (!saved) return;
    setPerspective(!!saved.perspective);
    if (saved.camera3d) { camera3d = saved.camera3d; terrain3d?.setCamera(camera3d!); }
    if (saved.view) view = saved.view;
    if (saved.pins) pins.set(saved.pins);
    draftCoastMask = saved.coastMask;
    if (saved.settlements) settlements.restoreContext(saved.settlements);
    if (saved.editor) sketchEditor?.restoreContext({ ...saved.editor, mask: decodeZones(saved.editor.mask)!, heightmap: decodeSketch(saved.editor.heightmap ?? null) });
  },
  refresh: () => {
    updateErosionControl(); updateStageStates();
    if (pipelineStage === 'terrain') el('transferCrop').hidden = el<HTMLSelectElement>('transferExtent').value !== 'crop';
    drawTransferSelection?.();
    updateView(); deferSave();
  },
};

installRecipeSharing({
  host: el('copy').parentElement!, embedded: window.parent !== window,
  terrain: async () => {
    if (!terrain || overviewPending || generationError || terrain.hydrologyError) throw new Error('Attendez la fin de la génération du terrain.');
    return retainedDecor ? withForestQuery(retainedDecor) : captureDecorData(terrain, settings, { settlements: [], warnings: [], requested: 0, usableKm2: 0, ms: 0 }, undefined, null, { query: shareQuery() });
  },
  capture: async () => {
    if (!terrain || overviewPending || generationError || terrain.hydrologyError || (pipelineStage === 'settlements' && !settlements.contextReady())) throw new Error('Attendez la fin de la génération avant d’exporter.');
    const applied = pipelineStage === 'settlements' && settlements.urban.layouts?.length
      ? settlements.captureData() : retainedDecor;
    return portableRecipe(pipelineStage, shareQuery(), applied);
  },
});

mountIllustration({ host: document.querySelector('header')!, capture: async () => {
  if (!terrain || overviewPending || generationError || terrain.hydrologyError || (pipelineStage === 'settlements' && !settlements.contextReady())) throw new Error('Attendez la fin de la génération avant de capturer la vue.');
  const context = illustrationContext({ sourceStyle: el<HTMLSelectElement>('style').value, seed: settings.seed,
    view: { ...view }, width: viewport.clientWidth, height: viewport.clientHeight,
    terrain: { relief: settings.relief, climate: settings.climate, environment: settings.environment, ...climateOf(settings), minHeight: terrain.minHeight, maxHeight: terrain.maxHeight },
    settlements: settlements.illustrationSettlements, buildings: settlements.urban.buildingState.scene,
    architecture: settlements.urban.buildingState.settings });
  if (perspective && terrain3d) {
    const captured = await terrain3d.captureIllustration();
    return { image: captured.image, guides: { depth: captured.depth }, context: { ...context, projection: 'perspective', camera: captured.camera } };
  }
  gpu?.redrawForCapture();
  const image = captureViewport(viewport, { exclude: ['#mini', '#ruler', '#pins', '#marks', '#terrain3d'] });
  const edges = captureViewport(viewport, { structural: true, exclude: ['#mini', '#ruler', '#pins', '#marks', '#terrain3d'] });
  const [source, guide] = await Promise.all([image, edges]);
  return { image: source, guides: { edges: guide }, context };
} });

if (query.get('projection') === '3d') setPerspective(true);
else el('terrain3d').tabIndex = -1;
