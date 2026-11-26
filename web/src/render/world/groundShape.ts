/**
 * The ground of the towns of the tilted map, shaped for what stands on it: buildings sunk into the slopes and hillside lots
 * levelled (ui/urbanGroundShape.ts) and moats dug by their depth (ui/urbanGroundCuts.ts), the rules of the separate 3D view.
 *
 * One product per town content, made in steps by v2/display/worldVolumes.ts and hung on the relief (heights.ts
 * `TerrainHeights.shape`): a grid of SHAPE_STEP metres over the blocks of SHAPE_BLOCK metres where the ground moves, two
 * heights per node above the natural ground. `ground` is the levelled ground that houses, streets, walls, fences, bridges
 * and quays stand on; `drawn` is that ground with the moats dug, what the terrain mesh shows and what the camera, picking
 * and the trees read. The terrain shader reads the same nodes with the same interpolation (groundShapeTexture.ts), so
 * everything seated on the relief stands on the ground as it is drawn.
 *
 * The same blocks carry the squeeze of the regional roads that cross steep slopes (render/steepRoads.ts): no ground moves
 * there, the terrain shader draws the map squeezed across the road, per pixel, so a road draped from above (mapDrape.ts)
 * keeps its width on a cliff. Its field is linear across a road: nodes of SQUEEZE_STEP metres hold it.
 */
import { RoadSqueeze, type SteepRoad } from '../steepRoads';
import { UrbanGroundShape, type GroundShapeLot } from '../../ui/urbanGroundShape';
import type { UrbanGroundCuts } from '../../ui/urbanGroundCuts';

/** Side of a block and spacing of its nodes (m). A block holds the nodes of its four edges: neighbours repeat them. */
export const SHAPE_BLOCK = 256,
  SHAPE_STEP = 2;
const CELLS = SHAPE_BLOCK / SHAPE_STEP;
export const SHAPE_SIDE = CELLS + 1;
/** Spacing of the nodes of the road squeeze (m), and nodes along the side of a block. */
export const SQUEEZE_STEP = 4;
const SQUEEZE_CELLS = SHAPE_BLOCK / SQUEEZE_STEP;
export const SQUEEZE_SIDE = SQUEEZE_CELLS + 1;
/** Blocks a map may shape (33 kB of texture each); the towns met first keep theirs. */
const MAX_BLOCKS = 1024;
/** A node that moves less is left on the natural ground (m). */
const LEAST = 0.01;
/** Lots and buildings shaped, and moat nodes dug, between two steps. */
const LOTS_PER_STEP = 8,
  NODES_PER_STEP = 1024;

export class GroundShape {
  /** Heights of the nodes above the natural ground, row by row from the north-west corner of each block. */
  readonly ground: Float32Array[] = [];
  readonly drawn: Float32Array[] = [];
  /** Road squeeze of the blocks a steep road crosses: four floats per node (RoadSqueeze.at), row by row. */
  readonly squeeze: (Float32Array | undefined)[] = [];
  /** Some road is squeezed. */
  squeezed = false;
  /** Blocks per side of the map; `index` gives the layer of a block, -1 where the ground is natural. */
  readonly side: number;
  readonly index: Int16Array;
  /** Deepest cut and highest fill of the drawn ground (m). */
  low = 0;
  high = 0;

  constructor(width: number) {
    this.side = Math.max(1, Math.ceil(width / SHAPE_BLOCK));
    this.index = new Int16Array(this.side * this.side).fill(-1);
  }
  get empty(): boolean {
    return !this.ground.length;
  }
  groundAt(x: number, y: number): number {
    return this.sample(this.ground, x, y);
  }
  drawnAt(x: number, y: number): number {
    return this.sample(this.drawn, x, y);
  }
  /** Moves the levelled ground at node (i, j) of the map's grid. */
  level(i: number, j: number, move: number): void {
    if (Math.abs(move) >= LEAST) this.write(i, j, move, false);
  }
  /** Digs the drawn ground at node (i, j) by `depth` under the levelled ground; a negative depth raises it (the outer bank of a moat). */
  dig(i: number, j: number, depth: number): void {
    if (Math.abs(depth) >= LEAST) this.write(i, j, depth, true);
  }

