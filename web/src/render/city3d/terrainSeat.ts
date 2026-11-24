/**
 * Ground sampling and terrain seating for display volumes. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads supplied terrain samplers and footprints; returns sampled bounds/seats/height functions without shared state.
 */
import type { Point, Surface } from '../../../../rust/bridge/housesContract';
import type { ArchitectureVolume, PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import { City3dHeight } from './types';
import { inRing, ringCentre } from './roofGeometry';

/** Steepest footprint ground (rise over run) still read as a hillside: a level floor stands
 * on its high side over a footing. Steeper is a cliff (Rust `activities::ground_fits`). */
export const CITY3D_CLIFF_SLOPE = 1;

/** Retaining plinth under a floor built against a cliff face, m. */
export const CITY3D_RETAINING_PLINTH_M = 3;
/** Depth of a footing below the lowest ground sample under its footprint, m. The terrain mesh is linear between its
 * vertices (several metres apart beyond the near tiles) and dips below the sampled relief on convex mountain ground:
 * a shallow footing left a gap under the downhill wall there. Underground, the extra depth is never seen. */
export const CITY3D_FOOTING_DEPTH_M = 1.5;
/** Stilts and posts are driven this far below their own ground sample, for the same mesh tolerance, m. */
export const CITY3D_POST_SINK_M = 0.5;

/** Terrain under a footprint: lowest and highest sample and steepest sample-to-sample slope.
 * Corners first; a large or uneven footprint adds an interior grid (inside its rings, at most
 * 9 × 9) so a cliff between corners is not missed. */
export function footprintTerrain(footprint: Surface, heightAt: City3dHeight): { low: number; high: number; slope: number } | undefined {
  let low = Infinity,
    high = -Infinity,
    slope = 0,
    x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const shape of footprint) {
    const ring = shape.outer,
      hs = ring.map(p => heightAt(p.x, p.y));
    ring.forEach((p, i) => {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
      const h = hs[i];
      if (!Number.isFinite(h)) return;
      low = Math.min(low, h);
      high = Math.max(high, h);
      const n = ring[(i + 1) % ring.length],
        hn = hs[(i + 1) % ring.length],
        run = Math.hypot(n.x - p.x, n.y - p.y);
      if (Number.isFinite(hn) && run > 0.5) slope = Math.max(slope, Math.abs(hn - h) / run);
    });
  }
  if (!Number.isFinite(low)) return undefined;
  if (high - low > 0.5 || Math.max(x1 - x0, y1 - y0) > 12) {
    const nx = Math.min(8, Math.max(1, Math.ceil((x1 - x0) / 2))),
      ny = Math.min(8, Math.max(1, Math.ceil((y1 - y0) / 2)));
    const dx = (x1 - x0) / nx,
      dy = (y1 - y0) / ny,
      grid: number[] = [];
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const p = { x: x0 + dx * i, y: y0 + dy * j };
        const h = footprint.some(shape => inRing(shape.outer, p)) ? heightAt(p.x, p.y) : NaN;
        grid.push(h);
        if (!Number.isFinite(h)) continue;
        low = Math.min(low, h);
        high = Math.max(high, h);
        const left = i > 0 ? grid[grid.length - 2] : NaN,
          up = j > 0 ? grid[grid.length - 2 - nx] : NaN;
        if (Number.isFinite(left) && dx > 1e-6) slope = Math.max(slope, Math.abs(h - left) / dx);
        if (Number.isFinite(up) && dy > 1e-6) slope = Math.max(slope, Math.abs(h - up) / dy);
      }
  }
  return { low, high, slope };
}

/** Floor level of a level building on that terrain: its high side on a hillside (the footing
 * fills down to the low side, terraces keep their heights), a retaining plinth above the low
 * side against a cliff (the uphill part stands into the face, never hung from the top). */
export const terrainSeat = (t: { low: number; high: number; slope: number }): number => (t.slope > CITY3D_CLIFF_SLOPE ? Math.min(t.high, t.low + CITY3D_RETAINING_PLINTH_M) : t.high);
/** Pieces closer than this (m) belong to one body. */
const BODY_GAP_M = 0.5;
/** Body index of each piece: pieces standing apart (a barn across the yard from its house) are bodies of their own;
 * pieces whose boxes touch or overlap (wings, nested tiers whose heights share one ground) form one body. */
export function pieceBodies(footprint: Surface): number[] {
  const body = footprint.map((_, i) => i);
  if (footprint.length < 2) return body;
  const boxes = footprint.map(shape => {
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
    return [x0 - BODY_GAP_M, y0 - BODY_GAP_M, x1 + BODY_GAP_M, y1 + BODY_GAP_M];
  });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      if (body[i] === body[j] || a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) continue;
      const from = Math.max(body[i], body[j]),
        to = Math.min(body[i], body[j]);
      for (let k = 0; k < body.length; k++) if (body[k] === from) body[k] = to;
    }
  // Each body is named by its first piece.
  return body;
}
/** Floor level of a body on the ground under it (`fallback` without a sampler), raised above the water under it
 * (`waterAt`, stilt sites), and the lowest ground its footing must reach. */
