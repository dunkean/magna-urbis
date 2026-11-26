import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { UrbanLayer, World } from '../src/gen/types';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { decodeCitySiteVisuals, siteVisualsPackOf } from '../src/render/cityDisplayBuffers';
import { siteVisualScene } from '../src/ui/urbanSilhouettes';
import { internLocalEdit, packLocalEdit } from '../src/v2/localEditIntern';
import { localEditRegions } from '../src/v2/localEditRegion';
import { renameLocalTown, renameMap } from '../src/v2/mapNaming';
import { nativeCityRecords } from '../src/v2/nativeProducts';
import type { RustTownSnapshot } from '../src/v2/rustUrban';
import { defaultSettings } from '../src/v2/settings';
import { mergeEditTarget } from '../src/v2/urbanEditMerge';

const ring = (x: number, y = 100, w = 12) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + w },
  { x, y: y + w },
];
const house = (id: string, x: number): PlacedBuilding => ({ id, parcel_id: id, culture: { culture: 'roman-core' }, function: 'domestic', footprint: [{ outer: ring(x), holes: [] }], volumes: [] }) as unknown as PlacedBuilding;

function fixture() {
  const settings = defaultSettings();
  const terrain = { height: { w: 1, h: 1, cell: 1024, data: new Float32Array(1) }, seaFraction: 0, water: new Uint8Array(1), lakes: [], rivers: [] };
  const roads = [
    {
      path: [
        { x: 0, y: 30 },
        { x: 230, y: 120 },
      ],
      kind: 'major',
      width: 10,
    },
  ];
  const landuse = { areas: [], farmsteads: [], reserve: [] };
  const town = (key: string, x: number) => {
    const streets = [
      {
        role: 'radial',
        rank: 0,
        path: [
          { x, y: 100 },
          { x: x + 50, y: 100 },
        ],
        widths: [7, 7],
      },
    ];
    const quarters = [{ shape: { outer: ring(x, 100, 70), holes: [] }, phase: 0 }];
    const layout = { key, streets, quarters, blocks: [], warnings: [] };
    const scene = { buildings: [house(key + '-a', x), house(key + '-b', x + 15)], open_spaces: [], refusals: [] };
    const snapshot = { stage: 'buildings', layouts: [layout], scene } as unknown as RustTownSnapshot;
    const urban = { population: 20000, footprint: [quarters[0].shape.outer], quarters: quarters.map(q => ({ poly: q.shape, zone: 'core' })), streets, buildings: [], landmarks: [], squares: [] } as unknown as UrbanLayer;
    const settlement = { key, main: key === 'main', detail: key === 'main' ? 'main' : 'eager', population: 20000, culture: 'roman-core', center: { x, y: 105 }, urban };
    return { settlement, snapshot };
  };
  const main = town('main', 200),
    other = town('other', 700);
  const world = {
    seed: 'named-local-edit',
    options: { ...settings.options, culture: 'roman-core', biome: 'temperate' },
    mapSize: 1024,
    terrain,
    roads,
    landuse,
    stats: {},
    site: { center: main.settlement.center },
    urban: main.settlement.urban,
    settlements: [main.settlement, other.settlement],
    debug: { v2RustCities: { main: main.snapshot, other: other.snapshot } },
  } as unknown as World;
  settings.options = world.options;
  return { settings, world };
}

it.each(['main', 'other'])('names the changed objects of %s with full-run identities and retains every unrelated label', key => {
  const { settings, world } = fixture();
  settings.naming = { variations: { 'city:other': 2 }, labels: { free: { kind: 'free', anchor: { x: 10, y: 10 }, text: 'Free label' } } };
  const previous = renameMap(world, settings);
  const cities = nativeCityRecords(previous)!;
  const current = cities[key],
    unchanged = current.scene!.buildings[0],
    created = house(key + '-new', key === 'main' ? 240 : 750);
  const snapshot = { ...current, scene: { ...current.scene!, buildings: [unchanged, created] } };
  const next = { ...previous, debug: { ...previous.debug, v2RustCities: { ...cities, [key]: snapshot } } };
  const local = renameLocalTown(previous, next, settings, key);
  const full = renameMap(next, settings);
  const labels = (w: World) => new Map(w.names!.entries.map(entry => [entry.id, entry]));
  const before = labels(previous),
    after = labels(local);
  for (const [id, entry] of before) if (id !== 'urban:' + key + ':building:' + key + '-b') expect(after.get(id)).toBe(entry);
  const newId = 'urban:' + key + ':building:' + created.id;
  expect(after.get(newId)).toEqual(labels(full).get(newId));
  expect(after.has('urban:' + key + ':building:' + key + '-b')).toBe(false);
  expect(local.roads).toBe(previous.roads);
  expect(local.landuse).toBe(previous.landuse);
  expect(local.terrain).toBe(previous.terrain);
  expect(local.settlements!.find(place => place.key !== key)).toBe(previous.settlements!.find(place => place.key !== key));
});

