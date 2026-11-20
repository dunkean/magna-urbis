/**
 * Display list surgery for the live overlay (render/live/overlayLayer.ts): no GL, testable in Node.
 *
 * A retained band list is split at the `crisp` mark into the soft area prefix (baked once into a texture) and the
 * suffix replayed at every frame; the suffix is culled to its band once, when recorded, so a frame never submits
 * geometry its scissor would drop whole.
 */
import { SPRITE_STRIDE, type ClipNode, type DisplayList, type DrawOp, type Mat, type PathGeometry, type RecordedPath } from './contract';
import { tolerance } from './transforms';

type Box = readonly [number, number, number, number];

/** Preserve call order and per-path compositing while bounding each upload/replay batch of a drape bake. */
export function boundedList(list: DisplayList): DisplayList {
  const ops: DrawOp[] = [];
  for (const op of list.ops) {
    if (op.type === 'sprites') {
      for (let i = 0; i < op.count; i += 1024) {
        const count = Math.min(1024, op.count - i);
        ops.push({ ...op, count, instances: op.instances.subarray(i * SPRITE_STRIDE, (i + count) * SPRITE_STRIDE) });
      }
    } else if (op.type !== 'clear' && op.paths.length > 32) {
      for (let i = 0; i < op.paths.length; i += 32) ops.push({ ...op, paths: op.paths.slice(i, i + 32) });
    } else ops.push(op);
  }
  return { ...list, ops };
}

function transformedBox(b: Box, m: Mat, pad: number): Box | null {
  if (!(b[2] >= b[0] && b[3] >= b[1])) return null;
  const x0 = m[0] * b[0],
    x1 = m[0] * b[2],
    x2 = m[2] * b[1],
    x3 = m[2] * b[3];
  const y0 = m[1] * b[0],
    y1 = m[1] * b[2],
    y2 = m[3] * b[1],
    y3 = m[3] * b[3];
  return [Math.min(x0, x1) + Math.min(x2, x3) + m[4] - pad, Math.min(y0, y1) + Math.min(y2, y3) + m[5] - pad, Math.max(x0, x1) + Math.max(x2, x3) + m[4] + pad, Math.max(y0, y1) + Math.max(y2, y3) + m[5] + pad];
}
const hits = (a: Box | null, b: Box): boolean => !!a && a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Index of the first op after the mark `name`, or -1 when the list has no such mark. */
export function markIndex(list: DisplayList, name: string): number {
  if (list.marks) for (const m of list.marks) if (m.name === name) return m.at;
  return -1;
}

/** The ops before `at` and the ops from `at` on, as two lists of the same canvas. The ops are shared, not copied. */
export function splitList(list: DisplayList, at: number): [DisplayList, DisplayList] {
  const n = Math.max(0, Math.min(list.ops.length, Math.floor(at)));
  const part = (ops: readonly DrawOp[]): DisplayList => ({ width: list.width, height: list.height, ops, stats: { ...list.stats, ops: ops.length }, ...(list.unsupported !== undefined ? { unsupported: list.unsupported } : {}) });
  return [part(list.ops.slice(0, n)), part(list.ops.slice(n))];
}

/**
 * The list without what cannot touch `box` (device pixels of the recorded canvas): paths whose bounds, grown by the
 * stroke reach, miss it; ops whose clip chain has a path that misses it. Replaying the result inside a scissor
 * contained in `box` gives the same pixels as the whole list. An op kept whole is the same object (the rasterizer
 * keys its batching caches on the `paths` array). `destination-in` ops act on the whole clip and are never reduced.
 */
