import type { Vocab } from './grammar';
import type { ToponymProfile } from './profiles';
import { Rng } from '../core/rng';
import { CULTURAL_TERMS, formatToponym, type CulturalTerms } from './syntax';
import type { NameMeaning } from './types';

const label = (t: CulturalTerms, noun: string, name: string): string => {
  if (!name) return noun;
  return t.order === 'suffix' ? `${name} ${noun}` : `${noun} ${name}`;
};

/**
 * An urban vocabulary belongs to the actual profile, not its coarse legacy bridge.
 * Exact legacy profiles retain their established vocabulary. New profiles use their
 * own local or explicitly authored convention; see NAMEBENCH_GRAMMAR_SOURCES.md.
 */
export function vocabularyForProfile(profile: ToponymProfile, legacy: Vocab, createProper?: (rng: Rng, kind: 'place' | 'river') => string): Vocab {
  if (profile.id === profile.family) return annotateVocabulary(profile, legacy, createProper);
  const t = CULTURAL_TERMS[profile.id];
  if (!t) throw new Error(`No cultural vocabulary for profile ${profile.id}`);
  const descriptions = new Map<string, { proper: string; opaque: boolean }>();
  const named = (noun: string, name: string): string => {
    const text = label(t, noun, name);
    descriptions.set(text, { proper: name, opaque: false });
    return text;
  };
  const feature = (kind: 'road' | 'gate' | 'castle' | 'river' | 'lake' | 'sea' | 'forest' | 'hill' | 'region' | 'farm' | 'street', n: string) => {
    const text = formatToponym(profile, kind, n);
    descriptions.set(text, { proper: n, opaque: false });
    return text;
  };
  // The callback supplies a place name, not an invented saint or trade. The
  // interface slots are historical: local labels here are place associations.
  const proper = (r: Rng) => createProper?.(r, 'place') ?? `${r.pick(['Ala', 'Mira', 'Sena', 'Tava', 'Nora', 'Kala'])}${r.pick(['ran', 'vel', 'min', 'sur', 'tal', 'nen'])}`;
  const directions: Record<string, [string, string, string, string]> = {
    turkish: ['Kuzey', 'Doğu', 'Güney', 'Batı'], persian: ['Shomāl', 'Sharq', 'Jonub', 'Gharb'],
    greek: ['Vorras', 'Anatoli', 'Notos', 'Dysi'], korean: ['Buk', 'Dong', 'Nam', 'Seo'],
    dutch: ['Noord', 'Oost', 'Zuid', 'West'], swahili: ['Kaskazini', 'Mashariki', 'Kusini', 'Magharibi'],
    russian: ['Sever', 'Vostok', 'Yug', 'Zapad'], polish: ['Północ', 'Wschód', 'Południe', 'Zachód'],
  };
  const dirs = directions[profile.id] ?? [0, 1, 2, 3].map(i => proper(new Rng(`district:${profile.id}:${i}`))) as [string, string, string, string];
  const crafts = Object.fromEntries(['tanner', 'dyer', 'smith', 'baker', 'fisher', 'potter', 'weaver', 'mason', 'butcher'].map(k => [k, proper(new Rng(`street:${profile.id}:${k}`))]));
  const worship = (dedication: string, _big: boolean, kind?: string): string => {
    let noun = t.worship;
    if (profile.id === 'persian') noun = /mosque|madrasa/i.test(kind ?? '') ? 'Masjed' : /fire/i.test(kind ?? '') ? 'Ātashkadeh' : 'Niyāyeshgāh';
    if (profile.id === 'swahili') noun = /mosque|madrasa/i.test(kind ?? '') ? 'Msikiti' : 'Mahali pa ibada';
    return named(noun, dedication);
  };
  descriptions.set(t.street, { proper: '', opaque: false });
  descriptions.set(t.square, { proper: '', opaque: false });
  const result: Vocab & { describeName(text: string): { proper: string; opaque: boolean } | undefined } = {
    describeName: text => descriptions.get(text),
    place: r => proper(r),
    water: r => createProper?.(r, 'river') ?? proper(r.fork('water')),
    saint: r => proper(r), town: base => base,
    old: [label(t, t.ward, t.castle), label(t, t.ward, t.gate)],
    ward: (r, _kind, _saint, dir, craft) => named(t.ward, r.pick([dir, craft, proper(r.fork('ward'))].filter(Boolean))),
    dirs, crafts,
    st: {
      main: [t.street], market: [label(t, t.street, t.square)], ring: [label(t, t.street, t.castle)],
      wall: [label(t, t.street, t.castle)], quay: [label(t, t.street, t.river)],
      bridge: [label(t, t.street, t.river)], riverside: [label(t, t.street, t.river)],
      church: s => named(t.street, s), dest: p => feature('street', p),
      gate: p => { const text = feature('street', feature('gate', p)); descriptions.set(text, { proper: p, opaque: false }); return text; }, craft: word => named(t.street, word),
      minor: r => named(t.street, proper(r.fork('minor'))), road: p => feature('road', p),
    },
    sq: { market: [t.square], green: [label(t, t.square, t.forest)], plain: r => named(t.square, proper(r.fork('square'))), church: s => named(t.square, s) },
    worship, castle: n => feature('castle', n),
    river: n => feature('river', n), lake: n => feature('lake', n), sea: n => feature('sea', n),
    forest: n => feature('forest', n), hill: n => feature('hill', n), farm: n => feature('farm', n),
    gateDir: d => named(t.gate, d), gateOf: p => feature('gate', p),
    class: [t.farm, t.ward, t.ward, t.region, t.region],
  };
  return annotateVocabulary(profile, result, createProper);
}

