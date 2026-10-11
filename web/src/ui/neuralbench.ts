// Prototype bench for the neural relief chain: network properties, raw
// relief without erosion, and a minimal slope-following hydrology.
import './terrainbench.css';
import './neuralbench.css';
import type { TerrainData } from '../../../rust/bridge/terrain';
import { renderRustTerrain, terrainContourWidths, type TerrainStyle } from '../../../rust/bridge/terrainRender';
import { encodePng, pngDataUrl } from '../render/raster';
import { PALETTES } from '../render/styles';
import { clampView, fitView, panBy, screenToWorld, zoomAt, type View } from '../render/view';
import { vectorRivers, type RiverNetwork, type RiverSettings } from './riverVectors';
import { computeHydrology, downsample, waterBodies, type SimpleHydrology, type WaterBodies } from './simpleHydrology';
import { createPins } from './pins';
import { pinsFromString, pinsToString, viewFromString } from './share';

const EXTENT = 40000, RESOLUTION = 1024;
const COASTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
/** Sketch climates of `crates/neural/src/sketch.rs`: T °C, σT (°C × 100), rain mm, rain CV %. */
const CLIMATES: Record<string, [number, number, number, number]> = {
  temperate: [18, 600, 1000, 35], oceanic: [11, 450, 1300, 25], mediterranean: [16, 550, 600, 60],
  arid: [23, 800, 150, 85], cold: [1, 1100, 550, 35], tropical: [26, 150, 2300, 50],
};
const CLIMATE_FIELDS = ['temperature', 'temperatureStd', 'precipitation', 'precipitationCv'] as const;

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const value = (id: string): string => el<HTMLInputElement | HTMLSelectElement>(id).value;
const number = (id: string): number => Number(value(id));
const map = document.getElementById('map') as unknown as SVGSVGElement;
const viewport = el('viewport');
const status = el('status');
const query = new URLSearchParams(location.search);

// Every identified control round-trips through the URL.
const controls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('header [id], .stages [id], nav [id]'))
  .filter(control => control instanceof HTMLInputElement || control instanceof HTMLSelectElement);
for (const control of controls) {
  const raw = query.get(control.id);
  if (raw === null) continue;
  if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = raw !== '0';
  else control.value = raw;
}
if (query.get('neural')) input('server').value = query.get('neural')!;
let coastMask = (query.get('coasts') ?? '').split(',').reduce((mask, d) => {
  const i = (COASTS as readonly string[]).indexOf(d);
  return i < 0 ? mask : mask | (1 << i);
}, 0);
if (query.get('temperature') === null) applyClimate();

const displayIds = new Set(['auto', 'style', 'showContours', 'showWater', 'showLakes', 'showOxbows', 'overlay', 'showPins']);
const readControls = (): Map<string, string> => new Map(controls.map(control => [control.id,
  control instanceof HTMLInputElement && control.type === 'checkbox' ? (control.checked ? '1' : '0') : control.value]));
// A shared link describes the displayed map, even with Auto off or a request in flight.
let appliedControls = readControls(), appliedCoastMask = coastMask;
const applied = (id: string): string => appliedControls.get(id)!;
let displayedControls = appliedControls, displayedCoastMask = appliedCoastMask;

function applyClimate(): void {
  const preset = CLIMATES[value('climate')];
  if (preset) CLIMATE_FIELDS.forEach((id, k) => { input(id).value = String(preset[k]); });
}
function syncControls(): void {
  el('mixControl').hidden = value('relief') !== 'mixed';
  el('islandControl').hidden = coastMask !== 255;
  el('mixValue').textContent = `${Math.round(number('mix') * 100)} %`;
  const fixed = value('reliefMode') === 'fixed';
  el('reliefScaleControl').hidden = fixed; el('reliefFixedControl').hidden = !fixed;
  document.querySelectorAll<HTMLButtonElement>('[data-coast]').forEach(button => {
    button.setAttribute('aria-pressed', String(!!(coastMask & (1 << COASTS.indexOf(button.dataset.coast as typeof COASTS[number])))));
  });
  el('coastAll').setAttribute('aria-pressed', String(coastMask === 255));
}

