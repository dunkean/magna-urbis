/**
 * The town of the world view in blocks, without GL: which buildings each world block holds, where a vertex stands on
 * the terrain (the seat), the level of detail a block wants in a frame, and its vertices at that level. The GPU side is
 * buildingsLayer.ts.
 *
 * Blocks are 256 m squares (the separate 3D view's sector size), lot boundaries in blocks of their own; a building
 * belongs to the block of the centre of what it covers. Levels of detail are those of that view: a building block is
 * detailed or an overview (capped bodies) by the pixels its mean building spans; a block of lot boundaries has the
 * three yard levels (mesh, ribbon, wide ribbon). Farther than the 3D view drew, two more steps keep a large town cheap:
 * boxes (each building its footprint extruded to its height under a flat roof in its roof colour, about ten
 * triangles) once a building spans a few pixels, then nothing once it spans under a pixel: the map drape carries the
 * town plan there. Small structural features are kept at the detailed levels (the 3D view drops them by metres per
 * pixel, a rebuild per zoom octave).
 *
 * A block keeps its buildings cell by cell (BLOCK_CELLS x BLOCK_CELLS cells of 64 m), so every level of it holds them in
 * that order and a frame can give each part of a near block its own level: a range of the level's vertices per cell.
 *
 * Everything here runs in slices: the grouping (BlockGrouping.step) and the vertices of a block (blockPart, a range of
 * its buildings at a time), so a large town never holds the main thread for more than a few milliseconds.
 */
import { building3dHeight, isBuildingProjection, isYardMesh, yardLod, type Building3dScene, type Building3dVisual } from '../urbanBuildingGeometry';
import type { UrbanBuildingAppearance } from '../urbanBuildingStyle';
import { buildingBatches, buildingBounds, buildingGround, type BuildingBounds, type BuildingPaint, type BuildingSeat } from './buildingsMesh';
import type { WorldRelief } from './contract';
import type { VolumeTownLook } from '../city/buildingLook';

export const BUILDING_BLOCK = 256;
/** Cells of a block per side (64 m): the parts of a near block that take their own level. */
export const BLOCK_CELLS = 4;
export const BLOCK_CELL = BUILDING_BLOCK / BLOCK_CELLS;

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
  /** Levels of detail that have vertices: 0 detailed, 1 overview, 2 boxes; for yards the three yard levels. The level
   * `levels` (BLOCK_HIDDEN) draws nothing. */
  readonly levels: number;
  /** First building of each cell (row by row), and the end: the buildings are in cell order once grouped. */
  cells: Int32Array;
  /** The cell of each building while the grouping runs. */
  cellOf?: number[];
}

/** Buildings grouped between two looks at the clock. */
const GROUP_CHUNK = 64;

const span: [number, number] = [0, 0];
/** The heights a building covers as drawn at full relief (worldSeat), into `out` (low, high): a building on its own
 * ground, exaggerated as the terrain is; a structure or a yard on the terrain under the corners of its box. */
export function buildingSpan(building: Building3dVisual, box: BuildingBounds, relief: WorldRelief, exaggeration: number, out: [number, number]): void {
  const ground = buildingGround(building);
  if (Number.isFinite(ground)) {
    out[0] = (ground + Math.min(0, box[2] - ground)) * exaggeration;
    out[1] = ground * exaggeration + Math.max(0, box[5] - ground);
    return;
  }
  out[0] = Infinity;
  out[1] = -Infinity;
  for (let i = 0; i < 4; i++) {
    const t = relief.heightAt(box[i & 1 ? 3 : 0], box[i & 2 ? 4 : 1]);
    out[0] = Math.min(out[0], t - 1);
    out[1] = Math.max(out[1], t + (box[5] - box[2]));
  }
}

/** Groups the buildings of a scene into blocks, a chunk at a time: the grouping of a large town is spread over work
 * slices. */