export function cullList(list: DisplayList, box: Box): DisplayList {
  const clipSeen = new Map<ClipNode, boolean>();
  const clipHits = (node: ClipNode | null): boolean => {
    if (!node) return true;
    let known = clipSeen.get(node);
    if (known === undefined) {
      known = clipHits(node.parent) && hits(transformedBox(node.path.bounds(), node.transform, 1), box);
      clipSeen.set(node, known);
    }
    return known;
  };
  const ops: DrawOp[] = [];
  for (const op of list.ops) {
    if (!clipHits(op.clip)) continue;
    if (op.type === 'sprites' || op.type === 'clear' || op.composite === 'destination-in') {
      ops.push(op);
      continue;
    }
    const m = op.transform;
    let pad = 1;
    if (op.type === 'stroke') {
      const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      // Half the device width (never under a pixel), the miter or square-cap overshoot, one pixel of antialiasing.
      pad = (Math.max(1, op.width * s) * Math.max(1.5, op.join === 'miter' ? op.miterLimit : 1)) / 2 + 2;
    }
    let kept: RecordedPath[] | undefined;
    for (let i = 0; i < op.paths.length; i++) {
      const inside = hits(transformedBox(op.paths[i].bounds(), m, pad), box);
      if (inside && !kept) continue;
      // First miss: start the reduced array with the paths accepted so far.
      kept ??= op.paths.slice(0, i);
      if (inside) kept.push(op.paths[i]);
    }
    if (!kept) ops.push(op);
    else if (kept.length) ops.push({ ...op, paths: kept });
  }
  if (ops.length === list.ops.length && ops.every((op, i) => op === list.ops[i])) return list;
  return { width: list.width, height: list.height, ops, stats: { ...list.stats, ops: ops.length }, ...(list.unsupported !== undefined ? { unsupported: list.unsupported } : {}) };
}

/** Flattening tolerance of a recorded transform: the rule of the live rasterizer (transforms.ts `tolerance` of the
 * recorded transform), so a polygon clipped here has the vertices the live replay would have drawn. */
function flattenTolerance(m: Mat): number {
  return tolerance(m);
}

/** A path with a fixed outline (already flattened): what `clipList` puts in place of a polygon it cut. */
class FixedPath implements RecordedPath {
  readonly version = 0;
  readonly readable = true;
  constructor(private readonly outline: PathGeometry) {}
  bounds(): Box {
    return this.outline.bbox;
  }
  geometry(): PathGeometry {
    return this.outline;
  }
}
const NO_OUTLINE: PathGeometry = { points: new Float32Array(0), starts: new Uint32Array([0]), closed: new Uint8Array(0), bbox: [Infinity, Infinity, -Infinity, -Infinity] };

/** One Sutherland-Hodgman pass: the ring `src` (x,y pairs, `n` vertices, implicitly closed) cut by the half-plane
 * `coordinate[axis] >= bound` (`greater`) or `<= bound`, into `out`. Returns the vertex count. Edges that run along
 * the bound are kept: they carry the winding of what was cut away, so the winding number inside is unchanged. */
function cutRing(src: number[], n: number, out: number[], axis: 0 | 1, bound: number, greater: boolean): number {
  let count = 0;
  let px = src[(n - 1) * 2],
    py = src[(n - 1) * 2 + 1];
  let pin = greater ? (axis ? py : px) >= bound : (axis ? py : px) <= bound;
  for (let i = 0; i < n; i++) {
    const x = src[i * 2],
      y = src[i * 2 + 1],
      v = axis ? y : x,
      inside = greater ? v >= bound : v <= bound;
    if (inside !== pin) {
      const pv = axis ? py : px,
        t = (bound - pv) / (v - pv);
      out[count * 2] = axis ? px + t * (x - px) : bound;
      out[count * 2 + 1] = axis ? bound : py + t * (y - py);
      count++;
    }
    if (inside) {
      out[count * 2] = x;
      out[count * 2 + 1] = y;
      count++;
    }
    px = x;
    py = y;
    pin = inside;
  }
  return count;
}

/** The subpaths of `geometry`, each closed and cut to `window` (path coordinates). Null when nothing is left.
 * For filling and clipping only: inside the window the winding of every point is the one of the whole outline. */
