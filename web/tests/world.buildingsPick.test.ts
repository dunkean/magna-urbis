import { describe, expect, it } from 'vitest';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { city3dBuildings } from '../src/render/city3d/display';
import { BlockGrouping } from '../src/render/world/buildingsBlocks';
import { pickBuilding, rayBox } from '../src/render/world/buildingsPick';
import { createCameraPose, groundHit, pixelRay, poseCamera, screenProjection } from '../src/render/world/camera';
import { TerrainHeights } from '../src/render/world/heights';
import type { View } from '../src/render/view';

const W = 1600,
  H = 900;
/** A gentle slope up to the east over 4 km. */
function relief(n = 32, exaggeration = 1.5): TerrainHeights {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = 40 + (i / n) * 60;
  return new TerrainHeights(data, n, 4000, 0, exaggeration);
}
/** Houses 10 x 8 m, two storeys, at the given centres (silhouette records, as the city sends them). */
function houses(centres: [number, number][]): PlacementBatch {
  const buildings = centres.map(([x, y], k) => {
    const footprint = [
      {
        outer: [
          { x: x - 5, y: y - 4 },
          { x: x + 5, y: y - 4 },
          { x: x + 5, y: y + 4 },
          { x: x - 5, y: y + 4 },
        ],
        holes: [],
      },
    ];
    return {
      id: `house-${k}`,
      parcel_id: `p${k}`,
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
  });
  return { schema_version: '1', generator_version: 'silhouette', buildings, refusals: [], open_spaces: [] };
}

describe('building picking', () => {
  it('finds where a ray enters a box', () => {
    expect(rayBox([0, 0, 0], [1, 0, 0], 2, -1, -1, 3, 1, 1)).toBe(2);
    expect(rayBox([2.5, 0, 0], [1, 0, 0], 2, -1, -1, 3, 1, 1)).toBe(0);
    expect(rayBox([0, 0, 0], [-1, 0, 0], 2, -1, -1, 3, 1, 1)).toBe(Infinity);
    expect(rayBox([0, 2, 0], [1, 0, 0], 2, -1, -1, 3, 1, 1)).toBe(Infinity);
    expect(rayBox([0, 0, 10], [1, 0, -4], 2, -1, -1, 3, 1, 1)).toBe(2.25);
    expect(rayBox([0, 0, 10], [1, 0, -2], 2, -1, -1, 3, 1, 1)).toBe(Infinity);
  });

  it('picks the house under a pixel of a tilted view, the nearest one, and not behind the ground', () => {
    const heights = relief(),
      raw = (x: number, y: number): number => heights.heightAt(x, y) / heights.exaggeration;
    // A row of houses northwards from (2000, 2000), and one far to the east.
    const scene = city3dBuildings(
        houses([
          [2000, 2000],
          [2000, 1975],
          [2000, 1950],
          [2600, 2000],
        ]),
        { heightAt: raw },
      )!,
      grouping = new BlockGrouping(scene, heights, heights.exaggeration);
    expect(grouping.step(Infinity)).toBe(true);
    const blocks = grouping.blocks,
      view: View = { cx: 2000, cy: 1975, scale: 4, pitch: 1, yaw: 0 },
      pose = poseCamera(createCameraPose(), view, H, heights),
      projection = screenProjection(view, W, H, heights),
      ray = new Float64Array(3),
      point: [number, number] = [0, 0],
      pixel: [number, number] = [0, 0];
    const pickAt = (x: number, y: number, accept = (): boolean => true) => {
      expect(projection.project(x, y, pixel)).toBe(true);
      pixelRay(pose, pixel[0], pixel[1], W, H, ray);
      const ground = groundHit(pose, pixel[0], pixel[1], W, H, heights, point);
      return pickBuilding(blocks, pose.eye, ray, pose.rise, heights, heights.exaggeration, ground, accept);
    };
    // The middle house's footprint centre: the ray meets the nearest house standing over it (the camera looks north,
    // the house south of it is in front), so a click on the middle one's ground finds the one in front or itself.
    const middle = pickAt(2000, 1975)!;
    expect(middle).toBeDefined();
    expect(['house-0', 'house-1']).toContain(middle.building.id);
    // The far house to the east, alone: found.
    expect(pickAt(2600, 2000)?.building.id).toBe('house-3');
    // Refused by the caller (not a town building): nothing else stands there.
    expect(pickAt(2600, 2000, () => false)).toBeUndefined();
    // Bare ground between them: nothing.
    expect(pickAt(2300, 1990)).toBeUndefined();
    // The ground before the house hides it: a limit shorter than the house's entry finds nothing.
    expect(pickAt(2600, 2000)!.t).toBeGreaterThan(0);
    pixelRay(pose, pixel[0], pixel[1], W, H, ray);
    expect(pickBuilding(blocks, pose.eye, ray, pose.rise, heights, heights.exaggeration, 1, () => true)).toBeUndefined();
  });
});
