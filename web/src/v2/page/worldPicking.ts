/**
 * Picking on the map with one camera: what a click selects at a pixel, in the top view or tilted, as world
 * coordinates and the town building the inspectors expect. The top view keeps the 2D mapping and the footprint test
 * (`buildingAt`); a tilted view takes the camera's ray: the building volume in front of the ground (render/world/
 * buildingsPick.ts), else the ground point under the pixel. Called by toolbar.ts for the map click.
 */
import type { UrbanBuilding, World } from '../../gen/types';
import { townUrban } from '../edits';
import type { PageState } from './contract';

export type TownBuilding = { settlement: string; index: number; building: UrbanBuilding };
type NativeBuilding = UrbanBuilding & { nativeId?: string };

/** The town buildings by the id their volume carries (`nativeId`), as the separate 3D view's selection found them. */
function townBuildingsById(world: World): Map<string, TownBuilding> {
  const byId = new Map<string, TownBuilding>();
  for (const settlement of world.settlements ?? []) {
    const urban = townUrban(world, settlement.key);
    urban?.buildings.forEach((building, index) => {
      const id = (building as NativeBuilding).nativeId;
      if (id !== undefined && !byId.has(id)) byId.set(id, { settlement: settlement.key, index, building });
    });
  }
  return byId;
}

/** What the map shows under the CSS pixel (sx, sy) of a `w` x `h` map: the world point a click means, and the town
 * building whose volume stands in front of the ground there (tilted only). Undefined when the pixel shows no ground. */
export function pickOnMap(state: PageState, sx: number, sy: number, w: number, h: number): { point: { x: number; y: number }; building?: TownBuilding } | undefined {
  const world = state.world;
  if (!world) return undefined;
  let byId: Map<string, TownBuilding> | undefined;
  const picked = state.client.pickAt(sx, sy, w, h, volume => (byId ??= townBuildingsById(world)).has(volume.id));
  if (!picked) return undefined;
  return { point: { x: picked.x, y: picked.y }, building: picked.building ? byId?.get(picked.building.id) : undefined };
}
