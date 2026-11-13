/**
 * Recorded paths for the GPU vector engine (design: web/out/vector-gpu-2026-11-12/DESIGN.md).
 *
 * `RecPath2D` is a native Path2D (when the platform has one) that also records its commands in a compact number stream,
 * so the CPU canvas and the display-list recorder draw the very same objects. `PlainPath` records only (the recorder's
 * default path and rectangles). Both flatten to `PathGeometry` with Canvas semantics.
 */
import type { Mat, PathGeometry, RecordedPath } from './displayList';

// Command stream: opcode followed by its numbers.
const MOVE = 0, LINE = 1, QUAD = 2, CUBIC = 3, ELLIPSE = 4, CLOSE = 5;
// ELLIPSE: cx cy ux uy vx vy start sweep; point(t) = c + u cos t + v sin t (closed under affine maps).
const TAU = Math.PI * 2;
const MAX_SEGS = 1024;

type Box = readonly [number, number, number, number];
const EMPTY_BOX: Box = [Infinity, Infinity, -Infinity, -Infinity];

/** Mutable recording state shared by RecPath2D and PlainPath (internal). */
export interface PathData {
  cmds: number[];
  version: number;
  readable: boolean;
  /** Index of the last opcode in `cmds`, -1 when unknown. */
  tail: number;
  /** Current point and subpath start, in path coordinates; `hasPt` false until the first point. */
  hasPt: boolean;
  ptX: number; ptY: number; subX: number; subY: number;
  geoVersion: number;
  geo: Map<number, PathGeometry> | null;
  boxVersion: number;
  box: Box;
}

const finite = (v: number): boolean => v * 0 === 0;

/** DOMMatrix2DInit -> Mat, null when a member is not finite. */
export function matFromInit(m: DOMMatrix2DInit): Mat | null {
  const a = m.a ?? m.m11 ?? 1, b = m.b ?? m.m12 ?? 0, c = m.c ?? m.m21 ?? 0, d = m.d ?? m.m22 ?? 1, e = m.e ?? m.m41 ?? 0, f = m.f ?? m.m42 ?? 0;
  return finite(a) && finite(b) && finite(c) && finite(d) && finite(e) && finite(f) ? [a, b, c, d, e, f] : null;
}

function push3(p: PathData, op: number, x: number, y: number): void {
  p.tail = p.cmds.length; p.cmds.push(op, x, y);
}

export function pMoveTo(p: PathData, x: number, y: number, m: Mat | null): void {
  if (!finite(x) || !finite(y)) return;
  if (m) { const X = m[0] * x + m[2] * y + m[4]; y = m[1] * x + m[3] * y + m[5]; x = X; }
  const c = p.cmds, t = p.tail;
  // A moveTo right after a moveTo replaces it (the first one-point subpath draws nothing).
  if (t >= 0 && t === c.length - 3 && c[t] === MOVE) { c[t + 1] = x; c[t + 2] = y; }
  else push3(p, MOVE, x, y);
  p.hasPt = true; p.ptX = p.subX = x; p.ptY = p.subY = y; p.version++;
}

export function pLineTo(p: PathData, x: number, y: number, m: Mat | null): void {
  if (!finite(x) || !finite(y)) return;
  if (!p.hasPt) { pMoveTo(p, x, y, m); return; }
  if (m) { const X = m[0] * x + m[2] * y + m[4]; y = m[1] * x + m[3] * y + m[5]; x = X; }
  push3(p, LINE, x, y);
  p.ptX = x; p.ptY = y; p.version++;
}

export function pClose(p: PathData): void {
  if (!p.hasPt) return;
  const c = p.cmds;
  if (p.tail >= 0 && c[p.tail] === CLOSE) return;
  p.tail = c.length; c.push(CLOSE);
  p.ptX = p.subX; p.ptY = p.subY; p.version++;
}

export function pQuad(p: PathData, cx: number, cy: number, x: number, y: number, m: Mat | null): void {
  if (!finite(cx) || !finite(cy) || !finite(x) || !finite(y)) return;
  if (!p.hasPt) pMoveTo(p, cx, cy, m);
  if (m) {
    const CX = m[0] * cx + m[2] * cy + m[4]; cy = m[1] * cx + m[3] * cy + m[5]; cx = CX;
    const X = m[0] * x + m[2] * y + m[4]; y = m[1] * x + m[3] * y + m[5]; x = X;
  }
  p.tail = p.cmds.length; p.cmds.push(QUAD, cx, cy, x, y);
  p.ptX = x; p.ptY = y; p.version++;
}