/** Service query: sketch, climate and network properties. */
function networkParams(snapshot: Map<string, string>, coasts: number): URLSearchParams {
  const value = (id: string): string => snapshot.get(id)!;
  const number = (id: string): number => Number(value(id));
  const params = new URLSearchParams({
    seed: value('seed') || '42', relief: value('relief'), mix: value('mix'), coasts: String(coasts), islands: value('islands'),
    landScale: value('landScale'), noise: value('noise'), steps: value('steps'), detail: value('detail'),
    histogram: [0, 1, 2, 3, 4].map(k => number(`h${k}`) || 0).join(','),
  });
  for (const id of CLIMATE_FIELDS) params.set(id, value(id));
  for (const id of ['noiseTemperature', 'noiseTemperatureStd', 'noisePrecipitation', 'noisePrecipitationCv']) params.set(id, value(id));
  if (value('reliefMode') === 'fixed') params.set('reliefFixed', value('reliefFixed'));
  else params.set('reliefScale', value('reliefScale'));
  return params;
}

interface Meta {
  min: number; max: number; land: number; totalMs: number; coarseMs: number; baseMs: number; decoderMs: number; reconstructionMs: number;
  evaluations: [number, number, number]; profile: string;
  coarse?: { sketch: number; elevation: number; relief: number; reliefUsed: number; cells: number };
}
let networkKey = '', meta: Meta | undefined, requestMs = 0;
let terrain: TerrainData | undefined;
let hydro: SimpleHydrology | undefined, hydroKey = '';
let bodies: WaterBodies | undefined;
let rivers: RiverNetwork | undefined, riversKey = '';
let sceneKey = '', terrainSvg = '';
let view: View = viewFromString(query.get('view')) ?? fitView(EXTENT, viewport.clientWidth, viewport.clientHeight);
let busy = false, pending = false;

function surface(height: Float32Array): TerrainData {
  const n = RESOLUTION, cell = EXTENT / n;
  const normalX = new Float32Array(n * n), normalY = new Float32Array(n * n), normalZ = new Float32Array(n * n);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, h = height[i];
    min = Math.min(min, h); max = Math.max(max, h);
    const xl = Math.max(0, x - 1), xr = Math.min(n - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(n - 1, y + 1);
    const gx = (height[y * n + xr] - height[y * n + xl]) / ((xr - xl) * cell);
    const gy = (height[yd * n + x] - height[yu * n + x]) / ((yd - yu) * cell);
    const length = Math.hypot(gx, gy, 1);
    normalX[i] = -gx / length; normalY[i] = -gy / length; normalZ[i] = 1 / length;
  }
  return {
    x: 0, y: 0, width: EXTENT, resolution: n, minHeight: min, maxHeight: max, globalMinHeight: min, globalMaxHeight: max,
    motifSize: 3000, height, caveMask: new Uint8Array(0), normalX, normalY, normalZ, generationMs: 0,
  };
}

async function fetchRelief(params: URLSearchParams, server: string): Promise<void> {
  server = server.replace(/\/$/, '');
  const started = performance.now();
  let response: Response;
  try { response = await fetch(`${server}/generate?${params}`, { cache: 'no-store' }); }
  catch { throw new Error(`service neuronal injoignable (${server}) : lancer « npm run neural:serve » dans web/`); }
  if (!response.ok) throw new Error(`service neuronal : ${await response.text()}`);
  const heights = new Float32Array(await response.arrayBuffer());
  if (heights.length !== RESOLUTION * RESOLUTION) throw new Error('service neuronal : surface incomplète');
  meta = JSON.parse(response.headers.get('X-Neural-Meta') ?? '{}') as Meta;
  requestMs = performance.now() - started;
  terrain = surface(heights);
}

