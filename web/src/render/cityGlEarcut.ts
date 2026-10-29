/*! Mapbox Earcut 2.2.4
ISC License

Copyright (c) 2016, Mapbox

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
*/
/** Polygon triangulation (ear clipping with z-order hashing and hole bridging).
 * TypeScript port of mapbox/earcut 2.2.4 (ISC licence, © Mapbox), kept dependency-free
 * for the City Bench WebGL prototype. `data` is flat [x0, y0, x1, y1, …]; holes start
 * at the vertex indices given in `holes`. Returns triangle vertex indices appended to `out`. */
interface Node { i: number; x: number; y: number; prev: Node; next: Node; z: number; prevZ: Node | null; nextZ: Node | null; steiner: boolean }

export function earcut(data: ArrayLike<number>, holes: readonly number[] = [], out: number[] = []): number[] {
  const hasHoles = holes.length > 0, outerLen = hasHoles ? holes[0] * 2 : data.length;
  let outer = linkedList(data, 0, outerLen, true);
  if (!outer || outer.next === outer.prev) return out;
  let minX = 0, minY = 0, invSize = 0;
  if (hasHoles) outer = eliminateHoles(data, holes, outer);
  if (data.length > 80 * 2) {
    minX = Infinity; minY = Infinity; let maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < outerLen; i += 2) {
      const x = data[i], y = data[i + 1];
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    invSize = Math.max(maxX - minX, maxY - minY); invSize = invSize !== 0 ? 32767 / invSize : 0;
  }
  earcutLinked(outer, out, minX, minY, invSize, 0);
  return out;
}

function linkedList(data: ArrayLike<number>, start: number, end: number, clockwise: boolean): Node | null {
  let last: Node | null = null;
  if (clockwise === (signedArea(data, start, end) > 0)) for (let i = start; i < end; i += 2) last = insertNode(i / 2, data[i], data[i + 1], last);
  else for (let i = end - 2; i >= start; i -= 2) last = insertNode(i / 2, data[i], data[i + 1], last);
  if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
  return last;
}
function filterPoints(start: Node | null, end?: Node | null): Node | null {
  if (!start) return start;
  if (!end) end = start;
  let p = start, again: boolean;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p); p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else p = p.next;
  } while (again || p !== end);
  return end;
}
function earcutLinked(start: Node | null, out: number[], minX: number, minY: number, invSize: number, pass: number): void {
  if (!start) return;
  let ear: Node = start;
  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
  let stop = ear;
  while (ear.prev !== ear.next) {
    const prev: Node = ear.prev, next: Node = ear.next;
    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      out.push(prev.i, ear.i, next.i);
      removeNode(ear);
      ear = next.next; stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) earcutLinked(filterPoints(ear), out, minX, minY, invSize, 1);
      else if (pass === 1) { ear = cureLocalIntersections(filterPoints(ear)!, out); earcutLinked(ear, out, minX, minY, invSize, 2); }
      else if (pass === 2) splitEarcut(ear, out, minX, minY, invSize);
      break;
    }
  }
}
function isEar(ear: Node): boolean {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  const x0 = Math.min(a.x, b.x, c.x), y0 = Math.min(a.y, b.y, c.y), x1 = Math.max(a.x, b.x, c.x), y1 = Math.max(a.y, b.y, c.y);
  let p = c.next;
  while (p !== a) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}
function isEarHashed(ear: Node, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  const x0 = Math.min(a.x, b.x, c.x), y0 = Math.min(a.y, b.y, c.y), x1 = Math.max(a.x, b.x, c.x), y1 = Math.max(a.y, b.y, c.y);
  const minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
  let p = ear.prevZ, n = ear.nextZ;
  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }
  while (p && p.z >= minZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
  }
  while (n && n.z <= maxZ) {
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }
  return true;
}
function cureLocalIntersections(start: Node, out: number[]): Node {
  let p = start;
  do {
    const a = p.prev, b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      out.push(a.i, p.i, b.i);
      removeNode(p); removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p)!;
}
function splitEarcut(start: Node, out: number[], minX: number, minY: number, invSize: number): void {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c: Node | null = splitPolygon(a, b);
        a = filterPoints(a, a.next)!; c = filterPoints(c, c.next);
        earcutLinked(a, out, minX, minY, invSize, 0); earcutLinked(c, out, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}
function eliminateHoles(data: ArrayLike<number>, holes: readonly number[], outer: Node): Node {
  const queue: Node[] = [];
  for (let i = 0; i < holes.length; i++) {
    const start = holes[i] * 2, end = i < holes.length - 1 ? holes[i + 1] * 2 : data.length;
    const list = linkedList(data, start, end, false);
    if (!list) continue;
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }
  queue.sort((a, b) => a.x - b.x);
  for (const hole of queue) outer = eliminateHole(hole, outer);
  return outer;
}
function eliminateHole(hole: Node, outer: Node): Node {
  const bridge = findHoleBridge(hole, outer);
  if (!bridge) return outer;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next)!;
}
function findHoleBridge(hole: Node, outer: Node): Node | null {
  let p = outer, qx = -Infinity, m: Node | null = null;
  const hx = hole.x, hy = hole.y;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) { qx = x; m = p.x < p.next.x ? p : p.next; if (x === hx) return m; }
    }
    p = p.next;
  } while (p !== outer);
  if (!m) return null;
  const stop = m, mx = m.x, my = m.y;
  let tanMin = Infinity;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m!.x || (p.x === m!.x && sectorContainsSector(m!, p)))))) { m = p; tanMin = tan; }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}