export function pCubic(p: PathData, c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number, m: Mat | null): void {
  if (!finite(c1x) || !finite(c1y) || !finite(c2x) || !finite(c2y) || !finite(x) || !finite(y)) return;
  if (!p.hasPt) pMoveTo(p, c1x, c1y, m);
  if (m) {
    let X = m[0] * c1x + m[2] * c1y + m[4]; c1y = m[1] * c1x + m[3] * c1y + m[5]; c1x = X;
    X = m[0] * c2x + m[2] * c2y + m[4]; c2y = m[1] * c2x + m[3] * c2y + m[5]; c2x = X;
    X = m[0] * x + m[2] * y + m[4]; y = m[1] * x + m[3] * y + m[5]; x = X;
  }
  p.tail = p.cmds.length; p.cmds.push(CUBIC, c1x, c1y, c2x, c2y, x, y);
  p.ptX = x; p.ptY = y; p.version++;
}

/** Canvas ellipse(): implicit lineTo to the arc start (moveTo when the path is empty), sweep normalised like Canvas. */
export function pEllipse(p: PathData, x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number, ccw: boolean, m: Mat | null): void {
  if (!finite(x) || !finite(y) || !finite(rx) || !finite(ry) || !finite(rot) || !finite(start) || !finite(end)) return;
  if (rx < 0 || ry < 0) throw new RangeError('IndexSizeError: negative radius');
  let sw = end - start;
  if (!ccw) { if (sw >= TAU) sw = TAU; else { sw %= TAU; if (sw < 0) sw += TAU; } }
  else if (-sw >= TAU) sw = -TAU;
  else { sw %= TAU; if (sw > 0) sw -= TAU; }
  const cr = Math.cos(rot), sr = Math.sin(rot);
  let ux = rx * cr, uy = rx * sr, vx = -ry * sr, vy = ry * cr;
  if (m) {
    const X = m[0] * x + m[2] * y + m[4]; y = m[1] * x + m[3] * y + m[5]; x = X;
    let t = m[0] * ux + m[2] * uy; uy = m[1] * ux + m[3] * uy; ux = t;
    t = m[0] * vx + m[2] * vy; vy = m[1] * vx + m[3] * vy; vx = t;
  }
  const cs = Math.cos(start), ss = Math.sin(start);
  const x0 = x + ux * cs + vx * ss, y0 = y + uy * cs + vy * ss;
  if (!p.hasPt) push3(p, MOVE, x0, y0);
  else if (x0 !== p.ptX || y0 !== p.ptY) push3(p, LINE, x0, y0);
  if (!p.hasPt) { p.hasPt = true; p.subX = x0; p.subY = y0; }
  p.ptX = x0; p.ptY = y0;
  if (sw !== 0) {
    p.tail = p.cmds.length; p.cmds.push(ELLIPSE, x, y, ux, uy, vx, vy, start, sw);
    const ce = Math.cos(start + sw), se = Math.sin(start + sw);
    p.ptX = x + ux * ce + vx * se; p.ptY = y + uy * ce + vy * se;
  }
  p.version++;
}

/** Canvas arcTo(), computed in user space (the current point is mapped back through `m`). */
export function pArcTo(p: PathData, x1: number, y1: number, x2: number, y2: number, r: number, m: Mat | null): void {
  if (!finite(x1) || !finite(y1) || !finite(x2) || !finite(y2) || !finite(r)) return;
  if (r < 0) throw new RangeError('IndexSizeError: negative radius');
  if (!p.hasPt) { pMoveTo(p, x1, y1, m); return; }
  let x0 = p.ptX, y0 = p.ptY;
  if (m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det || !finite(det)) { pLineTo(p, x1, y1, m); return; }
    const dx = x0 - m[4], dy = y0 - m[5];
    x0 = (m[3] * dx - m[2] * dy) / det; y0 = (m[0] * dy - m[1] * dx) / det;
  }
  const ax = x0 - x1, ay = y0 - y1, bx = x2 - x1, by = y2 - y1;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), cross = ax * by - ay * bx;
  if (la === 0 || lb === 0 || r === 0 || Math.abs(cross) <= 1e-12 * la * lb) { pLineTo(p, x1, y1, m); return; }
  const ux = ax / la, uy = ay / la, vx = bx / lb, vy = by / lb;
  const half = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy))) / 2;
  const d = r / Math.tan(half), h = r / Math.sin(half);
  const t1x = x1 + ux * d, t1y = y1 + uy * d, t2x = x1 + vx * d, t2y = y1 + vy * d;
  let bxn = ux + vx, byn = uy + vy; const bl = Math.hypot(bxn, byn); bxn /= bl; byn /= bl;
  const cx = x1 + bxn * h, cy = y1 + byn * h;
  const a0 = Math.atan2(t1y - cy, t1x - cx), a1 = Math.atan2(t2y - cy, t2x - cx);
  let sw = a1 - a0; if (sw > Math.PI) sw -= TAU; else if (sw < -Math.PI) sw += TAU;
  pEllipse(p, cx, cy, r, r, 0, a0, a1, sw < 0, m);
}