  /** Writes the road squeeze of node (i, j) of the SQUEEZE_STEP grid into every block that holds it. */
  squeezeNode(i: number, j: number, field: Float32Array): void {
    const bx = Math.floor(i / SQUEEZE_CELLS),
      by = Math.floor(j / SQUEEZE_CELLS);
    for (let y = j === by * SQUEEZE_CELLS ? by - 1 : by; y <= by; y++)
      for (let x = i === bx * SQUEEZE_CELLS ? bx - 1 : bx; x <= bx; x++) {
        const layer = this.layer(x, y);
        if (layer < 0) continue;
        (this.squeeze[layer] ??= new Float32Array(SQUEEZE_SIDE * SQUEEZE_SIDE * 4)).set(field, ((j - y * SQUEEZE_CELLS) * SQUEEZE_SIDE + i - x * SQUEEZE_CELLS) * 4);
        this.squeezed = true;
      }
  }

  private sample(nodes: readonly Float32Array[], x: number, y: number): number {
    const bx = Math.floor(x / SHAPE_BLOCK),
      by = Math.floor(y / SHAPE_BLOCK);
    if (bx < 0 || by < 0 || bx >= this.side || by >= this.side) return 0;
    const layer = this.index[by * this.side + bx];
    if (layer < 0) return 0;
    const gx = (x - bx * SHAPE_BLOCK) / SHAPE_STEP,
      gy = (y - by * SHAPE_BLOCK) / SHAPE_STEP,
      i = Math.min(CELLS - 1, Math.floor(gx)),
      j = Math.min(CELLS - 1, Math.floor(gy)),
      fx = gx - i,
      fy = gy - j,
      d = nodes[layer],
      at = j * SHAPE_SIDE + i;
    return (d[at] * (1 - fx) + d[at + 1] * fx) * (1 - fy) + (d[at + SHAPE_SIDE] * (1 - fx) + d[at + SHAPE_SIDE + 1] * fx) * fy;
  }
  /** Writes a node into every block that holds it: one, two along an edge, four at a corner. */
  private write(i: number, j: number, value: number, dug: boolean): void {
    const bx = Math.floor(i / CELLS),
      by = Math.floor(j / CELLS);
    for (let y = j === by * CELLS ? by - 1 : by; y <= by; y++)
      for (let x = i === bx * CELLS ? bx - 1 : bx; x <= bx; x++) {
        const layer = this.layer(x, y);
        if (layer < 0) continue;
        const at = (j - y * CELLS) * SHAPE_SIDE + i - x * CELLS;
        if (!dug) this.ground[layer][at] = this.drawn[layer][at] = value;
        else this.drawn[layer][at] = this.ground[layer][at] - value;
        this.low = Math.min(this.low, this.drawn[layer][at]);
        this.high = Math.max(this.high, this.drawn[layer][at]);
      }
  }
  private layer(bx: number, by: number): number {
    if (bx < 0 || by < 0 || bx >= this.side || by >= this.side) return -1;
    const key = by * this.side + bx;
    if (this.index[key] >= 0) return this.index[key];
    if (this.ground.length >= MAX_BLOCKS) return -1;
    this.ground.push(new Float32Array(SHAPE_SIDE * SHAPE_SIDE));
    this.drawn.push(new Float32Array(SHAPE_SIDE * SHAPE_SIDE));
    this.squeeze.push(undefined);
    return (this.index[key] = this.ground.length - 1);
  }
}

/** The shaped ground of the lots to level (per town) and of the moats, and the squeeze of the regional `roads` on steep
 * slopes, over a map of `width` metres whose natural ground is `natural` (m); undefined when no ground moves and no road
 * is squeezed. In steps of a few milliseconds. */
