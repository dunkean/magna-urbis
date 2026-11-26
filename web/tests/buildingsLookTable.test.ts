import { describe, expect, it } from 'vitest';
import type { PlacedBuilding, PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { city3dBuildings } from '../src/render/city3d/display';
import type { UrbanBuildingAppearance } from '../src/render/urbanBuildingStyle';
import { BlockGrouping, blockPart, meshKey, worldPaint, worldSeat } from '../src/render/world/buildingsBlocks';
import { BuildingColorSlots } from '../src/render/world/buildingsMesh';
import { BuildingLookTable } from '../src/render/world/buildingsLookTable';
import { TerrainHeights } from '../src/render/world/heights';

describe('look tables of the tilted town', () => {
  it('gives two looks the same meshes and different tables', () => {
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
});