function waterSettings(): { riverArea: number; lakeDepth: number; lakeArea: number } {
  return { riverArea: Math.max(0.01, Number(applied('riverArea'))), lakeDepth: Math.max(0, Number(applied('lakeDepth'))), lakeArea: Math.max(0, Number(applied('lakeArea'))) };
}
function riverSettings(): RiverSettings {
  return {
    riverArea: waterSettings().riverArea, flatSlope: Math.max(0, Number(applied('flatSlope'))), sinuosity: Math.max(1, Number(applied('sinuosity'))),
    widthScale: Math.max(0.1, Number(applied('widthScale'))), seed: applied('seed') || '42',
  };
}

async function run(): Promise<void> {
  if (busy) { pending = true; return; }
  busy = true;
  el('generate').setAttribute('aria-busy', 'true');
  status.dataset.error = 'false';
  try {
    if (!value('seed')) input('seed').value = '42';
    const snapshot = readControls(), coasts = coastMask;
    const params = networkParams(snapshot, coasts);
    const key = `${snapshot.get('server')}?${params}`;
    if (key !== networkKey) {
      status.textContent = 'Calcul des réseaux…';
      await fetchRelief(params, snapshot.get('server')!);
      networkKey = key; hydro = undefined; hydroKey = ''; sceneKey = '';
    }
    if (!terrain) return;
    appliedControls = snapshot; appliedCoastMask = coasts;
    if (applied('hydroEnabled') === '1') {
      const resolution = Number(applied('hydroResolution'));
      if (!hydro || hydroKey !== `${networkKey}|${resolution}`) {
        status.textContent = 'Hydrologie…';
        await new Promise(requestAnimationFrame);
        const factor = RESOLUTION / resolution;
        hydro = computeHydrology(downsample(terrain.height, RESOLUTION, factor), resolution, EXTENT);
        hydroKey = `${networkKey}|${resolution}`;
      }
      bodies = waterBodies(hydro, waterSettings());
      const key = `${hydroKey}|${JSON.stringify(waterSettings())}|${JSON.stringify(riverSettings())}`;
      if (applied('riverMode') === 'vector' && (!rivers || riversKey !== key)) {
        status.textContent = 'Tracé des rivières…';
        await new Promise(requestAnimationFrame);
        rivers = vectorRivers(hydro, bodies.lake, riverSettings());
        riversKey = key;
      }
    } else bodies = undefined;
    render();
    saveUrl();
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = error instanceof Error ? error.message : String(error);
    void checkService();
  } finally {
    busy = false;
    el('generate').removeAttribute('aria-busy');
    if (pending) { pending = false; void run(); }
  }
}

const style = (): TerrainStyle => value('style') as TerrainStyle;
const format = (v: number): string => v.toFixed(1);

function rasterImage(rgba: Uint8Array, n: number, attributes = ''): string {
  return `<image width="${EXTENT}" height="${EXTENT}" href="${pngDataUrl(encodePng(rgba, n, n, 4, 1))}" ${attributes}/>`;
}