export function bodySeat(shapes: Surface, fallback: number, heightAt?: City3dHeight, waterAt?: City3dHeight): { seat: number; low: number } {
  const terrain = heightAt ? footprintTerrain(shapes, heightAt) : undefined;
  let seat = terrain ? terrainSeat(terrain) : fallback;
  if (waterAt)
    for (const shape of shapes)
      for (const p of [...shape.outer, ringCentre(shape.outer)]) {
        const water = waterAt(p.x, p.y);
        if (Number.isFinite(water)) seat = Math.max(seat, water);
      }
  return { seat, low: Math.min(seat, terrain?.low ?? seat) };
}
/** Level terrace under a piece (massing `footing.terrace`): a slab at the floor over its outline, its retaining wall
 * `wall_m` below the floor on the downhill edge, or down to the displayed ground wherever that lies lower (the shown
 * relief may differ from the generator's), sunk like a footing. */
export function terraceFooting(terrace: { ring: Point[]; wall_m: number }, seat: number, heightAt?: City3dHeight): ArchitectureVolume['foundation'] {
  const footprint = [{ outer: terrace.ring, holes: [] }],
    ground = heightAt ? footprintTerrain(footprint, heightAt)?.low : undefined;
  return { footprint, z_min_m: Math.min(seat - terrace.wall_m, ground ?? Infinity) - CITY3D_FOOTING_DEPTH_M, z_max_m: seat };
}
/** A native plan (compact or detailed, houses crate) seated on the displayed terrain like the city volumes: the whole
 * plan moves to `terrainSeat` of its footprint, and each footing standing on the ground reaches below the lowest ground
 * sample. A closed plan without any footing gets a plinth under its footprint where the ground drops under it: nothing
 * floats. The plan itself is returned when nothing moves. */
export function seatPlan(building: PlacedBuilding, heightAt?: City3dHeight): PlacedBuilding {
  const terrain = heightAt && Number.isFinite(building.ground_z_m) ? footprintTerrain(building.footprint, heightAt) : undefined;
  if (!terrain) return building;
  const dz = terrainSeat(terrain) - building.ground_z_m,
    bottom = terrain.low - CITY3D_FOOTING_DEPTH_M;
  // A footing standing on the ground (its bottom at or below the plan's ground) left above the displayed ground.
  const short = (f: { z_min_m: number } | undefined): boolean => !!f && f.z_min_m <= building.ground_z_m + 1e-6 && f.z_min_m + dz > terrain.low;
  const bare = terrain.high - terrain.low > 0.1 && building.volumes.some(v => v.envelope !== 'open') && !building.volumes.some(v => v.foundation?.footprint.length) && !building.structural_foundations?.length;
  if (!bare && Math.abs(dz) < 1e-6 && !building.volumes.some(v => short(v.foundation)) && !building.structural_foundations?.some(short)) return building;
  const footing = <T extends { z_min_m: number; z_max_m: number }>(f: T): T => ({ ...f, z_min_m: short(f) ? Math.min(f.z_min_m + dz, bottom) : f.z_min_m + dz, z_max_m: f.z_max_m + dz });
  const volumes = building.volumes.map(v => ({
    ...v,
    z_m: v.z_m + dz,
    levels: v.levels.map(l => ({ ...l, z_m: l.z_m + dz })),
    roof_mesh: v.roof_mesh && { ...v.roof_mesh, vertices: v.roof_mesh.vertices.map(p => ({ ...p, z: p.z + dz })) },
    foundation: v.foundation && footing(v.foundation),
  }));
  return {
    ...building,
    ground_z_m: building.ground_z_m + dz,
    volumes,
    ...(bare ? { structural_foundations: [{ footprint: building.footprint, z_min_m: bottom, z_max_m: building.ground_z_m + dz }] } : building.structural_foundations ? { structural_foundations: building.structural_foundations.map(footing) } : {}),
    structural_features: building.structural_features?.map(f => ({ ...f, z_m: f.z_m + dz, vertices3d: f.vertices3d.map(p => ({ ...p, z: p.z + dz })) })),
  };
}

/** Cubic B-spline of cell-centred samples, as Terrain3d samples its surface; water clamps to 0. */
export function rasterHeight(data: Float32Array, n: number, width: number): City3dHeight {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const weights = (t: number): number[] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
  return (x, y) => {
    const gx = clamp(x / width, 0, 1) * n - 0.5,
      gy = clamp(y / width, 0, 1) * n - 0.5,
      bx = Math.floor(gx),
      by = Math.floor(gy);
    const wx = weights(gx - bx),
      wy = weights(gy - by);
    let h = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) h += data[clamp(by + j - 1, 0, n - 1) * n + clamp(bx + i - 1, 0, n - 1)] * wx[i] * wy[j];
    return Math.max(0, h);
  };
}
