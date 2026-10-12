import { neuralWindow } from '../../../rust/bridge/terrainAdjust';
import { createTerrainSketchEditor } from './terrainSketchEditor';
import { decodeSketch, encodeSketch } from './terrainSketchSharing';
import { coarseSurface, fitNeuralSketch, type TerrainSketch } from '../../../rust/bridge/terrainSketch';
import './terrainbench.css';
import TerrainWorker from './terrainWorker?worker&inline';
import { reliefStatistics, sampleRustTerrain, RELIEFS, GEOLOGICAL_RELIEFS, ENVIRONMENT_RELIEFS, COMPUTE_MODES, type TerrainEnvironment, type TerrainCompute, type TerrainData, type TerrainSettings, type TerrainRequest, type TerrainResponse, type TerrainRelief, type TerrainRegion } from '../../../rust/bridge/terrain';
import { renderRustTerrain, terrainContourWidths, type TerrainStyle, type TerrainScene } from '../../../rust/bridge/terrainRender';
import { DEFAULT_HYDROLOGY, riverAreaFor, type HydrologySettings, type HydrologyOverlay } from '../../../rust/bridge/hydrology';
import { CLIMATE_VALUES, DEFAULT_NEURAL_TUNING, NEURAL_RELIEF_DEFAULTS, climateOf, type ClimateValues, type NeuralTuning } from '../../../rust/bridge/terrain';
import { lakeColour, riverSegments, vectorOverlayPixels, vectorOverlaySvg, vectorWaterSvg, VECTOR_LEGENDS, VECTOR_OVERLAYS, type VectorOverlay } from './vectorWaterRender';
import { TerrainGl, type TerrainLook } from './terrainGl';
import { CONTOUR_INTERVAL } from '../render/contours';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import { renderHydrology, HYDROLOGY_LEGENDS } from '../../../rust/bridge/hydrologyRender';
import { createPins } from './pins';
import { createRuler } from './ruler';
import { pinsFromString, pinsToString, viewFromString, viewToString } from './share';
import { clampView, fitView, panBy, screenToWorld, zoomAt, type View } from '../render/view';
import { COAST_DIRECTIONS, ISLAND_MODES, type IslandMode, TERRAIN_SOURCES, NEURAL_RELIEFS, NEURAL_CLIMATES, NEURAL_EXTENT, DEFAULT_NEURAL_SERVER, type TerrainSource, type NeuralClimate } from '../../../rust/bridge/terrain';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const map = document.getElementById('map') as unknown as SVGSVGElement;
const viewport = el('viewport');
// GPU renderer; the SVG keeps the legacy Rust hydrology diagnostics and serves as the event surface.
let gpu: TerrainGl | undefined;
if (new URLSearchParams(location.search).get('render') !== 'svg') {
  try { gpu = new TerrainGl(el<HTMLCanvasElement>('gl')); viewport.classList.add('gl'); }
  catch (error) { console.warn('Rendu WebGL2 indisponible, retour au SVG :', error); }
}
if (!gpu) el('gl').remove();
else {
  // A lost context (driver reset, GPU switch) comes back empty: rebuild and re-upload.
  el('gl').addEventListener('webglcontextlost', event => event.preventDefault());
  el('gl').addEventListener('webglcontextrestored', () => {
    try { gpu = new TerrainGl(el<HTMLCanvasElement>('gl')); uploaded = undefined; displayedDetail = undefined; render(); }
    catch (error) { status(`Rendu WebGL2 perdu : ${error instanceof Error ? error.message : error}`, true); }
  });
}
const query = new URLSearchParams(location.search);
const finite = (value: string | null, fallback: number): number => value !== null && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
const bounded = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const initialRelief = query.get('relief') as TerrainRelief;
const geological = (relief: string): boolean => (GEOLOGICAL_RELIEFS as readonly string[]).includes(relief);
const initialEnvironment = query.get('environment') as TerrainEnvironment;
const initialSource: TerrainSource = TERRAIN_SOURCES.includes(query.get('source') as TerrainSource) ? query.get('source') as TerrainSource : 'procedural';
const neuralRelief = (relief: string): boolean => (NEURAL_RELIEFS as readonly string[]).includes(relief);
const neuralServer = query.get('neural')?.trim() || DEFAULT_NEURAL_SERVER;
const climateFields = { temperature: 'climTemperature', temperatureStd: 'climTemperatureStd', precipitation: 'climPrecipitation', precipitationCv: 'climPrecipitationCv' } as const;
const tuningFields = {
  landScale: 'nLandScale', steps: 'nSteps', noiseTemperature: 'nNoiseTemperature', noiseTemperatureStd: 'nNoiseTemperatureStd',
  noisePrecipitation: 'nNoisePrecipitation', noisePrecipitationCv: 'nNoisePrecipitationCv', reliefScale: 'nReliefScale', reliefFixed: 'nReliefFixed', detail: 'nDetail',
} as const;
const initialClimate = query.get('climate') ?? 'temperate';
const initialClimateValues: ClimateValues = { ...CLIMATE_VALUES[(NEURAL_CLIMATES as readonly string[]).includes(initialClimate) ? initialClimate as NeuralClimate : 'temperate'] };
if (initialClimate === 'custom') for (const key of Object.keys(climateFields) as (keyof ClimateValues)[]) initialClimateValues[key] = finite(query.get(key), initialClimateValues[key]);
const initialTuning: NeuralTuning = { ...DEFAULT_NEURAL_TUNING, histogram: [...DEFAULT_NEURAL_TUNING.histogram] };
for (const key of Object.keys(tuningFields) as (keyof typeof tuningFields)[]) initialTuning[key] = finite(query.get(`n_${key}`), initialTuning[key]);
if (['auto', 'scale', 'fixed'].includes(query.get('n_reliefMode') ?? '')) initialTuning.reliefMode = query.get('n_reliefMode') as NeuralTuning['reliefMode'];
if (query.get('n_histogram')) initialTuning.histogram = query.get('n_histogram')!.split(',').slice(0, 5).map(v => finite(v, 0));
while (initialTuning.histogram.length < 5) initialTuning.histogram.push(0);
// Version 3 links chose the sketch noise from three presets.
const initialFidelity = bounded(finite(query.get('fidelity'), 0.05), 0.001, 2);
let sketchLinkError: string | undefined;
let initialSketch: TerrainSketch | undefined;
try { initialSketch = decodeSketch(query.get('sketch')); }
catch (e) { sketchLinkError = `Esquisse du lien ignorée : ${e instanceof Error ? e.message : String(e)}`; }
let settings: TerrainSettings = {
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
  compute: COMPUTE_MODES.includes(query.get('compute') as TerrainCompute) ? query.get('compute') as TerrainCompute : 'gpu-f32',
  generationCompute: query.get('generation') === 'cpu' ? 'cpu' : query.get('generation') === 'gpu-all' ? 'gpu-all' : query.get('generation') === 'gpu' ? 'gpu' : 'gpu-erosion',
  source: initialSource,
  climate: NEURAL_CLIMATES.includes(query.get('climate') as NeuralClimate) ? query.get('climate') as NeuralClimate : 'temperate',
  climateValues: initialClimateValues,
  fidelity: initialFidelity,
  neuralServer,
  neuralTuning: initialTuning,
  neuralFit: query.get('fit') === 'scale' ? 'scale' : 'crop',
  neuralSlopes: query.get('slopes') !== '0',
  refine: query.get('refine') !== '0',
};
// Links without a source remain procedural. Version 3 neural links were fixed at 40 km.
if (settings.source === 'neural') {
  if (query.get('v') !== '4') settings.width = NEURAL_EXTENT;
  if (!neuralRelief(settings.relief)) settings.relief = 'mixed';
}
const hydroFields = {
  enabled: 'hydroEnabled', main: 'hydroMain', density: 'hydroDensity', wetness: 'hydroWetness', lakes: 'hydroLakes',
  meanders: 'hydroMeanders', meanderIntensity: 'hydroMeanderIntensity', estuary: 'hydroEstuary', widthScale: 'hydroWidthScale',
  incision: 'hydroIncision', minLakeArea: 'hydroMinLakeArea', resolution: 'hydroResolution', compute: 'hydroCompute',
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
let hydroOverlay: HydrologyOverlay | VectorOverlay = overlays.includes(query.get('overlay') as HydrologyOverlay) ? query.get('overlay') as HydrologyOverlay : 'none';
const isVectorOverlay = (overlay: string): overlay is VectorOverlay => (VECTOR_OVERLAYS as string[]).includes(overlay);
input('showLakes').checked = query.get('lakes') !== '0'; input('showOxbows').checked = query.get('oxbows') !== '0';
el<HTMLSelectElement>('hydroOverlay').value = hydroOverlay;
input('showWater').checked = query.get('water') !== '0';
let style: TerrainStyle = ['parchment', 'atlas', 'topographic', 'copernicus'].includes(query.get('style') || '') ? query.get('style') as TerrainStyle : 'parchment';
let view: View = viewFromString(query.get('view')) || fitView(settings.width, viewport.clientWidth, viewport.clientHeight);
let terrain: TerrainData | undefined;
let pinMode = false, generation = 0, requestId = 0, terrainGeneration = 0;
let overviewRequest: TerrainRequest | undefined, detailRequest: TerrainRequest | undefined;
let generationTimer: ReturnType<typeof setTimeout> | undefined, detailTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let renderingMs = 0, contourStep = 0, detailSamplingMs = 0;
interface DetailTile {
  terrain: Pick<TerrainData, 'x' | 'y' | 'width' | 'resolution' | 'height' | 'caveMask' | 'generationMs' | 'backend' | 'backendReason' | 'prepareMs' | 'samplingMs' | 'gpuSetupMs'>;
  style: TerrainStyle; key: string;
  /** SVG fallback only. */
  scene?: TerrainScene; image?: HTMLImageElement; ready: Promise<void>;
}
const detailCache = new Map<string, DetailTile>();
let displayedDetail: DetailTile | undefined;
let cursor: [number, number] | undefined;

function updateCoordinates(): void {
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
    diagnostic = ` · amont ${(h.accumulation[c] / 1e6).toFixed(2)} km²${depth > 0 && !h.sea[c] ? ` · cuvette ${depth.toFixed(1)} m` : ''}`;
    if (water.lakeKind?.[c]) diagnostic += ` · lac ${water.lakeKind[c] === 2 ? 'fermé' : 'ouvert'}, niveau ${water.lakeLevel![c].toFixed(1)} m`;
    const cond = terrain?.conditioning;
    if (cond && hydroOverlay === 'v-conditioning') {
      const k = Math.floor(y / h.width * cond.n) * cond.n + Math.floor(x / h.width * cond.n);
      diagnostic += ` · conditionnement ${cond.delta[k] >= 0 ? '+' : ''}${cond.delta[k].toFixed(1)} m`;
    }
  }
  const hydro = terrain?.hydrology;
  if (hydro && hydroOverlay !== 'none' && x >= 0 && y >= 0 && x < hydro.width && y < hydro.width) {
    const n = hydro.resolution, i = Math.floor(y / hydro.width * n) * n + Math.floor(x / hydro.width * n);
    if (hydroOverlay === 'basins') diagnostic = ` · bassin ${hydro.basins[i]}`;
    else if (hydroOverlay === 'raw-basins') diagnostic = ` · bassin brut ${hydro.rawBasins[i]}`;
    else if (hydroOverlay === 'raw-accumulation') diagnostic = ` · surface drainée brute ${(hydro.rawAccumulation[i] / 1e6).toFixed(3)} km²`;
    else if (hydroOverlay === 'flats' || hydroOverlay === 'flat-rank') diagnostic = hydro.flatLabels[i] ? ` · zone plate ${hydro.flatLabels[i]} · rang ${hydro.flatRank[i]}` : ' · hors zone plate';
    else if (hydroOverlay === 'accumulation' || hydroOverlay === 'channels') diagnostic = ` · bassin drainé ${(hydro.accumulation[i] / 1e6).toFixed(3)} km²`;
    else if (hydroOverlay === 'depressions') diagnostic = ` · cuvette ${Math.max(0, hydro.filled[i] - hydro.drainageHeight[i]).toFixed(2)} m`;
    else if (hydroOverlay === 'raw-depressions') diagnostic = ` · cuvette brute ${Math.max(0, hydro.rawFilled[i] - hydro.rawDrainageHeight[i]).toFixed(2)} m`;
    else if (hydroOverlay === 'lakes') diagnostic = ` · lac ${hydro.lakeLabels[i]} · profondeur ${hydro.lakeDepth[i].toFixed(2)} m`;
    else if (hydroOverlay === 'flow' || hydroOverlay === 'raw-flow') {
      const receiver = (hydroOverlay === 'raw-flow' ? hydro.rawReceivers : hydro.receivers)[i];
      const dx = receiver % n - i % n, dy = Math.floor(receiver / n) - Math.floor(i / n);
      diagnostic = receiver >= n * n ? ' · exutoire' : ` · écoulement ${dy < 0 ? 'N' : dy > 0 ? 'S' : ''}${dx < 0 ? 'O' : dx > 0 ? 'E' : ''}${dx === 0 && dy === 0 ? 'stationnaire' : ''}`;
    }
  }
  el('coordinates').textContent = `x ${x.toFixed(1)} · y ${y.toFixed(1)} · z ${z} m${diagnostic}`;
}

