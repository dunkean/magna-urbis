/**
 * Regional roads on steep ground, in the 3D views that drape the map on the relief from above.
 *
 * A road of plan width W draped on a face of cross slope s covers W * sqrt(1 + s^2) of the surface: a smeared band on a
 * cliff. Cutting a ledge into the terrain does not hold either: a ledge of a few metres is narrower than the cells of the
 * terrain mesh a few hundred metres away, which samples it as a string of beads. So the ground is left as it is and the
 * picture is drawn squeezed instead: at the plan distance d from the centreline, the surface shows the picture of the
 * distance k * d, k = sqrt(1 + s^2), so the road keeps its width measured on the surface. The squeeze is whole over the
 * road and its margin, and the picture eases back to its place over a bank. It is evaluated per pixel, whatever the mesh,
 * by the terrain shaders of the tilted map (render/world/terrainShader.ts, V2) and of City Bench's separate 3D view
 * (ui/view3d/gl/shaders.ts).
 *
 * `RoadSqueeze` is the field: built once per roads and relief, sampled once onto the nodes of a texture
 * (render/world/groundShape.ts) or onto the vertices of the terrain (ui/view3d/terrain/meshes.ts): linear across a road,
 * it is carried exactly by either.
 * `squeezePush` and ROAD_SQUEEZE_GLSL are the one profile, on the CPU and in a shader.
 */
import type { Point } from '../../../rust/bridge/housesContract';

export const ROAD_SQUEEZE = Object.freeze({
  /** Cross slopes of the natural ground (rise over run) where the squeeze starts and where it is whole: below, a draped
   * road widens by 1 % at most. */
  from: 0.15,
  whole: 0.3,
  /** Steepest cross slope squeezed, as drawn (a road keeps a third of its plan width at least). */
  steepest: 3,
  /** Picture squeezed with the road beyond its half width: its casing, and the width floors of the far tiles (m). */
  margin: 4,
  /** Width over which the picture eases back to its place (m): wide enough for the picture never to fold. */
  bank: 14,
  /** Two stretches of road closer than this share the ground between them (the legs of a hairpin): the squeeze fades
   * towards the line at equal distance from both, where their pushes would meet in a step (m). */
  gap: 6,
  /** Centreline points further apart than this along a road are two stretches (m). */
  apart: 30,
  /** Steep pieces are kept nearest the centre first, over this many squares of `area` metres at most. */
  blocks: 128,
  area: 256,
});
/** Side of the cells the pieces are found by (m). */
const CELL = 32;

/** A road: its centreline and its width at each point (m). */
export interface SteepRoad {
  path: readonly Point[];
  widths: readonly number[];
}
interface Piece {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  length: number;
  /** Its road, and the length of the road before it (m). */
  road: number;
  arc: number;
  /** Cross slope at its two ends, zero below ROAD_SQUEEZE.from. */
  slopeA: number;
  slopeB: number;
  /** Half width of the picture squeezed whole (m). */
  reach: number;
}
export interface SqueezeBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const smooth = (s: number): number => (s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s));
const cellKey = (x: number, y: number): number => (Math.floor(x / CELL) + 32768) * 65536 + Math.floor(y / CELL) + 32768;

/** Metres the picture is pushed away from the centreline at the vector (vx, vy) from it, for a cross `slope` already faded
 * (RoadSqueeze.at), a `reach` and the metres drawn per metre of height: (k - 1) * d over the road, the same shift kept
 * beyond it and lost with the slope's fade. */
export function squeezePush(vx: number, vy: number, slope: number, reach: number, rise: number): number {
  const k = Math.hypot(1, Math.min(slope * rise, ROAD_SQUEEZE.steepest));
  return (k - 1) * Math.min(Math.hypot(vx, vy), reach / k);
}
/** `squeezePush(f, rise)`: the same profile, as the vector to add to the map point; `f` is a node of the field. */
export const ROAD_SQUEEZE_GLSL = `
vec2 squeezePush(vec4 f, float rise) {
  float d = length(f.xy), k = length(vec2(1.0, min(f.z * rise, ${ROAD_SQUEEZE.steepest.toFixed(1)})));
  return d > 1e-4 ? f.xy * ((k - 1.0) * min(d, f.w / k) / d) : vec2(0.0);
}`;

/** The squeeze of the regional roads that cross steep slopes: at a map point, the vector from the nearest centreline, the
 * cross slope of the road there (faded over the bank, and between two stretches) and the reach of the whole squeeze. */
export class RoadSqueeze {
  private readonly pieces: Piece[] = [];
  private readonly cells = new Map<number, number[]>();
  /** What each steep piece reaches, bank included. */
  readonly boxes: SqueezeBox[] = [];

