import { describe, expect, it } from 'vitest';
import { parseAzgaarBurg } from '../../src/v2/externalCity/azgaar';
import { FMG_BASE_CULTURES, muCultureForFmg, pickMuCulture } from '../../src/v2/externalCity/azgaarTables';
import cityCodeDefaults from '../../src/v2/cityCodeDefaults.json';

/** A culture drawn among pool (the draw itself is seeded per town). */
const oneOf = (pool: readonly string[]) => expect.stringMatching(new RegExp(`^(${pool.join('|')})$`));
import { FMG_EXPORT_SCRIPT } from '../../src/v2/externalCity/fmgExport';
import { decodeCityCode, UNRECOGNISED_INPUT } from '../../src/v2/cityCode';

const HEADER = 'Id,Burg,Province,Province Full Name,State,State Full Name,Culture,Religion,Group,Type,Population,Market,Product,Wealth,Prosperity,Balance,Adjustments,X,Y,Latitude,Longitude,Elevation (ft),Temperature,Temperature likeness,Capital,Port,Citadel,Walls,Plaza,Temple,Shanty Town,Emblem,Preview link,Tags';
const LINK = 'https://watabou.github.io/city-generator/?name=Ulmdorf&population=12345&size=31&seed=4815162342&river=1&coast=0&farms=1&citadel=1&urban_castle=0&hub=1&plaza=1&greens=1&temple=1&walls=1&shantytown=0&style=natural';
const ROW = `7,Ulmdorf,Ulmia,"Margraviate of Ulmia, North",Shwazenland,Kingdom of Shwazenland,Shwazen,Old Faith,city,River,12345,,0,0,,0,,512.3,300.1,48.2,10.1,1968,70°F,Germany,capital,,citadel,walls,plaza,temple,,"{t1:gules;ordinary:[]}",${LINK},"trade, old"`;

describe('parseAzgaarBurg', () => {
  it('reads an FMG Burgs overview CSV row and keeps the watabou link seed', () => {
    const hints = parseAzgaarBurg(`\ufeff${HEADER}\r\n${ROW}\r\n`);
    expect(hints).toMatchObject({
      source: 'azgaar-burg', seed: 'mfcg-4815162342', name: 'Ulmdorf', population: 12345,
      river: 'river', coast: 'none', capital: true, port: false, citadel: true, walls: true,
      plaza: true, temple: true, shantytown: false, roads: 4, farms: true,
      relief: 'hills', culture: oneOf(FMG_BASE_CULTURES.German), language: 'german',
    });
    expect(hints?.biome).toBeUndefined(); // 70 °F = 21 °C: no clear biome
  });

  it('reads a burg JSON object with FMG population units', () => {
    const json = JSON.stringify({ i: 3, cell: 1200, x: 10, y: 20, name: 'Qal\'at Sabr', culture: 'Eurabic', population: 2.6,
      capital: 0, port: 4, citadel: 1, walls: 0, plaza: 1, temple: 1, shanty: 0, type: 'Naval', tags: [] });
    expect(parseAzgaarBurg(json)).toMatchObject({
      source: 'azgaar-burg', seed: 'fmg-3-qal-at-sabr', name: 'Qal\'at Sabr', population: 2600,
      port: true, coast: 'random', citadel: true, walls: false, culture: oneOf(FMG_BASE_CULTURES.Arabic), language: 'arabic',
    });
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
    expect(parseAzgaarBurg(classic)).toMatchObject({ seed: 'fmg-12-kaldvik', name: 'Kaldvik', population: 3200, port: true,
      walls: true, culture: oneOf(FMG_BASE_CULTURES.Nordic), climateZone: 'arctic', relief: 'flat' });
    // A user's FMG build: the 34 known columns, then appended economy columns.
    const economy = '2,Basings,Axbroles,Axbroles Landgrave,Chip,Grand Duchy of Chip,Westen,Westen Beliefs,capital,Naval,14120,Leighton,'
      + '282.61,20.01,85,186.99,,1971.4,473.07,26.97,105.23,4,22°C,Guangzhou (China),capital,port,citadel,walls,,,,'
      + '{t1:gules;charges:[{charge:hook;t:or;p:jeo;size:0.5}];shield:heater},'
      + 'https://watabou.github.io/city-generator/?name=Basings&population=14120&size=35&seed=2503689980002&river=1&coast=1&farms=1'
      + '&citadel=1&urban_castle=1&hub=1&plaza=0&greens=0&temple=0&walls=1&shantytown=0&style=natural&sea=1.62,,,100,11.4,11.4,26,100,'
      + '100,100,100,100,285.45,-2.84,-95.33,-0.28,0,0,Incense: 18.18; Coal: 1.16; Perfume: 0.43,Wood: 3.57; Cattle: 2.82';
    expect(parseAzgaarBurg(economy)).toMatchObject({ seed: 'mfcg-2503689980002', name: 'Basings', population: 14120,
      capital: true, port: true, citadel: true, walls: true, river: 'river', coast: 'S',
      // English-based "Westen" with a Naval type: the only naval culture of the English list.
      culture: 'hanseatic', language: 'english' });
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
    const burg = { format: 'fmg-burg-v1', i: 9, name: 'Skarholm', population: 4200, capital: false, port: false, citadel: false,
      walls: true, plaza: true, temple: false, shanty: false, type: 'Naval', elevation: 144, temperature: 2, precipitation: 800,
      biome: { id: 9, name: 'Taiga' }, river: true, confluence: false, coast: { sea: 0.5, water: 'ocean' },
      culture: { name: 'Custom folk', base: 6, type: 'Naval' }, state: 'Norse', mfcg: null, mfcgSeed: '1234560009' };
    const hints = parseAzgaarBurg(JSON.stringify(burg));
    expect(hints).toMatchObject({ seed: 'mfcg-1234560009', population: 4200, river: 'river', coast: 'N', port: false,
      biome: 'forest', climateZone: 'nordic', temperature: 2.9, precipitation: 800, relief: 'flat',
      culture: oneOf(['norse-ringfort', 'hanseatic']), language: 'norse' });
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
