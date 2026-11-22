/**
 * The one orchard lattice. The 2D marks (scene.ts orchardMarks), the 3D tree instances (terrain3dTrees.ts) and the
 * ground shader's crowns (rust/bridge/terrainForest.ts orchardCrown) plant fruit trees on the same points:
 * - the row direction is the parcel's (strip angle, else its longest edge), quantised as the land detail raster
 *   stores it (green: cos 2a, blue: sin 2a, one byte each), so a parcel has one exact frame everywhere;
 * - the 8 m lattice of that frame, with the shader's hashes (877, 878) for the jitter, crown radius and height;
 * - one edge clearance, written on the raster's edge share (alpha: .5 + d / 2R).
 */
import { forestHash } from '../../../rust/bridge/terrainForest';

export const ORCHARD_SPACING = 8;
/** Edge range of the land detail alpha on fine rasters (web/src/ui/landDetail.ts LAND_EDGE_RANGE). */
export const ORCHARD_EDGE_RANGE = 6;

type Ring = readonly { x: number; y: number }[];

/** Direction of the longest edge: rows of an orchard or a garden follow their plot. */
export function longestEdgeAngle(ring: Ring): number {
  let best = 0,
    angle = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (d > best) {
      best = d;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  return angle;
}

/** The row direction of a holding, before quantisation. */
export const rowDirection = (area: { poly: Ring; stripAngle?: number }): number => area.stripAngle ?? longestEdgeAngle(area.poly);

/** The two bytes the land detail raster stores for a row direction: cos 2a and sin 2a. */
export function rowBytes(angle: number): [number, number] {
  return [Math.round((Math.cos(2 * angle) * 0.5 + 0.5) * 255), Math.round((Math.sin(2 * angle) * 0.5 + 0.5) * 255)];
}

/** The unit row axis decoded from the raster bytes, as the shader decodes them (orchardRows). */
export function rowAxisOfBytes(cos2: number, sin2: number): [number, number] {
  const a = 0.5 * Math.atan2((sin2 / 255) * 2 - 1, (cos2 / 255) * 2 - 1);
  return [Math.cos(a), Math.sin(a)];
}

/** The quantised row axis of a holding: the frame its trees stand in, in 2D, in 3D and in the shader. */
export function orchardAxis(area: { poly: Ring; stripAngle?: number }): [number, number] {
  const [cos2, sin2] = rowBytes(rowDirection(area));
  return rowAxisOfBytes(cos2, sin2);
}

const u8 = (h: number, shift: number): number => (((h >>> shift) & 255) + 0.5) / 256;

/** One lattice tree: world position, crown radius and height (m), its two hashes (tint, phase, LOD thinning). */
export interface OrchardTree {
  x: number;
  y: number;
  radius: number;
  height: number;
  h: number;
  h2: number;
}

/** The tree of lattice cell (i, j) in the frame `axis` (written into `out`). `seed` is the material seed
 * (seedHash of the world seed, uMaterialSeed). */
export function orchardTree(i: number, j: number, ca: number, sa: number, seed: number, out: OrchardTree): OrchardTree {
  const h = forestHash(i, j, 877, seed),
    h2 = forestHash(i, j, 878, seed);
  const u = (i + 0.5 + (u8(h, 0) - 0.5) * 0.12) * ORCHARD_SPACING,
    v = (j + 0.5 + (u8(h, 8) - 0.5) * 0.12) * ORCHARD_SPACING;
  out.x = ca * u - sa * v;
  out.y = sa * u + ca * v;
  out.radius = 2.3 + 0.4 * u8(h, 16);
  out.height = 6 + 1.2 * u8(h2, 16);
  out.h = h;
  out.h2 = h2;
  return out;
}

/** Whether a crown of `radius` clears the holding's limit, from the raster edge share (alpha in 0..1). */
export const orchardClears = (edgeShare: number, radius: number): boolean => edgeShare * 6 > radius * 1.2;

/** The raster edge share of a signed edge distance (m, positive inside), on a fine raster. */
export const edgeShareOf = (distance: number): number => Math.max(0.5, Math.min(1, 0.5 + distance / (2 * ORCHARD_EDGE_RANGE)));

/** Distance (m) from a point to the nearest edge of a holding's rings. */
export function ringsDistance(rings: readonly Ring[], x: number, y: number): number {
  let best = Infinity;
  for (const ring of rings)
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const a = ring[k],
        b = ring[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
    }
  return best;
}

/** Lattice index range of a set of points in the frame `axis`, padded by one cell for the jitter. */
export function latticeRange(points: readonly number[], ca: number, sa: number): [number, number, number, number] {
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity;
  for (let k = 0; k < points.length; k += 2) {
    const u = points[k] * ca + points[k + 1] * sa,
      v = -points[k] * sa + points[k + 1] * ca;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  return [Math.floor(u0 / ORCHARD_SPACING) - 1, Math.ceil(u1 / ORCHARD_SPACING), Math.floor(v0 / ORCHARD_SPACING) - 1, Math.ceil(v1 / ORCHARD_SPACING)];
}
