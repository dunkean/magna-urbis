import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { craftedIndianMassing } from './craftedIndianMassing';
import { craftedRoofRoom } from './craftedRoofRoom';

// The deepest veranda is 2.26 m; the tallest attic including its roof is 2.92 m.
// Shared town blocks can be culled before their detailed house meshes have been built.
export const CRAFTED_BLOCK_MARGIN = 3;
type Bounds = [number, number, number, number, number, number];
const cached = new WeakMap<PlacedBuilding, Bounds>();

/** Exact added extents for picking and for the standalone view's per-house bounds. */
export function includeCraftedMassing(building: PlacedBuilding, bounds: Bounds): void {
  let extra = cached.get(building);
  if (!extra) {
    const box: Bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const point = (x: number, y: number, z: number) => {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.min(box[2], z);
      box[3] = Math.max(box[3], x);
      box[4] = Math.max(box[4], y);
      box[5] = Math.max(box[5], z);
    };
    for (const p of craftedRoofRoom(building)?.mesh.vertices ?? []) point(p.x, p.y, p.z);
    for (const volume of building.volumes)
      craftedIndianMassing(building, volume, face => {
        for (const p of face.points) point(...p);
      });
    cached.set(building, box);
    extra = box;
  }
  for (let d = 0; d < 3; d++) {
    bounds[d] = Math.min(bounds[d], extra[d]);
    bounds[d + 3] = Math.max(bounds[d + 3], extra[d + 3]);
  }
}
