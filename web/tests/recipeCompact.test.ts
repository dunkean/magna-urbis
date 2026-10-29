import { describe, expect, it } from 'vitest';
import { decodeRecipe, encodeRecipe } from '../src/ui/recipe';
import { decodeCompact, encodeCompact } from '../src/ui/recipeCodec';
import { encodeSituation, decodeSituation } from '../src/ui/citySituation';
import { generationRecipe, restoreRecipe } from '../src/ui/recipeSharing';
import defaults from '../src/ui/recipeDefaults.json';
import { defaultLayoutConfig, defaultParcelConfig, normalizeLayoutConfig } from '../../rust/bridge/urbanConfig';
import type { Decor } from '../src/ui/decor';

const query = (urban: unknown = defaults.cityQuery.urban) => new URLSearchParams(Object.entries({...defaults.cityQuery, urban}).map(([k,v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])).toString();
const settings = (code: string) => JSON.parse(new URLSearchParams(decodeRecipe(code).query).get('urban')!);
const decor = (id = defaults.cityQuery.artifact): Decor => ({ meta: { id, seed: '42', width: 2000 } } as Decor);

describe('MU2 sparse recipes', () => {
  it('stores a default city in a few dozen characters and grows with explicit changes', () => {
    const base = encodeRecipe({ stage: 'city', query: query() });
    const changed = structuredClone(defaults.cityQuery.urban); changed.layoutConfig.density = 1.2;
    const one = encodeRecipe({ stage: 'city', query: query(changed) });
    changed.layoutConfig.footprint.aspect = 2;
    changed.layoutConfig.programme.period = 'Edo';
    const more = encodeRecipe({ stage: 'city', query: query(changed) });
    expect(base.length).toBeLessThan(45); expect(one.length).toBeGreaterThan(base.length); expect(more.length).toBeGreaterThan(one.length);
    expect(settings(one).layoutConfig.density).toBe(1.2);
    expect(settings(base)).toEqual(defaults.cityQuery.urban);
  });
  it('rehydrates the complete current defaults before historical normalizers see them', () => {
    const urban = { ...structuredClone(defaults.cityQuery.urban), layoutConfig: defaultLayoutConfig(), parcelConfig: defaultParcelConfig() };
    const restored = settings(encodeRecipe({ stage: 'city', query: query(urban) }));
    expect(restored.layoutConfig).toEqual(defaultLayoutConfig());
    expect(normalizeLayoutConfig(restored.layoutConfig, true)).toEqual(normalizeLayoutConfig(urban.layoutConfig, true));
    expect(restored.layoutConfig.footprint.cohesion).toBe(0.85);
  });
  it.each(['french-organic', 'roman-core', 'japanese', 'dwarven', 'drow-enclave'])('preserves explicit culture and inheritance for %s', culture => {
    const urban = structuredClone(defaults.cityQuery.urban); urban.layoutConfig.culture = culture;
    const restored = settings(encodeRecipe({ stage: 'city', query: query(urban) }));
    expect(restored.layoutConfig.culture).toBe(culture); expect(restored.parcelConfig.culture).toBe('site');
  });
  it('preserves null, false, zero, missing fields, unknown data and exact coordinates', () => {
    const base = { zero: 1, nullable: 4, flag: true, removed: 'present', nested: { name: 'default', list: [1,2] } };
    const value = { zero: 0, nullable: null, flag: false, nested: { name: 'café 🗺', list: [1,2,3] }, unknown: { x: 102.123456789, y: -54.321 } };
    expect(decodeCompact(encodeCompact(value, base, 'MU2.'), base, 'MU2.')).toEqual(value);
    const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":"own value"}');
    const decoded = decodeCompact(encodeCompact(hostile, {}, 'MU2.'), {}, 'MU2.');
    expect(decoded).toEqual(hostile); expect(({} as any).polluted).toBeUndefined();
  });
  it('encodes workshop JSON as differences instead of transmitting its base64 text', () => {
    const state = defaults.query.workshop.__base64json;
    const encoded = Buffer.from(JSON.stringify(state)).toString('base64url');
    const code = encodeRecipe({ stage: 'urban', query: new URLSearchParams({ space: 'workshop', workshop: encoded }).toString() });
    expect(code.length).toBeLessThan(70);
    expect(JSON.parse(Buffer.from(new URLSearchParams(decodeRecipe(code).query).get('workshop')!, 'base64url').toString())).toEqual(state);
  });
  it('rejects old formats, bit corruption, trailing bytes and excessive input', () => {
    const code = encodeRecipe({ stage: 'city', query: query() });
    expect(() => decodeRecipe('MU.AAAA')).toThrow(); expect(() => decodeRecipe('MU1.AAAA')).toThrow();
    for (let i = 4; i < code.length; i++) {
      const corrupted = code.slice(0,i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i+1);
      expect(() => decodeRecipe(corrupted)).toThrow();
    }
    expect(() => decodeRecipe(code+'AAAA')).toThrow();
    expect(() => encodeRecipe({ stage: 'city', query: 'unknown='+ 'x'.repeat(1024*1024) })).toThrow('volumineux');
  });
  it('shares catalogue settings without reading cold chunks or terrain arrays', async () => {
    const source = decor(); Object.defineProperty(source, 'raster', { get: () => { throw new Error('must not read geometry'); } });
    const recipe = await generationRecipe('city', query(), source);
    expect(recipe.decor).toBeUndefined(); expect(recipe.terrain).toBeUndefined();
    const restored = await restoreRecipe(decodeRecipe(encodeRecipe(recipe)));
    expect(restored.stage).toBe(recipe.stage);
    const parse = (q: string) => Object.fromEntries([...new URLSearchParams(q)].map(([k,v]) => { try {return [k,JSON.parse(v)]} catch {return [k,v]} }));
    expect(parse(restored.query)).toEqual(parse(recipe.query));
  });
  it('reconstructs local terrain from its recipe and keeps all geometry out of the code', async () => {
    const source = decor('local'); source.meta.regeneration = { query: 'seed=42&width=2400&profile=local', crops: [{x:100,y:200,width:2000}] };
    const recipe = await generationRecipe('city', 'artifact=local&urban='+encodeURIComponent(JSON.stringify(defaults.cityQuery.urban)), source);
    expect(recipe.decor).toBeUndefined(); expect(recipe.stage).toBe('settlements');
    expect(recipe.terrain!.meta.settlements).toEqual([]); expect(recipe.terrain!.meta.roads).toBeNull();
    expect(recipe.terrain!.crops).toEqual(source.meta.regeneration.crops);
    expect(recipe.terrain!.query).not.toContain('profile');
    const restored = decodeRecipe(encodeRecipe(recipe));
    expect(restored.stage).toBe(recipe.stage);
    expect(restored.terrain!.crops).toEqual(recipe.terrain!.crops);
    expect(Object.fromEntries(new URLSearchParams(restored.terrain!.query))).toEqual(Object.fromEntries(new URLSearchParams(recipe.terrain!.query)));
    await expect(generationRecipe('city', 'artifact=imported', decor('imported'))).rejects.toThrow('export complet .decor');
  });
  it('round-trips camera, notes and pins using the same format without a timestamp', async () => {
    const situation = { v: 1 as const, q: query(), pins: [{ x: 123.123456789, y: 5, note: 'café, toit ; 🏠' }], view: {cx:100,cy:200,scale:0.4123}, note:'Observation' };
    const code = await encodeSituation(situation);
    const restored = await decodeSituation('https://example.com/citybench.html?situation='+code);
    expect(restored.pins).toEqual(situation.pins); expect(restored.view).toEqual(situation.view); expect(restored.note).toBe(situation.note);
    expect(restored.created).toBeUndefined(); expect(settings(code)).toEqual(defaults.cityQuery.urban);
  });
});