export function clipGeometry(geometry: PathGeometry, window: Box): PathGeometry | null {
  const { points: p, starts } = geometry,
    pts: number[] = [],
    ends: number[] = [0];
  let a: number[] = [],
    b: number[] = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let s = 0; s + 1 < starts.length; s++) {
    let n = starts[s + 1] - starts[s];
    if (n < 3) continue;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = p[(starts[s] + i) * 2],
        y = p[(starts[s] + i) * 2 + 1];
      a[i * 2] = x;
      a[i * 2 + 1] = y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < window[0] || x0 > window[2] || y1 < window[1] || y0 > window[3]) continue;
    // Four half-planes in turn; a ring wholly inside one is not copied.
    if (x0 < window[0]) {
      n = cutRing(a, n, b, 0, window[0], true);
      [a, b] = [b, a];
    }
    if (n >= 3 && x1 > window[2]) {
      n = cutRing(a, n, b, 0, window[2], false);
      [a, b] = [b, a];
    }
    if (n >= 3 && y0 < window[1]) {
      n = cutRing(a, n, b, 1, window[1], true);
      [a, b] = [b, a];
    }
    if (n >= 3 && y1 > window[3]) {
      n = cutRing(a, n, b, 1, window[3], false);
      [a, b] = [b, a];
    }
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const x = a[i * 2],
        y = a[i * 2 + 1];
      pts.push(x, y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    ends.push(pts.length / 2);
  }
  if (!pts.length) return null;
  return { points: new Float32Array(pts), starts: new Uint32Array(ends), closed: new Uint8Array(ends.length - 1).fill(1), bbox: [minX, minY, maxX, maxY] };
}

/**
 * The segments of `geometry` whose boxes meet `window` (path coordinates, grown by the reach of the stroke), as open
 * runs of whole segments; a subpath kept whole stays as it was (closed if it was). Null when nothing is left.
 * For solid strokes only: a run ends at a vertex of a dropped segment, which lies outside the window by more than the
 * reach, so the cap drawn there, like the join it replaces, cannot show; kept segments, joins and their order within
 * the path are unchanged. Dashes are measured from the start of the subpath: a dashed stroke must not be cut.
 */
