import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/gen/options';
import { Rng } from '../src/gen/core/rng';
import { generateNames, settlementNames, setSettlementName, presentName } from '../src/gen/names';
import type { World, Settlement, UrbanLayer } from '../src/gen/types';
import { renameMap } from '../src/v2/mapNaming';
import { defaultSettings } from '../src/v2/settings';
import type { NameDisplayLanguage, NameParts } from '../src/gen/names/types';

const point = (x: number, y = 500) => ({ x, y });
function place(key: string, x: number, culture = 'bastide'): Settlement {
  return { key, index: 0, main: key === 'main', cls: 'village', population: 700, culture, center: point(x),
    archetype: 'plain', radius: 80, extent: [], region: [], detail: key === 'main' ? 'main' : 'lazy' } as Settlement;
}
function world(): World {
  const grid = { w: 8, h: 8, cell: 125, data: new Float32Array(64) };
  return { seed: 'namebench-integration', mapSize: 1000, stats: {},
    options: { ...DEFAULTS, culture: 'bastide', language: 'auto' },
    terrain: { height: grid, slope: grid, water: new Uint8Array(64), rivers: [
      { id: 7, main: true, path: [point(0, 200), point(500, 200), point(1000, 200)], width: [8, 8, 8] },
      { id: 23, path: [point(0, 700), point(500, 700), point(1000, 700)], width: [4, 4, 4] },
    ], lakes: [], seaFraction: 0, seaLevel: 0, flow: grid, coastline: [],
      receiver: new Int32Array(64).fill(-1), filled: new Float32Array(64), downSide: 'S', seaSide: null },
    site: { center: point(500), reserveRadius: 80 } as World['site'],
    roads: [{ path: [point(500), point(700), point(900)], kind: 'major', width: 8 }],
    settlements: [place('main', 500), place('village:4', 900, 'persian'), place('village:9', 200, 'korean')],
    urban: { population: 700, footprint: [], quarters: [], squares: [], streets: [], landmarks: [],
      walls: [{ gates: [point(700)] }], sites: [{ id: 'keep', kind: 'castle', anchor: point(500), lot: [] }],
    } as unknown as UrbanLayer,
  } as World;
}
function name(w: World): World {
  const root = new Rng('magna-urbis:' + w.seed);
  w.names = generateNames(w, root);
  settlementNames(w, root);
  return w;
}
const box = (x: number, y: number, side = 100) => [
  { x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side },
];
function richWorld(culture: string): World {
  const w = world(); w.options.culture = culture;
  const u = w.urban!;
  u.landmarks = [{ kind: 'mosque', poly: box(200, 200) }];
  u.sites!.push({ id: 'worship', kind: 'madrasa', role: 'worship', lot: box(200, 200), anchor: { x: 250, y: 250 } });
  u.squares = [box(350, 350), box(600, 600)];
  u.quarters = [
    { zone: 'core', phase: 0, poly: { outer: box(150, 150), holes: [] }, streetSpace: [] },
    { zone: 'edge', phase: 1, poly: { outer: box(600, 600), holes: [] }, streetSpace: [] },
  ];
  u.streets = [
    { path: [point(400, 500), point(550, 500)], rank: 0, role: 'street', kind: 'main', phase: 0, width: 8 },
    { path: [point(650, 500), point(850, 500)], rank: 0, role: 'street', kind: 'main', phase: 0, width: 8 },
    { path: [point(100, 850), point(300, 850)], rank: 2, role: 'street', kind: 'street', phase: 0, width: 4 },
  ];
  return w;
}
const namedPlaces = (w: World) => Object.fromEntries(w.settlements!.map(p => [p.key, p.name]));

