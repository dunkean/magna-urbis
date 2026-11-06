import { describe, expect, it } from 'vitest';
import catalogue from '../../rust/crates/core/src/urban/catalogue.json';
import pack from '../src/gen/names/data/names-pack.json';
import { CULTURES } from '../src/gen/urban/culture';
import { Rng } from '../src/gen/core/rng';
import { CULTURE_PROFILES, resolveToponymProfile } from '../src/gen/names/profiles';
import { frenchDe, frenchRoad, formatToponym } from '../src/gen/names/syntax';
import { generateToponym, readGenerator, type ToponymKind } from '../src/gen/names/toponyms';

describe('toponym profiles', () => {
  it('maps all active native and web cultures explicitly', () => {
    for (const id of new Set([...Object.keys(catalogue.cultures), ...Object.keys(CULTURES)])) {
      expect(CULTURE_PROFILES[id], id).toBeDefined();
      expect(resolveToponymProfile(id, undefined, 'seed').diagnostic?.startsWith('Unknown culture')).not.toBe(true);
    }
  });
  it('keeps distinct cultural profiles and declares approximations and unknowns', () => {
    expect(['persian', 'ottoman', 'korean', 'byzantine-greek'].map(id => resolveToponymProfile(id).id)).toEqual(['persian', 'turkish', 'korean', 'greek']);
    expect(resolveToponymProfile('flemish-cloth-town').id).toBe('dutch');
    expect(resolveToponymProfile('native-pueblo').sourceMode).toBe('constructed');
    expect(resolveToponymProfile('native-pueblo').country).toBeUndefined();
    expect(resolveToponymProfile('not-a-culture').diagnostic).toContain('Unknown culture');
    expect(resolveToponymProfile('persian', 'french').family).toBe('french');
  });
  it('makes independent names per stable key and kind', () => {
    const keys = ['a', 'b', 'c'];
    const make = (key: string, kind: ToponymKind) => generateToponym({ seed: 'seed', key, kind, culture: 'persian' });
    const before = Object.fromEntries(keys.map(k => [k, make(k, 'town')]));
    const after = Object.fromEntries([...keys].reverse().map(k => [k, make(k, 'town')]));
    expect(after).toEqual(before);
    for (const kind of ['town', 'river', 'lake', 'forest', 'hill', 'region', 'farm'] as const) expect(make('x', kind)).toBeTruthy();
  });
  it('uses non-empty corpus pools for distinct regions', () => {
    const countries: Record<string, { settlements: string[] }> = pack.countries;
    for (const id of ['FR', 'IR', 'TR', 'KR', 'GR']) expect(countries[id].settlements.length).toBeGreaterThan(100);
    const kinds = ['persian', 'ottoman', 'korean', 'byzantine-greek'];
    expect(new Set(kinds.map(culture => generateToponym({ seed: '7', key: 'town', kind: 'town', culture }))).size).toBe(4);
  });
});

describe('feature grammar', () => {
  it('contracts French articles and uses conservative H treatment', () => {
    expect(['Avignon', 'Le Havre', 'Les Ormes', 'La Rochelle'].map(frenchRoad)).toEqual(["Route d'Avignon", 'Route du Havre', 'Route des Ormes', 'Route de la Rochelle']);
    expect(frenchDe('Honfleur')).toBe('de Honfleur');
    expect(frenchDe('Héricourt', { muteH: true })).toBe("d'Héricourt");
  });
  it('preserves complete names and keeps profile-specific wrappers', () => {
    const tr = resolveToponymProfile('ottoman');
    expect(formatToponym(tr, 'lake', 'Van Gölü', { opaque: true })).toBe('Van Gölü');
    expect(formatToponym(tr, 'road', 'Ankara')).toBe('Ankara Yolu');
    expect(formatToponym(resolveToponymProfile('persian'), 'river', 'Zayandeh')).toBe('Rud-e Zayandeh');
    expect(formatToponym(resolveToponymProfile('korean'), 'gate', 'Seoul')).toBe('Seoul-mun');
    expect(formatToponym(resolveToponymProfile('byzantine-greek'), 'castle', 'Mystras')).toBe('Kastro Mystras');
  });
  it('reads supported generator patterns and rejects missing arrays', () => {
    const random = new Rng('a');
    expect(readGenerator({ pattern: { variants: [{ concat: ['a', 'b'], space: true, space_pos: 1 }] }, arrays: { a: ['North'], b: ['port'] } }, random)).toBe('North port');
    expect(readGenerator({ pattern: { variants: [{ concat: ['missing'] }] }, arrays: {} }, random)).toBeUndefined();
  });
  it('keeps established feature forms when a legacy profile has no corpus feature pool', () => {
    expect(generateToponym({ seed: 'seed', key: 'wood', kind: 'forest', culture: 'elven' })).toMatch(/ Wood$/);
    expect(generateToponym({ seed: 'seed', key: 'wood', kind: 'forest', culture: 'japanese-jokamachi' })).toMatch(/-no-mori$/);
  });
});
