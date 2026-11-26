/**
 * Earcut results kept between two packings of the same renderer (triangulator.ts): a new packing that repeats a polygon
 * of the last one exactly (same rings, same origin-relative coordinates, same hidden edge) takes its triangles and
 * outline edges from it, and only the other polygons are triangulated. A local edit of a town re-packs the whole scene
 * but triangulates only the lots, blocks and buildings it changed.
 *
 * Pure geometry (no DOM, no WebGL). A hit is checked vertex by vertex, so a hash collision only costs a triangulation.
 */
import type { CityGlPolygons, CityGlTriangulation } from '../../cityGlBuild';

/** A packing and its triangulation, with the hash of each polygon once a later packing compared with it. */
export interface HeldTriangulation {
  polygons: CityGlPolygons;
  result: CityGlTriangulation;
  hashes?: Uint32Array;
}
const bitsOf = (coords: Float32Array): Uint32Array => new Uint32Array(coords.buffer, coords.byteOffset, coords.length);

/** One 32-bit hash per polygon: its ring sizes, coordinate bits and hidden edge. */
export function polygonHashes(p: CityGlPolygons): Uint32Array {
  const n = p.polys.length - 1,
    out = new Uint32Array(Math.max(0, n)),
    bits = bitsOf(p.coords);
  for (let q = 0; q < n; q++) {
    const r0 = p.polys[q],
      r1 = p.polys[q + 1];
    let h = Math.imul(0x811c9dc5 ^ (r1 - r0), 0x01000193) ^ (p.hiddenEdges?.[q] ?? 0);
    for (let r = r0; r < r1; r++) {
      const a = p.rings[r],
        b = p.rings[r + 1];
      h = Math.imul(h ^ (b - a), 0x01000193);
      for (let i = a * 2; i < b * 2; i++) h = Math.imul(h ^ bits[i], 0x01000193);
    }
    out[q] = (h ^ (h >>> 15)) >>> 0;
  }
  return out;
}
/** Polygon `q` of `a` and polygon `k` of `b` have the same rings, coordinates and hidden edge. */
function samePolygon(a: CityGlPolygons, q: number, aBits: Uint32Array, b: CityGlPolygons, k: number, bBits: Uint32Array): boolean {
  const ar0 = a.polys[q],
    ar1 = a.polys[q + 1],
    br0 = b.polys[k],
    br1 = b.polys[k + 1];
  if (ar1 - ar0 !== br1 - br0 || (a.hiddenEdges?.[q] ?? 0) !== (b.hiddenEdges?.[k] ?? 0)) return false;
  for (let r = 0; r < ar1 - ar0; r++) if (a.rings[ar0 + r + 1] - a.rings[ar0 + r] !== b.rings[br0 + r + 1] - b.rings[br0 + r]) return false;
  const av = a.rings[ar0] * 2,
    bv = b.rings[br0] * 2,
    len = a.rings[ar1] * 2 - av;
  for (let i = 0; i < len; i++) if (aBits[av + i] !== bBits[bv + i]) return false;
  return true;
}
/** For each polygon of `next`, the polygon of `held` it repeats (-1: none), and the packing of the others alone (vertex
 * indices rebased), which is what remains to triangulate. */
