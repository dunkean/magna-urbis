import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLASS_FLOOR, classOfPop, sizeForPop } from '../src/gen/options';
import { DEMOGRAPHIC_CLASSES } from '../../rust/bridge/settlementDemography';
import { defaultLayoutConfig, defaultParcelConfig, normalizeLayoutConfig, type LayoutConfig, type SettlementKind } from '../../rust/bridge/urbanConfig';
import type { Layout } from '../../rust/bridge/urban';
import { SETTLEMENT_KINDS, settlementPopulationChoices, withSettlementKind } from '../src/ui/settlementKinds';
import { morphologyOptions, morphologyEvidenceRows, morphologyEvidenceHtml, resetMorphology, MORPHOLOGY_LABELS } from '../src/ui/urbanMorphology';
import { appliedWorkshopSnapshot, workshopSettings } from '../src/ui/urbanSnapshot';
import { encodeRecipe, decodeRecipe } from '../src/ui/recipe';
import type { WorkshopState } from '../src/ui/testbenchUrban';

const native = (population: number, archetype: SettlementKind, form: LayoutConfig['settlementForm'] = 'auto'): Layout => ({
  key: 'city', culture: 'roman-core', center: { x: 2639.9315590685324, y: 2668.9433913724934 },
  config: { ...defaultLayoutConfig(), settlementForm: form }, programme: { population } as Layout['programme'],
  archetype, quarters: [], blocks: [], streets: [], warnings: [],
});

it('uses the canonical demographic bands on every boundary without interpreting shortcuts as floors', () => {
  expect(CLASS_FLOOR).toEqual([['megacity',1000000],['metropolis',100000],['city',20000],['town',1000],['village',150],['hamlet',15],['farmstead',0]]);
  for (const entry of DEMOGRAPHIC_CLASSES) {
    expect(classOfPop(entry.minimum)).toBe(entry.id); expect(classOfPop(entry.shortcut)).toBe(entry.id);
    if (entry.minimum > 0) expect(classOfPop(entry.minimum - 1)).not.toBe(entry.id);
  }
  expect(classOfPop(100000)).toBe('metropolis'); expect(classOfPop(200000)).toBe('metropolis');
  expect(SETTLEMENT_KINDS.map(c => c.population)).toEqual([10,40,300,3000,30000,250000,1500000]);
});

it('derives the legacy size preset from the demographic class (no second set of bands, no capital size)', () => {
  for (const [population, size] of [[14,'hamlet'],[15,'hamlet'],[149,'hamlet'],[150,'village'],[999,'village'],[1000,'town'],[19999,'town'],[20000,'city'],[99999,'city'],[100000,'metropolis'],[2000000,'metropolis']] as const)
    expect(sizeForPop(population), String(population)).toBe(size);
});

it('keeps a demographic class selectable when the map cap intersects it below the ordinary shortcut', () => {
  const at100k = settlementPopulationChoices(100000), metropolis = at100k.find(c => c.kind === 'metropolis');
  expect(metropolis?.population).toBe(100000); expect(at100k.some(c => c.kind === 'megacity')).toBe(false);
  expect(settlementPopulationChoices(200000).find(c => c.kind === 'metropolis')?.population).toBe(200000);
  for (const maximum of [12,14,15,150,1000,20000,100000,200000,1000000]) for (const c of settlementPopulationChoices(maximum)) {
    expect(c.population).toBeLessThanOrEqual(maximum); expect(classOfPop(c.population)).toBe(c.kind);
  }
  const exact = { population: 100000, name: 'exact' }; expect(withSettlementKind(exact, 'metropolis')).toBe(exact);
});

it('offers every native grammar and preserves both old village preferences and unknown imported ids visibly', () => {
  const html = morphologyOptions();
  for (const id of Object.keys(MORPHOLOGY_LABELS)) expect(html).toContain(`value="${id}"`);
  for (const alias of ['auto','nucleated','ribbon']) expect(html).toContain(`value="${alias}"`);
  expect(html.match(/<option /g)).toHaveLength(14);
  expect(morphologyOptions('older<&')).toContain('Valeur importée inconnue');
  expect(morphologyOptions('older<&')).toContain('older&lt;&amp;');
  // Cross-language id contract: read the actual resolver's id table, not a UI-only copy.
  const source = readFileSync(fileURLToPath(new URL('../../rust/crates/core/src/urban/kinds.rs', import.meta.url)), 'utf8');
  const nativeIds = [...source.slice(source.indexOf('pub fn id('), source.indexOf('/// French label for the UI')).matchAll(/=> "([a-z-]+)"/g)].map(m => m[1]);
  expect(Object.keys(MORPHOLOGY_LABELS).sort()).toEqual(nativeIds.sort());
});

