import { describe, expect, it, vi } from 'vitest';
import type { PlacedBuilding, PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { city3dBuildings } from '../src/render/city3d/display';
import type { UrbanBuildingAppearance } from '../src/render/urbanBuildingStyle';
import { BlockGrouping, blockPart, meshKey, worldPaint, worldSeat } from '../src/render/world/buildingsBlocks';
import { BuildingColorSlots, slotLooks } from '../src/render/world/buildingsMesh';
import { roofFrame } from '../src/render/city/buildingLook';
import { buildCityBuildings } from '../src/render/city/model/buildings';
import { massingSlots, paletteSlots } from '../src/render/city3d/materials';
import { BuildingLookTable } from '../src/render/world/buildingsLookTable';
import { BuildingBlockCache } from '../src/render/world/buildingsCache';
import { createWorldBuildingsLayer } from '../src/render/world/buildingsLayer';
import { GroundShape } from '../src/render/world/groundShape';
import type { Building3dScene, Building3dVisual } from '../src/render/urbanBuildingGeometry';
import { TerrainHeights } from '../src/render/world/heights';

function fixture() {
  const heights = new TerrainHeights(new Float32Array(16 * 16).fill(50), 16, 2000, 0, 1.5);
  const footprint = [
    {
      outer: [
        { x: 295, y: 296 },
        { x: 305, y: 296 },
        { x: 305, y: 304 },
        { x: 295, y: 304 },
      ],
      holes: [],
    },
  ];
  const house = {
    id: 'house-0',
    parcel_id: 'p0',
    recipe_id: 'silhouette',
    ground_z_m: 0,
    footprint,
    roof_footprint: footprint,
    transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 },
    culture: { culture: 'european-organic' },
    function: 'domestic',
    volumes: [],
    structural_features: [],
    programme: { role: 'house', massing: [{ floors: 2, eave_m: 6, rise_m: 4, roof: 'pyramid', ridges: [], cover: 'tile', wall: 'plaster', openings: 'none' }] },
  } as unknown as PlacedBuilding;
  const scene = city3dBuildings({ schema_version: '1', generator_version: 'silhouette', buildings: [house], refusals: [], open_spaces: [] } as PlacementBatch, { heightAt: () => 0 })!;
  const grouping = new BlockGrouping(scene, heights, heights.exaggeration);
  expect(grouping.step(Infinity)).toBe(true);
  const block = grouping.blocks[0],
    seat = worldSeat(heights, heights.exaggeration);
  const plain: UrbanBuildingAppearance = { style: 'cartographic', diagnostic: 'none' },
    custom: UrbanBuildingAppearance = { ...plain, colors: { building: '#204060' }, ambience: 'night' };
  return { source: house, scene, grouping, block, seat, plain, custom };
}

