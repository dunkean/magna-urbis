/** Shared display palette. Colours are final display sRGB, 0..1, never multipliers.
 * Lot swatches and intensity variation belong here; renderers may bucket tone for batching. */
export type PaletteRgb = [number, number, number];
export interface CultureIdentity { family: string; wall: PaletteRgb; roof: PaletteRgb; stone: PaletteRgb; accent: PaletteRgb }
export interface BuildingTint { wall: PaletteRgb; roof: PaletteRgb }
type Swatch = [string, string, string, string];
const FAMILIES: Record<string, Swatch> = {
  european: ['c8bba3', '956551', 'b8af9b', '75818a'],
  whitewash: ['e6dfcc', 'b77b60', 'd7c9ad', '65889c'],
  aegean: ['ece7d8', '9d7663', 'd7d1bc', '537c9d'],
  sand: ['ccae7f', 'bea27b', 'c9b28c', 'b38355'],
  ochre: ['b78a5b', 'ad835c', 'bea078', '9c6950'],
  brick: ['a56e58', '86574a', 'b5a18c', '6b7980'],
  eastasian: ['cfbfa5', '62666a', 'b6b2a0', '9c5244'],
  japanese: ['71604d', '626669', 'aba594', 'd2c6ae'],
  norse: ['65574a', '7d8060', '9d9a86', 'a88c63'],
  timber: ['92765a', '9c8c65', 'aaa08a', '745b46'],
  tropical: ['ae9270', 'b29c6e', 'b5ad91', '8c684f'],
  felt: ['aaa08a', '9b9280', 'aaa18e', '826b58'],
  mesoamerican: ['d6cbb2', 'c6b697', 'c8bca3', 'a75e4b'],
  highland: ['b5aa94', '9b8a6d', 'b0a895', '996951'],
  elven: ['d3d6bd', '7e9b8c', 'bec9b8', 'a7b4a4'],
  dwarven: ['a09684', '6d7779', 'a69b87', 'a17d4e'],
  drow: ['827d91', '56596b', '92909f', '9b829d'],
  duergar: ['898584', '5a6062', '99938a', '9a7560'],
  necropolis: ['b1b1a4', '747c78', 'b5b5a9', '89978f'],
  wizard: ['b9b0c7', '72758d', 'b7b0bd', 'a693b8'],
  gnomish: ['c8b78e', '93756a', 'bdb39a', '70968b'],
  orcish: ['8d8970', '716a55', 'a19c83', '9b7055'],
  halfling: ['cbbd9d', '85916b', 'b9b09a', '9c7854'],
  myconid: ['b5b3a0', '948594', 'b1b5a6', 'aa998b'],
  swamp: ['959b7b', '7b8665', 'a6ac91', '9f8d61'],
  tidal: ['c0d0c6', '819e9d', 'b6c9c1', '7daba7'],
  giant: ['a8a89e', '747b7c', 'a9aaa0', '9c8c72'],
  goblin: ['94886b', '79775b', 'a59b80', '937057'],
};
const GROUPS: Record<string, string> = {
  european: 'european-organic bastide rynek-town',
  whitewash: 'roman-core venetian-lagoon al-andalus italian-comune swahili-stone-town',
  aegean: 'byzantine-greek',
  sand: 'medina persian ottoman egyptian-planned nubian-fortified mesopotamian levantine-tell oasis-caravan hadhrami-tower rajput-fort',
  ochre: 'sahel ksar-oasis hausa-kano native-pueblo',
  brick: 'hanseatic flemish-cloth-town indus-planned newar',
  eastasian: 'chinese korean russian-kremlin vietnamese-citadel',
  japanese: 'japanese-jokamachi', norse: 'barbarian-norse norse-ringfort',
  timber: 'barbarian barbarian-celtic celtic-oppidum native-iroquoian slavic-gord maori-pa pnw-plank-village',
  tropical: 'indian-temple stilt-town khmer kraal yoruba ethiopian-highland great-zimbabwe javanese-courts dravidian-temple bagan mississippian guarani-village budj-bim',
  felt: 'mongol-ordu nomad-camp native-plains inuit-camp siberian-camp',
  mesoamerican: 'aztec maya inca', highland: 'himalayan-terraces caucasian-highland tibetan-monastery',
  elven: 'elven', dwarven: 'dwarven', drow: 'drow-enclave', duergar: 'duergar-hold', necropolis: 'necropolis', wizard: 'wizard-city',
  gnomish: 'gnomish', orcish: 'orcish', halfling: 'halfling', myconid: 'myconid-colony', swamp: 'lizardfolk-swamp', tidal: 'merfolk-tidal', giant: 'giant-hold', goblin: 'goblin-warren',
};
// Local variations retain the family's dominant character.
const LOCAL: Record<string, Partial<Record<'wall' | 'roof' | 'stone' | 'accent', string>>> = {
  'swahili-stone-town': { wall: 'ddd5bf', roof: 'c6bba1', stone: 'd1c7af' },
  'venetian-lagoon': { wall: 'd4b8a0', roof: 'ac7059' }, 'italian-comune': { wall: 'c5a486', roof: 'a56d52' },
  persian: { wall: 'd7c49c', roof: 'b7b19a', accent: '6d9d9c' }, ottoman: { wall: 'd6c9b1', roof: 'a47660' },
  'hadhrami-tower': { wall: 'c4a17d', roof: 'b99d7e' }, sahel: { wall: 'b88b5d', roof: 'ac8058' },
  'ksar-oasis': { wall: 'b58b67', roof: 'ac835f' }, 'hausa-kano': { wall: 'bd9670' },
  'flemish-cloth-town': { wall: 'ae7963', roof: '8b6054' }, 'indus-planned': { wall: 'b68e72', roof: 'b59b7c' },
  newar: { wall: 'ad7861', roof: 'a17057' }, 'russian-kremlin': { wall: 'd1c9b3', roof: '779080' },
  'native-plains': { wall: 'c5b69a', roof: 'b9a789' }, 'inuit-camp': { wall: 'd5d9d3', roof: 'c5cfc9' },
  'siberian-camp': { wall: 'a08b71', roof: '97846e' }, inca: { wall: 'b8b19c', roof: 'a18e65', stone: 'b8b19c' },
  maya: { wall: 'd6d0b7', roof: 'b3a078' }, 'tibetan-monastery': { wall: 'd8d0b8', roof: '99876c', accent: '9d594c' },
  'dravidian-temple': { wall: 'c4baa1', roof: 'b6ad95' }, 'indian-temple': { wall: 'cbb391', roof: 'ac8766' },
  bagan: { wall: 'b39473', roof: 'a7775d' }, 'great-zimbabwe': { wall: 'aea58d', roof: 'aa956c' },
};
const WALL: Record<string, string> = { timber: '8c745a', wood: '8c745a', brick: 'ae7c65', stone: 'b9b3a2', earth: 'bba17b', plaster: 'dfd6c0', bamboo: 'aa986b', wattle: 'ad9670', hide: 'bbae94', coral: 'd5cbb3' };
const ROOF: Record<string, string> = { tile: 'a77960', slate: '747c80', thatch: 'b3a077', reed: 'b3a077', palm: 'ac9870', bamboo: 'a0946d', shingle: '8e8069', bark: '81745f', turf: '85916b', hide: 'b6a78d', felt: 'a59c88', earth: 'b7a17f', plaster: 'd1c5a9', stone: 'a6a69a', snow: 'd9e0db', metal: '8d9996', lead: '828a8c' };
// Repeated entries are weights: Europe remains mostly aged terracotta, with
// occasional slate. These are related building colours, never random accents.
const SWATCHES: Partial<Record<string, { wall: string[]; roof: string[] }>> = {
  european: {
    wall: ['d8c9a9', 'c2a271', 'b9b8ae', 'e4dfce', '897058'],
    roof: ['b87650', 'a36145', '985e47', '82543f', '704c3e', 'a36145', '985e47', '687176'],
  },
  sand: { wall: ['cfb68c', 'c29d69', 'bd9581', 'e0d6bc'], roof: ['c3ab85', 'ac906b', 'd0b994', 'b69b7c'] },
  ochre: { wall: ['bf9464', 'a7794e', 'c39e7a', 'aa805c'], roof: ['b18c61', '96704b', 'b99b74', 'a17c55'] },
  brick: { wall: ['ae7458', '965a43', '7c5040', 'ba8969'], roof: ['a15d42', '8c503b', '704638', 'ae7051'] },
  japanese: { wall: ['695540', '483e33'], roof: ['51575a', '666b6c', '454b4f'] },
  whitewash: { wall: ['e6dfcc', 'd7c8aa', 'd2b69b', 'eae3d3'], roof: ['b77b60', 'a6664c', '905b46', 'bd8967'] },
  aegean: { wall: ['ece7d8', 'ded8c5', 'e5dfd1'], roof: ['a8785e', '936953', 'b78b70', '7c7770'] },
};
const rgb = (hex: string): PaletteRgb => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as PaletteRgb;
const mix = (a: PaletteRgb, b: PaletteRgb, t: number): PaletteRgb => a.map((v, i) => v + (b[i] - v) * t) as PaletteRgb;
const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const CULTURES: Record<string, string> = Object.fromEntries(Object.entries(GROUPS).flatMap(([family, names]) => names.split(' ').map(name => [name, family])));
const familyOf = (culture: string): string | undefined => CULTURES[culture];
/** Integer avalanche with separate salts for wall and roof; independent of ids,
 * reload order, and float32 storage of the native tone. Only 16 swatch seeds. */
