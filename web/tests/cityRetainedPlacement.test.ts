import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import fixture from './fixtures/city-retained-placement.json';
import { retainCityPlacement } from '../src/ui/cityRetainedPlacement';
import { demographicClass } from '../../rust/bridge/settlementDemography';
import { defaultSettlementConfig, defaultRoadConfig, type Settlement, type SettlementSpec, type SettlementOutput, type SettlementConfig, type SettlementRequest, type SettlementResponse } from '../../rust/bridge/settlements';
const source = readFileSync(new URL('../src/ui/terrainSettlements.ts', import.meta.url), 'utf8');
const retained = (): SettlementOutput => ({ settlements: [JSON.parse(JSON.stringify(fixture.settlement))], warnings: [], requested: 1, usableKm2: 0, ms: 0 });
function configuration(output = retained()): SettlementConfig {
  const config = defaultSettlementConfig(); config.mode = 'list'; config.list = output.settlements.map(s => ({ ...structuredClone(s), position: { ...s.center } })); return config;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
interface State { output?: SettlementOutput; id: number; answered: number; needsPlacement: boolean; citySearchRequested: boolean; cityPlacementScoresStale: boolean; config: SettlementConfig }
/** Actual production function/method bodies. DOM/worker transport are bounded
 * doubles; no solver, native placement or browser evidence is claimed. */
function harness(city = true, initialOutput: SettlementOutput | null = retained(), initialConfig = configuration(initialOutput ?? retained())) {
  const tree = ts.createSourceFile('terrainSettlements.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['adopt', 'changed', 'schedule', 'recalculate', 'useFallback', 'receive', 'requestPlacementSearch'], functions = new Map<string, ts.FunctionDeclaration>(), methods = new Map<string, ts.MethodDeclaration>();
  function visit(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text)) { if (functions.has(n.name.text)) throw new Error('Ambiguous real function'); functions.set(n.name.text, n); }
    if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && ['restoreDecor', 'terrainReady'].includes(n.name.text)) methods.set(n.name.text, n);
    ts.forEachChild(n, visit);
  } visit(tree);
  if (functions.size !== names.length || methods.size !== 2) throw new Error('Missing production placement control flow');
  const requests: SettlementRequest[] = [], nodes = new Map<string, { textContent: string; hidden: boolean; setAttribute: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn> }>();
  const el = (name: string) => { let node = nodes.get(name); if (!node) { node = { textContent: '', hidden: false, setAttribute: vi.fn(), removeAttribute: vi.fn() }; nodes.set(name, node); } return node; };
  const terrain = { width: 8000 }, raster = { width: 8000, n: 2, height: new Float32Array(4), water: new Uint8Array(4), waterLevel: new Float32Array(4), riverWidth: new Float32Array(4), riverIds: new Int32Array(4) };
  const urban = { setSettlements: vi.fn(), restoreSnapshot: vi.fn(), applyWorkshopDraft: vi.fn(), workshopDraft: () => undefined, workshopSettings: () => ({}) };
  const roads = { enabled: true, config: defaultRoadConfig(), output: undefined as unknown, pending: vi.fn(), error: vi.fn(), setConfig: vi.fn(), set(value?: unknown) { this.output = value; } };
  const clone = <T>(value: T) => structuredClone(value);
  const worker = { postMessage(request: SettlementRequest) { requests.push(clone(request)); }, terminate: vi.fn() };
  const options = { city, active: true, getTerrain: () => terrain, getSettings: () => ({ seed: 'same-seed', relief: 'mountains' }), getRaster: () => raster, onChange: vi.fn(), onPlanChange: vi.fn() };
  const env = { options, config: clone(initialConfig), output: clone(initialOutput ?? undefined), worker, roads, urban, el, clone, retainCityPlacement,
    sites: (out: SettlementOutput) => out.settlements.map(s => ({ key: s.key, center: s.center, population: s.population, culture: s.culture, radius: s.radius })), prefs: (s: SettlementSpec) => s,
    runSettlementRequest: vi.fn(async (request: SettlementRequest): Promise<SettlementResponse> => { requests.push(clone(request)); return { id: request.id, roads: null }; }),
    window: { dispatchEvent: vi.fn() }, CustomEvent: class { constructor(readonly type: string, readonly init: unknown) {} } };
  const body = `function create(env) {
    const { options, roads, urban, el, clone, retainCityPlacement, sites, prefs, runSettlementRequest, window, CustomEvent } = env;
    const executionRuntime = { profile: 'local', server: 'http://placement-ui-transport-mock.test' };
    const controls = () => {}, list = () => {}, editor = () => {}, draw = () => {}, syncLanduse = () => {}, publishOptions = () => {};
    let config=env.config, output=env.output, worker=env.worker, selection=config.list[0]?.key ?? '', enabled=true, showPoints=true;
    let cachedTerrain, validation, timer, fallback=false, id=0, answered=0, complete=true, needsPlacement=true, restoringDecor=false;
    let citySearchRequested=false, cityPlacementScoresStale=false;
    ${names.map(n => functions.get(n)!.getText(tree)).join('\n')}
    const lifecycle = { ${[...methods.values()].map(n => n.getText(tree)).join(',')} };
    return { changed, recalculate, useFallback, receive, search:requestPlacementSearch, lifecycle,
      state:()=>({config,output,id,answered,needsPlacement,citySearchRequested,cityPlacementScoresStale}) };
  }`;
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (js.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('Real source-body parse failed');
  const api: { changed(): void; recalculate(): void; useFallback(): void; receive(r: SettlementResponse): void; search(): void; state(): State;
    lifecycle: { restoreDecor(decor: unknown): void; terrainReady(): void } } = new Function('env', js.outputText + '\nreturn create(env);')(env);
  return { ...api, requests, urban, roads, options, worker, nodes };
}
it('retained metadata edits preserve exact position radius geographic evidence and population without invoking a solver', () => {
  const before = retained(), config = configuration(before), base = structuredClone(before);
  config.list[0].population = 100000; config.list[0].culture = 'future-profile';
  const kept = retainCityPlacement(before, config.list); expect(kept.changed).toBe(true);
  const current = kept.output!.settlements[0], old = before.settlements[0];
  expect(current.center).toEqual(old.center); expect(current.radius).toBe(old.radius); expect(current.scores).toEqual(old.scores);
  expect(current.population).toBe(100000); expect(current.culture).toBe('future-profile'); expect(current.cls).toBe(demographicClass(100000)); expect(before).toEqual(base);
});
it('manual fractional pin and metadata import survive JSON roundtrip exactly, old scores are retained not recomputed', () => {
  const before = retained(), config = configuration(before), pin = { x: 2639.9315590685324, y: 2668.9433913724934 };
  config.list[0].position = pin; config.list[0].population = 5000;
  const restored = JSON.parse(JSON.stringify(config)), kept = retainCityPlacement(before, restored.list);
  expect(kept.output!.settlements[0].center).toEqual(pin); expect(kept.output!.settlements[0].position).toEqual(pin);
  expect(kept.output!.settlements[0].scores).toEqual(before.settlements[0].scores); expect(config.list[0].position).toEqual(pin);
});
it('no retained site means no manufactured city/radius/scores at zero or map centre', () => {
  const config = configuration(); config.list[0].position = { x: 200, y: 300 };
  expect(retainCityPlacement(undefined, config.list).output).toBeUndefined();
  expect(retainCityPlacement(retained(), [{ ...config.list[0], key: 'unknown-import' }]).missing).toEqual(['unknown-import']);
});
it('ACTUAL unchanged decor open retains roads/site and sends zero placement or routing requests', async () => {
  vi.useFakeTimers(); const out = retained(), ui = harness(); const roads = { exact: 'retained routes sentinel' };
  ui.lifecycle.restoreDecor({ meta: { settlements: out.settlements, roads, roadConfig: defaultRoadConfig(), pipeline: {} } });
  await vi.advanceTimersByTimeAsync(300);
  expect(ui.requests).toHaveLength(0); expect(ui.roads.output).toBe(roads); expect(ui.state().output!.settlements).toEqual(out.settlements);
  expect(ui.state().answered).toBe(ui.state().id); expect(ui.state().citySearchRequested).toBe(false); expect(ui.urban.setSettlements).toHaveBeenCalledWith(ui.state().output, roads);
});
it.each(['population', 'culture', 'pin'] as const)('ACTUAL changed %s rebuild reroutes only retained sites, never implicit placement', async field => {
  vi.useFakeTimers(); const ui = harness(), old = ui.state().output!.settlements[0], spec = ui.state().config.list[0];
  if (field === 'population') spec.population = 100000; else if (field === 'culture') spec.culture = 'javanese-courts'; else spec.position = { x: 2639.9315590685324, y: 2668.9433913724934 };
  ui.changed(); await vi.advanceTimersByTimeAsync(200);
  expect(ui.requests).toHaveLength(1); const request = ui.requests[0]; expect(request).not.toHaveProperty('place');
  expect(request.sites?.[0].center).toEqual(spec.position ?? old.center); expect(request.sites?.[0].population).toBe(spec.population); expect(request.sites?.[0].culture).toBe(spec.culture);
  ui.receive({ id: request.id, roads: null }); expect(ui.state().answered).toBe(ui.state().id); expect(ui.state().cityPlacementScoresStale).toBe(true);
  expect(ui.urban.setSettlements).toHaveBeenLastCalledWith(ui.state().output, undefined);
});
it('ACTUAL changed URL/decor metadata avoids a first plan at stale metadata and never triggers search', async () => {
  vi.useFakeTimers(); const out = retained(), ui = harness(); ui.state().config.list[0].population = 100000;
  ui.lifecycle.restoreDecor({ meta: { settlements: out.settlements, roads: { retained: true }, pipeline: {} } });
  expect(ui.urban.setSettlements).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(200);
  expect(ui.requests).toHaveLength(1); expect(ui.requests[0]).not.toHaveProperty('place'); expect(ui.requests[0].sites?.[0].population).toBe(100000);
});
it('ACTUAL virgin terrain waits for explicit placement and context id/answered settles without a request', () => {
  const config = configuration(); delete config.list[0].position;
  const ui = harness(true, null, config); ui.lifecycle.terrainReady();
  expect(ui.requests).toHaveLength(0); expect(ui.state().output).toBeUndefined(); expect(ui.state().answered).toBe(ui.state().id);
  expect(ui.nodes.get('setStatus')?.textContent).toContain('Aucune position conservée');
});
it('ACTUAL fallback cannot rearm placement after a worker failure on retained-site routing', async () => {
  const ui = harness(); ui.useFallback(); await Promise.resolve(); await Promise.resolve();
  expect(ui.worker.terminate).toHaveBeenCalledOnce(); expect(ui.requests).toHaveLength(1); expect(ui.requests[0]).not.toHaveProperty('place');
  expect(ui.state().answered).toBe(ui.state().id);
});
it('ACTUAL explicit search button path is the only CityBench automatic-search arm and releases its selected pin', () => {
  const ui = harness(), before = structuredClone(ui.state().config.list[0]); ui.search();
  expect(ui.requests).toHaveLength(1); expect(ui.requests[0].place).toBeDefined(); expect(ui.requests[0].place!.list[0].position).toBeUndefined();
  expect(ui.requests[0].place!.list[0].population).toBe(before.population); expect(ui.requests[0].place!.list[0].culture).toBe(before.culture);
  expect(source).toContain("el('setGenerate').hidden = false"); expect(source).toContain("el('setGenerate').onclick = requestPlacementSearch");
  expect(source).toContain("el('setAutoPosition').onclick = () => { if (options.city) requestPlacementSearch()");
});
it('ACTUAL non-CityBench legacy terrain still permits automatic placement', () => {
  const ui = harness(false, null); ui.lifecycle.terrainReady(); expect(ui.requests).toHaveLength(1); expect(ui.requests[0].place).toBeDefined();
});

