import { describe, expect, it } from 'vitest';
import type { World } from '../../src/gen/types';
import { DEFAULTS } from '../../src/gen/options';
import { namingPolicy } from '../../src/gen/names/policy';
import { resolveToponymProfile } from '../../src/gen/names/profiles';
import { renameMap } from '../../src/v2/mapNaming';
import { defaultSettings } from '../../src/v2/settings';
import { validateSettings } from '../../src/v2/project';

const box = (x: number, y: number) => [
  { x, y },
  { x: x + 100, y },
  { x: x + 100, y: y + 100 },
  { x, y: y + 100 },
];
function fixture(): World {
  const grid = { w: 24, h: 24, cell: 50, data: new Float32Array(576) };
  return {
    seed: 'toponym-culture',
    mapSize: 1200,
    stats: {},
    options: { ...DEFAULTS, culture: 'bastide', language: 'auto' },
    terrain: {
      height: grid,
      slope: grid,
      water: new Uint8Array(576).fill(1),
      seaFraction: 0.5,
      rivers: [1, 2].map(id => ({
        id,
        main: id === 1,
        path: [
          { x: 0, y: id * 100 },
          { x: 1200, y: id * 100 },
        ],
        width: [8, 8],
      })),
      lakes: [box(800, 800)],
    },
    site: { center: { x: 500, y: 500 }, reserveRadius: 100 },
    roads: [],
    settlements: [
      { key: 'main', main: true, population: 3000, culture: 'bastide', center: { x: 500, y: 500 }, detail: 'main' },
      { key: 'east', population: 500, culture: 'medina', center: { x: 900, y: 500 } },
      { key: 'authored', population: 100, culture: 'chinese', center: { x: 900, y: 900 } },
    ],
    landuse: { areas: [{ kind: 'forest', poly: box(100, 800) }], farmsteads: [] },
    urban: {
      population: 3000,
      footprint: [],
      quarters: [{ zone: 'core', phase: 0, poly: { outer: box(300, 300), holes: [] }, streetSpace: [] }],
      streets: [
        {
          path: [
            { x: 400, y: 500 },
            { x: 600, y: 500 },
          ],
          rank: 0,
          role: 'street',
          width: 8,
          phase: 0,
        },
      ],
      squares: [box(600, 600)],
      landmarks: [],
      sites: [{ id: 'keep', kind: 'castle', anchor: { x: 500, y: 500 }, lot: [], name: 'The Old Keep' }],
      walls: [],
    },
    debug: {
      v2RustCities: {
        main: {
          layouts: [{ key: 'main', culture: 'chinese', quarters: [{ shape: { outer: box(300, 300), holes: [] }, phase: 0 }], blocks: [{ quarter: 0, kind: 'block', shape: { outer: box(300, 300), holes: [] } }], streets: [], structure: { districts: [{ id: 3, quarters: [0] }] } }],
          partitions: [{ key: 'main', parcels: [{ id: 'temple', shape: { outer: box(500, 500), holes: [] }, use: 'plot' }], programme: { allocations: [{ parcelId: 'temple', role: 'worship.temple.major', culture: 'chinese' }] } }],
          scene: { buildings: [{ id: 'house', parcel_id: 'house-parcel', function: 'domestic', culture: { culture: 'chinese' }, footprint: [{ outer: box(700, 700), holes: [] }] }] },
        },
      },
    },
  } as unknown as World;
}