function waterSvg(h: SimpleHydrology, water: WaterBodies): string {
  const s = style(), pal = PALETTES[s === 'copernicus' ? 'parchment' : s];
  // Lakes take the rivers' colour: a river runs into its lake without a seam.
  const edge = style() === 'copernicus' ? '#14527a' : pal.waterEdge, fill = edge;
  const n = h.n, cell = EXTENT / n;
  const lakes = new Uint8Array(n * n * 4);
  const [r, g, b] = [1, 3, 5].map(k => parseInt(fill.slice(k, k + 2), 16));
  for (let c = 0; c < n * n; c++) if (water.lake[c]) lakes.set([r, g, b, 255], c * 4);
  // River width grows with the logarithm of upstream area, in screen pixels.
  const threshold = waterSettings().riverArea * 1e6;
  const classes: string[] = [];
  const widthClass = (area: number): number => Math.max(0, Math.min(9, Math.floor(Math.log2(area / threshold))));
  if (applied('riverMode') === 'vector' && rivers) {
    // Each line is split where its width class changes; pieces share their end vertex.
    // Oxbows are drawn one class thinner than their river.
    for (const line of [...(input('showOxbows').checked ? rivers.oxbows : []), ...rivers.rivers]) {
      const { points, area } = line, thinner = rivers.oxbows.includes(line) ? 1 : 0;
      let k = Math.max(0, widthClass(area[0]) - thinner), d = `M${format(points[0])},${format(points[1])}`;
      for (let i = 1; i < area.length; i++) {
        d += `L${format(points[2 * i])},${format(points[2 * i + 1])}`;
        const next = Math.max(0, widthClass(area[i]) - thinner);
        if (next !== k || i === area.length - 1) {
          classes[k] = (classes[k] ?? '') + d;
          k = next; d = `M${format(points[2 * i])},${format(points[2 * i + 1])}`;
        }
      }
    }
  } else for (let c = 0; c < n * n; c++) {
    const a = h.accumulation[c], next = h.receiver[c];
    if (h.sea[c] || water.lake[c] || a < threshold || next < 0) continue;
    const k = widthClass(a);
    const x = c % n, y = (c - x) / n, nx = next % n, ny = (next - nx) / n;
    classes[k] = (classes[k] ?? '') + `M${format((x + 0.5) * cell)},${format((y + 0.5) * cell)}L${format((nx + 0.5) * cell)},${format((ny + 0.5) * cell)}`;
  }
  let svg = `<g class="water">${input('showLakes').checked ? rasterImage(lakes, n) : ''}`;
  classes.forEach((d, k) => { if (d) svg += `<path d="${d}" fill="none" stroke="${edge}" stroke-width="${(0.7 + 0.45 * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`; });
  return svg + '</g>';
}

function overlaySvg(h: SimpleHydrology, overlay: string): string {
  const n = h.n, rgba = new Uint8Array(n * n * 4);
  if (overlay === 'accumulation') {
    const top = Math.log10(h.accumulation.reduce((m, v) => Math.max(m, v), 0) / h.cellArea);
    for (let c = 0; c < n * n; c++) {
      if (h.sea[c]) continue;
      const t = Math.log10(h.accumulation[c] / h.cellArea) / Math.max(1, top);
      rgba.set([20, 60 + 120 * t, 160 + 95 * t, Math.round(255 * Math.min(1, t * 1.3))], c * 4);
    }
  } else if (overlay === 'basins') {
    for (let c = 0; c < n * n; c++) {
      if (h.sea[c]) continue;
      const id = Math.imul(h.basin[c] + 1, 2654435761) >>> 0;
      rgba.set([id & 255, (id >>> 8) & 255, (id >>> 16) & 255, 120], c * 4);
    }
  } else if (overlay === 'depth') {
    for (let c = 0; c < n * n; c++) {
      const depth = h.filled[c] - h.height[c];
      if (h.sea[c] || depth <= 0) continue;
      const t = Math.min(1, Math.sqrt(depth / 50));
      rgba.set([200, 40 + 80 * (1 - t), 30, Math.round(90 + 165 * t)], c * 4);
    }
  } else return '';
  return rasterImage(rgba, n, 'style="image-rendering:pixelated"');
}

function render(): void {
  if (!terrain) return;
  const key = `${networkKey}|${style()}|${input('showContours').checked}`;
  if (key !== sceneKey) {
    const relief = applied('relief') === 'flat' || applied('relief') === 'hills' || applied('relief') === 'valley' ? applied('relief') : 'mountains';
    terrainSvg = renderRustTerrain(terrain, style(), true, { relief: relief as 'mountains', width: EXTENT }, input('showContours').checked).svg;
    sceneKey = key;
  }
  let svg = terrainSvg;
  if (hydro && bodies && applied('hydroEnabled') === '1') {
    svg += overlaySvg(hydro, value('overlay'));
    if (input('showWater').checked) svg += waterSvg(hydro, bodies);
  }
  map.innerHTML = svg;
  map.append(measureLayer);
  displayedControls = appliedControls; displayedCoastMask = appliedCoastMask;
  updateView();
  report();
}