describe('Namebench pipeline integration', () => {
  it('keeps settlement names stable under reorder, insertion and repeated naming', () => {
    const original = name(world()), expected = namedPlaces(original);
    const reordered = world();
    reordered.settlements = [reordered.settlements![2], place('hamlet:42', 100, 'elven'), reordered.settlements![0], reordered.settlements![1]];
    name(reordered);
    for (const [key, value] of Object.entries(expected)) expect(namedPlaces(reordered)[key]).toBe(value);
    settlementNames(reordered, new Rng('unused'));
    expect(reordered.names!.entries.filter(e => e.sub === 'settlement:village:4')).toHaveLength(1);
    expect(original.names!.region).toBeTruthy();
    expect(original.names!.algorithmVersion).toBeTruthy();
    expect(original.names!.corpusVersion).toBeTruthy();
    expect(original.names!.corpusFingerprint).toBeTruthy();
  });

  it('keeps river names stable when rivers are reordered or another river is inserted', () => {
    const original = name(world());
    const changed = world();
    changed.terrain.rivers = [changed.terrain.rivers[1], { id: 99, path: [point(0, 20), point(1000, 20)], width: [2, 2] }, changed.terrain.rivers[0]];
    name(changed);
    for (const river of original.terrain.rivers) expect(changed.terrain.rivers.find(r => r.id === river.id)?.name).toBe(river.name);
    expect(changed.names!.town).toBe(original.names!.town);
  });

  it('resolves manual names before castles, roads and gates, then renames semantic references only', () => {
    const w = world();
    w.options = { ...w.options, workflow: 'list', settlements: { list: [
      { population: 700, name: 'Le Havre' }, { key: 'village:4', population: 700, name: 'Avignon' },
    ] } };
    name(w);
    expect(w.names!.entries.find(e => e.kind === 'castle')?.text).toBe('Château du Havre');
    expect(w.names!.entries.find(e => e.kind === 'gate')?.text).toBe("Porte d'Avignon");
    expect(w.names!.entries.find(e => e.kind === 'road')?.text).toBe("Route d'Avignon");
    w.names!.entries.push({ id: 'custom', kind: 'square', text: 'Avignon Market', rank: 1, anchor: point(200) });
    setSettlementName(w, 'village:4', 'Les Ormes');
    expect(w.names!.entries.find(e => e.kind === 'gate')?.text).toBe('Porte des Ormes');
    expect(w.names!.entries.find(e => e.kind === 'road')?.text).toBe('Route des Ormes');
    expect(w.names!.entries.find(e => e.id === 'custom')?.text).toBe('Avignon Market');
    setSettlementName(w, 'main', 'La Rochelle');
    expect(w.names!.entries.find(e => e.kind === 'castle')?.text).toBe('Château de la Rochelle');
    expect(w.urban!.sites![0].name).toBe('Château de la Rochelle');
  });

  it('repeats generated site metadata and preserves a subsequent author edit', () => {
    const w = name(world());
    const first = structuredClone(w.names);
    name(w);
    expect(w.names).toEqual(first);
    const castle = w.urban!.sites![0];
    expect(castle.generatedName).toBe(castle.name);
    castle.name = 'The authored keep';
    name(w);
    expect(castle.name).toBe('The authored keep');
    expect(castle.generatedName).toBeUndefined();
    expect(w.names!.entries.find(entry => entry.kind === 'castle')?.text).toBe('The authored keep');
  });

  it('retains a finer cultural connector when manually renaming a destination', () => {
    const w = world(); w.options.culture = 'persian'; name(w);
    expect(w.names!.profile).toBe('persian');
    setSettlementName(w, 'village:4', 'Neyshabur');
    expect(w.names!.entries.find(e => e.kind === 'gate')?.text).toBe('Darvāzeh-ye Neyshabur');
    expect(w.names!.entries.find(e => e.kind === 'road')?.text).toBe('Rāh-e Neyshabur');
  });

  it('renames retained maps without mutating source names or geometry', () => {
    const source = name(world()), before = structuredClone(source);
    const settings = defaultSettings();
    settings.options.culture = 'bastide'; settings.options.language = 'english';
    settings.naming = { title: 'Copper Coast', places: { main: 'Valmont', 'village:4': 'Rivermeet' } };
    const renamed = renameMap(source, settings);
    expect(source).toEqual(before);
    expect(renamed.options.workflow).toBe(source.options.workflow);
    expect(renamed.options.settlements).toBe(source.options.settlements);
    expect(renamed.terrain.height).toBe(source.terrain.height);
    expect(renamed.terrain.water).toBe(source.terrain.water);
    expect(renamed.terrain.rivers[0]).not.toBe(source.terrain.rivers[0]);
    expect(renamed.terrain.rivers[0].path).toBe(source.terrain.rivers[0].path);
    expect(renamed.terrain.rivers[0].width).toBe(source.terrain.rivers[0].width);
    expect(renamed.roads).toBe(source.roads);
    expect(renamed.urban!.sites![0].lot).toBe(source.urban!.sites![0].lot);
    expect(renamed.urban!.footprint).toBe(source.urban!.footprint);
    expect(renamed.names!.town).toBe('Copper Coast');
    expect(renamed.names!.entries.find(e => e.kind === 'town')?.text).toBe('Valmont');
    expect(renamed.names!.entries.find(e => e.kind === 'gate')?.text).toBe('Rivermeet Gate');
    expect(renamed.names!.family).toBe('english');
  });
  it.each([
    ['persian', /^Kucheh/, /^Meydān/, /^Mahalleh/, /^Masjed/],
    ['swahili-stone-town', /^Mtaa/, /^Uwanja/, /^Kata/, /^Msikiti/],
    ['maori-pa', /^Tiriti/, /^Marae/, /^Kāinga/, /^Whare karakia/],
  ] as const)('uses the actual %s urban vocabulary instead of the coarse grammar family', (culture, street, square, quarter, worship) => {
    const w = name(richWorld(culture));
    expect(w.names!.entries.filter(e => e.kind === 'street').every(e => street.test(e.text))).toBe(true);
    expect(w.names!.entries.filter(e => e.kind === 'square').every(e => square.test(e.text))).toBe(true);
    expect(w.names!.entries.filter(e => e.kind === 'quarter').every(e => quarter.test(e.text))).toBe(true);
    expect(w.names!.entries.find(e => e.kind === 'church')?.text).toMatch(worship);
    const labels = w.names!.entries.filter(e => ['street', 'square', 'quarter', 'church'].includes(e.kind)).map(e => e.text).join(' ');
    expect(labels).not.toMatch(/Shiva|Vishnu|Brahma|Mandira|Gopura|Sharia|Madrasa|Bab /);
    expect(w.urban!.sites!.find(s => s.id === 'worship')?.name).toBe(w.names!.entries.find(e => e.kind === 'church')?.canonicalText);
  });

  it('preserves a minority site cultural grammar when its town reference changes', () => {
    const w = world(); w.urban!.sites![0].culture = 'swahili-stone-town'; name(w);
    expect(w.names!.entries.find(e => e.kind === 'castle')?.text).toMatch(/^Ngome/);
    setSettlementName(w, 'main', 'Valmont');
    expect(w.names!.entries.find(e => e.kind === 'castle')?.text).toMatch(/^Ngome.*Valmont$/);
    expect(w.names!.entries.find(e => e.kind === 'castle')?.reference?.culture).toBe('swahili-stone-town');
  });

  it('localizes an annotated generic in seven languages without altering the cultural proper name', () => {
    const parts: NameParts = { proper: 'TsingTao', cultural: 'TsingTao Jiang', kind: 'river', opaque: false };
    const expected = { fr: 'Fleuve TsingTao', en: 'TsingTao River', ja: 'TsingTao川', ar: 'نهر \u2068TsingTao\u2069', es: 'Río TsingTao', pt: 'Rio TsingTao', zh: 'TsingTao河' };
    for (const language of Object.keys(expected) as NameDisplayLanguage[]) {
      expect(presentName(parts, { mode: 'localized', language })).toBe(expected[language]);
      expect(presentName({ ...parts, opaque: true }, { mode: 'localized', language })).toBe('TsingTao Jiang');
      expect(presentName(parts, { mode: 'cultural', language })).toBe('TsingTao Jiang');
    }
    expect(parts.proper).toBe('TsingTao');
  });

  it('uses Spanish and Portuguese generic links without rewriting proper-name articles', () => {
    const parts: NameParts = { proper: 'El Paso', cultural: 'Barabara El Paso', kind: 'road', opaque: false };
    expect(presentName(parts, { mode: 'localized', language: 'es' })).toBe('Camino de El Paso');
    expect(presentName(parts, { mode: 'localized', language: 'pt' })).toBe('Estrada de El Paso');
    expect(presentName({ ...parts, kind: 'street' }, { mode: 'localized', language: 'pt' })).toBe('Rua de El Paso');
    expect(presentName({ ...parts, kind: 'forest' }, { mode: 'localized', language: 'es' })).toBe('Bosque de El Paso');
    expect(presentName({ ...parts, kind: 'castle' }, { mode: 'localized', language: 'pt' })).toBe('Castelo de El Paso');
    expect(parts.proper).toBe('El Paso');
  });

  it.each(['fr', 'en', 'ja', 'ar', 'es', 'pt', 'zh'] as const)('round trips cultural and %s partial display with stable identities, overrides and geometry', language => {
    const source = name(richWorld('persian'));
    const settings = defaultSettings(); settings.options.culture = 'persian';
    settings.naming = { places: { main: 'Valmont', 'village:4': 'TsingTao' }, mode: 'cultural' };
    const cultural = renameMap(source, settings);
    settings.naming = { ...settings.naming, mode: 'localized', displayLanguage: language };
    const localized = renameMap(cultural, settings);
    expect(localized.names!.entries.map(e => [e.id, e.parts?.proper, e.canonicalText])).toEqual(cultural.names!.entries.map(e => [e.id, e.parts?.proper, e.canonicalText]));
    const road = localized.names!.entries.find(e => e.kind === 'road')!;
    expect(road.parts?.proper).toBe('TsingTao');
    expect(road.text).toBe(presentName(road.parts!, { mode: 'localized', language }));
    expect(road.text).not.toBe(road.canonicalText);
    expect(localized.names!.entries.find(e => e.kind === 'town')?.text).toBe('Valmont');
    expect(localized.terrain.height).toBe(source.terrain.height);
    expect(localized.roads).toBe(source.roads);
    settings.naming.mode = 'cultural';
    const restored = renameMap(localized, settings);
    expect(restored.names!.entries).toEqual(cultural.names!.entries);
    expect(restored.names!.region).toBe(cultural.names!.region);
  });

});