describe('map-wide toponym culture', () => {
  it('renames retained places and rivers, protects author names, and restores names without changing geometry', () => {
    const source = fixture(),
      settings = defaultSettings();
    settings.options.culture = 'bastide';
    settings.naming = {
      places: { authored: 'My Hamlet' },
      labels: { 'river:2': { text: 'My River' }, 'free:note': { text: 'My Note', kind: 'free', anchor: { x: 50, y: 60 } } },
      local: { main: { profile: 'german' } },
      region: { profile: 'french' },
      features: { 'urban:main:quarter:main:0': { profile: 'persian' } },
    };
    const original = renameMap(source, settings),
      snapshot = structuredClone(original);
    settings.naming.toponymCulture = 'japanese-jokamachi';
    const japanese = renameMap(original, settings);
    const entry = (world: World, id: string) => world.names!.entries.find(e => e.id === id)!;
    expect(japanese.settlements![0].name).not.toBe(original.settlements![0].name);
    expect(japanese.settlements![1].name).not.toBe(original.settlements![1].name);
    expect(entry(japanese, 'river:1').text).not.toBe(entry(original, 'river:1').text);
    expect(japanese.names!.regionParts!.profile).toBe('japanese');
    for (const id of ['settlement:main', 'settlement:east', 'river:1', 'urban:main:quarter:main:0', 'urban:main:district:main:3', 'urban:main:parcel:main:temple', 'urban:main:building:house']) {
      expect(entry(japanese, id).parts?.profile, id).toBe('japanese');
    }
    for (const kind of ['lake', 'sea', 'forest', 'street']) {
      const names = japanese.names!.entries.filter(e => e.kind === kind);
      expect(names.length, kind).toBeGreaterThan(0);
      expect(
        names.every(e => e.parts?.profile === 'japanese'),
        kind,
      ).toBe(true);
    }
    expect(japanese.settlements![2].name).toBe('My Hamlet');
    expect(entry(japanese, 'river:2').text).toBe('My River');
    expect(entry(japanese, 'free:note').text).toBe('My Note');
    expect(entry(japanese, 'castle:keep').text).toBe('The Old Keep');
    expect(japanese.terrain.height).toBe(original.terrain.height);
    expect(japanese.terrain.water).toBe(original.terrain.water);
    expect(japanese.terrain.lakes).toBe(original.terrain.lakes);
    expect(japanese.terrain.rivers[0].path).toBe(original.terrain.rivers[0].path);
    expect(japanese.urban!.streets[0].path).toBe(original.urban!.streets[0].path);
    expect(japanese.urban!.quarters[0].poly).toBe(original.urban!.quarters[0].poly);
    expect(japanese.settlements!.map(s => s.center)).toEqual(original.settlements!.map(s => s.center));
    expect(japanese.debug).toBe(original.debug);
    expect(japanese.options.culture).toBe(original.options.culture);
    expect(japanese.settlements!.map(s => s.culture)).toEqual(original.settlements!.map(s => s.culture));
    expect(original).toEqual(snapshot);
    delete settings.naming.toponymCulture;
    const restored = renameMap(japanese, settings);
    expect(restored.names!.entries.map(e => [e.id, e.text])).toEqual(original.names!.entries.map(e => [e.id, e.text]));
    expect(restored.names!.region).toBe(original.names!.region);
    expect(restored.settlements!.map(s => s.name)).toEqual(original.settlements!.map(s => s.name));
    settings.naming.toponymCulture = 'japanese-jokamachi';
    expect(renameMap(restored, settings).names!.entries.map(e => [e.id, e.text])).toEqual(japanese.names!.entries.map(e => [e.id, e.text]));
  });

  it('maps culture to profile above scoped overrides and validates saved selections', () => {
    const settings = defaultSettings();
    settings.naming = { toponymCulture: 'medina', profile: 'german', local: { main: { profile: 'japanese' } }, features: { quarter: { profile: 'persian' } } };
    expect(namingPolicy(settings.naming, 'main', 'quarter').profile).toBe(resolveToponymProfile('medina').id);
    expect(() => validateSettings(settings)).not.toThrow();
    expect(() => validateSettings({ ...settings, naming: { toponymCulture: 'unknown-culture' } })).toThrow();
    delete settings.naming.toponymCulture;
    expect(namingPolicy(settings.naming, 'main', 'quarter').profile).toBe('persian');
  });
});
