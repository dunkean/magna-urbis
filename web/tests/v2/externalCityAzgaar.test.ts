import { describe, expect, it } from 'vitest';
import { parseAzgaarBurg } from '../../src/v2/externalCity/azgaar';
import { FMG_BASE_CULTURES, muCultureForFmg, pickMuCulture } from '../../src/v2/externalCity/azgaarTables';
import cityCodeDefaults from '../../src/v2/cityCodeDefaults.json';

/** A culture drawn among pool (the draw itself is seeded per town). */
const oneOf = (pool: readonly string[]) => expect.stringMatching(new RegExp(`^(${pool.join('|')})$`));
import { FMG_EXPORT_SCRIPT } from '../../src/v2/externalCity/fmgExport';
import { decodeCityCode, UNRECOGNISED_INPUT } from '../../src/v2/cityCode';
import { fmgOceanShore } from '../../src/v2/externalCity/fmgShore';
import { fmgCityNetwork } from '../../src/v2/externalCity/fmgNetwork';
import { rasterizeCoastTrace } from '../../src/v2/coastTrace';
import { cityEmbedSettings } from '../../src/v2/cityEmbedGeneration';
import { effectiveTerrainSettings } from '../../src/v2/terrainSettings';

const HEADER =
  'Id,Burg,Province,Province Full Name,State,State Full Name,Culture,Religion,Group,Type,Population,Market,Product,Wealth,Prosperity,Balance,Adjustments,X,Y,Latitude,Longitude,Elevation (ft),Temperature,Temperature likeness,Capital,Port,Citadel,Walls,Plaza,Temple,Shanty Town,Emblem,Preview link,Tags';
const LINK = 'https://watabou.github.io/city-generator/?name=Ulmdorf&population=12345&size=31&seed=4815162342&river=1&coast=0&farms=1&citadel=1&urban_castle=0&hub=1&plaza=1&greens=1&temple=1&walls=1&shantytown=0&style=natural';
const ROW = `7,Ulmdorf,Ulmia,"Margraviate of Ulmia, North",Shwazenland,Kingdom of Shwazenland,Shwazen,Old Faith,city,River,12345,,0,0,,0,,512.3,300.1,48.2,10.1,1968,70°F,Germany,capital,,citadel,walls,plaza,temple,,"{t1:gules;ordinary:[]}",${LINK},"trade, old"`;

