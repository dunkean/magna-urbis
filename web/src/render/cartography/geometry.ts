/**
 * Pure helpers of the cartography renderer: colours, noise, ring clipping and the Path2D builders of polygon and line
 * layers (cached per index tile by the context). No renderer state.
 */
import type { Vec2 } from '../../gen/types';
import { PolyLayer, LineLayer } from '../scene';
import { Rect4 } from '../view';

const hexRgb = (h: string): number[] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
export const mixHex = (a: string, b: string, t: number): string => {
  const A = hexRgb(a),
    B = hexRgb(b);
  if (!A || !B) return a;
  return (
    '#' +
    A.map((x, i) =>
      Math.round(x + (B[i] - x) * t)
        .toString(16)
        .padStart(2, '0'),
    ).join('')
  );
};
export const lumHex = (h: string): number => {
  const c = hexRgb(h);
  return c ? (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 : 0.5;
};
export const growRect = (r: Rect4, d: number): Rect4 => ({ minX: r.minX - d, minY: r.minY - d, maxX: r.maxX + d, maxY: r.maxY + d });
export const TAU = Math.PI * 2;
export const frac = (v: number): number => v - Math.floor(v);
export const vhash = (i: number, j: number, salt: number): number => frac(Math.sin(i * 127.1 + j * 311.7 + salt * 74.7) * 43758.5453);
/** Smooth value noise in 0-1, two octaves: clumps of vegetation with empty gaps between them. */
export function clumpNoise(x: number, y: number, scale: number, salt: number): number {
  // Four lattice hashes per octave (each was evaluated twice), no per-call octave table.
  let sum = 0;
  for (let octave = 0; octave < 2; octave++) {
    const f = octave === 0 ? 1 : 3.1,
      w = octave === 0 ? 0.65 : 0.35;
    const fx = (x * f) / scale,
      fy = (y * f) / scale,
      i = Math.floor(fx),
      j = Math.floor(fy),
      u = fx - i,
      v = fy - j;
    const su = u * u * (3 - 2 * u),
      sv = v * v * (3 - 2 * v),
      s = salt + f * 13;
    const h00 = vhash(i, j, s),
      h10 = vhash(i + 1, j, s),
      h01 = vhash(i, j + 1, s),
      h11 = vhash(i + 1, j + 1, s);
    const top = h00 + (h10 - h00) * su,
      bottom = h01 + (h11 - h01) * su;
    sum += w * (top + (bottom - top) * sv);
  }
  return sum;
}
export const smooth01 = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
export function addRing(path: Path2D, ring: Vec2[]): void {
  if (ring.length < 3) return;
  path.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y);
  path.closePath();
}

/** Bounds of a ring, kept with it (rings are immutable scene products). */
export const ringBounds = new WeakMap<readonly Vec2[], Float64Array>();
function boundsOf(ring: readonly Vec2[]): Float64Array {
  let b = ringBounds.get(ring);
  if (!b) {
    b = new Float64Array([Infinity, Infinity, -Infinity, -Infinity]);
    for (const p of ring) {
      if (p.x < b[0]) b[0] = p.x;
      if (p.y < b[1]) b[1] = p.y;
      if (p.x > b[2]) b[2] = p.x;
      if (p.y > b[3]) b[3] = p.y;
    }
    ringBounds.set(ring, b);
  }
  return b;
}
let clipA = new Float64Array(1024),
  clipB = new Float64Array(1024);
/** clipRingBox (gen/geo/bool.ts) on a Vec2 ring, same planes, order and arithmetic, on scratch typed arrays:
 * the tuple copies and per-point closures of the generic version cost seconds on map-sized forest and wash rings
 * clipped again for every tile. A ring outside the rectangle is rejected from its cached bounds. */
export function clipRingRect(ring: readonly Vec2[], rect: Rect4): Vec2[] {
  const b = boundsOf(ring);
  if (b[2] < rect.minX || b[0] > rect.maxX || b[3] < rect.minY || b[1] > rect.maxY) return [];
  const need = 2 * (2 * ring.length + 8);
  if (clipA.length < need) {
    clipA = new Float64Array(need);
    clipB = new Float64Array(need);
  }
  let src = clipA,
    dst = clipB,
    n = ring.length;
  for (let i = 0; i < n; i++) {
    src[2 * i] = ring[i].x;
    src[2 * i + 1] = ring[i].y;
  }
  for (let plane = 0; plane < 4 && n; plane++) {
    const axis = plane < 2 ? 0 : 1,
      bound = plane === 0 ? rect.minX : plane === 1 ? rect.maxX : plane === 2 ? rect.minY : rect.maxY,
      low = plane === 0 || plane === 2;
    // Each edge emits at most two points.
    if (dst.length < 4 * n) dst = new Float64Array(4 * n);
    let m = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1,
        px = src[2 * i],
        py = src[2 * i + 1],
        qx = src[2 * j],
        qy = src[2 * j + 1];
      const sp = low ? src[2 * i + axis] - bound : bound - src[2 * i + axis],
        sq = low ? src[2 * j + axis] - bound : bound - src[2 * j + axis];
      if (sp >= 0) {
        dst[2 * m] = px;
        dst[2 * m + 1] = py;
        m++;
      }
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        dst[2 * m] = px + (qx - px) * t;
        dst[2 * m + 1] = py + (qy - py) * t;
        m++;
      }
    }
    const swap = src;
    src = dst;
    dst = swap;
    n = m;
  }
  clipA = src;
  clipB = dst;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const x = src[2 * i],
      y = src[2 * i + 1],
      last = out[out.length - 1];
    if (!last || last.x !== x || last.y !== y) out.push({ x, y });
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
  return out;
}
export function polyPath(P: new () => Path2D, l: PolyLayer, ids: ArrayLike<number>, minEdge: number, rect?: Rect4, simplifyBeforeClip = false): Path2D | null {
  const path = new P();
  const e2 = minEdge * minEdge;
  let any = false;
  for (let n = 0; n < ids.length; n++) {
    const i = ids[n];
    if (rect && !l.index.boxHits(i, rect)) continue;
    const rings: Vec2[][] = [l.polys[i]];
    const h = l.holes?.[i];
    if (h) for (const x of h) rings.push(x);
    for (const ring of rings) {
      // Clip before submitting to Canvas: the GPU otherwise replays map-sized
      // forest/wash paths for every tile and every multiply stamp.
      // Simplify before clipping, as an unclipped GPU path does. Cutting must not change which original vertices
      // survive LOD decimation inside the band (nor create an artificial stroked edge inside its paint reach).
      const pts = rect ? clipRingRect(simplifyBeforeClip ? simplifiedRing(ring, minEdge) : ring, rect) : ring;
      if (pts.length < 3) continue;
      let lx = pts[0].x,
        ly = pts[0].y,
        kept = 1;
      path.moveTo(lx, ly);
      for (let k = 1; k < pts.length; k++) {
        const p = pts[k];
        const dx = p.x - lx,
          dy = p.y - ly;
        if ((!rect || !simplifyBeforeClip) && e2 > 0 && dx * dx + dy * dy < e2 && k < pts.length - 1) continue;
        path.lineTo(p.x, p.y);
        lx = p.x;
        ly = p.y;
        kept++;
      }
      path.closePath();
      if (kept >= 3) any = true;
    }
  }
  return any ? path : null;
}