/** Metadata is recorded while composing, including legacy arrays; nothing is stripped from a full label. */
function annotateVocabulary(profile: ToponymProfile, source: Vocab, createProper?: (rng: Rng, kind: 'place' | 'river') => string): Vocab {
  type Description = NonNullable<ReturnType<NonNullable<Vocab['describeName']>>>;
  const descriptions = new Map<string, Description>();
  const t = CULTURAL_TERMS[profile.id];
  const remember = (text: string, proper = '', meaning?: NameMeaning, role?: string): string => {
    descriptions.set(text, { proper, opaque: false, ...(meaning ? { meaning } : {}), ...(role ? { role } : {}) });
    return text;
  };
  const staticNames = (values: string[], concept: string) => values.map(text => remember(text, '', { concept }));
  const proper = (r: Rng) => createProper?.(r, 'place') ?? source.place(r, 1);
  const named = (noun: string, name: string) => profile.id === 'french' ? `${noun} ${name}` : label(t, noun, name);
  const craftId = (word: string) => Object.keys(source.crafts).find(key => source.crafts[key] === word);
  const directionId = (word: string) => ['north','east','south','west'][source.dirs.indexOf(word)];
  const street = (name: string) => formatToponym(profile, 'street', name);
  const dedication=(s:string)=>profile.id==='french'?`${['Marie','Anne','Catherine','Madeleine','Foy','Geneviève','Radegonde'].includes(s)?'Sainte':'Saint'}-${s}`:profile.id==='english'?`St ${s}`:profile.id==='german'?`St. ${s}`:profile.id==='italian'?`San ${s}`:s;
  const result: Vocab = { ...source,
    describeName: text => descriptions.get(text) ?? source.describeName?.(text),
    old: staticNames(source.old, 'old-town'),
    ward: (r, kind, saint, direction, craft) => {
      const association = r.fork('association').pick(['place','craft','direction'] as const);
      // A profile without an authored craft/direction lexicon uses a named place association.
      const hasLexicon = profile.id === profile.family;
      const value = hasLexicon && association === 'craft' ? craft : hasLexicon && association === 'direction' ? direction : proper(r.fork('proper'));
      const meaning: NameMeaning | undefined = hasLexicon && association === 'craft' ? { concept:'craft', qualifier:craftId(craft) }
        : hasLexicon && association === 'direction' ? { concept:'direction', qualifier:directionId(direction) } : undefined;
      const cultural = profile.id === 'french' && meaning?.concept === 'craft' ? `Quartier des ${value}` : named(t.ward, value);
      return remember(cultural, value, meaning);
    },
    st: { ...source.st,
      main: staticNames(source.st.main, 'street-main'), market: staticNames(source.st.market, 'street-market'),
      ring: staticNames(source.st.ring, 'street-ring'), wall: staticNames(source.st.wall, 'street-wall'),
      quay: staticNames(source.st.quay, 'street-quay'), bridge: staticNames(source.st.bridge, 'street-bridge'), riverside: staticNames(source.st.riverside, 'street-riverside'),
      church: s => remember(source.st.church(s), dedication(s)),
      dest: s => remember(source.st.dest(s), s), road: s => remember(source.st.road(s), s),
      gate: s => remember(source.st.gate(s), s, { concept:'destination', viaGate:true }),
      craft: s => remember(source.st.craft(s), s, craftId(s) ? { concept:'craft', qualifier:craftId(s) } : undefined),
      minor: r => { const n = proper(r.fork('minor-place')); return remember(street(n), n); },
    },
    sq: { ...source.sq, market: staticNames(source.sq.market, 'square-market'), green: staticNames(source.sq.green, 'square-green'),
      plain: (r, saint) => remember(source.sq.plain(r, saint), dedication(saint)), church: s => remember(source.sq.church(s), dedication(s)) },
    worship: (s, big, kind) => remember(source.worship(s, big, kind), dedication(s), undefined, kind ?? (big ? 'worship.cathedral' : 'worship.shrine')),
    castle: s => remember(source.castle(s), s),
    gateDir: s => remember(source.gateDir(s), s, { concept:'direction', qualifier:directionId(s) }),
    gateOf: s => remember(source.gateOf?.(s) ?? formatToponym(profile, 'gate', s), s),
  };
  return result;
}
