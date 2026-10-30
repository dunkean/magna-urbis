import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import catalogue from '../../rust/crates/core/src/urban/catalogue.json';
import { SETTLEMENT_AXES, axisApplies, axisSource, expectedGrammar, profileComponents, profileSummary, resolvedEnclosure } from '../../rust/bridge/settlementAxes';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urbanConfig';
import { defaultSettlementSpec } from '../../rust/bridge/settlements';

const rust = (path: string): string => readFileSync(fileURLToPath(new URL(`../../rust/crates/core/src/${path}`, import.meta.url)), 'utf8');

it('hides district-only axes for direct small grammars and keeps them when the grammar is unknown or a city', () => {
  const mill = defaultLayoutConfig(); mill.programme.intent = 'isolated-mill';
  expect(expectedGrammar(mill)).toBe('single');
  for (const axis of ['footprint', 'phases', 'suburbs', 'mix']) {
    expect(axisApplies(axis, expectedGrammar(mill))).toBe(false);
    expect(axisApplies(axis, 'city')).toBe(true); expect(axisApplies(axis, undefined)).toBe(true);
  }
  for (const axis of ['population', 'intent', 'form', 'profile', 'enclosure', 'parcelling', 'growth']) expect(axisApplies(axis, 'single')).toBe(true);
  // A forced grammar wins over the intent; an auto request waits for the returned archetype.
  const forced = { ...mill, settlementForm: 'city' as const }; expect(expectedGrammar(forced)).toBe('city');
  expect(expectedGrammar(defaultLayoutConfig())).toBeUndefined(); expect(expectedGrammar(defaultLayoutConfig(), 'hamlet')).toBe('hamlet');
  const ruin = defaultLayoutConfig(); ruin.programme.intent = 'isolated-farm'; ruin.programme.state = 'ruined'; expect(expectedGrammar(ruin)).toBe('ruin');
});

it('reads auto / profile / override precedence from the request values', () => {
  const config = defaultLayoutConfig(), parcels = defaultParcelConfig();
  expect(['intent', 'form', 'footprint', 'growth', 'suburbs', 'phases', 'mix', 'era', 'functions'].map(a => axisSource(a, config))).toEqual(Array(9).fill('auto'));
  expect(['profile', 'plan', 'enclosure'].map(a => axisSource(a, config))).toEqual(['profile', 'profile', 'profile']);
  expect(axisSource('parcelling', config, parcels)).toBe('profile');
  config.settlementForm = 'walled-town'; config.fortification = 'none'; config.tissue = 'grid'; config.culture = 'bastide'; config.footprint.family = 'lobed';
  expect(['form', 'enclosure', 'plan', 'profile', 'footprint'].map(a => axisSource(a, config))).toEqual(Array(5).fill('override'));
  for (const axis of SETTLEMENT_AXES) expect(['override', 'profile', 'auto']).toContain(axisSource(axis.id, config, parcels));
});

it('makes every named profile explicit, composites included, without changing profile ids', () => {
  for (const id of Object.keys(catalogue.cultures)) expect(profileComponents(id)?.id).toBe(id);
  expect(profileComponents('bastide')).toMatchObject({ plan: 'planned grid new town', tradition: 'european-organic' });
  expect(profileComponents('maori-pa')).toMatchObject({ enclosure: 'palisade', site: 'hilltop or spur' });
  expect(profileComponents('japanese-jokamachi')?.functions).toContain('capital');
  expect(profileComponents('necropolis')).toMatchObject({ theme: 'necropolis', tradition: '—' });
  expect(profileSummary('necropolis')).not.toContain('tradition');
  expect(profileComponents('no-such-profile')).toBeUndefined();
});

it('UI resolution helpers agree with the native scenario matrix (urban/scenario_matrix_tests.rs)', () => {
  const farm = defaultLayoutConfig(); farm.programme.intent = 'isolated-farm';
  const mill = defaultLayoutConfig(); mill.programme.intent = 'isolated-mill';
  expect([expectedGrammar(farm), expectedGrammar(mill)]).toEqual(['farmstead', 'single']);
  // Village returned as a street village: no footprint shape, no influence; metropolis: everything applies.
  for (const [grammar, shown] of [['street-village', false], ['nucleated-village', true], ['metropolis', true]] as const)
    for (const axis of ['footprint', 'mix']) expect(axisApplies(axis, expectedGrammar(defaultLayoutConfig(), grammar))).toBe(shown);
  // Enclosure: explicit style = override of the type; the built main enclosure is read without the citadel.
  const styled = defaultLayoutConfig(); styled.fortificationStyle = 'flanked';
  expect([axisSource('enclosure', defaultLayoutConfig()), axisSource('enclosure', styled), axisSource('enclosureStyle', styled)]).toEqual(['profile', 'override', 'override']);
  expect(resolvedEnclosure({ enclosures: [{ kind: 'wall', purpose: 'citadel' }, { kind: 'wall', style: 'flanked', purpose: '' }] })).toBe('wall · flanked');
  expect(resolvedEnclosure({ enclosures: [] })).toBe('none'); expect(resolvedEnclosure(undefined)).toBeUndefined();
  // Native resolver precedence is the one documented here.
  const kinds = rust('urban/kinds.rs');
  expect(kinds).toMatch(/fn requested_enclosure[\s\S]*fortification == "culture" && cfg\.fortification_style != "auto"/);
});

it('drops the unused settlement kind label and the TS-only blend mix', () => {
  expect(Object.keys(defaultSettlementSpec())).not.toContain('kind');
  expect(rust('settlements/mod.rs')).not.toMatch(/pub kind: String/);
  expect(readFileSync(fileURLToPath(new URL('../src/gen/urban/culture.ts', import.meta.url)), 'utf8')).not.toContain("'blend'");
});