it('splices a local reply into page objects and transfers only the new records of a merged site array', () => {
  const { world } = fixture();
  const main = nativeCityRecords(world)!.main;
  const sites = [
    { id: 'one', parcel_id: 'one', offset: 0 },
    { id: 'obsolete', parcel_id: 'changed', offset: 1 },
    { id: 'three', parcel_id: 'three', offset: 2 },
  ] as RustTownSnapshot['sites'];
  main.sites = sites;
  const page = structuredClone(world);
  const held = nativeCityRecords(page)!;
  const changedSite = { id: 'new', parcel_id: 'changed', offset: 1, programme: { message: 'Fontaine Saint-Éloi' } } as unknown as NonNullable<RustTownSnapshot['sites']>[number];
  const fresh = { ...main, sites: [sites![0], changedSite, { ...changedSite, id: 'new-part', offset: 2 }, { ...sites![2], offset: 3 }] };
  const merged = mergeEditTarget(main, fresh, { blocks: new Map(), parcels: new Set(['changed']), reshaped: new Set() }).snapshot;
  const snapshot = { ...merged, scene: { ...main.scene!, buildings: [main.scene!.buildings[0], house('replacement', 235)] } };
  const next = { ...world, debug: { ...world.debug, v2RustCities: { ...nativeCityRecords(world), main: snapshot } }, stats: { stage: 'edited' } };
  const { delta, transfer } = packLocalEdit(world, next, 'main');
  expect(transfer).toHaveLength(1);
  const received = structuredClone(delta, { transfer });
  expect(transfer[0].byteLength).toBe(0);
  const restored = internLocalEdit(page, received);
  expect(restored).toEqual(next);
  expect(restored.terrain).toBe(page.terrain);
  expect(restored.settlements).toBe(page.settlements);
  expect(nativeCityRecords(restored)!.other).toBe(held.other);
  expect(nativeCityRecords(restored)!.main.scene!.buildings[0]).toBe(held.main.scene!.buildings[0]);
  expect(nativeCityRecords(restored)!.main.sites![3]).toBe(held.main.sites![2]);
  expect(localEditRegions({ ...page }, { ...restored })).toBe(received.rects);
  expect(received.rects).toEqual([{ x0: 191, y0: 76, x1: 271, y1: 136 }]);
});

it('transfers a fresh native site buffer and projects its unedited silhouettes on the page', () => {
  const { world } = fixture();
  const old = nativeCityRecords(world)!;
  const bytes = readFileSync(new URL('./fixtures/site-visuals-v2.bin', import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const sites = decodeCitySiteVisuals(buffer) as unknown as NonNullable<RustTownSnapshot['sites']>;
  const snapshot = { ...old.main, sites, scene: siteVisualScene(sites) };
  const next = { ...world, debug: { ...world.debug, v2RustCities: { ...old, main: snapshot } } };
  const sent = packLocalEdit(world, next, 'main');
  expect(sent.transfer.map(item => item.byteLength)).toEqual([buffer.byteLength]);
  expect(sent.delta.sceneFromSites).toBe(true);
  const restored = internLocalEdit(structuredClone(world), structuredClone(sent.delta, { transfer: sent.transfer }));
  const result = nativeCityRecords(restored)!.main;
  expect(result.sites).toEqual(sites);
  expect(siteVisualsPackOf(result.sites!)).toBeDefined();
  expect(result.scene).toEqual(snapshot.scene);
  expect(buffer.byteLength).toBe(bytes.byteLength);
});
