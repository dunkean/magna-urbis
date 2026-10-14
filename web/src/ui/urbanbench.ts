import { landPath } from '../../../rust/bridge/urbanGeography';
import { isFantasyStyle, DEFAULT_FANTASY_OPTIONS, type FantasyStyle } from '../../../rust/bridge/fantasyPainting';
import { fantasyLibraries } from '../render/fantasyBrushAssets';
import { paintFantasyDecor } from './fantasyUrban';
import './terrainbench.css';
import './terrainSettlements.css';
import './urbanbench.css';
import SettlementWorker from './settlementWorker?worker&inline';
import catalogueJson from '../../../rust/crates/core/src/urban/catalogue.json';
import { decodeDecor, type Decor, type DecorEntry } from './decor';
import { createTerrainRoads } from './terrainRoads';
import { createTerrainUrban } from './terrainUrban';
import { createUrbanLanduse } from './urbanLanduse';
import { createUrbanWorkshop } from './urbanWorkshop';
import type { Relief } from '../gen/options';
import { runSettlementRequest, type Point, type RoadOutput, type RoadSite, type Settlement, type SettlementOutput, type SettlementRaster, type SettlementRequest, type SettlementResponse } from '../../../rust/bridge/settlements';
import { clampView, fitView, panBy, screenToWorld, zoomAt, type View } from '../render/view';
import { viewFromString, viewToString } from './share';
import { createRuler } from './ruler';

/**
 * Urban Bench: quarters and parcels on retained decors (Terrain Bench maps), around one city
 * seed. The urban stages are Terrain Bench's own (`createTerrainUrban`), fed with the decor's
 * raster, so a fix prototyped here is the fix Terrain Bench runs.
 */
const ns = 'http://www.w3.org/2000/svg';
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const select = (id: string): HTMLSelectElement => el<HTMLSelectElement>(id);
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const map = document.getElementById('map') as unknown as SVGSVGElement;
const viewport = el('viewport');
const cultures = (catalogueJson as { cultures: Record<string, { label: string }> }).cultures;

/** rust/crates/core/src/settlements/mod.rs `extent_radius`. */
export function extentRadius(population: number): number {
  if (population < 15) return 45;
  if (population < 1000) return 20 + 9 * Math.sqrt(population);
  return 20 + 9 * Math.sqrt(1000) * (population / 1000) ** 0.4;
}

type Source = { kind: 'server' } | { kind: 'file'; file: File };
type Entry = DecorEntry & { source: Source };
interface City { key: string; name: string; population: number; culture: string; center: Point; radius: number; site: string }
type RoadMode = 'decor' | 'reroute' | 'none';

const query = new URLSearchParams(location.search);
let mapStyle: 'relief' | FantasyStyle = isFantasyStyle(query.get('style') ?? '') ? query.get('style') as FantasyStyle : 'relief';
const fantasyOptions = { ...DEFAULT_FANTASY_OPTIONS };
for (const key of ['density', 'size', 'spacing'] as const) {
  const value = Number(query.get(`brush_${key}`));
  if (value > 0 && Number.isFinite(value)) fantasyOptions[key] = Math.max(.3, Math.min(2, value));
  input(`brush_${key}`).value = String(fantasyOptions[key]);
}
select('mapStyle').value = mapStyle; el('fantasyStyleControls').hidden = !isFantasyStyle(mapStyle);
let entries: Entry[] = [];
let decor: Decor | undefined, decorId = query.get('decor') ?? '';
const decoded = new Map<string, Decor>();
let city: City | undefined, roadMode: RoadMode = 'decor', rerouted: RoadOutput | undefined, currentRoads: RoadOutput | undefined;
let placing = false;
let view: View = viewFromString(query.get('view')) ?? { cx: 1200, cy: 1200, scale: 0.3 };
let reliefBitmap: HTMLCanvasElement | undefined;
let initialView = !!query.get('view');
let initialCityRemoved = false;
const ruler = createRuler({ container: viewport, surface: map, language: 'fr', getView: () => view, onEnable: () => {
  placing = false; placeMode();
} });
const filters: Record<string, string> = {};
try {
  const saved = JSON.parse(query.get('city') ?? 'null');
  initialCityRemoved = saved?.removed === true;
  if (saved?.center) city = { key: 'city', name: '', population: 3000, culture: 'european-organic', radius: 0, site: '', ...saved };
  if (['decor', 'reroute', 'none'].includes(saved?.roads)) roadMode = saved.roads;
  Object.assign(filters, JSON.parse(query.get('filters') ?? '{}'));
} catch { /* A broken link keeps the defaults. */ }

function status(text: string, error = false): void { el('status').textContent = text; el('status').dataset.error = String(error); }

// ---------------------------------------------------------------- stages shared with Terrain Bench
const roads = createTerrainRoads({ map, before: el('status'), onConfigChange: () => { if (roadMode === 'reroute') schedulePush(true); save(); }, onDisplayChange: save });
el<HTMLDetailsElement>('roadStage').open = false;
const urban = createTerrainUrban({
  map, before: el('status'), getTerrain: () => undefined, getRaster: () => decor?.raster,
  getSeed: () => decor?.meta.seed ?? '', onChange: () => { syncLanduse(); save(); }, onPlanChange: syncLanduse,
  onFocus: (center, radius) => focus(center, radius),
});
const landuse = createUrbanLanduse({ map, before: el('status'), onChange: save,
  getDisplayStyle: () => isFantasyStyle(mapStyle) ? mapStyle : undefined,
  getView: () => ({ view, width: viewport.clientWidth, height: viewport.clientHeight }),
  getBackground: () => ({ image: reliefBitmap, opacity: input('showRelief').checked ? Number(select('baseOpacity').value) : 0 }),
});
const workshop = createUrbanWorkshop({ urban, getContext: () => decor && city ? { raster: decor.raster, sites: [{ key: city.key, population: city.population, culture: city.culture, center: city.center, radius: radiusOf(city) }], roads: currentRoads, seed: decor.meta.seed } : undefined, onChange: save });

