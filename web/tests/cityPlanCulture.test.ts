import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { bindCityPlanCulture, bindCityPlaceCulture, withCityPlanCulture } from '../src/ui/cityPlanCulture';
import { defaultLayoutConfig, defaultParcelConfig, normalizeLayoutConfig, normalizeParcelConfig } from '../../rust/bridge/urbanConfig';
import { defaultSettlementSpec } from '../../rust/bridge/settlements';
import { encodeRecipe, decodeRecipe } from '../src/ui/recipe';
import { workshopSettings } from '../src/ui/urbanSnapshot';
import type { WorkshopState } from '../src/ui/testbenchUrban';
import { emptyEdits, layoutWithEdits, parcelWithEdits } from '../src/ui/cityEdits';
import type { UrbanBuildingState } from '../src/ui/urbanBuildingsPanel';
import type { PlacementBatchSettings } from '../../rust/bridge/urbanArchitecture';
import type { LayoutConfig, ParcelConfig } from '../../rust/bridge/urbanConfig';
import type { Layout, UrbanRequest } from '../../rust/bridge/urban';
vi.mock('../../rust/pkg/wasm/magna_urbis_wasm.js', () => ({ default: vi.fn(), SettlementTerrain: class {} }));
import { createUrbanEngine } from '../../rust/bridge/urban';

// DOM-only structural doubles preserve the real HTMLSelect missing-option
// semantics. Native transport below is mocked; no browser/native admission claim.
class OptionControl {
  value = ''; textContent: string | null = ''; title = ''; dataset: Record<string, string> = {}; parent?: SelectControl;
  remove() { if (this.parent) this.parent.options.splice(this.parent.options.indexOf(this), 1); }
}
class SelectControl {
  options: OptionControl[] = []; private selected = ''; onchange: (() => void) | null = null;
  ownerDocument = { createElement: (_: string) => new OptionControl() };
  constructor(values: string[]) { for (const value of values) { const o = new OptionControl(); o.value = value; this.add(o); } }
  add(o: OptionControl) { o.parent = this; this.options.push(o); }
  get value() { return this.selected; }
  set value(v: string) { this.selected = this.options.some(o => o.value === v) ? v : ''; }
  asSelect() { return this as unknown as HTMLSelectElement; }
}
function controls(choose: (value: string) => void) {
  const select = new SelectControl(['site', 'roman-core', 'javanese-courts']), reset = { disabled: false, onclick: null as (() => void) | null }, note = { textContent: '' };
  const host = { open: false, querySelector(selector: string) { return selector === '[data-plan-culture-site]' ? reset : note; } };
  const binding = bindCityPlanCulture(host as unknown as ParentNode & { open: boolean }, select.asSelect(), choose);
  return { select, reset, note, host, binding };
}
const exactPlace = () => ({ ...defaultSettlementSpec('city'), key: 'city', culture: 'javanese-courts', population: 100000,
  position: { x: 2639.9315590685324, y: 2668.9433913724934 } });