  /** `natural`: the ground, m; `centre`: the pieces nearest this point are kept when the map has too many; `pad`: how far
   * beyond the bank the vector from the centreline is still given (m), for samples further apart than the bank is wide. */
  constructor(
    roads: readonly SteepRoad[],
    natural: (x: number, y: number) => number | undefined,
    centre?: Point,
    private readonly pad = 0,
  ) {
    const { from, whole, steepest, margin, bank, blocks, area } = ROAD_SQUEEZE,
      steep: Piece[] = [];
    roads.forEach(({ path, widths }, road) => {
      const last = path.length - 1;
      // The cross slope at each point of the centreline: a road is squeezed without a gap along a steep stretch.
      const slopes = path.map((p, i) => {
        const a = path[Math.max(0, i - 1)],
          b = path[Math.min(last, i + 1)],
          length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < 1e-6) return 0;
        const half = Math.max(3, 0.5 * (widths[i] ?? 0)),
          nx = (-(b.y - a.y) / length) * half,
          ny = ((b.x - a.x) / length) * half,
          up = natural(p.x + nx, p.y + ny),
          down = natural(p.x - nx, p.y - ny);
        if (up === undefined || down === undefined || !Number.isFinite(up - down)) return 0;
        const slope = Math.abs(up - down) / (2 * half);
        return Math.min(steepest, slope) * smooth((slope - from) / (whole - from));
      });
      let arc = 0;
      for (let k = 1; k <= last; k++) {
        const a = path[k - 1],
          b = path[k],
          length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < 1e-6) continue;
        if (slopes[k - 1] > 0 || slopes[k] > 0) steep.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, length, road, arc, slopeA: slopes[k - 1], slopeB: slopes[k], reach: 0.5 * Math.max(widths[k - 1] ?? 0, widths[k] ?? 0) + margin });
        arc += length;
      }
    });
    if (centre) {
      const far = (p: Piece): number => Math.hypot((p.ax + p.bx) / 2 - centre.x, (p.ay + p.by) / 2 - centre.y);
      steep.sort((p, q) => far(p) - far(q));
    }
    const squares = new Set<number>();
    for (const piece of steep) {
      if (squares.size >= blocks) break;
      const out = piece.reach + bank + pad,
        box: SqueezeBox = { x0: Math.min(piece.ax, piece.bx) - out, y0: Math.min(piece.ay, piece.by) - out, x1: Math.max(piece.ax, piece.bx) + out, y1: Math.max(piece.ay, piece.by) + out };
      for (let y = Math.floor(box.y0 / area); y <= Math.floor(box.y1 / area); y++) for (let x = Math.floor(box.x0 / area); x <= Math.floor(box.x1 / area); x++) squares.add((x + 32768) * 65536 + y + 32768);
      const index = this.pieces.push(piece) - 1;
      for (let y = box.y0; y < box.y1 + CELL; y += CELL)
        for (let x = box.x0; x < box.x1 + CELL; x += CELL) {
          const key = cellKey(Math.min(x, box.x1), Math.min(y, box.y1)),
            list = this.cells.get(key);
          if (!list) this.cells.set(key, [index]);
          else if (list[list.length - 1] !== index) list.push(index);
        }
      this.boxes.push(box);
    }
  }
  get empty(): boolean {
    return !this.pieces.length;
  }

  /** The squeeze at (x, y) into `out`: vector from the centreline (m, two floats), cross slope, reach (m). False where no
   * road reaches: nothing is written. */
  at(x: number, y: number, out: Float32Array): boolean {
    const near = this.cells.get(cellKey(x, y));
    if (!near) return false;
    const pieces = this.pieces;
    let best = -1,
      d1 = Infinity,
      qx = 0,
      qy = 0,
      t1 = 0;
    for (const k of near) {
      const p = pieces[k],
        t = along(p, x, y),
        px = p.ax + t * (p.bx - p.ax),
        py = p.ay + t * (p.by - p.ay),
        d = Math.hypot(x - px, y - py);
      if (d < d1) {
        best = k;
        d1 = d;
        qx = px;
        qy = py;
        t1 = t;
      }
    }
    const piece = pieces[best],
      { bank, gap, apart } = ROAD_SQUEEZE;
    if (d1 >= piece.reach + bank + this.pad) return false;
    // The nearest point of another stretch: another road, or this one further along.
    const arc = piece.arc + t1 * piece.length;
    let d2 = Infinity;
    for (const k of near) {
      const p = pieces[k],
        t = along(p, x, y);
      if (p.road === piece.road && Math.abs(p.arc + t * p.length - arc) <= apart) continue;
      d2 = Math.min(d2, Math.hypot(x - p.ax - t * (p.bx - p.ax), y - p.ay - t * (p.by - p.ay)));
    }
    out[0] = x - qx;
    out[1] = y - qy;
    out[2] = (piece.slopeA + t1 * (piece.slopeB - piece.slopeA)) * (1 - smooth((d1 - piece.reach) / bank)) * smooth((d2 - d1) / gap);
    out[3] = piece.reach;
    return true;
  }
}

/** Where along a piece (0..1) its nearest point to (x, y) lies. */
function along(p: Piece, x: number, y: number): number {
  return Math.max(0, Math.min(1, ((x - p.ax) * (p.bx - p.ax) + (y - p.ay) * (p.by - p.ay)) / (p.length * p.length)));
}