function syncLanduse(): void {
  drawFantasy();
  if (!decor) { landuse.set(); return; }
  const c = city, radius = c ? radiusOf(c) : 0;
  const relief = decor.meta.tags.relief;
  landuse.set({
    raster: decor.raster, seed: decor.meta.seed,
    relief: (['flat', 'hills', 'valley'].includes(relief) ? relief : 'mountains') as Relief,
    city: c ? { key: c.key, center: c.center, population: c.population, culture: c.culture, radius } : undefined,
    neighbours: decor.meta.settlements.filter(s => !c || s.key !== c.site && s.key !== c.key
      && Math.hypot(s.center.x - c.center.x, s.center.y - c.center.y) > radius + s.radius * 0.5)
      .map(s => ({ key: s.key, center: s.center, population: s.population, culture: s.culture, radius: s.radius })),
    roads: currentRoads, layouts: urban.layouts,
  }, urban.layoutPending);
}

// ---------------------------------------------------------------- decor catalogue
async function loadIndex(): Promise<void> {
  try {
    const response = await fetch('decors/index.json', { cache: 'no-store' });
    if (!response.ok) return;
    const index = await response.json() as { decors: DecorEntry[] };
    entries = index.decors.map(e => ({ ...e, source: { kind: 'server' } }));
  } catch { /* file:// pages and servers without decors open files instead. */ }
}
async function openFiles(files: FileList): Promise<void> {
  status(`Lecture de ${files.length} fichier(s)…`);
  const added: Entry[] = [];
  for (const file of Array.from(files)) {
    try {
      const d = decodeDecor(new Uint8Array(await file.arrayBuffer()));
      const entry: Entry = { id: d.meta.id, label: d.meta.label, file: file.name, tags: d.meta.tags, width: d.meta.width, settlements: d.meta.settlements.length, roadKm: d.meta.stats.roadKm, riverKm: d.meta.stats.riverKm, source: { kind: 'file', file } };
      entries = entries.filter(e => e.id !== entry.id); added.push(entry); entries.push(entry); decoded.delete(entry.id);
    } catch (error) { status(`${file.name} : ${error instanceof Error ? error.message : error}`, true); }
  }
  catalogue();
  // Reattaching a shared file decor restores the retained seed and camera.
  if (added.length) await choose(added[0].id, added[0].id === decorId, added[0].id !== decorId || !query.has('urban'), added[0].id === decorId);
}
const visible = (): Entry[] => entries.filter(e => Object.entries(filters).every(([k, v]) => !v || e.tags[k] === v));
function catalogue(): void {
  const keys = ['relief', 'coast', 'river', 'roads', 'culture', 'size'].filter(k => entries.some(e => e.tags[k]));
  el('decorFilters').replaceChildren(...keys.map(key => {
    const label = document.createElement('label'), s = document.createElement('select');
    label.append(`${{ relief: 'Relief', coast: 'Côte', river: 'Rivière', roads: 'Routes', culture: 'Culture', size: 'Taille' }[key] ?? key} `, s);
    const values = [...new Set(entries.map(e => e.tags[key]).filter(Boolean))].sort();
    s.replaceChildren(new Option('Tous', ''), ...values.map(v => new Option(`${v} (${entries.filter(e => e.tags[key] === v).length})`, v)));
    s.value = filters[key] ?? '';
    s.onchange = () => { filters[key] = s.value; catalogue(); save(); };
    return label;
  }));
  const list = visible();
  el('decorList').replaceChildren(...list.map(e => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'terrain-place'; b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(e.id === decorId)); b.setAttribute('aria-pressed', String(e.id === decorId));
    b.innerHTML = `<b>${esc(e.label)}</b><small>${esc(Object.entries(e.tags).filter(([k]) => k !== 'culture').map(([, v]) => v).join(' · '))}<br>${(e.width / 1000).toFixed(1)} km · ${e.settlements} lieux · ${e.roadKm.toFixed(0)} km de routes · ${e.riverKm.toFixed(0)} km de rivières</small>`;
    b.onclick = () => void choose(e.id);
    return b;
  }));
  el('decorList').querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  select('decorQuick').replaceChildren(...(list.length ? list : entries).map(e => new Option(e.label, e.id)));
  select('decorQuick').value = decorId;
  el('decorState').textContent = entries.length ? `${list.length}/${entries.length}` : '';
}
async function fetchDecor(entry: Entry): Promise<Decor> {
  const cached = decoded.get(entry.id); if (cached) return cached;
  const bytes = entry.source.kind === 'file' ? new Uint8Array(await entry.source.file.arrayBuffer())
    : new Uint8Array(await (await fetch(`decors/${entry.file}`, { cache: 'no-store' })).arrayBuffer());
  const d = decodeDecor(bytes);
  decoded.set(entry.id, d);
  // Keep the neighbours of the browsing order, not the whole catalogue (~4 MB each once decoded).
  while (decoded.size > 4) decoded.delete(decoded.keys().next().value!);
  return d;
}
let choosing = 0;
async function choose(id: string, keepCity = false, restoreUrban = false, keepRoadConfig = false): Promise<void> {
  const entry = entries.find(e => e.id === id); if (!entry) return;
  const token = ++choosing; decorId = id; catalogue();
  status(`Chargement du décor ${entry.label}…`);
  let next: Decor;
  try { next = await fetchDecor(entry); } catch (error) { status(`Décor ${entry.label} : ${error instanceof Error ? error.message : error}`, true); return; }
  if (token !== choosing) return;
  decor = next; rerouted = undefined;
  landuse.set();
  urban.terrainPending();
  const sourceQuery = new URLSearchParams(decor.meta.query);
  if (restoreUrban) urban.restoreFromQuery(sourceQuery, true);
  if (!keepRoadConfig) roads.setConfig(decor.meta.roadConfig ?? roads.config);
  drawBase();
  if (!keepCity) {
    defaultCity();
    const savedUrban = restoreUrban ? sourceQuery.get('urban') : query.get('urban');
    if (savedUrban) try {
      const selected = decor.meta.settlements.find(s => s.key === JSON.parse(savedUrban).target);
      if (selected) city = cityOf(selected);
    } catch { /* A malformed selection keeps the largest settlement. */ }
  }
  else if (city?.site && !decor.meta.settlements.some(s => s.key === city!.site)) city.site = '';
  if (!initialView) fitTo(city);
  initialView = false;
  sites(); cityControls(); report(); updateView(); push(); save();
  status(`${decor.meta.label} · ${(decor.meta.width / 1000).toFixed(1)} km · raster ${decor.raster.n}² (${(decor.meta.width / decor.raster.n).toFixed(1)} m/cellule)`);
}
/** The largest place of the decor, as Terrain Bench selects it first. */
function defaultCity(): void {
  const main = decor?.meta.settlements.slice().sort((a, b) => b.population - a.population)[0];
  city = main ? cityOf(main) : undefined;
  placing = !main; placeMode();
}
const cityOf = (s: Settlement): City => ({ key: s.key, name: s.name, population: s.population, culture: s.culture, center: { ...s.center }, radius: 0, site: s.key });
function step(delta: number): void {
  const list = visible(); if (!list.length) return;
  const i = list.findIndex(e => e.id === decorId);
  void choose(list[(i + delta + list.length) % list.length].id);
}