function percentile(sorted: Float32Array, p: number): number { return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; }

function report(): void {
  if (!terrain || !meta) return;
  const n = RESOLUTION, cell = EXTENT / n, land = terrain.height.filter(h => h > 0).sort();
  let slope = 0, count = 0;
  for (let i = 0; i < n * n; i++) if (terrain.height[i] > 0) { slope += Math.acos(Math.min(1, terrain.normalZ[i])); count++; }
  const m = (v: number): string => `${Math.round(v)} m`;
  const c = meta.coarse;
  const t = `${Math.round(requestMs)} ms · coarse ${Math.round(meta.coarseMs)} · base ${Math.round(meta.baseMs)} · decoder ${Math.round(meta.decoderMs)} · reconstruction ${Math.round(meta.reconstructionMs)}`;
  const rows: [string, string][] = [
    ['Service', t], ['Évaluations', meta.evaluations.join(' / ') + ` · ${meta.profile}`],
  ];
  if (c) rows.push(
    ['Esquisse (moy.)', m(c.sketch)], ['Coarse altitude (moy.)', m(c.elevation)],
    ['Coarse relief local', m(c.relief)], ['Relief local → base', m(c.reliefUsed)],
  );
  if (land.length) rows.push(
    ['Altitudes terres', `p5 ${m(percentile(land, 0.05))} · médiane ${m(percentile(land, 0.5))} · p95 ${m(percentile(land, 0.95))}`],
    ['Extrêmes', `${m(meta.min)} … ${m(meta.max)}`],
    ['Pente moyenne', `${(slope / Math.max(1, count) * 180 / Math.PI).toFixed(1)}° (cellule ${cell.toFixed(0)} m)`],
  );
  rows.push(['Terres', `${(land.length / (n * n) * 100).toFixed(1)} %`]);
  if (hydro && bodies) rows.push(
    ['Hydrologie', `${Math.round(hydro.ms)} ms · ${hydro.n}² · ${hydro.outlets} exutoires`],
    ['Lacs', `${bodies.lakes} · ${bodies.lakeAreaKm2.toFixed(1)} km²`],
    ['Cellules de rivière', String(bodies.riverCells)],
  );
  if (hydro && bodies && rivers && applied('riverMode') === 'vector') rows.push(
    ['Rivières vectorielles', `${Math.round(rivers.ms)} ms · ${rivers.rivers.length} cours · ${rivers.lengthKm.toFixed(0)} km`],
    ['Méandres', `${rivers.meanderRuns} biefs · ${rivers.meanderKm.toFixed(0)} km · ${rivers.oxbows.length} bras morts`],
  );
  el('report').innerHTML = rows.map(([k, v]) => `<p><small><b>${k}</b><br>${v}</small></p>`).join('');
  status.textContent = c
    ? `Esquisse ${m(c.sketch)} → coarse ${m(c.elevation)}, relief local ${m(c.relief)} → base ${m(c.reliefUsed)} · terres p5–p95 ${land.length ? `${m(percentile(land, 0.05))}–${m(percentile(land, 0.95))}` : '—'} · ${t}`
    : t;
  el('hydroState').textContent = hydro && bodies ? `${bodies.lakes} lacs · ${Math.round(hydro.ms)} ms` : '';
}

