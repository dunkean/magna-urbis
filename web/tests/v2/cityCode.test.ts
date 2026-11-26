import { describe, expect, it } from 'vitest';
import { COUNT_ROLES, CULTURES, cityCodeUrl, cityDebugText, codeBaseline, decodeCityCode, encodeCityCode, formatCode, nextRootSeed, parseCode, rootSeedFromText, settlementKey, settlementNumber } from '../../src/v2/cityCode';
import { candidateParameters, codeParameters, listedParameterKeys } from '../../src/v2/cityCodeParams';
import { FREE_LEVELS, levelStep, levelValue, parameterLevels, readParamId, snapParameter, valueLevel, writeInt, writeParamId } from '../../src/v2/cityCodeFormat';
import { NOT_IN_CODE } from '../../src/v2/cityCodeRecords';
import { readSettingPath, writeSettingPath } from '../../src/v2/parameterForm';
import { rerollSeed, stepSeed } from '../../../rust/bridge/generationSeed';
import { rerollSettlement } from '../../src/v2/urbanSeeds';
import { automaticCulture, plausibleCultures } from '../../src/v2/environmentCultures';
import { randomInitialSettings } from '../../src/v2/startup';
import { blockAddress, blockEditId, runtimeBlockEdits } from '../../../rust/bridge/urbanBlockEdits';
import { effectiveRegionalExits } from '../../src/v2/regionalExits';
import { renameToponym } from '../../src/v2/toponymOverrides';