export function pRect(p: PathData, x: number, y: number, w: number, h: number, m: Mat | null): void {
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) return;
  pMoveTo(p, x, y, m); pLineTo(p, x + w, y, m); pLineTo(p, x + w, y + h, m); pLineTo(p, x, y + h, m); pClose(p);
}

type Radii = number | DOMPointInit | (number | DOMPointInit)[];
/** Basic Canvas roundRect(): per-corner (elliptic) radii, scaled down when they overlap; negative sizes are normalised. */
export function pRoundRect(p: PathData, x: number, y: number, w: number, h: number, radii: Radii | undefined, m: Mat | null): void {
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) return;
  const list = radii === undefined ? [0] : Array.isArray(radii) ? radii : [radii];
  if (list.length < 1 || list.length > 4) throw new RangeError('IndexSizeError: roundRect radii');
  const rs: [number, number][] = list.map((r) => {
    const rx = typeof r === 'number' ? r : r.x ?? 0, ry = typeof r === 'number' ? r : r.y ?? 0;
    if (rx < 0 || ry < 0) throw new RangeError('IndexSizeError: negative radius');
    return [finite(rx) ? rx : 0, finite(ry) ? ry : 0];
  });
  const [tl, tr, br, bl] = rs.length === 1 ? [rs[0], rs[0], rs[0], rs[0]] : rs.length === 2 ? [rs[0], rs[1], rs[0], rs[1]]
    : rs.length === 3 ? [rs[0], rs[1], rs[2], rs[1]] : [rs[0], rs[1], rs[2], rs[3]];
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  const fit = (side: number, sum: number): number => sum > 0 ? side / sum : 1;
  const k = Math.min(1, fit(w, tl[0] + tr[0]), fit(w, bl[0] + br[0]), fit(h, tl[1] + bl[1]), fit(h, tr[1] + br[1]));
  const H = Math.PI / 2;
  pMoveTo(p, x + tl[0] * k, y, m);
  pEllipse(p, x + w - tr[0] * k, y + tr[1] * k, tr[0] * k, tr[1] * k, 0, -H, 0, false, m);
  pEllipse(p, x + w - br[0] * k, y + h - br[1] * k, br[0] * k, br[1] * k, 0, 0, H, false, m);
  pEllipse(p, x + bl[0] * k, y + h - bl[1] * k, bl[0] * k, bl[1] * k, 0, H, Math.PI, false, m);
  pEllipse(p, x + tl[0] * k, y + tl[1] * k, tl[0] * k, tl[1] * k, 0, Math.PI, 3 * H, false, m);
  pClose(p);
  pMoveTo(p, x, y, m);
}

/** Maps every coordinate of cmds[from..] through m in place. */
function mapCmds(c: number[], from: number, m: Mat): void {
  const [a, b, cc, d, e, f] = m;
  for (let i = from; i < c.length;) {
    const op = c[i];
    if (op === CLOSE) { i += 1; continue; }
    const pts = op === MOVE || op === LINE ? 1 : op === QUAD ? 2 : op === CUBIC ? 3 : 1;
    let j = i + 1;
    for (let k = 0; k < pts; k++, j += 2) { const x = c[j], y = c[j + 1]; c[j] = a * x + cc * y + e; c[j + 1] = b * x + d * y + f; }
    if (op === ELLIPSE) for (let k = 0; k < 2; k++, j += 2) { const x = c[j], y = c[j + 1]; c[j] = a * x + cc * y; c[j + 1] = b * x + d * y; }
    i += op === MOVE || op === LINE ? 3 : op === QUAD ? 5 : op === CUBIC ? 7 : 9;
  }
}

