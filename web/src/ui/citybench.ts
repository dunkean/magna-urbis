import { cityGroundSettings, cityGroundLook, cityForestInput, cityForestSettings } from '../render/cityEnvironment';
import { cityRegionalStreets } from '../render/cityContract';
import { city3dPlanOptions } from '../render/cityDrawOptions';
import { benchOverlayChange, benchMaterialNightChange } from './benchComposition';
import type { TerrainLook } from './terrainGl';
import { moonlightSvg } from '../render/materialLook';
import { benchSettlementTextWorld, benchTextLayer } from './benchComposition';
import { createTerrainSettlements } from './terrainSettlements';
import { decorBiome, decorClimate, decorClimateZone } from './decorClimate';
import { setMapClimateZone } from '../render/seasonPalette';
import { loadRenderGeometry } from '../../../rust/bridge/renderGeometry';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import { buildForestField, type ForestField } from '../../../rust/bridge/terrainForest';
import { forestRetainedRiverSegments } from '../../../rust/bridge/terrainForestRiparian';
import { forestRetainedWater } from '../../../rust/bridge/terrainForestWater';
import { createTerrainDecorLibrary } from './terrainDecorLibrary';
import { createHistoryPanel, downloadHistory, openBench, readHistory, saveHistory, syncBenchUrl } from './benchHistory';
import { applyWorkshopPopulation, mergeCityWorkshop, translateWorkshopState, workshopSettings } from './urbanSnapshot';
import { terrainFromDecor } from './benchTerrainTransfer';
import type { Decor } from './decor';
import { downloadDecorFile, readDecorFile } from './decorFile';
import { clampView, fitView, panBy, zoomAt, type View } from '../render/view';
import { CITY_LOD_OFF } from '../render/cityCanvas';
import { cityContourPaths, cityContourPathsReady, type CityContourPaths } from '../render/cityContours';
import { renderRustTerrain, terrainContourWidths } from '../../../rust/bridge/terrainRender';
import { getBenchRenderColors, writeRenderColorsQuery } from './benchRenderColors';
import { isTerrainStyle, styleTraits, terrainStyle, type TerrainStyle } from '../render/terrainStyle';
import { benchVegetationLimitations, getBenchComposition, resolveBenchAppearance, syncBenchAnnotations, setBenchAppearanceField, setBenchComposition, setBenchRenderCapabilities, writeBenchCompositionQuery } from './benchComposition';
import { withGroundVariant, type Limitation } from '../render/composition';
import { createTerrainRenderer, type TerrainRenderer } from './terrainRenderer';
import { DEFAULT_FRACTAL_DETAIL } from '../../../rust/bridge/terrainAdjust';
import { forestOccupation } from './forestOccupation';
import { roadCorridor } from '../render/forestRoom';
import { withLandDetail } from './landDetail';
import { decorWaterSvg } from './decorWater';
import { decorWater3d } from './decorWater3d';
import type { City3dRetainedWater } from './city3d';
import type { WaterSeason } from '../render/waterRegime';
import { encodePng, pngDataUrl } from '../render/raster';
import { applyExecutionProfile, installExecutionProfile } from './executionProfile';
import type { TerrainData, TerrainSettings } from '../../../rust/bridge/terrain';
import type {} from './benchContext';
import { installRecipeSharing, generationRecipe } from './recipeSharing';
import { decodeSituation, encodeSituation, type SituationPin } from './citySituation';
import { mountCityRpgPins, prepareCityMapExport } from './cityRpgPins';
import { installUrbanMapExports } from './urbanMapExport';
import { mountCity3d } from './city3d';
import { provideFurniture3d, refreshFurniture3d } from './legendOverlay3d';
import { ruralSemanticLegend, urbanSemanticLegend } from '../render/semanticLayer';
import { urbanText } from './urbanPanelLocale';
import { mountIllustration, captureViewport } from '../../../illustration/web/index.mjs';
import { illustrationContext, illustrationTerrainFromDecor } from './illustrationContext';
import { keepRendererOverride } from './rendererOverride';
import { isFantasyStyle, prepareFantasyTerrain, registerFantasyBrushes } from '../../../rust/bridge/fantasyTerrain';
import { fantasyLibraries } from '../render/fantasyBrushAssets';
import { drawFantasyRaster, fantasyClearance, fantasyRasterImages, prepareFantasyRaster, KEEP_NONE, type FantasyRaster } from './fantasyRaster';
import { cityFocusView, extentRadius, framedEdgeMargin } from './cityPlacementRule';

declare global { interface Window { magnaCityBackground?: { url(): string | undefined; style(): string } } }

/**
 * City Bench: one city on a retained map. The shared terrain renderer and the
 * settlement, road and urban stages all consume the decor raster.
 */
// Composition changes refresh both views synchronously, before the async background paint.
// Register page-owned brushes before either view can prepare illustrated terrain.
registerFantasyBrushes(fantasyLibraries);
installExecutionProfile(document.querySelector('header')!);
const ns = 'http://www.w3.org/2000/svg';
const query = new URLSearchParams(location.search);
const labels = true;
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const map = document.getElementById('map') as unknown as SVGSVGElement, viewport = el('viewport'), stages = document.querySelector('.stages')!;
let decor: Decor | undefined, terrain: TerrainData | undefined, ready = false, lastExport: Decor | undefined;
let view: View = { cx: 0, cy: 0, scale: 1 };
let rpgPins: ReturnType<typeof mountCityRpgPins> | undefined;
const status = (text: string): void => { el('status').textContent = text; };

// The background sits under every overlay the stages add to the map.
const background = document.createElementNS(ns, 'g'); background.id = 'cityBackground'; map.append(background);
const contours = document.createElementNS(ns, 'g'); contours.id = 'cityContours'; contours.setAttribute('pointer-events', 'none'); map.append(contours);
// Exact banks above the rural raster clearance: its cell edges must never become a pale night shoreline.
const nightWater = document.createElementNS(ns, 'g'); nightWater.id = 'cityNightWater'; nightWater.setAttribute('pointer-events', 'none'); map.append(nightWater);
let shownContours: CityContourPaths | undefined, contourTerrain: TerrainData | undefined;
let contourScale = NaN, contourStyle = '';
el<HTMLInputElement>('showContours').checked = query.get('contours') !== '0';
// Situation pins stay above every stage overlay (re-appended after each view change).
const pinLayer = document.createElementNS(ns, 'g'); pinLayer.id = 'cityPins';
function showView(): void {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  map.setAttribute('viewBox', `${view.cx - w / 2 / view.scale} ${view.cy - h / 2 / view.scale} ${w / view.scale} ${h / view.scale}`);
  syncNightWater();
  drawContours(); groundRenderer?.setView(view, w, h); drawFantasyGround();
  settlements.updateView(); publishBenchCapabilities();
  rpgPins?.draw();
  drawPins();
  syncBenchAnnotations(map, view, w, h, { title: decor?.meta.label ?? '', subtitle: decor ? `${(decor.raster.width / 1000).toFixed(1)} km · ${decor.meta.seed}` : '', landuse: settlements.landuse, scenes: settlements.urban.semanticScenes, world: benchSettlementTextWorld(settlements.illustrationSettlements, rpgPins?.world) });
}
function setView(next: View): void { view = terrain ? clampView(next, terrain.width, viewport.clientWidth, viewport.clientHeight) : next; showView(); }
const fit = (): void => { if (terrain) setView(fitView(terrain.width, viewport.clientWidth, viewport.clientHeight)); };

