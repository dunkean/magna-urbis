import { retainCityPlacement } from './cityRetainedPlacement';
import { setupSettlementLocale } from './settlementLocale';
import { urbanText } from './urbanPanelLocale';
import { LOCALE_KEY } from './shellLocale';
import { retainSelectValue } from './retainedSelectValue';
import { bindCityPlaceCulture } from './cityPlanCulture';
import { urbanOptionSync } from './urbanOptionSync';
import type { Relief } from '../gen/options';
import SettlementWorker from './settlementWorker?worker&inline';
import { defaultSettlementConfig, defaultSettlementSpec, settlementRaster, runSettlementRequest, type Point, type RoadSite, type SettlementConfig, type SettlementOutput, type SettlementRequest, type SettlementResponse, type SettlementSpec } from '../../../rust/bridge/settlements';
import type { TerrainData, TerrainSettings } from '../../../rust/bridge/terrain';
import type { View } from '../render/view';
import { CULTURES, getCulture } from '../gen/urban/culture';
import { SITE_ARCHETYPES, classOfPop } from '../gen/options';
import { localizedDemographicLabel, settlementPopulationChoices } from './settlementKinds';
import { bindGear, gearButton } from './mapGroup';
import { createTerrainRoads } from './terrainRoads';
import { createTerrainUrban } from './terrainUrban';
import { captureDecorData } from './decorCapture';
import { type Decor } from './decor';
import { downloadDecorFile } from './decorFile';
import { createTerrainDecorExports } from './terrainDecorExport';
import type { UrbanPaintingContext } from '../../../rust/bridge/urbanPaintingMask';
import type { ForestOccupation } from '../../../rust/bridge/terrainForest';
import type { UrbanLanduseScene } from './urbanLanduseData';
import { forestOccupation } from './forestOccupation';
import urbanCatalogue from '../../../rust/crates/core/src/urban/catalogue.json';

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
const classIcon = (cls: string): string => `<svg viewBox="-18 -20 36 32" aria-hidden="true"><path d="${settlementSymbols[cls as keyof typeof settlementSymbols] ?? ''}"/></svg>`;
const shortPop = (n: number): string => n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : n < 1e6 ? `${Math.round(n / 1000)}k` : `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
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
  getView(): View; getAuto?(): boolean; getQuery?(): string; onChange(): void; onPlanChange?(): void; onPicking(): void; onFocus?(center: Point, radius: number): void; onProjection?(active: boolean, camera?: import('./terrain3d').Terrain3dCamera): boolean | void;
  /** Render3D forest material is displayed: it replaces the cartoon landuse woods. */
  useForestMaterial?(): boolean;
  getForestSource?(): import('./urbanLanduseData').UrbanLanduseInput['forest'];
  /** Applied rural occupation in the displayed terrain frame, or undefined. */
  onForestOccupation?(occupation: ForestOccupation | undefined): void;
  /** City Bench: one editable city (size, culture, position). */
  city?: boolean;
}) {
  const { map, viewport } = options;
  let restoringDecor = false;
  let config = defaultSettlementConfig(), enabled = true, showPoints = true, autoRefresh = true, pending = false;
  let selection = '', picking: 'new' | string | undefined, output: SettlementOutput | undefined;
  let cachedTerrain: TerrainData | undefined, worker: Worker | undefined, id = 0, timer: ReturnType<typeof setTimeout> | undefined;
  // Placement reruns only when its inputs changed; road edits reroute between the current places.
  let complete = false, needsPlacement = true, validation: { width: number; n: number; water: Uint8Array } | undefined;
  let fallback = false, answered = 0;
  let citySearchRequested = false, cityPlacementScoresStale = false;
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
    autoRefresh = saved.autoRefresh !== false;
    if (saved.config?.roads === false || saved.showRoads === false) legacyRoads = false;
  } catch { /* An incomplete shared link keeps defaults. */ }
  const panel = document.createElement('details'); panel.className = 'stage settlement-stage map-group'; panel.open = true; panel.id = 'settlementStage';
  const number = (key: keyof SettlementConfig, label: string, min: number, max: number, step: number, title = '', show = ''): string =>
    `<label title="${esc(title)}"${show ? ` data-show="${show}"` : ''}>${label}<input data-setting="${key}" type="number" min="${min}" max="${max}" step="${step}"></label>`;
  const COUNT_CLASSES: [keyof typeof settlementSymbols, string][] = [['city', 'Villes'], ['town', 'Bourgs'], ['village', 'Villages'], ['hamlet', 'Hameaux'], ['farmstead', 'Fermes']];
  panel.innerHTML = `<summary>Settlements <span id="setState"></span></summary><div class="stage-controls" data-map-body>
    <div class="map-line"><span class="map-icon" role="img" aria-label="Settlements" title="Settlements">🏘</span>
      <span id="setCounts" class="map-counts">${COUNT_CLASSES.map(([cls, label]) => `<label class="map-count" title="${label} : nombre de lieux de cette classe (modifier passe en composition par nombres)">${classIcon(cls)}<input data-count="${cls}" type="number" min="0" max="1000" step="1" aria-label="${label}"></label>`).join('')}</span>
      ${gearButton()}</div>
    <div class="map-line map-sub"><label class="map-field map-grow" title="Culture par défaut des lieux">culture <select id="setCulture"></select></label></div>
    <small id="setStatus" class="map-status" role="status">Waiting for the completed map…</small>
    <small id="setPickHint" class="map-status" hidden>Select a marker to inspect its scores. Drag it to move it: only the roads are recalculated.</small>
    <div id="setWarnings" role="status"></div>
    <div class="map-detail" hidden>
    <label><input id="setEnabled" type="checkbox">Generate settlements</label>
    <label title="Désactiver pour déplacer plusieurs lieux avant de recalculer les settlements, les routes et le plan."><input id="setAutoRefresh" type="checkbox">Régénération automatique des settlements et routes</label>
    <button id="setRefresh" type="button" hidden>Appliquer et recalculer les settlements</button>
    <label>Composition <select id="setMode"><option value="auto">Automatic</option><option value="counts">By class counts</option><option value="list">Editable list</option></select></label>
    <label data-show="auto" title="Rank-size: rank r holds main ÷ r^q inhabitants. Classes: the legacy city/town/village bands sized by the usable land.">Distribution <select id="setDistribution"><option value="zipf">Rank-size (Zipf)</option><option value="classes">Class bands</option></select></label>
    <label>Main population <input id="setMainPop" type="number" min="1" max="5000000" step="1"></label>
    <div class="control-group" data-show="auto">
      ${number('density', 'Density ×', 0, 10, 0.1, 'Number of places; rank-size: ×1 = 10 places per 100 km² of usable land')}
      ${number('zipfExponent', 'Rank-size exponent q', 0.3, 3, 0.05, 'Higher: steeper hierarchy, fewer large towns', 'zipf')}
      ${number('minPopulation', 'Smallest place', 1, 100000, 1, '', 'zipf')}
      ${number('populationJitter', 'Population spread', 0, 1, 0.05, 'Log-normal spread around the rank-size curve', 'zipf')}
    </div>
    <details class="advanced"><summary>Spacing</summary><div class="control-group">
    ${number('spread', 'Spacing ×', 0.1, 5, 0.1, 'Automatic composition')}${number('mainClear', 'Main settlement clearance × radius', 0, 10, 0.1)}
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
    <div class="settlement-actions"><button id="setGenerate" type="button">Recalculate settlements</button><button id="setTakeOver" type="button">Edit generated list</button><button id="setExportDecor" type="button" title="Save terrain, water, settlements and roads as a decor for the Urban Bench">Export decor</button></div>
    </div></div>`;
  bindGear(panel);
  const backend = document.querySelector('.stages > .backend');
  document.querySelector('.stages')!.insertBefore(panel, backend);
  const el = <T extends HTMLElement>(name: string): T => document.getElementById(name) as T;
  const input = (name: string): HTMLInputElement => el<HTMLInputElement>(name);
  const roads = createTerrainRoads({
    map, before: backend,
    onConfigChange: () => { options.onChange(); schedule(); },
    onDisplayChange: options.onChange,
  });
  const urban = createTerrainUrban({ map, before: backend, getTerrain: options.getTerrain,
    getRaster: options.getRaster, city: options.city, cityView: true,
    parcelDefault: options.parcelDefault ?? false,
    getSeed: () => options.getSettings().seed, getAuto: () => autoRefresh && !!options.getAuto?.(), upstreamPending: () => enabled && !decorReady(), onChange: () => { if (!restoringDecor) publishOptions(urban.workshopDraft() ?? urban.workshopSettings()); draw(); options.onChange(); }, onPlanChange: () => { if (!restoringDecor) publishOptions(urban.workshopDraft() ?? urban.workshopSettings()); syncLanduse(); options.onPlanChange?.(); }, onFocus: options.onFocus, onProjection: options.onProjection, onAutoChange: value => { const box = input('setAutoRefresh'); box.checked = value; box.onchange?.(new Event('change')); } });
  // One « Auto » switch in the city panel drives the settlements & roads auto-refresh too; only its manual button moves there.
  el('setAutoRefresh').closest('label')!.hidden = true;
  urban.regenerationSlot.append(el('setRefresh'));
  setupSettlementLocale(panel, !!options.city);
  const updateSiteWeightsLocale = (): void => {
    for (const control of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-site]'))) {
      const text = control.closest('label')?.firstChild;
      if (text?.nodeType === Node.TEXT_NODE) text.textContent = siteLabel(control.dataset.site ?? '');
    }
    const note = panel.querySelector<HTMLElement>('.map-detail > details.advanced:last-of-type small');
    if (note) note.textContent = urbanText(['Multiplicateurs des préférences de chaque culture (0 évite, 1 neutre, 3 favorise).','Multipliers on top of each culture’s preferences (0 avoids, 1 neutral, 3 favours).','对各文化偏好的倍率（0 为避免，1 为中性，3 为偏好）。','Multiplicadores de las preferencias de cada cultura (0 evita, 1 neutro, 3 favorece).','Multiplicadores das preferências de cada cultura (0 evita, 1 neutro, 3 favorece).']);
  };
  window.addEventListener('magna-locale-change', updateSiteWeightsLocale);
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) updateSiteWeightsLocale(); });
  updateSiteWeightsLocale();
  const publishOptions = urbanOptionSync(() => { const d = options.getDecor?.(); return d && urban.target !== 'all' ? `${d.meta.pipeline?.syncSource ?? d.meta.id}:${urban.target}` : undefined; }, state => urban.applyWorkshopDraft(state));
  map.addEventListener('urban:settings', event => publishOptions((event as CustomEvent).detail));
  // Only an applied rural plan constrains the forest; natural cover never does.
  let landuseScene: UrbanLanduseScene | undefined, occupationScene: UrbanLanduseScene | undefined;
  let occupation: ForestOccupation | undefined, published: ForestOccupation | undefined;
  // Rural drawing and its brush atlases are loaded separately from the native plan.
  let landuse: ReturnType<typeof import('./urbanLanduse')['createUrbanLanduse']> | undefined;
  if (options.active !== false) void import('./urbanLanduse').then(({ createUrbanLanduse }) => {
    landuse = createUrbanLanduse({ map, before: backend ?? panel,
      onChange: options.onChange,
      onPlanChange: () => options.onPlanChange?.(),
      getView: () => ({ view: options.getView(), width: viewport.clientWidth, height: viewport.clientHeight }),
      getBackground: () => ({ opacity: 0 }),
      forestMaterial: () => !!options.useForestMaterial?.(),
      onScene: (scene, applied) => { landuseScene = applied ? scene : undefined; publishForest(false); },
    });
    syncLanduse(); options.onChange();
  });
  function publishForest(always: boolean): void {
    let next: ForestOccupation | undefined;
    const width = options.getTerrain()?.width;
    // Landuse, retained decor and terrain share the frame rebased by cropTerrain: [0, width]².
    if (options.useForestMaterial?.() && landuseScene?.landuse && width && Math.abs(landuseScene.mapSize - width) <= width * 1e-6) {
      if (occupationScene !== landuseScene) { occupationScene = landuseScene; occupation = forestOccupation(landuseScene.landuse); }
      next = occupation;
    }
    if (always || next !== published) { published = next; options.onForestOccupation?.(next); }
  }
  let landuseTerrain: TerrainData | undefined, landuseRaster: ReturnType<typeof settlementRaster> | undefined;
  function syncLanduse(): void {
    const t = options.getTerrain();
    if (t !== landuseTerrain) { landuseTerrain = t; landuseRaster = undefined; }
    const raster = options.getRaster?.() ?? (t ? landuseRaster ??= settlementRaster(t) : undefined);
    if (!raster || !output || !enabled) { landuse?.set(); return; }
    const city = output.settlements.find(s => s.key === urban.target) ?? output.settlements.find(s => s.key === selection) ?? output.settlements[0];
    const relief = options.getSettings().relief;
    landuse?.set({ raster, seed: options.getSettings().seed, relief: (['flat', 'hills', 'valley'].includes(relief) ? relief : 'mountains') as Relief,
      city, neighbours: output.settlements.filter(s => s.key !== city?.key), roads: roads.output, layouts: urban.layouts,
      forest: options.getForestSource?.() });
  }
  let paintingContext: UrbanPaintingContext | undefined;
  if (legacyRoads === false && !new URLSearchParams(location.search).has('roads')) {
    const box = document.getElementById('roadEnabled') as HTMLInputElement; box.checked = false; box.dispatchEvent(new Event('change'));
  }
  const places = document.createElement('section'); places.className = 'terrain-places'; places.id = 'terrainSettlements';
  places.innerHTML = '<div class="map-chips"><small id="setCount" class="map-total" title="Nombre de lieux"></small><div id="setList"><button id="setAdd" type="button"></button></div></div><div id="setEditor"></div>';
  document.querySelector('.stages')!.insertBefore(places, backend);
  // One line of the terrain on the Settlements page (its own stages stay hidden there).
  const terrainLine = document.createElement('div'); terrainLine.className = 'map-terrain'; terrainLine.id = 'mapTerrainLine'; terrainLine.hidden = true;
  if (!options.city && options.active !== false) document.querySelector('.stages')!.insertBefore(terrainLine, panel);
  const showTerrain = (): void => {
    const s = options.getSettings(); terrainLine.hidden = !s.width;
    const text = `${s.relief} · ${s.width} · ${s.seed}`; if (terrainLine.dataset.text === text) return; terrainLine.dataset.text = text;
    terrainLine.innerHTML = `<span class="map-icon" role="img" aria-label="Terrain" title="Terrain">⛰</span><span class="map-terrain-text">${esc(String(s.relief))} · ${s.width / 1000} km · ${esc(String(s.seed))}</span>`;
  };
  const mode = el<HTMLSelectElement>('setMode'), culture = el<HTMLSelectElement>('setCulture'), distribution = el<HTMLSelectElement>('setDistribution');
  culture.innerHTML = Object.values(CULTURES).map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');
  // The City Bench offers every culture of the native urban catalogue.
  const cityCultures = Object.entries(urbanCatalogue.cultures).map(([id, c]) => ({ id, label: c.label }));
  if (options.city) {
    panel.classList.add('city-mode');
    for (const id of ['setEnabled', 'setMode', 'setDistribution', 'setMainPop', 'setCulture']) el(id).closest('label')!.hidden = true;
    for (const id of ['setCounts', 'setTakeOver', 'setAdd', 'setExportDecor', 'setList', 'setCount']) el(id).hidden = true;
    for (const box of Array.from(panel.querySelectorAll<HTMLElement>(':scope > .stage-controls > details, :scope > .stage-controls > .control-group[data-show]'))) box.hidden = true;
    el('setGenerate').hidden = false; el('setGenerate').dataset.placementAction = 'search';
    const updatePlacementAction = (): void => {
      const button = el('setGenerate'); button.textContent = button.dataset.placementAction === 'validate' ? urbanText(['Valider les positions fournies','Validate provided positions','验证提供的位置','Validar posiciones proporcionadas','Validar posições fornecidas']) : urbanText(['Rechercher un nouvel emplacement','Search for a new location','搜索新位置','Buscar nueva ubicación','Buscar novo local']);
      button.title = urbanText(['Recherche explicite : peut déplacer la ville. Les changements de population, culture ou plan conservent sa position.','Explicit search may move the city. Changes to population, culture or plan preserve its position.','明确搜索可能移动城市。更改人口、文化或规划会保留其位置。','La búsqueda explícita puede mover la ciudad. Los cambios de población, cultura o plano conservan su posición.','A busca explícita pode mover a cidade. Alterações de população, cultura ou plano mantêm sua posição.']);
      const autoButton = document.getElementById('setAutoPosition'); if (autoButton) autoButton.textContent = button.textContent;
    };
    window.addEventListener('magna-locale-change', updatePlacementAction);
    window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) updatePlacementAction(); });
    updatePlacementAction();
  }
  /** Population ceiling of the loaded City Bench map (decor tag), else the editor's own limit. */
  /** Nearest dry cell to a point, on the raster Rust places settlements on. */
  function dryNear(p: Point): Point | undefined {
    const t = options.getTerrain(); const raster = validation ?? options.getRaster?.() ?? (t ? settlementRaster(t) : undefined);
    if (!raster) return undefined;
    const n = raster.n, cell = raster.width / n, cx = Math.min(n - 1, Math.floor(p.x / cell)), cy = Math.min(n - 1, Math.floor(p.y / cell));
    for (let r = 0; r < n; r++) for (let y = Math.max(0, cy - r); y <= Math.min(n - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(n - 1, cx + r); x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || raster.water[y * n + x]) continue;
      return r ? { x: (x + 0.5) * cell, y: (y + 0.5) * cell } : p;
    }
    return undefined;
  }
  function controls(): void {
    input('setEnabled').checked = enabled; mode.value = config.mode; distribution.value = config.distribution;
    input('setMainPop').value = String(config.main.population); input('setMainPop').disabled = config.mode === 'list'; retainSelectValue(culture, config.main.culture, 'Profil conservé hors catalogue UI');
    for (const e of Array.from(panel.querySelectorAll<HTMLElement>('[data-show]'))) e.hidden = e.dataset.show === 'auto' ? config.mode !== 'auto' : config.distribution !== e.dataset.show;
    input('setShowPoints').checked = showPoints;
    syncCounts();
    for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-setting]'))) c.value = String(config[c.dataset.setting! as keyof SettlementConfig]);
    for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-site]'))) c.value = String(config.siteWeights[c.dataset.site!] ?? 1);
  }
  /** Places per class: the configured counts, or what the current composition produced. */
  function syncCounts(): void {
    const entries = config.mode === 'list' ? config.list : output?.settlements ?? [];
    const live: Record<string, number> = { city: 0, town: 0, village: 0, hamlet: 0, farmstead: 0 };
    for (const s of entries) { const cls = classOfPop(s.population); live[cls === 'metropolis' || cls === 'megacity' ? 'city' : cls]++; }
    for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-count]'))) {
      if (document.activeElement !== c) c.value = String(config.mode === 'counts' ? config.counts[c.dataset.count!] ?? 0 : live[c.dataset.count!] ?? 0);
    }
  }
  function setPicking(key?: string): void {
    picking = key; if (key) { options.onPicking(); showPoints = true; input('setShowPoints').checked = true; }
    viewport.classList.toggle('settlement-picking', !!key);
    el('setPickHint').textContent = urbanText(['Cliquez sur la terre ferme. Échap annule.','Click dry land on the map. Esc cancels.','点击地图上的陆地。Esc 取消。','Haz clic en tierra firme. Esc cancela.','Clique em terra firme. Esc cancela.']);
    el('setPickHint').hidden = !key;
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
    if (options.city) { ++id; citySearchRequested = false; needsPlacement = false; } else needsPlacement = true;
    options.onChange(); schedule();
  }
  function schedule(): void {
    clearTimeout(timer); ++id; pending = true;
    el('setGenerate').removeAttribute('aria-busy');
    draw();
    if (autoRefresh) timer = setTimeout(recalculate, 180);
    else {
      el('setStatus').textContent = urbanText(['Modifications en attente · déplacez ou modifiez les lieux, puis appliquez et recalculez.','Changes pending · move or edit more places, then click Apply changes & recalculate.','更改待处理 · 移动或编辑地点后，点击应用更改并重新计算。','Cambios pendientes · mueve o edita lugares y aplica los cambios para recalcular.','Alterações pendentes · mova ou edite locais e aplique as alterações para recalcular.']);
      el('setState').textContent = urbanText(['Modifications en attente','Changes pending','更改待处理','Cambios pendientes','Alterações pendentes']);
    }
  }
  function recalculate(): void {
    clearTimeout(timer);
    const t = options.getTerrain(); if (!t || !complete || options.active === false) return;
    if (!enabled) { ++id; pending = false; output = undefined; draw(); list(); roads.set(undefined); urban.setSettlements(undefined); el('setStatus').textContent = urbanText(['Génération des implantations désactivée.','Settlement generation disabled.','聚落生成已禁用。','Generación de asentamientos desactivada.','Geração de assentamentos desativada.']); el('setState').textContent = ''; return; }
    config.relief = options.getSettings().relief;
    if (options.city && !citySearchRequested) {
      const retained = retainCityPlacement(output, config.mode === 'list' ? config.list : output?.settlements ?? []);
      if (!retained.output) {
        ++id; answered = id; needsPlacement = false; output = undefined;
        roads.set(undefined); urban.setSettlements(undefined); draw(); list(); editor();
        const pinned = config.list.filter(s => s.position && Number.isFinite(s.position.x) && Number.isFinite(s.position.y));
        const coordinates = pinned.map(s => `${s.key}: ${s.position!.x}, ${s.position!.y}`).join(' ; ');
        el('setStatus').textContent = pinned.length
          ? urbanText([`Coordonnées fournies conservées (${coordinates}), mais données de site non validées. Cliquez sur Valider les positions fournies ; aucun centre n’est fabriqué.`,`Provided coordinates retained (${coordinates}), but site data is not validated. Choose Validate provided positions; no center is invented.`,`已保留提供的坐标（${coordinates}），但场地数据尚未验证。请点击“验证提供的位置”；不会虚构中心。`,`Coordenadas proporcionadas conservadas (${coordinates}), pero datos del sitio sin validar. Pulsa Validar posiciones proporcionadas; no se inventa ningún centro.`,`Coordenadas fornecidas mantidas (${coordinates}), mas dados do local não validados. Clique em Validar posições fornecidas; nenhum centro é inventado.`])
          : urbanText(['Aucune position conservée : cliquez sur Rechercher un nouvel emplacement ou placez la ville sur la carte.','No retained position: choose Search for a new location or place the city on the map.','没有保留的位置：请选择“搜索新位置”或在地图上放置城市。','Sin posición conservada: elige Buscar nueva ubicación o sitúa la ciudad en el mapa.','Nenhuma posição mantida: escolha Buscar novo local ou posicione a cidade no mapa.']);
        el('setGenerate').dataset.placementAction = pinned.length === config.list.length && pinned.length ? 'validate' : 'search';
        el('setGenerate').textContent = el('setGenerate').dataset.placementAction === 'validate' ? urbanText(['Valider les positions fournies','Validate provided positions','验证提供的位置','Validar posiciones proporcionadas','Validar posições fornecidas']) : urbanText(['Rechercher un nouvel emplacement','Search for a new location','搜索新位置','Buscar nueva ubicación','Buscar novo local']);
        editor();
        el('setState').textContent = urbanText(['Placement explicite requis','Explicit placement required','需要明确选址','Se requiere ubicación explícita','Posicionamento explícito necessário']); options.onChange(); return;
      }
      output = retained.output; cityPlacementScoresStale ||= retained.changed; needsPlacement = false;
    }
    const place = options.city ? citySearchRequested : needsPlacement || !output;
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
    if (place) { el('setGenerate').setAttribute('aria-busy', 'true'); el('setStatus').textContent = urbanText(['Placement des implantations avec Rust…','Placing settlements in Rust…','正在使用 Rust 放置聚落…','Situando asentamientos con Rust…','Posicionando assentamentos com Rust…']); }
    if (roads.enabled) roads.pending(); else roads.set(undefined);
    if (fallback) void runSettlementRequest(request).then(receive, error => receive({ id: request.id, error: String(error) }));
    else try {
      const r = request.raster;
      worker!.postMessage(request, r ? [r.height.buffer, r.water.buffer, r.waterLevel.buffer, r.riverWidth.buffer, r.riverIds.buffer] : []);
    } catch { useFallback(); }
  }
  function useFallback(): void {
    // The fallback engine keeps its own terrain: resend the raster.
    worker?.terminate(); worker = undefined; fallback = true; cachedTerrain = undefined;
    if (!options.city) needsPlacement = true; recalculate();
  }
  function receive(response: SettlementResponse): void {
    if (response.id !== id) return;
    el('setGenerate').removeAttribute('aria-busy');
    if ('error' in response) { el('setStatus').textContent = `${urbanText(['Génération des implantations','Settlement generation','聚落生成','Generación de asentamientos','Geração de assentamentos'])}: ${response.error}`; roads.error(response.error); return; }
    answered = response.id;
    pending = false;
    if (response.settlements) {
      output = response.settlements; needsPlacement = false; citySearchRequested = false; cityPlacementScoresStale = false;
      if (options.city) { el('setGenerate').dataset.placementAction = 'search'; el('setGenerate').textContent = urbanText(['Rechercher un nouvel emplacement','Search for a new location','搜索新位置','Buscar nueva ubicación','Buscar novo local']); }
      window.dispatchEvent(new CustomEvent('settlements:generated', { detail: output }));
      if (selection && !output.settlements.some(s => s.key === selection) && !config.list.some(s => s.key === selection)) selection = '';
      const people = output.settlements.reduce((sum, s) => sum + s.population, 0);
      el('setStatus').textContent = `Rust · ${output.settlements.length}/${output.requested} ${urbanText(['lieux','places','个地点','lugares','locais'])} · ${people.toLocaleString()} ${urbanText(['habitants','inhabitants','名居民','habitantes','habitantes'])} · ${output.ms.toFixed(0)} ms`;
      el('setState').textContent = `${output.settlements.length} ${urbanText(['lieux','places','个地点','lugares','locais'])}`;
      el('setWarnings').textContent = output.warnings.join('\n');
    } else if (output) {
      el('setStatus').textContent = `Rust · ${output.settlements.length}/${output.requested} ${urbanText(['lieux','places','个地点','lugares','locais'])} · ${urbanText(['routes recalculées','roads recalculated','道路已重新计算','carreteras recalculadas','estradas recalculadas'])}`;
      el('setState').textContent = `${output.settlements.length} ${urbanText(['lieux','places','个地点','lugares','locais'])}`;
    }
    roads.set(response.roads ?? undefined);
    urban.setSettlements(output, response.roads ?? undefined);
    draw(); list(); editor(); options.onChange();
    syncLanduse(); options.onPlanChange?.();
  }
  /** The inspector always shows one settlement (urban.target): the list and the editor follow it when nothing is selected here. */
  function followInspector(): void {
    const target = urban.target;
    if (!selection && target && target !== 'all' && output?.settlements.some(s => s.key === target)) selection = target;
  }
  function list(): void {
    followInspector();
    showTerrain();
    const entries = config.mode === 'list' ? config.list : output?.settlements ?? [];
    el('setCount').textContent = entries.length ? String(entries.length) : '';
    el('setList').replaceChildren(...entries.map(s => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.key = s.key;
      button.className = 'terrain-place'; button.setAttribute('aria-pressed', String(selection === s.key));
      const result = output?.settlements.find(p => p.key === s.key);
      button.innerHTML = `${classIcon(classOfPop(s.population))}<b>${esc(s.name || s.key)}</b><small>${shortPop(s.population)}</small>`;
      button.title = `${s.name || s.key} · ${localizedDemographicLabel(s.population)} · ${s.population.toLocaleString()} ${urbanText(['hab.','inhabitants','名居民','hab.','hab.'])} · ${result ? `${result.archetype} · score ${result.scores.total.toFixed(2)}` : urbanText(['en attente du placement','awaiting placement','等待选址','pendiente de ubicación','aguardando posicionamento'])}`;
      button.onclick = () => { selection = s.key; urban.selectCity(s.key); setPicking(); list(); editor(); draw(); };
      return button;
    }), el('setAdd'));
    syncCounts();
  }
  function edit(change: (s: SettlementSpec) => void): void {
    adopt(); const spec = config.list.find(s => s.key === selection); if (!spec) return;
    change(spec); list(); changed();
    // Rebuild once focus has moved (Tab from X to Y), then return it to the same field.
    requestAnimationFrame(() => { const focused = document.activeElement?.id; editor(); if (focused) document.getElementById(focused)?.focus(); });
  }
  /** The selected settlement's editor lives in the city inspector's slot (looked up at each render); the left panel is the fallback. */
  let editorOpen = false;
  let updateScoreLocale = (): void => {};
  window.addEventListener('magna-locale-change', () => updateScoreLocale());
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) updateScoreLocale(); });
  const inspectorSlot = (): HTMLElement | null => document.getElementById('cityInspectorSettlement');
  const inspector = document.getElementById('cityInspector');
  // The inspector may render (or re-render) its slot after this code ran: mount the editor whenever an empty slot appears.
  if (inspector) new MutationObserver(() => {
    const slot = inspectorSlot();
    if (selection && (slot ? !slot.hasChildNodes() : !el('setEditor').hasChildNodes())) editor();
  }).observe(inspector, { childList: true, subtree: true });
  function editor(): void {
    updateScoreLocale = () => {};
    followInspector();
    const result = output?.settlements.find(s => s.key === selection);
    const spec = config.mode === 'list' ? config.list.find(s => s.key === selection) : result;
    const slot = inspectorSlot(), host = slot ?? el('setEditor');
    el('setEditor').replaceChildren(); slot?.replaceChildren(); if (!spec) return;
    host.innerHTML = `<div class="settlement-editor compact" data-map-body>
      <div class="map-line se-line"><input id="setName" type="text" maxlength="60" aria-label="Nom" title="Nom" placeholder="Nom"><input id="setPopulation" type="number" min="1" max="5000000" step="1" aria-label="Population" title="Population"><select id="setClass" aria-label="Classe démographique" title="Classe démographique : raccourci de population. La classe est déduite de la population ; elle ne choisit pas une grammaire de plan.">${settlementPopulationChoices().map(c => `<option value="${c.kind}">${c.label}</option>`).join('')}</select>${gearButton('Réglages du lieu')}</div>
      <div class="map-detail" hidden>
      <label>Culture du lieu <select id="setPlaceCulture">${options.city ? cityCultures.map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('') : culture.innerHTML}</select></label>${options.city ? '<div class="settlement-actions"><button id="setCulturePrevious" type="button" title="Profil précédent">◀ Profil</button><button id="setCultureNext" type="button" title="Profil suivant">Profil ▶</button></div>' : ''}
      ${options.city ? '<small data-profile-note>Les profils nommés combinent parfois tradition, organisation urbaine et thème. Leur présence au catalogue ne certifie pas une époque ni une taille historique. Les recettes appliquées se lisent dans le programme.</small>' : ''}
      <label>Role (label) <input id="setKind" type="text" maxlength="60"></label>
      <label>Site preference <select id="setSite"><option value="auto">Automatic</option>${SITE_ARCHETYPES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></label>
      <label>X (m) <input id="setX" type="number" min="0" step="1" placeholder="auto"></label><label>Y (m) <input id="setY" type="number" min="0" step="1" placeholder="auto"></label>
      <div class="settlement-actions"><button id="setMove" type="button">Place on map</button>${options.city ? '<button id="setCentre" type="button" title="Terre ferme la plus proche du centre de la carte">Centre de la carte</button>' : ''}<button id="setAutoPosition" type="button">Automatic position</button><button id="setRemove" type="button">Delete</button></div>
      <details><summary>Site preferences</summary><label>Mountain face <input id="setMountain" type="number" min="0" max="10" step="0.1"></label><label>Woodland <input id="setWood" type="number" min="0" max="10" step="0.1"></label><label>Hilltop weight <input id="setHill" type="number" min="0" max="10" step="0.1"></label></details>
      <div id="setScore"></div></div></div>`;
    const detail = host.querySelector<HTMLElement>('.map-detail')!; detail.hidden = !editorOpen;
    bindGear(host, open => { editorOpen = open; });
    input('setName').value = spec.name; input('setPopulation').value = String(spec.population);
    el<HTMLSelectElement>('setClass').value = classOfPop(spec.population); retainSelectValue(el<HTMLSelectElement>('setPlaceCulture'), spec.culture, 'Profil importé hors catalogue UI');
    input('setKind').value = spec.kind; el<HTMLSelectElement>('setSite').value = spec.siteType;
    input('setX').value = spec.position ? String(Math.round(spec.position.x)) : ''; input('setY').value = spec.position ? String(Math.round(spec.position.y)) : '';
    input('setX').max = input('setY').max = String((options.getTerrain()?.width ?? 100000) - 1);
    const effective = prefs(spec).sitePrefs;
    input('setMountain').value = String(effective.mountainFace ?? 0); input('setWood').value = String(effective.woodland ?? 0); input('setHill').value = String(effective.weights?.hilltop ?? 1);
    input('setName').onchange = event => edit(s => { s.name = (event.target as HTMLInputElement).value.trim(); });
    input('setKind').onchange = event => edit(s => { s.kind = (event.target as HTMLInputElement).value.trim(); });
    input('setPopulation').onchange = event => { const c = event.target as HTMLInputElement; if (c.reportValidity()) edit(s => { s.population = Math.round(Number(c.value)); }); };
    el<HTMLSelectElement>('setClass').onchange = event => edit(s => { const kind = settlementPopulationChoices(5000000).find(k => k.kind === (event.target as HTMLSelectElement).value); if (kind && classOfPop(s.population) !== kind.kind) s.population = kind.population; });
    el<HTMLSelectElement>('setPlaceCulture').onchange = event => edit(s => { s.culture = (event.target as HTMLSelectElement).value; s.sitePrefs = {}; });
    el<HTMLSelectElement>('setSite').onchange = event => edit(s => { s.siteType = (event.target as HTMLSelectElement).value; });
    for (const [name, key] of [['setMountain', 'mountainFace'], ['setWood', 'woodland'], ['setHill', 'hilltop']]) input(name).onchange = event => {
      const c = event.target as HTMLInputElement; if (!c.reportValidity()) return;
      edit(s => { if (key === 'hilltop') s.sitePrefs.weights = { ...prefs(s).sitePrefs.weights, hilltop: Number(c.value) }; else s.sitePrefs = { ...s.sitePrefs, [key]: Number(c.value) }; });
    };
    const positionChanged = (): void => {
      const x = input('setX'), y = input('setY'); if (!x.value && !y.value) { edit(s => { delete s.position; }); return; }
      if (!x.value || !y.value || !x.reportValidity() || !y.reportValidity()) { el('setScore').textContent = urbanText(['Saisissez les deux coordonnées, ou videz-les pour le placement automatique.','Enter both coordinates, or clear both for automatic placement.','请输入两个坐标，或清空两者以使用自动选址。','Introduce ambas coordenadas o borra las dos para la ubicación automática.','Informe as duas coordenadas ou limpe ambas para o posicionamento automático.']); return; }
      edit(s => { s.position = { x: Number(x.value), y: Number(y.value) }; });
    };
    input('setX').onchange = input('setY').onchange = positionChanged;
    if (options.city) {
      el<HTMLSelectElement>('setClass').replaceChildren(...settlementPopulationChoices(5000000).map(k => new Option(k.label, k.kind)));
      el<HTMLSelectElement>('setClass').value = classOfPop(spec.population);
      el('setKind').closest('label')!.hidden = true;
      // Implantation: a fixed position (map centre by default) or a site found by the placement strategy.
      const site = el<HTMLSelectElement>('setSite');
      site.closest('label')!.firstChild!.textContent = 'Implantation ';
      site.replaceChildren(...IMPLANTATIONS.map(([value]) => new Option(siteLabel(value), value)));
      // A placed site keeps its type once adopted (adoption pins the found position).
      site.value = spec.siteType !== 'auto' ? spec.siteType : spec.position ? 'fixed' : 'auto';
      site.onchange = () => {
        if (site.value !== 'fixed') { edit(s => { s.siteType = site.value as SettlementSpec['siteType']; delete s.position; }); return; }
        const p = spec.position ?? result?.center;
        if (p) edit(s => { s.siteType = 'auto'; s.position = { ...p }; });
        else { setPicking(selection); el('setScore').textContent = urbanText(['Aucune position connue : cliquez sur la carte pour placer la ville.','No known position: click the map to place the city.','位置未知：请点击地图放置城市。','Posición desconocida: haz clic en el mapa para situar la ciudad.','Posição desconhecida: clique no mapa para posicionar a cidade.']); }
      };
      el('setRemove').hidden = true; el('setMountain').closest('details')!.hidden = true;
      const cultureSelect = el<HTMLSelectElement>('setPlaceCulture');
      // A place profile change preserves the independent plan, parcel and architecture overrides.
      bindCityPlaceCulture(cultureSelect, edit);
      const step = (delta: number): void => { cultureSelect.selectedIndex = (cultureSelect.selectedIndex + delta + cultureSelect.options.length) % cultureSelect.options.length; cultureSelect.dispatchEvent(new Event('change')); };
      el('setCulturePrevious').onclick = () => step(-1); el('setCultureNext').onclick = () => step(1);
      el('setCentre').onclick = () => {
        const width = options.getTerrain()?.width ?? 0, p = dryNear({ x: width / 2, y: width / 2 });
        if (!p) { el('setScore').textContent = urbanText(['Aucune terre ferme sur cette carte.','No dry land on this map.','此地图上没有陆地。','No hay tierra firme en este mapa.','Não há terra firme neste mapa.']); return; }
        edit(s => { s.position = { x: Math.round(p.x), y: Math.round(p.y) }; });
      };
    }
    el('setMove').onclick = () => { adopt(); setPicking(selection); };
    el('setAutoPosition').textContent = options.city ? el('setGenerate').textContent : urbanText(['Position automatique','Automatic position','自动选址','Posición automática','Posição automática']);
    el('setAutoPosition').onclick = () => { if (options.city) requestPlacementSearch(); else edit(s => { delete s.position; }); };
    el('setRemove').onclick = () => { adopt(); config.list = config.list.filter(s => s.key !== selection); selection = ''; setPicking(); list(); editor(); changed(); };
    updateScoreLocale = (): void => {
      const classSelect = document.getElementById('setClass') as HTMLSelectElement | null;
      if (classSelect) { const names = new Map(settlementPopulationChoices().map(choice => [choice.kind, choice.label])); for (const option of Array.from(classSelect.options)) option.textContent = names.get(option.value as ReturnType<typeof classOfPop>) ?? option.textContent; }
      const setLabel = (id: string, value: string): void => { const text = document.getElementById(id)?.closest('label')?.firstChild; if (text?.nodeType === Node.TEXT_NODE) text.textContent = `${value} `; };
      const names = urbanText(['Nom','Name','名称','Nombre','Nome']);
      const nameField = document.getElementById('setName'); if (nameField) for (const attribute of ['aria-label','title','placeholder']) nameField.setAttribute(attribute,names);
      const populationField = document.getElementById('setPopulation'); if (populationField) for (const attribute of ['aria-label','title']) populationField.setAttribute(attribute,urbanText(['Population','Population','人口','Población','População']));
      classSelect?.setAttribute('aria-label',urbanText(['Classe démographique','Demographic class','人口类别','Clase demográfica','Classe demográfica']));
      classSelect?.setAttribute('title',urbanText(['Classe démographique : raccourci de population. La classe est déduite de la population ; elle ne choisit pas une grammaire de plan.','Demographic class: population shortcut. Class is derived from population; it does not select a plan grammar.','人口类别是人口快捷值。类别根据人口推导，不选择规划规则。','Clase demográfica: valor rápido de población. La clase se deduce de la población y no elige la gramática del plano.','Classe demográfica: atalho de população. A classe é derivada da população e não escolhe a gramática do plano.']));
      setLabel('setPlaceCulture',urbanText(['Culture du lieu','Place culture','地点文化','Cultura del lugar','Cultura do local']));
      setLabel('setKind',urbanText(['Rôle (libellé)','Role (label)','角色（标签）','Función (etiqueta)','Função (rótulo)']));
      setLabel('setSite',options.city ? urbanText(['Implantation','Placement','选址','Ubicación','Implantação']) : urbanText(['Préférence de site','Site preference','场地偏好','Preferencia de sitio','Preferência de local']));
      setLabel('setMountain',urbanText(['Versant de montagne','Mountain face','山坡','Ladera de montaña','Encosta de montanha'])); setLabel('setWood',urbanText(['Boisement','Woodland','林地','Arbolado','Área florestal'])); setLabel('setHill',urbanText(['Poids du sommet','Hilltop weight','山顶权重','Peso de la cima','Peso do topo']));
      const site = document.getElementById('setSite') as HTMLSelectElement | null; if (site) for (const option of Array.from(site.options)) option.textContent = siteLabel(option.value);
      const gear = host.querySelector<HTMLButtonElement>('.map-gear'); if (gear) { const title=urbanText(['Réglages du lieu','Place settings','地点设置','Ajustes del lugar','Configurações do local']); gear.title=title; gear.setAttribute('aria-label',title); }
      const note = host.querySelector<HTMLElement>('[data-profile-note]'); if (note) note.textContent = urbanText(['Les profils nommés combinent parfois tradition, organisation urbaine et thème. Leur présence au catalogue ne certifie pas une époque ni une taille historique. Les recettes appliquées se lisent dans le programme.','Named profiles sometimes combine tradition, urban organization and theme. Their presence in the catalogue does not certify a historical period or size. Applied recipes appear in the programme.','命名配置有时结合传统、城市组织和主题。目录中的配置不能证明历史时期或规模。已应用配方可在规划方案中查看。','Los perfiles combinan a veces tradición, organización urbana y tema. Su presencia en el catálogo no certifica época ni tamaño histórico. Las recetas aplicadas aparecen en el programa.','Os perfis às vezes combinam tradição, organização urbana e tema. Sua presença no catálogo não certifica período nem tamanho histórico. As receitas aplicadas aparecem no programa.']);
      const preferences = host.querySelector<HTMLElement>('.map-detail details summary'); if (preferences) preferences.textContent = urbanText(['Préférences de site','Site preferences','场地偏好','Preferencias de sitio','Preferências do local']);
      const move = document.getElementById('setMove'); if (move) move.textContent = urbanText(['Placer sur la carte','Place on map','在地图上放置','Situar en el mapa','Posicionar no mapa']);
      const automatic = document.getElementById('setAutoPosition'); if (automatic) automatic.textContent = options.city ? el('setGenerate').textContent : urbanText(['Position automatique','Automatic position','自动选址','Posición automática','Posição automática']);
      const remove = document.getElementById('setRemove'); if (remove) remove.textContent = urbanText(['Supprimer','Delete','删除','Eliminar','Excluir']);
      const center = document.getElementById('setCentre'); if (center) { center.textContent = urbanText(['Centre de la carte','Map center','地图中心','Centro del mapa','Centro do mapa']); center.title = urbanText(['Terre ferme la plus proche du centre de la carte','Dry land closest to the map center','离地图中心最近的陆地','Tierra firme más cercana al centro del mapa','Terra firme mais próxima do centro do mapa']); }
      const previous = document.getElementById('setCulturePrevious'); if (previous) { previous.textContent = `◀ ${urbanText(['Profil','Profile','配置','Perfil','Perfil'])}`; previous.title = urbanText(['Profil précédent','Previous profile','上一配置','Perfil anterior','Perfil anterior']); }
      const next = document.getElementById('setCultureNext'); if (next) { next.textContent = `${urbanText(['Profil','Profile','配置','Perfil','Perfil'])} ▶`; next.title = urbanText(['Profil suivant','Next profile','下一配置','Perfil siguiente','Próximo perfil']); }
      if (!document.getElementById('setScore')) return; if (result) {
      const scores = result.scores, stale = options.city && cityPlacementScoresStale;
      const ranking = scores.rankingScore == null ? '' : `<small>${urbanText(['Rang du candidat','Candidate rank','候选排名','Puesto del candidato','Posição do candidato'])} ${scores.candidateRank} · ${urbanText(['score de classement','ranking score','排名分数','puntuación de clasificación','pontuação de classificação'])} ${scores.rankingScore.toFixed(3)} (${urbanText(['référence de classe','class reference','类别参考','referencia de clase','referência de classe'])} ${scores.rankingPopulation} ${urbanText(['habitants, avant variation','inhabitants, before jitter','名居民，变动之前','habitantes, antes de la variación','habitantes, antes da variação'])})</small>`;
      const terms: [string, number][] = [[urbanText(['Planéité','Flatness','平坦度','Llanura','Planura']), scores.flatness], [urbanText(['Terrain constructible','Buildable land','可建土地','Terreno edificable','Terreno edificável']), scores.buildable], [urbanText(['Eau douce','Fresh water','淡水','Agua dulce','Água doce']), scores.freshWater], [urbanText(['Accès à la rivière','River access','河流通达','Acceso al río','Acesso ao rio']), scores.river], [urbanText(['Port','Harbor','港口','Puerto','Porto']), scores.harbor], [urbanText(['Risque d’inondation','Flood risk','洪水风险','Riesgo de inundación','Risco de inundação']), scores.flood], [urbanText(['Culture','Culture','文化','Cultura','Cultura']), scores.culture], [urbanText(['Type de site','Site type','场地类型','Tipo de sitio','Tipo de local']), scores.site], [urbanText(['Défense','Defensibility','防御性','Defensa','Defesa']), scores.defense], [urbanText(['Altitude','Elevation','海拔','Elevación','Altitude']), scores.elevation], [urbanText(['Regroupement','Clustering','聚集','Agrupamiento','Agrupamento']), scores.cluster], [urbanText(['Variation de graine','Seed variation','种子变化','Variación de semilla','Variação da semente']), scores.variation]];
      const unreachable = roads.output?.unreachable.includes(result.key) ? `<br>${urbanText(['Inaccessible par route','Unreachable by road','道路无法到达','Inaccesible por carretera','Inacessível por estrada'])}` : '';
      el('setScore').innerHTML = `<b>${stale ? urbanText(['Score conservé','Retained score','保留的分数','Puntuación conservada','Pontuação mantida']) : urbanText(['Score de choix','Choice score','选址分数','Puntuación de elección','Pontuação de escolha'])} ${scores.total.toFixed(3)}</b><small>${stale ? urbanText(['Données du site initial non réévaluées.','Original site data not reassessed.','原场地数据未重新评估。','Datos del sitio inicial no reevaluados.','Dados do local inicial não reavaliados.']) : scores.manual ? urbanText(['Position manuelle ; score affiché pour comparaison.','Manual position; score shown for comparison.','手动位置；分数仅供比较。','Posición manual; puntuación mostrada para comparación.','Posição manual; pontuação exibida para comparação.']) : urbanText(['Tirage pondéré parmi les sites disponibles, favorisant les terrains adaptés et libres.','Weighted draw over available sites, favouring suitable ground and unoccupied territory.','在可用地点中加权选择，优先考虑适宜且未占用的土地。','Sorteo ponderado entre sitios disponibles, favoreciendo terrenos adecuados y libres.','Sorteio ponderado entre locais disponíveis, favorecendo terrenos adequados e livres.'])}<br>${result.center.x.toFixed(0)}, ${result.center.y.toFixed(0)} m · ${esc(result.archetype)} · ${urbanText(['rayon','radius','半径','radio','raio'])} ${result.radius.toFixed(0)} m</small><table>${terms.filter(([, v]) => v !== 0).map(([label, value]) => `<tr><td>${label}</td><td>${value >= 0 ? '+' : ''}${value.toFixed(3)}</td></tr>`).join('')}</table><small>${urbanText(['Constructible','Buildable','可建','Edificable','Edificável'])} ${(scores.buildableFraction * 100).toFixed(0)}% · ${urbanText(['pente','slope','坡度','pendiente','inclinação'])} ${(Math.atan(scores.slope) * 180 / Math.PI).toFixed(1)}°<br>${urbanText(['Eau','Water','水','Agua','Água'])} ${scores.waterDistance >= 1e6 ? urbanText(['absente','absent','无','ausente','ausente']) : `${scores.waterDistance.toFixed(0)} m`} · ${urbanText(['au-dessus de l’eau','above water','高于水面','sobre el agua','acima da água'])} ${scores.heightAboveWater.toFixed(1)} m<br>${urbanText(['Espacement','Spacing','间距','Espaciado','Espaçamento'])} × ${scores.spacingRelaxation.toFixed(2)}${unreachable}</small>`;
      if (options.city && cityPlacementScoresStale) el('setScore').insertAdjacentHTML('afterbegin', `<p><strong>${urbanText(['Position conservée ou déplacée manuellement ; scores, rayon et archétype du site initial non recalculés.','Position retained or manually moved; scores, radius and archetype from the original site were not recomputed.','位置已保留或手动移动；原场地的分数、半径和类型未重新计算。','Posición conservada o movida manualmente; no se recalcularon las puntuaciones, el radio ni el arquetipo del sitio inicial.','Posição mantida ou movida manualmente; pontuações, raio e arquétipo do local inicial não foram recalculados.'])}</strong> ${urbanText(['Ces valeurs ne certifient pas les nouveaux réglages ni le nouveau centre.','These values do not certify the new settings or center.','这些数值不能证明新设置或新中心有效。','Estos valores no certifican los nuevos ajustes ni el nuevo centro.','Esses valores não certificam as novas configurações nem o novo centro.'])}</p>`);
      el('setScore').insertAdjacentHTML('beforeend', ranking);
    } else el('setScore').textContent = urbanText(['Cette implantation n’a pas encore de position valide. Utilisez le placement automatique ou placez-la sur une terre ferme.','This settlement has no valid position yet. Use automatic position or place it on dry land.','此聚落尚无有效位置。请使用自动选址或将其放在陆地上。','Este asentamiento aún no tiene una posición válida. Usa la posición automática o colócalo en tierra firme.','Este assentamento ainda não tem posição válida. Use a posição automática ou coloque-o em terra firme.']); };
    updateScoreLocale();
  }
  function draw(): void {
    let layer = map.querySelector<SVGGElement>('#settlementOverlay');
    if (!layer) { layer = document.createElementNS(ns, 'g'); layer.id = 'settlementOverlay'; map.append(layer); }
    roads.draw();
    // Inspector views (buildings; City Bench roles) take map clicks: markers stay visible but inert.
    layer.style.pointerEvents = urban.inspecting ? 'none' : 'auto';
    const draft = pending && config.mode === 'list' ? config.list : undefined;
    const state = `${enabled}|${showPoints}|${selection}|${draft ? JSON.stringify(draft) : ''}`;
    if (layer === drawnLayer && output === drawnOutput && state === drawnState) {
      for (const marker of Array.from(layer.querySelectorAll<SVGGElement>('[data-settlement]'))) {
        marker.setAttribute('transform', `translate(${marker.dataset.x} ${marker.dataset.y}) scale(${1 / options.getView().scale})`);
      }
      return;
    }
    drawnLayer = layer; drawnOutput = output; drawnState = state;
    layer.replaceChildren(); if (!enabled || !output || !showPoints) return;
    const scale = options.getView().scale;
    const displayed = draft ? draft.flatMap(spec => {
      const placed = output?.settlements.find(s => s.key === spec.key), center = spec.position ?? placed?.center;
      return center ? [{ ...spec, center, cls: classOfPop(spec.population), archetype: 'pending', scores: placed?.scores }] : [];
    }) : output.settlements;
    for (const [index, s] of displayed.entries()) {
      const marker = document.createElementNS(ns, 'g'); marker.dataset.settlement = s.key; marker.classList.add('settlement-marker'); marker.setAttribute('transform', `translate(${s.center.x} ${s.center.y}) scale(${1 / scale})`);
      marker.dataset.x = String(s.center.x); marker.dataset.y = String(s.center.y);
      marker.style.color = selection === s.key ? '#176348' : '#252b29';
      const hit = document.createElementNS(ns, 'rect'); hit.setAttribute('x', '-19'); hit.setAttribute('y', '-22'); hit.setAttribute('width', '54'); hit.setAttribute('height', '54'); hit.setAttribute('fill', 'transparent');
      const symbol = document.createElementNS(ns, 'path'); symbol.classList.add('settlement-symbol'); symbol.setAttribute('d', settlementSymbols[classOfPop(s.population)]);
      const number = document.createElementNS(ns, 'text'); number.classList.add('settlement-number'); number.setAttribute('x', '21'); number.setAttribute('y', '5'); number.textContent = String(index + 1);
      const population = document.createElementNS(ns, 'text'); population.classList.add('settlement-population'); population.setAttribute('x', '5'); population.setAttribute('y', '27'); population.setAttribute('text-anchor', 'middle'); population.textContent = s.population.toLocaleString();
      const title = document.createElementNS(ns, 'title'); title.textContent = `${s.cls} · ${s.culture} · ${s.archetype}\n${s.population} inhabitants${s.scores ? ` · score ${s.scores.total.toFixed(3)}` : ''}\nClick to edit; drag to move`;
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
    if (raster.water[i]) { el('setPickHint').textContent = urbanText(['Choisissez une terre ferme : ce point est sur de l’eau ou de la roche massive.','Choose dry land: this point is on water or solid rock.','请选择陆地：此位置位于水面或坚岩上。','Elige tierra firme: este punto está sobre agua o roca maciza.','Escolha terra firme: este ponto está sobre água ou rocha maciça.']); el('setPickHint').hidden = false; return false; }
    adopt();
    if (picking === 'new') {
      config.mode = 'list'; const key = `manual:${crypto.randomUUID()}`; const s = defaultSettlementSpec(key); s.culture = config.main.culture; s.name = `Place ${config.list.length + 1}`; s.position = p; config.list.push(s); selection = key;
    } else {
      const s = config.list.find(s => s.key === (picking ?? drag?.key)); if (!s) return false; s.position = p; selection = s.key;
    }
    enabled = true; setPicking(); controls(); list(); editor(); changed();
    // A new manually pinned site needs native metadata, but only after this explicit map action.
    if (options.city && !output?.settlements.some(s => s.key === selection)) { citySearchRequested = true; needsPlacement = true; }
    return true;
  }
  map.addEventListener('pointerdown', event => {
    if (urban.inspecting) return;
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
    if (!urban.inspecting && (suppressClick || (event.target as Element).closest('[data-settlement]'))) { event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') { setPicking(); drag = undefined; draw(); } });
  input('setEnabled').onchange = () => { enabled = input('setEnabled').checked; changed(); };
  input('setAutoRefresh').checked = autoRefresh;
  el('setRefresh').hidden = autoRefresh;
  el('setRefresh').onclick = recalculate;
  input('setAutoRefresh').onchange = () => {
    autoRefresh = input('setAutoRefresh').checked;
    el('setRefresh').hidden = autoRefresh;
    clearTimeout(timer);
    if (pending || answered !== id) schedule();
    options.onChange();
  };
  mode.onchange = () => { if (mode.value === 'list') adopt(); config.mode = mode.value as SettlementConfig['mode']; selection = ''; controls(); list(); editor(); changed(); };
  distribution.onchange = () => { config.distribution = distribution.value as SettlementConfig['distribution']; controls(); changed(); };
  input('setMainPop').onchange = () => { if (input('setMainPop').reportValidity()) { config.main.population = Math.round(Number(input('setMainPop').value)); changed(); } };
  culture.onchange = () => { config.main.culture = culture.value; config.main.sitePrefs = {}; changed(); };
  for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-setting],[data-count],[data-site]'))) c.onchange = () => {
    if (!c.reportValidity()) return;
    if (c.dataset.count) {
      // Editing a count switches to the composition by counts, starting from what the map holds now.
      if (config.mode !== 'counts') {
        const live: Record<string, number> = { city: 0, town: 0, village: 0, hamlet: 0, farmstead: 0 };
        for (const s of output?.settlements ?? []) { const cls = classOfPop(s.population); live[cls === 'metropolis' || cls === 'megacity' ? 'city' : cls]++; }
        Object.assign(config.counts, live); config.mode = 'counts'; selection = ''; mode.value = 'counts'; list(); editor();
      }
      config.counts[c.dataset.count] = Math.round(Number(c.value));
    }
    else if (c.dataset.site) { if (Number(c.value) === 1) delete config.siteWeights[c.dataset.site]; else config.siteWeights[c.dataset.site] = Number(c.value); }
    else (config as unknown as Record<string, unknown>)[c.dataset.setting!] = Number(c.value);
    changed();
  };
  input('setShowPoints').onchange = () => { showPoints = input('setShowPoints').checked; draw(); options.onChange(); };
  function requestPlacementSearch(): void {
    if (options.city) {
      adopt();
      const spec = config.list.find(s => s.key === selection);
      const pinnedNew = config.mode === 'list' && config.list.length > 0 && config.list.every(s => s.position)
        && config.list.some(s => !output?.settlements.some(p => p.key === s.key));
      if (spec && !pinnedNew) delete spec.position; // Explicit new-site validation keeps imported/manual pins exact.
      citySearchRequested = true;
    }
    needsPlacement = true; recalculate();
  }
  el('setGenerate').onclick = requestPlacementSearch;
  el('setTakeOver').onclick = () => { adopt(); selection = config.list[0]?.key ?? ''; controls(); list(); editor(); changed(); };
  el('setAdd').textContent = '＋ placer'; el('setAdd').classList.add('terrain-place', 'terrain-add'); el('setAdd').title = 'Placer un settlement sur la carte (clic sur la terre ferme)';
  el('setAdd').onclick = () => setPicking(picking === 'new' ? undefined : 'new');
  /** Decor of the current map, once placement and routing answered the latest request. */
  const decorReady = (): boolean => complete && enabled && !pending && !!output && answered === id && (!roads.enabled || !!roads.output);
  const decorData = (extra?: Parameters<typeof captureDecorData>[5]): Decor => {
    const t = options.getTerrain();
    if (!t || !decorReady()) throw new Error('Wait for the settlements and roads of the completed map.');
    const retained = options.getDecor?.();
    if (retained) {
      const snapshot: Decor = { raster: retained.raster, meta: { ...retained.meta, ...extra, query: options.getQuery?.() ?? retained.meta.query,
        settlements: clone(output!.settlements), roads: roads.output ?? null, roadConfig: roads.enabled ? clone(roads.config) : null,
        stats: { ...retained.meta.stats, roadKm: (roads.output?.segments.reduce((s, r) => s + r.length, 0) ?? 0) / 1000 },
        pipeline: { ...retained.meta.pipeline, stage: 'settlements', parent: retained.meta.id, urban: urban.workshopState(), urbanDraft: urban.workshopDraft() } } };
      return snapshot;
    }
    return captureDecorData(t, options.getSettings(), output!, roads.output, roads.enabled ? clone(roads.config) : null,
      { ...extra, query: extra?.query ?? options.getQuery?.(),
        pipeline: { stage: 'settlements', urban: urban.workshopState(), urbanDraft: urban.workshopDraft() } });
  };
  const exports = createTerrainDecorExports(decorData);
  el('setExportDecor').onclick = () => {
    try {
      const s = options.getSettings();
      // Call in the button activation, before history/compression/storage awaits.
      void downloadDecorFile(decorData(), `${s.relief}-${s.seed}.decor`.replace(/[^\w.-]+/g, '_'))
        .catch(error => { el('setStatus').textContent = String(error instanceof Error ? error.message : error); });
    } catch (error) { el('setStatus').textContent = String(error instanceof Error ? error.message : error); }
  };
  // Batch export (web/scripts/export_decors.mjs) drives the bench through this hook.
  (window as unknown as { magnaDecor: unknown }).magnaDecor = {
    ready: decorReady,
    export: exports.export,
    exportAsync: exports.exportAsync,
  };
  controls(); list();
  return {
    urban,
    get illustrationSettlements() { return enabled ? output?.settlements : undefined; },
    contextReady: () => complete && (!enabled || answered === id) && !urban.layoutPending && !urban.generationPending,
    captureContext: () => ({ selection, urban: urban.captureContext() }),
    restoreContext(saved: { selection?: string; urban?: ReturnType<typeof urban.captureContext> }): void {
      if (saved?.selection && output?.settlements.some(s => s.key === saved.selection)) selection = saved.selection;
      if (saved?.urban) urban.restoreContext(saved.urban);
      list(); editor(); draw();
    },
    ready: decorReady,
    capture: exports.capture,
    captureAsync: exports.captureAsync,
    captureData: decorData,
    restoreDecor(d: Decor): void {
      clearTimeout(timer); ++id; answered = id; pending = false; complete = true; cachedTerrain = undefined;
      citySearchRequested = false; cityPlacementScoresStale = false;
      if (!d.meta.settlements.length) { output = undefined; needsPlacement = !options.city; recalculate(); return; }
      // The City Bench link carries the edited city (size, culture, position); the map keeps its first placement.
      const edited = options.city && config.mode === 'list' && config.list.length ? clone(config.list) : undefined;
      enabled = true; output = { settlements: clone(d.meta.settlements), requested: d.meta.settlements.length, usableKm2: 0, warnings: [], ms: 0 }; needsPlacement = false;
      config.mode = 'auto'; adopt();
      const key = (s: SettlementSpec): string => JSON.stringify([s.key, s.population, s.culture, s.name, s.position && [s.position.x, s.position.y]]);
      const replaced = !!edited && edited.map(key).join() !== config.list.map(key).join();
      if (replaced) config.list = edited!; selection = d.meta.pipeline?.city ?? (options.city ? output.settlements[0]?.key ?? '' : ''); controls(); list(); editor();
      el('setStatus').textContent = `${urbanText(['Carte','Map','地图','Mapa','Mapa'])} · ${output.settlements.length} ${urbanText(['lieux','places','个地点','lugares','locais'])} · ${output.settlements.reduce((sum, s) => sum + s.population, 0).toLocaleString()} ${urbanText(['habitants','inhabitants','名居民','habitantes','habitantes'])}`;
      if (d.meta.roadConfig) roads.setConfig(d.meta.roadConfig);
      restoringDecor = true; roads.set(d.meta.roads ?? undefined);
      // An edited city (link or situation) is placed and routed again right below:
      // planning the map's original settlement first would be thrown away (100k: ~77 s).
      if (!replaced) {
        urban.setSettlements(output, d.meta.roads ?? undefined);
        if (d.meta.pipeline?.urban?.layouts?.length) urban.restoreSnapshot(d.meta.pipeline.urban);
      }
      if (d.meta.pipeline?.urbanDraft) urban.applyWorkshopDraft(d.meta.pipeline.urbanDraft);
      restoringDecor = false; publishOptions(urban.workshopDraft() ?? urban.workshopSettings());
      syncLanduse(); draw(); options.onChange();
      if (replaced) changed();
    },
    get paintingContext(): UrbanPaintingContext {
      const cities = enabled ? output?.settlements : undefined, roadOutput = roads.enabled ? roads.output : undefined, landuseSample = landuse?.sample;
      if (!paintingContext || paintingContext.layouts !== urban.layouts || paintingContext.roads !== roadOutput || paintingContext.cities !== cities || paintingContext.landuse !== landuseSample) {
        paintingContext = { layouts: urban.layouts, roads: roadOutput, cities, landuse: landuseSample };
      }
      return paintingContext;
    },
    applyUrbanChanges: urban.applyPending,
    cancelPicking(): void { setPicking(); },
    /** Style or forest settings changed: update the Canvas woods and republish the occupation. */
    refreshForestMaterial(): void { syncLanduse(); landuse?.refreshForest(); publishForest(true); },
    terrainReady(): void { complete = true; citySearchRequested = false; needsPlacement = !options.city; recalculate(); },
    terrainFailed(message: string): void {
      complete = false; ++id; clearTimeout(timer);
      el('setGenerate').removeAttribute('aria-busy');
      el('setStatus').textContent = `${urbanText(['Implantations bloquées par la génération du terrain','Settlements blocked by terrain generation','地形生成阻止了聚落生成','Asentamientos bloqueados por la generación del terreno','Assentamentos bloqueados pela geração do terreno'])}: ${message}`;
      roads.error(`Terrain generation failed: ${message}`);
      urban.terrainFailed(message);
    },
    terrainPending(): void { complete = false; ++id; output = undefined; cachedTerrain = undefined; validation = undefined; roads.set(undefined); urban.terrainPending(); draw(); el('setStatus').textContent = urbanText(['En attente de la carte terminée…','Waiting for the completed map…','正在等待地图生成完成…','Esperando a que termine el mapa…','Aguardando o mapa concluído…']); },
    updateView(): void { draw(); roads.draw(); urban.updateView(); landuse?.updateView(); },
    isPicking: (): boolean => !!picking,
    click(event: MouseEvent): boolean { if (!picking) return false; placeAt(world(event)); return true; },
    share(params: URLSearchParams): void {
      params.set('settlements', JSON.stringify({ config, enabled, showPoints, autoRefresh }));
      params.set('roads', roads.share());
      urban.share(params);
      // Until land use has loaded, keep its settings from the current link.
      if (landuse) landuse.share(params); else { const saved = new URLSearchParams(location.search).get('landuse'); if (saved) params.set('landuse', saved); }
    },
  };
}
import { executionRuntime } from './executionProfile';

/** City Bench implantation choices; every site type is required first, then relaxed with a warning. */
const IMPLANTATIONS: [string, string][] = [
  ['fixed', 'Position conservée ou placée à la main'], ['auto', 'Stratégie automatique'],
  ['harbor', 'Côte, port'], ['estuary', 'Estuaire'], ['bridge', 'Bord de rivière, pont'], ['meander', 'Méandre'],
  ['confluence', 'Confluence'], ['lakeshore', 'Rive de lac'], ['island', 'Île'],
  ['hilltop', 'Colline'], ['spur', 'Hauteur fortifiée, éperon'], ['pass', 'Col de montagne'],
  ['valley', 'Fond de vallée'], ['plain', 'Plaine'],
];
const SITE_LABELS: Record<string, readonly [string,string,string,string,string]> = {
  fixed:['Position conservée ou placée à la main','Retained or manually placed position','保留或手动放置的位置','Posición conservada o manual','Posição mantida ou manual'], auto:['Stratégie automatique','Automatic strategy','自动策略','Estrategia automática','Estratégia automática'], harbor:['Côte, port','Coast, harbor','海岸、港口','Costa, puerto','Costa, porto'], estuary:['Estuaire','Estuary','河口','Estuario','Estuário'], bridge:['Bord de rivière, pont','Riverbank, bridge','河岸、桥梁','Ribera, puente','Margem do rio, ponte'], meander:['Méandre','Meander','曲流','Meandro','Meandro'], confluence:['Confluence','Confluence','汇流处','Confluencia','Confluência'], lakeshore:['Rive de lac','Lakeshore','湖岸','Orilla del lago','Margem do lago'], island:['Île','Island','岛屿','Isla','Ilha'], hilltop:['Colline','Hilltop','山顶','Colina','Colina'], spur:['Hauteur fortifiée, éperon','Fortified height, spur','高地堡垒、山嘴','Altura fortificada, espolón','Altura fortificada, esporão'], pass:['Col de montagne','Mountain pass','山口','Puerto de montaña','Passagem de montanha'], valley:['Fond de vallée','Valley floor','谷底','Fondo de valle','Fundo do vale'], plain:['Plaine','Plain','平原','Llanura','Planície'],
};
function siteLabel(id: string): string { return SITE_LABELS[id] ? urbanText(SITE_LABELS[id]) : id; }
