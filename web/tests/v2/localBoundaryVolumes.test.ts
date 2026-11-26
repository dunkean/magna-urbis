import { isDeepStrictEqual } from 'node:util';
import { expect, it, vi } from 'vitest';
import type { Layout } from '../../../rust/bridge/urban';
import { fakeWorld } from '../../scripts/fakeworld';
import { presetComposition } from '../../src/render/composition';
import { TerrainHeights } from '../../src/render/world/heights';
import { resolveSettingsAppearance } from '../../src/v2/appearance';
import { MapState } from '../../src/v2/display/mapState';
import { WorldVolumes } from '../../src/v2/display/worldVolumes';
import { defaultSettings } from '../../src/v2/settings';

it('publishes fresh boundaries and flights after an interrupted local edit and a night look change', () => {
  const callbacks: (() => void)[] = [];
  let tick = 0,
    startedYards = 0;
  vi.stubGlobal('requestIdleCallback', (run: () => void) => callbacks.push(run));
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => 3 * ++tick);
  try {
    const base = fakeWorld({ mapSize: 1024, clusters: 1, buildings: 0, streets: 0, landAreas: 0 });
    const edge = {
      material: 'wall' as const,
      side: 'front' as const,
      path: [
        { x: 32, y: 60 },
        { x: 69, y: 60 },
      ],
    };
    const street = {
      role: 'stairs',
      rank: 2,
      widths: [4, 4],
      path: [
        { x: 40, y: 60 },
        { x: 64, y: 60 },
      ],
    };
    const circuit = {
      kind: 'wall',
      height_m: 4,
      path: [
        { x: 330, y: 270 },
        { x: 395, y: 270 },
        { x: 395, y: 320 },
        { x: 330, y: 320 },
      ],
      gates: [],
    };
    const layout = { key: 'west', culture: 'italian', center: { x: 300, y: 300 }, quarters: [], streets: [street], blocks: [], enclosures: [circuit] } as unknown as Layout;
    base.roads = [];
    base.settlements = [];
    const world = (layouts: Layout[]) => ({ ...base, debug: { ...base.debug, v2RustCities: { west: { stage: 'layout', layouts } } } });
    const settings = defaultSettings(),
      day = presetComposition('parchment');
    const appearance = { style: 'parchment' as const, composition: day };
    settings.appearance = appearance;
    const map = new MapState(
      () => {},
      {} as ConstructorParameters<typeof MapState>[1],
      false,
      () => false,
    );
    map.settings = settings;
    map.world = world([layout]);
    const parts = {
      town: {
        city: {
          *lotEnclosureSteps() {
            startedYards++;
            yield;
            return [edge];
          },
        },
      },
      water: {},
    } as unknown as ConstructorParameters<typeof WorldVolumes>[1];
    const grid = Float32Array.from({ length: 64 }, (_, i) => (i % 8) * 23 + (i >> 3) * 8);
    let relief = new TerrainHeights(grid, 8, 1024, -Infinity, 1.75);
    const view = () => new WorldVolumes(map, parts, () => relief);
    const active = view();
    const begin = (v: WorldVolumes) => {
      map.townContent++;
      map.resolved = resolveSettingsAppearance(map.settings!, map.world, 'view2d');
      v.refresh();
    };
    const finish = (v: WorldVolumes) => {
      for (let n = 0; v.pending(); n++) {
        expect(n).toBeLessThan(1000);
        callbacks.shift()!();
      }
      return v.buildings.scene()!.buildings;
    };
    begin(active);
    const initial = finish(active),
      get = (list: typeof initial, key: string) => list.find(b => b.id.startsWith(key))!;
    const yard = get(initial, 'yard:'),
      wall = get(initial, 'city3d-wall:'),
      stairs = get(initial, 'city3d-stairs:');
    expect(yard).toBeDefined();
    expect(wall).toBeDefined();
    expect(stairs).toBeDefined();
    map.world = world([{ ...layout, streets: [...layout.streets] }]);
    begin(active);
    const local = finish(active);
    expect(get(local, 'yard:')).toBe(yard);
    expect(get(local, 'city3d-wall:')).toBe(wall);
    // A wall has been composed for the pending layout when the yard solver yields.
    map.world = world([{ ...layout, enclosures: [{ ...circuit, height_m: 12 }] }]);
    begin(active);
    const before = startedYards;
    for (let n = 0; startedYards === before; n++) {
      expect(n).toBeLessThan(1000);
      callbacks.shift()!();
    }
    map.world = world([layout]);
    map.settings = { ...settings, appearance: { ...appearance, composition: { ...day, effects: { ...day.effects, ambience: 'night' } } } };
    relief = new TerrainHeights(
      Float32Array.from(grid, z => z * 1.3 + 4),
      8,
      1024,
      -Infinity,
      1.75,
    );
    begin(active);
    const night = finish(active),
      cold = view();
    begin(cold);
    expect(isDeepStrictEqual(night, finish(cold))).toBe(true);
    const flight = get(night, 'city3d-stairs:');
    expect(isDeepStrictEqual(flight, stairs)).toBe(false);
    expect('ground_z_m' in flight && 'ground_z_m' in stairs && flight.ground_z_m !== stairs.ground_z_m).toBe(true);
    const tread = (b: typeof flight) => {
      if (!('volumes' in b) || !b.volumes?.length) throw new Error('Missing stair flight mesh');
      return b.volumes[0].roof_mesh.faces[0].material;
    };
    expect(tread(flight)).not.toEqual(tread(stairs));
    expect(isDeepStrictEqual(get(night, 'yard:'), yard)).toBe(false);
  } finally {
    clock.mockRestore();
    vi.unstubAllGlobals();
  }
});
