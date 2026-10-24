import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import nativePeriods from '../src/data/nativeAdmissionPeriods.json';
import { retainSelectValue } from '../src/ui/retainedSelectValue';
import { bindProgrammePolicyControls, PROGRAMME_POLICY_HOUSES, PROGRAMME_CATALOGUE_PERIODS, programmePolicyControlsHtml, programmePolicyEvidenceHtml } from '../src/ui/urbanProgrammePolicy';
import { defaultProgrammeContext, normalizeLayoutConfig, type ProgrammeContext } from '../../rust/bridge/urbanConfig';
import { workshopSettings } from '../src/ui/urbanSnapshot';
import { encodeRecipe, decodeRecipe } from '../src/ui/recipe';
import type { WorkshopState } from '../src/ui/testbenchUrban';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urban';
// Structural browser-select model: assigning a value without an option yields
// empty, the concrete failure being corrected. These are NOT native DTOs.
class OptionControl {
  value = ''; textContent: string | null = ''; title = ''; dataset: Record<string, string> = {}; parent?: SelectControl;
  remove() { if (this.parent) this.parent.options.splice(this.parent.options.indexOf(this), 1); }
}
class SelectControl {
  options: OptionControl[] = []; private selected = '';
  ownerDocument = { createElement: (_: string) => new OptionControl() };
  constructor(values: string[]) { for (const value of values) { const o = new OptionControl(); o.value = value; this.add(o); } }
  add(o: OptionControl) { o.parent = this; this.options.push(o); }
  get value() { return this.selected; }
  set value(v: string) { this.selected = this.options.some(o => o.value === v) ? v : ''; }
  asSelect() { return this as unknown as HTMLSelectElement; }
}
function controls() {
  const mode = new SelectControl(['strict', 'inspired', 'fantasy']), period = new SelectControl(['', 'any', 'A', 'M']), note = { textContent: '' };
  let change = () => {};
  const host = { querySelector(selector: string) { return selector.endsWith('"mode"]') ? mode : selector.endsWith('"period"]') ? period : note; },
    addEventListener(_type: string, callback: () => void) { change = callback; } };
  const binder = bindProgrammePolicyControls(host as unknown as ParentNode & Pick<HTMLElement, 'addEventListener'>);
  return { binder, mode, period, note, change: () => change() };
}
it('actual policy binding preserves retained custom periods/any and explicit unknown options without changing intent/functions/resources', () => {
  const ui = controls(), previous = { ...defaultProgrammeContext(), role: 'isolated-mill' as const, functions: { capital: .5, port: 1 }, resources: ['grain'], lore: ['temple'], period: 'Edo<&·1600', navigableAccess: true };
  ui.period.value = previous.period; expect(ui.period.value).toBe(''); // ordinary HTML select would lose it
  ui.binder.sync(previous); expect(ui.period.value).toBe(previous.period); expect(ui.binder.read(previous)).toEqual(previous);
  expect(ui.period.options.find(o => o.value === previous.period)?.textContent).toContain('conservée');
  ui.binder.sync({ ...previous, period: 'any' }); expect(ui.binder.read(previous).period).toBe('any');
  expect(ui.period.options.filter(o => o.dataset.retainedUnknown)).toHaveLength(0);
  ui.binder.clearPeriod(); const cleared = ui.binder.read(previous); expect(cleared).toEqual({ ...previous, period: '' });
  expect(ui.note.textContent).toContain('inconnue');
});
it('unknown imported policy is visible and preserved until explicit correction, never silently inspired', () => {
  const ui = controls(), context: ProgrammeContext = JSON.parse(JSON.stringify({ ...defaultProgrammeContext(), mode: 'future-native-policy', period: 'A' }));
  ui.binder.sync(context); expect(ui.mode.value).toBe('future-native-policy'); expect(ui.note.textContent).toContain('non prise en charge');
  expect(() => ui.binder.read(context)).toThrow('Aucun repli'); expect(context.mode).toBe('future-native-policy');
  ui.mode.value = 'inspired'; ui.change(); expect(ui.binder.read(context).mode).toBe('inspired');
});
it('retained profile/recipe select keeps exact imported ID, avoids option accumulation and removes transient token only on explicit known sync', () => {
  const s = new SelectControl(['site', 'roman-core']); retainSelectValue(s.asSelect(), 'unknown/<&>'); expect(s.value).toBe('unknown/<&>');
  retainSelectValue(s.asSelect(), 'future-profile'); expect(s.options.map(o => o.value)).toEqual(['site', 'roman-core', 'future-profile']);
  retainSelectValue(s.asSelect(), 'roman-core'); expect(s.value).toBe('roman-core'); expect(s.options.map(o => o.value)).toEqual(['site', 'roman-core']);
});
it('binding applies the existing native UTF8 period limit and keeps empty and any distinct', () => {
  const ui = controls(), c = { ...defaultProgrammeContext(), period: 'é'.repeat(33) }; ui.binder.sync(c);
  expect(() => ui.binder.read(c)).toThrow('64 octets'); ui.binder.sync({ ...c, period: 'any' }); expect(ui.binder.read(c).period).toBe('any');
  ui.binder.sync({ ...c, period: '' }); expect(ui.binder.read(c).period).toBe('');
});
it('programme policy→Houses mapping matches the actual current native consumer, not an invented enum', () => {
  const code = readFileSync(new URL('../../rust/crates/core/src/urban/building_sites.rs', import.meta.url), 'utf8');
  const body = code.match(/let mode = match pr\.context\.mode\.as_str\(\)\s*\{([\s\S]*?)\};/)?.[1]; expect(body).toBeDefined();
  const pairs = [...body!.matchAll(/("[^"]+"|_)\s*=>\s*"([^"]+)"/g)].map(m => [m[1],m[2]]);
  const lookup = (mode: string) => pairs.find(([k]) => k === JSON.stringify(mode))?.[1] ?? pairs.find(([k]) => k === '_')?.[1];
  for (const [mode, houses] of Object.entries(PROGRAMME_POLICY_HOUSES)) expect(lookup(mode)).toBe(houses);
});
it('applied policy report never claims a historical ceiling, culture×era×scale support or built source from a routing witness', () => {
  const html = programmePolicyEvidenceHtml({ population: 2000000, context: { ...defaultProgrammeContext(), mode: 'strict', period: 'M' }, cultures: [{
    culture: 'maori-pa', family: 'compound', functionalProfile: 'communal', architectureFamily: 'platform', architecturePack: 'OC-PAC', coverage: 'shared-pack', borrowing: '',
    admissibility: { recipeId: 'ROUTING-WITNESS', nativeLayout: 'platform', floors: [1, 1], eras: ['M'], minFrontage: 5, minAccessWidth: 1, minArea: 25, minDepth: 5, maxSlope: .1, sharedAccess: true, partyWalls: false },
  }] });
  expect(html).toContain('ROUTING-WITNESS'); expect(html).toContain('Recette témoin'); expect(html).toContain('Inconnue · identifiant non conservé');
  expect(html).toContain('inconnue ; ce contrat'); expect(html).toContain('Aucun plafond'); expect(html).not.toContain('historiquement validé');
  expect(programmePolicyEvidenceHtml()).toContain('contexte absent'); expect(programmePolicyEvidenceHtml()).toContain('Routage culturel inconnu');
  expect(programmePolicyControlsHtml()).toContain('Non précisée · aucun filtre');
});
it('actual snapshot→MU→normalize roundtrip retains custom period, profile ID, weighted functions, seed and exact source position', () => {
  const layout = defaultLayoutConfig(); layout.culture = 'future-profile'; layout.programme = { ...defaultProgrammeContext(), period: 'Edo<&·1600', functions: { capital: 1, port: .5, artisan: .5 } };
  const state: WorkshopState = { layoutConfig: layout, parcelConfig: defaultParcelConfig(), quarterSeed: 'Q-exact', parcelSeed: 'P-exact', population: 100000, siteKey: 'city' };
  const query = new URLSearchParams({ urban: JSON.stringify(workshopSettings(state)), settlements: JSON.stringify({ config: { list: [{ key: 'city', culture: 'future-profile', population: 100000, position: { x: 2639.9315590685324, y: 2668.9433913724934 } }] } }) });
  const round = new URLSearchParams(decodeRecipe(encodeRecipe({ stage: 'urban', query: query.toString() })).query);
  const saved = JSON.parse(round.get('urban')!) as WorkshopState; expect(normalizeLayoutConfig(saved.layoutConfig).programme).toEqual(layout.programme); expect(saved.layoutConfig.culture).toBe('future-profile');
  expect(saved.quarterSeed).toBe('Q-exact'); expect(saved.parcelSeed).toBe('P-exact'); expect(round.get('settlements')).toBe(query.get('settlements'));
});

it('available era choices come from the same native profiles catalogue; auto is not fabricated as an era alias', () => {
  const data = JSON.parse(readFileSync(new URL('../../rust/crates/houses/data/urban-admission.json', import.meta.url), 'utf8'));
  const expected = [...new Set<string>(data.profiles.flatMap((p: { eras: string[] }) => p.eras))].sort();
  expect(PROGRAMME_CATALOGUE_PERIODS).toEqual(expected);
  const raw = readFileSync(new URL('../../rust/crates/houses/data/urban-admission.json', import.meta.url));
  expect(nativePeriods.sourceSha256).toBe(createHash('sha256').update(raw).digest('hex'));
  expect(nativePeriods.generatorVersion).toBe(data.generator_version);
  expect(nativePeriods.schemaVersion).toBe(data.schema_version);
  for (const era of expected) expect(programmePolicyControlsHtml()).toContain(`value="${era}"`);
  if (!expected.includes('auto')) expect(programmePolicyControlsHtml()).not.toContain('value="auto"');
  const ui = controls(), c = { ...defaultProgrammeContext(), period: 'auto' }; ui.binder.sync(c); expect(ui.binder.read(c).period).toBe('auto');
});
