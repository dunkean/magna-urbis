import { buildMapLabels, placeMapLabels, estimateWidth, type MapLabelWorld, type MapLabel } from '../render/mapLabels';
import { cityTextLabels, textPlacement } from '../render/textLayer';
import { placedMapLabelsSvg } from '../render/svgLabels';
import { presetComposition, validateComposition, type CompositionRecipe, type Limitation } from '../render/composition';
import { resolveAppearance, type AppearanceInput, type RenderCapabilities, type RenderTarget } from '../render/appearanceRecipe';
import { getBenchRenderColors } from './benchRenderColors';
import { writeSettingPath } from './parameterForm';
import type { LandUseLayer } from '../gen/types';
import type { CityScene } from '../render/cityCanvas';
import type { View } from '../render/view';
import { ruralSemanticLegend, urbanSemanticLegend } from '../render/semanticLayer';
import { panelFont, panelSvg, plainCartouchePanel, plainLegendPanel } from '../render/legend';
import { styleTraits, terrainStyle } from '../render/terrainStyle';
import { renderControlFields } from './compositionControls';
import { setLanduseForestTone } from '../render/landuseForestTone';
import { setMapSeason } from '../render/seasonPalette';

const STORAGE = 'magna-urbis-bench-composition';
function load(): CompositionRecipe {
  try {
    // A recipe carried by the URL is kept verbatim; a stored one is refilled from the current preset definitions unless it is custom.
    const fromUrl = new URLSearchParams(location.search).get('composition'), saved = fromUrl ?? localStorage.getItem(STORAGE);
    if (saved) { const value: unknown = JSON.parse(saved); validateComposition(value); return fromUrl !== null || value.preset === 'custom' ? value : presetComposition(value.preset); }
  } catch { /* Invalid or unavailable storage starts with the explicit default. */ }
  return presetComposition('parchment');
}
let composition = load();
let overlayChange = false;
let materialNightChange=false;
export const benchOverlayChange = (): boolean => overlayChange;
export const benchMaterialNightChange=():boolean=>materialNightChange;
let advanced: Partial<AppearanceInput> = {};
let capabilities: RenderCapabilities = { nativeCities: false, ruralLanduse: false, urbanLanduse: false, parcels: false, buildings: false };
let target: RenderTarget = 'view2d';
export const getBenchComposition = (): CompositionRecipe => composition;
export function writeBenchCompositionQuery(query: URLSearchParams): void { query.set('composition', JSON.stringify(composition)); }
export function setBenchComposition(next: CompositionRecipe): void {
  validateComposition(next);
  const stable = (value: CompositionRecipe) => JSON.stringify({ ...value, preset: 'custom', text: undefined, annotations: undefined });
  const nightStable=(value:CompositionRecipe)=>JSON.stringify({...value,preset:'custom',effects:{...value.effects,ambience:undefined}});
  materialNightChange=composition.effects.ambience!==next.effects.ambience && nightStable(composition)===nightStable(next) && styleTraits(next.ground.variant).family==='material';
  overlayChange = stable(composition) === stable(next); composition = structuredClone(next);
  try { localStorage.setItem(STORAGE, JSON.stringify(composition)); } catch { /* Storage is optional. */ }
  window.dispatchEvent(new Event('bench-composition-change')); overlayChange = false;materialNightChange=false;
}
export function setBenchAppearanceField(path: string, value: unknown): void {
  writeSettingPath(advanced, path.replace(/^appearance\./, ''), value);
  window.dispatchEvent(new Event('bench-composition-change'));
}
export function setBenchRenderCapabilities(next: RenderCapabilities, nextTarget: RenderTarget = target): void {
  const limitations = [...next.limitations ?? []];
  for (const { path } of renderControlFields) {
    const field = path.replace('appearance.', '');
    if (next.buildings === false && ['city.diagnostic', 'city.painted', 'city.colors'].includes(field)) limitations.push({ pass: 'buildings', kind: 'data', field, reason: 'No buildings in the retained products.' });
    else if (!next.nativeCities && (field.startsWith('city.layers.') || ['city.view', 'city.palette', 'city.opacity', 'city.width', 'city.plan'].includes(field))) limitations.push({ pass: 'landuse', kind: 'data', field, reason: 'No urban land-use polygons in the retained products.' });
    if (next.ruralLanduse === false && ['vegetation', 'composition.vegetation.forestTone'].includes(field)) limitations.push({ pass: 'vegetation', kind: 'data', field, reason: 'No rural land-use polygons in the retained products.' });
    if (next.nativeTerrain === false && (field.startsWith('composition.effects.lighting.') || field.startsWith('forest.') || field.startsWith('fantasy.') || ['terrainLayers.hypsometry', 'terrainLayers.frame', 'composition.effects.season', 'city.exaggeration', 'city.refinement', 'lakes'].includes(field))) limitations.push({ pass: 'ground', kind: 'data', field, reason: 'No terrain raster in the retained products.' });
  }
  next = { ...next, limitations };
  if (JSON.stringify(next) === JSON.stringify(capabilities) && nextTarget === target) return;
  capabilities = next; target = nextTarget; window.dispatchEvent(new Event('bench-render-capabilities-change'));
}
/** Vegetation looks V2 honours and the benches' own ground paths do not. */
export function benchVegetationLimitations(view3d: boolean): Limitation[] {
  const look = composition.vegetation.look, fantasy = !!styleTraits(composition.ground.variant).fantasy, out: Limitation[] = [];
  if (!view3d && look === 'procedural-canopy' && !composition.effects.relief) out.push({ pass: 'vegetation', kind: 'backend', reason: 'This bench shows no procedural canopy on the 2D map with relief hidden.' });
  if (view3d && look === 'painted' && !fantasy) out.push({ pass: 'vegetation', kind: 'backend', reason: 'This bench has no painted vegetation atlas in 3D.' });
  return out;
}
export function resolveBenchAppearance(extra: Partial<AppearanceInput> = {}, nextTarget: RenderTarget = target) {
  const resolved = resolveAppearance({ style: 'parchment', ...extra, ...advanced, composition, colors: getBenchRenderColors() }, { mapStyle: 'parchment' }, capabilities, nextTarget);
  setLanduseForestTone(resolved.cartography.landuseForestTone);
  setMapSeason(resolved.ground.season);
  return resolved;
}