input('width').value = String(settings.width); input('motifSize').value = String(settings.motifSize);
input('mountainMix').value = String(settings.mountainMix);
input('seed').value = settings.seed; input('erosion').value = String(settings.erosion);
el<HTMLSelectElement>('relief').value = settings.relief; el<HTMLSelectElement>('style').value = style;
el<HTMLSelectElement>('environment').value = settings.environment!;
el<HTMLSelectElement>('compute').value = settings.compute!;
el<HTMLSelectElement>('generationCompute').value = settings.generationCompute!;
el<HTMLSelectElement>('terrainSource').value = settings.source!;
el<HTMLSelectElement>('climate').value = initialClimate === 'custom' ? 'custom' : settings.climate!;
for (const [key, id] of Object.entries(climateFields)) input(id).value = String(initialClimateValues[key as keyof ClimateValues]);
input('fidelity').value = String(settings.fidelity);
for (const [key, id] of Object.entries(tuningFields)) input(id).value = String(initialTuning[key as keyof typeof tuningFields]);
el<HTMLSelectElement>('nReliefMode').value = initialTuning.reliefMode;
initialTuning.histogram.forEach((v, k) => { input(`nH${k}`).value = String(v); });
el<HTMLSelectElement>('neuralFit').value = settings.neuralFit!; input('neuralSlopes').checked = settings.neuralSlopes!;
input('refine').checked = settings.refine!;
input('auto').checked = query.get('auto') !== '0'; input('showPins').checked = query.get('showPins') !== '0';
input('showContours').checked = query.get('contours') !== '0';
function updateContourControl(): void {
  input('showContours').disabled = style === 'copernicus' || settings.relief === 'cavern';
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
  el('coastControl').title = cavern ? 'Sans côtes en caverne' : 'Choisir les directions couvertes par la mer';
  el('islandControl').hidden = cavern || draftCoastMask !== 255;
}
function updateHydrologyControl(): void {
  const cavern = el<HTMLSelectElement>('relief').value === 'cavern';
  for (const id of Object.values(hydroFields)) {
    el<HTMLInputElement | HTMLSelectElement>(id).disabled = cavern || (id !== 'hydroEnabled' && !input('hydroEnabled').checked);
  }
  el<HTMLButtonElement>('generateHydrology').disabled = cavern;
  el<HTMLButtonElement>('generateCoasts').disabled = cavern;
  el('hydroControls').title = cavern ? 'Hydrologie désactivée en caverne ; réglages conservés.' : '';
  el('hydroDensityValue').textContent = `${Math.round(Number(input('hydroDensity').value) * 100)} %`;
  el('hydroCondStrengthValue').textContent = `${Math.round(Number(input('hydroCondStrength').value) * 100)} %`;
  const rust = el<HTMLSelectElement>('hydroEngine').value === 'rust';
  el('vectorControls').hidden = rust; el('rustControls').hidden = !rust;
  input('hydroCondStrength').disabled ||= !['erosion', 'both'].includes(el<HTMLSelectElement>('hydroCondMode').value);
  for (const option of Array.from(el<HTMLSelectElement>('hydroOverlay').options)) option.disabled = option.value !== 'none' && isVectorOverlay(option.value) === rust;
  el('hydroLakeAbundanceValue').textContent = `× ${Number(input('hydroLakeAbundance').value).toFixed(2)}`;
}
const isNeural = (): boolean => el<HTMLSelectElement>('terrainSource').value === 'neural';
/** Neural relief: 40 km surface cropped or scaled to the map, regional families only, no procedural motif or erosion. */
function updateSourceControl(): void {
  const neural = isNeural(), relief = el<HTMLSelectElement>('relief');
  for (const option of Array.from(relief.options)) option.disabled = neural && !neuralRelief(option.value);
  if (neural && !neuralRelief(relief.value)) relief.value = 'mixed';
  input('width').title = neural ? 'Largeur de la carte : fenêtre recadrée ou mise à l’échelle de la surface neuronale de 40 km' : '';
  el('motifControl').hidden = neural;
  el('erosionControl').hidden = neural;
  el('fidelityControl').hidden = !neural;
  el('neuralFitControl').hidden = !neural;
  el('neuralSlopesControl').hidden = !neural || el<HTMLSelectElement>('neuralFit').value !== 'scale';
  el('neuralAdvanced').hidden = !neural;
  const mode = el<HTMLSelectElement>('nReliefMode').value;
  el('nReliefScaleControl').hidden = mode !== 'scale'; el('nReliefFixedControl').hidden = mode !== 'fixed';
  el('nReliefMode').title = `Auto : ${Object.entries(NEURAL_RELIEF_DEFAULTS).map(([k, v]) => `${k} ${v} m`).join(', ')} imposés ; libre ailleurs.`;
  el<HTMLSelectElement>('generationCompute').disabled = neural;
  el('neuralState').hidden = !neural;
  if (neural) void pollNeural();
}
let neuralPolling = false;
async function pollNeural(): Promise<void> {
  if (neuralPolling) return;
  neuralPolling = true;
  const state = el('neuralState');
  try {
    while (isNeural()) {
      let settled = false;
      try {
        const status = await (await fetch(`${neuralServer}/status`, { cache: 'no-store' })).json() as { state: string; message: string };
        state.dataset.state = status.state;
        state.textContent = `Service neuronal : ${status.message}`;
        settled = status.state === 'ready' || status.state === 'error';
      } catch {
        state.dataset.state = 'error';
        state.textContent = `Service neuronal absent (${neuralServer}) : lancer « npm run neural:serve » dans web/`;
      }
      if (settled && el('generate').getAttribute('aria-busy') !== 'true') break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally { neuralPolling = false; }
}
function updateErosionControl(): void {
  updateSourceControl();
  el('terrainSketchEditor').hidden = el<HTMLSelectElement>('relief').value === 'cavern';
  updateCoastControl();
  updateHydrologyControl();
  el('environmentControl').hidden = !geological(el<HTMLSelectElement>('relief').value);
  el('mountainMixControl').hidden = el<HTMLSelectElement>('relief').value !== 'mixed';
  el('mountainMixValue').textContent = `${Math.round(Number(input('mountainMix').value) * 100)} %`;
  const cavern = el<HTMLSelectElement>('relief').value === 'cavern';
  input('erosion').disabled = cavern;
  input('erosion').title = cavern ? 'Sans érosion en caverne' : 'Intensité de l’érosion';
  el('erosionValue').textContent = cavern ? '—' : `${Math.round(Number(input('erosion').value) * 100)} %`;
}
updateErosionControl();

function status(message: string, error = false): void {
  el('status').textContent = message; el('status').dataset.error = String(error);
}
function shareQuery(): string {
  const params = new URLSearchParams({ engine: 'rust', v: '4', seed: settings.seed, width: String(settings.width), motif: String(settings.motifSize), relief: settings.relief, erosion: String(settings.erosion), style, auto: input('auto').checked ? '1' : '0' });
  for (const [key, value] of Object.entries(settings.hydrology ?? DEFAULT_HYDROLOGY)) params.set(`hydro_${key}`, typeof value === 'boolean' ? value ? '1' : '0' : String(value));
  params.set('overlay', hydroOverlay); params.set('water', input('showWater').checked ? '1' : '0');
  params.set('contours', input('showContours').checked ? '1' : '0');
  if (settings.relief === 'mixed') params.set('mix', String(settings.mountainMix));
  if (geological(settings.relief)) params.set('environment', settings.environment ?? 'mixed');
  const climate = climateOf(settings), preset = CLIMATE_VALUES[settings.climate ?? 'temperate'];
  const custom = (Object.keys(preset) as (keyof ClimateValues)[]).some(key => preset[key] !== climate[key]);
  params.set('climate', custom ? 'custom' : settings.climate ?? 'temperate');
  if (custom) for (const [key, value] of Object.entries(climate)) params.set(key, String(value));
  params.set('refine', settings.refine ? '1' : '0');
  params.set('water', input('showWater').checked ? '1' : '0'); params.set('lakes', input('showLakes').checked ? '1' : '0'); params.set('oxbows', input('showOxbows').checked ? '1' : '0');
  if (settings.source === 'neural') {
    params.set('source', 'neural'); params.set('fidelity', String(settings.fidelity ?? 0.05));
    params.set('fit', settings.neuralFit ?? 'crop'); params.set('slopes', settings.neuralSlopes ? '1' : '0');
    const tuning = settings.neuralTuning ?? DEFAULT_NEURAL_TUNING;
    for (const key of Object.keys(tuningFields) as (keyof typeof tuningFields)[]) if (tuning[key] !== DEFAULT_NEURAL_TUNING[key]) params.set(`n_${key}`, String(tuning[key]));
    if (tuning.reliefMode !== 'auto') params.set('n_reliefMode', tuning.reliefMode);
    if (tuning.histogram.some(v => v)) params.set('n_histogram', tuning.histogram.join(','));
    if (neuralServer !== DEFAULT_NEURAL_SERVER) params.set('neural', neuralServer);
  }
  if (settings.relief !== 'cavern' && settings.coastMask) {
    params.set('coasts', COAST_DIRECTIONS.filter((_, i) => settings.coastMask! & (1 << i)).join(','));
    params.set('islands', settings.islandMode ?? 'island');
  }
  if (settings.sketch) params.set('sketch', encodeSketch(settings.sketch));
  params.set('compute', settings.compute ?? 'gpu-f32');
  params.set('generation', settings.generationCompute ?? 'gpu-erosion');
  if (pins.pins.length) params.set('pins', pinsToString(pins.pins));
  if (!input('showPins').checked) params.set('showPins', '0');
  params.set('view', viewToString(view)); return params.toString();
}
function save(): void {
  clearTimeout(saveTimer);
  try { history.replaceState(null, '', `${location.pathname}?${shareQuery()}`); } catch { /* file:// may reject replaceState; copied links still carry all inputs. */ }
}
function deferSave(): void { clearTimeout(saveTimer); saveTimer = setTimeout(save, 150); }
const pins = createPins({
  map: viewport, layer: el('pinLayer'), pop: el('pinPopover'), list: el('pins'),
  onChange: deferSave,
  onFocus: pin => setView({ ...view, cx: pin.x, cy: pin.y }),
});
pins.set(pinsFromString(query.get('pins')));
const pinInput = el('pinPopover').querySelector('input')!; pinInput.placeholder = 'Note du pin'; pinInput.setAttribute('aria-label', 'Note du pin');
const pinDelete = el('pinPopover').querySelector('button')!; pinDelete.textContent = 'Supprimer'; pinDelete.title = 'Supprimer ce pin';

const ruler = createRuler({ container: viewport, surface: map, getView: () => view, onEnable: () => {
  pinMode = false; el('pinMode').setAttribute('aria-pressed', 'false'); viewport.classList.remove('pin-mode');
} });

function updateView(): void {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  view = clampView(view, terrain?.width ?? settings.width, w, h);
  const contourWidths = terrainContourWidths(style, view.scale);
  map.style.setProperty('--terrain-contour-width', `${contourWidths.thin}px`);
  map.style.setProperty('--terrain-contour-index-width', `${contourWidths.index}px`);
  map.setAttribute('viewBox', `${view.cx - w / (2 * view.scale)} ${view.cy - h / (2 * view.scale)} ${w / view.scale} ${h / view.scale}`);
  gpu?.setView(view, w, h);
  pins.update(view, w, h);
  ruler.update();
  const sampling = displayedDetail ? `${(displayedDetail.terrain.width / displayedDetail.terrain.resolution).toFixed(2)} m / échantillon` : terrain?.field?.exact && gpu ? `raster ${(terrain.width / terrain.field.n).toFixed(1)} m + détail GPU` : 'aperçu';
  el('scale').textContent = `${(1 / view.scale).toFixed(1)} m / px · ${sampling}`;
  updateCoordinates();
  scheduleDetail();
}
function setView(next: View): void { view = next; updateView(); deferSave(); }
function fit(): void { setView(fitView(terrain?.width ?? settings.width, viewport.clientWidth, viewport.clientHeight)); }
function local(event: MouseEvent | PointerEvent | WheelEvent): [number, number] {
  const bounds = viewport.getBoundingClientRect(); return [event.clientX - bounds.left, event.clientY - bounds.top];
}
function point(event: MouseEvent): [number, number] { const [x, y] = local(event); return screenToWorld(view, viewport.clientWidth, viewport.clientHeight, x, y); }
function zoom(factor: number, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2): void {
  const limited = bounded(view.scale * factor, Math.min(viewport.clientWidth, viewport.clientHeight) / (terrain?.width ?? settings.width) * 0.5, 8) / view.scale;
  setView(zoomAt(view, limited, x, y, viewport.clientWidth, viewport.clientHeight));
}
function showPins(): void {
  el('pinLayer').hidden = !input('showPins').checked;
  if (!input('showPins').checked) el('pinPopover').hidden = true;
}
showPins();

function renderedStatus(): void {
  if (!terrain || terrainGeneration !== generation) return;
  const name = el<HTMLSelectElement>('relief').querySelector<HTMLOptionElement>(`option[value="${settings.relief}"]`)!.textContent;
  const environment = geological(settings.relief) ? ` · alentours ${el<HTMLSelectElement>('environment').querySelector<HTMLOptionElement>(`option[value="${settings.environment ?? 'mixed'}"]`)!.textContent}` : '';
  const detail = displayedDetail ? ` · détail ${displayedDetail.terrain.resolution}² (${(displayedDetail.terrain.width / displayedDetail.terrain.resolution).toFixed(2)} m) · échantillonnage ${detailSamplingMs.toFixed(0)} ms` : '';
  const data = displayedDetail?.terrain ?? terrain;
  const backend = data.backend === 'wasm' ? `CPU Rust${data.backendReason ? ` (${data.backendReason})` : ''}` : 'GPU FP32';
  const generationBackend = terrain.generationBackend === 'gpu-erosion-f32' ? 'érosion GPU FP32' : terrain.generationBackend === 'gpu-noise-all-f32' ? 'tous bruits GPU FP32 + érosion CPU' : terrain.generationBackend === 'gpu-noise-f32' ? 'bruits fins GPU FP32 + érosion CPU' : 'génération CPU';
  const preparation = terrain.prepareMs === undefined ? '' : ` · préparation ${terrain.prepareMs.toFixed(0)} ms (${generationBackend}${terrain.gpuSimulationMs ? `, simulation GPU ${terrain.gpuSimulationMs.toFixed(0)} ms` : ''}${terrain.nativeEnvironmentMs ? `, alentours CPU ${terrain.nativeEnvironmentMs.toFixed(0)} ms` : ''}${terrain.noiseMs ? `, bruits ${terrain.noiseMs.toFixed(0)} ms, suite Rust ${terrain.erosionMs!.toFixed(0)} ms` : ''})${terrain.generationReason ? ` · ${terrain.generationReason}` : ''}`;
  const setup = terrain.gpuSetupMs ? ` · initialisation GPU ${terrain.gpuSetupMs.toFixed(0)} ms` : '';
  const coast = terrain.coastBackend ? ` · littoral + érosion ${terrain.coastBackend === 'gpu-f32' ? 'GPU FP32' : 'CPU Rust'}${terrain.coastMs ? ` ${terrain.coastMs.toFixed(0)} ms` : ''}${terrain.coastReason ? ` (${terrain.coastReason})` : ''}` : '';
  const hydro = terrain.hydrology;
  const hydroStatus = el('hydrologyStatus');
  hydroStatus.hidden = !hydro && !terrain.hydrologyError;
  if (terrain.hydrologyError) hydroStatus.textContent = `Hydrologie indisponible sur ce relief neuronal : ${terrain.hydrologyError}`;
  const water = terrain.water, cond = terrain.conditioning;
  hydroStatus.hidden &&= !water;
  if (water) {
    const r = water.rivers;
    hydroStatus.textContent = `Eaux vectorielles · drainage ${water.hydro.n}² ${water.hydrologyMs.toFixed(0)} ms${water.balanceMs ? ` · bilan hydrique ${water.balanceMs.toFixed(0)} ms (aridité ${water.runoff.aridity.toFixed(2)}, ruissellement ${water.runoff.r0.toFixed(0)} mm, évaporation ${water.runoff.e0.toFixed(0)} mm)` : ''} · ${water.lakes} lacs${water.closedLakes ? ` dont ${water.closedLakes} fermés` : ''} (${water.lakeAreaKm2.toFixed(1)} km²)${r ? ` · ${r.rivers.length} cours, ${r.lengthKm.toFixed(0)} km · méandres ${r.meanderKm.toFixed(0)} km, ${r.oxbows.length} bras morts, ${r.avulsions} avulsions · tresses ${r.braidedKm.toFixed(1)} km · ${r.deltas} deltas · tracé ${r.ms.toFixed(0)} ms` : ''}${cond ? ` · pré-hydrique ${cond.stats.before.depressions} → ${cond.stats.after.depressions} cuvettes > 1 m (${cond.stats.ms.toFixed(0)} ms)` : ''}`;
  }
  if (hydro) hydroStatus.textContent = `Hydrologie · ${hydro.backend === 'gpu-f32' ? 'GPU FP32 + finalisation Rust' : 'CPU Rust'} · ${hydro.riverCount} tronçons · ${hydro.lakeCount} lacs (${(hydro.lakeFraction * 100).toFixed(1)} % des terres) · ${hydro.basinCount} bassins · grille ${hydro.resolution}² · ${hydro.breachCount} ouvertures bornées · drainage préparé ${hydro.drainageMs.toFixed(0)} ms · finalisation ${hydro.vectorMs.toFixed(0)} ms${hydro.backendReason ? ` · ${hydro.backendReason}` : ''}`;
  const neural = terrain.neural;
  if (neural) {
    const contours = contourStep && map.dataset.contours === 'true' ? `courbes ${contourStep} m` : 'sans courbes';
    const fit = settings.width === NEURAL_EXTENT ? '40 km' : settings.neuralFit === 'scale' || settings.width > NEURAL_EXTENT ? `40 km mis à l’échelle sur ${(settings.width / 1000).toLocaleString('fr-FR')} km` : `fenêtre de ${(settings.width / 1000).toLocaleString('fr-FR')} km sur 40`;
    status(`${name} · neuronal ${neural.profile} · évaluations ${neural.evaluations.join('/')} (coarse/base/decoder) · service ${neural.totalMs.toFixed(0)} ms (coarse ${neural.coarseMs.toFixed(0)}, base ${neural.baseMs.toFixed(0)}, decoder ${neural.decoderMs.toFixed(0)}, reconstruction ${neural.reconstructionMs.toFixed(0)}) · requête ${neural.requestMs.toFixed(0)} ms · terres ${(neural.land * 100).toFixed(0)} % · ${backend} · carte ${fit} · aperçu ${terrain.resolution}² · ${contours} · génération + aperçu ${terrain.generationMs.toFixed(0)} ms${detail} · rendu ${renderingMs.toFixed(0)} ms`);
    return;
  }
  status(`${name}${environment} · ${backend} · carte ${settings.width.toLocaleString('fr-FR')} m · relief ${settings.motifSize.toLocaleString('fr-FR')} m · aperçu ${terrain.resolution}² · ${contourStep && map.dataset.contours === 'true' ? `courbes ${contourStep} m` : 'sans courbes'}${preparation}${coast}${setup} · génération + aperçu ${terrain.generationMs.toFixed(0)} ms${detail} · rendu ${renderingMs.toFixed(0)} ms`);
}
function renderWater(): void {
  const layer = document.getElementById('hydrologyOverlay');
  if (!layer) return;
  const water = terrain?.water;
  if (gpu) {
    const vectorOverlay = water && isVectorOverlay(hydroOverlay) ? hydroOverlay : 'none';
    const cond = terrain?.conditioning;
    const display = { style, showOxbows: input('showOxbows').checked, riverArea: riverAreaFor(settings.hydrology ?? DEFAULT_HYDROLOGY, settings.width), riverMode: settings.hydrology?.riverMode ?? 'vector', overlay: vectorOverlay };
    const shown = !!water && input('showWater').checked;
    gpu.setWater(water && shown ? { lake: input('showLakes').checked ? water.lake : undefined, n: water.hydro.n, lakeColor: lakeColour(display), rivers: riverSegments(water, display) } : undefined);
    gpu.setOverlay(water ? vectorOverlayPixels(water, vectorOverlay, cond ? { values: cond.delta, n: cond.n } : undefined) : undefined);
    layer.innerHTML = !water && terrain?.hydrology && !isVectorOverlay(hydroOverlay) ? renderHydrology(terrain.hydrology, hydroOverlay, input('showWater').checked, style) : '';
  } else if (water) {
    const vectorOverlay = isVectorOverlay(hydroOverlay) ? hydroOverlay : 'none';
    const cond = terrain?.conditioning;
    layer.innerHTML = vectorOverlaySvg(water, vectorOverlay, cond ? { values: cond.delta, n: cond.n } : undefined)
      + (input('showWater').checked ? vectorWaterSvg(water, { style, showLakes: input('showLakes').checked, showOxbows: input('showOxbows').checked, riverArea: riverAreaFor(settings.hydrology ?? DEFAULT_HYDROLOGY, settings.width), riverMode: settings.hydrology?.riverMode ?? 'vector', overlay: vectorOverlay }) : '');
  } else layer.innerHTML = terrain?.hydrology && !isVectorOverlay(hydroOverlay) ? renderHydrology(terrain.hydrology, hydroOverlay, input('showWater').checked, style) : '';
  const legend = el('hydrologyLegend');
  legend.hidden = hydroOverlay === 'none' || (isVectorOverlay(hydroOverlay) ? !water : !terrain?.hydrology);
  legend.textContent = isVectorOverlay(hydroOverlay) ? VECTOR_LEGENDS[hydroOverlay] : HYDROLOGY_LEGENDS[hydroOverlay];
  report();
}

/** Measurement panel: neural networks, relief, water and the river laws. */
function report(): void {
  if (!terrain) return;
  const rows: [string, string][] = [], m = (v: number): string => `${Math.round(v)} m`;
  const neural = terrain.neural as (typeof terrain.neural & { coarse?: { sketch: number; elevation: number; relief: number; reliefUsed: number } }) | undefined;
  if (neural) {
    rows.push(['Service', `${Math.round(neural.requestMs)} ms · coarse ${Math.round(neural.coarseMs)} · base ${Math.round(neural.baseMs)} · decoder ${Math.round(neural.decoderMs)}`], ['Évaluations', `${neural.evaluations.join(' / ')} · ${neural.profile}`]);
    const c = neural.coarse;
    if (c) rows.push(['Esquisse (moy.)', m(c.sketch)], ['Coarse altitude (moy.)', m(c.elevation)], ['Coarse relief local', m(c.relief)], ['Relief local → base', m(c.reliefUsed)]);
  }
  const cell = terrain.width / terrain.resolution, stats = terrain.relief ?? reliefStatistics(terrain);
  if (stats.land) rows.push(['Altitudes terres', `p5 ${m(stats.p5)} · médiane ${m(stats.p50)} · p95 ${m(stats.p95)}`],
    ['Pente moyenne', `${(stats.slope * 180 / Math.PI).toFixed(1)}° (maille ${cell.toFixed(0)} m)`]);
  rows.push(['Terres', `${(stats.land * 100).toFixed(1)} %`]);
  const cond = terrain.conditioning;
  if (cond) rows.push(['Pré-hydrique', `${cond.stats.before.depressions} → ${cond.stats.after.depressions} cuvettes > 1 m · ${(cond.stats.before.volume / 1e6).toFixed(0)} → ${(cond.stats.after.volume / 1e6).toFixed(0)} hm³ · ${cond.stats.steps} pas, ${cond.stats.breaches} seuils ouverts`]);
  const water = terrain.water;
  if (water) {
    rows.push(['Lacs', `${water.lakes}${water.closedLakes ? ` (${water.closedLakes} fermés)` : ''} · ${water.lakeAreaKm2.toFixed(1)} km²`]);
    rows.push(['Climat', `aridité P/PET ${water.runoff.aridity.toFixed(2)} · ruissellement ${water.runoff.r0.toFixed(0)} mm${water.confluenceAngle ? ` · confluences ${water.confluenceAngle.toFixed(0)}°` : ''}`]);
    const r = water.rivers, k = water.metrics, f = (v: number | undefined, d = 2): string => v === undefined ? '—' : v.toFixed(d);
    if (r) rows.push(['Rivières', `${r.rivers.length} cours · ${r.lengthKm.toFixed(0)} km · ${Math.round(r.ms)} ms`],
      ['Méandres', `${r.meanderRuns} biefs · ${r.meanderKm.toFixed(0)} km · ${r.oxbows.length} bras morts · ${r.avulsions} avulsions`],
      ['Tresses, deltas', `${r.braidedKm.toFixed(1)} km tressés · ${r.braids.length} bras · ${r.deltas} deltas (${r.distributaries.length} défluents)`]);
    rows.push(['Loi de Hack L ∝ A^h', `h = ${f(k.hack)} (réel 0,5–0,6)`], ['Loi de Flint S ∝ A^−θ', `θ = ${f(k.flint)} (réel 0,35–0,6)`],
      ['Horton–Strahler', `R_b = ${f(k.bifurcation)} (réel 3–5) · ordre ${k.order}`],
      ['Méandres', `λ = ${f(k.wavelength, 1)} W (réel 10–14) · sinuosité ${f(k.sinuosity)}`], ['Confluences', `${f(k.confluence, 0)}° (45° aride – 72° humide)`]);
  }
  el('report').innerHTML = rows.map(([key, value]) => `<p><small><b>${key}</b><br>${value}</small></p>`).join('');
}
let uploaded: TerrainData | undefined;
/** Contour interval of the bench: shared intervals, doubled in mountains; none in caverns. */
function contourInterval(): number {
  if (!terrain || terrain.caveMask.length || style === 'copernicus') return 0;
  const relief = settings.relief === 'flat' || settings.relief === 'hills' || settings.relief === 'valley' ? settings.relief : 'mountains';
  return CONTOUR_INTERVAL[relief] * (relief === 'mountains' ? 2 : 1);
}
function renderGpu(): void {
  if (!terrain || !gpu) return;
  const start = performance.now(), field = terrain.field;
  if (uploaded !== terrain) {
    // A new landscape: its control grid replaces every layer.
    const base = field ?? { n: terrain.resolution, data: terrain.height, exact: false, floor: 0, cave: terrain.caveMask.length ? terrain.caveMask : undefined };
    gpu.setBase({ x: 0, y: 0, width: terrain.width, n: base.n, data: base.data, cave: base.cave });
    uploaded = terrain; displayedDetail = undefined;
    map.innerHTML = '<g id="hydrologyOverlay"></g>';
  }
  contourStep = contourInterval();
  const look: TerrainLook = {
    style, mapWidth: terrain.width, globalMin: terrain.globalMinHeight, globalMax: terrain.globalMaxHeight,
    contours: input('showContours').checked && contourStep > 0, contourStep, flatRelief: settings.relief === 'flat',
    refine: !!settings.refine && !terrain.caveMask.length, sourceCell: settings.width / 1024, seed: seedHash(settings.seed),
    floor: field?.floor ?? 0, frame: true, background: '#f1f0e9',
  };
  gpu.setLook(look);
  renderWater();
  renderingMs = performance.now() - start;
  updateView(); renderedStatus();
}
function render(preparedScene?: TerrainScene, preparationMs = 0): void {
  if (!terrain) return;
  if (gpu) { updateContourControl(); renderGpu(); return; }
  updateContourControl();
  const start = performance.now(), scene = preparedScene ?? renderRustTerrain(terrain, style, true, settings, input('showContours').checked);
  map.innerHTML = `<g id="terrainOverview">${scene.svg}</g><g id="terrainDetail"></g><g id="hydrologyOverlay"></g>`;
  renderWater();
  contourStep = scene.contourStep; renderingMs = preparationMs + performance.now() - start;
  displayedDetail = undefined;
  viewport.style.background = style === 'parchment' ? '#f1f0e9' : '#e7e8e2';
  updateView(); renderedStatus();
}
function regionForView(): TerrainRegion {
  const width = settings.width;
  const desired = Math.max(viewport.clientWidth, viewport.clientHeight) / view.scale * 1.3;
  // A small scale/position lattice reuses sampled regions during gentle pans.
  const extent = Math.min(width, Math.max(1, 2 ** (Math.ceil(Math.log2(Math.max(1, desired)) * 4) / 4)));
  const step = extent / 32;
  const x = bounded(Math.round((view.cx - extent / 2) / step) * step, 0, width - extent);
  const y = bounded(Math.round((view.cy - extent / 2) / step) * step, 0, width - extent);
  return { x, y, extent, resolution: 768 };
}
function detailKey(region: TerrainRegion): string { return `${generation}:${region.x}:${region.y}:${region.extent}:${region.resolution}${gpu ? '' : `:${style}:${input('showContours').checked ? 1 : 0}`}`; }
/** The GPU draws exact rasters at every zoom: no camera regions. */
const needsDetail = (): boolean => !gpu || !terrain?.field?.exact;
async function applyDetail(tile: DetailTile): Promise<void> {
  if (gpu) {
    if (terrainGeneration !== generation || tile.key !== detailKey(regionForView()) || displayedDetail?.key === tile.key) return;
    const t = tile.terrain;
    gpu.setDetail({ x: t.x, y: t.y, width: t.width, n: t.resolution, data: t.height, cave: t.caveMask.length ? t.caveMask : undefined });
    displayedDetail = tile; detailSamplingMs = t.generationMs;
    updateCoordinates();
    el('scale').textContent = `${(1 / view.scale).toFixed(1)} m / px · ${(t.width / t.resolution).toFixed(2)} m / échantillon`;
    renderedStatus();
    return;
  }
  try { await tile.ready; }
  catch {
    if (tile.key === detailKey(regionForView())) status('Erreur du décodage de l’image détaillée.', true);
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
    raster.addEventListener('error', () => reject(new Error('Image SVG indisponible')), { once: true });
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
  void fade.finished.then(cleanup, cleanup);
  displayedDetail = tile; detailSamplingMs = tile.terrain.generationMs;
  updateCoordinates();
  // Only replace the regional scene: no fit, new generation or camera callback.
  const sampling = (tile.terrain.width / tile.terrain.resolution).toFixed(2);
  el('scale').textContent = `${(1 / view.scale).toFixed(1)} m / px · ${sampling} m / échantillon`;
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
  if (!terrain || terrainGeneration !== generation) return;
  const region = regionForView(), key = detailKey(region), cached = detailCache.get(key);
  if (cached) { cacheDetail(cached); void applyDetail(cached); return; }
  if (detailRequest && detailKey(detailRequest.region) === key) return;
  detailRequest = { id: ++requestId, generation, kind: 'detail', settings, region };
  dispatch(detailRequest);
}
function receive(response: TerrainResponse): void {
  if (response.generation !== generation) return;
  if (response.kind === 'detail') {
    if (!detailRequest || response.id !== detailRequest.id) return;
    const request = detailRequest; detailRequest = undefined;
    if ('error' in response) { status(`Erreur du détail Rust : ${response.error}`, true); return; }
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
      const prepared = request.scene?.style === style && request.scene.showContours === input('showContours').checked;
      const scene = prepared && response.scene ? response.scene : renderRustTerrain(data, style, false, settings, input('showContours').checked), image = new Image();
      image.src = scene.imageUrl;
      const tile: DetailTile = {
        terrain: { x: data.x, y: data.y, width: data.width, resolution: data.resolution, height: data.height, caveMask: data.caveMask, generationMs: data.generationMs, backend: data.backend, backendReason: data.backendReason, prepareMs: data.prepareMs, samplingMs: data.samplingMs, gpuSetupMs: data.gpuSetupMs },
        style, scene, image, ready: image.decode(), key: detailKey(request.region),
      };
      renderingMs = (prepared ? response.scenePreparationMs ?? 0 : 0) + performance.now() - start; cacheDetail(tile); void applyDetail(tile);
    } catch (error) { status(`Erreur du rendu détaillé : ${error instanceof Error ? error.message : error}`, true); }
    return;
  }
  if (!overviewRequest || response.id !== overviewRequest.id) return;
  if ('partial' in response && response.partial) {
    // The relief first; the waters follow in the same generation.
    const previousWidth = terrain?.width;
    terrain = response.terrain; settings = overviewRequest.settings; terrainGeneration = generation;
    if (previousWidth !== undefined && previousWidth !== terrain.width) view = fitView(terrain.width, viewport.clientWidth, viewport.clientHeight);
    try { render(); } catch (error) { status(`Erreur du rendu : ${error instanceof Error ? error.message : error}`, true); return; }
    status(`Relief affiché en ${terrain.generationMs.toFixed(0)} ms · calcul des eaux en cours…`);
    return;
  }
  el('generate').removeAttribute('aria-busy');
  if ('error' in response) { status(`Erreur du moteur Rust : ${response.error}`, true); return; }
  const previousWidth = terrain?.width;
  terrain = response.terrain; settings = overviewRequest.settings; terrainGeneration = generation;
  if (previousWidth !== undefined && previousWidth !== terrain.width) view = fitView(terrain.width, viewport.clientWidth, viewport.clientHeight);
  updateStageStates();
  const prepared = overviewRequest.scene?.style === style && overviewRequest.scene.showContours === input('showContours').checked;
  try { render(prepared ? response.scene : undefined, prepared ? response.scenePreparationMs : 0); save(); } catch (error) { status(`Erreur du rendu : ${error instanceof Error ? error.message : error}`, true); }
}
let worker: Worker | undefined;
async function runOnMain(request: TerrainRequest): Promise<void> {
  const meta = { id: request.id, generation: request.generation, kind: request.kind };
  try { receive({ ...meta, terrain: await sampleRustTerrain(request) }); }
  catch (error) { receive({ ...meta, error: error instanceof Error ? error.message : String(error) }); }
}
function dispatch(request: TerrainRequest): void {
  if (gpu) request.display = 'gl';
  else request.scene = { style, showContours: input('showContours').checked };
  if (worker) worker.postMessage(request); else void runOnMain(request);
}
try {
  worker = new TerrainWorker(); worker.onmessage = (event: MessageEvent<TerrainResponse>) => receive(event.data);
  worker.onerror = event => {
    event.preventDefault(); worker?.terminate(); worker = undefined;
    const request = terrainGeneration === generation ? detailRequest : overviewRequest;
    if (request) void runOnMain(request);
  };
} catch { worker = undefined; }

function readSettings(stage: GenerationStage = 'all', reportError = true): TerrainSettings | undefined {
  if (stage === 'hydrology') return { ...settings, hydrology: readHydrology() };
  if (stage === 'coasts') return { ...settings, coastMask: settings.relief === 'cavern' ? 0 : draftCoastMask, islandMode: el<HTMLSelectElement>('islandMode').value as IslandMode };
  const source = el<HTMLSelectElement>('terrainSource').value as TerrainSource;
  const width = Number(input('width').value), motifSize = Number(input('motifSize').value), seed = input('seed').value.trim();
  if (!Number.isFinite(width) || width < 500 || width > 100000 || !seed) {
    if (reportError) status('Saisissez une largeur entre 500 et 100 000 m et une graine.', true); return;
  }
  if (!Number.isFinite(motifSize) || motifSize < 250 || motifSize > 50000) {
    if (reportError) status('Saisissez une échelle du relief entre 250 et 50 000 m.', true); return;
  }
  const relief = el<HTMLSelectElement>('relief').value as TerrainRelief;
  if (!RELIEFS.includes(relief)) { if (reportError) status('Choisissez un relief dans le menu.', true); return; }
  if (source === 'neural' && !neuralRelief(relief)) { if (reportError) status('Ce relief n’est pas disponible en source neuronale.', true); return; }
  const environment = el<HTMLSelectElement>('environment').value as TerrainEnvironment;
  if (!ENVIRONMENT_RELIEFS.includes(environment)) { if (reportError) status('Choisissez un relief environnant dans le menu.', true); return; }
  return { sketch: relief === 'cavern' ? undefined : sketchEditor.snapshot(), seed, width, motifSize, relief, environment, coastMask: relief === 'cavern' ? 0 : draftCoastMask, islandMode: el<HTMLSelectElement>('islandMode').value as IslandMode, erosion: Number(input('erosion').value), mountainMix: Number(input('mountainMix').value), resolution: 512, hydrology: readHydrology(), compute: el<HTMLSelectElement>('compute').value as TerrainCompute, generationCompute: el<HTMLSelectElement>('generationCompute').value as TerrainSettings['generationCompute'], source, climate: readClimate(), climateValues: readClimateValues(), fidelity: bounded(finite(input('fidelity').value, 0.05), 0.001, 2), neuralServer,
    neuralTuning: readTuning(), neuralFit: el<HTMLSelectElement>('neuralFit').value === 'scale' ? 'scale' : 'crop', neuralSlopes: input('neuralSlopes').checked, refine: input('refine').checked };
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
  const draft = readSettings(stage); if (!draft) return;
  // The climate of a procedural relief only drives the water budget.
  const next = stage === 'hydrology' ? { ...settings, hydrology: draft.hydrology, ...(settings.source === 'neural' ? {} : { climate: draft.climate, climateValues: draft.climateValues }) }
    : stage === 'coasts' ? { ...settings, coastMask: draft.coastMask, islandMode: draft.islandMode }
    : stage === 'relief' ? { ...settings, seed: draft.seed, width: draft.width, motifSize: draft.motifSize, relief: draft.relief, environment: draft.environment, erosion: draft.erosion, mountainMix: draft.mountainMix, compute: draft.compute, generationCompute: draft.generationCompute, source: draft.source, climate: draft.climate, climateValues: draft.climateValues, fidelity: draft.fidelity, sketch: draft.sketch, neuralTuning: draft.neuralTuning, neuralFit: draft.neuralFit, neuralSlopes: draft.neuralSlopes, refine: draft.refine }
    : draft;
  generation++; clearTimeout(detailTimer); detailRequest = undefined; detailCache.clear();
  overviewRequest = { id: ++requestId, generation, kind: 'overview', settings: next, region: { x: 0, y: 0, extent: next.width, resolution: 512 } };
  el('generate').setAttribute('aria-busy', 'true');
  const neural = next.source === 'neural' && stage !== 'hydrology';
  status(neural ? 'Génération neuronale par le service Rust natif (coarse → base → decoder), puis eaux…' : stage === 'hydrology' ? 'Recalcul des eaux… relief et côtes conservés.' : stage === 'coasts' ? 'Recalcul des côtes et des eaux… relief conservé.' : 'Génération du terrain et du réseau hydrique en Rust…');
  if (neural) void pollNeural();
  dispatch(overviewRequest);
}
function updateStageStates(): void {
  const draft = readSettings('all', false);
  if (!draft) {
    el('reliefState').textContent = 'paramètres incomplets';
    el('coastState').textContent = 'à recalculer après relief';
    el('hydroState').textContent = 'à recalculer après amont';
    return;
  }
  const neural = draft.source === 'neural';
  const climateChanged = JSON.stringify(draft.climateValues) !== JSON.stringify(settings.climateValues);
  const reliefChanged = (draft.sketch !== settings.sketch && JSON.stringify(draft.sketch) !== JSON.stringify(settings.sketch)) || (neural && (climateChanged || JSON.stringify(draft.neuralTuning) !== JSON.stringify(settings.neuralTuning)))
    || ['seed', 'width', 'motifSize', 'relief', 'environment', 'mountainMix', 'erosion', 'compute', 'generationCompute', 'source', 'fidelity', 'neuralFit', 'neuralSlopes', 'refine'].some(key => draft[key as keyof TerrainSettings] !== settings[key as keyof TerrainSettings]);
  const coastChanged = draft.coastMask !== settings.coastMask || draft.islandMode !== settings.islandMode;
  const hydroChanged = JSON.stringify(draft.hydrology) !== JSON.stringify(settings.hydrology) || (!neural && climateChanged);
  el('reliefState').textContent = reliefChanged ? 'modifié' : '';
  el('coastState').textContent = reliefChanged ? 'à recalculer après relief' : coastChanged ? 'modifiées' : '';
  el('hydroState').textContent = reliefChanged || coastChanged ? 'à recalculer après amont' : hydroChanged ? 'modifiée' : '';
}
function parameterChanged(): void {
  updateErosionControl(); updateStageStates(); clearTimeout(generationTimer);
  if (input('auto').checked) generationTimer = setTimeout(() => generate(), 220);
  else status('Paramètres modifiés · recalculer une étape conserve les réglages amont ; Générer applique tout.');
}
for (const id of ['width', 'motifSize', 'relief', 'environment', 'mountainMix', 'erosion', 'seed', 'islandMode', 'terrainSource', 'fidelity', 'neuralFit', 'neuralSlopes', 'refine', 'nReliefMode', ...Object.values(tuningFields), 'nH0', 'nH1', 'nH2', 'nH3', 'nH4']) el(id).addEventListener('input', parameterChanged);
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
  style = el<HTMLSelectElement>('style').value as TerrainStyle;
  detailRequest = undefined; render(); save();
};
el('fit').onclick = fit; el('zoomIn').onclick = () => zoom(1.4); el('zoomOut').onclick = () => zoom(1 / 1.4);
el('pinMode').onclick = () => { pinMode = !pinMode; if (pinMode) ruler.setEnabled(false); el('pinMode').setAttribute('aria-pressed', String(pinMode)); viewport.classList.toggle('pin-mode', pinMode); };
input('showPins').onchange = () => { showPins(); save(); };
input('showWater').onchange = () => { renderWater(); save(); };
input('showLakes').onchange = () => { renderWater(); save(); };
input('showOxbows').onchange = () => { renderWater(); save(); };
el<HTMLSelectElement>('hydroOverlay').onchange = () => { hydroOverlay = el<HTMLSelectElement>('hydroOverlay').value as HydrologyOverlay | VectorOverlay; renderWater(); updateCoordinates(); save(); };
input('showContours').onchange = () => {
  updateContourControl();
  if (gpu) render();
  else if (input('showContours').checked && terrain && (!map.querySelector('#terrainOverview .layer-contours') || (displayedDetail && !map.querySelector('#terrainDetail .layer-contours')))) render();
  renderedStatus(); save();
};

function link(): string { save(); const url = new URL(location.href); url.search = shareQuery(); return url.href; }
async function copy(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); status('Copié : terrain, paramètres, pins et vue.'); }
  catch { window.prompt('Copier', text); }
}
el('copy').onclick = () => void copy(link());
el('copyReport').onclick = () => {
  const erosion = settings.relief === 'cavern' ? 'sans objet (caverne)' : `${Math.round(settings.erosion * 100)} %`;
  const lines = ['Magna Urbis · prototype terrain et eaux Rust/WASM v3', link(), '', `Graine : ${settings.seed}`, `Largeur carte : ${settings.width} m · échelle relief : ${settings.motifSize} m · relief : ${settings.relief} · érosion : ${erosion}`, `Rendu : ${style} · vue : ${viewToString(view)}`, '', ...pins.pins.map((pin, i) => `Pin ${i + 1} : ${pin.x.toFixed(1)}, ${pin.y.toFixed(1)} m — ${pin.note || '(sans note)'}`)];
  if (geological(settings.relief)) lines.splice(5, 0, `Relief environnant : ${settings.environment ?? 'mixed'}`);
  lines.push(`Hydrologie : ${JSON.stringify(settings.hydrology)} · diagnostic : ${hydroOverlay} · eaux : ${input('showWater').checked ? 'visibles' : 'masquées'}`);
  lines.push(`Courbes de niveau : ${map.dataset.contours === 'true' ? 'visibles' : 'masquées'}`);
  if (settings.coastMask) lines.push(`Côtes : ${COAST_DIRECTIONS.filter((_, i) => settings.coastMask! & (1 << i)).join(', ')} · îles : ${settings.islandMode}`);
  if (terrain) lines.push('', `Source physique : 1024² · aperçu : ${terrain.resolution}² · génération : ${terrain.generationMs.toFixed(1)} ms · rendu : ${renderingMs.toFixed(1)} ms`);
  if (displayedDetail) lines.push(`Région détaillée : ${displayedDetail.terrain.x}, ${displayedDetail.terrain.y}, ${displayedDetail.terrain.width} m · ${displayedDetail.terrain.resolution}² · échantillonnage : ${detailSamplingMs.toFixed(1)} ms`);
  void copy(lines.join('\n'));
};

