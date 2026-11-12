import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import roots from '../src/gen/names/data/cultural-roots.json';
import { CULTURE_PROFILES, resolveToponymProfile } from '../src/gen/names/profiles';
import {
  ALGORITHM_VERSION, AUTHORED_CORPUS_SHA256, BASE_CORPUS_SHA256, CORPUS_FINGERPRINT,
  generateToponymRecord, generateToponym, isOpaqueCorpusLabel, type ToponymKind,
} from '../src/gen/names/toponyms';

const indigenousCultures = ['native-iroquoian', 'native-pueblo', 'native-plains', 'mississippian', 'pnw-plank-village',
  'maori-pa', 'inuit-camp', 'siberian-camp', 'guarani-village', 'budj-bim'];
const constructedCultures = [...indigenousCultures, 'roman-core', 'egyptian-planned', 'nubian-fortified',
  'mesopotamian', 'dravidian-temple', 'indus-planned', 'maya', 'aztec', 'inca'];
const features: ToponymKind[] = ['river', 'lake', 'sea', 'forest', 'hill', 'region', 'farm'];

describe('cultural corpus source quality', () => {
  it('never substitutes a broad modern country for Indigenous, Tamil or ancient sources', () => {
    for (const culture of constructedCultures) {
      const profile = resolveToponymProfile(culture);
      expect(profile.sourceMode, culture).toBe('constructed');
      expect(profile.coherence, culture).toBe('fictional-phonotactic');
      expect(profile.country, culture).toBeUndefined();
      expect(profile.generator, culture).toBeUndefined();
      for (const kind of ['town', ...features] as ToponymKind[]) {
        const result = generateToponymRecord({ seed: 'source-policy', key: kind, kind, culture });
        expect(result.sourceMode, `${culture}/${kind}`).toBe('constructed');
        expect(result.corpusLabel, `${culture}/${kind}`).toBeUndefined();
      }
    }
  });

  it('separates the five North American palettes and declares their fictional status', () => {
    const cultures = indigenousCultures.slice(0, 5);
    expect(cultures.map(c => resolveToponymProfile(c).id)).toEqual(['iroquoian', 'pueblo', 'plains', 'mississippian', 'pnw']);
    expect(new Set(cultures.map(c => resolveToponymProfile(c).rootGrammar)).size).toBe(5);
    expect(new Set(cultures.map(culture => generateToponym({ seed: 'distinct', key: 'town', kind: 'town', culture }))).size).toBe(5);
  });

  it('has an explicitly authored, feature-tagged grammar for every profile', () => {
    const profiles: Record<string, { authorship: string; onsets: string[]; vowels: string[]; codas: string[];
      roots: Record<string, { suffixes: string[]; culturalTemplate?: string }> }> = roots.profiles;
    for (const profile of Object.values(CULTURE_PROFILES)) {
      const grammar = profiles[profile.rootGrammar];
      expect(grammar, profile.id).toBeDefined();
      expect(grammar.authorship, profile.id).toBe('original-fictional');
      expect(grammar.onsets.length).toBeGreaterThan(5);
      expect(grammar.vowels.length).toBeGreaterThan(2);
      for (const kind of ['habitation', ...features]) {
        expect(grammar.roots[kind]?.suffixes.length, `${profile.id}/${kind}`).toBeGreaterThan(1);
      }
    }
    // These open-syllable palettes may never acquire arbitrary English/Russian codas.
    expect(profiles.maori.codas).toEqual(['']);
    expect(profiles.guarani.codas).toEqual(['']);
  });

  it('produces diverse deterministic original names independent of iteration order', () => {
    for (const culture of indigenousCultures.concat(['roman-core', 'dravidian-temple'])) {
      const keys = Array.from({ length: 128 }, (_, i) => `settlement:${i}`);
      const make = (key: string) => generateToponymRecord({ seed: 'quality', key, kind: 'town', culture });
      const before = Object.fromEntries(keys.map(key => [key, make(key)]));
      const after = Object.fromEntries([...keys].reverse().map(key => [key, make(key)]));
      expect(after, culture).toEqual(before);
      expect(new Set(Object.values(before).map(value => value.proper)).size, culture).toBeGreaterThan(120);
      expect(Object.values(before).every(value => value.proper === value.proper.normalize('NFC')), culture).toBe(true);
      expect(Object.values(before).every(value => !/[0-9]|undefined|null/.test(value.proper)), culture).toBe(true);
    }
  });

  it('keeps typed bare source names translatable and preserves complete source labels as opaque', () => {
    for (const name of ['Loire', 'TsingTao', 'Walmerbach']) expect(isOpaqueCorpusLabel('river', name)).toBe(false);
    for (const name of ['River Avon', 'Glendun River', 'Rivière des Liesses', 'Sumiyō Gawa']) {
      expect(isOpaqueCorpusLabel('river', name), name).toBe(true);
    }
    for (const name of ['Lake Constance', 'Lac Léman', 'Loch Ness']) expect(isOpaqueCorpusLabel('lake', name)).toBe(true);
    expect(isOpaqueCorpusLabel('lake', 'Léman')).toBe(false);
    const record = generateToponymRecord({ seed: 'source', key: 'river', kind: 'river', culture: 'bastide' });
    expect(record.cultural).toBe(record.corpusLabel);
    expect(record.proper).toBe(record.corpusLabel);
    expect(record.sourceMode).toBe('country');
    expect(record.opaque).toBe(isOpaqueCorpusLabel('river', record.corpusLabel!));
  });

  it('exposes roots separately from trusted cultural descriptors', () => {
    const context = { seed: 'root', key: 'wood', kind: 'forest' as const, culture: 'elven' };
    const record = generateToponymRecord(context);
    expect(record.cultural).toBe(`${record.proper} Wood`);
    expect(record.opaque).toBe(false);
    expect(generateToponym(context)).toBe(record.cultural);
    expect(generateToponymRecord(context)).toEqual(record);
  });

  it('versions replay against both the source pack and exact authored data', () => {
    const bytes = readFileSync(new URL('../src/gen/names/data/cultural-roots.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(AUTHORED_CORPUS_SHA256);
    expect(createHash('sha256').update(`${BASE_CORPUS_SHA256}:${AUTHORED_CORPUS_SHA256}`).digest('hex')).toBe(CORPUS_FINGERPRINT);
    expect(ALGORITHM_VERSION).toBe('3');
  });
});