type BackgroundStyle = TerrainStyle;
const isBackgroundStyle = (value: string | null): value is BackgroundStyle => isTerrainStyle(value);
let backgroundStyle: BackgroundStyle = resolveBenchAppearance().composition.variant;
let backgroundTicket = 0, backgroundSnapshot: string | undefined, backgroundKey = '', backgroundDecor: Decor | undefined, uploadedBackground: TerrainData | undefined;
const groundCanvas = el<HTMLCanvasElement>('gl');
let groundRenderer: TerrainRenderer | undefined;
let backgroundLook: TerrainLook | undefined;
const groundReady = createTerrainRenderer(groundCanvas).then(renderer => { groundRenderer = renderer; viewport.classList.add('gl'); }, error => { groundCanvas.hidden = true; status(String(error)); });
/** Illustrated ground, the V2 path (web/src/ui/fantasyRaster.ts): the wash, the crisp field strips and the stamps painted on
 * canvas per view over the terrain SVG. The rural land use lives in it (fields, meadows, orchards, woods): no vector polygons. */
let fantasyGround: { raster: FantasyRaster; svg: string; water: string; width: number; snapshot?: string } | undefined;
/** Wash and fields under the retained water, stamps over it (V2 order): two view canvases around one water group. */
const fantasyLayer = (id: string) => { const host = document.createElementNS(ns, 'foreignObject'), canvas = document.createElement('canvas'); host.id = id; host.setAttribute('pointer-events', 'none'); canvas.style.display = 'block'; host.append(canvas); return { host, canvas }; };
const fantasyWash = fantasyLayer('cityFantasyWash'), fantasyStamps = fantasyLayer('cityFantasyStamps'), fantasyWater = document.createElementNS(ns, 'g');
fantasyWater.id = 'cityFantasyWater'; fantasyWater.setAttribute('pointer-events', 'none');
function drawFantasyGround(): void {
  const f = fantasyGround; if (!f || fantasyStamps.host.parentNode !== background) return;
  const w = viewport.clientWidth, h = viewport.clientHeight, dpr = window.devicePixelRatio || 1, ww = w / view.scale, wh = h / view.scale, x0 = view.cx - ww / 2, y0 = view.cy - wh / 2;
  const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr)), k = view.scale * dpr, rect = { minX: x0, minY: y0, maxX: x0 + ww, maxY: y0 + wh };
  for (const [{ host, canvas }, wash] of [[fantasyWash, true], [fantasyStamps, false]] as const) {
    host.setAttribute('x', String(x0)); host.setAttribute('y', String(y0)); host.setAttribute('width', String(ww)); host.setAttribute('height', String(wh));
    canvas.style.width = `${ww}px`; canvas.style.height = `${wh}px`;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch); ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    if (wash) drawFantasyRaster(ctx, f.raster, rect, k, KEEP_NONE); else drawFantasyRaster(ctx, f.raster, rect, k, undefined, false);
  }
}
/** Stamp anchors stay out of the regional roads, the retained rivers and the farmsteads (V2: fantasyClearance). */
let fantasyClearOf: { decor: Decor; landuse: unknown; streets: unknown; value: ReturnType<typeof fantasyClearance> } | undefined;
function benchFantasyClearance(d: Decor): ReturnType<typeof fantasyClearance> {
  const landuse = settlements.landuse, streets = settlements.urban.regionalStreets;
  if (fantasyClearOf?.decor === d && fantasyClearOf.landuse === landuse && fantasyClearOf.streets === streets) return fantasyClearOf.value;
  const segments = forestRetainedRiverSegments(d.meta.waterSvg, d.raster.width), rivers: { path: { x: number; y: number }[]; width: number[] }[] = [];
  if (segments) for (let i = 0; i + 8 < segments.length; i += 9) rivers.push({ path: [{ x: segments[i], y: segments[i + 1] }, { x: segments[i + 2], y: segments[i + 3] }], width: [segments[i + 4], segments[i + 5]] });
  const water = forestRetainedWater(d.meta.waterSvg, d.raster.width, { x: 0, y: 0, width: d.raster.width, resolution: d.raster.n }, true, terrain?.waterSurface);
  const input = { mapSize: d.raster.width, seed: d.meta.seed, water, roads: streets.map(s => ({ path: s.path, width: Math.max(3, ...s.widths) })), rivers, farmsteads: landuse?.farmsteads };
  fantasyClearOf = { decor: d, landuse, streets, value: fantasyClearance(input) };
  return fantasyClearOf.value;
}
/** The 3D map ground of an Illustrated style: the terrain SVG, then the wash and all the stamps draped (as V2's backgroundUrl). */
const backgroundUrl = (): string | undefined => {
  const f = fantasyGround; if (!f) return backgroundSnapshot;
  if (!f.snapshot) {
    const frame = f.raster.painting.frame!, images = fantasyRasterImages(f.raster), at = `x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.width}" preserveAspectRatio="none"`;
    f.snapshot = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 ${f.width} ${f.width}">${f.svg}<image ${at} href="${images.wash}"/>${f.water}<image ${at} href="${images.stamps}"/></svg>`)}`;
  }
  return f.snapshot;
};
/** Rural land use and contours of the 3D map ground, painted per tile at tile resolution over the snapshot. */
let drapedGround: { key: string; contours?: { thin: Path2D; index: Path2D; color: string } } | undefined;
function drapedPhysicalGround(): import('./city3d').City3dPhysicalGround | undefined {
  const draped = drapedGround; if (!draped) return;
  return { key: draped.key, keepsWater: true, paint: (target, box) => {
    const ctx = target.getContext('2d')!, width = box.maxX - box.minX, k = target.width / width;
    settlements.drawRuralGround(ctx, { x: box.minX, y: box.minY, width }, target.width);
    const lines = draped.contours;
    if (lines) {
      ctx.save(); ctx.setTransform(k, 0, 0, k, -box.minX * k, -box.minY * k); ctx.strokeStyle = lines.color; ctx.lineJoin = ctx.lineCap = 'round';
      ctx.globalAlpha = .4; ctx.lineWidth = .7 / k; ctx.stroke(lines.thin);
      ctx.globalAlpha = .5; ctx.lineWidth = 1.2 / k; ctx.stroke(lines.index);
      ctx.restore();
    }
    return !!settlements.landuse || !!lines;
  } };
}
/** Seasonal water regime of the retained banks: the decor's climate zone and the render's season (waterRegime.ts). */
function retainedWaterSeason(d: Decor, r: ReturnType<typeof resolveBenchAppearance>): WaterSeason {
  return { zone: decorClimateZone(d.meta), season: r.ground.season, calendar: r.ground.calendar };
}
/** The 2D map's retained water (same banks, style and colour as groundRenderer.setRetainedWater) for every 3D ground. */
let retained3d: { decor: Decor; key: string; water: City3dRetainedWater | undefined } | undefined;
function retainedWater3d(): City3dRetainedWater | undefined {
  if (!decor) return;
  const r = resolveBenchAppearance({}, 'view3d'), c = r.composition;
  if (!c.networks.water.visible) return;
  const style = c.networks.water.look === 'ink' ? r.palette.mapStyle : c.variant, season = retainedWaterSeason(decor, r);
  const key = JSON.stringify([style, r.ground.lakes, r.palette.colors, season]);
  if (retained3d?.decor !== decor || retained3d.key !== key) {
    retained3d = { decor, key, water: decorWater3d(decor, style, r.ground.lakes, r.palette.colors, season) };
  }
  return retained3d.water;
}
window.magnaCityBackground = { url: backgroundUrl, style: () => backgroundStyle };
let forestOf: Decor | undefined, forestKey = '', forestField: ForestField | undefined, occupationOf: unknown, occupationStreets: unknown, occupation: ReturnType<typeof forestOccupation>;
const lakeMasks = new WeakMap<Decor, Float32Array>();
type BenchForestRequest = { d: Decor; key: string; settings: ReturnType<typeof resolveBenchAppearance>['vegetation']['forestSettings']; clearingProfile: ReturnType<typeof resolveBenchAppearance>['traits']['forestClearingProfile'] };
let forestBuild: { d: Decor; key: string; job: Promise<void> } | undefined;
function benchForestRequest(target: 'view2d' | 'view3d'): BenchForestRequest | undefined {
  const r = resolveBenchAppearance({}, target), d = decor; if (!d || !r.composition.vegetation.procedural || !r.vegetation.forestSettings.enabled || target === 'view2d' && !r.ground.layers.relief) return;
  const settings = { ...cityForestSettings(new URLSearchParams(d.meta.query)), ...r.vegetation.forest };
  return { d, key: JSON.stringify([settings, r.traits.forestClearingProfile]), settings, clearingProfile: r.traits.forestClearingProfile };
}
function benchForestResult() {
  // Regional roads clear the forest as on V2 (displayForest.ts): no trunk in the corridor, crowns overhang its edges.
  const streets = settlements.urban.regionalStreets;
  if (occupationOf !== settlements.landuse || occupationStreets !== streets) {
    occupationOf = settlements.landuse; occupationStreets = streets;
    const corridors = streets.filter(s => s.path.length > 1).map(s => roadCorridor(s.path, Math.max(3, ...s.widths)));
    occupation = settlements.landuse ? withLandDetail(forestOccupation(settlements.landuse, undefined, undefined, corridors), settlements.landuse, settlements.landCultures) : undefined;
  }
  return { field: forestField, occupation };
}
/** The forest field is Rust (native or WASM): built asynchronously, one build per (decor, settings). */
async function benchForestAsync(target: 'view2d' | 'view3d' = 'view2d') {
  const q = benchForestRequest(target); if (!q) return;
  if (forestOf !== q.d || forestKey !== q.key) {
    if (!(forestBuild && forestBuild.d === q.d && forestBuild.key === q.key)) {
      const raster = q.d.raster, climate = decorClimate(q.d.meta);
      const build: NonNullable<typeof forestBuild> = { d: q.d, key: q.key, job: buildForestField(cityForestInput(q.d.meta.seed, climate, { x: 0, y: 0, width: raster.width, n: raster.n, data: raster.height }, raster.water, { riverSegments: forestRetainedRiverSegments(q.d.meta.waterSvg, raster.width), clearingProfile: q.clearingProfile }), q.settings)
        .then(field => { if (forestBuild === build) { forestOf = q.d; forestKey = q.key; forestField = field; } }).finally(() => { if (forestBuild === build) forestBuild = undefined; }) };
      forestBuild = build;
    }
    await forestBuild!.job;
    if (forestOf !== q.d || forestKey !== q.key) return;
  }
  return benchForestResult();
}
/** Sync render callback: the cached field, else a build whose completion redraws the 3D view. */
function benchForest(target: 'view2d' | 'view3d' = 'view2d') {
  const q = benchForestRequest(target); if (!q) return;
  if (forestOf === q.d && forestKey === q.key) return benchForestResult();
  void benchForestAsync(target).then(() => city3d.refresh(), error => console.warn('Forest field failed:', error));
}
function publishBenchCapabilities(): void {
  const diagnostic = resolveBenchAppearance().diagnostic;
  const limitations: Limitation[] = [{ pass: 'ground', kind: 'data', field: 'resourcePotential', reason: 'This bench has no retained resource diagnostics.' }];
  if (diagnostic !== 'none' && diagnostic !== 'elevation') limitations.push({ pass: 'ground', kind: 'data', field: 'diagnostic', reason: diagnostic.startsWith('res-') ? 'This bench has no retained resource diagnostics.' : 'This bench has no retained data for the selected diagnostic.' });
  if (!decor) limitations.push({ pass: 'ground', kind: 'data', reason: 'No terrain raster in the retained products.' });
  if (!groundRenderer && getBenchComposition().vegetation.look === 'procedural-canopy' && !styleTraits(backgroundStyle).ground3d) limitations.push({ pass: 'vegetation', kind: 'backend', reason: 'The raster backend cannot compose procedural canopy on map grounds.' });
  limitations.push({ pass: 'networks', kind: 'data', field: 'oxbows', reason: 'No retained oxbow geometry in this bench.' }, ...benchVegetationLimitations(city3d.active));
  if (city3d.active && resolveBenchAppearance().composition.buildings.meshes === 'none' && settlements.urban.buildingProjection && !settlements.urban.buildingState.scene) limitations.push({ pass: 'buildings', kind: 'backend', reason: 'The 3D bench cannot drape footprints from retained building projections.' });
  setBenchRenderCapabilities({ nativeTerrain: !!terrain, nativeCities: !!settlements.urban.layouts?.length, buildings: !!settlements.urban.buildingState.scene?.buildings.length || !!settlements.urban.buildingProjection, parcels: !!settlements.urban.partitions?.length, ruralLanduse: !!settlements.landuse, urbanLanduse: !!settlements.urban.layouts?.length, limitations }, city3d.active ? 'view3d' : 'view2d');
}

