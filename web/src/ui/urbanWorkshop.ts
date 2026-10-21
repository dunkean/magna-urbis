import catalogue from '../../../rust/crates/core/src/urban/catalogue.json';
import UrbanWorker from './urbanWorker?worker&inline';
import { createUrbanEngine, normalizeLayoutConfig, normalizeParcelConfig, regionalStreets, type Layout, type Shape, type UrbanRequest, type UrbanResponse } from '../../../rust/bridge/urban';
import type { RoadOutput, RoadSite, SettlementRaster } from '../../../rust/bridge/settlements';
import { benchLayout, type BenchOptions } from '../gen/urban/testbench';
import { createGrid } from '../gen/core/grid';
import { applyBenchConstraints } from '../gen/urban/testbenchConstraints';
import type { World } from '../gen/types';
import { createUrbanSceneClient } from './urbanScene';
import { openBench } from './benchHistory';
import { urbanDisplaySurface } from './urbanPerspective';
import { cityWorkshopState, workshopSettings } from './urbanSnapshot';
import { WORKSHOP_CHANNEL, normalizeWorkshopContext, workshopConfig, workshopFixtureFrame, type WorkshopRequest, type WorkshopResult, type WorkshopState } from './testbenchUrban';

interface MapContext { waterAppearance?: { geometry: string; material: import('./decorWater').RetainedWaterMaterial }; raster: SettlementRaster; sites: RoadSite[]; roads?: RoadOutput; seed: string }
/** Two workspaces, one existing editor and the same native worker as the map. */
export function createUrbanWorkshop(options: {
  urban: { workshopState(): WorkshopState; applyWorkshop(state: Partial<WorkshopState>): void };
  getContext(): MapContext | undefined; getStyle?(): string; onChange(): void; workshopOnly?: boolean; onReturn?(state: WorkshopState): Promise<void>;
  onExport?(state: WorkshopState, download?: boolean): Promise<void>;
}) {
  const query = new URLSearchParams(location.search), workspace = document.querySelector<HTMLElement>('.terrain-workspace')!;
  const nav = document.createElement('div'); nav.className = 'control-group workshop-navigation';
  nav.innerHTML = '<button type="button" data-map-space>Carte</button><button type="button" data-workshop-space>Atelier quartiers / parcelles</button>';
  for (const button of Array.from(nav.querySelectorAll('button'))) { button.style.width = 'auto'; button.style.padding = '4px 10px'; button.style.whiteSpace = 'nowrap'; }
  document.querySelector('header')!.append(nav);
  if (options.workshopOnly) nav.hidden = true;
  const section = document.createElement('section'); section.hidden = true; section.id = 'urbanWorkshop';
  section.innerHTML = '<div class="control-group" style="padding:8px;flex-wrap:wrap"><button type="button" data-from-map>Charger le plan de la carte</button><button type="button" data-fixture>Nouvelle scène isolée</button><button type="button" data-to-map disabled>Appliquer les réglages à la carte</button><a data-standalone target="_blank" rel="noopener">Ouvrir cet atelier seul</a><span data-workshop-status role="status"></span></div><iframe title="Éditeur de quartiers et parcelles" style="display:block;width:100%;height:calc(100vh - 110px);border:0"></iframe>';
  workspace.after(section);
  const frame = section.querySelector('iframe')!, mapButton = nav.querySelector<HTMLButtonElement>('[data-map-space]')!, workshopButton = nav.querySelector<HTMLButtonElement>('[data-workshop-space]')!;
  const applyButton = section.querySelector<HTMLButtonElement>('[data-to-map]')!, note = section.querySelector<HTMLElement>('[data-workshop-status]')!;
  if (options.onExport) {
    const button = document.createElement('button'); button.textContent = 'Conserver et partager .decor';
    button.onclick = () => { if (latest) void options.onExport!(latest).then(() => { note.textContent = 'Export ajouté à l’historique et téléchargé.'; }, e => { note.textContent = String(e); }); };
    section.firstElementChild!.append(button);
  }
  if (options.workshopOnly) {
    section.querySelector<HTMLElement>('[data-from-map]')!.textContent = 'Recharger la ville transmise';
    applyButton.textContent = 'Renvoyer aux settlements';
  }
  let space = options.workshopOnly || query.get('space') === 'workshop' ? 'workshop' : 'map', caseState = query.get('workshop') ?? '';
  let latestDraft: Partial<WorkshopState> | undefined;
  let latest: WorkshopState | undefined, pendingImport: WorkshopState | undefined, ready = false;
  const plans: Partial<Record<'map' | 'fixture', Pick<WorkshopState, 'layouts' | 'partitions' | 'buildingState'>>> = {};
  const sceneClient = createUrbanSceneClient();
  let generationEpoch = 0;
  const awaitingMap = !caseState && (query.has('artifact') || query.has('decor'));
  let workshopSource: 'fixture' | 'map' = awaitingMap ? 'map' : 'fixture', retainedContext: MapContext | undefined, retainedSites = '';
  let invalidated = false, acceptApplied = true;
  let expectedSource: 'map' | 'fixture' | undefined = awaitingMap ? 'map' : undefined;
  function retainContext(): void { retainedContext = options.getContext(); retainedSites = JSON.stringify(retainedContext?.sites); }
  function verifyContext(): void {
    if (workshopSource !== 'map' || !retainedContext || invalidated) return;
    const current = options.getContext();
    if (current?.raster === retainedContext.raster && current.roads === retainedContext.roads && current.seed === retainedContext.seed && JSON.stringify(current.sites) === retainedSites) return;
    ++generationEpoch; sceneClient.invalidate();
    invalidated = true; caseState = ''; latest = undefined; pendingImport = undefined; applyButton.disabled = true;
    frame.style.visibility = 'hidden'; note.textContent = 'Carte modifiée, rechargez le plan dans l’atelier.'; display();
  }
  const targetOrigin = location.protocol === 'file:' || location.origin === 'null' ? '*' : location.origin;
  const send = (data: object): void => frame.contentWindow?.postMessage({ channel: WORKSHOP_CHANNEL, ...data }, targetOrigin);
  const mergeBuildingState = (incoming: WorkshopState['buildingState'], applied: WorkshopState['buildingState']): WorkshopState['buildingState'] => incoming
    ? { ...applied, ...incoming, scene: incoming.scene ?? (incoming.generated === false ? undefined : applied?.scene) } : applied;
  function display(): void {
    workspace.hidden = space === 'workshop'; section.hidden = space !== 'workshop';
    // Existing workspace CSS uses display:flex, which otherwise overrides the hidden attribute.
    workspace.style.display = space === 'workshop' ? 'none' : '';
    for (const group of Array.from(document.querySelector('header')!.children)) if (group !== nav && !group.classList.contains('brand')) (group as HTMLElement).style.display = space === 'workshop' ? 'none' : '';
    mapButton.setAttribute('aria-pressed', String(space === 'map')); workshopButton.setAttribute('aria-pressed', String(space === 'workshop'));
    if (space === 'workshop' && !frame.hasAttribute('src')) {
      const params = new URLSearchParams({ engine: 'rust', embedded: '1', style: options.getStyle?.() ?? query.get('style') ?? 'parchment' }); if (caseState) params.set('case', caseState); else if (workshopSource === 'map') params.set('awaitImport', '1');
      frame.src = `testbench.html?${params}`;
    }
    const url = new URL(location.href); url.searchParams.set('space', 'workshop'); if (caseState) url.searchParams.set('workshop', caseState); else url.searchParams.delete('workshop');
    section.querySelector<HTMLAnchorElement>('[data-standalone]')!.href = url.href;
    window.dispatchEvent(new Event('bench-space-change'));
  }
  mapButton.onclick = () => { space = 'map'; display(); options.onChange(); };
  workshopButton.onclick = () => { openMap(); };
  function openMap(): void {
    ++generationEpoch; sceneClient.invalidate();
    const context = options.getContext(), all = options.urban.workshopState();
    const state = all.siteKey && all.layouts?.some(layout => layout.key === all.siteKey) ? cityWorkshopState(all, all.siteKey) : all;
    if (!context || !state.layouts?.length) { space = 'workshop'; display(); note.textContent = 'Générez d’abord les quartiers sur la carte.'; return; }
    invalidated = false; acceptApplied = true; expectedSource = 'map'; frame.style.visibility = ''; workshopSource = 'map'; retainContext(); latestDraft = undefined; latest = state;
    const site = context.sites.find(site => site.key === state.siteKey || site.key === state.layouts?.[0]?.key);
    pendingImport = { ...state, population: site?.population ?? state.population, siteKey: site?.key ?? state.siteKey, quarterSeed: state.quarterSeed || context.seed, parcelSeed: state.parcelSeed || context.seed };
    appliedContext = undefined;
    plans.map = { layouts: state.layouts, partitions: state.partitions, buildingState: state.buildingState };
    space = 'workshop'; display();
    if (ready) { send({ type: 'import', state: pendingImport, surface: urbanDisplaySurface(context.raster), waterAppearance: retainedContext?.waterAppearance, radius: context.sites[0]?.radius, water: contextWater(context), contours: contextContours(context), roads: regionalStreets(context.roads) }); pendingImport = undefined; }
    note.textContent = 'Plan conservé : les parcelles seront découpées dans ces mêmes îlots.';
    options.onChange();
  }
  section.querySelector<HTMLButtonElement>('[data-from-map]')!.onclick = openMap;
  applyButton.onclick = () => {
    if (!latest || workshopSource !== 'map') return;
    if (options.onReturn) { void options.onReturn(latest).catch(e => { note.textContent = String(e); }); return; }
    const { layouts: _layouts, partitions: _partitions, ...settings } = latest;
    options.urban.applyWorkshop(settings); space = 'map'; display(); options.onChange();
  };
  section.querySelector<HTMLButtonElement>('[data-fixture]')!.onclick = () => { ++generationEpoch; sceneClient.invalidate(); invalidated = false; expectedSource = 'fixture'; latest = undefined; latestDraft = undefined; caseState = ''; applyButton.disabled = true; frame.style.visibility = ''; workshopSource = 'fixture'; retainedContext = undefined; send({ type: 'fixture' }); note.textContent = 'Scène isolée avec les mêmes opérateurs de quartiers et parcelles.'; };
  let worker: Worker | undefined, fallback: ReturnType<typeof createUrbanEngine> | undefined, requestId = 0;
  let sentRaster: SettlementRaster | undefined;
  let fixtureCache: { key: string; value: ReturnType<typeof fixtureTerrain> } | undefined;
  let appliedContext: MapContext | undefined;
  const pending = new Map<number, { resolve(response: UrbanResponse): void; reject(error: Error): void; request: UrbanRequest }>();
  function runFallback(message: UrbanRequest): Promise<UrbanResponse> {
    return fallback!.then(async engine => {
      const response = await engine.run({ ...message, raster: message.raster === sentRaster ? undefined : message.raster });
      sentRaster = response.error ? undefined : message.raster;
      return response;
    });
  }
  function useFallback(): void {
    worker?.terminate(); worker = undefined; sentRaster = undefined; fallback ??= createUrbanEngine(executionRuntime);
    for (const [id, item] of pending) { pending.delete(id); void runFallback(item.request).then(item.resolve, item.reject); }
  }
  function native(request: Omit<UrbanRequest, 'id'>): Promise<UrbanResponse> {
    const message = { ...request, id: ++requestId, runtime: executionRuntime };
    if (!worker && !fallback) {
      try {
        worker = new UrbanWorker();
        worker.onmessage = event => { if (event.data.error) sentRaster = undefined; const item = pending.get(event.data.id); if (item) { pending.delete(event.data.id); item.resolve(event.data); } };
        worker.onerror = event => {
          event.preventDefault(); useFallback();
        };
      } catch { fallback = createUrbanEngine(executionRuntime); }
    }
    // Keep the original raster in pending requests for worker-failure recovery.
    // Normal parcel edits reuse the terrain already owned by this engine.
    if (fallback) return runFallback(message);
    return new Promise((resolve, reject) => {
      pending.set(message.id, { resolve, reject, request: message });
      try {
        worker!.postMessage({ ...message, raster: message.raster === sentRaster ? undefined : message.raster });
        sentRaster = message.raster;
      } catch { useFallback(); }
    });
  }
  async function generate(request: WorkshopRequest, progress?: (completed: number, total: number) => void): Promise<WorkshopResult> {
    const ticket = ++generationEpoch;
    request = { ...request, context: normalizeWorkshopContext(request.context) };
    let context = retainedContext ?? options.getContext();
    if (request.context.source === 'map') {
      for (let i = 0; !context && i < 100; i++) { await new Promise(resolve => setTimeout(resolve, 50)); context = options.getContext(); }
      if (!context) throw new Error('Ouvrez le décor de cette carte pour reproduire son atelier.');
    }
    let fixture: ReturnType<typeof fixtureTerrain> | undefined;
    if (request.context.source === 'fixture') {
      // These are the only inputs read by fixtureTerrain/applyBenchConstraints.
      // Parcel and building options must not rebuild the 256² terrain raster.
      const o = request.options, frame = workshopFixtureFrame(request.context.population!, o.radius, request.context.layoutConfig?.composition === 'settlement'), key = JSON.stringify([frame.width, o.radius, o.relief, o.reliefSlope, o.river, o.riverWidth]);
      if (fixtureCache?.key !== key) fixtureCache = { key, value: fixtureTerrain(o, frame) };
      fixture = fixtureCache.value;
    }
    const raster = fixture?.raster ?? context!.raster;
    const frame = workshopFixtureFrame(request.context.population!, request.options.radius, request.context.layoutConfig?.composition === 'settlement');
    const siteKey = request.context.siteKey ?? context?.sites[0]?.key;
    const sites = fixture ? [{ key: 'workshop', population: request.context.population!, culture: request.options.culture, center: frame.center, radius: request.options.radius }] : context!.sites.filter(site => !request.context.siteKey || site.key === request.context.siteKey).map(site => site.key === siteKey ? { ...site, population: request.context.population! } : site);
    let layouts = request.layouts;
    if (request.kind === 'quarters') {
      if (request.options.mode === 'micro' && fixture) layouts = microLayouts(request.options, request.seed);
      else {
        const response = await native({ kind: 'quarters', seed: request.seed, raster,
          sites,
          roads: fixture ? [] : regionalStreets(context!.roads),
          layoutConfig: workshopConfig(request.options, request.context, 'quarters') });
        if (response.error) throw new Error(response.error); layouts = response.layouts!;
      }
    }
    if (!layouts) throw new Error('Générez les quartiers avant les parcelles.');
    let partitions = request.kind === 'buildings' ? request.partitions : undefined;
    let buildingState: WorkshopState['buildingState'];
    if (request.kind === 'parcels') {
      const response = await native({ kind: 'parcels', seed: request.seed, raster, layouts,
        parcelConfig: workshopConfig(request.options, request.context, 'parcels') });
      if (response.error) throw new Error(response.error); partitions = response.partitions;
    }
    if (request.kind === 'buildings') {
      if (!partitions) throw new Error('Générez les parcelles avant les bâtiments.');
      const response = await sceneClient.run({ raster, layouts, partitions, seed: request.seed, settings: request.buildingSettings, runtime: executionRuntime }, (completed, total) => { if (ticket === generationEpoch) progress?.(completed, total); });
      if (!response.scene) throw new Error('La scène bâtie est absente.');
      partitions = response.partitions ?? partitions;
      buildingState = { seed: request.seed, settings: request.buildingSettings, scene: response.scene, visible: true, appearance: { style: 'cartographic', diagnostic: 'none' } };
    }
    if (ticket !== generationEpoch) throw new DOMException('Plan remplacé', 'AbortError');
    appliedContext = { ...context, raster, sites, seed: fixture ? request.seed : context!.seed };
    if (request.kind !== 'buildings') latestDraft = undefined;
    acceptApplied = true; plans[request.context.source] = { layouts, partitions, buildingState };
    return { layouts, partitions, surface: urbanDisplaySurface(raster), water: fixture?.water ?? contextWater(context), contours: fixture?.contours ?? contextContours(context), roads: fixture ? [] : regionalStreets(context?.roads),
      layoutConfig: request.kind === 'quarters' ? workshopConfig(request.options, request.context, 'quarters') : normalizeLayoutConfig(request.context.layoutConfig, true),
      parcelConfig: request.kind === 'parcels' ? workshopConfig(request.options, request.context, 'parcels') : normalizeParcelConfig(request.context.parcelConfig), buildingState,
      shapeNames: request.options.mode === 'micro' && fixture ? benchLayout({ ...request.options, mode: 'micro', culture: 'european-organic', recipe: 'core', stages: {} }, request.seed).shapeNames : undefined };
  }
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== (location.protocol === 'file:' ? 'null' : location.origin) || event.data?.channel !== WORKSHOP_CHANNEL) return;
    const message = event.data;
    if (message.type === 'open-house' && typeof message.id === 'string') { openBench('houses', new URLSearchParams({ placement: message.id })); return; }
    if (message.type === 'catalogue') { send({ type: 'catalogue', catalogue }); return; }
    if (message.type === 'ready') { ready = true; if (pendingImport) { send({ type: 'import', state: pendingImport, surface: retainedContext && urbanDisplaySurface(retainedContext.raster), waterAppearance: retainedContext?.waterAppearance, radius: retainedContext?.sites[0]?.radius, water: contextWater(retainedContext), contours: contextContours(retainedContext), roads: regionalStreets(retainedContext?.roads) }); pendingImport = undefined; } }
    if (message.type === 'settings') { latestDraft = message.state; options.onChange(); }
    if (message.type === 'state') {
      if (invalidated) return;
      if (expectedSource && message.source !== expectedSource) return;
      expectedSource = undefined;
      const previousSource = workshopSource; workshopSource = message.source === 'map' ? 'map' : 'fixture';
      if (workshopSource === 'map' && !retainedContext) retainContext();
      if (workshopSource === 'fixture') retainedContext = undefined;
      const draft = latestDraft;
      // The child serializes applied state. Draft controls travel separately,
      // so camera/style changes remain shareable while a draft is pending.
      caseState = message.caseState;
      if (acceptApplied || !latest || previousSource !== workshopSource) { const previousCitySettings = latest?.citySettings; latest = { ...message.state, ...plans[workshopSource], buildingState: mergeBuildingState(message.state?.buildingState, plans[workshopSource]?.buildingState), layoutConfig: normalizeLayoutConfig(message.state?.layoutConfig, true), parcelConfig: normalizeParcelConfig(message.state?.parcelConfig) }; const key = latest!.siteKey ?? (latest!.layouts?.length === 1 ? latest!.layouts[0].key : undefined); latest!.citySettings = { ...previousCitySettings, ...latest!.citySettings }; if (key) latest!.citySettings[key] = { layoutConfig: latest!.layoutConfig, parcelConfig: latest!.parcelConfig, quarterSeed: latest!.quarterSeed, parcelSeed: latest!.parcelSeed, building: latest!.buildingState && { seed: latest!.buildingState.seed, settings: latest!.buildingState.settings, generated: latest!.buildingState.generated ?? !!latest!.buildingState.scene } }; acceptApplied = false; }
      else {
        latest.style = message.state?.style ?? latest.style;
        latest.view = message.state?.view ?? latest.view;
        if (message.state?.buildingState) latest.buildingState = mergeBuildingState(message.state.buildingState, latest.buildingState);
      }
      applyButton.disabled = workshopSource !== 'map';
      if (draft) { latestDraft = draft; send({ type: 'sync-settings', state: draft }); }
      display(); options.onChange();
    }
    if (message.type === 'generate') void generate(message, (completed, total) => send({ type: 'progress', id: message.id, completed, total })).then(result => send({ type: 'result', id: message.id, result }), error => send({ type: 'result', id: message.id, error: String(error) }));
    if (message.type === 'copy') document.querySelector<HTMLButtonElement>('[data-recipe-export]')?.click();
  });
  display();
  return {
    openMap,
    currentState: (): WorkshopState | undefined => latest,
    currentSource: (): 'map' | 'fixture' => workshopSource,
    currentContext: (): MapContext | undefined => appliedContext ?? retainedContext,
    draftSettings: () => latestDraft && latest ? workshopSettings({ ...latest, ...latestDraft }) : latestDraft as Omit<WorkshopState, 'layouts' | 'partitions'> | undefined,
    applySettings(state: Partial<WorkshopState>): void {
      latestDraft = state;
      if (ready) send({ type: 'sync-settings', state });
    },
    async exportCurrent(download: boolean): Promise<void> {
      const state = space === 'workshop' ? latest : options.urban.workshopState();
      if (!state) throw new Error('Attendez le chargement du plan dans l’atelier.');
      await options.onExport?.(state, download);
    },
    share(params: URLSearchParams): void { verifyContext(); if (space === 'workshop') params.set('space', space); if (caseState) params.set('workshop', caseState); },
  };
}