function lotHash(seed: number, salt: number): number {
  let h = Math.imul(seed + 1, 0x9e3779b1) ^ salt;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return ((h ^ (h >>> 15)) >>> 0) / 0x100000000;
}

/** Dominant final sRGB wall, roof, local stone and accent. Unknown cultures use
 * the neutral European identity; buildingTint instead falls back by material.
 * Returns fresh arrays, safe for consumers to modify. */
export function cultureIdentity(culture: string): CultureIdentity {
  const family = familyOf(culture) ?? 'european', s = FAMILIES[family], local = LOCAL[culture];
  return { family, wall: rgb(local?.wall ?? s[0]), roof: rgb(local?.roof ?? s[1]), stone: rgb(local?.stone ?? s[2]), accent: rgb(local?.accent ?? s[3]) };
}

/** Final sRGB wall/roof (0..1), NOT material multipliers. tone is clamped to
 * 0..1 (nonfinite => .5). Independent, weighted wall/roof swatches are chosen
 * from 16 stable lot seeds, plus continuous +/-13% display intensity and a
 * small saturation/temperature drift. Swatch boundaries are intentional.
 * role defaults to dwelling; monument/tower/minaret/worship/civic/defence etc.
 * use local stone blended towards the dominant wall. Material names are Rust
 * massing wall/cover keys. Unknown culture uses those material colours. */