const same = (code: string) => expect(encodeCityCode(decodeCityCode(code).settings)).toBe(code);
const outline = (x: number, y: number) => ({
  outer: [
    { x, y },
    { x: x + 6.5, y },
    { x: x + 6.5, y: y + 7 },
    { x, y: y + 7 },
  ],
});

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
    expect(
      candidateParameters()
        .filter(c => !listed.has(c.key))
        .map(c => c.key),
    ).toEqual([]);
    expect(parameterLevels({ min: 0, max: 1, step: 'any' })).toBe(FREE_LEVELS);
    expect(FREE_LEVELS).toBe(32);
    expect(parameterLevels({ min: 0, max: 1, step: 0.05 })).toBe(21);
    expect(parameterLevels({ min: 0, max: 10000, step: 25 })).toBe(401);
    const field = { min: 0, max: 1, step: 'any' as const };
    // Each slider position (a multiple of levelStep) is one level and comes back unchanged.
    for (let l = 0; l < FREE_LEVELS; l++) {
      expect(valueLevel(field, levelValue(field, l))).toBe(l);
      expect(snapParameter(field, l * levelStep(field)!)).toBe(levelValue(field, l));
    }
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
    const square = (x: number) => ({
      outer: [
        { x, y: 0 },
        { x: x + 1, y: 0 },
        { x: x + 1, y: 1 },
      ],
      holes: [],
    });
    const layout = {
      key: 'main',
      blocks: [
        { quarter: 2, shape: square(0) },
        { quarter: 4, shape: square(2) },
        { quarter: 4, shape: square(4) },
      ],
    } as never;
    const saved = blockEditId(layout, (layout as { blocks: { shape: never }[] }).blocks[2].shape);
    const settings = codeBaseline();
    settings.urban = { backend: 'rust', local: { main: { layout: { overrides: { quarters: { '4': { tissue: 'grid', culture: CULTURES[40], salt: 2 } } } } as never, parcels: { overrides: { blocks: { [saved]: { salt: 1, operator: 'strips' } } } } as never } } };
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
  it('restores lot edits and house models by their saved ids', () => {
    const lot = 'layout-0123456789abcdef/block-fedcba9876543210/parcel-00112233445566ff';
    const neighbour = 'layout-0123456789abcdef/block-fedcba9876543210/parcel-a0b1c2d3e4f5a6b7';
    const outline = {
      outer: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    const parcels = { [lot]: { role: 'market', households: 2, enclosure: 'hedge', salt: 4, culture: CULTURES[3], houseConfig: { allow_late: true, overrides: { overhang_m: 0.35, footprint: null } } }, [neighbour]: { deleted: 'garden' } };
    const settings = codeBaseline();
    settings.urban = {
      backend: 'rust',
      houses: { house_config: { pack: 'EUR-MED', variation: 0.35 } } as never,
      buildings: { [`main/${lot}/building`]: { culture: CULTURES[3], recipe: 'EUR-MED-TOWNHOUSE', overrides: { roof: 'RF-HIP', floors: 3, roof_pitch_deg: -12.5 } } as never },
      local: { main: { parcels: { overrides: { parcels } } as never, layout: { overrides: { quarters: { '2': { salt: 1, houseConfig: { era: 'late' }, parts: [outline] } } } } as never } },
    };
    const code = encodeCityCode(settings);
    const urban = decodeCityCode(code).settings.urban!;
    expect(urban.local!.main.parcels!.overrides!.parcels).toEqual(parcels);
    expect(urban.buildings).toEqual(settings.urban.buildings);
    expect(urban.houses?.house_config).toEqual({ pack: 'EUR-MED', variation: 0.35 });
    expect(urban.local!.main.layout!.overrides!.quarters!['2']).toEqual({ salt: 1, houseConfig: { era: 'late' }, parts: [outline] });
    same(code);
    // A second lot of the same block costs its own hash and value, not a whole id again.
    delete (settings.urban.local!.main.parcels!.overrides!.parcels as Record<string, unknown>)[neighbour];
    expect(code.length - encodeCityCode(settings).length).toBeLessThan(40);
  });
  it('round-trips a quarter outline and split with holes and edits of split pieces', () => {
    const settings = codeBaseline();
    const quarters = {
      '2': { shape: { ...outline(4200.5, 18), holes: [outline(4201.5, 19).outer.slice(0, 2).concat({ x: 4202.5, y: 20 })] }, role: 'elite' },
      '4': { parts: [outline(70, 70), outline(76.5, 70)], deletedParts: [0], wealth: 0.27 },
      '4/1': { deleted: true, buildingCulture: CULTURES[7] },
    };
    settings.urban = { backend: 'rust', local: { main: { layout: { overrides: { quarters } } } } };
    const code = encodeCityCode(settings);
    expect(decodeCityCode(code).settings.urban!.local!.main.layout!.overrides!.quarters).toEqual(quarters);
    expect(code.length).toBeLessThan(JSON.stringify(quarters).length / 2);
    same(code);
  });
  it('round-trips block geometry by source position or saved id, with a split child edit', () => {
    const settings = codeBaseline(),
      source = 'block:0123456789abcdef',
      renamedSource = 'block:2.4';
    const blocks = { 'block:0123456789abcdff': { shape: outline(58, 73) }, [source]: { parts: [outline(58, 80), outline(64.5, 80)], deletedParts: [0] }, [`${source}/1`]: { salt: 3, operator: 'strips' as const } };
    settings.urban = { backend: 'rust', local: { main: { parcels: { overrides: { blocks } } } } };
    const withoutPlan = encodeCityCode(settings);
    expect(decodeCityCode(withoutPlan).settings.urban!.local!.main.parcels!.overrides!.blocks).toEqual(blocks);
    same(withoutPlan);
    const code = encodeCityCode(settings, (town, id) => (town === 'main' && id === source ? [2, 4] : undefined));
    expect(decodeCityCode(code).settings.urban!.local!.main.parcels!.overrides!.blocks).toEqual({ 'block:0123456789abcdff': blocks['block:0123456789abcdff'], [renamedSource]: blocks[source], [`${renamedSource}/1`]: blocks[`${source}/1`] });
    same(code);
  });
  it('keeps a redrawn block exact for its regenerated lots and buildings, without extending independent codes', () => {
    const settings = codeBaseline(),
      block = 'block:2.0',
      lot = 'layout-a/block-b/parcel-c';
    const shape = outline(-0.25, 703.123456789);
    const blocks = { [block]: { shape } };
    settings.urban = { local: { main: { parcels: { overrides: { blocks } } } } };
    const blockOnly = encodeCityCode(settings);
    expect(blockOnly).not.toContain('X');
    const house = { recipe: 'EUR-MED-TOWNHOUSE' };
    settings.urban.buildings = { [`site-1/${lot}/building`]: house };
    expect(encodeCityCode(settings)).not.toContain('X');
    settings.urban.buildings = { [`main/${lot}/building`]: house };
    const code = encodeCityCode(settings);
    expect(decodeCityCode(code).settings.urban!.local!.main.parcels!.overrides!.blocks![block].shape).toEqual(shape);
    same(code);
    delete settings.urban.buildings;
    expect(encodeCityCode(settings)).toBe(blockOnly);
  });
  it('round-trips lot outlines and splits on a half-metre grid', () => {
    const settings = codeBaseline(),
      first = 'layout-0123456789abcdef/block-fedcba9876543210/parcel-00112233445566ff',
      second = 'layout-0123456789abcdef/block-fedcba9876543210/parcel-a0b1c2d3e4f5a6b7';
    const retained = { [first]: { shape: outline(40.5, 901), role: 'market' }, [second]: { parts: [outline(40.5, 908), outline(47, 908)] }, [`${second}/part-1`]: { deleted: 'garden' as const } };
    const parcels = { ...retained, [first]: { ...retained[first], shape: outline(40.58, 900.91) } };
    settings.urban = { backend: 'rust', local: { main: { parcels: { overrides: { parcels } } } } };
    const code = encodeCityCode(settings);
    expect(decodeCityCode(code).settings.urban!.local!.main.parcels!.overrides!.parcels).toEqual(retained);
    same(code);
  });
  it('preserves authored map, settlement and feature names through share links', () => {
    const settings = codeBaseline();
    settings.naming = { title: 'Pays de l’Orne', labels: { 'free:gate': { text: 'ここ', anchor: { x: 45.25, y: 66 }, kind: 'free' } } };
    renameToponym(settings, { id: 'settlement:main', town: 'main' }, 'Mont-des-Érables');
    renameToponym(settings, { id: 'quarter:main:4', kind: 'quarter' }, 'حي النهر');
    settings.region = { customPlaces: [{ key: 'place-2', name: 'Port des Îles', population: 1200, culture: CULTURES[7], siteType: 'harbor', sitePrefs: {}, position: { x: 2500, y: 4100 } }] };
    const code = encodeCityCode(settings);
    const decoded = decodeCityCode(cityCodeUrl(code, 'https://example.org/v2.html')).settings;
    expect(decoded.naming).toEqual(settings.naming);
    expect(decoded.region?.customPlaces?.[0].name).toBe('Port des Îles');
    same(code);
  });
  it('appends pin texts while keeping the position-only code unchanged', () => {
    const settings = codeBaseline();
    settings.pins = [
      { x: 1200, y: 3400, text: 'Porte du Nord 北' },
      { x: 5, y: 6 },
    ];
    const code = encodeCityCode(settings);
    expect(code).toMatch(/^magnas!15g3a8005006:/);
    expect(decodeCityCode(code).settings.pins).toEqual(settings.pins);
    const debug = cityDebugText(settings, 'abc123');
    expect(debug.split('\n')).toEqual([code, 'abc123 · page v2', '#1 x=1200 y=3400 Porte du Nord 北', '#2 x=5 y=6']);
    expect(decodeCityCode(debug).settings.pins).toEqual(settings.pins);
    expect(decodeCityCode(debug + ' Edited debug line').settings.pins).toEqual(settings.pins);
    expect(decodeCityCode(debug.replace(code, 'magnas!15g3a8005006')).settings.pins).toEqual(settings.pins);
    same(code);
    delete settings.pins[0].text;
    expect(encodeCityCode(settings)).toBe('magnas!15g3a8005006');
  });
  it('restores regional and rural road sources, town street edits and exit requests exactly', () => {
    const settings = codeBaseline(),
      a = { x: 154.12345678901234, y: 207.1125 },
      b = { x: 912.0005, y: 122.04 },
      path = [a, b],
      street = { path, widths: [4.5, 4], role: 'lane', rank: 3 };
    settings.region = { roads: { exits: { highway: 0, main: 1, local: 0, track: 0 } } };
    settings.roadOverrides = {
      routes: { 'region:154123,207113/912001,122040': [], 'rural:154123,207113/912001,122040': [{ path, cls: 'track', width: 2.3, sites: ['site-1', null] }], 'draw:new': [{ path, controls: path, cls: 'main', width: 9, routingVariant: 1 }] },
      towns: { main: [{ id: 'main:41a9', layout: 'main', original: street, parts: [{ street, part: '1', editorId: 'draw:1', controls: path, controlIndices: [0, 1], routingVariant: 2 }] }] },
      exits: { 'test-exit': { present: true, report: { requested: 'main', class: 'main', gateway: 'main', point: b, reason: null, connected: false } } },
      fromDisabled: true,
    };
    const code = encodeCityCode(settings);
    const restored = decodeCityCode(code).settings;
    expect(restored.roadOverrides).toEqual(settings.roadOverrides);
    expect(restored.region?.roads).toEqual(settings.region.roads);
    expect(effectiveRegionalExits(restored)).toEqual({ highway: 0, main: 1, local: 0, track: 0 });
    expect(code.length).toBeLessThan(JSON.stringify(settings.roadOverrides).length);
    same(code);
  });
  it('restores sparse wall overrides by enclosure key', () => {
    const settings = codeBaseline();
    const walls = { 'outer-0': { present: false }, 'inner-1': { style: 'palisade' as const, moat: 'dry' as const, gates: 0 }, castle: { present: true, gates: 64 } };
    settings.urban = { backend: 'rust', local: { 'site-2': { layout: { overrides: { walls } } } } };
    const code = encodeCityCode(settings);
    expect(decodeCityCode(code).settings.urban!.local!['site-2'].layout!.overrides!.walls).toEqual(walls);
    same(code);
  });
  it('rejects malformed codes and normalises typed seeds', () => {
    expect(() => decodeCityCode('magnas_')).toThrow();
    expect(() => decodeCityCode('magnas!123')).toThrow();
    expect(() => decodeCityCode('magnas:zekw')).toThrow('Incomplete or corrupt code.');
    expect(Object.keys(NOT_IN_CODE)).toEqual(['relief', 'rivers', 'seeds']);
    expect(rootSeedFromText('Lions Out')).toBe('110ns0');
    expect(rootSeedFromText('ab')).toMatch(/^ab[0-9a-hjkmnp-tv-z]{4}$/);
  });
});