window.addEventListener('storage', event => {
  if (event.key !== STORAGE || !event.newValue) return;
  try { const value: unknown = JSON.parse(event.newValue); validateComposition(value); composition = value; window.dispatchEvent(new Event('bench-composition-change')); } catch { /* Ignore invalid external state. */ }
});

const textCache = new WeakMap<SVGSVGElement, { key: string; world?: MapLabelWorld; scenes: readonly CityScene[]; labels: MapLabel[] }>();
/** Map furniture uses only retained titles and the actual visible semantic classes. */
export function syncBenchAnnotations(map: SVGSVGElement, view: View, width: number, height: number, data: { title: string; subtitle: string; landuse?: LandUseLayer; scenes: readonly CityScene[]; world?: MapLabelWorld }): void {
  const r = resolveBenchAppearance(), s = r.composition.landuse, pal = terrainStyle(r.composition.variant, r.palette.colors).palette;
  let layer = map.querySelector<SVGGElement>('#benchAnnotations');
  if (!layer) { layer = document.createElementNS('http://www.w3.org/2000/svg', 'g'); layer.id = 'benchAnnotations'; layer.style.pointerEvents = 'none'; }
  const k = 1 / view.scale, x = view.cx - width * k / 2, y = view.cy - height * k / 2, font = panelFont(r.palette.mapStyle);
  let svg = '';
  if (r.cartography.cartouche) svg += panelSvg(plainCartouchePanel(pal, data.title, data.subtitle, view.scale), x + 12 * k, y + 12 * k, k, font, 'map-cartouche');
  const entries = [...ruralSemanticLegend(data.landuse, s.classes, s.rural), ...urbanSemanticLegend(data.scenes, s.urban)];
  if (r.cartography.legend && entries.length) {
    const panel = plainLegendPanel(pal, entries);
    svg += panelSvg(panel, x + Math.max(12, width - panel.w - 12) * k, y + Math.max(12, height - panel.h - 12) * k, k, font, 'map-legend');
  }
  const key = JSON.stringify([r.composition.text, pal.name, pal.lab]), previous = textCache.get(map);
  let labels = previous?.labels;
  if (!previous || previous.key !== key || previous.world !== data.world || previous.scenes.length !== data.scenes.length || previous.scenes.some((scene, i) => scene !== data.scenes[i])) {
    labels = [...(data.world ? buildMapLabels(data.world, pal.name, pal, r.composition.text) : []), ...data.scenes.flatMap(scene => cityTextLabels(scene, r.composition.text, pal))];
    textCache.set(map, { key, world: data.world, scenes: data.scenes, labels });
  }
  const placed = placeMapLabels(labels!, view, width, height, estimateWidth, textPlacement(r.composition.text));
  svg += `<g transform="translate(${x} ${y})">${placedMapLabelsSvg(placed, pal, view.scale)}</g>`;
  layer.innerHTML = svg; map.append(layer);
}

export function benchTextLayer(world?: import('../render/mapLabels').MapLabelWorld) {
  const r = resolveBenchAppearance(); return { world, text: r.composition.text, palette: terrainStyle(r.composition.variant, r.palette.colors).palette };
}

const settlementWorlds = new WeakMap<object, { annotations?: MapLabelWorld; world: MapLabelWorld }>();
export function benchSettlementTextWorld(sites: readonly { key: string; name?: string; population: number; center: { x: number; y: number } }[] | undefined, annotations?: MapLabelWorld): MapLabelWorld | undefined {
  if (!sites) return annotations;
  const old = settlementWorlds.get(sites); if (old && old.annotations === annotations) return old.world;
  const world: MapLabelWorld = { ...annotations, names: { family: 'french', town: '', entries: sites.map(site => ({ id: site.key, kind: site.population >= 2000 ? 'town' : 'village', text: site.name || site.key, rank: 0, anchor: site.center })) } };
  settlementWorlds.set(sites, { annotations, world }); return world;
}