export function buildingTint(culture: string, wall: string, cover: string, tone: number, role = 'dwelling'): BuildingTint {
  const known = !!familyOf(culture), p = cultureIdentity(culture), t = Number.isFinite(tone) ? clamp(tone) : 0.5;
  const seed = Math.round(t * 15), wh = lotHash(seed, 0x68bc21eb), rh = lotHash(seed, 0x02e5be93);
  const masonry = /monument|tower|minaret|temple|mosque|church|cathedral|worship|religious|civic|defen|palace|castle|keep|citadel/.test(role);
  let w = known ? p.wall : rgb(WALL[wall] ?? WALL.plaster), r = known ? p.roof : rgb(ROOF[cover] ?? ROOF.tile);
  if (known) {
    const swatches = SWATCHES[p.family], family = FAMILIES[p.family];
    const choose = (kind: 'wall' | 'roof', h: number): PaletteRgb => {
      const dominant = p[kind], options = swatches?.[kind];
      if (!options) {
        // Other cultures use three restrained local shades of their own
        // dominant colour; no foreign palette is introduced by the fallback.
        const shade = Math.floor(h * 3) - 1;
        return dominant.map((v, i) => clamp(v + shade * [0.045, 0.035, 0.02][i])) as PaletteRgb;
      }
      const selected = rgb(options[Math.floor(h * options.length)]), base = rgb(family[kind === 'wall' ? 0 : 1]);
      return selected.map((v, i) => clamp(v + dominant[i] - base[i])) as PaletteRgb;
    };
    w = choose('wall', wh); r = choose('roof', rh);
    w = mix(w, rgb(WALL[wall] ?? WALL.plaster), 0.10);
    // Thatch, turf and metal retain their material character within local hues.
    const organic = /^(thatch|reed|palm|turf|bark|bamboo|snow|metal|lead)$/.test(cover);
    r = mix(r, rgb(ROOF[cover] ?? ROOF.tile), organic ? 0.85 : 0.08);
    if (masonry) { w = mix(p.stone, p.wall, 0.45); if (/^(earth|plaster|stone)$/.test(cover)) r = mix(r, w, 0.45); }
  }
  const vary = (c: PaletteRgb, shift: number, drift: number): PaletteRgb => {
    const grey = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    return c.map((v, i) => clamp((v + (v - grey) * drift * 0.08) * (1 + shift * (masonry ? 0.06 : 0.13)) + drift * 0.008 * (1 - i))) as PaletteRgb;
  };
  return { wall: vary(w, t * 2 - 1, Math.sin(t * Math.PI * 2)), roof: vary(r, Math.sin(t * Math.PI * 2 + 1.4), Math.cos(t * Math.PI * 2 + 0.7)) };
}