it('renders demographic class and native grammar independently at100k/200k and13/14 without deriving geometry from the class', () => {
  for (const [population, kind, label] of [[100000,'metropolis','Métropole à plusieurs centres'],[200000,'metropolis','Métropole à plusieurs centres'],[13,'farmstead','Ferme isolée'],[14,'farmstead','Ferme isolée']] as const) {
    const rows = Object.fromEntries(morphologyEvidenceRows(native(population,kind)));
    expect(rows['Classe démographique']).toBe(population < 15 ? 'Ferme' : 'Métropole'); expect(rows['Grammaire retournée']).toBe(label);
    expect(rows['Grammaire demandée dans ce plan']).toContain('Automatique');
  }
  expect(morphologyEvidenceHtml([native(100000,'city')])).toContain('ne mesure pas les habitants réellement logés');
});

it('keeps absent imported evidence unknown rather than borrowing current population or a default form', () => {
  const old = native(100000,'city'); delete old.programme; delete old.config;
  const rows = Object.fromEntries(morphologyEvidenceRows(old));
  expect(rows['Classe démographique']).toBe('Inconnue'); expect(rows['Grammaire demandée dans ce plan']).toContain('Non conservée');
  expect(rows['Grammaire retournée']).toContain('Non reconnue ou non tracée');
  const legacy = native(100000,'city'); legacy.config!.footprint.mechanism = 'legacy';
  expect(Object.fromEntries(morphologyEvidenceRows(legacy))['Grammaire retournée']).toContain('pas une preuve');
});

it('explains out-of-range village preferences, forced grammar precedence and district scope using returned config', () => {
  expect(morphologyEvidenceRows(native(100000,'city','ribbon')).some(([k,v]) => k === 'Préférence de village' && v.includes('non imposée'))).toBe(true);
  const forced = native(100000,'city','city'); forced.config!.programme.intent = 'isolated-mill';
  expect(morphologyEvidenceRows(forced).some(([k,v]) => k === 'Priorité' && v.includes('isolée'))).toBe(true);
  forced.config!.scope = 'district'; expect(morphologyEvidenceRows(forced).some(([k,v]) => k === 'Périmètre' && v.includes('pas une agglomération'))).toBe(true);
});

it('preserves automatic, old preferences and every explicit form through normalization, snapshot, URL and shared MU codec', () => {
  for (const settlementForm of ['auto','nucleated','ribbon',...Object.keys(MORPHOLOGY_LABELS)] as LayoutConfig['settlementForm'][]) {
    for (const population of [13,150,100000,200000]) {
      const plan = native(population,'city',settlementForm), config = normalizeLayoutConfig(plan.config);
      const state: WorkshopState = { layoutConfig: config, parcelConfig: defaultParcelConfig(), siteKey: 'city', population, quarterSeed: 'q-exact', parcelSeed: 'p-exact', layouts: [plan] };
      const snapshot = appliedWorkshopSnapshot(state), saved = workshopSettings(snapshot);
      const sites = { config: { list: [{ key: 'city', population, culture: 'roman-core', position: plan.center }] } };
      const original = new URLSearchParams({ artifact: 'city-04-mountain-bay-s', urban: JSON.stringify(saved), settlements: JSON.stringify(sites), profile: 'local', localServer: 'http://127.0.0.1:8795' });
      const restored = new URLSearchParams(decodeRecipe(encodeRecipe({ stage: 'urban', query: original.toString() })).query);
      const imported = JSON.parse(restored.get('urban')!) as WorkshopState;
      expect(normalizeLayoutConfig(imported.layoutConfig).settlementForm).toBe(settlementForm); expect(imported.population).toBe(population);
      expect(imported.quarterSeed).toBe('q-exact'); expect(imported.parcelSeed).toBe('p-exact'); expect(JSON.parse(restored.get('settlements')!)).toEqual(sites);
      expect(snapshot.layouts![0]).toBe(plan); expect(snapshot.layouts![0].config!.settlementForm).toBe(settlementForm);
      for (const key of ['artifact','profile','localServer']) expect(restored.get(key)).toBe(original.get(key));
    }
  }
});

it('resets only morphology when the actual reset action asks for it, preserving functional facts and other geometry settings', () => {
  const config = defaultLayoutConfig(); config.settlementForm = 'metropolis'; config.programme.functions = { port: .5, capital: 1 }; config.footprint.nuclei = 5;
  const reset = resetMorphology(config);
  expect(reset.settlementForm).toBe('auto'); expect(reset.programme).toBe(config.programme); expect(reset.footprint).toBe(config.footprint);
  expect(config.settlementForm).toBe('metropolis'); expect(reset.footprint.nuclei).toBe(5);
});