function contextWater(context?: MapContext): Shape[] {
  return context?.raster.geometry?.water.map(rings => ({ outer: rings[0], holes: rings.slice(1) })) ?? [];
}

function fixtureTerrain(options: BenchOptions, frame: ReturnType<typeof workshopFixtureFrame>): { raster: SettlementRaster; water: Shape[]; contours: { x: number; y: number }[][] } {
  const n = 256, { width, center } = frame, height = createGrid(n, n, width / n), mask = new Uint8Array(n * n);
  height.data.fill(20);
  const world = { terrain: { height, slope: createGrid(n, n, width / n), water: mask, rivers: [] } } as unknown as World;
  const r = options.radius, bounds = [{ x: center.x - r, y: center.y - r }, { x: center.x + r, y: center.y + r }];
  const { contours } = applyBenchConstraints(world, bounds, options);
  const riverWidth = new Float32Array(n * n), riverIds = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < mask.length; i++) if (mask[i]) { mask[i] = 3; riverWidth[i] = options.riverWidth ?? 14; riverIds[i] = 0; }
  const water = world.terrain.rivers.map(river => {
    const [a, b] = river.path, length = Math.hypot(b.x - a.x, b.y - a.y), w = river.width[0] / 2;
    const x = (b.y - a.y) / length * w, y = -(b.x - a.x) / length * w;
    return { outer: [{ x: a.x + x, y: a.y + y }, { x: b.x + x, y: b.y + y }, { x: b.x - x, y: b.y - y }, { x: a.x - x, y: a.y - y }], holes: [] };
  });
  const land = [[{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: width }, { x: 0, y: width }]];
  return { raster: { n, width, height: height.data, water: mask, waterLevel: height.data.slice(), riverWidth, riverIds, geometry: { land, water: water.map(s => [s.outer, ...s.holes]) } }, water, contours };
}
function microLayouts(options: BenchOptions, seed: string): Layout[] {
  const fixture = benchLayout({ ...options, mode: 'micro', culture: 'european-organic', recipe: 'core', stages: {} }, seed);
  return [{ key: 'micro', culture: options.culture, center: { x: 500, y: 500 }, warnings: [], enclosures: [],
    quarters: fixture.quarters.map(q => ({ shape: { outer: q.lp.pts, holes: [] }, phase: q.phase, zone: q.zone })),
    blocks: fixture.blocks.map(b => ({ shape: { outer: b.poly, holes: [] }, quarter: b.quarter, kind: b.kind, axis: b.plotFrame.u, zone: b.zone })),
    streets: fixture.streets.list.map(s => ({ path: s.path, widths: s.widths, rank: s.rank, role: s.role })) }];
}

