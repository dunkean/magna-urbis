import { urbanOptionSync } from './urbanOptionSync';
import { createUrbanLanduse } from './urbanLanduse';
import type { Relief } from '../gen/options';
import SettlementWorker from './settlementWorker?worker&inline';
import { defaultSettlementConfig, defaultSettlementSpec, settlementRaster, runSettlementRequest, type Point, type RoadSite, type SettlementConfig, type SettlementOutput, type SettlementRequest, type SettlementResponse, type SettlementSpec } from '../../../rust/bridge/settlements';
import type { TerrainData, TerrainSettings } from '../../../rust/bridge/terrain';
import type { View } from '../render/view';
import { CULTURES, getCulture } from '../gen/urban/culture';
import { SITE_ARCHETYPES, classOfPop } from '../gen/options';
import { SETTLEMENT_KINDS } from './settlementKinds';
import { createTerrainRoads } from './terrainRoads';
import { createTerrainUrban } from './terrainUrban';
import { captureDecor, downloadBytes } from './decorCapture';
import { decorEntry, encodeDecor, type Decor, type DecorEntry } from './decor';
import type { UrbanPaintingContext } from '../../../rust/bridge/urbanPaintingMask';

const ns = 'http://www.w3.org/2000/svg';
// Small cartographic silhouettes, centred on the settlement's actual position.
const settlementSymbols: Record<ReturnType<typeof classOfPop>, string> = {
  farmstead: 'M-11-2 0-12 11-2H8V9H-8V-2ZM-2 9H2V2H-2Z',
  hamlet: 'M-14 0-8-6-2 0H-4V9H-12V0ZM1-4 8-11 15-4H13V9H3V-4Z',
  village: 'M-15 2-10-3-5 2H-6V9H-14V2ZM-6-5 0-12 6-5H4V9H-4V-5ZM5 2 10-3 15 2H14V9H6V2Z',
  town: 'M-14 9V-9H-10V-5H-6V-9H-2V-2H2V-9H6V-5H10V-9H14V9ZM-3 9H3V3Q3-1 0-1T-3 3Z',
  city: 'M-15 9V-4L-10-9-5-4V-1H-4V-9L0-16 4-9V-1H5V-4L10-9 15-4V9ZM-3 9H3V3Q3 0 0 0T-3 3Z',
  metropolis: 'M-15 9V-4H-10V-11H-4V9ZM-1 9V-15H5V9ZM8 9V-7H14V9Z',
  megacity: 'M-16 9V-7H-11V9ZM-8 9V-15H-2V9ZM1 9V-19H6V9ZM9 9V-11H15V9Z',
};
const clone = <T>(value: T): T => structuredClone(value);
const esc = (text: string): string => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
function prefs(spec: SettlementSpec): SettlementSpec {
  const p = getCulture(spec.culture).sitePrefs ?? {};
  return { ...spec, sitePrefs: { mountainFace: p.mountainFace ?? 0, woodland: p.woodland ?? 0, weights: { ...p.weights }, ...spec.sitePrefs } };
}
/** Saved placement options: known keys only (older links also carried road options). */
function restore(saved: Partial<SettlementConfig> | undefined, base: SettlementConfig): SettlementConfig {
  const config = clone(base);
  for (const key of Object.keys(base) as (keyof SettlementConfig)[]) if (saved?.[key] !== undefined) (config as unknown as Record<string, unknown>)[key] = saved[key];
  config.main = { ...base.main, ...saved?.main }; config.counts = { ...base.counts, ...saved?.counts }; config.siteWeights = { ...saved?.siteWeights };
  return config;
}
const sites = (output: SettlementOutput): RoadSite[] => output.settlements.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius }));

