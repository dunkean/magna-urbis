/**
 * The town of the world view in blocks, without GL: which buildings each world block holds, where a vertex stands on
 * the terrain (the seat), the level of detail a block wants in a frame, and its vertices at that level. The GPU side is
 * buildingsLayer.ts.
 *
 * Blocks are 256 m squares (the separate 3D view's sector size), lot boundaries in blocks of their own; a building
 * belongs to the block of the centre of what it covers. Levels of detail are those of that view: a building block is
 * detailed or an overview (capped bodies) by the pixels its mean building spans; a block of lot boundaries has the
 * three yard levels (mesh, ribbon, wide ribbon). Small structural features are kept at every level (the 3D view drops
 * them by metres per pixel, a rebuild per zoom octave).
 *
 * Everything here runs in slices: the grouping (BlockGrouping.step) and the vertices of a block (blockPart, a range of
 * its buildings at a time), so a large town never holds the main thread for more than a few milliseconds.
 */
import { isYardMesh, yardLod, type Building3dScene, type Building3dVisual } from '../urbanBuildingGeometry';
import type { UrbanBuildingAppearance } from '../urbanBuildingStyle';
import { townRoofAltitudes } from '../roofSnow';
import { buildingBatches, buildingBounds, buildingGround, type BuildingPaint, type BuildingSeat } from './buildingsMesh';
import type { WorldRelief } from './contract';

export const BUILDING_BLOCK = 256;

export interface BuildingBlock {
  /** North-west corner (map metres, x east, y south): the origin of the block-local vertex positions. */
  readonly origin: [number, number];
  readonly buildings: Building3dVisual[];
  /** Lot boundaries only: three yard levels instead of detailed / overview. */
  readonly yard: boolean;
  /** Mean of the smaller side of the buildings (m); 1 for a yard block, whose pixels are then pixels per metre. */
  width: number;
  /** Extent in map metres; heights as drawn at full relief: seat + height above it. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  low: number;
  high: number;
  /** Levels of detail: 2 for buildings (0 detailed, 1 overview), 3 for yards. */
  readonly levels: number;
}

/** Buildings grouped between two looks at the clock. */
const GROUP_CHUNK = 64;

/** Groups the buildings of a scene into blocks, a chunk at a time: the grouping of a large town is spread over work
 * slices. */
export class BlockGrouping {
  readonly blocks: BuildingBlock[] = [];
  private readonly byKey = new Map<string, BuildingBlock>();
  private next = 0;

  constructor(
    private readonly scene: Building3dScene,
    private readonly relief: WorldRelief,
    private readonly exaggeration: number,
  ) {}

  /** Groups buildings until `deadline` (performance.now()); true once every building has its block. */
  step(deadline: number): boolean {
    const buildings = this.scene.buildings,
      relief = this.relief,
      exaggeration = this.exaggeration;
    while (this.next < buildings.length) {
      const building = buildings[this.next++],
        box = buildingBounds(building),
        // The centre of what the building covers (the placement origin of a silhouette is the map's corner).
        cx = (box[0] + box[3]) / 2,
        cy = (box[1] + box[4]) / 2,
        yard = isYardMesh(building),
        origin: [number, number] = [Math.floor(cx / BUILDING_BLOCK) * BUILDING_BLOCK, Math.floor(cy / BUILDING_BLOCK) * BUILDING_BLOCK],
        key = `${origin}${yard ? '/yard' : ''}`;
      let block = this.byKey.get(key);
      if (!block) {
        this.byKey.set(key, (block = { origin, buildings: [], yard, width: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, low: Infinity, high: -Infinity, levels: yard ? 3 : 2 }));
        this.blocks.push(block);
      }
      block.buildings.push(building);
      block.width += yard ? 1 : Math.max(1, Math.min(box[3] - box[0], box[4] - box[1]));
      block.minX = Math.min(block.minX, box[0]);
      block.minY = Math.min(block.minY, box[1]);
      block.maxX = Math.max(block.maxX, box[3]);
      block.maxY = Math.max(block.maxY, box[4]);
      // Heights as drawn (worldSeat): a building on its ground; a structure or a yard on the terrain under its corners.
      const ground = buildingGround(building);
      let low = Infinity,
        high = -Infinity;
      if (Number.isFinite(ground)) {
        low = (ground + Math.min(0, box[2] - ground)) * exaggeration;
        high = ground * exaggeration + Math.max(0, box[5] - ground);
      } else
        for (const [x, y] of [
          [box[0], box[1]],
          [box[3], box[1]],
          [box[0], box[4]],
          [box[3], box[4]],
        ]) {
          const t = relief.heightAt(x, y);
          low = Math.min(low, t - 1);
          high = Math.max(high, t + (box[5] - box[2]));
        }
      block.low = Math.min(block.low, low);
      block.high = Math.max(block.high, high);
      if (this.next % GROUP_CHUNK === 0 && performance.now() > deadline) return false;
    }
    if (this.next === buildings.length) {
      for (const block of this.blocks) block.width /= block.buildings.length;
      this.next++;
    }
    return true;
  }
}