function saveUrl(): void {
  const params = new URLSearchParams();
  for (const control of controls) {
    if (control.id === 'server') continue;
    params.set(control.id, displayIds.has(control.id)
      ? control instanceof HTMLInputElement && control.type === 'checkbox' ? (control.checked ? '1' : '0') : control.value
      : displayedControls.get(control.id)!);
  }
  if (displayedControls.get('server') !== 'http://127.0.0.1:8792') params.set('neural', displayedControls.get('server')!);
  params.set('coasts', COASTS.filter((_, k) => displayedCoastMask & (1 << k)).join(','));
  if (pins.pins.length) params.set('pins', pinsToString(pins.pins));
  // Preserve enough precision for stable camera round-trips and pin placement.
  params.set('view', `${view.cx},${view.cy},${view.scale}`);
  const url = new URL(location.href); url.search = params.toString();
  try { history.replaceState(null, '', url.href); } catch { /* Standalone file URLs may disallow replaceState. */ }
  shareUrl = url.href;
}
let shareUrl = location.href;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function deferSave(): void { clearTimeout(saveTimer); saveTimer = setTimeout(saveUrl, 150); }

let pinMode = false;
const pins = createPins({
  map: viewport, layer: el('pinLayer'), pop: el('pinPopover'), list: el('pins'),
  onChange: saveUrl,
  onFocus: pin => {
    input('showPins').checked = true; showPins();
    view = { ...view, cx: pin.x, cy: pin.y }; updateView();
  },
});
pins.set(pinsFromString(query.get('pins')).filter(pin => pin.x >= 0 && pin.y >= 0 && pin.x <= EXTENT && pin.y <= EXTENT));
const pinInput = el('pinPopover').querySelector('input')!;
pinInput.placeholder = 'Note du pin'; pinInput.setAttribute('aria-label', 'Note du pin');
const pinDelete = el('pinPopover').querySelector('button')!;
pinDelete.textContent = 'Supprimer'; pinDelete.title = 'Supprimer ce pin';

function showPins(): void {
  el('pinLayer').hidden = !input('showPins').checked;
  if (!input('showPins').checked) el('pinPopover').hidden = true;
}
function setPinMode(active: boolean): void {
  if (active) setMeasuring(false);
  pinMode = active; viewport.classList.toggle('pin-mode', active);
  el('pinMode').setAttribute('aria-pressed', String(active));
}
el('pinMode').onclick = () => setPinMode(!pinMode);
input('showPins').addEventListener('change', () => { showPins(); saveUrl(); });
showPins();

async function checkService(): Promise<void> {
  const state = el('neuralState');
  try {
    const response = await fetch(`${value('server').replace(/\/$/, '')}/status`, { cache: 'no-store' });
    const s = await response.json() as { state: string; message: string };
    state.dataset.state = s.state; state.textContent = s.message;
    if (s.state === 'loading' || s.state === 'warming') setTimeout(() => void checkService(), 2000);
  } catch { state.dataset.state = 'error'; state.textContent = 'Service absent'; }
}

// View: same SVG viewBox camera as the terrain bench.
type MeasurePoint = [number, number];
const measureLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
measureLayer.classList.add('distance-measure');
map.append(measureLayer);
let measuring = false, measureStart: MeasurePoint | undefined, measureEnd: MeasurePoint | undefined, measureComplete = false;

function updateMeasure(): void {
  el<HTMLButtonElement>('clearMeasure').disabled = !measureStart;
  if (!measureStart) { measureLayer.replaceChildren(); el('distance').textContent = ''; return; }
  const [x, y] = measureStart, radius = 4 / view.scale;
  let svg = `<circle cx="${x}" cy="${y}" r="${radius}" vector-effect="non-scaling-stroke"/>`;
  if (measureEnd) {
    const [ex, ey] = measureEnd, metres = Math.hypot(ex - x, ey - y);
    const label = metres < 1000 ? `${metres.toFixed(1)} m` : `${(metres / 1000).toFixed(2)} km`;
    svg = `<line x1="${x}" y1="${y}" x2="${ex}" y2="${ey}" vector-effect="non-scaling-stroke"/>` + svg
      + `<circle cx="${ex}" cy="${ey}" r="${radius}" vector-effect="non-scaling-stroke"/>`
      + `<text x="${(x + ex) / 2}" y="${(y + ey) / 2 - 10 / view.scale}" font-size="${12 / view.scale}" vector-effect="non-scaling-stroke">${label}</text>`;
    el('distance').textContent = label;
  } else el('distance').textContent = 'Choisir l’arrivée';
  measureLayer.innerHTML = svg;
}