// ---------------------------------------------------------------- city seed
function cityControls(): void {
  const c = city;
  el('seedState').textContent = c ? `${c.population.toLocaleString()} hab.` : '';
  for (const id of ['seedName', 'seedPopulation', 'seedCulture', 'seedRadius', 'seedX', 'seedY']) el<HTMLInputElement>(id).disabled = !c;
  select('seedRoads').value = roadMode;
  if (!c) { el('seedInfo').textContent = decor ? 'Posez une graine sur la carte (P) ou choisissez un lieu du décor.' : ''; drawCity(); return; }
  select('seedSite').value = c.site;
  input('seedName').value = c.name; input('seedPopulation').value = String(c.population);
  select('seedCulture').value = c.culture; input('seedRadius').value = String(c.radius);
  input('seedX').value = c.center.x.toFixed(0); input('seedY').value = c.center.y.toFixed(0);
  input('seedX').max = input('seedY').max = String(decor?.meta.width ?? 100000);
  const r = radiusOf(c), wet = decor && wetAt(decor.raster, c.center);
  el('seedInfo').textContent = `Clé ${c.key}${c.site ? ' (lieu du décor)' : ''} · rayon ${r.toFixed(0)} m${c.radius ? '' : ' (auto)'}${wet ? ' · le centre est sur l’eau ou la roche' : ''}`;
  drawCity();
}
const radiusOf = (c: City): number => {
  if (c.radius > 0) return c.radius;
  const source = decor?.meta.settlements.find(s => s.key === c.site);
  return source?.population === c.population ? source.radius : extentRadius(c.population);
};
function wetAt(r: SettlementRaster, p: Point): boolean {
  const x = Math.floor(p.x / r.width * r.n), y = Math.floor(p.y / r.width * r.n);
  return x < 0 || y < 0 || x >= r.n || y >= r.n || r.water[y * r.n + x] !== 0;
}
select('seedCulture').replaceChildren(...Object.entries(cultures).map(([id, c]) => new Option(c.label, id)));
function sites(): void {
  const list = decor?.meta.settlements.slice().sort((a, b) => b.population - a.population) ?? [];
  select('seedSite').replaceChildren(new Option('Graine libre', ''), ...list.map(s => new Option(`${s.name || s.key} · ${s.population.toLocaleString()} hab. · ${s.culture}`, s.key)));
  drawSites();
}
/** Edits keep the key: the urban draws stay those of the same city while it moves or grows. */
function editCity(change: (c: City) => void, reroute = true): void {
  if (!city) return;
  change(city); cityControls(); schedulePush(reroute); save();
}
select('seedSite').onchange = () => {
  const s = decor?.meta.settlements.find(p => p.key === select('seedSite').value);
  if (s) city = cityOf(s);
  else if (city) city = { ...city, key: 'city', site: '' };
  cityControls(); schedulePush(true); save();
};
input('seedName').onchange = () => editCity(c => { c.name = input('seedName').value.trim(); }, false);
input('seedPopulation').onchange = () => { if (input('seedPopulation').reportValidity()) editCity(c => { c.population = Math.round(Number(input('seedPopulation').value)); }); };
select('seedCulture').onchange = () => editCity(c => { c.culture = select('seedCulture').value; }, false);
input('seedRadius').onchange = () => { if (input('seedRadius').reportValidity()) editCity(c => { c.radius = Number(input('seedRadius').value); }); };
input('seedX').onchange = input('seedY').onchange = () => editCity(c => { c.center = { x: Number(input('seedX').value), y: Number(input('seedY').value) }; });
select('seedRoads').onchange = () => { roadMode = select('seedRoads').value as RoadMode; schedulePush(true); save(); };
function placeMode(): void {
  if (placing) ruler.setEnabled(false);
  el('seedPlace').setAttribute('aria-pressed', String(placing)); viewport.classList.toggle('settlement-picking', placing);
}
el('seedPlace').onclick = () => { placing = !placing; placeMode(); };
el('seedClear').onclick = () => { city = undefined; cityControls(); push(); save(); };
function placeAt(p: Point): void {
  if (!decor) return;
  const w = decor.meta.width;
  const center = { x: Math.max(0, Math.min(w, p.x)), y: Math.max(0, Math.min(w, p.y)) };
  // A free seed: the key changes once, so its draws differ from the decor place it replaced.
  city = city ? { ...city, key: city.site ? 'city' : city.key, name: city.site ? '' : city.name, site: '', center } : { key: 'city', name: '', population: 3000, culture: decor.meta.settlements[0]?.culture ?? 'european-organic', radius: 0, site: '', center };
  placing = false; placeMode(); cityControls(); schedulePush(true); save();
}