/** Where a vertex stands in the world view: `out[0]` its height above its seat (m), `out[1]` the seat (metres as drawn
 * at full relief). A building stands rigid on its ground, exaggerated as the terrain is: the display scene of the world
 * view is seated on TerrainHeights (v2/display/worldVolumes.ts), so that ground is the drawn surface's. Its walls keep
 * their real height; its footing below the ground is exaggerated with the slope it fills, as the 3D view does. A lot
 * boundary follows the terrain under each of its points; a terrain structure (wall, bridge, quay) keeps its height
 * above the terrain drawn there. */
export function worldSeat(relief: WorldRelief, exaggeration: number): BuildingSeat {
  const unit = exaggeration > 0 ? 1 / exaggeration : 1;
  return (_building, ground, x, y, z, faceGround, out) => {
    if (faceGround === undefined && Number.isFinite(ground)) {
      out[0] = z >= ground ? z - ground : (z - ground) * exaggeration;
      out[1] = ground * exaggeration;
      return;
    }
    const t = relief.heightAt(x, y);
    out[0] = z - (faceGround ?? t * unit);
    out[1] = t;
  };
}

/** What paints a scene's buildings in the world view: the flat-colour program (the textured one is the 3D view's). */
export function worldPaint(scene: Building3dScene, appearance: UrbanBuildingAppearance): BuildingPaint {
  return { appearance: { ...appearance, textured: false, ambience: undefined, lightsOn: undefined }, materials: scene.materials ?? [], snowAltitudes: townRoofAltitudes(scene.buildings) };
}

/** The vertices of the buildings `from` to `to` of a block at a level, all groups in one array: a block of a dense town
 * is built in parts over several work slices, then joined (joinParts) into one buffer and one draw. */
export function blockPart(block: BuildingBlock, level: number, paint: BuildingPaint, seat: BuildingSeat, from: number, to: number): Float32Array {
  const buildings = block.buildings.slice(from, to),
    batches = block.yard ? buildingBatches(buildings, block.origin, paint, level > 0, undefined, level, seat) : buildingBatches(buildings, block.origin, paint, level > 0, undefined, undefined, seat);
  return joinParts(batches.map(batch => batch.data));
}
export function joinParts(parts: readonly Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0];
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Float32Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Level a block wants for `pixels`, the screen size of its mean building (CSS px; per metre for yards), given the level
 * it shows now (hysteresis, as the 3D view: overview below 7 px, back to detailed above 10). */
export function blockLevel(block: BuildingBlock, pixels: number, current: number): number {
  if (block.yard) return yardLod(pixels, current);
  return (current === 1 ? pixels < 10 : pixels < 7) ? 1 : 0;
}