export function* groundShapeSteps(width: number, towns: Iterable<readonly GroundShapeLot[]>, cuts: UrbanGroundCuts, natural: (x: number, y: number) => number, roads: readonly SteepRoad[] = []): Generator<void, GroundShape | undefined> {
  const shape = new GroundShape(width),
    last = Math.floor(width / SHAPE_STEP),
    all = [...towns];
  for (let t = 0; t < all.length; t++) {
    const lots = all[t],
      platforms = new UrbanGroundShape([], natural),
      // Overlapping boxes: each node is shaped once.
      seen = new Map<number, Uint8Array>();
    for (let k = 0; k < lots.length; k++) {
      platforms.add(lots[k]);
      if (k % LOTS_PER_STEP === LOTS_PER_STEP - 1) yield;
    }
    let shaped = 0;
    for (const box of platforms.boxes()) {
      for (let j = Math.max(0, Math.ceil(box.y0 / SHAPE_STEP)); j <= Math.min(last, Math.floor(box.y1 / SHAPE_STEP)); j++)
        for (let i = Math.max(0, Math.ceil(box.x0 / SHAPE_STEP)); i <= Math.min(last, Math.floor(box.x1 / SHAPE_STEP)); i++) {
          const block = Math.floor(j / CELLS) * (last + 1) + Math.floor(i / CELLS),
            node = (j % CELLS) * CELLS + (i % CELLS);
          let done = seen.get(block);
          if (!done) seen.set(block, (done = new Uint8Array(CELLS * CELLS)));
          if (done[node]) continue;
          done[node] = 1;
          const x = i * SHAPE_STEP,
            y = j * SHAPE_STEP,
            height = natural(x, y);
          shape.level(i, j, platforms.shape(x, y, height) - height);
        }
      if (++shaped % LOTS_PER_STEP === 0) yield;
    }
  }
  for (const nodes of cuts.nodes(SHAPE_STEP)) {
    for (let k = 0; k < nodes.length; k++) {
      const [i, j] = nodes[k];
      if (i >= 0 && j >= 0 && i <= last && j <= last) shape.dig(i, j, -cuts.lower(i * SHAPE_STEP, j * SHAPE_STEP, 0));
      if (k % NODES_PER_STEP === NODES_PER_STEP - 1) yield;
    }
    yield;
  }
  if (roads.length) yield* squeezeSteps(shape, width, roads, natural, all);
  return shape.empty ? undefined : shape;
}

/** Writes the squeeze of the steep `roads` into `shape`, nearest the towns first: each node once. */
function* squeezeSteps(shape: GroundShape, width: number, roads: readonly SteepRoad[], natural: (x: number, y: number) => number, towns: readonly (readonly GroundShapeLot[])[]): Generator<void, void> {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const lots of towns)
    for (const lot of lots)
      for (const ring of [lot.ring ?? [], ...lot.pads.map(pad => pad.ring)])
        for (const p of ring) {
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x);
          y1 = Math.max(y1, p.y);
        }
  const squeeze = new RoadSqueeze(roads, natural, x0 <= x1 ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : undefined),
    last = Math.floor(width / SQUEEZE_STEP),
    seen = new Set<number>(),
    field = new Float32Array(4);
  let boxes = 0;
  for (const box of squeeze.boxes) {
    for (let j = Math.max(0, Math.ceil(box.y0 / SQUEEZE_STEP)); j <= Math.min(last, Math.floor(box.y1 / SQUEEZE_STEP)); j++)
      for (let i = Math.max(0, Math.ceil(box.x0 / SQUEEZE_STEP)); i <= Math.min(last, Math.floor(box.x1 / SQUEEZE_STEP)); i++) {
        const node = j * (last + 1) + i;
        if (seen.has(node)) continue;
        seen.add(node);
        if (squeeze.at(i * SQUEEZE_STEP, j * SQUEEZE_STEP, field)) shape.squeezeNode(i, j, field);
      }
    if (++boxes % LOTS_PER_STEP === 0) yield;
  }
}