/** Appends src's commands (mapped through m) to dst; dst continues from src's current point, like Canvas addPath. */
export function pAppend(dst: PathData, src: PathData, m: Mat | null): void {
  if (!src.readable) dst.readable = false;
  const s = src.cmds;
  if (!s.length) return;
  const d = dst.cmds, from = d.length;
  for (let i = 0; i < s.length; i++) d.push(s[i]);
  dst.tail = -1;
  let px = src.ptX, py = src.ptY, sx = src.subX, sy = src.subY;
  if (m) {
    mapCmds(d, from, m);
    let X = m[0] * px + m[2] * py + m[4]; py = m[1] * px + m[3] * py + m[5]; px = X;
    X = m[0] * sx + m[2] * sy + m[4]; sy = m[1] * sx + m[3] * sy + m[5]; sx = X;
  }
  dst.hasPt = dst.hasPt || src.hasPt; dst.ptX = px; dst.ptY = py; dst.subX = sx; dst.subY = sy;
  dst.version++;
}

/** Maps the whole path through m in place. */
export function pTransform(p: PathData, m: Mat): void {
  mapCmds(p.cmds, 0, m);
  let X = m[0] * p.ptX + m[2] * p.ptY + m[4]; p.ptY = m[1] * p.ptX + m[3] * p.ptY + m[5]; p.ptX = X;
  X = m[0] * p.subX + m[2] * p.subY + m[4]; p.subY = m[1] * p.subX + m[3] * p.subY + m[5]; p.subX = X;
  p.version++;
}

export function pCopy(dst: PathData, src: PathData): void {
  dst.cmds = src.cmds.slice(); dst.readable = src.readable; dst.tail = src.tail;
  dst.hasPt = src.hasPt; dst.ptX = src.ptX; dst.ptY = src.ptY; dst.subX = src.subX; dst.subY = src.subY;
  dst.version++;
}

export function pReset(p: PathData): void {
  p.cmds.length = 0; p.tail = -1; p.hasPt = false; p.readable = true; p.version++;
}