const settings = (): { layout: LayoutConfig; parcels: ParcelConfig; building: UrbanBuildingState & { settings: PlacementBatchSettings } } => {
  const layout = { ...defaultLayoutConfig(), culture: 'roman-core', recipe: 'specific-kept', preset: 'morph/grid', params: { gridSpacing: [80, 90] } };
  const parcels = { ...defaultParcelConfig(), culture: 'chinese', recipe: 'parcel-kept', params: { frontage: [8, 12] } };
  const building = { seed: 'B-exact', visible: true, appearance: { style: 'silhouette' as const, diagnostic: 'none' as const }, settings: { culture: 'halfling', floors: 2 }, generated: true };
  return { layout, parcels, building };
};
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('real plan select shows an imported override immediately without firing a change or pretending a resolved plan exists', () => {
  const choose = vi.fn(), ui = controls(choose);
  ui.binding.sync({ requested: 'future/<&>', place: 'javanese-courts' });
  expect(ui.host.open).toBe(true); expect(ui.select.value).toBe('future/<&>'); expect(ui.reset.disabled).toBe(false);
  expect(ui.note.textContent).toContain('Surcharge du plan demandée · future/<&>'); expect(ui.note.textContent).toContain('aucune résolution déduite');
  expect(choose).not.toHaveBeenCalled();
  ui.binding.sync({ requested: 'roman-core', place: 'javanese-courts', retained: { key: 'city', culture: 'javanese-courts' } });
  expect(ui.note.textContent).toContain('conservé (city) · javanese-courts'); expect(ui.note.textContent).toContain('réglages en attente');
  expect(ui.select.options.filter(o => o.dataset.retainedUnknown)).toHaveLength(0);
});
it('optional culture follows the existing site default only when absent; explicit unknown and empty tokens are not normalized away', () => {
  const choose = vi.fn(), ui = controls(choose), imported = { ...defaultLayoutConfig(), culture: undefined };
  ui.binding.sync({ requested: imported.culture, place: 'javanese-courts' });
  expect(ui.select.value).toBe('site'); expect(ui.reset.disabled).toBe(true); expect(ui.host.open).toBe(false);
  expect(ui.note.textContent).toContain('Comme le lieu · javanese-courts'); expect(imported.culture).toBeUndefined();
  ui.binding.sync({ requested: 'future-profile', place: 'javanese-courts' });
  expect(ui.select.value).toBe('future-profile'); expect(ui.host.open).toBe(true);
  ui.binding.sync({ requested: '', place: 'javanese-courts' });
  expect(ui.select.value).toBe(''); expect(ui.reset.disabled).toBe(false); expect(choose).not.toHaveBeenCalled();
});
it('the existing plan generation select and explicit return-to-place modify culture only, keeping independent recipes, parcels and architecture', () => {
  const state = settings(), original = structuredClone(state);
  const ui = controls(value => { state.layout = withCityPlanCulture(state.layout, value); ui.binding.sync({ requested: state.layout.culture }); });
  ui.binding.sync({ requested: state.layout.culture }); ui.select.value = 'javanese-courts'; ui.select.onchange!();
  expect(state).toEqual({ ...original, layout: { ...original.layout, culture: 'javanese-courts' } });
  ui.reset.onclick!(); expect(state).toEqual({ ...original, layout: { ...original.layout, culture: 'site' } });
  expect(ui.select.value).toBe('site'); expect(ui.reset.disabled).toBe(true);
});
it('the actual place binding keeps explicit plan/parcel/building overrides and exact population/centre/seeds while changing place preferences', () => {
  const state = settings(), before = structuredClone(state), place = exactPlace(), original = structuredClone(place);
  place.sitePrefs = { woodland: 1 }; const select = new SelectControl(['roman-core', 'javanese-courts']); let edits = 0;
  bindCityPlaceCulture(select.asSelect(), change => { edits++; change(place); });
  select.value = 'roman-core'; select.onchange!();
  expect(place).toEqual({ ...original, culture: 'roman-core', sitePrefs: {} }); expect(state).toEqual(before); expect(edits).toBe(1);
  // Following the place remains a token: it never becomes a frozen copy of the current place ID.
  expect(withCityPlanCulture(before.layout, 'site').culture).toBe('site');
});
it('actual snapshot→MU→query→normalizers preserve explicit and missing profile cases, architecture, exact place and seeds; history sync does not reset them', () => {
  const state = settings(), place = exactPlace();
  const saved: WorkshopState = { layoutConfig: state.layout, parcelConfig: state.parcels, quarterSeed: 'Q-exact', parcelSeed: 'P-exact', population: place.population, siteKey: place.key, buildingState: state.building };
  const query = new URLSearchParams({ urban: JSON.stringify(workshopSettings(saved)), settlements: JSON.stringify({ config: { mode: 'list', list: [place] } }) });
  const params = new URLSearchParams(decodeRecipe(encodeRecipe({ stage: 'urban', query: query.toString() })).query);
  const restored = JSON.parse(params.get('urban')!) as WorkshopState;
  expect(normalizeLayoutConfig(restored.layoutConfig, true).culture).toBe('roman-core');
  expect(normalizeParcelConfig(restored.parcelConfig)).toEqual(state.parcels); expect(restored.buildingState?.settings).toEqual(state.building.settings);
  expect(restored.quarterSeed).toBe('Q-exact'); expect(restored.parcelSeed).toBe('P-exact'); expect(params.get('settlements')).toBe(query.get('settlements'));
  expect(normalizeLayoutConfig().culture).toBe('site'); expect(normalizeLayoutConfig({ recipe: 'custom' }, true).culture).toBe('site');
  const choose = vi.fn(), ui = controls(choose); ui.binding.sync({ requested: restored.layoutConfig.culture, place: place.culture });
  ui.binding.sync({ requested: 'site', place: 'another-place' }); ui.binding.sync({ requested: restored.layoutConfig.culture, place: place.culture });
  expect(ui.select.value).toBe('roman-core'); expect(ui.host.open).toBe(true); expect(choose).not.toHaveBeenCalled();
});
it('real urban engine transport keeps place, plan, parcel and architecture choices distinct through generation normalization', async () => {
  const state = settings(), site = exactPlace(), sent: UrbanRequest[] = [];
  const runtime = { profile: 'local' as const, server: 'http://culture-contract.test:8795' };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ id: 1, layouts: [] }), { headers: { 'content-type': 'application/json' } }); }));
  const engine = await createUrbanEngine(runtime);
  const first: UrbanRequest = { id: 1, kind: 'quarters', seed: 'Q-exact', runtime, sites: [{ key: site.key, culture: site.culture, population: site.population, center: site.position!, radius: 1000 }], layoutConfig: layoutWithEdits(normalizeLayoutConfig(state.layout, true), emptyEdits()) };
  expect((await engine.run(first)).error).toBeUndefined(); expect(sent[0].layoutConfig?.culture).toBe('roman-core');
  expect(sent[0].sites).toEqual(first.sites); expect(sent[0].seed).toBe('Q-exact'); expect(sent[0].layoutConfig?.recipe).toBe('specific-kept');
  const retained: Layout = { key: site.key, culture: 'roman-core', center: site.position!, quarters: [], streets: [], blocks: [], warnings: [], config: state.layout };
  const second: UrbanRequest = { id: 2, kind: 'parcels', seed: 'P-exact', runtime, layouts: [retained], parcelConfig: parcelWithEdits(state.parcels, emptyEdits()) };
  expect((await engine.run(second)).error).toBeUndefined(); expect(sent[1].parcelConfig?.culture).toBe('chinese'); expect(sent[1].layouts?.[0].culture).toBe('roman-core');
  expect(sent[1].parcelConfig?.recipe).toBe('parcel-kept'); expect(state.building.settings.culture).toBe('halfling');
  expect(sent[1]).not.toHaveProperty('settings'); expect(state.layout.culture).toBe('roman-core');
});
it('production CityBench keeps the original select inside its real roots and removes both unconditional override resets', () => {
  const urban = readFileSync(new URL('../src/ui/terrainUrban.ts', import.meta.url), 'utf8');
  const place = readFileSync(new URL('../src/ui/terrainSettlements.ts', import.meta.url), 'utf8');
  expect(urban).not.toContain("layoutConfig.culture = 'site'"); expect(urban).not.toContain('adoptSiteCulture'); expect(place).not.toContain('adoptSiteCulture');
  expect(urban).toContain("[label('[data-config=\"culture\"]')]"); expect(urban).toContain('plan.controls.append(planCulture)');
  expect(urban).toContain('cityPlanCulture = bindCityPlanCulture('); expect(place).toContain('bindCityPlaceCulture(cultureSelect, edit)');
  expect(urban).toContain("installSettlementStyles("); // deliberate global reset remains a separate advertised action
});