export function reusePlan(held: HeldTriangulation | undefined, next: CityGlPolygons, hashes: Uint32Array): { from: Int32Array; missing: CityGlPolygons; missingCount: number } {
  const n = next.polys.length - 1,
    from = new Int32Array(Math.max(0, n)).fill(-1);
  if (held) {
    const byHash = new Map<number, number>();
    const heldHashes = (held.hashes ??= polygonHashes(held.polygons));
    for (let q = heldHashes.length - 1; q >= 0; q--) byHash.set(heldHashes[q], q);
    const heldBits = bitsOf(held.polygons.coords),
      nextBits = bitsOf(next.coords);
    for (let q = 0; q < n; q++) {
      const k = byHash.get(hashes[q]);
      if (k !== undefined && samePolygon(next, q, nextBits, held.polygons, k, heldBits)) from[q] = k;
    }
  }
  // The polygons to triangulate, packed alone.
  let polys = 0,
    rings = 0,
    vertices = 0;
  for (let q = 0; q < n; q++)
    if (from[q] < 0) {
      polys++;
      rings += next.polys[q + 1] - next.polys[q];
      vertices += next.rings[next.polys[q + 1]] - next.rings[next.polys[q]];
    }
  const missing: CityGlPolygons = { coords: new Float32Array(vertices * 2), rings: new Uint32Array(rings + 1), polys: new Uint32Array(polys + 1), features: new Uint32Array(polys), ...(next.hiddenEdges ? { hiddenEdges: new Uint8Array(polys) } : {}) };
  let p = 0,
    r = 0,
    v = 0;
  for (let q = 0; q < n; q++) {
    if (from[q] >= 0) continue;
    const r0 = next.polys[q],
      r1 = next.polys[q + 1],
      v0 = next.rings[r0],
      v1 = next.rings[r1];
    missing.coords.set(next.coords.subarray(v0 * 2, v1 * 2), v * 2);
    for (let k = r0; k < r1; k++) missing.rings[++r] = v + next.rings[k + 1] - v0;
    if (next.hiddenEdges) missing.hiddenEdges![p] = next.hiddenEdges[q];
    missing.polys[++p] = r;
    v += v1 - v0;
  }
  return { from, missing, missingCount: polys };
}
const starts = (counts: Uint32Array): Uint32Array => {
  const out = new Uint32Array(counts.length + 1);
  for (let i = 0; i < counts.length; i++) out[i + 1] = out[i] + counts[i];
  return out;
};
/** The triangulation of `next`: each repeated polygon's indices from `held`, the others' from `fresh` (the
 * triangulation of `reusePlan`'s `missing`), shifted to the polygon's vertices in `next`. */
export function assembleTriangulation(held: HeldTriangulation | undefined, next: CityGlPolygons, from: Int32Array, missing: CityGlPolygons, fresh: CityGlTriangulation): CityGlTriangulation {
  const n = from.length,
    polyTriangles = new Uint32Array(n),
    polyLines = new Uint32Array(n);
  const heldTri = held && starts(held.result.polyTriangles),
    heldLin = held && starts(held.result.polyLines),
    freshTri = starts(fresh.polyTriangles),
    freshLin = starts(fresh.polyLines);
  let triangles = 0,
    lines = 0;
  for (let q = 0, f = 0; q < n; q++) {
    const k = from[q];
    polyTriangles[q] = k >= 0 ? held!.result.polyTriangles[k] : fresh.polyTriangles[f];
    polyLines[q] = k >= 0 ? held!.result.polyLines[k] : fresh.polyLines[f++];
    triangles += polyTriangles[q];
    lines += polyLines[q];
  }
  const out: CityGlTriangulation = { triangles: new Uint32Array(triangles), lines: new Uint32Array(lines), polyTriangles, polyLines };
  const copy = (src: Uint32Array, start: number, count: number, dst: Uint32Array, at: number, shift: number): void => {
    for (let i = 0; i < count; i++) dst[at + i] = src[start + i] + shift;
  };
  let t = 0,
    l = 0;
  for (let q = 0, f = 0; q < n; q++) {
    const k = from[q],
      v0 = next.rings[next.polys[q]];
    if (k >= 0) {
      const shift = v0 - held!.polygons.rings[held!.polygons.polys[k]];
      copy(held!.result.triangles, heldTri![k], polyTriangles[q], out.triangles, t, shift);
      copy(held!.result.lines, heldLin![k], polyLines[q], out.lines, l, shift);
    } else {
      const shift = v0 - missing.rings[missing.polys[f]];
      copy(fresh.triangles, freshTri[f], polyTriangles[q], out.triangles, t, shift);
      copy(fresh.lines, freshLin[f], polyLines[q], out.lines, l, shift);
      f++;
    }
    t += polyTriangles[q];
    l += polyLines[q];
  }
  return out;
}
