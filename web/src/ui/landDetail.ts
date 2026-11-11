import type { Polygon } from '../gen/core/geom';
import type { LandArea, LandUseLayer } from '../gen/types';
import type { ForestOccupation, LandDetail } from '../../../rust/bridge/terrainForest';
import { fillRings } from './forestOccupation';

/** Crop positions on the shader ramp (`landCropTone`) and their share: plough, stubble, ripe wheat, barley, oats, beans. */
const CROPS: readonly (readonly [number, number])[] = [[.03, .10], [.18, .10], [.36, .30], [.52, .20], [.72, .20], [.92, .10]];
/** Share of the strips of a holding sown apart from it: the open-field mosaic. */
const STRAY_STRIP = .2, STRIP_JITTER = .05;
/** Metres of edge distance held by the alpha channel; the shader reads the same range. */
const LAND_EDGE_RANGE = 6;
const DETAILED = new Set<LandArea['kind']>(['field', 'orchard', 'garden']);

const mix32 = (value: number): number => {
  let h = Math.imul(value ^ value >>> 16, 0x7feb352d); h = Math.imul(h ^ h >>> 15, 0x846ca68b);
  return (h ^ h >>> 16) >>> 0;
};
const unit = (value: number): number => mix32(value) / 4294967296;
function pickCrop(u: number): number {
  let sum = 0;
  for (const [tone, share] of CROPS) { sum += share; if (u < sum) return tone; }
  return CROPS[CROPS.length - 1][0];
}
/** Direction of the longest edge: rows of an orchard or a garden follow their plot. */
function longestEdge(ring: Polygon): number {
  let best = 0, angle = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (d > best) { best = d; angle = Math.atan2(b.y - a.y, b.x - a.x); }
  }
  return angle;
}

/**
 * Rasterises the holdings of the rural land use for the satellite ground: the shader draws crops, furrows and
 * balks from it, so fields keep their real strips and directions without any vector overlay.
 * RGBA8, filterable: R crop position, G and B cos 2a and sin 2a of the row direction, A exact distance to the
 * nearest strip edge over LAND_EDGE_RANGE metres, 0 outside. Deterministic: same layer, same bytes.
 */
export function landDetail(landuse: LandUseLayer, maxN = 3072, minCell = 1): LandDetail | undefined {
  const areas = landuse.areas.filter(area => DETAILED.has(area.kind));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const area of areas) for (const p of area.poly) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  if (!(maxX > minX && maxY > minY)) return undefined;
  const side = Math.max(maxX - minX, maxY - minY), cell = Math.max(minCell, side / (maxN - 4)), n = Math.min(maxN, Math.ceil(side / cell) + 4);
  const x = (Math.floor(minX / cell) - 2) * cell, y = (Math.floor(minY / cell) - 2) * cell;
  const owner = new Uint32Array(n * n), edge = new Float32Array(n * n).fill(LAND_EDGE_RANGE), crop: number[] = [0], angle: number[] = [0];
  // Exact distance to a ring: per segment, refresh only the texels of its capsule of radius LAND_EDGE_RANGE (only
  // d < LAND_EDGE_RANGE can lower `edge`). Row by row, the texel centres within R of the segment lie within R in x of
  // the part of the segment whose y is within R of the row: a superset of the capsule, so the result is exact.
  const R = LAND_EDGE_RANGE;
  const stamp = (ring: Polygon): void => {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - R - y) / cell - .5)), j1 = Math.min(n - 1, Math.ceil((Math.max(a.y, b.y) + R - y) / cell - .5));
      for (let j = j0; j <= j1; j++) {
        const yc = y + (j + .5) * cell;
        // Segment parameters with |a.y + t dy - yc| <= R.
        let t0 = 0, t1 = 1;
        if (dy !== 0) { const u = (yc - R - a.y) / dy, v = (yc + R - a.y) / dy; t0 = Math.max(0, Math.min(u, v)); t1 = Math.min(1, Math.max(u, v)); if (t0 > t1) continue; }
        else if (Math.abs(a.y - yc) > R) continue;
        const xa = a.x + t0 * dx, xb = a.x + t1 * dx;
        const i0 = Math.max(0, Math.floor((Math.min(xa, xb) - R - x) / cell - .5)), i1 = Math.min(n - 1, Math.ceil((Math.max(xa, xb) + R - x) / cell - .5));
        const py = yc - a.y, row = j * n;
        for (let i = i0; i <= i1; i++) {
          const px = x + (i + .5) * cell - a.x, t = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0;
          const qx = px - t * dx, qy = py - t * dy, d2 = qx * qx + qy * qy, at = row + i, e = edge[at];
          if (d2 < e * e) edge[at] = Math.sqrt(d2);
        }
      }
    }
  };
  let next = 1;
  // A holding under its strips only shows in the slivers between them: those take the neighbouring strip.
  const under = new Set<number>();
  const paint = (rings: Polygon[], tone: number, direction: number, hidden = false): void => {
    const id = next++; crop[id] = tone; angle[id] = direction; if (hidden) under.add(id);
    fillRings(rings, x, y, cell, n, (from, to) => owner.fill(id, from, to));
    rings.forEach(stamp);
  };
  areas.forEach((area, index) => {
    const base = pickCrop(unit(index * 2 + 1)), direction = area.stripAngle ?? longestEdge(area.poly);
    paint([area.poly, ...area.holes ?? []], base, direction, !!area.strips?.length);
    area.strips?.forEach((strip, k) => {
      const salt = index * 8191 + k * 2 + 1, stray = unit(salt) < STRAY_STRIP;
      paint([strip], stray ? pickCrop(unit(salt + 1)) : Math.min(1, Math.max(0, base + (unit(salt + 1) * 2 - 1) * STRIP_JITTER)), direction);
    });
  });
  const rgba = new Uint8Array(n * n * 4), scale = 255 / LAND_EDGE_RANGE;
  const cos2 = angle.map(a => Math.round((Math.cos(2 * a) * .5 + .5) * 255)), sin2 = angle.map(a => Math.round((Math.sin(2 * a) * .5 + .5) * 255)), tone = crop.map(c => Math.round(c * 255));
  // Crops meet at the true edge: a texel across from another strip takes its share, so filtering draws a straight line.
  const across = (i: number, id: number): number => {
    for (const step of [1, -1, n, -n, n + 1, n - 1, 1 - n, -1 - n]) { const other = owner[i + step]; if (other && other !== id) return other; }
    return 0;
  };
  let hash = 0x811c9dc5;
  for (let i = 0, o = 0; i < n * n; i++, o += 4) {
    const id = owner[i]; if (!id) continue;
    const other = (under.has(id) || edge[i] < cell) && i > n && i < n * n - n - 1 ? across(i, id) : 0;
    rgba[o] = !other ? tone[id] : under.has(id) ? tone[other] : Math.round(tone[id] + (under.has(other) ? 0 : (tone[other] - tone[id]) * .5 * (1 - edge[i] / cell))); rgba[o + 1] = cos2[id]; rgba[o + 2] = sin2[id]; rgba[o + 3] = Math.max(1, Math.min(255, Math.round(edge[i] * scale)));
    hash = Math.imul(hash ^ id ^ i, 0x01000193);
  }
  return { x, y, width: n * cell, n, rgba, key: `land:${x}:${y}:${n * cell}:${n}:${(hash >>> 0).toString(36)}` };
}

/** The occupation of a land use with its holdings attached. */
export function withLandDetail(occupation: ForestOccupation | undefined, landuse: LandUseLayer): ForestOccupation | undefined {
  return occupation && { ...occupation, detail: landDetail(landuse) };
}