function contoursReady(): void { contourScale = NaN; drawContours(); }
function drawContours(): void {
  const r = resolveBenchAppearance(), visible = r.ground.contours && (r.ground.layers.relief || r.composition.recipe.ground.variant === 'topographic');
  contours.style.display = visible ? '' : 'none';
  if (!visible || !terrain || !decor) return;
  if (contourTerrain === terrain && contourScale === view.scale && contourStyle === backgroundStyle) return;
  if (contourTerrain !== terrain) {
    // The retained wet cells include rivers above sea level; contours stay on dry ground.
    const { n, water, width } = decor.raster, pixels = new Uint8Array(n * n * 4).fill(255);
    for (let i = 0; i < water.length; i++) pixels[i * 4 + 3] = water[i] ? 0 : 255;
    const mask = pngDataUrl(encodePng(pixels, n, n, 4, 1));
    contours.innerHTML = `<defs><mask id="cityContourLand" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${width}" style="mask-type:alpha"><image width="${width}" height="${width}" href="${mask}"/></mask></defs><g class="layer-contours" mask="url(#cityContourLand)" fill="none" stroke-linejoin="round" stroke-linecap="round"><path vector-effect="non-scaling-stroke"/><path vector-effect="non-scaling-stroke"/></g>`;
    contourTerrain = terrain; shownContours = undefined;
  }
  const paths = cityContourPaths(terrain, new URLSearchParams(decor.meta.query).get('relief') ?? 'flat', view.scale, r.composition.recipe.ground.variant === 'topographic', contoursReady);
  const layer = contours.querySelector('g')!, [thin, index] = Array.from(layer.querySelectorAll('path'));
  if (shownContours !== paths) { thin.setAttribute('d', paths.thin); index.setAttribute('d', paths.index); shownContours = paths; }
  const style = r.composition.variant, pal = terrainStyle(style, getBenchRenderColors()).palette, widths = terrainContourWidths(style, view.scale);
  layer.setAttribute('stroke', pal.contour); contours.dataset.step = String(paths.step);
  thin.setAttribute('stroke-width', String(widths.thin)); thin.setAttribute('opacity', '0.4');
  index.setAttribute('stroke-width', String(widths.index)); index.setAttribute('opacity', '0.5');
  contourScale = view.scale; contourStyle = backgroundStyle;
}