function sectorContainsSector(m: Node, p: Node): boolean { return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0; }
function indexCurve(start: Node, minX: number, minY: number, invSize: number): void {
  let p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev; p.nextZ = p.next; p = p.next;
  } while (p !== start);
  p.prevZ!.nextZ = null; p.prevZ = null;
  sortLinked(p);
}
function sortLinked(list: Node): Node {
  let inSize = 1, numMerges: number;
  do {
    let p: Node | null = list, e: Node, tail: Node | null = null;
    list = null as unknown as Node; numMerges = 0;
    while (p) {
      numMerges++;
      let q: Node | null = p, pSize = 0;
      for (let i = 0; i < inSize; i++) { pSize++; q = q.nextZ; if (!q) break; }
      let qSize = inSize;
      while (pSize > 0 || (qSize > 0 && q)) {
        if (pSize !== 0 && (qSize === 0 || !q || p!.z <= q.z)) { e = p!; p = p!.nextZ; pSize--; }
        else { e = q!; q = q!.nextZ; qSize--; }
        if (tail) tail.nextZ = e; else list = e;
        e.prevZ = tail; tail = e;
      }
      p = q;
    }
    tail!.nextZ = null; inSize *= 2;
  } while (numMerges > 1);
  return list;
}
function zOrder(x0: number, y0: number, minX: number, minY: number, invSize: number): number {
  let x = (x0 - minX) * invSize | 0, y = (y0 - minY) * invSize | 0;
  x = (x | (x << 8)) & 0x00FF00FF; x = (x | (x << 4)) & 0x0F0F0F0F; x = (x | (x << 2)) & 0x33333333; x = (x | (x << 1)) & 0x55555555;
  y = (y | (y << 8)) & 0x00FF00FF; y = (y | (y << 4)) & 0x0F0F0F0F; y = (y | (y << 2)) & 0x33333333; y = (y | (y << 1)) & 0x55555555;
  return x | (y << 1);
}
function getLeftmost(start: Node): Node {
  let p = start, leftmost = start;
  do { if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p; p = p.next; } while (p !== start);
  return leftmost;
}
function pointInTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
}
function isValidDiagonal(a: Node, b: Node): boolean {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
    (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) !== 0 || area(a, b.prev, b) !== 0) ||
      equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0);
}
const area = (p: Node, q: Node, r: Node): number => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
const equals = (p1: Node, p2: Node): boolean => p1.x === p2.x && p1.y === p2.y;
function intersects(p1: Node, q1: Node, p2: Node, q2: Node): boolean {
  const o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)), o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}
const onSegment = (p: Node, q: Node, r: Node): boolean => q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
const sign = (v: number): number => v > 0 ? 1 : v < 0 ? -1 : 0;
function intersectsPolygon(a: Node, b: Node): boolean {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}
const locallyInside = (a: Node, b: Node): boolean => area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
function middleInside(a: Node, b: Node): boolean {
  let p = a, inside = false;
  const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
  do {
    if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}
function splitPolygon(a: Node, b: Node): Node {
  const a2 = createNode(a.i, a.x, a.y), b2 = createNode(b.i, b.x, b.y), an = a.next, bp = b.prev;
  a.next = b; b.prev = a; a2.next = an; an.prev = a2; b2.next = a2; a2.prev = b2; bp.next = b2; b2.prev = bp;
  return b2;
}
function insertNode(i: number, x: number, y: number, last: Node | null): Node {
  const p = createNode(i, x, y);
  if (!last) { p.prev = p; p.next = p; }
  else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
  return p;
}
function removeNode(p: Node): void {
  p.next.prev = p.prev; p.prev.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}
function createNode(i: number, x: number, y: number): Node {
  return { i, x, y, prev: null as unknown as Node, next: null as unknown as Node, z: 0, prevZ: null, nextZ: null, steiner: false };
}
function signedArea(data: ArrayLike<number>, start: number, end: number): number {
  let sum = 0;
  for (let i = start, j = end - 2; i < end; i += 2) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; }
  return sum;
}