function setMeasuring(active: boolean): void {
  if (active) setPinMode(false);
  measuring = active;
  map.classList.toggle('measuring', active);
  el('measure').setAttribute('aria-pressed', String(active));
  el('measureHint').hidden = !active;
  if (!active && !measureComplete) { measureStart = undefined; measureEnd = undefined; }
  updateMeasure();
}

el('measure').onclick = () => setMeasuring(!measuring);
el('clearMeasure').onclick = () => { measureStart = undefined; measureEnd = undefined; measureComplete = false; updateMeasure(); };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { setMeasuring(false); setPinMode(false); }
});

function updateView(): void {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  view = clampView(view, EXTENT, w, h);
  const widths = terrainContourWidths(style(), view.scale);
  map.style.setProperty('--terrain-contour-width', `${widths.thin}px`);
  map.style.setProperty('--terrain-contour-index-width', `${widths.index}px`);
  map.setAttribute('viewBox', `${view.cx - w / (2 * view.scale)} ${view.cy - h / (2 * view.scale)} ${w / view.scale} ${h / view.scale}`);
  el('scale').textContent = `${(1 / view.scale).toFixed(1)} m / px`;
  pins.update(view, w, h);
  updateMeasure();
  deferSave();
}
const zoom = (factor: number, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2): void => {
  view = zoomAt(view, factor, x, y, viewport.clientWidth, viewport.clientHeight); updateView();
};
const local = (event: MouseEvent): [number, number] => {
  const bounds = viewport.getBoundingClientRect(); return [event.clientX - bounds.left, event.clientY - bounds.top];
};
let drag: [number, number] | undefined;
const measurePoint = (point: [number, number]): MeasurePoint | undefined => {
  const [x, y] = screenToWorld(view, viewport.clientWidth, viewport.clientHeight, ...point);
  return x >= 0 && y >= 0 && x <= EXTENT && y <= EXTENT ? [x, y] : undefined;
};
map.addEventListener('pointerdown', event => {
  if ((pinMode || event.altKey) && event.button === 0) {
    event.preventDefault();
    const point = measurePoint(local(event));
    if (!point) return;
    input('showPins').checked = true; showPins(); pins.add(...point);
  } else if (measuring && event.button === 0) {
    const point = measurePoint(local(event));
    if (!point) return;
    if (!measureStart || measureComplete) { measureStart = point; measureEnd = undefined; measureComplete = false; }
    else { measureEnd = point; measureComplete = true; }
    updateMeasure();
  } else if (event.button === 0 || event.button === 1) {
    event.preventDefault(); drag = local(event); map.setPointerCapture(event.pointerId); map.classList.add('drag');
  }
});
map.addEventListener('pointermove', event => {
  const point = local(event);
  if (drag) { view = panBy(view, point[0] - drag[0], point[1] - drag[1]); drag = point; updateView(); }
  else if (measuring && measureStart && !measureComplete) {
    measureEnd = measurePoint(point); updateMeasure();
  }
  if (!terrain) return;
  const [x, y] = screenToWorld(view, viewport.clientWidth, viewport.clientHeight, ...point);
  if (x < 0 || y < 0 || x >= EXTENT || y >= EXTENT) { el('coordinates').textContent = ''; return; }
  const i = Math.floor(y / EXTENT * RESOLUTION) * RESOLUTION + Math.floor(x / EXTENT * RESOLUTION);
  let text = `${(x / 1000).toFixed(2)} km, ${(y / 1000).toFixed(2)} km · ${terrain.height[i].toFixed(1)} m`;
  if (hydro) {
    const c = Math.floor(y / EXTENT * hydro.n) * hydro.n + Math.floor(x / EXTENT * hydro.n);
    const depth = hydro.filled[c] - hydro.height[c];
    text += ` · amont ${(hydro.accumulation[c] / 1e6).toFixed(2)} km²${depth > 0 && !hydro.sea[c] ? ` · cuvette ${depth.toFixed(1)} m` : ''}`;
  }
  el('coordinates').textContent = text;
});
const stop = (): void => { drag = undefined; map.classList.remove('drag'); };
map.addEventListener('pointerup', stop); map.addEventListener('pointercancel', stop);
map.addEventListener('wheel', event => {
  event.preventDefault();
  const dy = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
  zoom(Math.exp(-Math.max(-1000, Math.min(1000, dy)) * 0.0015), ...local(event));
}, { passive: false });
el('fit').onclick = () => { view = fitView(EXTENT, viewport.clientWidth, viewport.clientHeight); updateView(); };
el('zoomIn').onclick = () => zoom(1.4);
el('zoomOut').onclick = () => zoom(1 / 1.4);
el('copy').onclick = async () => {
  saveUrl();
  try {
    await navigator.clipboard.writeText(shareUrl);
    el('shareState').textContent = 'Lien copié : carte, pins et vue.';
  } catch { el('shareState').textContent = 'Copie impossible : copier l’URL depuis la barre d’adresse.'; }
};
new ResizeObserver(updateView).observe(viewport);
// Camera hook for screenshot scripts: centre in metres, scale in px per metre.
(window as unknown as { __setView: (cx: number, cy: number, scale: number) => void }).__setView = (cx, cy, scale) => {
  view = { cx, cy, scale }; updateView();
};