let nightWaterKey = '';
function syncNightWater(): void {
  if (!decor || !terrain) return;
  const d = decor, t = terrain, r = resolveBenchAppearance(), c = r.composition;
  const key = `${d.meta.id}:${r.keys.water}:${c.ambience}:${r.ground.traits.family}`;
  if (nightWaterKey === key) return; nightWaterKey = key;
  nightWater.replaceChildren();
  if (c.ambience === 'night' && c.networks.water.visible) {
    const ink = r.ground.traits.family === 'map', width = t.width;
    const banks = decorWaterSvg(d, 'night', r.ground.lakes, r.palette.colors).replace(/<image\b[^>]*\/>/g, '')
      .replace(/\bfill="#[a-fA-F0-9]{3,8}"/g, 'fill="url(#city-night-water)"')
      .replace(/<path\b/g, `<path stroke="${ink ? '#293e55' : '#111f30'}" stroke-width="2" stroke-linejoin="round"`);
    nightWater.innerHTML = `<defs><linearGradient id="city-night-water" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${width * .38}" y2="${width * .17}" spreadMethod="reflect"><stop stop-color="${ink ? '#253c57' : '#0b192a'}"/><stop offset=".42" stop-color="${ink ? '#2b4460' : '#101f30'}"/><stop offset=".55" stop-color="${ink ? '#3b5670' : '#253a50'}"/><stop offset=".7" stop-color="${ink ? '#2b4460' : '#101f30'}"/><stop offset="1" stop-color="${ink ? '#253c57' : '#0b192a'}"/></linearGradient></defs>${banks}`;
  }
}

/** Draw the retained raster with the same ground and canopy renderer as Terrain Bench. */
async function drawBackground(d: Decor): Promise<void> {
  const ticket = ++backgroundTicket; await groundReady; if (ticket !== backgroundTicket || decor !== d || !terrain) return;
  setMapClimateZone(decorClimateZone(d.meta), decorClimate(d.meta));
  const r = resolveBenchAppearance(), c = r.composition, t = terrain, climate = decorClimate(d.meta), q = new URLSearchParams(d.meta.query);
  const key = `${r.keys.terrainLook}:${r.keys.water}:${c.vegetation.look}:${r.keys.forest}:${settlements.ruralGroundRevision}`;
  // Automated shots wait for data-ground-applied to equal data-ground-wanted.
  viewport.dataset.groundWanted = key;
  if (backgroundDecor === d && backgroundKey === key) return;
  backgroundStyle = c.variant; const relief = q.get('relief') ?? 'flat';
  syncNightWater();
  const settings = { seed: d.meta.seed, width: t.width, relief: relief as TerrainSettings['relief'], climateValues: climate, climateZone: decorClimateZone(d.meta) };
  const canopy = await benchForestAsync();
  if (ticket !== backgroundTicket || decor !== d) return;
  // Illustrated: the V2 path. The land-use classes (occupation and holdings detail) and the clearances drive the brushes;
  // the SVG keeps the ground, the wash, fields and stamps are painted on canvas (drawFantasyGround).
  const fantasyStyle = r.ground.traits.fantasy && isFantasyStyle(r.ground.style) && r.ground.layers.relief ? r.ground.style : undefined;
  const forest = r.ground.traits.ground3d && canopy ? { ...canopy, brushes: r.ground.traits.forestBrushes, waterVisible: c.networks.water.visible,
    water: forestRetainedWater(d.meta.waterSvg, t.width, t, r.ground.lakes, t.waterSurface) }
    : fantasyStyle ? { field: canopy?.field, occupation: benchForestResult().occupation, parcels: settlements.landuse?.areas, waterVisible: c.networks.water.visible, clear: benchFantasyClearance(d) } : undefined;
  const fantasyOptions = fantasyStyle ? { ...r.vegetation.fantasy, svgStamps: false } : r.vegetation.fantasy;
  const renderSettings = { ...settings, v2Season: r.ground.season, v2Calendar: r.ground.calendar, forest };
  const painting = fantasyStyle ? prepareFantasyTerrain(t, fantasyStyle, renderSettings, fantasyOptions) : undefined;
  const fantasyRaster = painting ? await prepareFantasyRaster(painting, settlements.landuse) : undefined;
  // Contours come from the contour worker: wait for them before the ticket check, as the other inputs.
  const contourPaths = r.ground.contours && r.ground.layers.relief ? await cityContourPathsReady(t, relief, 2048 / t.width, false) : undefined;
  if (ticket !== backgroundTicket || decor !== d) return;
  // The key is retained only by the call that applies it: retained before the await, a newer call with the same key
  // returned early while this one was superseded, and the look was never applied (v7: "satellite" shots drawn in parchment).
  backgroundDecor = d; backgroundKey = key;
  const scene = renderRustTerrain(t, r.ground.style, true, renderSettings, false, 'city-ground', r.ground.lighting, r.ground.layers, fantasyOptions, true, r.composition.networks.water.look === 'ink' ? r.palette.mapStyle : 'render3d', r.palette.colors);
  if(c.ambience==='night' && r.ground.traits.family==='material')scene.svg=moonlightSvg(scene.svg,'city-ground-night');
  // The rural land use and the contours are vector layers painted per 3D tile (drapedGround): baked into this 2048 px
  // snapshot they were magnified into pixel staircases on every close 3D view.
  drapedGround = { key, contours: contourPaths && { thin: new Path2D(contourPaths.thin), index: new Path2D(contourPaths.index), color: terrainStyle(c.variant, r.palette.colors).palette.contour } };
  backgroundSnapshot = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 ${t.width} ${t.width}">${scene.svg}</svg>`)}`;
  if (groundRenderer && !r.ground.traits.fantasy) {
    groundCanvas.hidden = false; background.replaceChildren();
    const field = t.field!;
    if (uploadedBackground !== t) { groundRenderer.setBase({ x: 0, y: 0, width: t.width, n: field.n, data: field.data, cave: field.cave, waterSurface: t.waterSurface }); uploadedBackground = t; }
    groundRenderer.setForest(canopy?.field, canopy?.occupation);
    backgroundLook={ style: r.ground.style, ambience:c.ambience,waterLook:c.networks.water.look,waterStyle: c.networks.water.look === 'ink' ? r.palette.mapStyle : r.ground.style, independentCanopy: c.vegetation.procedural,
      colors: r.palette.colors, mapWidth: t.width, lighting: r.ground.lighting, layers: r.ground.layers, globalMin: t.globalMinHeight, globalMax: t.globalMaxHeight,
      contours: false, contourStep: 1, flatRelief: relief === 'flat', refine: d.meta.terrainDisplay?.refine !== false, sourceCell: d.meta.terrainDisplay?.sourceCell ?? t.width / field.n,
      seed: seedHash(d.meta.seed), detail: DEFAULT_FRACTAL_DETAIL, floor: field.floor ?? 0, frame: r.ground.layers.frame, background: terrainStyle(c.variant, r.palette.colors).palette.paper, climate, climateZone: settings.climateZone, v2Season: r.ground.season, v2Calendar: r.ground.calendar };
    groundRenderer.setLook(backgroundLook);
    groundRenderer.setRetainedWater(c.networks.water.visible ? decorWaterSvg(d, c.networks.water.look === 'ink' ? r.palette.mapStyle : c.variant, r.ground.lakes, r.palette.colors) : '', t.width, { season: retainedWaterSeason(d, r), city: true });
    groundRenderer.setView(view, viewport.clientWidth, viewport.clientHeight);
  } else {
    groundCanvas.hidden = true; background.innerHTML = scene.svg;
    // The retained rivers and lakes pass over the wash, as on V2 (the wash would hide a river baked into the ground image).
    const water = fantasyRaster && c.networks.water.visible ? decorWaterSvg(d, c.networks.water.look === 'ink' ? r.palette.mapStyle : 'render3d', r.ground.lakes, r.palette.colors) : '';
    fantasyGround = fantasyRaster && { raster: fantasyRaster, svg: scene.svg, water, width: t.width };
    if (fantasyGround) {
      fantasyWater.innerHTML = water; background.append(fantasyWash.host, fantasyWater, fantasyStamps.host);
      fantasyRaster!.onTiles = () => { if (fantasyGround?.raster === fantasyRaster) drawFantasyGround(); }; drawFantasyGround();
    }
  }
  if (!fantasyRaster) fantasyGround = undefined;
  drawContours(); publishBenchCapabilities(); city3d.refresh();
  viewport.dataset.groundApplied = key;
}