// ---------------------------------------------------------------- roads and urban requests
let pushTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePush(reroute: boolean): void {
  if (reroute) rerouted = undefined;
  clearTimeout(pushTimer); pushTimer = setTimeout(push, 150);
}
function cityOutput(): SettlementOutput | undefined {
  if (!city) return undefined;
  const site = { key: city.key, name: city.name || 'Ville', population: city.population, culture: city.culture, center: city.center, radius: radiusOf(city) } as Settlement;
  return { settlements: [site], warnings: [], requested: 1, usableKm2: 0, ms: 0 };
}
function push(): void {
  clearTimeout(pushTimer);
  if (!decor) return;
  if (roadMode === 'reroute' && city && !rerouted) { reroute(); return; }
  const r = roadMode === 'none' ? undefined : roadMode === 'reroute' && city ? rerouted : decor.meta.roads ?? undefined;
  currentRoads = r;
  roads.set(r);
  urban.setSettlements(cityOutput(), r);
  syncLanduse();
  drawSites();
}
let routeWorker: Worker | undefined, routeFallback = false, routeRaster: SettlementRaster | undefined, routeId = 0;
/** The decor's places with the seed, routed again by the Terrain Bench road engine. */
function reroute(): void {
  if (!decor || !city) return;
  const r = radiusOf(city), c = city;
  const others: RoadSite[] = decor.meta.settlements
    .filter(s => s.key !== c.site && s.key !== c.key && Math.hypot(s.center.x - c.center.x, s.center.y - c.center.y) > r + s.radius * 0.5)
    .map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius }));
  const sitesList: RoadSite[] = [{ key: c.key, population: c.population, culture: c.culture, center: c.center, radius: r }, ...others];
  const request: SettlementRequest = { id: ++routeId, seed: decor.meta.seed, sites: sitesList, roads: structuredClone(roads.config) };
  if (routeRaster !== decor.raster || routeFallback) {
    const raster = decor.raster;
    request.raster = { ...raster, height: raster.height.slice(), water: raster.water.slice(), waterLevel: raster.waterLevel.slice(), riverWidth: raster.riverWidth.slice(), riverIds: raster.riverIds.slice() };
    routeRaster = raster;
  }
  roads.pending('Routage Rust avec la graine…');
  if (!routeWorker && !routeFallback) {
    try {
      routeWorker = new SettlementWorker();
      routeWorker.onmessage = (event: MessageEvent<SettlementResponse>) => routed(event.data);
      routeWorker.onerror = event => { event.preventDefault(); routeWorker?.terminate(); routeWorker = undefined; routeFallback = true; routeRaster = undefined; reroute(); };
    } catch { routeFallback = true; }
  }
  if (routeFallback) { void runSettlementRequest(request).then(routed, error => routed({ id: request.id, error: String(error) })); return; }
  const t = request.raster;
  routeWorker!.postMessage(request, t ? [t.height.buffer, t.water.buffer, t.waterLevel.buffer, t.riverWidth.buffer, t.riverIds.buffer] : []);
}
function routed(response: SettlementResponse): void {
  if (response.id !== routeId) return;
  if ('error' in response) { roads.error(response.error); return; }
  rerouted = response.roads ?? { segments: [], junctions: [], warnings: [], unreachable: [], routes: 0, lengthByClass: {}, lengthBySurface: {}, ms: 0 };
  push();
}

