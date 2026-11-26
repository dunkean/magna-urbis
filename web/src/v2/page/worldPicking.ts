/**
 * Picking on the map with one camera: what a click selects at a pixel, in the top view or tilted, as world
 * coordinates and the town building the inspectors expect. The top view keeps the 2D mapping and the footprint test
 * (`buildingAt`); a tilted view takes the camera's ray: the building volume in front of the ground (render/world/
 * buildingsPick.ts), else the ground point under the pixel. Called by toolbar.ts for the map click.
 */
import type { UrbanBuilding, Vec2, World } from '../../gen/types';
import { inscribed } from '../../gen/geo/poly';
import { buildingAt, townUrban } from '../edits';
import type { PageState } from './contract';

export type TownBuilding = { settlement: string; index: number; building: UrbanBuilding };
type NativeBuilding = UrbanBuilding & { nativeId?: string };

/** What a click on the map means: the point under the pixel (on the volume's box when one stands in front of the
 * ground), the town building of that volume, a point inside the volume's footprint (`site`: the lot, block, quarter and
 * town the building stands in, wherever the ray met its box) and the metres a pixel spans there. */
export interface MapPoint {
  point: Vec2;
  building?: TownBuilding;
  site?: Vec2;
  metresPerPixel: number;
}

/** The id of the volume that stands for a town building in the tilted view: the native building's (`nativeId`).
 * Buildings of the other engines have no volume. */
export const buildingVolumeId = (building: UrbanBuilding): string | undefined => (building as NativeBuilding).nativeId;

/** The town buildings by the id their volume carries. */
function townBuildingsById(world: World): Map<string, TownBuilding> {
  const byId = new Map<string, TownBuilding>();
  for (const settlement of world.settlements ?? []) {
    const urban = townUrban(world, settlement.key);
    urban?.buildings.forEach((building, index) => {
      const id = buildingVolumeId(building);
      if (id !== undefined && !byId.has(id)) byId.set(id, { settlement: settlement.key, index, building });
    });
  }
  return byId;
}

/** A point well inside a footprint (its pole of inaccessibility), even for an L or a ring. */
const inside = (outer: Vec2[], holes: Vec2[][] = []): Vec2 => inscribed(outer, holes, 0.25).c;

/** What the map shows under the CSS pixel (sx, sy) of a `w` x `h` map. Every volume stops the ray; its town building is
 * the one with its id, else the one whose footprint holds the volume's (a volume of another id over a town lot).
 * Undefined when the pixel shows no ground. */
export function pickOnMap(state: PageState, sx: number, sy: number, w: number, h: number): MapPoint | undefined {
  const world = state.world;
  if (!world) return undefined;
  const picked = state.client.pickAt(sx, sy, w, h);
  if (!picked) return undefined;
  const point = { x: picked.x, y: picked.y },
    volume = picked.building,
    metresPerPixel = picked.metresPerPixel;
  if (!volume) return { point, metresPerPixel };
  const shape = volume.footprint.find(polygon => polygon.outer.length >= 3),
    under = shape ? inside(shape.outer, shape.holes) : point,
    building = townBuildingsById(world).get(volume.id) ?? buildingAt(world, under) ?? undefined;
  return { point, building, site: building ? inside(building.building.poly, building.building.courtyards) : under, metresPerPixel };
}