export class BlockGrouping {
  readonly blocks: BuildingBlock[] = [];
  /** Town altitudes (TownAltitudes), gathered with the blocks. */
  readonly altitudes = new TownAltitudes();
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
        this.byKey.set(key, (block = { origin, buildings: [], yard, width: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, low: Infinity, high: -Infinity, levels: 3, cells: new Int32Array(BLOCK_CELLS * BLOCK_CELLS + 1), cellOf: [] }));
        this.blocks.push(block);
      }
      block.buildings.push(building);
      block.cellOf!.push(Math.min(BLOCK_CELLS - 1, Math.floor((cx - origin[0]) / BLOCK_CELL)) + BLOCK_CELLS * Math.min(BLOCK_CELLS - 1, Math.floor((cy - origin[1]) / BLOCK_CELL)));
      this.altitudes.add(building);
      block.width += yard ? 1 : Math.max(1, Math.min(box[3] - box[0], box[4] - box[1]));
      block.minX = Math.min(block.minX, box[0]);
      block.minY = Math.min(block.minY, box[1]);
      block.maxX = Math.max(block.maxX, box[3]);
      block.maxY = Math.max(block.maxY, box[4]);
      buildingSpan(building, box, relief, exaggeration, span);
      block.low = Math.min(block.low, span[0]);
      block.high = Math.max(block.high, span[1]);
      if (this.next % GROUP_CHUNK === 0 && performance.now() > deadline) return false;
    }
    if (this.next === buildings.length) {
      for (const block of this.blocks) {
        block.width /= block.buildings.length;
        // Cell order (counting sort): each level then holds a cell's buildings as one range of its vertices.
        const cellOf = block.cellOf!,
          cells = block.cells,
          sorted = new Array<Building3dVisual>(cellOf.length);
        for (const c of cellOf) cells[c + 1]++;
        for (let c = 0; c < BLOCK_CELLS * BLOCK_CELLS; c++) cells[c + 1] += cells[c];
        const fill = cells.slice(0, BLOCK_CELLS * BLOCK_CELLS);
        for (let i = 0; i < cellOf.length; i++) sorted[fill[cellOf[i]]++] = block.buildings[i];
        for (let i = 0; i < sorted.length; i++) block.buildings[i] = sorted[i];
        block.cellOf = undefined;
      }
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

/** The mean ground of each town, which sets the snow of its roofs: townRoofAltitudes (roofSnow.ts) gathered one
 * building at a time with the grouping, rather than in one pass over the scene (20 ms for 10,000 buildings). A
 * building of a layout (parcel id `layout-.../...`) belongs to that town, any other building is its own. */
export class TownAltitudes {
  private readonly towns = new Map<string, { sum: number; count: number }>();
  private readonly owners = new Map<string, string>();
  add(building: Building3dVisual): void {
    const prefix = building.parcel_id?.split('/')[0],
      owner = prefix?.startsWith('layout-') ? prefix : building.id;
    let town = this.towns.get(owner);
    if (!town) this.towns.set(owner, (town = { sum: 0, count: 0 }));
    if (Number.isFinite(building.ground_z_m)) {
      town.sum += building.ground_z_m;
      town.count++;
    }
    this.owners.set(building.id, owner);
  }
  get(id: string): number | undefined {
    const owner = this.owners.get(id),
      town = owner === undefined ? undefined : this.towns.get(owner);
    return town ? (town.count ? town.sum / town.count : 0) : undefined;
  }
}

/** What paints a scene's buildings in the world view: the flat-colour program (the textured one is the 3D view's), and
 * the top view's town look where the page gives it. */
export function worldPaint(scene: Building3dScene, appearance: UrbanBuildingAppearance, altitudes: TownAltitudes, look?: VolumeTownLook): BuildingPaint {
  return { appearance: { ...appearance, textured: false, ambience: undefined, lightsOn: undefined }, materials: scene.materials ?? [], snowAltitudes: altitudes, look };
}

/** The vertices of the buildings `from` to `to` of a block at a level, all groups in one array: a block of a dense town
 * is built in parts over several work slices, then copied part by part into one buffer (one draw). */
export function blockPart(block: BuildingBlock, level: number, paint: BuildingPaint, seat: BuildingSeat, from: number, to: number): Float32Array {
  const buildings = block.buildings.slice(from, to),
    batches = block.yard ? buildingBatches(buildings, block.origin, paint, level > 0, undefined, level, seat) : buildingBatches(level === BOX_LEVEL ? buildings.map(buildingBox) : buildings, block.origin, paint, level > 0, undefined, undefined, seat);
  return joinParts(batches.map(batch => batch.data));
}
function joinParts(parts: readonly Float32Array[]): Float32Array {
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

/** The level of a building block drawn as boxes. */
const BOX_LEVEL = 2;
/** The level that draws nothing: `block.levels`. */
export const blockHidden = (block: BuildingBlock): number => block.levels;

/** A building as a box: its footprint extruded from its ground to its height, with a flat roof of its roof cover (a
 * cartographic projection, which eachBuildingTriangle draws so, with the same id, culture and use, so the same paint).
 * Terrain structures (walls, bridges, quays) and projections stay as they are at their overview. */
function buildingBox(building: Building3dVisual): Building3dVisual {
  if (isBuildingProjection(building) || !Number.isFinite(buildingGround(building)) || !building.volumes.length) return building;
  return { ...building, projection: 'native-building-visual-1', height_m: building3dHeight(building), materials: building.volumes[0].materials, volumes: undefined, structural_features: undefined, structural_foundations: undefined } as unknown as Building3dVisual;
}

/** Pixels a building spans (its smaller side, the block's mean) from which it is drawn detailed (the 3D view's 7-10 px), as an overview (capped
 * bodies), as a box; under the last, nothing (the drape's town plan carries it). */
const LEVEL_PIXELS = [10, 6, 3];
/** Yards (pixels per metre): no lot boundary once a metre spans under a quarter pixel. */
const YARD_HIDDEN = 0.25;

/** Level of buildings of a block whose mean building spans `pixels` CSS px (per metre for yards), `blockHidden` for
 * nothing. `boxed`: the buildings are boxes however near (a fast look); yards keep their levels. No hysteresis: the
 * frame's budget (buildingsLayer.ts) moves the thresholds, and a level only ever changes over a whole cell. */
export function blockLevel(block: BuildingBlock, pixels: number, boxed = false): number {
  const hidden = blockHidden(block);
  if (block.yard) return pixels < YARD_HIDDEN ? hidden : yardLod(pixels, 0);
  for (let i = boxed ? BOX_LEVEL : 0; i < LEVEL_PIXELS.length; i++) if (pixels >= LEVEL_PIXELS[i]) return i;
  return hidden;
}
