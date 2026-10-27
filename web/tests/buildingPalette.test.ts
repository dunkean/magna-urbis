import { describe, expect, it } from 'vitest';
import { buildingTint, cultureIdentity } from '../src/render/buildingPalette';

const cultures = 'european-organic bastide medina chinese japanese-jokamachi indian-temple roman-core elven dwarven necropolis russian-kremlin aztec inca byzantine-greek venetian-lagoon persian ottoman sahel hanseatic korean wizard-city gnomish stilt-town barbarian barbarian-celtic barbarian-norse norse-ringfort maya khmer celtic-oppidum orcish halfling kraal native-iroquoian native-pueblo native-plains nomad-camp swahili-stone-town drow-enclave duergar-hold myconid-colony egyptian-planned nubian-fortified mesopotamian levantine-tell oasis-caravan ksar-oasis yoruba himalayan-terraces newar indus-planned javanese-courts mississippian al-andalus italian-comune flemish-cloth-town rynek-town slavic-gord caucasian-highland ethiopian-highland great-zimbabwe hausa-kano hadhrami-tower rajput-fort dravidian-temple bagan vietnamese-citadel tibetan-monastery mongol-ordu maori-pa pnw-plank-village inuit-camp siberian-camp guarani-village budj-bim lizardfolk-swamp merfolk-tidal giant-hold goblin-warren'.split(' ');

describe('shared building palette', () => {
  it('covers the culture catalogue and returns independent, bounded colours', () => {
    for (const culture of cultures) {
      const p = cultureIdentity(culture), sample = buildingTint(culture, 'stone', 'tile', 0.4);
      expect(p.family === 'european' ? ['european-organic', 'bastide', 'rynek-town'].includes(culture) : true).toBe(true);
      for (const c of [...sample.wall, ...sample.roof]) { expect(c).toBeGreaterThan(0); expect(c).toBeLessThanOrEqual(1); }
      expect(buildingTint(culture, 'stone', 'tile', 0.4)).toEqual(sample);
      p.wall[0] = 0; expect(cultureIdentity(culture).wall[0]).toBeGreaterThan(0);
    }
  });
  it('shows a coherent but visible range even with only 16 batched tones', () => {
    const luma = (c: number[]) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    for (const culture of ['european-organic', 'medina', 'hanseatic', 'japanese-jokamachi', 'sahel']) {
      const samples = Array.from({ length: 16 }, (_, i) => buildingTint(culture, 'plaster', 'tile', i / 15));
      for (const k of ['wall', 'roof'] as const) {
        const values = samples.map(s => luma(s[k]));
        expect(Math.max(...values) - Math.min(...values), `${culture} ${k}`).toBeGreaterThan(0.14);
        expect(new Set(samples.map(s => s[k].map(v => Math.round(v * 255)).join(','))).size).toBeGreaterThanOrEqual(12);
      }
      for (let i = 0; i < 16; i++) {
        const stored = buildingTint(culture, 'plaster', 'tile', Math.fround(i / 15));
        for (const k of ['wall', 'roof'] as const) for (let c = 0; c < 3; c++) expect(Math.abs(stored[k][c] - samples[i][k][c])).toBeLessThan(1e-6);
      }
    }
  });
  it('chooses roofs independently of walls and preserves continuous intensity within each seed', () => {
    const samples = Array.from({ length: 16 }, (_, i) => buildingTint('european-organic', 'plaster', 'tile', i / 15));
    const rank = (k: 'wall' | 'roof') => samples.map((s, i) => ({ i, v: s[k].reduce((a, b) => a + b, 0) })).sort((a, b) => a.v - b.v).map(s => s.i);
    expect(rank('wall')).not.toEqual(rank('roof'));
    // A light wall can have a dark roof and a dark wall a lighter roof.
    expect(samples.some(s => s.wall[0] > 0.8 && s.roof[0] < 0.5)).toBe(true);
    expect(samples.some(s => s.wall[0] < 0.65 && s.roof[0] > 0.5)).toBe(true);
    for (const culture of cultures) {
      const a = buildingTint(culture, 'plaster', 'tile', 0.4), b = buildingTint(culture, 'plaster', 'tile', 0.401);
      for (const k of ['wall', 'roof'] as const) {
        expect(a[k]).not.toEqual(b[k]);
        for (let c = 0; c < 3; c++) expect(Math.abs(a[k][c] - b[k][c])).toBeLessThan(0.002);
      }
    }
    const low = buildingTint('unknown', 'plaster', 'tile', 0), high = buildingTint('unknown', 'plaster', 'tile', 1);
    expect(high.wall[1] / low.wall[1]).toBeCloseTo(1.13 / 0.87, 5);
  });
  it('retains organic roof materials and keeps monument walls in local stone', () => {
    for (const culture of ['european-organic', 'medina', 'hanseatic', 'japanese-jokamachi', 'sahel']) {
      const walls = Array.from({ length: 16 }, (_, i) => buildingTint(culture, 'stone', 'earth', i / 15, 'monument').wall);
      for (let c = 0; c < 3; c++) expect(Math.max(...walls.map(w => w[c])) - Math.min(...walls.map(w => w[c]))).toBeLessThan(0.12);
    }
    const tile = buildingTint('japanese-jokamachi', 'timber', 'tile', 0.4).roof;
    const thatch = buildingTint('japanese-jokamachi', 'timber', 'thatch', 0.4).roof;
    expect(thatch[0] - tile[0]).toBeGreaterThan(0.15);
    expect(thatch[0]).toBeGreaterThan(thatch[2] * 1.2);
  });
  it('falls back by material, clamps tone and harmonizes landmark stone', () => {
    expect(buildingTint('unknown', 'brick', 'tile', -2)).toEqual(buildingTint('unknown', 'brick', 'tile', 0));
    expect(buildingTint('unknown', 'stone', 'slate', NaN)).toEqual(buildingTint('unknown', 'stone', 'slate', 0.5));
    expect(buildingTint('unknown', 'brick', 'tile', 0.5)).not.toEqual(buildingTint('unknown', 'timber', 'turf', 0.5));
    const m = buildingTint('medina', 'stone', 'stone', 0.5, 'minaret');
    expect(m.wall[0]).toBeGreaterThan(m.wall[2] * 1.25);
  });
});
