import { describe, expect, it } from 'vitest';
import { COUNT_ROLES, CULTURES, cityDebugText, codeBaseline, decodeCityCode, encodeCityCode, formatCode, nextRootSeed, parseCode, rootSeedFromText, settlementKey, settlementNumber } from '../../src/v2/cityCode';
import { candidateParameters, codeParameters, listedParameterKeys } from '../../src/v2/cityCodeParams';
import { levelValue, parameterLevels, readParamId, snapParameter, valueLevel, writeInt, writeParamId } from '../../src/v2/cityCodeFormat';
import { readSettingPath, writeSettingPath } from '../../src/v2/parameterForm';
import { rerollSeed, stepSeed } from '../../../rust/bridge/generationSeed';
import { rerollSettlement } from '../../src/v2/urbanSeeds';
import { automaticCulture, plausibleCultures } from '../../src/v2/environmentCultures';
import { randomInitialSettings } from '../../src/v2/startup';
import { blockAddress, blockEditId, runtimeBlockEdits } from '../../../rust/bridge/urbanBlockEdits';

const same = (code: string) => expect(encodeCityCode(decodeCityCode(code).settings)).toBe(code);

describe('short city code', () => {
  it('is the bare seed for the default city', () => {
    expect(encodeCityCode(codeBaseline())).toBe('magnas');
    expect(decodeCityCode('magnas').settings.options.seed).toBe('magnas');
  });
  it('writes header offsets from the defaults and trims trailing zeros', () => {
    const settings = codeBaseline();
    settings.options.biome = 'desert';
    settings.options.culture = automaticCulture(settings);
    expect(encodeCityCode(settings)).toBe('magnas7');
    settings.runtime!.source = 'neural-wasm';
    settings.generation = 'neural';
    settings.extent = 40000;
    settings.terrain!.coastMask = 16 | 4;
    settings.terrain!.islandMode = 'peninsula';
    const code = encodeCityCode(settings);
    expect(code).toBe('magnas70g4h1');
    const decoded = decodeCityCode(code).settings;
    expect([decoded.options.biome, decoded.runtime?.source, decoded.extent, decoded.terrain?.coastMask, decoded.terrain?.islandMode]).toEqual(['desert', 'neural-wasm', 40000, 20, 'peninsula']);
    expect(decoded.options.culture).toBe(settings.options.culture);
    same(code);
  });
  it('gives a fresh random map a code of at most 10 characters', () => {
    for (let i = 0; i < 40; i++) {
      let n = i;
      const settings = randomInitialSettings(codeBaseline(), () => ((n = (n * 1103515245 + 12345) >>> 0) % 1000) / 1000);
      const code = encodeCityCode(settings);
      expect(code.length).toBeLessThanOrEqual(10);
      expect(plausibleCultures(settings)).toContain(settings.options.culture);
      same(code);
    }
  });
  it('rolls the root seed as seed + 1', () => {
    expect(nextRootSeed('magnas')).toBe('magnat');
    expect(nextRootSeed('00000z')).toBe('000010');
    expect(nextRootSeed('zzzzzz')).toBe('000000');
  });
  it('marks a relief it does not carry', () => {
    const settings = codeBaseline();
    settings.options.importedHeight = { w: 2, h: 2, rgba: new Uint8ClampedArray(16) };
    expect(encodeCityCode(settings)).toBe('magnas*');
    const decoded = decodeCityCode('magnas*-018');
    expect(decoded.reliefMissing).toBe(true);
    expect(decoded.settings.options.importedHeight).toBeUndefined();
    expect(decodeCityCode('magnas').reliefMissing).toBeUndefined();
  });
  it('lists every eligible parameter and quantises values to each parameter domain', () => {
    const listed = new Set(listedParameterKeys());
    expect(candidateParameters().filter(c => !listed.has(c.key)).map(c => c.key)).toEqual([]);
    expect(parameterLevels({ min: 0, max: 1, step: 'any' })).toBe(32);
    expect(parameterLevels({ min: 0, max: 1, step: 0.05 })).toBe(21);
    expect(parameterLevels({ min: 0, max: 10000, step: 25 })).toBe(401);
    const field = { min: 0, max: 1, step: 'any' as const };
    for (let l = 0; l < 32; l++) expect(valueLevel(field, levelValue(field, l))).toBe(l);
    expect(snapParameter(field, 0.5)).toBe(levelValue(field, valueLevel(field, 0.5)));
    for (const id of [0, 30, 31, 400]) expect(readParamId(writeParamId(id), 0)[0]).toBe(id);
    const settings = codeBaseline();
    settings.options.culture = CULTURES[40];
    const fine = [...codeParameters().byKey.values()].find(p => p.scope === 'settings' && p.field.type === 'number' && parameterLevels(p.field) > 32)!;
    writeSettingPath(settings, fine.path, fine.field.fromInput?.(levelValue(fine.field, 37)) ?? levelValue(fine.field, 37));
    const code = encodeCityCode(settings);
    expect(code).toBe(`magnas-018${writeParamId(fine.id)}15`);
    expect(decodeCityCode(code).settings.options.culture).toBe(CULTURES[40]);
    same(code);
  });
  it('round-trips the numbers shown in other units than they are stored in', () => {
    const converted = [...codeParameters().byKey.values()].filter(p => p.scope === 'settings' && p.field.type === 'number' && p.field.toInput);
    expect(converted.map(p => p.key)).toEqual(expect.arrayContaining(['terrain.motifSize', 'terrain.hydrology.lakeCoverage', 'terrain.forest.density']));
    for (const { path, field } of converted) {
      const settings = codeBaseline(),
        value = Number(field.fromInput!(levelValue(field, 3)));
      writeSettingPath(settings, path, value);
      const code = encodeCityCode(settings);
      expect(Number(readSettingPath(decodeCityCode(code).settings, path)), path).toBeCloseTo(value, 6);
      same(code);
    }
  });
  it('keeps the display biome as a parameter', () => {
    const settings = codeBaseline();
    settings.appearance!.biome = 'arctic';
    const code = encodeCityCode(settings);
    expect(code.startsWith(`magnas-${writeParamId(codeParameters().byKey.get('appearance.biome')!.id)}`)).toBe(true);
    expect(decodeCityCode(code).settings.appearance?.biome).toBe('arctic');
  });
  it('stores local reroll iterations, never seeds', () => {
    const settings = codeBaseline();
    settings.options.seed = rerollSeed(rerollSeed(settings.options.seed, ['settle-sites']), ['settle-sites']);
    rerollSettlement(settings, 'site-1');
    const code = encodeCityCode(settings);
    expect(code).toBe(`magnas_i02_${settlementNumber('site-1')}u1`);
    const decoded = decodeCityCode(code).settings;
    expect(stepSeed(decoded.options.seed, 'settle-sites')).toBe(stepSeed(settings.options.seed, 'settle-sites'));
    same(code);
  });
  it('addresses settlement and quarter edits hierarchically, in code order', () => {
    expect(settlementKey(settlementNumber('site-3')!)).toBe('site-3');
    const settings = codeBaseline();
    settings.local['main'] = { culture: CULTURES[5] as never, population: 4000 };
    settings.urban = { backend: 'rust', local: { main: { layout: { overrides: { quarters: { '4': { salt: 8 } } } } as never } } };
    settings.region = { demography: { population: 50000 } };
    const code = encodeCityCode(settings);
    expect(code).toMatch(/^magnas_o0[0-9a-z]+_0o3x0l0[0-9a-z]{2}_0\.4u8$/);
    same(code);
    expect(formatCode(parseCode('magnas_c.4u8_cl005ic3!0g00h0'))).toBe('magnas_c.4u8_cl005ic3!0g00h0');
  });
  it('names quarter and block edits by their position in the plan', () => {
    const square = (x: number) => ({ outer: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 1 }], holes: [] });
    const layout = { key: 'main', blocks: [{ quarter: 2, shape: square(0) }, { quarter: 4, shape: square(2) }, { quarter: 4, shape: square(4) }] } as never;
    const saved = blockEditId(layout, (layout as { blocks: { shape: never }[] }).blocks[2].shape);
    const settings = codeBaseline();
    settings.urban = {
      backend: 'rust',
      local: { main: { layout: { overrides: { quarters: { '4': { tissue: 'grid', culture: CULTURES[40], salt: 2 } } } } as never, parcels: { overrides: { blocks: { [saved]: { salt: 1, operator: 'strips' } } } } as never } },
    };
    expect(encodeCityCode(settings)).not.toContain('0.4.1');
    const code = encodeCityCode(settings, (_key, key) => blockAddress(layout, key));
    expect(code).toMatch(/_0\.4u2l018.+_0\.4\.1u1l/);
    const main = decodeCityCode(code).settings.urban!.local!.main;
    expect(main.layout!.overrides!.quarters!['4']).toEqual({ tissue: 'grid', culture: CULTURES[40], salt: 2 });
    expect(main.parcels!.overrides!.blocks).toEqual({ 'block:4.1': { salt: 1, operator: 'strips' } });
    expect(runtimeBlockEdits(main.parcels as never, [layout]).overrides!.blocks).toEqual({ '2': { salt: 1, operator: 'strips' } });
    same(code);
  });
  it('encodes custom places as settlement edits', () => {
    const settings = codeBaseline();
    settings.region = { customPlaces: [{ key: 'place-3', name: '', population: 1200, culture: CULTURES[7], siteType: 'harbor', sitePrefs: {}, position: { x: 2500, y: 4100 } }] };
    const code = encodeCityCode(settings);
    expect(code).toMatch(new RegExp(`^magnas_${writeInt(settlementNumber('place-3')!)}~[0-9a-z]{11}$`));
    const place = decodeCityCode(code).settings.region!.customPlaces![0];
    expect([place.key, place.position, place.culture, place.siteType]).toEqual(['place-3', { x: 2500, y: 4100 }, CULTURES[7], 'harbor']);
    expect(Math.abs(place.population - 1200) / 1200).toBeLessThan(0.02);
    same(code);
  });
  it('encodes per-town building counts and their mode', () => {
    const settings = codeBaseline();
    const [first, second] = COUNT_ROLES;
    settings.urban = { backend: 'rust', local: { 'site-1': { layout: { programme: { counts: { [second]: 3, [first]: 0 }, countMode: 'force' } } as never } } };
    const code = encodeCityCode(settings);
    expect(code).toBe(`magnas_${writeInt(settlementNumber('site-1')!)}K100000103`);
    const programme = decodeCityCode(code).settings.urban?.local?.['site-1']?.layout?.programme as { counts?: Record<string, number>; countMode?: string };
    expect(programme).toMatchObject({ counts: { [first]: 0, [second]: 3 }, countMode: 'force' });
    same(code);
  });
  it('appends pins at a fixed width and restores their texts from the debug text', () => {
    const settings = codeBaseline();
    settings.pins = [{ x: 1200, y: 3400, text: 'North gate' }, { x: 5, y: 6 }];
    const code = encodeCityCode(settings);
    expect(code).toBe('magnas!15g3a8005006');
    const debug = cityDebugText(settings, 'abc123');
    expect(debug.split('\n')).toEqual([code, 'abc123 · page v2', '#1 x=1200 y=3400 North gate', '#2 x=5 y=6']);
    expect(decodeCityCode(debug).settings.pins).toEqual([{ x: 1200, y: 3400, text: 'North gate' }, { x: 5, y: 6 }]);
  });
  it('rejects malformed codes and normalises typed seeds', () => {
    expect(() => decodeCityCode('magnas_')).toThrow();
    expect(() => decodeCityCode('magnas!123')).toThrow();
    expect(rootSeedFromText('Lions Out')).toBe('110ns0');
    expect(rootSeedFromText('ab')).toMatch(/^ab[0-9a-hjkmnp-tv-z]{4}$/);
  });
});