const simplified = new WeakMap<readonly Vec2[], Map<number, readonly Vec2[]>>();
function simplifiedRing(ring: readonly Vec2[], minEdge: number): readonly Vec2[] {
  if (!(minEdge > 0) || ring.length < 3) return ring;
  let levels = simplified.get(ring);
  if (!levels) simplified.set(ring, (levels = new Map()));
  let points = levels.get(minEdge);
  if (!points) {
    const out = [ring[0]],
      e2 = minEdge * minEdge;
    let last = ring[0];
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i],
        dx = p.x - last.x,
        dy = p.y - last.y;
      if (dx * dx + dy * dy < e2 && i < ring.length - 1) continue;
      out.push(p);
      last = p;
    }
    levels.set(minEdge, (points = out));
  }
  return points;
}

export function linePath(P: new () => Path2D, l: LineLayer, ids: ArrayLike<number>, minEdge: number): Path2D | null {
  const path = new P();
  const e2 = minEdge * minEdge;
  let any = false;
  for (let n = 0; n < ids.length; n++) {
    const pts = l.lines[ids[n]];
    if (pts.length < 2) continue;
    let lx = pts[0].x,
      ly = pts[0].y;
    path.moveTo(lx, ly);
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k];
      const dx = p.x - lx,
        dy = p.y - ly;
      if (e2 > 0 && dx * dx + dy * dy < e2 && k < pts.length - 1) continue;
      path.lineTo(p.x, p.y);
      lx = p.x;
      ly = p.y;
    }
    any = true;
  }
  return any ? path : null;
}

/** The runs of one canopy level (roadStyle.ts canopyRuns) of some lines, simplified as linePath does. */
export function runPath(P: new () => Path2D, lines: readonly { level: number; pts: { x: number; y: number }[] }[][], level: number, minEdge: number): Path2D | null {
  const path = new P(),
    e2 = minEdge * minEdge;
  let any = false;
  for (const runs of lines)
    for (const run of runs) {
      const pts = run.pts;
      if (run.level !== level || pts.length < 2) continue;
      let lx = pts[0].x,
        ly = pts[0].y;
      path.moveTo(lx, ly);
      for (let k = 1; k < pts.length; k++) {
        const p = pts[k],
          dx = p.x - lx,
          dy = p.y - ly;
        if (e2 > 0 && dx * dx + dy * dy < e2 && k < pts.length - 1) continue;
        path.lineTo(p.x, p.y);
        lx = p.x;
        ly = p.y;
      }
      any = true;
    }
  return any ? path : null;
}
const hashBuffer = new Float64Array(1),
  hashWords = new Uint32Array(hashBuffer.buffer);
/** FNV-1a over the exact coordinates of a layer: equal geometry, equal key. */
export function layerHash(layer: PolyLayer): string {
  let h = 0x811c9dc5,
    count = 0;
  const ring = (r: { x: number; y: number }[]): void => {
    h = Math.imul(h ^ r.length, 0x01000193);
    for (let i = 0; i < r.length; i++) {
      hashBuffer[0] = r[i].x;
      h = Math.imul(Math.imul(h ^ hashWords[0], 0x01000193) ^ hashWords[1], 0x01000193);
      hashBuffer[0] = r[i].y;
      h = Math.imul(Math.imul(h ^ hashWords[0], 0x01000193) ^ hashWords[1], 0x01000193);
    }
    count += r.length;
  };
  for (let i = 0; i < layer.polys.length; i++) {
    ring(layer.polys[i]);
    for (const hole of layer.holes?.[i] ?? []) ring(hole);
    h = Math.imul(h ^ 0x7fffffff, 0x01000193);
  }
  return `${layer.polys.length}:${count}:${(h >>> 0).toString(36)}`;
}
