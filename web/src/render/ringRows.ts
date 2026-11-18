/** Even-odd point tests on long rings (river banks, coasts, moats): the edges are bucketed by rows of y, a point reads
 * the edges of its own row. Same predicate and arithmetic as the edge-by-edge loops it replaces. */
interface RingPoint {
  x: number;
  y: number;
}
interface RingRows {
  y0: number;
  y1: number;
  inv: number;
  lists: Int32Array[];
}
const ringRows = new WeakMap<readonly RingPoint[], RingRows | null>();
/** Rings below this many points are tested edge by edge. */
const ROWS_MIN_POINTS = 48;
function rowsOf(ring: readonly RingPoint[]): RingRows | null {
  let rows = ringRows.get(ring);
  if (rows !== undefined) return rows;
  rows = null;
  if (ring.length >= ROWS_MIN_POINTS) {
    let y0 = Infinity,
      y1 = -Infinity;
    for (const p of ring) {
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    if (Number.isFinite(y0) && Number.isFinite(y1) && y1 > y0) {
      // Long edges are listed in every row they span: fewer rows when the lists would outgrow the ring.
      for (let count = Math.min(1024, ring.length >> 2); count >= 1 && !rows; count >>= 1) {
        const inv = count / (y1 - y0),
          row = (y: number): number => Math.max(0, Math.min(count - 1, Math.floor((y - y0) * inv)));
        const lists: number[][] = Array.from({ length: count }, () => []);
        let entries = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length && entries <= 8 * ring.length; j = i++) {
          const ay = ring[i].y,
            by = ring[j].y;
          if (ay !== ay || by !== by) continue; // an edge with a NaN end never crosses
          for (let r = row(Math.min(ay, by)), last = row(Math.max(ay, by)); r <= last; r++) {
            lists[r].push(i);
            entries++;
          }
        }
        if (entries <= 8 * ring.length) rows = { y0, y1, inv, lists: lists.map(list => Int32Array.from(list)) };
      }
    }
  }
  ringRows.set(ring, rows);
  return rows;
}
/** `polygonContains` (gen/core/geom.ts) for long rings: the same even-odd test and arithmetic, on the edges of the
 * point's row. An edge can only cross the point's horizontal when its y range holds the point, and the row of a value
 * is monotonic, so every such edge is in the row's list: the boolean is the same. */
export function ringContains(ring: readonly RingPoint[], x: number, y: number): boolean {
  const rows = rowsOf(ring),
    last = ring.length - 1;
  let inside = false;
  if (!rows) {
    for (let i = 0, j = last; i <= last; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  if (!(y >= rows.y0 && y <= rows.y1)) return false;
  const lists = rows.lists,
    list = lists[Math.max(0, Math.min(lists.length - 1, Math.floor((y - rows.y0) * rows.inv)))];
  for (let k = 0; k < list.length; k++) {
    const i = list[k],
      a = ring[i],
      b = ring[i ? i - 1 : last];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
