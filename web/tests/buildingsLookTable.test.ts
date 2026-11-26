import { describe, expect, it } from 'vitest';
import type { PlacedBuilding, PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { city3dBuildings } from '../src/render/city3d/display';
import type { UrbanBuildingAppearance } from '../src/render/urbanBuildingStyle';
import { BlockGrouping, blockPart, meshKey, worldPaint, worldSeat } from '../src/render/world/buildingsBlocks';
import { BuildingColorSlots } from '../src/render/world/buildingsMesh';
import { BuildingLookTable } from '../src/render/world/buildingsLookTable';
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
  return { scene, grouping, block, seat, plain, custom };
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
