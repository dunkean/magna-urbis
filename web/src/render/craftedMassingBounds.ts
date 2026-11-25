import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { craftedRoofMesh } from './craftedRoofMesh';
import { ruralSiteDetails } from './ruralSiteDetail';
import { siteCrown } from './siteCrown';
import { detailedHouseFront } from './houseFronts';
import { craftedIndianMassing } from './craftedIndianMassing';
import { craftedRoofRoom } from './craftedRoofRoom';

// Allow for projected entrances, parapets and the raised capstones on giant dwellings.
// Shared town blocks can be culled before their detailed house meshes have been built.
export const CRAFTED_BLOCK_MARGIN = 5;
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
    if (building.culture?.culture === 'myconid-colony')
      for (const v of building.volumes) {
        const mesh = craftedRoofMesh(v, 'myconid-colony');
        if (mesh !== v.roof_mesh)
          for (const face of mesh.faces)
            for (const index of face.vertices) {
              const p = mesh.vertices[index];
              point(p.x, p.y, p.z);
            }
      }
    for (const [v, work] of ruralSiteDetails(building) ?? []) if (v === work.volume) for (const p of work.mesh.vertices) point(p.x, p.y, p.z);
    for (const p of siteCrown(building)?.mesh.vertices ?? []) point(p.x, p.y, p.z);
    for (const p of detailedHouseFront(building)?.mesh.vertices ?? []) point(p.x, p.y, p.z);
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
