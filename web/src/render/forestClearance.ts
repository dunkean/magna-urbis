import type { Enclosure } from '../../../rust/bridge/urban';
import type { ForestClearing } from '../../../rust/bridge/terrainForest';

/** Maintained defensive ground is bare of woody vegetation, whatever its water state or depth. */
export function fortificationClearings(layouts: readonly { enclosures?: readonly Enclosure[] }[]): ForestClearing[] {
  return layouts.flatMap(layout => (layout.enclosures ?? []).flatMap(e => [...(e.ditch ?? []).map(d => d.shape), ...(e.outworks ?? []).filter(w => w.kind === 'glacis').map(w => w.shape)])).filter(shape => shape.outer.length >= 3);
}

/** Exact signed distance to a polygon, positive inside; holes and winding are respected. */
export function forestClearingDistance(shape: ForestClearing, x: number, y: number): number {
  let inside = false,
    distance2 = Infinity;
  const holes = shape.holes,
    rings = holes ? holes.length + 1 : 1;
  // No ring list is allocated: the raster below calls this once per texel and per shape.
  for (let r = 0; r < rings; r++) {
    const ring = r ? holes![r - 1] : shape.outer;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j],
        b = ring[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length2)) : 0;
      const ex = x - a.x - t * dx,
        ey = y - a.y - t * dy,
        d2 = ex * ex + ey * ey;
      if (d2 < distance2) distance2 = d2;
      if (a.y > y !== b.y > y && x < (dx * (y - a.y)) / dy + a.x) inside = !inside;
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(distance2);
}

const bounds = (shape: ForestClearing) => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of shape.outer) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
};

/** As for holding edges, sample the true polygon distance, never a distance to rasterized cells. */
export function forestClearingRaster(shapes: readonly ForestClearing[], x: number, y: number, cell: number, n: number): Float32Array {
  const range = 8 * cell,
    out = new Float32Array(n * n).fill(-range);
  for (const shape of shapes) {
    const b = bounds(shape);
    const i0 = Math.max(0, Math.floor((b.x0 - range - x) / cell)),
      i1 = Math.min(n - 1, Math.ceil((b.x1 + range - x) / cell));
    const j0 = Math.max(0, Math.floor((b.y0 - range - y) / cell)),
      j1 = Math.min(n - 1, Math.ceil((b.y1 + range - y) / cell));
    for (let j = j0; j <= j1; j++) {
      const py = y + (j + 0.5) * cell,
        oy = py < b.y0 ? b.y0 - py : py > b.y1 ? py - b.y1 : 0;
      for (let i = i0; i <= i1; i++) {
        const at = j * n + i,
          px = x + (i + 0.5) * cell,
          ox = px < b.x0 ? b.x0 - px : px > b.x1 ? px - b.x1 : 0;
        // A texel outside the shape's box is outside the shape and at least as far from it as from the box: it
        // cannot raise a value that is already that near another shape (or inside one). Towns are thousands of
        // small shapes whose reaches overlap, so this skips most of the polygon distances, with the same result.
        if (ox > 0 || oy > 0) {
          const held = out[at];
          if (held >= 0 || ox * ox + oy * oy >= held * held) continue;
        }
        const d = forestClearingDistance(shape, px, py);
        if (d > out[at]) out[at] = d;
      }
    }
  }
  return out;
}

/** Exact crown-footprint exclusion for modelled trees, including clearings narrower than a texel. */
export class ForestClearingRoom {
  private cells = new Map<string, ForestClearing[]>();
  private cell = 64;
  constructor(shapes: readonly ForestClearing[]) {
    for (const shape of shapes) {
      const b = bounds(shape);
      for (let j = Math.floor(b.y0 / this.cell); j <= Math.floor(b.y1 / this.cell); j++)
        for (let i = Math.floor(b.x0 / this.cell); i <= Math.floor(b.x1 / this.cell); i++) {
          const key = `${i},${j}`,
            list = this.cells.get(key);
          if (list) list.push(shape);
          else this.cells.set(key, [shape]);
        }
    }
  }
  keeps(x: number, y: number, radius = 0): boolean {
    const visited = new Set<ForestClearing>();
    for (let j = Math.floor((y - radius) / this.cell); j <= Math.floor((y + radius) / this.cell); j++)
      for (let i = Math.floor((x - radius) / this.cell); i <= Math.floor((x + radius) / this.cell); i++)
        for (const shape of this.cells.get(`${i},${j}`) ?? []) {
          if (visited.has(shape)) continue;
          visited.add(shape);
          if (forestClearingDistance(shape, x, y) >= -radius) return false;
        }
    return true;
  }
}