window.addEventListener('bench-render-colors-change', () => { contourStyle = ''; if (decor) void drawBackground(decor); drawContours(); save(); city3d.refresh(); });
window.addEventListener('bench-composition-change', () => {
  if(benchMaterialNightChange() && groundRenderer && backgroundLook){backgroundLook={...backgroundLook,ambience:resolveBenchAppearance().composition.ambience};groundRenderer.setLook(backgroundLook);showView();city3d.refresh();save();return;}
  if (benchOverlayChange()) { showView(); city3d.refresh(); save(); return; } contourStyle = ''; if (decor) void drawBackground(decor); showView(); save(); city3d.refresh();
});
function shareQuery(): string {
  const params = new URLSearchParams(); writeRenderColorsQuery(params, getBenchRenderColors()); writeBenchCompositionQuery(params); if (decor) params.set('artifact', decor.meta.id);
  settlements.share(params);
  rpgPins?.share(params);

  params.set('contours', el<HTMLInputElement>('showContours').checked ? '1' : '0');
  return applyExecutionProfile(new URL(`?${params}`, location.href)).searchParams.toString();
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const url = new URL(location.href); url.search = shareQuery(); if (query.get('standalone') === '1') url.searchParams.set('standalone', '1');
    keepRendererOverride(url.searchParams);
    try { history.replaceState(null, '', url); syncBenchUrl(); } catch { /* file:// may refuse replaceState. */ }
  }, 150);
}

// Catalogue first, then the stages, then the local history of kept exports.
const anchor = document.createElement('div'); stages.append(anchor);
createTerrainDecorLibrary({ before: anchor, city: true, onOpen: d => openBench('city', new URLSearchParams({ artifact: d.meta.id })) });
const settlements = createTerrainSettlements({ map, viewport, city: true, active: true, parcelDefault: false, labels,
  getForestSource: () => {
    if (!decor) return undefined;
    const r = decor.raster, climate = decorClimate(decor.meta), q = new URLSearchParams(decor.meta.query);
    return { key: `${decor.meta.id}:${decor.meta.query}`, input: cityForestInput(decor.meta.seed, climate, { x: 0, y: 0, width: r.width, n: r.n, data: r.height }, r.water,
      { riverSegments: forestRetainedRiverSegments(decor.meta.waterSvg, r.width) }), settings: cityForestSettings(q) };
  },
  getTerrain: () => terrain,
  getSettings: () => ({ seed: decor?.meta.seed ?? '', width: decor?.raster.width ?? 0, relief: new URLSearchParams(decor?.meta.query).get('relief') ?? 'flat' }) as TerrainSettings,
  getRaster: () => decor?.raster, getBiome: () => decor && decorBiome(decor.meta), getDecor: () => decor, getView: () => view, getAuto: () => false, getQuery: shareQuery,
  onPlanChange: () => queueMicrotask(() => { publishBenchCapabilities(); showView(); if (decor) void drawBackground(decor); city3d.refresh(); }),
  onChange: () => queueMicrotask(() => { save(); city3d.refresh(); rpgPins?.draw(); publishBenchCapabilities(); showView(); if (decor) void drawBackground(decor); }), onPicking: () => {},
  onFocus: (center, radius) => city3d.active ? city3d.focus(center, radius) : setView(cityFocusView({ center, radius }, viewport.clientWidth, viewport.clientHeight)),
  onProjection: active => { setProjection(active); return city3d.active; },
});
// Legend and cartouche of the 3D view: the same plain panels as the 2D map, with the visible semantic classes (rural and urban).
provideFurniture3d(viewport, () => {
  if (!decor) return;
  const r = resolveBenchAppearance({}, 'view3d'), s = r.composition.landuse;
  return { bench: { title: decor.meta.label ?? '', subtitle: `${(decor.raster.width / 1000).toFixed(1)} km · ${decor.meta.seed}` }, palette: terrainStyle(r.composition.variant, r.palette.colors).palette,
    legend: r.cartography.legend, cartouche: r.cartography.cartouche, semantic: [...ruralSemanticLegend(settlements.landuse, s.classes, s.rural), ...urbanSemanticLegend(settlements.urban.semanticScenes, s.urban)] };
});
// 3D view (city3d.ts): the decor relief draped with the map image, the plan and the buildings in volume.
const city3d = mountCity3d({ getText: () => benchTextLayer(benchSettlementTextWorld(settlements.illustrationSettlements, rpgPins?.world)), host: viewport, labels, materialGrounds: true, getDecor: () => decor, getScene: () => settlements.urban.buildingState.scene,
  getProjection: () => settlements.urban.buildingProjection,
  getLotEnclosures: () => settlements.urban.lotEnclosures,
  getLayouts: () => settlements.urban.layouts, getRegionalStreets: () => cityRegionalStreets(resolveBenchAppearance({}, 'view3d'), settlements.urban.regionalStreets), getPartitions: () => settlements.urban.partitions, getSelected: () => { const s = settlements.urban.buildingState; return s.parentSelected?.kind === 'member' ? s.parentSelected.member_id : s.selected; }, getTextured: () => settlements.urban.textured, setTextured: on => settlements.urban.setTextured(on),
  details: settlements.urban.buildingDetails, getBuildingAppearance: () => { const r = resolveBenchAppearance({}, 'view3d'); return { ...settlements.urban.buildingState.appearance, colors: r.palette.colors, style: r.city.buildingStyle, diagnostic: r.city.diagnostic, ambience: r.composition.ambience }; },
  getBackground: backgroundUrl,
  getPhysicalGround: material => material ? undefined : drapedPhysicalGround(),
  getRetainedWater: retainedWater3d,
  getLook: () => cityGroundLook(resolveBenchAppearance({}, 'view3d')),
  getBuildingsVisible: () => { const b = resolveBenchAppearance({}, 'view3d').composition.buildings; return b.visible && b.meshes !== 'none'; },
  getForest: () => benchForest('view3d'),
  getSurface: () => {
    if (!decor) return;
    const raster = decor.raster, r = resolveBenchAppearance({}, 'view3d'); let mask = lakeMasks.get(decor);
    if (!mask) { mask = Float32Array.from(raster.water, value => value === 2 ? 1 : -1); lakeMasks.set(decor, mask); }
    return { height: { x: 0, y: 0, width: raster.width, n: raster.n, data: raster.height }, water: r.ground.lakes ? { n: raster.n, mask, levels: raster.waterLevel } : undefined, waterVisible: r.composition.networks.water.visible };
  },
  getSemantic: () => { const s = resolveBenchAppearance({}, 'view3d').composition.landuse; return { landuse: settlements.landuse, cultures: settlements.landCultures, ...s }; },
  getViewSettings: () => { const r = resolveBenchAppearance({}, 'view3d'); return { ground: r.city.ground as import('./city3d').City3dGround, plan: r.city.plan, colors: r.city.colors, exaggeration: r.city.exaggeration, refinement: r.city.refinement }; },
  onViewSettingsChange: value => { if (value.ground !== resolveBenchAppearance({}, 'view3d').city.ground) setBenchComposition(withGroundVariant(getBenchComposition(), value.ground === 'map' ? 'parchment' : value.ground === 'render' ? 'render3d' : value.ground)); for (const key of ['plan', 'colors', 'exaggeration', 'refinement'] as const) setBenchAppearanceField(`city.${key}`, value[key]); },
  getGroundSettings: ground => {
    if (!decor) return;
    return cityGroundSettings(resolveBenchAppearance({}, 'view3d'), ground, { seed: decor.meta.seed, climate: decorClimate(decor.meta),
      climateZone: decorClimateZone(decor.meta), sourceCell: decor.meta.terrainDisplay?.sourceCell ?? decor.raster.width / decor.raster.n,
      relief: new URLSearchParams(decor.meta.query).get('relief') ?? 'mountains' });
  },
  getPlanOptions: () => city3dPlanOptions(resolveBenchAppearance({}, 'view3d'), labels),
  onSelect: id => settlements.urban.selectBuilding(id) });