describe('parseAzgaarBurg', () => {
  it('imports the town-bank river and main land roads in the same local frame', () => {
    const cells = { r: [1], area: [16], p: [[0, 0]] as [number, number][], routes: { 0: { 1: 2, 2: 3 } } };
    const river = { i: 1, width: 0.04, cells: [0], points: [[-8, 0.2], [0, 0.15], [8, 0.3]] as [number, number][] };
    const network = fmgCityNetwork({ cells, rivers: [river], routes: [
      { i: 2, group: 'roads', points: [[0, -8, 1], [0, 0, 0], [0, 8, 4]] },
      { i: 3, group: 'trails', points: [[-8, -8, 2], [0, 0, 0]] },
    ] }, 0, 0, 0);
    expect(network.roads).toHaveLength(1);
    const hints = parseAzgaarBurg(JSON.stringify({ format: 'fmg-burg-v1', i: 1, name: 'Crossing', population: 2500, river: true, network }))!;
    const preview = cityEmbedSettings(hints, false);
    expect(preview.terrain?.importedRiver?.width).toBeGreaterThan(15);
    const riverPath = preview.terrain!.importedRiver!.points;
    expect(riverPath.length).toBeGreaterThan(network.river!.points.length * 2);
    expect(riverPath[0][0]).toBe(0);
    expect(riverPath.at(-1)![0]).toBe(1);
    expect(riverPath.find(([x]) => Math.abs(x - 0.5) < 0.02)![1]).toBeGreaterThan(0.54);
    const road = preview.roadOverrides!.routes!['draw:fmg-0'][0];
    expect(road.path).toContainEqual({ x: 900, y: 900 });
    expect(road.path.some(p => p.y > 1640 && p.y < 1790 && Math.abs(p.x - 900) > 3)).toBe(true);
    expect(road.path.at(-1)).toMatchObject({ x: 900, y: 1800 });
    expect(preview.region?.roads?.exits).toEqual({ highway: 0, main: 0, local: 0, track: 0 });
  });
  it('traces a multi-edge ocean shore with a dry burg and preserves its scale in the iframe', () => {
    const p: [number, number][] = [[-5, -2], [-3, -1], [0, 0], [3, 1.3], [5, 2], [5, 6], [-5, 6]];
    const graph = {
      cells: { t: [1, -1], haven: [1, 0], f: [0, 1], area: [16, 16], p: [[0, 0.8], [1, -2]] as [number, number][] },
      vertices: { p, c: p.map((_, i) => i < 5 ? [0, 1] : [0]) },
      features: [{ type: 'island', vertices: p.map((_, i) => i) }, { type: 'ocean', vertices: [] }],
    };
    const coast = fmgOceanShore(graph, 0, 0, 0.8)!;
    expect(coast.shore.points).toHaveLength(7);
    expect(coast.sea).toBeGreaterThan(0.35);
    expect(coast.sea).toBeLessThan(0.45);
    const input = { format: 'fmg-burg-v1', i: 6, name: 'Harbour', port: true, population: 2500, coast };
    const hints = parseAzgaarBurg(JSON.stringify(input))!;
    const studio = decodeCityCode(JSON.stringify(input)).settings, preview = cityEmbedSettings(hints, false);
    expect(preview.region?.placement?.list?.[0]).toMatchObject({ population: 2500, position: { x: 900, y: 900 }, siteType: 'harbor' });
    expect(studio.terrain?.coastTrace).toEqual(preview.terrain?.coastTrace);
    const mask = rasterizeCoastTrace(preview.terrain!.coastTrace!, 40);
    expect(mask[20 * 40 + 20]).toBe(0);
    expect(mask[3 * 40 + 30]).toBe(1);
    expect(mask[35 * 40 + 12]).toBe(0);
    expect(effectiveTerrainSettings(preview, 1800).islandMode).toMatch(/^traced:/);
    graph.features[1].type = 'lake';
    expect(fmgOceanShore(graph, 0, 0, 0.8)).toBeUndefined();
  });
  it('reads an FMG Burgs overview CSV row and keeps the watabou link seed', () => {
    const hints = parseAzgaarBurg(`\ufeff${HEADER}\r\n${ROW}\r\n`);
    expect(hints).toMatchObject({
      source: 'azgaar-burg',
      seed: 'mfcg-4815162342',
      name: 'Ulmdorf',
      population: 12345,
      river: 'river',
      coast: 'none',
      capital: true,
      port: false,
      citadel: true,
      walls: true,
      plaza: true,
      temple: true,
      shantytown: false,
      roads: 4,
      farms: true,
      relief: 'hills',
      culture: oneOf(FMG_BASE_CULTURES.German),
      language: 'german',
    });
    expect(hints?.biome).toBeUndefined(); // 70 °F = 21 °C: no clear biome
  });

  it('reads a burg JSON object with FMG population units', () => {
    const json = JSON.stringify({ i: 3, cell: 1200, x: 10, y: 20, name: "Qal'at Sabr", culture: 'Eurabic', population: 2.6, capital: 0, port: 4, citadel: 1, walls: 0, plaza: 1, temple: 1, shanty: 0, type: 'Naval', tags: [] });
    expect(parseAzgaarBurg(json)).toMatchObject({ source: 'azgaar-burg', seed: 'fmg-3-qal-at-sabr', name: "Qal'at Sabr", population: 2600, port: true, coast: 'random', citadel: true, walls: false, culture: oneOf(FMG_BASE_CULTURES.Arabic), language: 'arabic' });
    const numericCulture = parseAzgaarBurg(JSON.stringify({ i: 4, cell: 5, name: 'Nord', culture: 2, population: 1 }));
    expect(numericCulture?.culture).toBeUndefined();
  });

  it('maps default FMG cultures and base names', () => {
    expect(muCultureForFmg('Angshire')).toEqual({ culture: 'european-organic', language: 'english' });
    expect(muCultureForFmg('Khazadur').culture).toBe('dwarven');
    expect(muCultureForFmg('Hantzu').culture).toBe('chinese');
    expect(muCultureForFmg('Dark Elven').culture).toBe('drow-enclave');
    expect(muCultureForFmg('Nowhereland')).toEqual({});
  });

  it('reads a CSV data row pasted without its header', () => {
    const hints = parseAzgaarBurg(`\r\n${ROW}\r\n\r\n`);
    expect(hints).toMatchObject({ seed: 'mfcg-4815162342', name: 'Ulmdorf', population: 12345, capital: true, culture: oneOf(FMG_BASE_CULTURES.German) });
    // Classic FMG layout (26 columns), as azgaar.github.io writes it.
    const classic = '12,Kaldvik,Nordmark,Nordmark,Norse,Kingdom of Norse,Norse,Old Gods,town,3200,100,200,60.1,5.2,120,-3°C,Norway,,port,,walls,,,,,';
    expect(parseAzgaarBurg(classic)).toMatchObject({ seed: 'fmg-12-kaldvik', name: 'Kaldvik', population: 3200, port: true, walls: true, culture: oneOf(FMG_BASE_CULTURES.Nordic), climateZone: 'arctic', relief: 'flat' });
    // A user's FMG build: the 34 known columns, then appended economy columns.
    const economy =
      '2,Basings,Axbroles,Axbroles Landgrave,Chip,Grand Duchy of Chip,Westen,Westen Beliefs,capital,Naval,14120,Leighton,' +
      '282.61,20.01,85,186.99,,1971.4,473.07,26.97,105.23,4,22°C,Guangzhou (China),capital,port,citadel,walls,,,,' +
      '{t1:gules;charges:[{charge:hook;t:or;p:jeo;size:0.5}];shield:heater},' +
      'https://watabou.github.io/city-generator/?name=Basings&population=14120&size=35&seed=2503689980002&river=1&coast=1&farms=1' +
      '&citadel=1&urban_castle=1&hub=1&plaza=0&greens=0&temple=0&walls=1&shantytown=0&style=natural&sea=1.62,,,100,11.4,11.4,26,100,' +
      '100,100,100,100,285.45,-2.84,-95.33,-0.28,0,0,Incense: 18.18; Coal: 1.16; Perfume: 0.43,Wood: 3.57; Cattle: 2.82';
    expect(parseAzgaarBurg(economy)).toMatchObject({
      seed: 'mfcg-2503689980002',
      name: 'Basings',
      population: 14120,
      capital: true,
      port: true,
      citadel: true,
      walls: true,
      river: 'river',
      coast: 'S',
      // English-based "Westen" with a Naval type: the only naval culture of the English list.
      culture: 'hanseatic',
      language: 'english',
    });
  });

  it('draws a culture among those fitting the name base and type', () => {
    const known = new Set<string>(cityCodeDefaults.cultures);
    for (const pool of Object.values(FMG_BASE_CULTURES)) for (const culture of pool) expect(known.has(culture), culture).toBe(true);
    // Same town, same culture; different towns spread over the English list.
    expect(pickMuCulture('English', 'Generic', 'mfcg-1')).toBe(pickMuCulture('English', 'Generic', 'mfcg-1'));
    const drawn = new Set(Array.from({ length: 40 }, (_, i) => pickMuCulture('English', 'Generic', `mfcg-${i}`)));
    expect(drawn.size).toBeGreaterThan(1);
    for (const culture of drawn) expect(FMG_BASE_CULTURES.English).toContain(culture);
    // A nomadic way of life wins over the language when the language has no camp.
    expect(['nomad-camp', 'mongol-ordu', 'native-plains', 'siberian-camp', 'oasis-caravan']).toContain(pickMuCulture('English', 'Nomadic', 'x'));
  });

  it('reads the export script object: culture base and type, biome and climate', () => {
    expect(() => new Function(FMG_EXPORT_SCRIPT)).not.toThrow();
    const burg = {
      format: 'fmg-burg-v1',
      i: 9,
      name: 'Skarholm',
      population: 4200,
      capital: false,
      port: false,
      citadel: false,
      walls: true,
      plaza: true,
      temple: false,
      shanty: false,
      type: 'Naval',
      elevation: 144,
      temperature: 2,
      precipitation: 800,
      biome: { id: 9, name: 'Taiga' },
      river: true,
      confluence: false,
      coast: { sea: 0.5, water: 'ocean' },
      culture: { name: 'Custom folk', base: 6, type: 'Naval' },
      state: 'Norse',
      mfcg: null,
      mfcgSeed: '1234560009',
    };
    const hints = parseAzgaarBurg(JSON.stringify(burg));
    expect(hints).toMatchObject({
      seed: 'mfcg-1234560009',
      population: 4200,
      river: 'river',
      coast: 'N',
      port: false,
      biome: 'forest',
      climateZone: 'nordic',
      temperature: 2.9,
      precipitation: 800,
      relief: 'flat',
      culture: oneOf(['norse-ringfort', 'hanseatic']),
      language: 'norse',
    });
    const { settings } = decodeCityCode(JSON.stringify(burg));
    expect(settings.options.biome).toBe('forest');
    expect(settings.terrain?.climate).toBe('nordic');
    expect(settings.terrain?.climateValues).toMatchObject({ temperature: 2.9, precipitation: 800 });
    expect(() => decodeCityCode('hello world')).toThrow(UNRECOGNISED_INPUT);
  });

  it('rejects text that is not an Azgaar burg', () => {
    expect(parseAzgaarBurg(LINK)).toBeNull();
    expect(parseAzgaarBurg('name,size\nfoo,3')).toBeNull();
    expect(parseAzgaarBurg('{"hello": 1}')).toBeNull();
  });
});
