import catalogue from '../../../rust/crates/core/src/urban/catalogue.json';
import UrbanWorker from './urbanWorker?worker&inline';
import { createUrbanEngine, defaultLayoutConfig, defaultParcelConfig, regionalStreets, type Layout, type Shape, type UrbanRequest, type UrbanResponse } from '../../../rust/bridge/urban';
import type { RoadOutput, RoadSite, SettlementRaster } from '../../../rust/bridge/settlements';
import { benchLayout, type BenchOptions } from '../gen/urban/testbench';
import { createGrid } from '../gen/core/grid';
import { applyBenchConstraints } from '../gen/urban/testbenchConstraints';
import type { World } from '../gen/types';
import { WORKSHOP_CHANNEL, workshopConfig, type WorkshopRequest, type WorkshopResult, type WorkshopState } from './testbenchUrban';

interface MapContext { raster: SettlementRaster; sites: RoadSite[]; roads?: RoadOutput; seed: string }
/** Two workspaces, one existing editor and the same native worker as the map. */
export function createUrbanWorkshop(options: {
  urban: { workshopState(): WorkshopState; applyWorkshop(state: Partial<WorkshopState>): void };
  getContext(): MapContext | undefined; onChange(): void;
}) {
  const query = new URLSearchParams(location.search), workspace = document.querySelector<HTMLElement>('.terrain-workspace')!;
  const nav = document.createElement('div'); nav.className = 'control-group';
  nav.innerHTML = '<button type="button" data-map-space>Carte</button><button type="button" data-workshop-space>Atelier quartiers / parcelles</button>';
  for (const button of Array.from(nav.querySelectorAll('button'))) { button.style.width = 'auto'; button.style.padding = '4px 10px'; button.style.whiteSpace = 'nowrap'; }
  document.querySelector('header')!.append(nav);
  const section = document.createElement('section'); section.hidden = true; section.id = 'urbanWorkshop';
  section.innerHTML = '<div class="control-group" style="padding:8px;flex-wrap:wrap"><button type="button" data-from-map>Charger le plan de la carte</button><button type="button" data-fixture>Nouvelle scène isolée</button><button type="button" data-to-map disabled>Appliquer les réglages à la carte</button><a data-standalone target="_blank" rel="noopener">Ouvrir cet atelier seul</a><span data-workshop-status role="status"></span></div><iframe title="Éditeur de quartiers et parcelles" style="display:block;width:100%;height:calc(100vh - 110px);border:0"></iframe>';
  workspace.after(section);
  const frame = section.querySelector('iframe')!, mapButton = nav.querySelector<HTMLButtonElement>('[data-map-space]')!, workshopButton = nav.querySelector<HTMLButtonElement>('[data-workshop-space]')!;
  const applyButton = section.querySelector<HTMLButtonElement>('[data-to-map]')!, note = section.querySelector<HTMLElement>('[data-workshop-status]')!;
  let space = query.get('space') === 'workshop' ? 'workshop' : 'map', caseState = query.get('workshop') ?? '';
  let latest: WorkshopState | undefined, pendingImport: WorkshopState | undefined, ready = false;
  let workshopSource: 'fixture' | 'map' = 'fixture', retainedContext: MapContext | undefined, retainedSites = '';
  let invalidated = false;
  function retainContext(): void { retainedContext = options.getContext(); retainedSites = JSON.stringify(retainedContext?.sites); }
  function verifyContext(): void {
    if (workshopSource !== 'map' || !retainedContext || invalidated) return;
    const current = options.getContext();
    if (current?.raster === retainedContext.raster && current.roads === retainedContext.roads && current.seed === retainedContext.seed && JSON.stringify(current.sites) === retainedSites) return;
    invalidated = true; caseState = ''; latest = undefined; pendingImport = undefined; applyButton.disabled = true;
    frame.style.visibility = 'hidden'; note.textContent = 'Carte modifiée, rechargez le plan dans l’atelier.'; display();
  }
  const targetOrigin = location.protocol === 'file:' || location.origin === 'null' ? '*' : location.origin;
  const send = (data: object): void => frame.contentWindow?.postMessage({ channel: WORKSHOP_CHANNEL, ...data }, targetOrigin);
  function display(): void {
    workspace.hidden = space === 'workshop'; section.hidden = space !== 'workshop';
    // Existing workspace CSS uses display:flex, which otherwise overrides the hidden attribute.
    workspace.style.display = space === 'workshop' ? 'none' : '';
    for (const group of Array.from(document.querySelector('header')!.children)) if (group !== nav && !group.classList.contains('brand')) (group as HTMLElement).style.display = space === 'workshop' ? 'none' : '';
    mapButton.setAttribute('aria-pressed', String(space === 'map')); workshopButton.setAttribute('aria-pressed', String(space === 'workshop'));
    if (space === 'workshop' && !frame.hasAttribute('src')) {
      const params = new URLSearchParams({ engine: 'rust', embedded: '1' }); if (caseState) params.set('case', caseState);
      frame.src = `testbench.html?${params}`;
    }
    const url = new URL(location.href); url.searchParams.set('space', 'workshop'); if (caseState) url.searchParams.set('workshop', caseState); else url.searchParams.delete('workshop');
    section.querySelector<HTMLAnchorElement>('[data-standalone]')!.href = url.href;
  }
  mapButton.onclick = () => { space = 'map'; display(); options.onChange(); };
  workshopButton.onclick = () => { space = 'workshop'; display(); options.onChange(); };
  section.querySelector<HTMLButtonElement>('[data-from-map]')!.onclick = () => {
    const context = options.getContext(), state = options.urban.workshopState();
    if (!context || !state.layouts?.length) { note.textContent = 'Générez d’abord les quartiers sur la carte.'; return; }
    invalidated = false; frame.style.visibility = ''; workshopSource = 'map'; retainContext();
    pendingImport = { ...state, quarterSeed: state.quarterSeed || context.seed, parcelSeed: state.parcelSeed || context.seed };
    if (ready) { send({ type: 'import', state: pendingImport, radius: context.sites[0]?.radius }); pendingImport = undefined; }
    note.textContent = 'Plan conservé : les parcelles seront découpées dans ces mêmes îlots.';
  };
  applyButton.onclick = () => {
    if (!latest) return;
    const { layouts: _layouts, partitions: _partitions, ...settings } = latest;
    options.urban.applyWorkshop(settings); space = 'map'; display(); options.onChange();
  };
  section.querySelector<HTMLButtonElement>('[data-fixture]')!.onclick = () => { invalidated = false; frame.style.visibility = ''; workshopSource = 'fixture'; retainedContext = undefined; send({ type: 'fixture' }); note.textContent = 'Scène isolée avec les mêmes opérateurs de quartiers et parcelles.'; };
  let worker: Worker | undefined, fallback: ReturnType<typeof createUrbanEngine> | undefined, requestId = 0;
  const pending = new Map<number, { resolve(response: UrbanResponse): void; reject(error: Error): void; request: UrbanRequest }>();
  function native(request: Omit<UrbanRequest, 'id'>): Promise<UrbanResponse> {
    const message = { ...request, id: ++requestId };
    if (!worker && !fallback) {
      try {
        worker = new UrbanWorker();
        worker.onmessage = event => { const item = pending.get(event.data.id); if (item) { pending.delete(event.data.id); item.resolve(event.data); } };
        worker.onerror = event => {
          event.preventDefault(); worker?.terminate(); worker = undefined; fallback = createUrbanEngine();
          for (const [id, item] of pending) { pending.delete(id); void fallback.then(engine => item.resolve(engine.run(item.request)), item.reject); }
        };
      } catch { fallback = createUrbanEngine(); }
    }
    if (fallback) return fallback.then(engine => engine.run(message));
    return new Promise((resolve, reject) => { pending.set(message.id, { resolve, reject, request: message }); worker!.postMessage(message); });
  }
  async function generate(request: WorkshopRequest): Promise<WorkshopResult> {
    let context = options.getContext();
    if (request.context.source === 'map') {
      for (let i = 0; !context && i < 100; i++) { await new Promise(resolve => setTimeout(resolve, 50)); context = options.getContext(); }
      if (!context) throw new Error('Ouvrez le décor de cette carte pour reproduire son atelier.');
    }
    const fixture = request.context.source === 'fixture' ? fixtureTerrain(request.options) : undefined;
    const raster = fixture?.raster ?? context!.raster;
    let layouts = request.layouts;
    if (request.kind === 'quarters') {
      if (request.options.mode === 'micro' && fixture) layouts = microLayouts(request.options, request.seed);
      else {
        const response = await native({ kind: 'quarters', seed: request.seed, raster,
          sites: fixture ? [{ key: 'workshop', population: 1000, culture: request.options.culture, center: { x: 500, y: 500 }, radius: request.options.radius }] : context!.sites,
          roads: fixture ? [] : regionalStreets(context!.roads),
          layoutConfig: { ...defaultLayoutConfig(), ...workshopConfig(request.options, request.context, 'quarters') } });
        if (response.error) throw new Error(response.error); layouts = response.layouts!;
      }
    }
    if (!layouts) throw new Error('Générez les quartiers avant les parcelles.');
    let partitions;
    if (request.kind === 'parcels') {
      const response = await native({ kind: 'parcels', seed: request.seed, raster, layouts,
        parcelConfig: { ...defaultParcelConfig(), ...workshopConfig(request.options, request.context, 'parcels') } });
      if (response.error) throw new Error(response.error); partitions = response.partitions;
    }
    return { layouts, partitions, water: fixture?.water ?? [], contours: fixture?.contours ?? [],
      layoutConfig: { ...defaultLayoutConfig(), ...request.context.layoutConfig, ...(request.kind === 'quarters' ? workshopConfig(request.options, request.context, 'quarters') : {}) },
      parcelConfig: { ...defaultParcelConfig(), ...request.context.parcelConfig, ...(request.kind === 'parcels' ? workshopConfig(request.options, request.context, 'parcels') : {}) },
      shapeNames: request.options.mode === 'micro' && fixture ? benchLayout({ ...request.options, mode: 'micro', culture: 'european-organic', recipe: 'core', stages: {} }, request.seed).shapeNames : undefined };
  }
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== (location.protocol === 'file:' ? 'null' : location.origin) || event.data?.channel !== WORKSHOP_CHANNEL) return;
    const message = event.data;
    if (message.type === 'catalogue') { send({ type: 'catalogue', catalogue }); return; }
    if (message.type === 'ready') { ready = true; if (pendingImport) { send({ type: 'import', state: pendingImport }); pendingImport = undefined; } }
    if (message.type === 'state') {
      if (invalidated) return;
      workshopSource = message.source === 'map' ? 'map' : 'fixture';
      if (workshopSource === 'map' && !retainedContext) retainContext();
      if (workshopSource === 'fixture') retainedContext = undefined;
      caseState = message.caseState; latest = message.state; applyButton.disabled = false;
      display(); options.onChange();
    }
    if (message.type === 'generate') void generate(message).then(result => send({ type: 'result', id: message.id, result }), error => send({ type: 'result', id: message.id, error: String(error) }));
    if (message.type === 'copy') void navigator.clipboard.writeText(location.href).then(() => { note.textContent = 'Lien copié : atelier, carte, paramètres appliqués et vue.'; }, () => window.prompt('Copier le lien de cet atelier', location.href));
  });
  display();
  return { share(params: URLSearchParams): void { verifyContext(); if (space === 'workshop') params.set('space', space); if (caseState) params.set('workshop', caseState); } };
}