it('ACTUAL new import key with explicit fractional position keeps coordinates visible until user validates the pinned site', () => {
  const config = configuration(); config.list[0].key = 'new-key-import';
  const pin = { x: 2639.9315590685324, y: 2668.9433913724934 }; config.list[0].position = { ...pin };
  const ui = harness(true, retained(), config); ui.recalculate();
  expect(ui.requests).toHaveLength(0); expect(ui.state().config.list[0].position).toEqual(pin);
  expect(ui.nodes.get('setStatus')?.textContent).toContain('Coordonnées fournies conservées');
  expect(ui.nodes.get('setStatus')?.textContent).toContain(String(pin.x)); expect(ui.nodes.get('setGenerate')?.textContent).toBe('Valider les positions fournies');
  ui.search(); expect(ui.requests).toHaveLength(1); expect(ui.requests[0].place?.list[0].position).toEqual(pin);
  expect(ui.requests[0].place?.list[0].key).toBe('new-key-import'); expect(ui.state().config.list[0].position).toEqual(pin);
});

it('ACTUAL changed invalidates the previous response immediately before debounce, then routing-only response settles readiness', async () => {
  vi.useFakeTimers(); const ui = harness(), previousId = ui.state().id, before = ui.state().output;
  ui.state().config.list[0].population = 100000; ui.changed();
  expect(ui.state().id).toBeGreaterThan(previousId); expect(ui.state().answered).not.toBe(ui.state().id);
  expect(ui.requests).toHaveLength(0);
  const stale = retained(); stale.settlements[0].center = { x: 1, y: 2 }; stale.settlements[0].population = 15;
  ui.receive({ id: previousId, settlements: stale, roads: null });
  expect(ui.state().output).toBe(before); expect(ui.urban.setSettlements).not.toHaveBeenCalled();
  expect(ui.state().answered).not.toBe(ui.state().id);
  await vi.advanceTimersByTimeAsync(200); expect(ui.requests).toHaveLength(1);
  const request = ui.requests[0]; expect(request).not.toHaveProperty('place'); expect(request.sites?.[0].population).toBe(100000);
  expect(request.sites?.[0].center).toEqual(before!.settlements[0].center);
  ui.receive({ id: request.id, roads: null }); expect(ui.state().answered).toBe(ui.state().id);
});