const pointers = new Map<number, [number, number]>();
let dragging = false, moved = false;
const gesture = (): { mid: [number, number]; distance: number } => { const [a, b] = [...pointers.values()]; return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], distance: Math.hypot(a[0] - b[0], a[1] - b[1]) }; };
map.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pinMode || event.altKey) return;
  if (!pointers.size) moved = false;
  pointers.set(event.pointerId, local(event)); map.setPointerCapture(event.pointerId); dragging = true; map.classList.add('drag');
});
map.addEventListener('pointermove', event => {
  cursor = local(event);
  updateCoordinates();
  const previous = pointers.get(event.pointerId); if (!previous) return;
  const current = local(event), oldGesture = pointers.size === 2 ? gesture() : undefined;
  const dx = current[0] - previous[0], dy = current[1] - previous[1];
  moved ||= Math.abs(dx) + Math.abs(dy) > 1;
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
  if (!terrain || !(pinMode || event.altKey)) return;
  const [x, y] = point(event); if (x < 0 || y < 0 || x > terrain.width || y > terrain.width) return;
  input('showPins').checked = true; showPins(); pins.add(x, y);
});
map.addEventListener('wheel', event => {
  event.preventDefault(); const [x, y] = local(event);
  const dy = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
  zoom(Math.exp(-bounded(dy, -1000, 1000) * 0.0015), x, y);
}, { passive: false });
map.addEventListener('dblclick', event => { if (!pinMode && !event.altKey) { const [x, y] = local(event); zoom(event.shiftKey ? 0.5 : 2, x, y); } });
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
const sketchEditor = createTerrainSketchEditor(el('terrainSketchEditor'), settings.sketch, () => terrain, parameterChanged, async () => {
  const draft = readSettings(); if (!draft) throw new Error('Paramètres incomplets.');
  if (draft.source === 'neural') {
    const params = new URLSearchParams({ seed: draft.seed, relief: draft.relief, mix: String(draft.mountainMix),
      coasts: String(draft.coastMask ?? 0), islands: draft.islandMode ?? 'island', climate: draft.climate ?? 'temperate' });
    for (const [key, value] of Object.entries(draft.climateValues ?? {})) params.set(key, String(value));
    params.set('landScale', String(draft.neuralTuning?.landScale ?? 1));
    const response = await fetch(`${neuralServer.replace(/\/$/, '')}/sketch?${params}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(await response.text());
    return fitNeuralSketch(await response.json() as TerrainSketch, NEURAL_EXTENT,
      neuralWindow(NEURAL_EXTENT, draft.width, draft.neuralFit ?? 'crop', draft.neuralSlopes ?? true, draft.coastMask ?? 0));
  }
  if (draft.relief === 'cavern') throw new Error('L’éditeur de relief ne s’applique pas aux cavernes.');
  const data = await sampleRustTerrain({ id: 0, generation: 0, kind: 'overview',
    settings: { ...draft, sketch: undefined, coastMask: 0, hydrology: undefined, compute: 'wasm' },
    region: { x: 0, y: 0, extent: draft.width, resolution: 256 } });
  return coarseSurface(data.height, data.resolution);
}, sketchLinkError, () => clearTimeout(generationTimer));
updateView(); generate();