/** Sample the retained relief for workshop contour overlays; generation keeps FP32 cells. */
function contextContours(context?: MapContext): { x: number; y: number }[][] {
  if (!context) return [];
  const { n, width, height } = context.raster, step = Math.max(1, Math.floor(n / 160)), cell = width / n;
  let low = Infinity, high = -Infinity;
  for (const z of height) { low = Math.min(low, z); high = Math.max(high, z); }
  const interval = Math.max(5, Math.ceil((high - low) / 16 / 5) * 5), lines: { x: number; y: number }[][] = [];
  for (let level = Math.ceil(low / interval) * interval; level < high; level += interval) for (let y = 0; y + step < n; y += step) for (let x = 0; x + step < n; x += step) {
    const corners = [[x, y], [x + step, y], [x + step, y + step], [x, y + step]];
    const hits: { x: number; y: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4], a = height[ay * n + ax], b = height[by * n + bx];
      if ((a < level) === (b < level)) continue;
      const t = (level - a) / (b - a); hits.push({ x: (ax + .5 + (bx - ax) * t) * cell, y: (ay + .5 + (by - ay) * t) * cell });
    }
    for (let i = 1; i < hits.length; i += 2) lines.push([hits[i - 1], hits[i]]);
  }
  return lines;
}
import { executionRuntime } from './executionProfile';
