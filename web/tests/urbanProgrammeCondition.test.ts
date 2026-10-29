import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultProgrammeContext, defaultLayoutConfig, defaultParcelConfig, normalizeLayoutConfig, type ProgrammeContext } from '../../rust/bridge/urbanConfig';
import { bindProgrammeConditionControls, programmeConditionControlsHtml, programmeConditionEvidenceHtml, PROGRAMME_STATE_LABELS } from '../src/ui/urbanProgrammeCondition';
import { applyProgrammeAxesDraft, programmeAxesDraft } from '../src/ui/urbanProgrammeFunctions';
import { workshopSettings, appliedWorkshopSnapshot } from '../src/ui/urbanSnapshot';
import { encodeRecipe, decodeRecipe } from '../src/ui/recipe';
import type { WorkshopState } from '../src/ui/testbenchUrban';
import type { UrbanRequest } from '../../rust/bridge/urban';
vi.mock('../../rust/pkg/wasm/magna_urbis_wasm.js', () => ({ default: vi.fn(), SettlementTerrain: class {} }));
import { createUrbanEngine } from '../../rust/bridge/urban';

// DOM structural doubles model the actual select behaviour (missing options
// become empty). They do not stand in for a native/built result or a browser.
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
}
function controls() {
  const state = new SelectControl(['@absent', ...Object.keys(PROGRAMME_STATE_LABELS)]), mode = new SelectControl(['@absent', 'null', 'value']);
  const decay = { value: '', disabled: false }, note = { textContent: '' }, box = { open: false };
  const values: Record<string, object> = { '[data-condition-state]': state, '[data-condition-decay-mode]': mode, '[data-condition-decay]': decay, '[data-condition-note]': note, '[data-programme-condition]': box };
  const binding = bindProgrammeConditionControls({ querySelector: (key: string) => values[key] } as unknown as ParentNode);
  return { binding, state, mode, decay, note, box };
}
const context = (): ProgrammeContext => ({ ...defaultProgrammeContext(), role: 'isolated-mill', functions: { capital: .5, port: 1 }, resources: ['grain'], lore: ['temple'], period: 'M', navigableAccess: true });
const imported = (fields: object): ProgrammeContext => JSON.parse(JSON.stringify({ ...context(), ...fields }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('actual condition binding distinguishes absent, undefined, explicit null and explicit zero without touching other programme axes', () => {
  const cases: object[] = [{}, { state: undefined, decay: undefined }, { state: 'declining', decay: null }, { state: 'declining', decay: 0 }, { state: 'ruined', decay: 1 }];
  for (const fields of cases) {
    const previous = { ...context(), ...fields }, ui = controls(); ui.binding.sync(previous);
    const result = ui.binding.read(previous); expect(JSON.stringify(result)).toBe(JSON.stringify(previous));
    expect(applyProgrammeAxesDraft(result, programmeAxesDraft(result))).toEqual(result);
    expect(result.functions).toEqual(previous.functions); expect(result.role).toBe('isolated-mill'); expect(result.period).toBe('M');
    expect(ui.decay.disabled).toBe(previous.decay === undefined || previous.decay === null);
  }
  const ui = controls(); ui.binding.sync(imported({ state: 'declining', decay: null }));
  expect(ui.mode.value).toBe('null'); expect(ui.decay.value).toBe('');
  ui.binding.sync(imported({ state: 'declining', decay: 0 })); expect(ui.mode.value).toBe('value'); expect(ui.decay.value).toBe('0');
});
it('reset omits only state and decay; a new explicit rate is validated without clamping and zero remains a real choice', () => {
  const previous = imported({ state: 'abandoned', decay: 1 }), ui = controls(); ui.binding.sync(previous); ui.binding.useDefaults();
  expect(ui.binding.read(previous)).toEqual(context()); expect(previous.state).toBe('abandoned'); expect(previous.decay).toBe(1);
  ui.state.value = 'declining'; ui.mode.value = 'value'; ui.mode.onchange!(); expect(ui.decay.disabled).toBe(false);
  for (const invalid of ['', '-0.01', '1.01', 'NaN', 'Infinity']) { ui.decay.value = invalid; expect(() => ui.binding.read(previous)).toThrow('nombre fini entre 0 et 1'); }
  ui.decay.value = '0'; expect(ui.binding.read(previous)).toEqual({ ...context(), state: 'declining', decay: 0 });
  ui.mode.value = 'null'; expect(ui.binding.read(previous).decay).toBeNull();
});
it('unknown imported state and malformed vacancy remain visible and exact, never cast from a UI token; stale source cannot be replaced silently', () => {
  const rows = [{ state: 'future/<&>', decay: 'catalogue-special' }, { state: null, decay: 2 }, { state: '', decay: false }];
  for (const row of rows) {
    const previous = imported(row), ui = controls(); ui.binding.sync(previous);
    expect(ui.box.open).toBe(true); expect(ui.note.textContent).toContain('moteur natif peut la refuser');
    expect(ui.state.options.at(-1)?.textContent).toContain('conservé'); expect(ui.mode.options.at(-1)?.textContent).toContain('conservée');
    expect(ui.binding.read(previous)).toEqual(previous);
    const normalized = normalizeLayoutConfig({ programme: ui.binding.read(previous) }).programme;
    expect(normalized).toEqual(previous);
    expect(Object.hasOwn(normalized, 'state')).toBe(Object.hasOwn(previous, 'state'));
    expect(Object.hasOwn(normalized, 'decay')).toBe(Object.hasOwn(previous, 'decay'));
    expect(() => ui.binding.read(imported({ state: 'thriving', decay: .5 }))).toThrow('resynchronisez');
    ui.binding.useDefaults(); expect(ui.binding.read(previous)).toEqual(context());
  }
});
it('actual snapshot→MU→normalizer→binding roundtrip preserves optional/null/zero and unknown imports, exact populations, source position and seeds', () => {
  const cases: object[] = [{}, { state: 'declining', decay: null }, { state: 'declining', decay: 0 }, { state: 'future-state', decay: 'future-decay' }];
  const place = { key: 'city', culture: 'javanese-courts', population: 100000, position: { x: 2639.9315590685324, y: 2668.9433913724934 } };
  for (const fields of cases) {
    const p = imported(fields), state: WorkshopState = { layoutConfig: { ...defaultLayoutConfig(), programme: p, culture: 'roman-core' }, parcelConfig: defaultParcelConfig(), quarterSeed: 'Q-exact', parcelSeed: 'P-exact', siteKey: place.key, population: place.population };
    const saved = workshopSettings(appliedWorkshopSnapshot(state));
    const query = new URLSearchParams({ urban: JSON.stringify(saved), settlements: JSON.stringify({ config: { list: [place] } }) });
    const params = new URLSearchParams(decodeRecipe(encodeRecipe({ stage: 'urban', query: query.toString() })).query);
    const restored: WorkshopState = JSON.parse(params.get('urban')!), normalized = normalizeLayoutConfig(restored.layoutConfig, true).programme;
    const ui = controls(); ui.binding.sync(normalized); expect(ui.binding.read(normalized)).toEqual(p);
    expect(restored.quarterSeed).toBe('Q-exact'); expect(restored.parcelSeed).toBe('P-exact'); expect(JSON.parse(params.get('settlements')!)).toEqual(JSON.parse(query.get('settlements')!));
  }
  const undefinedFields = { ...context(), state: undefined, decay: undefined }, normalized = normalizeLayoutConfig({ programme: undefinedFields }).programme;
  expect(normalized).not.toHaveProperty('state'); expect(normalized).not.toHaveProperty('decay'); expect(JSON.stringify(undefinedFields)).toBe(JSON.stringify(normalized));
});
it('the actual urban engine transport leaves null/zero and invalid imports to native validation with no UI token or fallback', async () => {
  const runtime = { profile: 'local' as const, server: 'http://condition-contract.test:8795' };
  const rows = [{ state: 'declining', decay: null }, { state: 'declining', decay: 0 }, { state: 'future-state', decay: 'future-decay' }];
  for (const fields of rows) {
    const source = imported(fields); delete source.functions; // isolate this legacy-supported field transport, not the functions capability protocol
    const ui = controls(); ui.binding.sync(source); const sent: UrbanRequest[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: 1, error: 'controlled native-response witness' }), { headers: { 'content-type': 'application/json' } });
    }));
    const engine = await createUrbanEngine(runtime), result = await engine.run({ id: 1, kind: 'quarters', seed: 'same', runtime,
      layoutConfig: { ...defaultLayoutConfig(), programme: ui.binding.read(source) } });
    expect(result.error).toBe('controlled native-response witness'); expect(sent).toHaveLength(1);
    expect(sent[0].layoutConfig?.programme).toEqual(source); expect(JSON.stringify(sent[0])).not.toContain('@retained');
  }
});
it('applied report uses only the returned/imported context and never supplies a catalogue rate, observed vacancy or inhabitants', () => {
  const retained = { context: imported({ state: 'declining', decay: null }) }, before = structuredClone(retained), ui = controls();
  ui.binding.sync(retained.context); ui.state.value = 'ruined'; ui.mode.value = 'value'; ui.decay.value = '1';
  const html = programmeConditionEvidenceHtml(retained);
  expect(html).toContain('declining'); expect(html).not.toContain('ruined'); expect(html).toContain('null conservé'); expect(html).toContain('taux effectif non conservé séparément');
  expect(html).not.toContain('0.2'); expect(html).not.toContain('20 %'); expect(retained).toEqual(before);
  expect(programmeConditionEvidenceHtml({ context: imported({ decay: 0 }) })).toContain('Taux explicite conservé : 0');
  expect(programmeConditionEvidenceHtml({ context: context() })).toContain('taux effectif inconnu');
  expect(programmeConditionEvidenceHtml()).toContain('contexte absent');
  const invalid = programmeConditionEvidenceHtml({ context: imported({ state: '<script>', decay: '<img>' }) });
  expect(invalid).toContain('&lt;script&gt;'); expect(invalid).toContain('&lt;img&gt;'); expect(invalid).not.toContain('<script>');
});
it('state choices match actual native services and the real panel wires read/reset/report outside generic programme string assignment', () => {
  const services = JSON.parse(readFileSync(new URL('../../rust/crates/core/src/urban/services.json', import.meta.url), 'utf8'));
  expect(Object.keys(PROGRAMME_STATE_LABELS).sort()).toEqual(Object.keys(services.states).sort());
  const source = readFileSync(new URL('../src/ui/urbanBuildingsPanel.ts', import.meta.url), 'utf8'), html = programmeConditionControlsHtml();
  expect(html).not.toContain('data-programme="state"'); expect(html).not.toContain('data-programme="decay"');
  expect(source).toContain('conditionControls.sync(context)'); expect(source).toContain('options.applyProgramme(conditionControls.read(');
  expect(source).toContain("'[data-condition-reset]'"); expect(source).toContain('${programmeConditionEvidenceHtml(p)}');
});
