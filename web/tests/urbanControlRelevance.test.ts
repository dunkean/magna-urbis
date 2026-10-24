import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultLayoutConfig, defaultParcelConfig, normalizeLayoutConfig } from '../../rust/bridge/urbanConfig';
import { DIRECT_SMALL_KINDS, DIRECT_QUARTER_FIELDS, ISOLATED_INTENTS, requestedControlRelevance, retainedControlRelevance, bindControlRelevance,
  controlRelevanceControlsHtml, type RelevanceLayout } from '../src/ui/urbanControlRelevance';
import fixture from './fixtures/urban-control-relevance-native.json';
import { workshopSettings } from '../src/ui/urbanSnapshot';
import { encodeRecipe, decodeRecipe } from '../src/ui/recipe';
import type { WorkshopState } from '../src/ui/testbenchUrban';
import { emptyEdits, layoutWithEdits } from '../src/ui/cityEdits';

it('direct-small and isolated lists match the real native consumers; fallback is explicit rather than assumed impossible', () => {
  const source = readFileSync(new URL('../../rust/crates/core/src/urban/kinds.rs', import.meta.url), 'utf8');
  const idBody = source.slice(source.indexOf('pub fn id('), source.indexOf('pub fn label('));
  const ids = new Map([...idBody.matchAll(/Kind::(\w+)\s*=>\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));
  const smallBody = source.slice(source.indexOf('pub fn small('), source.indexOf('/// French label of a layout archetype'));
  expect([...smallBody.matchAll(/Kind::(\w+)/g)].map(m => ids.get(m[1])).sort()).toEqual([...DIRECT_SMALL_KINDS].sort());
  const services = JSON.parse(readFileSync(new URL('../../rust/crates/core/src/urban/services.json', import.meta.url), 'utf8'));
  expect([...ISOLATED_INTENTS].sort()).toEqual(Object.keys(services.isolated).sort());
  const native = readFileSync(new URL('../../rust/crates/core/src/urban/mod.rs', import.meta.url), 'utf8');
  expect(native).toMatch(/Some\(layout\)\s*=>\s*layout,\s*None\s*=>\s*quarters::generate/);
  expect(native).toContain('kind.small() && config.footprint.mechanism != "legacy"');
});
it('explicit kinds take priority over an isolated intent, while nucleated-village is correctly a quarter grammar', () => {
  for (const form of ['city', 'metropolis', 'market-town', 'walled-town', 'nucleated-village'] as const) {
    const config = defaultLayoutConfig(); config.settlementForm = form; config.programme.role = 'isolated-mill';
    const text = requestedControlRelevance(config);
    expect(text).toContain('prioritaire sur l’intention isolée'); expect(text).toContain('grammaire de quartiers'); expect(text).not.toContain('directe demandée');
  }
  for (const form of DIRECT_SMALL_KINDS) {
    const text = requestedControlRelevance({ settlementForm: form, footprint: { mechanism: 'auto' }, programme: { role: 'isolated-mill' } });
    expect(text).toContain('prioritaire sur l’intention isolée'); expect(text).toContain('repli en quartiers'); expect(text).toContain('conservées et éditables');
  }
});
it('auto+isolated exposes only a direct-path expectation; legacy, aliases, unknowns and site-dependent auto are not guessed', () => {
  for (const role of ISOLATED_INTENTS) {
    const text = requestedControlRelevance({ settlementForm: 'auto', footprint: { mechanism: 'auto' }, programme: { role } });
    expect(text).toContain('intention isolée'); expect(text).toContain('attendue sous réserve'); expect(text).toContain('repli');
  }
  expect(requestedControlRelevance({ settlementForm: 'single', programme: { role: 'isolated-mill' }, footprint: { mechanism: 'legacy' } })).toContain('chemin direct des petites grammaires est désactivé');
  for (const form of ['auto', 'nucleated', 'ribbon']) expect(requestedControlRelevance({ settlementForm: form, programme: { role: 'auto' }, footprint: { mechanism: 'auto' } })).toContain('Cette UI ne le prédit pas');
  expect(requestedControlRelevance({ settlementForm: 'unknown<&>', footprint: { mechanism: 'auto' } })).toContain('Forme importée inconnue');
  expect(requestedControlRelevance({ settlementForm: 'single' })).toContain('Mécanisme non conservé');
});
it('real returned native metadata distinguishes direct camp from quarter/edited village without using current selectors', () => {
  expect(fixture.format).toBe('urban-control-relevance-native-projection-1'); expect(fixture.cases).toHaveLength(3);
  expect(fixture.cases.map(row => retainedControlRelevance(row.layout).direct)).toEqual([true, false, false]);
  for (const row of fixture.cases) { expect(row.origin.sha256).toMatch(/^[0-9a-f]{64}$/); expect(row.origin.scope).toContain('SYNTHETIC'); }
  const direct: RelevanceLayout = structuredClone(fixture.cases[0].layout), before = JSON.stringify(direct);
  const text = retainedControlRelevance(direct).text;
  expect(text).toContain('Sur CE plan'); expect(text).toContain('footprint.family'); expect(text).toContain('nouvelle demande et son éventuel repli');
  expect(text).toContain('étapes communes'); expect(JSON.stringify(direct)).toBe(before);
  for (const kept of ['tissue', 'accessMode', 'maxLaneGrade', 'recipe', 'preset', 'params', 'footprint.mechanism', 'footprint.epochs']) expect(DIRECT_QUARTER_FIELDS).not.toContain(kept);
});
it('small archetype alone, conflicting marker, legacy, missing config and edited splices cannot claim non-use', () => {
  const base: RelevanceLayout = structuredClone(fixture.cases[0].layout);
  const cases: RelevanceLayout[] = [
    { ...base, structure: undefined }, { ...base, config: undefined }, { ...base, archetype: 'city' },
    { ...base, structure: { mechanism: 'accessibility', family: 'camp' } }, { ...base, structure: { mechanism: 'kind', family: 'city' } },
    { ...base, config: { ...base.config, footprint: { mechanism: 'legacy' } } },
    { ...base, config: { ...base.config, footprint: { mechanism: 'future-mechanism' } } },
    { ...base, config: { ...base.config, overrides: { quarters: { '0': { salt: 1 } } } } },
  ];
  for (const row of cases) { const result = retainedControlRelevance(row); expect(result.direct).toBe(false); expect(result.text).not.toContain('n’a pas piloté'); }
});
it('the actual binding updates requested reason independently of applied metadata and never touches generation controls or values', () => {
  const requested = { textContent: '' }, retained = { innerHTML: '' }, selectors: string[] = [];
  const host = { querySelector(key: string) { selectors.push(key); return key === '[data-control-relevance-requested]' ? requested : retained; } };
  const binding = bindControlRelevance(host as unknown as ParentNode), config = defaultLayoutConfig();
  config.programme.role = 'isolated-mill'; config.footprint.family = 'fingers'; config.suburbs = 'many'; config.phases = 4; config.mixCulture = 'roman-core';
  const source = JSON.stringify(config), applied = fixture.cases.map(row => row.layout);
  binding.sync(config, applied); const report = retained.innerHTML; expect(requested.textContent).toContain('intention isolée');
  config.settlementForm = 'city'; binding.sync(config, applied);
  expect(requested.textContent).toContain('prioritaire'); expect(retained.innerHTML).toBe(report);
  binding.sync(config, undefined); expect(retained.innerHTML).toContain('Aucun plan retourné');
  expect(JSON.stringify({ ...config, settlementForm: 'auto' })).toBe(source);
  expect(selectors).toEqual(['[data-control-relevance-requested]', '[data-control-relevance-retained]']);
  expect(controlRelevanceControlsHtml()).not.toContain('data-config'); expect(controlRelevanceControlsHtml()).not.toContain('disabled');
});
it('actual snapshot/MU/import/normalization and request-config preparation keep every inactive-or-fallback value, seed and exact source position', () => {
  const config = defaultLayoutConfig(); config.programme.role = 'isolated-mill'; config.footprint.family = 'fingers'; config.footprint.nuclei = 5; config.suburbs = 'many'; config.phases = 4;
  config.mixCulture = 'roman-core'; config.mixMode = 'sectors'; config.mixShare = .35;
  const state: WorkshopState = { layoutConfig: config, parcelConfig: defaultParcelConfig(), quarterSeed: 'Q-exact', parcelSeed: 'P-exact', population: 100000, siteKey: 'city' };
  const places = JSON.stringify({ list: [{ population: 100000, position: { x: 2639.9315590685324, y: 2668.9433913724934 } }] });
  const query = new URLSearchParams({ urban: JSON.stringify(workshopSettings(state)), settlements: places });
  const params = new URLSearchParams(decodeRecipe(encodeRecipe({ stage: 'urban', query: query.toString() })).query);
  const restored: WorkshopState = JSON.parse(params.get('urban')!), normalized = normalizeLayoutConfig(restored.layoutConfig, true);
  requestedControlRelevance(normalized); expect(layoutWithEdits(normalized, emptyEdits())).toEqual(config);
  expect(params.get('settlements')).toBe(places); expect(restored.quarterSeed).toBe('Q-exact'); expect(restored.parcelSeed).toBe('P-exact');
  expect(restored.parcelConfig).toEqual(state.parcelConfig);
});
it('production themed roots bind refresh for actual draft read, programme apply and retained draw; no generation route is replaced', () => {
  const source = readFileSync(new URL('../src/ui/terrainUrban.ts', import.meta.url), 'utf8');
  expect(source).toContain("plan.controls.insertAdjacentHTML('beforeend', controlRelevanceControlsHtml())");
  expect(source).toContain("controlRelevance = bindControlRelevance(one<HTMLElement>('quarters', '[data-control-relevance]'))");
  expect(source).toContain("if (kind === 'quarters') controlRelevance?.sync(layoutConfig, layouts)");
  expect(source).toContain('layoutConfig.programme = clone(programme); controlRelevance?.sync(layoutConfig, layouts)');
  expect(source).toContain('compositionReport(); parcelReport(); controlRelevance?.sync(layoutConfig, layouts)');
});