// Every bench change already calls city3d.refresh(): the furniture follows it instead of polling.
{ const refresh = city3d.refresh.bind(city3d); city3d.refresh = () => { refresh(); refreshFurniture3d(viewport); }; }
const view3d =document.createElement('button'); view3d.type = 'button'; view3d.id = 'view3d'; view3d.setAttribute('aria-pressed', 'false');
el('focusCity').after(view3d);
function setProjection(active: boolean): void {
  if (active) city3d.show(); else city3d.hide();
  view3d.setAttribute('aria-pressed', String(city3d.active)); view3d.textContent = city3d.active ? 'Vue 2D' : 'Vue 3D';
  publishBenchCapabilities();
  view3d.title = city3d.active ? 'Revenir à la carte 2D' : 'Voir la ville et ses maisons en 3D';
}
setProjection(false);
window.dispatchEvent(new Event('bench-space-change'));
view3d.onclick = () => setProjection(!city3d.active);
(window as Window & { magnaCity3d?: typeof city3d }).magnaCity3d = city3d; // Automated checks (stats, capture).
mountIllustration({ host: document.querySelector('header')!, navigation: { getView: () => ({ ...view }), setView }, capture: async () => {
  if (!ready || !decor || !settlements.contextReady()) throw new Error('Chargez une ville et attendez la fin de la génération.');
    const palette = document.querySelector<HTMLSelectElement>('select[data-render="palette"]')?.value;
    const sourceStyle = palette === 'cadastre' || palette === 'parchment' ? palette : backgroundStyle;
    const captured = city3d.active ? await city3d.captureIllustration() : undefined;
    const context = illustrationContext({ sourceStyle, seed: decor.meta.seed, view: { ...view }, camera: captured?.camera,
    width: viewport.clientWidth, height: viewport.clientHeight, settlements: settlements.illustrationSettlements,
    terrain: illustrationTerrainFromDecor(decor.meta),
    buildings: settlements.urban.buildingState.scene, architecture: settlements.urban.buildingState.settings });
  if (captured) {
    return { image: captured.image, guides: { depth: captured.depth }, context };
  }
    const exclude = ['#cityPins', '#mini', '.ruler'];
    const image = await captureViewport(viewport, { exclude });
    // Native roofs and GPU streets are raster layers. Let the connector extract
    // Canny from the complete capture rather than send an incomplete SVG guide.
    const guides = viewport.querySelector('[data-city-canvas]') ? {} : { edges: await captureViewport(viewport, { structural: true, exclude }) };
    return { image, guides, context };
} });
const historyAnchor = document.createElement('div'); stages.append(historyAnchor);
const historyPanel = createHistoryPanel({ before: historyAnchor, current: () => lastExport ?? decor, onOpen: d => openBench('city', new URLSearchParams({ artifact: d.meta.id })) });
anchor.remove(); historyAnchor.remove();
document.querySelector('#benchHistory [data-import]')?.closest('label')?.setAttribute('hidden', '');

// Keep and share the applied city; the footer is docked by benchPanels.
const transfer = document.createElement('details'); transfer.className = 'stage'; transfer.id = 'pipelineTransfer'; transfer.open = true;
transfer.innerHTML = '<summary>Conserver et partager</summary><div class="stage-controls"><button id="pipelineReturn" type="button" hidden>Renvoyer aux settlements</button><button id="pipelineSave" type="button">Conserver cet export</button><button id="pipelineDownload" type="button">Partager .decor</button><small id="pipelineStatus" role="status"></small></div>';
stages.append(transfer);
installUrbanMapExports(transfer.querySelector('.stage-controls')!, map, status, prepareCityMapExport);
rpgPins = mountCityRpgPins({ separateText: true, getText: () => benchTextLayer(), map, viewport, query, labels, host: stages,
  getView: () => view, getLayouts: () => settlements.urban.layouts, getPartitions: () => settlements.urban.partitions,
  focus: setView, onChange: () => { save(); showView(); city3d.refresh(); }, onPinning: () => { pinning = false; el('situationPin').setAttribute('aria-pressed', 'false'); } });
async function keep(download: boolean): Promise<void> {
  try {
    if (settlements.urban.layoutPending || settlements.urban.generationPending) throw new Error('Attendez la fin du calcul du plan et des parcelles.');
    const snapshot = settlements.captureData();
    // Start the browser picker in the button's user activation, before history IO.
    const downloading = download ? downloadDecorFile(snapshot, `${snapshot.meta.id}.decor`).then(() => undefined, error => ({ error })) : undefined;
    const d = await saveHistory(snapshot); lastExport = d; await historyPanel.refresh(d.meta.id);
    const result = await downloading; if (result) throw result.error;
    el('pipelineStatus').textContent = download ? 'Export conservé et téléchargé.' : 'Export conservé dans ce navigateur.';
  } catch (error) { el('pipelineStatus').textContent = error instanceof Error ? error.message : String(error); }
}
/** A city opened from Settlements goes back into its source map, translated out of the crop. */
async function returnToSettlements(): Promise<void> {
  try {
    const parent = decor?.meta.pipeline?.parent, crop = decor?.meta.pipeline?.crop, key = decor?.meta.pipeline?.city;
    if (!decor || !parent || !crop || !key) throw new Error('Cette carte ne vient pas de Settlements.');
    if (settlements.urban.layoutPending || settlements.urban.generationPending) throw new Error('Attendez la fin du calcul du plan et des parcelles.');
    const source = await readHistory(parent).catch(() => undefined);
    if (!source) throw new Error('La carte Settlements d’origine est absente de ce navigateur.');
    const state = settlements.urban.workshopState(), draft = settlements.urban.workshopDraft();
    const saved = await saveHistory({ ...source, meta: { ...source.meta, settlements: applyWorkshopPopulation(source.meta.settlements, state), pipeline: { ...source.meta.pipeline, stage: 'settlements', city: key,
      syncSource: decor.meta.pipeline?.syncSource ?? source.meta.pipeline?.syncSource ?? source.meta.id,
      urbanDraft: draft && workshopSettings(translateWorkshopState(draft, crop.x, crop.y)), urban: mergeCityWorkshop(source.meta.pipeline?.urban, state, key, crop.x, crop.y) } } });
    const params = new URLSearchParams(saved.meta.query); params.delete('view'); params.set('artifact', saved.meta.id);
    params.set('urban', JSON.stringify({ ...workshopSettings(saved.meta.pipeline!.urban!), enabled: true, parcelEnabled: !!state.partitions, target: key }));
    openBench('settlements', params);
  } catch (error) { el('pipelineStatus').textContent = error instanceof Error ? error.message : String(error); }
}
el('pipelineReturn').onclick = () => void returnToSettlements();
el('pipelineSave').onclick = () => void keep(false);
el('pipelineDownload').onclick = () => void keep(true);

