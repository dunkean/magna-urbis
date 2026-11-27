import { vi } from 'vitest';
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { city3dBuildings } from '../../src/render/city3d/display';
import { createWorldBuildingsLayer } from '../../src/render/world/buildingsLayer';
import { TerrainHeights } from '../../src/render/world/heights';

/** A relief of n x n control heights over `width` metres: a slope up to the east plus a hill. */
export function relief(width: number, n = 64, exaggeration = 1.5): TerrainHeights {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = 40 + (i / n) * 120 + 30 * Math.sin((j / n) * 6);
  return new TerrainHeights(data, n, width, 0, exaggeration);
}
/** The ground of the display scene: the relief in real metres (v2/display/worldVolumes.ts). */
export const rawOf =
  (heights: TerrainHeights) =>
  (x: number, y: number): number =>
    heights.heightAt(x, y) / heights.exaggeration;
/** Silhouette records of `count` houses on a grid (pyramid roofs on two-storey bodies), placed as the city sends them
 * (ui/urbanSilhouettes.ts): footprints in map metres, the placement origin at the map's corner. */
export function sources(count: number, spacing = 25, origin = 300): PlacedBuilding[] {
  const side = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, k) => {
    const x = origin + (k % side) * spacing,
      y = origin + Math.floor(k / side) * spacing,
      footprint = [
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
    const source = {
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
    return source;
  });
}
export const batch = (buildings: PlacedBuilding[]): PlacementBatch => ({ schema_version: '1', generator_version: 'silhouette', buildings, refusals: [], open_spaces: [] });
/** A WebGL2 context that records nothing and answers every query. */
export function mockGl(): WebGL2RenderingContext {
  return new Proxy({} as WebGL2RenderingContext, {
    get: (target, name) => {
      const t = target as unknown as Record<string | symbol, unknown>;
      if (!(name in t)) t[name] = name === 'getProgramParameter' || name === 'getShaderParameter' ? vi.fn(() => true) : String(name).startsWith('create') || name === 'getUniformLocation' ? vi.fn(() => ({})) : vi.fn();
      return t[name];
    },
  });
}

export function overviewTown() {
  const heights = relief(40000, 128);
  const scene = city3dBuildings(batch(sources(10000, 22, 18900)), { heightAt: rawOf(heights) })!;
  const gl = mockGl();
  const createLayer = () => createWorldBuildingsLayer(gl, { scene: () => scene, appearance: () => ({ style: 'cartographic', diagnostic: 'none' }), terrain: () => heights, invalidate: () => {} });
  return { heights, gl, createLayer };
}