export function pBounds(p: PathData): Box {
  if (p.boxVersion === p.version) return p.box;
  const c = p.cmds;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < c.length;) {
    const op = c[i];
    if (op === CLOSE) { i += 1; continue; }
    if (op === ELLIPSE) {
      // Hull of the whole ellipse (acceptable for partial arcs).
      const cx = c[i + 1], cy = c[i + 2], ex = Math.hypot(c[i + 3], c[i + 5]), ey = Math.hypot(c[i + 4], c[i + 6]);
      if (cx - ex < x0) x0 = cx - ex; if (cx + ex > x1) x1 = cx + ex;
      if (cy - ey < y0) y0 = cy - ey; if (cy + ey > y1) y1 = cy + ey;
      i += 9; continue;
    }
    const n = op === MOVE || op === LINE ? 1 : op === QUAD ? 2 : 3;
    for (let k = 0, j = i + 1; k < n; k++, j += 2) {
      const x = c[j], y = c[j + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    i += 1 + 2 * n;
  }
  p.box = x0 <= x1 ? [x0, y0, x1, y1] : EMPTY_BOX;
  p.boxVersion = p.version;
  return p.box;
}

let buf = new Float64Array(8192);

function flatten(p: PathData, tol: number): PathGeometry {
  const c = p.cmds, len = c.length;
  const starts: number[] = [], closed: number[] = [];
  let n = 0, sub = 0, open = false, drew = false;
  let x = 0, y = 0, sx = 0, sy = 0;
  const grow = (): void => { const next = new Float64Array(buf.length * 2); next.set(buf); buf = next; };
  const push = (px: number, py: number): void => {
    if (n - sub >= 2 && buf[n - 2] === px && buf[n - 1] === py) return;
    if (n + 2 > buf.length) grow();
    buf[n++] = px; buf[n++] = py;
  };
  const end = (isClosed: number): void => {
    if (!open) return;
    open = false;
    let count = (n - sub) >> 1;
    if (count === 1) {
      if (!drew) { n = sub; return; }
      // Zero-length subpath that did draw: keep a degenerate segment (caps).
      if (n + 2 > buf.length) grow();
      buf[n] = buf[n - 2]; buf[n + 1] = buf[n - 1]; n += 2; count = 2;
    }
    if (isClosed && count > 2 && buf[n - 2] === buf[sub] && buf[n - 1] === buf[sub + 1]) n -= 2;
    starts.push(sub >> 1); closed.push(isClosed);
  };
  const begin = (px: number, py: number): void => {
    end(0);
    sub = n; open = true; drew = false; sx = px; sy = py;
    if (n + 2 > buf.length) grow();
    buf[n++] = px; buf[n++] = py;
  };
  const segs = (k: number): number => k >= MAX_SEGS ? MAX_SEGS : k >= 1 ? k : 1;

  for (let i = 0; i < len;) {
    const op = c[i];
    if (op === MOVE) { begin(c[i + 1], c[i + 2]); x = c[i + 1]; y = c[i + 2]; i += 3; continue; }
    if (op === CLOSE) { end(1); x = sx; y = sy; i += 1; continue; }
    if (!open) begin(x, y);
    drew = true;
    if (op === LINE) { x = c[i + 1]; y = c[i + 2]; push(x, y); i += 3; }
    else if (op === QUAD) {
      flattenCurved = true;
      const cx = c[i + 1], cy = c[i + 2], ex = c[i + 3], ey = c[i + 4];
      const k = segs(Math.ceil(Math.sqrt(Math.hypot(x - 2 * cx + ex, y - 2 * cy + ey) / (4 * tol))));
      for (let s = 1; s < k; s++) {
        const t = s / k, mt = 1 - t, a = mt * mt, b = 2 * mt * t, d = t * t;
        push(a * x + b * cx + d * ex, a * y + b * cy + d * ey);
      }
      x = ex; y = ey; push(x, y); i += 5;
    } else if (op === CUBIC) {
      flattenCurved = true;
      const ax = c[i + 1], ay = c[i + 2], bx = c[i + 3], by = c[i + 4], ex = c[i + 5], ey = c[i + 6];
      const dd = Math.max(Math.hypot(x - 2 * ax + bx, y - 2 * ay + by), Math.hypot(ax - 2 * bx + ex, ay - 2 * by + ey));
      const k = segs(Math.ceil(Math.sqrt(3 * dd / (4 * tol))));
      for (let s = 1; s < k; s++) {
        const t = s / k, mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t;
        push(a * x + b * ax + d * bx + e * ex, a * y + b * ay + d * by + e * ey);
      }
      x = ex; y = ey; push(x, y); i += 7;
    } else if (op === ELLIPSE) {
      flattenCurved = true;
      const cx = c[i + 1], cy = c[i + 2], ux = c[i + 3], uy = c[i + 4], vx = c[i + 5], vy = c[i + 6], st = c[i + 7], sw = c[i + 8];
      const r = Math.max(Math.hypot(ux, uy), Math.hypot(vx, vy));
      const step = r > tol ? Math.min(Math.PI / 2, 2 * Math.acos(1 - tol / r)) : Math.PI / 2;
      const k = segs(Math.ceil(Math.abs(sw) / step));
      for (let s = 1; s <= k; s++) {
        const t = st + sw * s / k, ct = Math.cos(t), stt = Math.sin(t);
        push(cx + ux * ct + vx * stt, cy + uy * ct + vy * stt);
      }
      const ct = Math.cos(st + sw), se = Math.sin(st + sw);
      x = cx + ux * ct + vx * se; y = cy + uy * ct + vy * se;
      i += 9;
    } else break;
  }
  end(0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i += 2) {
    const px = buf[i], py = buf[i + 1];
    if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  const points = new Float32Array(n); points.set(buf.subarray(0, n));
  const st = new Uint32Array(starts.length + 1);
  for (let i = 0; i < starts.length; i++) st[i] = starts[i];
  st[starts.length] = n >> 1;
  return { points, starts: st, closed: Uint8Array.from(closed), bbox: n ? [x0, y0, x1, y1] : EMPTY_BOX };
}

/** Set by flatten when the path held a curve (its geometry then depends on the tolerance). */
let flattenCurved = false;
/** Cache key of a polyline-only geometry: valid for every tolerance. */
const ANY_TOLERANCE = 1000;
/** Flattened geometry, cached per power-of-two tolerance bucket (the bucket value never exceeds `tolerance`).
 * A path of straight segments flattens identically at any tolerance: one geometry object serves all zooms, so the
 * rasterizer keeps its GPU upload across scale changes. */
export function pGeometry(p: PathData, tolerance: number): PathGeometry {
  const tol = tolerance > 0 && finite(tolerance) ? tolerance : 0.25;
  const bucket = Math.max(-24, Math.min(24, Math.floor(Math.log2(tol))));
  if (p.geoVersion !== p.version || !p.geo) { p.geo = new Map(); p.geoVersion = p.version; }
  const straight = p.geo.get(ANY_TOLERANCE); if (straight) return straight;
  let g = p.geo.get(bucket);
  if (!g) {
    flattenCurved = false; g = flatten(p, 2 ** bucket);
    p.geo.set(flattenCurved ? bucket : ANY_TOLERANCE, g);
  }
  return g;
}

const NativePath2D = (globalThis as { Path2D?: typeof Path2D }).Path2D;
const HAS_NATIVE = typeof NativePath2D === 'function';
const Base = (NativePath2D ?? class {}) as unknown as typeof Path2D;

/** Native Path2D (when available) that also records its commands for the GPU engine. */
export class RecPath2D extends Base implements RecordedPath, PathData {
  cmds: number[] = [];
  version = 0;
  readable = true;
  tail = -1;
  hasPt = false;
  ptX = 0; ptY = 0; subX = 0; subY = 0;
  geoVersion = -1;
  geo: Map<number, PathGeometry> | null = null;
  boxVersion = -1;
  box: Box = EMPTY_BOX;

  constructor(path?: Path2D | string) {
    super(path as Path2D);
    if (path !== undefined) {
      if (path instanceof RecPath2D) pCopy(this, path);
      else this.readable = false;
    }
  }
  moveTo(x: number, y: number): void { if (HAS_NATIVE) super.moveTo(x, y); pMoveTo(this, x, y, null); }
  lineTo(x: number, y: number): void { if (HAS_NATIVE) super.lineTo(x, y); pLineTo(this, x, y, null); }
  closePath(): void { if (HAS_NATIVE) super.closePath(); pClose(this); }
  rect(x: number, y: number, w: number, h: number): void { if (HAS_NATIVE) super.rect(x, y, w, h); pRect(this, x, y, w, h, null); }
  roundRect(x: number, y: number, w: number, h: number, radii?: Radii): void {
    if (HAS_NATIVE && typeof super.roundRect === 'function') super.roundRect(x, y, w, h, radii);
    pRoundRect(this, x, y, w, h, radii, null);
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean): void {
    if (HAS_NATIVE) super.arc(x, y, r, start, end, ccw);
    pEllipse(this, x, y, r, r, 0, start, end, !!ccw, null);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    if (HAS_NATIVE) super.arcTo(x1, y1, x2, y2, r);
    pArcTo(this, x1, y1, x2, y2, r, null);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number, ccw?: boolean): void {
    if (HAS_NATIVE) super.ellipse(x, y, rx, ry, rot, start, end, ccw);
    pEllipse(this, x, y, rx, ry, rot, start, end, !!ccw, null);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    if (HAS_NATIVE) super.quadraticCurveTo(cx, cy, x, y);
    pQuad(this, cx, cy, x, y, null);
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (HAS_NATIVE) super.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
    pCubic(this, c1x, c1y, c2x, c2y, x, y, null);
  }
  addPath(path: Path2D, transform?: DOMMatrix2DInit): void {
    if (HAS_NATIVE) super.addPath(path, transform);
    if (!(path instanceof RecPath2D)) { this.readable = false; this.version++; return; }
    let m: Mat | null = null;
    if (transform) { m = matFromInit(transform); if (!m) return; }
    pAppend(this, path, m);
  }
  bounds(): readonly [number, number, number, number] { return pBounds(this); }
  geometry(tolerance: number): PathGeometry { return pGeometry(this, tolerance); }
}

/** Recording-only path (no native Path2D): the recorder's default path, rectangles and transformed copies. */
export class PlainPath implements RecordedPath, PathData {
  cmds: number[] = [];
  version = 0;
  readable = true;
  tail = -1;
  hasPt = false;
  ptX = 0; ptY = 0; subX = 0; subY = 0;
  geoVersion = -1;
  geo: Map<number, PathGeometry> | null = null;
  boxVersion = -1;
  box: Box = EMPTY_BOX;
  bounds(): readonly [number, number, number, number] { return pBounds(this); }
  geometry(tolerance: number): PathGeometry { return pGeometry(this, tolerance); }
}

export const newPath = (): RecPath2D => new RecPath2D();
export const isRecordedPath = (p: unknown): p is RecPath2D => p instanceof RecPath2D;