export function cullSegments(geometry: PathGeometry, window: Box): PathGeometry | null {
  const { points: p, starts, closed } = geometry,
    pts: number[] = [],
    ends: number[] = [0],
    flags: number[] = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    keep = new Uint8Array(256);
  const push = (vertex: number): void => {
    const x = p[vertex * 2],
      y = p[vertex * 2 + 1];
    pts.push(x, y);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (let s = 0; s + 1 < starts.length; s++) {
    const base = starts[s],
      n = starts[s + 1] - base;
    if (n < 1) continue;
    if (n === 1) {
      const x = p[base * 2],
        y = p[base * 2 + 1];
      if (x >= window[0] && x <= window[2] && y >= window[1] && y <= window[3]) {
        push(base);
        ends.push(pts.length / 2);
        flags.push(closed[s]);
      }
      continue;
    }
    // A closed subpath has one more segment, from its last vertex back to its first.
    const ring = closed[s] === 1,
      m = ring ? n : n - 1;
    if (keep.length < m) keep = new Uint8Array(m * 2);
    let kept = 0,
      dropped = -1;
    for (let i = 0; i < m; i++) {
      const a = base + i,
        b = base + ((i + 1) % n),
        ax = p[a * 2],
        ay = p[a * 2 + 1],
        bx = p[b * 2],
        by = p[b * 2 + 1];
      const inside = Math.max(ax, bx) >= window[0] && Math.min(ax, bx) <= window[2] && Math.max(ay, by) >= window[1] && Math.min(ay, by) <= window[3];
      keep[i] = inside ? 1 : 0;
      if (inside) kept++;
      else if (dropped < 0) dropped = i;
    }
    if (!kept) continue;
    if (kept === m) {
      for (let i = 0; i < n; i++) push(base + i);
      ends.push(pts.length / 2);
      flags.push(closed[s]);
      continue;
    }
    // Runs of kept segments; a ring is walked from just after a dropped segment, so no run wraps around its start.
    const first = ring ? (dropped + 1) % m : 0;
    let open = false;
    for (let j = 0; j < m; j++) {
      const i = (first + j) % m;
      if (keep[i]) {
        if (!open) {
          push(base + i);
          open = true;
        }
        push(base + ((i + 1) % n));
      } else if (open) {
        ends.push(pts.length / 2);
        flags.push(0);
        open = false;
      }
    }
    if (open) {
      ends.push(pts.length / 2);
      flags.push(0);
    }
  }
  if (!pts.length) return null;
  return { points: new Float32Array(pts), starts: new Uint32Array(ends), closed: new Uint8Array(flags), bbox: [minX, minY, maxX, maxY] };
}

/** Vertices under which cutting an outline saves nothing worth a new path. */
const CLIP_MIN_FLOATS = 128;

/**
 * The list with its large filled and clipping polygons cut to `box` grown by `margin` (device pixels of the recorded
 * canvas): the sea, the land clip or a lake that span the map are fanned for the part a band can show, not whole.
 * Replaying the result inside a scissor contained in `box` gives the same pixels: cutting keeps the winding of every
 * point of the window, for both fill rules. Only axis-aligned transforms are cut, and only outlines with less than
 * half of their bounds in the window. Stroked outlines are never cut that way (a cut outline would draw its cut
 * edges): a long solid stroke keeps its whole segments that can reach the window (`cullSegments`), so the contours,
 * coasts and roads of the map are instanced for the band, not for the map. A clip that leaves nothing in the window
 * drops the ops under it. Ops and clip nodes left as they were are the same objects.
 */
export function clipList(list: DisplayList, box: Box, margin = 32): DisplayList {
  const win: Box = [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin];
  const done = new Map<RecordedPath, { t: Mat; path: RecordedPath | null }>();
  /** The path to draw in place of `path` under `t`: itself, a cut copy, or null when nothing of it is in the window. */
  const cut = (path: RecordedPath, t: Mat): RecordedPath | null => {
    if (t[1] !== 0 || t[2] !== 0 || t[0] === 0 || t[3] === 0 || !path.readable) return path;
    const b = transformedBox(path.bounds(), t, 0);
    if (!b) return path;
    const ix = Math.min(b[2], win[2]) - Math.max(b[0], win[0]),
      iy = Math.min(b[3], win[3]) - Math.max(b[1], win[1]);
    if (ix <= 0 || iy <= 0) return null;
    if ((b[2] - b[0]) * (b[3] - b[1]) <= 2 * ix * iy) return path;
    const memo = done.get(path);
    if (memo && memo.t[0] === t[0] && memo.t[3] === t[3] && memo.t[4] === t[4] && memo.t[5] === t[5]) return memo.path;
    const outline = path.geometry(flattenTolerance(t));
    let result: RecordedPath | null = path;
    if (outline.points.length >= CLIP_MIN_FLOATS) {
      // The window in path coordinates (a negative scale swaps its sides).
      const xa = (win[0] - t[4]) / t[0],
        xb = (win[2] - t[4]) / t[0],
        ya = (win[1] - t[5]) / t[3],
        yb = (win[3] - t[5]) / t[3];
      const made = clipGeometry(outline, [Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb)]);
      result = made ? new FixedPath(made) : null;
    }
    done.set(path, { t, path: result });
    return result;
  };
  const stroked = new Map<RecordedPath, { t: Mat; reach: number; path: RecordedPath | null }>();
  /** The path to stroke in place of `path` under `t` with a stroke reaching `reach` device pixels from its line:
   * itself, its segments that can touch the window, or null when none can. */
  const cutStroke = (path: RecordedPath, t: Mat, reach: number): RecordedPath | null => {
    if (t[1] !== 0 || t[2] !== 0 || t[0] === 0 || t[3] === 0 || !path.readable) return path;
    const b = transformedBox(path.bounds(), t, reach);
    if (!b) return path;
    const ix = Math.min(b[2], win[2]) - Math.max(b[0], win[0]),
      iy = Math.min(b[3], win[3]) - Math.max(b[1], win[1]);
    if (ix <= 0 || iy <= 0) return null;
    // Lines have no area: worth it when the path extends over twice what the window holds of it.
    if (b[2] - b[0] + b[3] - b[1] <= 2 * (ix + iy)) return path;
    const memo = stroked.get(path);
    // A wider stroke of the same path (a casing before its fill) kept a superset: it serves.
    if (memo && memo.reach >= reach && memo.t[0] === t[0] && memo.t[3] === t[3] && memo.t[4] === t[4] && memo.t[5] === t[5]) return memo.path;
    const outline = path.geometry(flattenTolerance(t));
    let result: RecordedPath | null = path;
    if (outline.points.length >= CLIP_MIN_FLOATS) {
      const xa = (win[0] - reach - t[4]) / t[0],
        xb = (win[2] + reach - t[4]) / t[0],
        ya = (win[1] - reach - t[5]) / t[3],
        yb = (win[3] + reach - t[5]) / t[3];
      const made = cullSegments(outline, [Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb)]);
      // Nothing dropped: the recorded path stays (its uploads are shared with the other bands and regions).
      result = !made ? null : made.points.length < outline.points.length ? new FixedPath(made) : path;
    }
    stroked.set(path, { t, reach, path: result });
    return result;
  };
  const nodes = new Map<ClipNode, ClipNode | false>();
  /** The clip node to use in place of `node`; false when its region is empty in the window. */
  const clipOf = (node: ClipNode | null): ClipNode | null | false => {
    if (!node) return null;
    let made = nodes.get(node);
    if (made === undefined) {
      const parent = clipOf(node.parent);
      if (parent === false) made = false;
      else {
        const path = cut(node.path, node.transform);
        made = !path ? false : path === node.path && parent === node.parent ? node : { parent, path, rule: node.rule, transform: node.transform, id: node.id };
      }
      nodes.set(node, made);
    }
    return made;
  };
  const ops: DrawOp[] = [];
  let changed = false;
  for (const op of list.ops) {
    const clip = clipOf(op.clip);
    if (clip === false) {
      changed = true;
      continue;
    }
    // Solid strokes only (dashes are measured from the start of the path); destination-in strokes act on the whole clip.
    const cuttable = op.type === 'fill' || (op.type === 'stroke' && !op.dash.length && op.composite !== 'destination-in');
    if (!cuttable) {
      if (clip === op.clip) ops.push(op);
      else {
        ops.push({ ...op, clip });
        changed = true;
      }
      continue;
    }
    let reach = 0;
    if (op.type === 'stroke') {
      const s = Math.sqrt(Math.abs(op.transform[0] * op.transform[3]));
      // As cullList: half the device width (never under a pixel), the miter or square-cap overshoot, antialiasing.
      reach = (Math.max(1, op.width * s) * Math.max(1.5, op.join === 'miter' ? op.miterLimit : 1)) / 2 + 2;
    }
    let paths: RecordedPath[] | undefined;
    for (let i = 0; i < op.paths.length; i++) {
      const path = op.type === 'fill' ? cut(op.paths[i], op.transform) : cutStroke(op.paths[i], op.transform, reach);
      if (path === op.paths[i] && !paths) continue;
      paths ??= op.paths.slice(0, i);
      if (path) paths.push(path);
    }
    // destination-in clears the clip outside its paths: the op stays even with nothing left to fill.
    if (op.type === 'fill' && paths && !paths.length && op.composite === 'destination-in') paths.push(new FixedPath(NO_OUTLINE));
    if (!paths && clip === op.clip) {
      ops.push(op);
      continue;
    }
    changed = true;
    if (!paths) ops.push({ ...op, clip });
    else if (paths.length) ops.push({ ...op, clip, paths });
  }
  if (!changed) return list;
  return { width: list.width, height: list.height, ops, stats: { ...list.stats, ops: ops.length }, ...(list.unsupported !== undefined ? { unsupported: list.unsupported } : {}) };
}
