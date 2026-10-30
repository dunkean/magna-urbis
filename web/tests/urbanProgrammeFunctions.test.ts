import { expect, it } from 'vitest';
import { defaultProgrammeContext, defaultLayoutConfig, defaultParcelConfig, normalizeLayoutConfig, normalizeProgrammeFunctions, PROGRAMME_FUNCTIONS,
  type ProgrammeContext } from '../../rust/bridge/urbanConfig';
import { programmeAxesDraft, applyProgrammeAxesDraft, programmeFunctionEffects, programmeFunctionControlsHtml, bindProgrammeFunctionControls } from '../src/ui/urbanProgrammeFunctions';
import { appliedWorkshopSnapshot, workshopSettings } from '../src/ui/urbanSnapshot';
import { encodeRecipe, decodeRecipe } from '../src/ui/recipe';
import type { WorkshopState } from '../src/ui/testbenchUrban';

it('round-trips every intent with automatic or explicit functions; there is no role field', () => {
  for (const intent of ['settlement', 'isolated-farm', 'roadside-temple', 'isolated-shrine', 'isolated-mill', 'isolated-inn', 'isolated-tower'] as const) {
    const context = { ...defaultProgrammeContext(), intent, resources: ['ore'], period: 'M', lore: ['temple'], state: 'declining' as const, decay: .2 };
    const original = structuredClone(context);
    expect(applyProgrammeAxesDraft(context, programmeAxesDraft(context))).toEqual(original);
    expect(normalizeLayoutConfig({ programme: context }).programme).not.toHaveProperty('functions');
    expect(normalizeLayoutConfig({ programme: { ...context, role: 'port' } as ProgrammeContext }).programme).not.toHaveProperty('role');
    const nullable = { ...context, functions: null };
    expect(applyProgrammeAxesDraft(nullable, programmeAxesDraft(nullable))).toEqual(nullable);
  }
});

it('combines capital + port + artisan without losing resources, historical policy or port siting', () => {
  const previous: ProgrammeContext = { ...defaultProgrammeContext(), navigableAccess: true, resources: ['timber'], period: 'A', mode: 'strict' };
  const next = applyProgrammeAxesDraft(previous, { intent: 'settlement', custom: true, weights: { capital: 1, port: .5, artisan: 1 } });
  expect(next).toEqual({ ...previous, functions: { capital: 1, port: .5, artisan: 1 } });
  expect(applyProgrammeAxesDraft(next, { intent: 'settlement', custom: true, weights: {} }).functions).toEqual({});
  const reset = applyProgrammeAxesDraft(next, { intent: 'settlement', custom: false, weights: {} });
  expect(reset.intent).toBe('settlement'); expect(reset).not.toHaveProperty('functions');
});

it('rejects invalid and unknown explicit weights instead of clamping, discarding or resurrecting a legacy role', () => {
  for (const value of [{ ports: 1 }, { port: -1 }, { port: 1.01 }, { artisan: NaN }, { artisan: Infinity }, [], null, new Date()]) {
    expect(() => normalizeProgrammeFunctions(value)).toThrow();
  }
  const explicit = { ...defaultProgrammeContext(), functions: {} };
  expect(normalizeLayoutConfig({ programme: explicit }).programme.functions).toEqual({});
  const copy = normalizeProgrammeFunctions({ capital: 1, port: 0, artisan: .5 });
  expect(copy).toEqual({ capital: 1, port: 0, artisan: .5 });
});

it('makes partial weights, shared effects, integer service rounding and unscaled programme minima explicit', () => {
  for (const weight of [0, .5, 1]) {
    const rows = programmeFunctionEffects({ capital: weight, port: weight, artisan: weight, commerce: weight });
    expect(rows[0]).toContain(`${(8 + 17 * weight).toLocaleString('fr-FR')} %`);
    expect(rows[0]).toContain('une seule fois');
    expect(rows.at(-1)).toContain('arrondis vers le bas');
    if (weight > 0) { expect(rows.join(' ')).toContain('minimum 80 m²'); expect(rows.join(' ')).toContain('minimum 180 m²'); }
  }
  expect(programmeFunctionEffects({ riverine: .5 }).join(' ')).toContain('sans créer de rivière');
  const html = programmeFunctionControlsHtml();
  for (const role of ['isolated-mill', 'isolated-inn', 'isolated-tower', 'isolated-shrine']) expect(html).toContain(`value="${role}"`);
  for (const key of PROGRAMME_FUNCTIONS) expect(html).toContain(`data-programme-function="${key}"`);
});