// ---------------------------------------------------------------- base layers
let paintedDecor: Decor | undefined, paintedLayouts: typeof urban.layouts, paintedRoads: RoadOutput | undefined, paintedKey = '';
function drawFantasy(): void {
  const layer = map.querySelector('#fantasyPainting'); if (!layer) return;
  if (!decor || !isFantasyStyle(mapStyle)) { layer.innerHTML = ''; paintedKey = ''; return; }
  const key = JSON.stringify([mapStyle, fantasyOptions, city?.center, city ? radiusOf(city) : 0]);
  if (paintedDecor === decor && paintedLayouts === urban.layouts && paintedRoads === currentRoads && paintedKey === key) return;
  const source = new URLSearchParams(decor.meta.query), preset = source.get('climate') ?? decor.meta.tags.climate ?? 'temperate';
  const climates: Record<string, [number, number]> = { temperate: [18, 1000], oceanic: [11, 1300], mediterranean: [16, 600], arid: [23, 150], cold: [1, 550], tropical: [26, 2300] };
  const climate = climates[preset] ?? climates.temperate;
  const climateValue = (key: string, fallback: number): number => source.has(key) && Number.isFinite(Number(source.get(key))) ? Number(source.get(key)) : fallback;
  layer.innerHTML = paintFantasyDecor({ raster: decor.raster, seed: decor.meta.seed, temperature: climateValue('temperature', climate[0]), rain: climateValue('precipitation', climate[1]),
    layouts: urban.layouts, roads: currentRoads, city: city ? { center: city.center, radius: radiusOf(city) } : undefined }, fantasyLibraries[mapStyle], fantasyOptions);
  paintedDecor = decor; paintedLayouts = urban.layouts; paintedRoads = currentRoads; paintedKey = key;
}
select('mapStyle').onchange = () => {
  mapStyle = select('mapStyle').value as 'relief' | FantasyStyle; el('fantasyStyleControls').hidden = !isFantasyStyle(mapStyle);
  drawBase(); landuse.refreshBackground(); save();
};
let fantasyTimer: ReturnType<typeof setTimeout> | undefined;
for (const key of ['density', 'size', 'spacing'] as const) input(`brush_${key}`).oninput = () => {
  fantasyOptions[key] = Number(input(`brush_${key}`).value); clearTimeout(fantasyTimer); fantasyTimer = setTimeout(() => { drawFantasy(); save(); }, 50);
};
for (const format of ['svg', 'png'] as const) el<HTMLButtonElement>(`fantasyExport_${format}`).onclick = async () => {
  if (!decor || !isFantasyStyle(mapStyle)) return;
  const button = el<HTMLButtonElement>(`fantasyExport_${format}`); button.disabled = true;
  try {
    drawFantasy();
    const svg = map.cloneNode(true) as SVGSVGElement; svg.querySelector('#landuseLayer')?.remove();
    svg.setAttribute('viewBox', `0 0 ${decor.raster.width} ${decor.raster.width}`); svg.setAttribute('width', '4096'); svg.setAttribute('height', '4096');
    const css = document.createElementNS(ns, 'style'); css.textContent = Array.from(document.querySelectorAll('style')).map(style => style.textContent).join('\n'); svg.prepend(css);
    let blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    if (format === 'png') {
      const url = URL.createObjectURL(blob), image = new Image();
      try {
        image.src = url; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4096;
        canvas.getContext('2d')!.drawImage(image, 0, 0);
        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Export PNG impossible')), 'image/png'));
      } finally { URL.revokeObjectURL(url); }
    }
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `urbanbench-${mapStyle}.${format}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (error) { status(`Export : ${error instanceof Error ? error.message : error}`, true); }
  finally { button.disabled = false; }
};
function drawBase(): void {
  if (!decor) return;
  const r = decor.raster, w = r.width;
  const image = map.querySelector('#reliefImage')!;
  image.setAttribute('width', String(w)); image.setAttribute('height', String(w));
  image.setAttribute('href', reliefImage(r));
  const base = map.querySelector('#baseLayer')!;
  let sea = base.querySelector<SVGRectElement>('[data-decor-sea]');
  if (!sea) { sea = document.createElementNS(ns, 'rect'); sea.dataset.decorSea = ''; base.insertBefore(sea, image); }
  sea.setAttribute('width', String(w)); sea.setAttribute('height', String(w)); sea.setAttribute('fill', '#aac8d6');
  let clip = base.querySelector<SVGClipPathElement>('#decor-land');
  if (!clip) { clip = document.createElementNS(ns, 'clipPath'); clip.id = 'decor-land'; base.prepend(clip); }
  const boundary = document.createElementNS(ns, 'path'); boundary.setAttribute('d', landPath(r.geometry?.land ?? [])); boundary.setAttribute('clip-rule', 'evenodd');
  clip.replaceChildren(boundary); image.setAttribute('clip-path', 'url(#decor-land)');
  map.querySelector('#contourLayer')!.innerHTML = isFantasyStyle(mapStyle) ? '' : contours(r);
  map.querySelector('#waterLayer')!.innerHTML = decor.meta.waterSvg || (r.geometry?.water ?? []).map(rings => `<path d="${landPath(rings)}" fill="#96bed2" fill-rule="evenodd"/>`).join('');
  drawFantasy();
  layers();
}
/** Hillshade and elevation tint of the decor raster, sampled at twice its resolution. */
function reliefImage(r: SettlementRaster): string {
  const n = r.n, m = Math.min(2048, n * 2), cell = r.width / m;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = m;
  const ctx = canvas.getContext('2d')!, img = ctx.createImageData(m, m);
  const sample = (gx: number, gy: number): number => {
    gx = Math.max(0, Math.min(n - 1, gx)); gy = Math.max(0, Math.min(n - 1, gy));
    const x = Math.min(n - 2, Math.floor(gx)), y = Math.min(n - 2, Math.floor(gy)), tx = gx - x, ty = gy - y, h = r.height;
    return (h[y * n + x] * (1 - tx) + h[y * n + x + 1] * tx) * (1 - ty) + (h[(y + 1) * n + x] * (1 - tx) + h[(y + 1) * n + x + 1] * tx) * ty;
  };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n * n; i++) if (!r.water[i]) { lo = Math.min(lo, r.height[i]); hi = Math.max(hi, r.height[i]); }
  if (!(hi > lo)) { lo = 0; hi = 1; }
  const ramp: [number, number, number, number][] = [[0, 232, 229, 205], [0.25, 218, 214, 178], [0.55, 199, 184, 150], [0.8, 178, 162, 140], [1, 236, 233, 226]];
  const tint = (t: number): [number, number, number] => {
    for (let k = 1; k < ramp.length; k++) if (t <= ramp[k][0]) {
      const a = ramp[k - 1], b = ramp[k], u = (t - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
    }
    return [ramp[4][1], ramp[4][2], ramp[4][3]];
  };
  const scale = n / m, light = [-0.5, -0.5, 0.707], exaggeration = 2;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const gx = (x + 0.5) * scale - 0.5, gy = (y + 0.5) * scale - 0.5, o = (y * m + x) * 4;
    const water = r.water[Math.min(n - 1, Math.floor((y + 0.5) * scale)) * n + Math.min(n - 1, Math.floor((x + 0.5) * scale))];
    if (water === 1 && !r.geometry) {
      const depth = Math.max(0, -sample(gx, gy));
      const k = Math.min(1, depth / 40);
      img.data.set([170 - 40 * k, 200 - 30 * k, 214 - 14 * k, 255], o); continue;
    }
    const dx = (sample(gx + scale, gy) - sample(gx - scale, gy)) / (2 * cell) * exaggeration;
    const dy = (sample(gx, gy + scale) - sample(gx, gy - scale)) / (2 * cell) * exaggeration;
    const len = Math.hypot(dx, dy, 1), shade = Math.max(0, (-dx * light[0] - dy * light[1] + light[2]) / len);
    const [cr, cg, cb] = isFantasyStyle(mapStyle) ? mapStyle === 'fantasy-ink' ? [250, 249, 245] : [239, 232, 210] : tint((sample(gx, gy) - lo) / (hi - lo)), s = isFantasyStyle(mapStyle) ? .97 + .04 * shade : 0.5 + 0.62 * shade;
    img.data.set([Math.min(255, cr * s), Math.min(255, cg * s), Math.min(255, cb * s), 255], o);
    if (water && !decor?.meta.waterSvg && !r.geometry) img.data.set([150, 190, 210, 255], o);
  }
  ctx.putImageData(img, 0, 0);
  reliefBitmap = canvas;
  return canvas.toDataURL('image/png');
}
/** Marching-squares contours of the raster; index lines every fifth level. */
function contours(r: SettlementRaster): string {
  const n = r.n, cell = r.width / n, h = r.height;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n * n; i++) if (r.water[i] !== 1) { lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
  if (!(hi > lo)) return '';
  const interval = [1, 2, 5, 10, 20, 25, 50, 100, 200].find(v => (hi - lo) / v <= 45) ?? 500;
  let thin = '', index = '';
  const f = (v: number): string => v.toFixed(1);
  for (let level = Math.ceil(Math.max(lo, 0.01) / interval) * interval; level < hi; level += interval) {
    let d = '';
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const i = y * n + x, a = h[i], b = h[i + 1], c = h[i + n + 1], e = h[i + n];
      if (r.water[i] === 1 || r.water[i + 1] === 1 || r.water[i + n] === 1 || r.water[i + n + 1] === 1) continue;
      const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (e > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const px = (x + 0.5) * cell, py = (y + 0.5) * cell;
      const top = (): [number, number] => [px + (level - a) / (b - a) * cell, py];
      const right = (): [number, number] => [px + cell, py + (level - b) / (c - b) * cell];
      const bottom = (): [number, number] => [px + (level - e) / (c - e) * cell, py + cell];
      const left = (): [number, number] => [px, py + (level - a) / (e - a) * cell];
      const seg = (p: [number, number], q: [number, number]): void => { d += `M${f(p[0])},${f(p[1])}L${f(q[0])},${f(q[1])}`; };
      switch (code) {
        case 1: case 14: seg(left(), bottom()); break;
        case 2: case 13: seg(bottom(), right()); break;
        case 3: case 12: seg(left(), right()); break;
        case 4: case 11: seg(top(), right()); break;
        case 6: case 9: seg(top(), bottom()); break;
        case 7: case 8: seg(left(), top()); break;
        case 5: seg(left(), top()); seg(bottom(), right()); break;
        case 10: seg(top(), right()); seg(left(), bottom()); break;
      }
    }
    if (Math.round(level / interval) % 5 === 0) index += d; else thin += d;
  }
  return `<path class="contour" d="${thin}"/><path class="contour index" d="${index}"/><title>Courbes tous les ${interval} m</title>`;
}
function layers(): void {
  map.style.filter = mapStyle === 'fantasy-ink' ? 'grayscale(1)' : '';
  map.dataset.fantasyRelief = String(input('showRelief').checked); map.dataset.fantasyLanduse = String(input('showLanduse').checked);
  (map.querySelector('#baseLayer') as SVGGElement).style.display = input('showRelief').checked ? '' : 'none';
  (map.querySelector('#baseLayer') as SVGGElement).setAttribute('opacity', select('baseOpacity').value);
  (map.querySelector('#contourLayer') as SVGGElement).style.display = input('showContours').checked && !isFantasyStyle(mapStyle) ? '' : 'none';
  (map.querySelector('#waterLayer') as SVGGElement).style.display = input('showWater').checked ? '' : 'none';
  (map.querySelector('#settlementOverlay') as SVGGElement).style.display = input('showMarkers').checked ? '' : 'none';
}
for (const id of ['showRelief', 'showContours', 'showWater', 'showMarkers', 'baseOpacity']) el(id).onchange = () => {
  layers(); if (id === 'showRelief' || id === 'baseOpacity') landuse.refreshBackground(); save();
};
input('showLanduse').addEventListener('change', () => { layers(); save(); });
function drawSites(): void {
  const layer = map.querySelector('#settlementOverlay')!; layer.replaceChildren();
  for (const s of decor?.meta.settlements ?? []) {
    const g = document.createElementNS(ns, 'g'); g.classList.add('settlement-marker'); g.dataset.site = s.key;
    g.dataset.x = String(s.center.x); g.dataset.y = String(s.center.y);
    const dot = document.createElementNS(ns, 'circle'); dot.setAttribute('r', String(s.population >= 1000 ? 6 : s.population >= 150 ? 4.5 : 3.5));
    dot.setAttribute('fill', city?.site === s.key ? '#1b765a' : '#693b2c'); dot.setAttribute('stroke', '#fffdf0'); dot.setAttribute('stroke-width', '1.5');
    const text = document.createElementNS(ns, 'text'); text.setAttribute('x', '9'); text.setAttribute('y', '4'); text.textContent = `${s.name || s.key} · ${s.population.toLocaleString()}`;
    const title = document.createElementNS(ns, 'title'); title.textContent = `${s.cls} · ${s.culture} · ${s.archetype}\nrayon ${s.radius.toFixed(0)} m\nCliquer pour en faire la ville`;
    g.append(title, dot, text); layer.append(g);
  }
  markers();
}
function drawCity(): void {
  const layer = map.querySelector('#seedLayer')!; layer.replaceChildren();
  if (!city) return;
  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', String(city.center.x)); ring.setAttribute('cy', String(city.center.y)); ring.setAttribute('r', String(radiusOf(city)));
  ring.setAttribute('class', 'seed-ring');
  const handle = document.createElementNS(ns, 'g'); handle.dataset.seedHandle = ''; handle.classList.add('seed-handle');
  handle.dataset.x = String(city.center.x); handle.dataset.y = String(city.center.y);
  handle.innerHTML = '<circle r="8"/><path d="M-12 0H12M0 -12V12"/><title>Graine de ville · glisser pour déplacer</title>';
  layer.append(ring, handle);
  markers();
}
/** Markers keep their screen size. */
function markers(): void {
  for (const g of Array.from(map.querySelectorAll<SVGGElement>('[data-site], [data-seed-handle]'))) g.setAttribute('transform', `translate(${g.dataset.x} ${g.dataset.y}) scale(${1 / view.scale})`);
}

// ---------------------------------------------------------------- view and pointer
function updateView(): void {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  // A saved camera belongs to the incoming decor. Its bounds are unknown until
  // loading completes; clamping to the placeholder width destroys the replay.
  if (decor) view = clampView(view, decor.meta.width, w, h);
  map.setAttribute('viewBox', `${view.cx - w / (2 * view.scale)} ${view.cy - h / (2 * view.scale)} ${w / view.scale} ${h / view.scale}`);
  markers(); urban.updateView(); landuse.updateView();
  ruler.update();
  el('scale').textContent = `${(1 / view.scale).toFixed(2)} m / px`;
}
function setView(next: View): void { view = next; updateView(); deferSave(); }
function fitTo(c?: City): void {
  if (c) { const extent = urban.extent; focus(extent?.center ?? c.center, extent?.radius ?? radiusOf(c)); }
  else view = fitView(decor?.meta.width ?? 2400, viewport.clientWidth, viewport.clientHeight);
}
function focus(center: Point, radius: number): void {
  setView({ cx: center.x, cy: center.y, scale: Math.min(viewport.clientWidth, viewport.clientHeight) / Math.max(100, radius * 2.6) });
}
const local = (e: MouseEvent): [number, number] => { const b = viewport.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
const world = (e: MouseEvent): Point => { const [x, y] = screenToWorld(view, viewport.clientWidth, viewport.clientHeight, ...local(e)); return { x, y }; };
function zoom(factor: number, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2): void { setView(zoomAt(view, factor, x, y, viewport.clientWidth, viewport.clientHeight)); }
let drag: { pointer: number; x: number; y: number; moved: boolean; seed: boolean; target: Element } | undefined;
viewport.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const target = event.target as Element, seed = !!target.closest('[data-seed-handle]');
  drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false, seed, target };
  if (seed) map.classList.add('seed-moving');
  viewport.setPointerCapture(event.pointerId); if (!seed) map.classList.add('drag');
});
viewport.addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId) {
    const p = world(event), z = decor ? heightAt(decor.raster, p) : undefined;
    el('coordinates').textContent = `x ${p.x.toFixed(1)} · y ${p.y.toFixed(1)}${z === undefined ? '' : ` · z ${z.toFixed(1)} m`}`;
    return;
  }
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag.moved ||= Math.hypot(dx, dy) > 3;
  if (!drag.moved) return;
  if (drag.seed && city) {
    const p = world(event); city.center = p;
    const handle = map.querySelector<SVGGElement>('[data-seed-handle]')!, ring = map.querySelector('.seed-ring')!;
    handle.dataset.x = String(p.x); handle.dataset.y = String(p.y); ring.setAttribute('cx', String(p.x)); ring.setAttribute('cy', String(p.y)); markers();
  } else { view = panBy(view, dx, dy); drag.x = event.clientX; drag.y = event.clientY; updateView(); }
});
viewport.addEventListener('pointerup', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const d = drag; drag = undefined; map.classList.remove('drag', 'seed-moving');
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  if (d.seed && d.moved && city) { editCity(c => { if (c.site) { c.site = ''; c.key = 'city'; } }); return; }
  if (d.moved) { deferSave(); return; }
  const site = d.target.closest<SVGGElement>('[data-site]');
  if (site && !placing) { const s = decor?.meta.settlements.find(p => p.key === site.dataset.site); if (s) { city = cityOf(s); cityControls(); schedulePush(true); save(); } return; }
  if (placing) placeAt(world(event));
});
viewport.addEventListener('pointercancel', () => { drag = undefined; map.classList.remove('drag', 'seed-moving'); });
viewport.addEventListener('wheel', event => { event.preventDefault(); zoom(Math.exp(-event.deltaY * (event.deltaMode ? 0.05 : 0.0015)), ...local(event)); }, { passive: false });
viewport.addEventListener('dblclick', event => { if (!placing) zoom(event.shiftKey ? 0.5 : 2, ...local(event)); });
function heightAt(r: SettlementRaster, p: Point): number | undefined {
  const x = Math.floor(p.x / r.width * r.n), y = Math.floor(p.y / r.width * r.n);
  return x < 0 || y < 0 || x >= r.n || y >= r.n ? undefined : r.height[y * r.n + x];
}
window.addEventListener('keydown', event => {
  if ((event.target as Element).closest('input, select, textarea')) return;
  if (event.key === 'Escape') { placing = false; placeMode(); }
  else if (event.key === 'p' || event.key === 'P') { placing = !placing; placeMode(); }
  else if (event.key === 'f' || event.key === 'F') { if (city) fitTo(city); }
  else if (event.key === '0') setView(fitView(decor?.meta.width ?? 2400, viewport.clientWidth, viewport.clientHeight));
  else if (event.key === '+' || event.key === '=') zoom(1.5);
  else if (event.key === '-') zoom(1 / 1.5);
  else if (event.key === '[') step(-1);
  else if (event.key === ']') step(1);
});
el('fit').onclick = () => setView(fitView(decor?.meta.width ?? 2400, viewport.clientWidth, viewport.clientHeight));
el('focusSeed').onclick = () => { if (city) fitTo(city); };
el('zoomIn').onclick = () => zoom(1.5); el('zoomOut').onclick = () => zoom(1 / 1.5);
el('decorPrev').onclick = () => step(-1); el('decorNext').onclick = () => step(1);
select('decorQuick').onchange = () => void choose(select('decorQuick').value);
el('decorRandom').onclick = () => { const list = visible(); if (list.length) void choose(list[Math.floor(Math.random() * list.length)].id); };
input('decorFiles').onchange = () => { if (input('decorFiles').files?.length) void openFiles(input('decorFiles').files!); input('decorFiles').value = ''; };
viewport.addEventListener('dragover', event => event.preventDefault());
viewport.addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer?.files.length) void openFiles(event.dataTransfer.files); });
new ResizeObserver(updateView).observe(viewport);

// ---------------------------------------------------------------- report and link
function report(): void {
  if (!decor) { el('report').innerHTML = '<p><small>—</small></p>'; return; }
  const m = decor.meta, row = (k: string, v: string): string => `<p><small><b>${esc(k)}</b><br>${v}</small></p>`;
  el('report').innerHTML = row('Décor', `${esc(m.label)}<br><code>${esc(m.id)}</code>`)
    + row('Classement', Object.entries(m.tags).map(([k, v]) => `${esc(k)} : ${esc(v)}`).join('<br>'))
    + row('Carte', `${(m.width / 1000).toFixed(2)} km · raster ${decor.raster.n}² · ${(m.width / decor.raster.n).toFixed(1)} m/cellule<br>terres ${(m.stats.land * 100).toFixed(0)} % · altitudes ${m.stats.minHeight.toFixed(0)} → ${m.stats.maxHeight.toFixed(0)} m`)
    + row('Réseau', `${m.settlements.length} lieux · ${m.stats.roadKm.toFixed(1)} km de routes · ${m.stats.riverKm.toFixed(1)} km de rivières${m.roadConfig ? `<br>routes ${esc(m.roadConfig.level)} · ${esc(m.roadConfig.culture)}` : ''}`)
    + row('Graine de la carte', `<code>${esc(m.seed)}</code>`);
}
function shareQuery(): string {
  const params = new URLSearchParams({ style: mapStyle, brush_density: String(fantasyOptions.density), brush_size: String(fantasyOptions.size), brush_spacing: String(fantasyOptions.spacing) });
  if (decorId) params.set('decor', decorId);
  params.set('city', JSON.stringify(city ? { ...city, roads: roadMode } : { removed: true, roads: roadMode }));
  if (Object.values(filters).some(Boolean)) params.set('filters', JSON.stringify(filters));
  params.set('roads', roads.share());
  urban.share(params);
  landuse.share(params);
  workshop.share(params);
  params.set('view', viewToString(view));
  return params.toString();
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save(): void { clearTimeout(saveTimer); try { history.replaceState(null, '', `${location.pathname}?${shareQuery()}`); } catch { /* file:// */ } }
function deferSave(): void { clearTimeout(saveTimer); saveTimer = setTimeout(save, 200); }
el('copy').onclick = async () => {
  save();
  try { await navigator.clipboard.writeText(location.href); status('Lien copié : décor, graine, paramètres urbains et vue.'); } catch { window.prompt('Copier', location.href); }
};
el('openTerrain').onclick = () => {
  if (!decor) return;
  const params = new URLSearchParams(decor.meta.query); urban.share(params);
  const routing = JSON.parse(roads.share());
  if (roadMode === 'none') routing.enabled = false;
  params.set('roads', JSON.stringify(routing));
  if (city?.site) {
    const state = JSON.parse(params.get('urban')!); state.target = city.site; params.set('urban', JSON.stringify(state));
  }
  window.open(`terrainbench.html?${params}`, '_blank');
};

// ---------------------------------------------------------------- start
(async () => {
  updateView(); cityControls(); placeMode();
  await loadIndex();
  if (decorId && !entries.some(e => e.id === decorId)) {
    // A catalogue can be refreshed while a shared case still names an older retained file.
    try {
      if (!/^[\w.-]+$/.test(decorId)) throw new Error('Identifiant de décor invalide.');
      const response = await fetch(`decors/${decorId}.decor`);
      if (!response.ok) throw new Error('Fichier absent.');
      const d = decodeDecor(new Uint8Array(await response.arrayBuffer()));
      if (d.meta.id !== decorId) throw new Error('Le fichier ne correspond plus au décor du lien.');
      decoded.set(decorId, d);
      entries.push({ id: decorId, label: d.meta.label, file: `${decorId}.decor`, tags: d.meta.tags, width: d.meta.width,
        settlements: d.meta.settlements.length, roadKm: d.meta.stats.roadKm, riverKm: d.meta.stats.riverKm, source: { kind: 'server' } });
    } catch {
      catalogue(); status(`Décor du lien introuvable : ${decorId}. Ouvrez son fichier .decor ou choisissez un autre décor.`, true); return;
    }
  }
  catalogue();
  if (!entries.length) { status('Aucun décor. Lancez « node scripts/export_decors.mjs » (serveur npm run dev:terrain), exportez une carte depuis Terrain Bench (Export decor), ou ouvrez / déposez des fichiers .decor.'); return; }
  const first = entries.find(e => e.id === decorId) ?? visible()[0] ?? entries[0];
  await choose(first.id, !!city || initialCityRemoved, !query.has('urban'), query.has('roads'));
})();