// Situation: map, options, camera and pins in one copyable code (or link), to hand
// a reproducible case to someone else or to an agent (web/scripts/city_situation.mjs).
let pins: SituationPin[] = [], pinning = false, situationNote = '';
const situation = document.createElement('details'); situation.className = 'stage'; situation.id = 'citySituation'; situation.open = false;
situation.innerHTML = `<summary>Situation à signaler</summary><div class="stage-controls">
  <small>Copiez un code (ou un lien) qui rouvre exactement cette ville, ce cadrage et vos épingles.</small>
  <div class="settlement-actions"><button id="situationPin" type="button" aria-pressed="false" title="Puis cliquez sur la carte">Épingler un point</button><button id="situationCopy" type="button">Copier le code</button><button id="situationLink" type="button">Copier le lien</button></div>
  <label><span data-situation-label="note">Note générale</span> <textarea id="situationNote" rows="2" placeholder="Ce qui ne va pas…"></textarea></label>
  <ol id="situationPins"></ol>
  <label><span data-situation-label="paste">Coller un code</span> <input id="situationInput" type="text" placeholder="MU2.…" spellcheck="false"></label>
  <div class="settlement-actions"><button id="situationOpen" type="button">Ouvrir ce code</button></div>
  <small id="situationStatus" role="status"></small></div>`;