class Control {
  value = ''; checked = false; disabled = false; hidden = false; textContent: string | null = ''; innerHTML = '';
  replaceChildren() { this.innerHTML = ''; this.textContent = ''; }
}
function controls() {
  const nodes = new Map<string, Control>();
  for (const selector of ['[data-programme-intent]', '[data-programme-custom-functions]', '[data-programme-functions]', '[data-programme-function-note]', '[data-programme-function-effects]',
    ...PROGRAMME_FUNCTIONS.map(key => `[data-programme-function="${key}"]`)]) nodes.set(selector, new Control());
  let changed = () => {};
  const host = { querySelector: (selector: string) => nodes.get(selector), addEventListener: (_: string, listener: () => void) => { changed = listener; } };
  const binder = bindProgrammeFunctionControls(host as unknown as ParentNode & Pick<HTMLElement, 'addEventListener'>);
  return { binder, get: (selector: string) => nodes.get(selector)!, change: () => changed() };
}
it('uses the actual UI binding to apply, restore and reset weighted controls and disable urban functions for an isolated mill', () => {
  const ui = controls(), previous = { ...defaultProgrammeContext(), functions: { artisan: 1 } };
  ui.binder.sync(previous);
  expect(ui.get('[data-programme-intent]').value).toBe('settlement');
  expect(ui.get('[data-programme-custom-functions]').checked).toBe(true);
  expect(ui.binder.read(previous).functions).toMatchObject({ artisan: 1 });
  ui.binder.useAutomatic();
  const { functions: _dropped, ...automatic } = previous;
  expect(ui.binder.read(previous)).toEqual(automatic);
  ui.binder.sync(previous);
  ui.get('[data-programme-custom-functions]').checked = true;
  ui.get('[data-programme-function="capital"]').value = '1';
  ui.get('[data-programme-function="port"]').value = '.5'; ui.change();
  const combined = ui.binder.read(previous);
  expect(combined.intent).toBe('settlement'); expect(combined.functions).toMatchObject({ capital: 1, artisan: 1, port: .5 });
  expect(ui.get('[data-programme-function-effects]').innerHTML).toContain('minimum 180 m²');
  ui.get('[data-programme-intent]').value = 'isolated-mill'; ui.change();
  expect(ui.get('[data-programme-functions]').disabled).toBe(true);
  expect(ui.get('[data-programme-function-note]').textContent).toContain('non applicables');
  expect(ui.binder.read(combined)).toMatchObject({ intent: 'isolated-mill', functions: combined.functions });
  ui.binder.sync(defaultProgrammeContext());
  expect(ui.binder.read(defaultProgrammeContext())).toEqual(defaultProgrammeContext());
  expect(ui.get('[data-programme-function-effects]').hidden).toBe(true);
});

it('preserves explicit combinations through actual snapshot, shared-code codec and normalization without changing exact site identity', () => {
  const layoutConfig = defaultLayoutConfig(); layoutConfig.programme = { ...defaultProgrammeContext(), functions: { capital: 1, artisan: .5, port: 1 } };
  const state: WorkshopState = { layoutConfig, parcelConfig: defaultParcelConfig(), quarterSeed: 'q-exact', parcelSeed: 'p-exact', siteKey: 'city', population: 5000,
    layouts: [{ key: 'city', culture: 'roman-core', center: { x: 2639.9315590685324, y: 2668.9433913724934 }, quarters: [], blocks: [], streets: [], warnings: [] }] };
  const snapshot = appliedWorkshopSnapshot(state);
  expect(snapshot.layouts?.[0].center).toEqual(state.layouts?.[0].center);
  const sites = { config: { list: [{ key: 'city', population: 5000, culture: 'roman-core', position: state.layouts![0].center }] } };
  const params = new URLSearchParams({ artifact: 'city-04-mountain-bay-s', urban: JSON.stringify(workshopSettings(snapshot)), settlements: JSON.stringify(sites),
    profile: 'local', localServer: 'http://127.0.0.1:8795' });
  const shared = decodeRecipe(encodeRecipe({ stage: 'urban', query: params.toString() }));
  const restored = new URLSearchParams(shared.query), settings = JSON.parse(restored.get('urban')!) as WorkshopState;
  expect(normalizeLayoutConfig(settings.layoutConfig).programme.functions).toEqual(layoutConfig.programme.functions);
  expect(JSON.parse(restored.get('settlements')!)).toEqual(sites);
  for (const key of ['artifact', 'profile', 'localServer']) expect(restored.get(key)).toBe(params.get(key));
  expect(settings.quarterSeed).toBe('q-exact'); expect(settings.parcelSeed).toBe('p-exact'); expect(settings.population).toBe(5000);
});