export function createTerrainSettlements(options: {
  map: SVGSVGElement; viewport: HTMLElement; getTerrain(): TerrainData | undefined; getSettings(): TerrainSettings;
  active?: boolean; parcelDefault?: boolean; getRaster?(): import('../../../rust/bridge/settlements').SettlementRaster | undefined; getDecor?(): Decor | undefined;
  getView(): View; getAuto?(): boolean; getQuery?(): string; onChange(): void; onPlanChange?(): void; onPicking(): void; onFocus?(center: Point, radius: number): void;
}) {
  const { map, viewport } = options;
  let restoringDecor = false;
  let config = defaultSettlementConfig(), enabled = true, showPoints = true;
  let selection = '', picking: 'new' | string | undefined, output: SettlementOutput | undefined;
  let cachedTerrain: TerrainData | undefined, worker: Worker | undefined, id = 0, timer: ReturnType<typeof setTimeout> | undefined;
  // Placement reruns only when its inputs changed; road edits reroute between the current places.
  let complete = false, needsPlacement = true, validation: { width: number; n: number; water: Uint8Array } | undefined;
  let fallback = false, answered = 0;
  let drawnLayer: SVGGElement | undefined, drawnOutput: SettlementOutput | undefined, drawnState = '';
  let drag: { key: string; pointer: number; start: Point; point: Point; moved: boolean } | undefined;
  const initial = new URLSearchParams(location.search).get('settlements');
  const width = options.getSettings().width;
  config.main.population = width >= 30000 ? 20000 : width >= 10000 ? 3000 : 300;
  let legacyRoads: boolean | undefined;
  if (initial) try {
    const saved = JSON.parse(initial);
    config = restore(saved.config, config); config.list = saved.config?.list ?? [];
    enabled = saved.enabled !== false; showPoints = saved.showPoints !== false;
    if (saved.config?.roads === false || saved.showRoads === false) legacyRoads = false;
  } catch { /* An incomplete shared link keeps defaults. */ }
  const panel = document.createElement('details'); panel.className = 'stage settlement-stage'; panel.open = true; panel.id = 'settlementStage';
  const number = (key: keyof SettlementConfig, label: string, min: number, max: number, step: number, title = '', show = ''): string =>
    `<label title="${esc(title)}"${show ? ` data-show="${show}"` : ''}>${label}<input data-setting="${key}" type="number" min="${min}" max="${max}" step="${step}"></label>`;
  panel.innerHTML = `<summary>4 · Settlements <span id="setState"></span></summary><div class="stage-controls">
    <label><input id="setEnabled" type="checkbox">Generate settlements</label>
    <label>Composition <select id="setMode"><option value="auto">Automatic</option><option value="counts">By class counts</option><option value="list">Editable list</option></select></label>
    <label data-show="auto" title="Rank-size: rank r holds main ÷ r^q inhabitants. Classes: the legacy city/town/village bands sized by the usable land.">Distribution <select id="setDistribution"><option value="zipf">Rank-size (Zipf)</option><option value="classes">Class bands</option></select></label>
    <label>Main population <input id="setMainPop" type="number" min="1" max="5000000" step="1"></label>
    <div class="control-group" data-show="auto">
      ${number('density', 'Density ×', 0, 10, 0.1, 'Number of places; rank-size: ×1 = 10 places per 100 km² of usable land')}
      ${number('zipfExponent', 'Rank-size exponent q', 0.3, 3, 0.05, 'Higher: steeper hierarchy, fewer large towns', 'zipf')}
      ${number('minPopulation', 'Smallest place', 1, 100000, 1, '', 'zipf')}
      ${number('populationJitter', 'Population spread', 0, 1, 0.05, 'Log-normal spread around the rank-size curve', 'zipf')}
    </div>
    <label>Default culture <select id="setCulture"></select></label>
    <div id="setCounts" class="control-group" hidden>${['city', 'town', 'village', 'hamlet', 'farmstead'].map(cls => `<label>${cls}<input data-count="${cls}" type="number" min="0" max="1000" step="1"></label>`).join('')}</div>
    <div class="settlement-actions"><button id="setGenerate" type="button">Recalculate settlements</button><button id="setTakeOver" type="button">Edit generated list</button><button id="setAdd" type="button">Place a settlement</button><button id="setExportDecor" type="button" title="Save terrain, water, settlements and roads as a decor for the Urban Bench">Export decor</button></div>
    <small id="setPickHint">Select a marker to inspect its scores. Drag it to move it: only the roads are recalculated.</small>
    <details class="advanced"><summary>Spacing</summary><div class="control-group">
    ${number('spread', 'Spacing ×', 0.1, 5, 0.1, 'Automatic composition')}${number('smallTop', 'Best land share for small places', 0, 1, 0.05)}${number('mainClear', 'Main settlement clearance × radius', 0, 10, 0.1)}
    ${number('clustering', 'Clustering', 0, 5, 0.1, 'Small places drawn towards much larger ones (satellites)')}${number('edgeMargin', 'Border margin (share of width)', 0, 0.3, 0.01)}
    </div></details>
    <details class="advanced"><summary>Geography</summary><div class="control-group">
    ${number('flatnessWeight', 'Flat ground', 0, 10, 0.1)}${number('buildableWeight', 'Buildable land', 0, 10, 0.1)}${number('freshWaterWeight', 'Fresh water', 0, 10, 0.1)}
    ${number('riverWeight', 'River access', 0, 10, 0.1)}${number('coastWeight', 'Coast & harbors', 0, 10, 0.1)}${number('floodWeight', 'Flood avoidance', 0, 10, 0.1)}
    ${number('defenseWeight', 'Defensible heights', 0, 10, 0.1, 'Prominent ground away from water')}${number('elevation', 'Elevation (−1 low · +1 high)', -1, 1, 0.1)}${number('variationWeight', 'Seed variation', 0, 10, 0.1)}
    </div></details>
    <details class="advanced"><summary>Site types</summary><div class="control-group">
    <small>Multipliers on top of each culture's preferences (0 avoids, 1 neutral, 3 favours).</small>
    ${SITE_ARCHETYPES.map(site => `<label>${site}<input data-site="${site}" type="number" min="0" max="10" step="0.1"></label>`).join('')}
    </div></details>
    <label><input id="setShowPoints" type="checkbox">Settlement markers &amp; names</label>
    <small id="setStatus" role="status">Waiting for the completed map…</small>
    <div id="setWarnings" role="status"></div></div>`;
  const backend = document.querySelector('.stages > .backend');
  document.querySelector('.stages')!.insertBefore(panel, backend);
  const roads = createTerrainRoads({
    map, before: backend,
    onConfigChange: () => { options.onChange(); schedule(); },
    onDisplayChange: options.onChange,
  });
  const urban = createTerrainUrban({ map, before: backend, getTerrain: options.getTerrain,
    getRaster: options.getRaster,
    parcelDefault: options.parcelDefault ?? false,
    getSeed: () => options.getSettings().seed, getAuto: options.getAuto, onChange: () => { if (!restoringDecor) publishOptions(urban.workshopDraft() ?? urban.workshopState()); options.onChange(); }, onPlanChange: () => { if (!restoringDecor) publishOptions(urban.workshopDraft() ?? urban.workshopState()); syncLanduse(); options.onPlanChange?.(); }, onFocus: options.onFocus });
  const publishOptions = urbanOptionSync(() => { const d = options.getDecor?.(); return d && urban.target !== 'all' ? `${d.meta.pipeline?.syncSource ?? d.meta.id}:${urban.target}` : undefined; }, state => urban.applyWorkshopDraft(state));
  if (options.active !== false && !document.getElementById('showLanduse')) {
    const label = document.createElement('label'); label.innerHTML = '<input id="showLanduse" type="checkbox" checked>Occupation du territoire';
    document.querySelector('#lightingControls .lighting-fields')!.append(label);
  }
  map.addEventListener('urban:settings', event => publishOptions((event as CustomEvent).detail));
  const landuse = options.active === false ? undefined : createUrbanLanduse({ map, before: backend ?? panel,
    onChange: options.onChange,
    getView: () => ({ view: options.getView(), width: viewport.clientWidth, height: viewport.clientHeight }),
    getBackground: () => ({ opacity: 0 }),
    getDisplayStyle: () => { const style = (document.getElementById('style') as HTMLSelectElement)?.value; return style?.startsWith('fantasy-') ? style : undefined; },
  });
  function syncLanduse(): void {
    const t = options.getTerrain(), raster = options.getRaster?.() ?? (t ? settlementRaster(t) : undefined);
    if (!raster || !output || !enabled) { landuse?.set(); return; }
    const city = output.settlements.find(s => s.key === urban.target) ?? output.settlements.find(s => s.key === selection) ?? output.settlements[0];
    const relief = options.getSettings().relief;
    landuse?.set({ raster, seed: options.getSettings().seed, relief: (['flat', 'hills', 'valley'].includes(relief) ? relief : 'mountains') as Relief,
      city, neighbours: output.settlements.filter(s => s.key !== city?.key), roads: roads.output, layouts: urban.layouts }, urban.layoutPending);
  }
  let paintingContext: UrbanPaintingContext | undefined;
  if (legacyRoads === false && !new URLSearchParams(location.search).has('roads')) {
    const box = document.getElementById('roadEnabled') as HTMLInputElement; box.checked = false; box.dispatchEvent(new Event('change'));
  }
  const places = document.createElement('section'); places.className = 'terrain-places'; places.id = 'terrainSettlements';
  places.innerHTML = '<strong>Settlements <span id="setCount"></span></strong><div id="setList"></div><div id="setEditor"></div>';
  document.querySelector('aside')!.prepend(places);
  const el = <T extends HTMLElement>(name: string): T => document.getElementById(name) as T;
  const input = (name: string): HTMLInputElement => el<HTMLInputElement>(name);
  const mode = el<HTMLSelectElement>('setMode'), culture = el<HTMLSelectElement>('setCulture'), distribution = el<HTMLSelectElement>('setDistribution');
  culture.innerHTML = Object.values(CULTURES).map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');
  function controls(): void {
    input('setEnabled').checked = enabled; mode.value = config.mode; distribution.value = config.distribution;
    input('setMainPop').value = String(config.main.population); input('setMainPop').disabled = config.mode === 'list'; culture.value = config.main.culture;
    el('setCounts').hidden = config.mode !== 'counts';
    for (const e of Array.from(panel.querySelectorAll<HTMLElement>('[data-show]'))) e.hidden = e.dataset.show === 'auto' ? config.mode !== 'auto' : config.distribution !== e.dataset.show;
    input('setShowPoints').checked = showPoints;
    for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-count]'))) c.value = String(config.counts[c.dataset.count!] ?? 0);
    for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-setting]'))) c.value = String(config[c.dataset.setting! as keyof SettlementConfig]);
    for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-site]'))) c.value = String(config.siteWeights[c.dataset.site!] ?? 1);
  }
  function setPicking(key?: string): void {
    picking = key; if (key) { options.onPicking(); showPoints = true; input('setShowPoints').checked = true; }
    viewport.classList.toggle('settlement-picking', !!key);
    el('setPickHint').textContent = key ? 'Click dry land on the map. Esc cancels.' : 'Select a marker to inspect its scores. Drag it to move it: only the roads are recalculated.';
    draw();
  }
  function adopt(): void {
    if (config.mode === 'list') return;
    if (!output?.settlements.length) return;
    config.list = output.settlements.map(s => ({ key: s.key, name: s.name, population: s.population, culture: s.culture, kind: s.kind, siteType: s.siteType, sitePrefs: clone(s.sitePrefs), position: clone(s.center) }));
    config.mode = 'list'; controls();
  }
  /** A placement input changed: placement, then roads. */
  function changed(): void {
    needsPlacement = true; options.onChange(); schedule();
  }
  function schedule(): void { clearTimeout(timer); timer = setTimeout(recalculate, 180); }
  function recalculate(): void {
    clearTimeout(timer);
    const t = options.getTerrain(); if (!t || !complete || options.active === false) return;
    if (!enabled) { ++id; output = undefined; draw(); list(); roads.set(undefined); urban.setSettlements(undefined); el('setStatus').textContent = 'Settlement generation disabled.'; el('setState').textContent = ''; return; }
    config.relief = options.getSettings().relief;
    const place = needsPlacement || !output;
    const request: SettlementRequest = { id: ++id, seed: options.getSettings().seed, roads: roads.enabled ? clone(roads.config) : null, runtime: executionRuntime };
    if (place) request.place = { ...config, main: prefs(config.main), list: config.list.map(prefs) };
    else request.sites = sites(output!);
    if (!worker && !fallback) {
      try {
        worker = new SettlementWorker();
        worker.onmessage = (event: MessageEvent<SettlementResponse>) => receive(event.data);
        worker.onerror = event => { event.preventDefault(); useFallback(); };
      } catch { useFallback(); return; }
    }
    if (cachedTerrain !== t) {
      const retained = options.getRaster?.();
      request.raster = retained ? { ...retained, height: retained.height.slice(), water: retained.water.slice(), waterLevel: retained.waterLevel.slice(), riverWidth: retained.riverWidth.slice(), riverIds: retained.riverIds.slice() } : settlementRaster(t); cachedTerrain = t;
      validation = { width: request.raster.width, n: request.raster.n, water: request.raster.water.slice() };
    }
    if (place) { el('setGenerate').setAttribute('aria-busy', 'true'); el('setStatus').textContent = 'Placing settlements in Rust…'; }
    if (roads.enabled) roads.pending(); else roads.set(undefined);
    if (fallback) void runSettlementRequest(request).then(receive, error => receive({ id: request.id, error: String(error) }));
    else try {
      const r = request.raster;
      worker!.postMessage(request, r ? [r.height.buffer, r.water.buffer, r.waterLevel.buffer, r.riverWidth.buffer, r.riverIds.buffer] : []);
    } catch { useFallback(); }
  }
  function useFallback(): void {
    // The fallback engine keeps its own terrain: resend the raster.
    worker?.terminate(); worker = undefined; fallback = true; cachedTerrain = undefined; needsPlacement = true; recalculate();
  }
  function receive(response: SettlementResponse): void {
    if (response.id !== id) return;
    el('setGenerate').removeAttribute('aria-busy');
    if ('error' in response) { el('setStatus').textContent = `Settlement generation: ${response.error}`; roads.error(response.error); return; }
    answered = response.id;
    if (response.settlements) {
      output = response.settlements; needsPlacement = false;
      window.dispatchEvent(new CustomEvent('settlements:generated', { detail: output }));
      if (selection && !output.settlements.some(s => s.key === selection) && !config.list.some(s => s.key === selection)) selection = '';
      const people = output.settlements.reduce((sum, s) => sum + s.population, 0);
      el('setStatus').textContent = `Rust · ${output.settlements.length}/${output.requested} places · ${people.toLocaleString()} inhabitants · ${output.ms.toFixed(0)} ms`;
      el('setState').textContent = `${output.settlements.length} places`;
      el('setWarnings').textContent = output.warnings.join('\n');
    }
    roads.set(response.roads ?? undefined);
    urban.setSettlements(output, response.roads ?? undefined);
    draw(); list(); editor(); options.onChange();
    syncLanduse(); options.onPlanChange?.();
  }
  function list(): void {
    const entries = config.mode === 'list' ? config.list : output?.settlements ?? [];
    el('setCount').textContent = `(${entries.length})`;
    el('setList').replaceChildren(...entries.map(s => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.key = s.key;
      button.className = 'terrain-place'; button.setAttribute('aria-pressed', String(selection === s.key));
      const result = output?.settlements.find(p => p.key === s.key);
      button.innerHTML = `<b>${esc(s.name || s.key)}</b><small>${classOfPop(s.population)} · ${s.population.toLocaleString()} · ${result ? `${esc(result.archetype)} · score ${result.scores.total.toFixed(2)}` : 'awaiting placement'}</small>`;
      button.onclick = () => { selection = s.key; urban.selectCity(s.key); setPicking(); list(); editor(); draw(); };
      return button;
    }));
  }
  function edit(change: (s: SettlementSpec) => void): void {
    adopt(); const spec = config.list.find(s => s.key === selection); if (!spec) return;
    change(spec); list(); editor(); changed();
  }
  function editor(): void {
    const result = output?.settlements.find(s => s.key === selection);
    const spec = config.mode === 'list' ? config.list.find(s => s.key === selection) : result;
    const host = el('setEditor'); host.replaceChildren(); if (!spec) return;
    host.innerHTML = `<div class="settlement-editor"><b>Properties</b>
      <label>Name <input id="setName" type="text" maxlength="60"></label>
      <label>Class <select id="setClass">${SETTLEMENT_KINDS.map(c => `<option value="${c.kind}">${c.label}</option>`).join('')}</select></label>
      <label>Population <input id="setPopulation" type="number" min="1" max="5000000" step="1"></label>
      <label>Culture <select id="setPlaceCulture">${culture.innerHTML}</select></label>
      <label>Role (label) <input id="setKind" type="text" maxlength="60"></label>
      <label>Site preference <select id="setSite"><option value="auto">Automatic</option>${SITE_ARCHETYPES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></label>
      <label>X (m) <input id="setX" type="number" min="0" step="1" placeholder="auto"></label><label>Y (m) <input id="setY" type="number" min="0" step="1" placeholder="auto"></label>
      <div class="settlement-actions"><button id="setMove" type="button">Place on map</button><button id="setAutoPosition" type="button">Automatic position</button><button id="setRemove" type="button">Delete</button></div>
      <details><summary>Site preferences</summary><label>Mountain face <input id="setMountain" type="number" min="0" max="10" step="0.1"></label><label>Woodland <input id="setWood" type="number" min="0" max="10" step="0.1"></label><label>Hilltop weight <input id="setHill" type="number" min="0" max="10" step="0.1"></label></details>
      <div id="setScore"></div></div>`;
    input('setName').value = spec.name; input('setPopulation').value = String(spec.population);
    el<HTMLSelectElement>('setClass').value = classOfPop(spec.population); el<HTMLSelectElement>('setPlaceCulture').value = spec.culture;
    input('setKind').value = spec.kind; el<HTMLSelectElement>('setSite').value = spec.siteType;
    input('setX').value = spec.position ? String(Math.round(spec.position.x)) : ''; input('setY').value = spec.position ? String(Math.round(spec.position.y)) : '';
    input('setX').max = input('setY').max = String((options.getTerrain()?.width ?? 100000) - 1);
    const effective = prefs(spec).sitePrefs;
    input('setMountain').value = String(effective.mountainFace ?? 0); input('setWood').value = String(effective.woodland ?? 0); input('setHill').value = String(effective.weights?.hilltop ?? 1);
    input('setName').onchange = event => edit(s => { s.name = (event.target as HTMLInputElement).value.trim(); });
    input('setKind').onchange = event => edit(s => { s.kind = (event.target as HTMLInputElement).value.trim(); });
    input('setPopulation').onchange = event => { const c = event.target as HTMLInputElement; if (c.reportValidity()) edit(s => { s.population = Math.round(Number(c.value)); }); };
    el<HTMLSelectElement>('setClass').onchange = event => edit(s => { const kind = SETTLEMENT_KINDS.find(k => k.kind === (event.target as HTMLSelectElement).value); if (kind && classOfPop(s.population) !== kind.kind) s.population = kind.population; });
    el<HTMLSelectElement>('setPlaceCulture').onchange = event => edit(s => { s.culture = (event.target as HTMLSelectElement).value; s.sitePrefs = {}; });
    el<HTMLSelectElement>('setSite').onchange = event => edit(s => { s.siteType = (event.target as HTMLSelectElement).value; });
    for (const [name, key] of [['setMountain', 'mountainFace'], ['setWood', 'woodland'], ['setHill', 'hilltop']]) input(name).onchange = event => {
      const c = event.target as HTMLInputElement; if (!c.reportValidity()) return;
      edit(s => { if (key === 'hilltop') s.sitePrefs.weights = { ...prefs(s).sitePrefs.weights, hilltop: Number(c.value) }; else s.sitePrefs = { ...s.sitePrefs, [key]: Number(c.value) }; });
    };
    const positionChanged = (): void => {
      const x = input('setX'), y = input('setY'); if (!x.value && !y.value) { edit(s => { delete s.position; }); return; }
      if (!x.value || !y.value || !x.reportValidity() || !y.reportValidity()) { el('setScore').textContent = 'Enter both coordinates, or clear both for automatic placement.'; return; }
      edit(s => { s.position = { x: Number(x.value), y: Number(y.value) }; });
    };
    input('setX').onchange = input('setY').onchange = positionChanged;
    el('setMove').onclick = () => { adopt(); setPicking(selection); };
    el('setAutoPosition').onclick = () => edit(s => { delete s.position; });
    el('setRemove').onclick = () => { adopt(); config.list = config.list.filter(s => s.key !== selection); selection = ''; setPicking(); list(); editor(); changed(); };
    if (result) {
      const scores = result.scores;
      const ranking = scores.rankingScore == null ? '' : `<small>Candidate rank ${scores.candidateRank} · ranking score ${scores.rankingScore.toFixed(3)} (class reference ${scores.rankingPopulation} inhabitants, before jitter)</small>`;
      const terms: [string, number][] = [['Flatness', scores.flatness], ['Buildable land', scores.buildable], ['Fresh water', scores.freshWater], ['River access', scores.river], ['Harbor', scores.harbor], ['Flood risk', scores.flood], ['Culture', scores.culture], ['Site type', scores.site], ['Defensibility', scores.defense], ['Elevation', scores.elevation], ['Clustering', scores.cluster], ['Seed variation', scores.variation]];
      const unreachable = roads.output?.unreachable.includes(result.key) ? '<br>Unreachable by road' : '';
      el('setScore').innerHTML = `<b>Choice score ${scores.total.toFixed(3)}</b><small>${scores.manual ? 'Manual position; score shown for comparison.' : 'Best available site with spacing and terrain constraints.'}<br>${result.center.x.toFixed(0)}, ${result.center.y.toFixed(0)} m · ${esc(result.archetype)} · radius ${result.radius.toFixed(0)} m</small><table>${terms.filter(([, v]) => v !== 0).map(([label, value]) => `<tr><td>${label}</td><td>${value >= 0 ? '+' : ''}${value.toFixed(3)}</td></tr>`).join('')}</table><small>Buildable ${(scores.buildableFraction * 100).toFixed(0)}% · slope ${(Math.atan(scores.slope) * 180 / Math.PI).toFixed(1)}°<br>Water ${scores.waterDistance >= 1e6 ? 'absent' : `${scores.waterDistance.toFixed(0)} m away`} · above water ${scores.heightAboveWater.toFixed(1)} m<br>Spacing × ${scores.spacingRelaxation.toFixed(2)}${unreachable}</small>`;
      el('setScore').insertAdjacentHTML('beforeend', ranking);
    } else el('setScore').textContent = 'This settlement has no valid position yet. Use automatic position or place it on dry land.';
  }
  function draw(): void {
    let layer = map.querySelector<SVGGElement>('#settlementOverlay');
    if (!layer) { layer = document.createElementNS(ns, 'g'); layer.id = 'settlementOverlay'; map.append(layer); }
    roads.draw();
    const state = `${enabled}|${showPoints}|${selection}`;
    if (layer === drawnLayer && output === drawnOutput && state === drawnState) {
      for (const marker of Array.from(layer.querySelectorAll<SVGGElement>('[data-settlement]'))) {
        marker.setAttribute('transform', `translate(${marker.dataset.x} ${marker.dataset.y}) scale(${1 / options.getView().scale})`);
      }
      return;
    }
    drawnLayer = layer; drawnOutput = output; drawnState = state;
    layer.replaceChildren(); if (!enabled || !output || !showPoints) return;
    const scale = options.getView().scale;
    for (const [index, s] of output.settlements.entries()) {
      const marker = document.createElementNS(ns, 'g'); marker.dataset.settlement = s.key; marker.classList.add('settlement-marker'); marker.setAttribute('transform', `translate(${s.center.x} ${s.center.y}) scale(${1 / scale})`);
      marker.dataset.x = String(s.center.x); marker.dataset.y = String(s.center.y);
      marker.style.color = selection === s.key ? '#176348' : '#252b29';
      const hit = document.createElementNS(ns, 'rect'); hit.setAttribute('x', '-19'); hit.setAttribute('y', '-22'); hit.setAttribute('width', '54'); hit.setAttribute('height', '54'); hit.setAttribute('fill', 'transparent');
      const symbol = document.createElementNS(ns, 'path'); symbol.classList.add('settlement-symbol'); symbol.setAttribute('d', settlementSymbols[classOfPop(s.population)]);
      const number = document.createElementNS(ns, 'text'); number.classList.add('settlement-number'); number.setAttribute('x', '21'); number.setAttribute('y', '5'); number.textContent = String(index + 1);
      const population = document.createElementNS(ns, 'text'); population.classList.add('settlement-population'); population.setAttribute('x', '5'); population.setAttribute('y', '27'); population.setAttribute('text-anchor', 'middle'); population.textContent = s.population.toLocaleString();
      const title = document.createElementNS(ns, 'title'); title.textContent = `${s.cls} · ${s.culture} · ${s.archetype}\n${s.population} inhabitants · score ${s.scores.total.toFixed(3)}\nClick to edit; drag to move`;
      marker.append(title, hit, symbol, number, population); layer.append(marker);
    }
  }
  function world(event: MouseEvent): Point {
    const rect = viewport.getBoundingClientRect(), v = options.getView();
    return { x: v.cx + (event.clientX - rect.left - rect.width / 2) / v.scale, y: v.cy + (event.clientY - rect.top - rect.height / 2) / v.scale };
  }
  function placeAt(p: Point): boolean {
    const t = options.getTerrain(); if (!t || !complete || p.x < 0 || p.y < 0 || p.x >= t.width || p.y >= t.width) return false;
    // Validate against the same adapted raster as Rust before committing the editable list.
    const raster = validation ?? options.getRaster?.() ?? settlementRaster(t), i = Math.floor(p.y / raster.width * raster.n) * raster.n + Math.floor(p.x / raster.width * raster.n);
    if (raster.water[i]) { el('setPickHint').textContent = 'Choose dry land: this point is on water or solid rock.'; return false; }
    adopt();
    if (picking === 'new') {
      config.mode = 'list'; const key = `manual:${crypto.randomUUID()}`; const s = defaultSettlementSpec(key); s.culture = config.main.culture; s.name = `Place ${config.list.length + 1}`; s.position = p; config.list.push(s); selection = key;
    } else {
      const s = config.list.find(s => s.key === (picking ?? drag?.key)); if (!s) return false; s.position = p; selection = s.key;
    }
    enabled = true; setPicking(); controls(); list(); editor(); changed(); return true;
  }
  map.addEventListener('pointerdown', event => {
    const marker = (event.target as Element).closest<SVGGElement>('[data-settlement]'); if (!marker || event.button !== 0 || picking) return;
    event.stopImmediatePropagation(); options.onPicking();
    const p = world(event); drag = { key: marker.dataset.settlement!, pointer: event.pointerId, start: p, point: p, moved: false }; map.setPointerCapture(event.pointerId);
  }, true);
  map.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopImmediatePropagation(); drag.point = world(event); drag.moved ||= Math.hypot(drag.point.x - drag.start.x, drag.point.y - drag.start.y) * options.getView().scale > 3;
    if (drag.moved) { const marker = Array.from(map.querySelectorAll<SVGGElement>('[data-settlement]')).find(m => m.dataset.settlement === drag!.key); marker?.setAttribute('transform', `translate(${drag.point.x} ${drag.point.y}) scale(${1 / options.getView().scale})`); }
  }, true);
  let suppressClick = false;
  map.addEventListener('pointerup', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopImmediatePropagation(); if (map.hasPointerCapture(event.pointerId)) map.releasePointerCapture(event.pointerId);
    if (drag.moved) { setPicking(drag.key); placeAt(drag.point); suppressClick = true; } else { selection = drag.key; urban.selectCity(drag.key); list(); editor(); draw(); }
    drag = undefined; draw();
  }, true);
  map.addEventListener('pointercancel', () => { drag = undefined; draw(); }, true);
  map.addEventListener('click', event => {
    if (suppressClick || (event.target as Element).closest('[data-settlement]')) { event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') { setPicking(); drag = undefined; draw(); } });
  input('setEnabled').onchange = () => { enabled = input('setEnabled').checked; changed(); };
  mode.onchange = () => { if (mode.value === 'list') adopt(); config.mode = mode.value as SettlementConfig['mode']; selection = ''; controls(); list(); editor(); changed(); };
  distribution.onchange = () => { config.distribution = distribution.value as SettlementConfig['distribution']; controls(); changed(); };
  input('setMainPop').onchange = () => { if (input('setMainPop').reportValidity()) { config.main.population = Math.round(Number(input('setMainPop').value)); changed(); } };
  culture.onchange = () => { config.main.culture = culture.value; config.main.sitePrefs = {}; changed(); };
  for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-setting],[data-count],[data-site]'))) c.onchange = () => {
    if (!c.reportValidity()) return;
    if (c.dataset.count) config.counts[c.dataset.count] = Math.round(Number(c.value));
    else if (c.dataset.site) { if (Number(c.value) === 1) delete config.siteWeights[c.dataset.site]; else config.siteWeights[c.dataset.site] = Number(c.value); }
    else (config as unknown as Record<string, unknown>)[c.dataset.setting!] = Number(c.value);
    changed();
  };
  input('setShowPoints').onchange = () => { showPoints = input('setShowPoints').checked; draw(); options.onChange(); };
  el('setGenerate').onclick = () => { needsPlacement = true; recalculate(); };
  el('setTakeOver').onclick = () => { adopt(); selection = config.list[0]?.key ?? ''; controls(); list(); editor(); changed(); };
  el('setAdd').onclick = () => setPicking(picking === 'new' ? undefined : 'new');
  /** Decor of the current map, once placement and routing answered the latest request. */
  const decorReady = (): boolean => complete && enabled && !!output && answered === id && (!roads.enabled || !!roads.output);
  const decor = (extra?: Parameters<typeof captureDecor>[5]): ReturnType<typeof captureDecor> => {
    const t = options.getTerrain();
    if (!t || !decorReady()) throw new Error('Wait for the settlements and roads of the completed map.');
    const retained = options.getDecor?.();
    if (retained) {
      const snapshot: Decor = { raster: retained.raster, meta: { ...retained.meta, ...extra, query: options.getQuery?.() ?? retained.meta.query,
        settlements: clone(output!.settlements), roads: roads.output ?? null, roadConfig: roads.enabled ? clone(roads.config) : null,
        stats: { ...retained.meta.stats, roadKm: (roads.output?.segments.reduce((s, r) => s + r.length, 0) ?? 0) / 1000 },
        pipeline: { ...retained.meta.pipeline, stage: 'settlements', parent: retained.meta.id, urban: urban.workshopState(), urbanDraft: urban.workshopDraft() } } };
      return { bytes: encodeDecor(snapshot), meta: snapshot.meta };
    }
    return captureDecor(t, options.getSettings(), output!, roads.output, roads.enabled ? clone(roads.config) : null,
      { ...extra, query: extra?.query ?? options.getQuery?.() });
  };
  el('setExportDecor').onclick = () => {
    try { const s = options.getSettings(); downloadBytes(decor().bytes, `${s.relief}-${s.seed}.decor`.replace(/[^\w.-]+/g, '_')); }
    catch (error) { el('setStatus').textContent = String(error instanceof Error ? error.message : error); }
  };
  // Batch export (web/scripts/export_decors.mjs) drives the bench through this hook.
  (window as unknown as { magnaDecor: unknown }).magnaDecor = {
    ready: decorReady,
    export(file: string, extra?: Parameters<typeof captureDecor>[5]): { base64: string; entry: DecorEntry } {
      const { bytes, meta } = decor(extra); let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { base64: btoa(text), entry: decorEntry(meta, file) };
    },
  };
  controls(); list();
  return {
    urban,
    contextReady: () => complete && (!enabled || answered === id) && !urban.layoutPending && !urban.generationPending,
    captureContext: () => ({ selection, urban: urban.captureContext() }),
    restoreContext(saved: { selection?: string; urban?: ReturnType<typeof urban.captureContext> }): void {
      if (saved?.selection && output?.settlements.some(s => s.key === saved.selection)) selection = saved.selection;
      if (saved?.urban) urban.restoreContext(saved.urban);
      list(); editor(); draw();
    },
    ready: decorReady,
    capture: decor,
    restoreDecor(d: Decor): void {
      clearTimeout(timer); ++id; answered = id; complete = true; cachedTerrain = undefined;
      if (!d.meta.settlements.length) { needsPlacement = true; recalculate(); return; }
      enabled = true; output = { settlements: clone(d.meta.settlements), requested: d.meta.settlements.length, usableKm2: 0, warnings: [], ms: 0 }; needsPlacement = false;
      config.mode = 'auto'; adopt(); selection = d.meta.pipeline?.city ?? ''; controls(); list(); editor();
      if (d.meta.roadConfig) roads.setConfig(d.meta.roadConfig);
      restoringDecor = true; roads.set(d.meta.roads ?? undefined); urban.setSettlements(output, d.meta.roads ?? undefined);
      if (d.meta.pipeline?.urban?.layouts?.length) urban.restoreSnapshot(d.meta.pipeline.urban);
      if (d.meta.pipeline?.urbanDraft) urban.applyWorkshopDraft(d.meta.pipeline.urbanDraft);
      restoringDecor = false; publishOptions(urban.workshopDraft() ?? urban.workshopState());
      syncLanduse(); draw(); options.onChange();
    },
    get paintingContext(): UrbanPaintingContext {
      const cities = enabled ? output?.settlements : undefined, roadOutput = roads.enabled ? roads.output : undefined;
      if (!paintingContext || paintingContext.layouts !== urban.layouts || paintingContext.roads !== roadOutput || paintingContext.cities !== cities) {
        paintingContext = { layouts: urban.layouts, roads: roadOutput, cities };
      }
      return paintingContext;
    },
    applyUrbanChanges: urban.applyPending,
    cancelPicking(): void { setPicking(); },
    terrainReady(): void { complete = true; needsPlacement = true; recalculate(); },
    terrainFailed(message: string): void {
      complete = false; ++id; clearTimeout(timer);
      el('setGenerate').removeAttribute('aria-busy');
      el('setStatus').textContent = `Settlements blocked by terrain generation: ${message}`;
      roads.error(`Terrain generation failed: ${message}`);
      urban.terrainFailed(message);
    },
    terrainPending(): void { complete = false; ++id; output = undefined; cachedTerrain = undefined; validation = undefined; roads.set(undefined); urban.terrainPending(); draw(); el('setStatus').textContent = 'Waiting for the completed map…'; },
    updateView(): void { draw(); roads.draw(); urban.updateView(); landuse?.updateView(); },
    isPicking: (): boolean => !!picking,
    click(event: MouseEvent): boolean { if (!picking) return false; placeAt(world(event)); return true; },
    share(params: URLSearchParams): void {
      params.set('settlements', JSON.stringify({ config, enabled, showPoints }));
      params.set('roads', roads.share());
      urban.share(params); landuse?.share(params);
    },
  };
}
import { executionRuntime } from './executionProfile';