stages.append(situation);
const situationStatus = (text: string): void => { el('situationStatus').textContent = text; };
function drawPins(): void {
  if (!labels) { pinLayer.replaceChildren(); return; }
  const k = 1 / view.scale;
  pinLayer.replaceChildren(...pins.map((p, i) => {
    const g = document.createElementNS(ns, 'g'); g.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${k})`);
    g.innerHTML = `<path d="M0 0 C -6 -10 -11 -14 -11 -21 A 11 11 0 1 1 11 -21 C 11 -14 6 -10 0 0 Z" fill="#c0392b" stroke="#fff" stroke-width="2"/><text y="-17" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${i + 1}</text>`;
    const title = document.createElementNS(ns, 'title'); title.textContent = p.note || urbanText([`Épingle ${i + 1}`,`Pin ${i + 1}`,`图钉 ${i + 1}`,`Marcador ${i + 1}`,`Marcador ${i + 1}`]); g.append(title);
    return g;
  }));
  if (map.lastChild !== pinLayer) map.append(pinLayer);
}
function listPins(): void {
  const list = el('situationPins'); list.replaceChildren(...pins.map((p, i) => {
    const item = document.createElement('li');
    item.innerHTML = `<small>${Math.round(p.x)}, ${Math.round(p.y)} m</small> <input type="text"> <button type="button">◎</button> <button type="button">×</button>`;
    const note = item.querySelector('input')!, [focus, remove] = Array.from(item.querySelectorAll('button'));
    note.placeholder = urbanText(['Note de l’épingle','Pin note','图钉备注','Nota del marcador','Nota do marcador']); focus.title = urbanText(['Cadrer','Focus','定位','Centrar','Centralizar']); remove.title = urbanText(['Supprimer','Remove','删除','Eliminar','Remover']);
    note.value = p.note; note.oninput = () => { p.note = note.value; drawPins(); };
    focus.onclick = () => setView({ cx: p.x, cy: p.y, scale: Math.max(view.scale, 1.5) });
    remove.onclick = () => { pins.splice(i, 1); listPins(); drawPins(); };
    return item;
  }));
}
function localizeSituation(): void {
  situation.querySelector('summary')!.textContent = urbanText(['Situation à signaler','Report a situation','报告情况','Informar de una situación','Relatar uma situação']);
  situation.querySelector('.stage-controls > small')!.textContent = urbanText(['Copiez un code (ou un lien) qui rouvre exactement cette ville, ce cadrage et vos épingles.','Copy a code or link that reopens this exact city, view and pins.','复制代码或链接，重新打开当前城市、视图和图钉。','Copia un código o enlace que reabra exactamente esta ciudad, vista y marcadores.','Copie um código ou link que reabra exatamente esta cidade, vista e marcadores.']);
  el('situationPin').textContent = urbanText(['Épingler un point','Pin a point','标记位置','Marcar un punto','Marcar um ponto']); el('situationPin').title = urbanText(['Puis cliquez sur la carte','Then click the map','然后点击地图','Después haz clic en el mapa','Depois clique no mapa']);
  el('situationCopy').textContent = urbanText(['Copier le code','Copy code','复制代码','Copiar código','Copiar código']); el('situationLink').textContent = urbanText(['Copier le lien','Copy link','复制链接','Copiar enlace','Copiar link']);
  situation.querySelector('[data-situation-label="note"]')!.textContent = urbanText(['Note générale','General note','总体备注','Nota general','Nota geral']);
  el<HTMLTextAreaElement>('situationNote').placeholder = urbanText(['Ce qui ne va pas…','What is wrong…','问题描述…','Qué falla…','O que está errado…']);
  situation.querySelector('[data-situation-label="paste"]')!.textContent = urbanText(['Coller un code','Paste a code','粘贴代码','Pegar un código','Colar um código']); el('situationOpen').textContent = urbanText(['Ouvrir ce code','Open code','打开代码','Abrir código','Abrir código']);
  for (const item of Array.from(el('situationPins').querySelectorAll('li'))) { const note=item.querySelector('input')!, buttons=item.querySelectorAll('button'); note.placeholder=urbanText(['Note de l’épingle','Pin note','图钉备注','Nota del marcador','Nota do marcador']); buttons[0].title=urbanText(['Cadrer','Focus','定位','Centrar','Centralizar']); buttons[1].title=urbanText(['Supprimer','Remove','删除','Eliminar','Remover']); }
  drawPins();
}
window.addEventListener('magna-locale-change',localizeSituation); localizeSituation();
async function situationCode(): Promise<string> {
  // Execution belongs to whoever reopens the code: never carry a profile or a local port.
  const q = new URLSearchParams(shareQuery()); for (const key of ['profile', 'localServer', 'compute', 'generation']) q.delete(key);
  return encodeSituation({ v: 1, q: q.toString(), view, pins, note: situationNote || undefined });
}
async function copy(text: string, done: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); situationStatus(done); }
  catch { el<HTMLInputElement>('situationInput').value = text; situationStatus(urbanText(['Presse-papiers refusé : le code est dans le champ ci-dessous.','Clipboard denied: the code is in the field below.','剪贴板访问被拒绝：代码位于下方字段。','Acceso al portapapeles denegado: el código está en el campo inferior.','Acesso à área de transferência negado: o código está no campo abaixo.'])); }
}
const localMap = (): boolean => !!decor && !decor.meta.id.startsWith('city-');
el('situationPin').onclick = () => { rpgPins?.cancel(); pinning = !pinning; el('situationPin').setAttribute('aria-pressed', String(pinning)); situationStatus(pinning ? urbanText(['Cliquez sur la carte pour poser l’épingle.','Click the map to place the pin.','点击地图放置图钉。','Haz clic en el mapa para colocar el marcador.','Clique no mapa para colocar o marcador.']) : ''); };
el('situationCopy').onclick = async () => copy(await situationCode(), localMap() ? urbanText(['Code copié. Carte locale : joignez aussi son .decor.','Code copied. For a local map, also attach its .decor file.','代码已复制。本地地图还需附上其 .decor 文件。','Código copiado. Para un mapa local, adjunta también su archivo .decor.','Código copiado. Para mapa local, anexe também o arquivo .decor.']) : urbanText(['Code copié.','Code copied.','代码已复制。','Código copiado.','Código copiado.']));
el('situationLink').onclick = async () => {
  const url = new URL(location.pathname, location.href); url.searchParams.set('situation', await situationCode());
  if (query.get('standalone') === '1') url.searchParams.set('standalone', '1');
  await copy(url.href, urbanText(['Lien copié.','Link copied.','链接已复制。','Enlace copiado.','Link copiado.']));
};
el<HTMLTextAreaElement>('situationNote').oninput = event => { situationNote = (event.target as HTMLTextAreaElement).value; };
el('situationOpen').onclick = async () => {
  try { await openSituation(el<HTMLInputElement>('situationInput').value); } catch (error) { situationStatus(error instanceof Error ? error.message : String(error)); }
};
/** Reload the bench on the situation's query; camera and pins follow through session storage. */
async function openSituation(code: string): Promise<void> {
  const s = await decodeSituation(code);
  try { sessionStorage.setItem('magna-city-situation', JSON.stringify({ view: s.view, pins: s.pins, note: s.note })); } catch { /* Private mode: the options still open. */ }
  const url = new URL(location.pathname, location.href); url.search = s.q;
  if (query.get('standalone') === '1') url.searchParams.set('standalone', '1');
  keepRendererOverride(url.searchParams);
  location.replace(url.href);
}
function restoreSituation(): void {
  let saved: { view?: View; pins?: SituationPin[]; note?: string } | undefined;
  try { saved = JSON.parse(sessionStorage.getItem('magna-city-situation') ?? 'null') ?? undefined; sessionStorage.removeItem('magna-city-situation'); } catch { return; }
  if (!saved && (query.has('situationView') || query.has('situationPins') || query.has('situationNote'))) {
    try { saved = { view: JSON.parse(query.get('situationView') ?? 'null') ?? undefined,
      pins: JSON.parse(query.get('situationPins') ?? '[]'), note: query.get('situationNote') ?? undefined }; } catch { return; }
  }
  if (!saved) return;
  pins = saved.pins ?? []; situationNote = saved.note ?? ''; el<HTMLTextAreaElement>('situationNote').value = situationNote;
  listPins(); if (saved.view) setView(saved.view); drawPins();
  situationStatus(`Situation ouverte · ${pins.length} épingle(s).`);
}

// Navigation: wheel zoom, drag pan; markers and picking are handled by the settlement stage first.
let drag: { x: number; y: number; moved: boolean; pointer: number } | undefined, suppressClick = false;
viewport.addEventListener('wheel', event => {
  event.preventDefault(); const rect = viewport.getBoundingClientRect();
  setView(zoomAt(view, Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height));
}, { passive: false });
viewport.addEventListener('pointerdown', event => {
  if (event.button !== 0 || settlements.isPicking()) return;
  drag = { x: event.clientX, y: event.clientY, moved: false, pointer: event.pointerId };
});
window.addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true; map.classList.add('drag'); drag.x = event.clientX; drag.y = event.clientY; setView(panBy(view, dx, dy));
});
window.addEventListener('pointerup', event => { if (drag?.pointer !== event.pointerId) return; suppressClick = drag.moved; drag = undefined; map.classList.remove('drag'); });
map.addEventListener('click', event => {
  if (suppressClick) { suppressClick = false; event.stopImmediatePropagation(); return; }
  if (rpgPins?.click(event)) { event.stopImmediatePropagation(); return; }
  if (pinning) {
    const rect = viewport.getBoundingClientRect();
    pins.push({ x: view.cx + (event.clientX - rect.left - rect.width / 2) / view.scale, y: view.cy + (event.clientY - rect.top - rect.height / 2) / view.scale, note: '' });
    pinning = false; el('situationPin').setAttribute('aria-pressed', 'false'); situationStatus('Épingle posée : ajoutez une note.');
    listPins(); drawPins(); event.stopImmediatePropagation(); return;
  }
  if (settlements.click(event)) event.stopImmediatePropagation();
}, true);
new ResizeObserver(() => showView()).observe(viewport);
el('fit').onclick = fit;
// The 2D frame is never wider than the near LOD (2.2 m/px): the buildings stay drawn on a big town.
el('focusCity').onclick = () => { const e = settlements.urban.extent; if (e && city3d.active) city3d.focus(e.center, e.radius); else if (e) setView(cityFocusView(e, viewport.clientWidth, viewport.clientHeight)); else fit(); };
// The v7 sheet (web/out/planches-styles-v7/run.mjs) reads the shared placement rule here, as the V2 test hook does.
(window as unknown as { magnaCityPlacement: unknown }).magnaCityPlacement = { framedEdgeMargin, extentRadius };
el<HTMLInputElement>('showBackground').onchange = event => { const visible = (event.target as HTMLInputElement).checked; background.style.display = visible ? '' : 'none'; groundCanvas.style.visibility = visible ? '' : 'hidden'; };
el<HTMLInputElement>('showContours').onchange = () => { drawContours(); save(); };
el<HTMLInputElement>('showPlan').onchange = event => settlements.urban.setPlanVisible((event.target as HTMLInputElement).checked);
el<HTMLSelectElement>('backgroundStyle').value = backgroundStyle;
el<HTMLSelectElement>('backgroundStyle').onchange = event => {
  const value = (event.target as HTMLSelectElement).value; if (!isBackgroundStyle(value)) return;
  backgroundStyle = value; drawContours(); save();
  // The city layer reads it for its bridges (stone decks on the Rendu background).
  document.documentElement.dataset.cityBackground = backgroundStyle; settlements.updateView();
  if (decor) void drawBackground(decor);
};
document.documentElement.dataset.cityBackground = backgroundStyle;
map.addEventListener('urban:v1-style', event => {
  if ((event as CustomEvent).detail.active && city3d.active) setProjection(false);
});
el<HTMLInputElement>('backgroundOpacity').oninput = event => { background.setAttribute('opacity', (event.target as HTMLInputElement).value); groundCanvas.style.opacity = (event.target as HTMLInputElement).value; };

/** An export of this browser, otherwise the catalogue file of the same id. */
async function load(id: string): Promise<Decor> {
  try { return await readHistory(id); } catch {
    const response = await fetch(`decors/${id}.decor`); if (!response.ok) throw new Error(`Carte introuvable : ${id}`);
    return saveHistory(await readDecorFile(await response.blob()), false);
  }
}
const artifact = query.get('artifact'), sharedSituation = query.get('situation');
if (sharedSituation) void openSituation(sharedSituation).catch(error => { status(String(error)); ready = true; });
else if (artifact) {
  status('Chargement de la carte…');
  void Promise.all([load(artifact), loadRenderGeometry()]).then(async ([d]) => { // drawing needs the render-geometry WASM
    decor = d; lastExport = d; terrain = terrainFromDecor(d);
    el('pipelineReturn').hidden = !(d.meta.pipeline?.parent && d.meta.pipeline.crop && d.meta.pipeline.city);
    fit(); await drawBackground(d);
    settlements.restoreDecor(d);
    if (el('status').textContent === 'Chargement de la carte…') status(`${d.meta.label.replace(/ · jusqu’à [^·]* hab\.$/, '')} · ${(d.raster.width / 1000).toFixed(0)} km`);
    save(); restoreSituation();
  }).catch(error => status(String(error))).finally(() => { ready = true; });
} else { ready = true; void loadRenderGeometry().then(showView); }
installRecipeSharing({ host: document.querySelector('header')!, capture: async () => {
  if (!decor || !ready) throw new Error('Attendez le chargement du terrain.');
  return generationRecipe('city', shareQuery(), decor);
} });
window.magnaBenchContext = { ready: () => ready, capture: () => ({ view }), restore: saved => { if (saved?.view) setView(saved.view); }, comparison: settlements.urban.comparison,
  coldViewport: () => settlements.urban.coldViewportEvidence };