// Inputs: network and water settings recompute (automatically with Auto); display only re-renders.
let timer: ReturnType<typeof setTimeout> | undefined;
const schedule = (): void => {
  syncControls();
  clearTimeout(timer);
  if (!input('auto').checked) return;
  timer = setTimeout(() => void run(), 350);
};
document.querySelector('.stages')!.addEventListener('change', event => {
  const target = event.target as HTMLElement;
  if (target.id === 'climate') applyClimate();
  else if ((CLIMATE_FIELDS as readonly string[]).includes(target.id)) el<HTMLSelectElement>('climate').value = 'custom';
  schedule();
});
input('mix').addEventListener('input', syncControls);
input('seed').addEventListener('change', schedule);
el('generate').onclick = () => void run();
el('randomSeed').onclick = () => { input('seed').value = crypto.getRandomValues(new Uint32Array(1))[0].toString(36); void run(); };
input('auto').addEventListener('change', () => { saveUrl(); schedule(); });
document.querySelectorAll<HTMLButtonElement>('[data-coast]').forEach(button => {
  button.onclick = () => { coastMask ^= 1 << COASTS.indexOf(button.dataset.coast as typeof COASTS[number]); schedule(); };
});
el('coastAll').onclick = () => { coastMask = coastMask === 255 ? 0 : 255; schedule(); };
el('histogramHero').onclick = () => { [0, 0, 0, 1, 1.5].forEach((v, k) => { input(`h${k}`).value = String(v); }); schedule(); };
el('histogramZero').onclick = () => { [0, 1, 2, 3, 4].forEach(k => { input(`h${k}`).value = '0'; }); schedule(); };
input('server').addEventListener('change', () => { void checkService(); schedule(); });
for (const id of ['style', 'showContours', 'showWater', 'showLakes', 'showOxbows', 'overlay']) el(id).addEventListener('change', () => { render(); saveUrl(); });

syncControls();
updateView();
void checkService();
void run();
