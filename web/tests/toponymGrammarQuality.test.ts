import { describe, expect, it } from 'vitest';
import { CULTURE_PROFILES, resolveToponymProfile } from '../src/gen/names/profiles';
import { VOCAB } from '../src/gen/names/grammar';
import { Rng } from '../src/gen/core/rng';
import { CULTURAL_TERMS, formatToponym, frenchDe, italianDi } from '../src/gen/names/syntax';
import { vocabularyForProfile } from '../src/gen/names/culturalVocabulary';

describe('cultural grammar', () => {
  it('provides a vocabulary for every active profile, without crossing its family bridge', () => {
    for (const profile of Object.values(CULTURE_PROFILES)) {
      const v = vocabularyForProfile(profile, VOCAB[profile.family]);
      if (profile.id === profile.family) continue;
      const terms = CULTURAL_TERMS[profile.id];
      expect(terms, profile.id).toBeDefined();
      expect(v.st.road('Avala'), profile.id).not.toBe('Avala');
      expect(v.st.minor(new Rng('test')), profile.id).toContain(terms.street);
      expect(v.sq.market[0], profile.id).toContain(terms.square);
      expect(v.crafts.smith, profile.id).toBeTruthy();
      expect(new Set(Object.values(v.crafts)).size, profile.id).toBeGreaterThan(3);
      expect(v.ward(new Rng('test'), 'ring', '', '', ''), profile.id).toContain(terms.ward);
      expect(v.worship('', false), profile.id).toBeTruthy();
    }
  });
  it('contracts French and Italian only from known articles and traits', () => {
    expect(frenchDe('Avignon')).toBe("d'Avignon");
    expect(frenchDe('Havre', { article: 'le' })).toBe('du Havre');
    expect(frenchDe('Honfleur')).toBe('de Honfleur');
    expect(frenchDe('Héricourt', { muteH: true })).toBe("d'Héricourt");
    expect(italianDi('il Bosco')).toBe('del Bosco');
    expect(italianDi('la Rocca')).toBe('della Rocca');
    expect(italianDi('gli Ulivi')).toBe('degli Ulivi');
    expect(italianDi("l'Aquila")).toBe("dell'Aquila");
    expect(formatToponym(resolveToponymProfile('italian-comune'), 'road', 'Bosco', { article: 'il' })).toBe('Strada del Bosco');
  });
  it('does not repeat explicit type words or alter opaque complete names', () => {
    expect(formatToponym(resolveToponymProfile('ottoman'), 'lake', 'Van Gölü')).toBe('Van Gölü');
    expect(formatToponym(resolveToponymProfile('chinese'), 'river', 'Huang He')).toBe('Huang He');
    expect(formatToponym(resolveToponymProfile('japanese-jokamachi'), 'lake', 'Suwa-ko')).toBe('Suwa-ko');
    expect(formatToponym(resolveToponymProfile('korean'), 'gate', 'Nam-mun')).toBe('Nam-mun');
    expect(formatToponym(resolveToponymProfile('italian-comune'), 'lake', 'Lago di Como', { opaque: true })).toBe('Lago di Como');
  });
  it('uses distinct localized urban vocabulary for distinct cultural profiles', () => {
    const persian = vocabularyForProfile(resolveToponymProfile('persian'), VOCAB.arabic);
    const swahili = vocabularyForProfile(resolveToponymProfile('swahili-stone-town'), VOCAB.arabic);
    const maori = vocabularyForProfile(resolveToponymProfile('maori-pa'), VOCAB.sanskrit);
    expect(persian.st.dest('Isfahan')).toBe('Kucheh Isfahan');
    expect(swahili.st.dest('Lamu')).toBe('Mtaa Lamu');
    expect(maori.st.dest('Tāmaki')).toBe('Tiriti Tāmaki');
    expect(persian.sq.market).toEqual(['Meydān']);
    expect(swahili.sq.market).toEqual(['Uwanja']);
    expect(maori.sq.market).toEqual(['Marae']);
  });
});