function fixtureTerrain(options: BenchOptions): { raster: SettlementRaster; water: Shape[]; contours: { x: number; y: number }[][] } {
  const n = 256, width = 2000, height = createGrid(n, n, width / n), mask = new Uint8Array(n * n);
  height.data.fill(20);
  const world = { terrain: { height, slope: createGrid(n, n, width / n), water: mask, rivers: [] } } as unknown as World;
  const r = options.radius, bounds = [{ x: 500 - r, y: 500 - r }, { x: 500 + r, y: 500 + r }];
  const { contours } = applyBenchConstraints(world, bounds, options);
  const riverWidth = new Float32Array(n * n), riverIds = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < mask.length; i++) if (mask[i]) { mask[i] = 3; riverWidth[i] = options.riverWidth ?? 14; riverIds[i] = 0; }
  const water = world.terrain.rivers.map(river => {
    const [a, b] = river.path, length = Math.hypot(b.x - a.x, b.y - a.y), w = river.width[0] / 2;
    const x = (b.y - a.y) / length * w, y = -(b.x - a.x) / length * w;
    return { outer: [{ x: a.x + x, y: a.y + y }, { x: b.x + x, y: b.y + y }, { x: b.x - x, y: b.y - y }, { x: a.x - x, y: a.y - y }], holes: [] };
  });
  return { raster: { n, width, height: height.data, water: mask, waterLevel: height.data.slice(), riverWidth, riverIds }, water, contours };
}
function microLayouts(options: BenchOptions, seed: string): Layout[] {
  const fixture = benchLayout({ ...options, mode: 'micro', culture: 'european-organic', recipe: 'core', stages: {} }, seed);
  return [{ key: 'micro', culture: options.culture, center: { x: 500, y: 500 }, warnings: [], enclosures: [],
    quarters: fixture.quarters.map(q => ({ shape: { outer: q.lp.pts, holes: [] }, phase: q.phase, zone: q.zone })),
    blocks: fixture.blocks.map(b => ({ shape: { outer: b.poly, holes: [] }, quarter: b.quarter, kind: b.kind, axis: b.plotFrame.u, zone: b.zone })),
    streets: fixture.streets.list.map(s => ({ path: s.path, widths: s.widths, rank: s.rank, role: s.role })) }];
}