describe('look tables of the tilted town', () => {
  it('gives two looks the same meshes and different tables', () => {
    const { scene, grouping, block, seat, plain, custom } = fixture();
    // Another style, colour, ambience or season keeps the meshes of a geometry.
    expect(meshKey(custom, 'winter')).toBe(meshKey(plain, 'summer'));
    const slots = new BuildingColorSlots(),
      one = worldPaint(scene, plain, grouping.altitudes, undefined, slots),
      two = worldPaint(scene, custom, grouping.altitudes, undefined, slots);
    const mesh = blockPart(block, 0, one, seat, 0, block.buildings.length),
      count = slots.length;
    expect(count).toBeGreaterThan(0);
    expect(blockPart(block, 0, two, seat, 0, block.buildings.length)).toEqual(mesh);
    expect(slots.length).toBe(count);
    // Each look fills its own table from the same slots: the custom roof colour is in the second one only.
    const a = new BuildingLookTable('plain', one),
      b = new BuildingLookTable('custom', two);
    expect(a.fill(slots, Infinity)).toBe(true);
    expect(b.fill(slots, Infinity)).toBe(true);
    expect(Array.from(a.data.subarray(0, 4 * count))).not.toEqual(Array.from(b.data.subarray(0, 4 * count)));
  });

  it('paints each volume with its prescribed tint when two wall slots have the same material string', () => {
    const { source, scene, grouping, plain } = fixture();
    const house = scene.buildings[0],
      item = buildCityBuildings({ buildings: [source] }, undefined, { roofs: false }).items[0];
    const slots = new BuildingColorSlots(),
      frame = roofFrame({ palette: 'parchment', mpp: 1.1, dpr: 1, diagnostic: 'none' });
    const paint = worldPaint(scene, plain, grouping.altitudes, { frame, item: () => item }, slots);
    // The encoded timber colour uses a tone rounded to fifteenths. The town look reads each volume's full tone.
    const materials = [0.501, 0.565].map(tone => paletteSlots(massingSlots('timber', 'shingle', 'wood', 'wood'), 'european-organic', 'timber', 'shingle', tone, 'dwelling'));
    expect(materials[0].coating).toBe(materials[1].coating);
    for (const m of materials) slots.slot(house, { materials: m, normal: [1, 0, 0], surface: 'wall' }, m.coating, undefined, 0, false);
    const independent = new Float32Array(8),
      together = new Float32Array(8);
    slotLooks(slots, 0, 1, paint, independent);
    slotLooks(slots, 1, 2, paint, independent);
    expect(independent.subarray(0, 3)).not.toEqual(independent.subarray(4, 7));
    slotLooks(slots, 0, 2, paint, together);
    expect(together).toEqual(independent);
  });

  it('keeps box slots owned by the original house across rebuilds and frees them on removal', () => {
    const { scene, grouping, block, seat, plain } = fixture();
    const slots = new BuildingColorSlots(),
      paint = worldPaint(scene, plain, grouping.altitudes, undefined, slots);
    const mesh = blockPart(block, 2, paint, seat, 0, 1),
      count = slots.length;
    expect(count).toBeGreaterThan(0);
    slots.retainBuildings(scene.buildings);
    expect(slots.list.every(slot => slot?.building.id === scene.buildings[0].id)).toBe(true);
    expect(blockPart(block, 2, paint, seat, 0, 1)).toEqual(mesh);
    expect(slots.length).toBe(count);
    slots.retainBuildings([]);
    expect(slots.list.every(slot => slot === undefined)).toBe(true);
  });

  it('retains completed blocks across a pending edit, respecting membership, sampled ground and context loss', () => {
    const { plain, scene: template } = fixture();
    const heights = new TerrainHeights(new Float32Array(16).fill(10), 4, 2048, 0, 2);
    const house = (id: string, x: number, half = 4): Building3dVisual => {
      const surface = [
        {
          outer: [
            { x: x - half, y: 50 },
            { x: x + half, y: 50 },
            { x: x + half, y: 60 },
            { x: x - half, y: 60 },
          ],
          holes: [],
        },
      ];
      return {
        id,
        parcel_id: 'layout-test/' + id,
        variant_id: 'test',
        recipe_id: 'test',
        culture: template.buildings[0].culture,
        function: 'domestic',
        footprint: surface,
        roof_footprint: surface,
        ground_z_m: 10,
        height_m: 8,
        useful_area_m2: 80,
        domestic_units: 1,
        projection: 'native-building-visual-1',
        nativeRealization: false,
        occupation_surfaces: [surface],
        ground_constraints: [],
      };
    };
    const old = house('edited', 40),
      removed = house('removed', 350),
      kept = house('kept', 600);
    // This bridge is grouped in block 3, but its east vertices sample the shaped ground of block 4.
    const bridge = house('city3d-bridge-cross', 1018, 12);
    let scene: Building3dScene | undefined = { buildings: [old, removed, kept, bridge] },
      composing = false;
    const gl = new Proxy({} as WebGL2RenderingContext, {
      get(target, name) {
        const fn = String(name),
          t = target as unknown as Record<string, unknown>;
        return (t[fn] ??= fn.startsWith('create') ? () => ({}) : fn === 'getProgramParameter' ? () => true : () => undefined);
      },
    });
    const setup = vi.spyOn(BuildingBlockCache.prototype, 'setBlocks');
    const layer = createWorldBuildingsLayer(gl, { scene: () => scene, composing: () => composing, appearance: () => plain, terrain: () => heights, invalidate() {} });
    const drain = () => {
      while (layer.work!(Infinity, undefined)) {}
    };
    const levels = () => new Map((setup.mock.contexts.at(-1) as BuildingBlockCache).slots.map(slot => [slot.block.buildings[0].id, slot.levels[2]?.vao]));
    try {
      drain();
      const before = levels();
      expect(before.size).toBe(4);
      composing = true;
      scene = undefined;
      drain();
      expect(layer.pick([600, 55, 100], [0, 0, -1], 1, 200, () => true)).toBeUndefined();
      heights.shape = new GroundShape(heights.width);
      heights.shape.level(515, 25, 4);
      // The edited house now occupies the removed house's former block.
      const moved = house('edited', 351);
      scene = { buildings: [kept, moved, bridge] };
      composing = false;
      drain();
      const after = levels();
      expect([...after.keys()]).toEqual(['kept', 'edited', bridge.id]);
      expect(after.get('kept')).toBeDefined();
      expect(after.get('kept')).toBe(before.get('kept'));
      expect(after.get('edited')).not.toBe(before.get('removed'));
      expect(after.get(bridge.id)).not.toBe(before.get(bridge.id));
      composing = true;
      scene = undefined;
      drain();
      layer.contextLost!();
      composing = false;
      scene = { buildings: [kept] };
      drain();
      expect(levels().get('kept')).not.toBe(after.get('kept'));
      expect(levels().get('kept')).toBeDefined();
    } finally {
      layer.dispose();
      setup.mockRestore();
    }
  });

  it('reuses removed buildings’ slots and repaints an existing look without growing it', () => {
    const { scene, grouping, block, seat, plain } = fixture();
    const slots = new BuildingColorSlots(),
      paint = worldPaint(scene, plain, grouping.altitudes, undefined, slots);
    blockPart(block, 0, paint, seat, 0, block.buildings.length);
    const table = new BuildingLookTable('plain', paint);
    table.fill(slots, Infinity);
    const count = slots.length,
      old = slots.list[0]!,
      kept = { ...old.building, id: 'kept' };
    const keptIndex = slots.slot(kept, old, old.raw, old.aperture, old.share, old.project);
    slots.retainBuildings([kept]);
    const replacement = { ...old.building },
      index = slots.slot(replacement, old, '#25ed60', old.aperture, old.share, old.project);
    expect(index).toBeLessThan(count);
    expect(slots.length).toBe(count + 1);
    expect(slots.list[keptIndex]?.building).toBe(kept);
    expect(slots.list[index]?.building).toBe(replacement);
    for (const reused of slots.takeReused()!) table.invalidate(reused);
    expect(table.fill(slots, Infinity)).toBe(true);
    const fresh = new BuildingLookTable('fresh', paint);
    fresh.fill(slots, Infinity);
    expect(table.data.slice(index * 4, index * 4 + 4)).toEqual(fresh.data.slice(index * 4, index * 4 + 4));
  });
});
