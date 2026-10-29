import { describe, expect, it } from 'vitest';
import { decodeRecipe, encodeRecipe, RECIPE_STAGES } from '../src/ui/recipe';
import defaults from '../src/ui/recipeDefaults.json';
const defaultQuery = Object.fromEntries(Object.entries(defaults.query).map(([k,v]) => [k, k === 'workshop' || k === 'case' ? btoa(JSON.stringify((v as any).__base64json)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '') : typeof v === 'string' ? v : JSON.stringify(v)]));
const semantic = (q: string) => Object.fromEntries([...new URLSearchParams(q)].map(([k,v]) => { try { return [k, JSON.parse(v)]; } catch { return [k,v]; } }));

const state = {
  seed: 'débug 🗺', width: '2400', relief: 'hills', compute: 'wasm', generation: 'cpu', auto: '0',
  settlements: JSON.stringify({ config: { mode: 'list', main: { population: 300, culture: 'french-organic' }, list: [{ key: 'a', position: { x: 102.123456789, y: 567 }, name: 'Saint-Pierre' }] }, enabled: true }),
  roads: JSON.stringify({ enabled: false, config: { level: 'regional' } }),
  urban: JSON.stringify({ enabled: false, parcelEnabled: false, quarterSeed: 'a', parcelSeed: 'b', layoutConfig: { customProperty: [1, 2.123456789] } }),
  pins: '123.4,567.8,caf%C3%A9%20%26%20roof%3B%20odd', view: '800.2,900.1,0.4123', showPins: '0',
  futureProperty: '{"unknown":true}', aString: '"123"', notCanonicalJson: ' { "x": 2 } ', empty: '',
};
const query = new URLSearchParams(state).toString();

describe('portable map recipes', () => {
  it('keeps the ordinary default recipe extremely short without dropping any properties', () => {
    const code = encodeRecipe({ stage: 'terrain', query: new URLSearchParams(defaultQuery).toString() });
    expect(code.length).toBeLessThan(100);
    expect(semantic(decodeRecipe(code).query)).toEqual(semantic(new URLSearchParams(defaultQuery).toString()));
  });
  it.each(RECIPE_STAGES)('round-trips every property for %s, including Unicode and unknown properties', stage => {
    const code = encodeRecipe({ stage, query });
    expect(code).toMatch(/^MU2\.[\w-]+$/);
    const decoded = decodeRecipe(code);
    expect(decoded.stage).toBe(stage);
    expect(semantic(decoded.query)).toEqual(semantic(query));
    expect(decoded.decor).toBeUndefined();
    expect(code.length).toBeLessThan(query.length * .7);
  });

  it('is deterministic regardless of parameter order and accepts chat line wrapping', () => {
    const a = encodeRecipe({ stage: 'terrain', query });
    const b = encodeRecipe({ stage: 'terrain', query: new URLSearchParams(Object.entries(state).reverse()).toString() });
    expect(a).toBe(b);
    expect(decodeRecipe(`\n ${a.match(/.{1,60}/g)!.join('\r\n')} \n`)).toEqual(decodeRecipe(a));
  });

  it('keeps complete data out of codes, and preserves duplicate query keys', () => {
    expect(() => encodeRecipe({ stage: 'city', query: '', decor: new Uint8Array(1000) })).toThrow('export complet');
    const decoded = decodeRecipe(encodeRecipe({ stage: 'city', query: 'a=1&a=2' }));
    expect(new URLSearchParams(decoded.query).getAll('a')).toEqual(['1', '2']);
  });

  it('round-trips the upstream terrain recipe and successive crops without raster samples', () => {
    const terrain = { query: 'seed=42&width=2400', crops: [{ x: 100, y: 200, width: 1200 }, { x: 0, y: 0, width: 500 }],
      meta: { id: 'crop', query: 'seed=42&width=2400', label: 'Découpe' } } as any;
    const code = encodeRecipe({ stage: 'settlements', query: 'artifact=crop', terrain });
    expect(decodeRecipe(code)).toEqual({ stage: 'settlements', query: 'artifact=crop', terrain });
  });

  it('rejects malformed, truncated and damaged codes with a useful error', () => {
    const code = encodeRecipe({ stage: 'urban', query });
    for (const bad of ['', 'https://example.com/', 'MU2.!!!!', code.slice(0, -8), code.slice(0, -5) + 'AAAAA', 'MU2.AAAA']) {
      expect(() => decodeRecipe(bad)).toThrow(/Code/);
    }
  });
});
