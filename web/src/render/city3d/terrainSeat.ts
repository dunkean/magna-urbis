/**
 * Ground sampling and terrain seating for display volumes. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads supplied terrain samplers and footprints; returns sampled bounds/seats/height functions without shared state.
 */
import type { Point, Surface } from '../../../../rust/bridge/housesContract';
import type { ArchitectureVolume, PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import { pieceTerrace, type MassingPiece } from '../cityMassing';
import { City3dHeight } from './types';
import { inRing, ringCentre } from './roofGeometry';

/** Steepest footprint ground (rise over run) still read as a hillside. Steeper is a cliff (Rust `activities::ground_fits`): the building stands at its foot, into the face. */
export const CITY3D_CLIFF_SLOPE = 1;
/** Highest plinth of a building on a slope: its floor over the lowest ground under it, m. The cut into the hill takes the rest. */
export const CITY3D_PLINTH_M = 0.6;
/** Sink into the hill that any building takes, m; a high one takes all its walls but a door. Past it the floor stands over a
 * lower storey opened downhill (volumeDetails.ts), of this height at most: a deep building is cut deeper. */
export const CITY3D_CUT_M = 5;
export const CITY3D_LOWER_STOREY_M = 3;
/** Wall left between the eave and a street that passes uphill of the house, m: its door opens there. */
export const CITY3D_STREET_DOOR_M = 2.2;
/** Sink where the ground is not cut back around the walls (caves keep their floors), m. */
const CITY3D_BURIED_M = 1;
/** Least height of the eave over the street at its highest point along the wall, m. */
const STREET_EAVE_M = 1.5;
/** A corner this close to the edge of its block stands on the street, m. */
const STREET_REACH_M = 2.5;
/** Body pieces whose ground drops more than this stand each at its own level, m. */
const SPLIT_DROP_M = 1.5;
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

/** What buildings are seated on: the natural ground (no lot levelled, nothing cut), whether the ground is cut back around
 * the walls standing under it (ui/urbanGroundShape.ts), and the outline of the block at a point: streets run along it, whose
 * ground is not cut. */
export interface SeatGround {
  at: City3dHeight;
  cut: boolean;
  blockAt?: (x: number, y: number) => readonly Point[] | undefined;
}
/** A building whose floor is cut into ground shaped to it: nothing else digs that ground around its walls (ui/urbanBuildingGround.ts). */
export interface CutBuilding {
  cutGround?: boolean;
}
/** Whether the drawn ground is shaped to the floors set on `ground`. */
export const shapedTo = (ground: SeatGround | undefined, heightAt: City3dHeight | undefined): CutBuilding => (ground?.cut && ground.at !== heightAt ? { cutGround: true } : {});
/** Seat of one piece of a building: its floor, the natural ground under its body, and whether the ground is shaped to it
 * (not under a stilt house). */
export interface PieceSeat {
  seat: number;
  low: number;
  high: number;
  shaped: boolean;
  block?: readonly Point[];
  /** Outline of the built terrace it stands on. */
  terrace?: readonly Point[];
}
/** The ground of the streets along the walls of a body: mean and highest. */
interface StreetGround {
  mean: number;
  high: number;
}
/** The floor of a building on a slope is set by cutting into the hill: a plinth's height over its low side, the uphill walls
 * standing in the cut. `eave`: its wall height. The ground of a street along its walls is not cut, so a wall that borders it
 * uphill keeps a door's height over it. */
export function terrainSeat(t: { low: number; high: number; slope: number }, eave: number, street?: StreetGround, cut = true): number {
  const floor = Math.min(t.high, t.low + CITY3D_PLINTH_M);
  if (t.slope > CITY3D_CLIFF_SLOPE) return floor;
  if (!cut) return Math.max(floor, t.high - CITY3D_BURIED_M);
  const level = street ? Math.max(street.mean - Math.max(0.3, eave - CITY3D_STREET_DOOR_M), street.high - Math.max(0.3, eave - STREET_EAVE_M)) : -Infinity;
  return Math.max(floor, Math.min(t.high, t.low + CITY3D_LOWER_STOREY_M, Math.max(level, t.high - Math.max(CITY3D_CUT_M, eave - CITY3D_STREET_DOOR_M))));
}
/** Seat of a raised floor (stilts, posts): over the high side of the ground, at the foot of a cliff. */
const raisedSeat = (t: { low: number; high: number; slope: number }): number => (t.slope > CITY3D_CLIFF_SLOPE ? Math.min(t.high, t.low + CITY3D_LOWER_STOREY_M) : t.high);
/** Pieces closer than this (m) belong to one body. */
const BODY_GAP_M = 0.5;
/** Body index of each piece: pieces standing apart (a barn across the yard from its house) are bodies of their own;
 * pieces whose boxes touch or overlap (wings, nested tiers whose heights share one ground) form one body. `nested`: only
 * pieces standing on or inside another one (tiers, a hall in its court) share a body, wings do not. */
export function pieceBodies(footprint: Surface, nested = false): number[] {
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
      if (nested && !inRing(footprint[i].outer, ringCentre(footprint[j].outer)) && !inRing(footprint[j].outer, ringCentre(footprint[i].outer))) continue;
      const from = Math.max(body[i], body[j]),
        to = Math.min(body[i], body[j]);
      for (let k = 0; k < body.length; k++) if (body[k] === from) body[k] = to;
    }
  // Each body is named by its first piece.
  return body;
}
/** The streets along the walls of a body: the ground at its corners on the edge of their block. */
function streetGround(shapes: Surface, at: City3dHeight, block: readonly Point[] | undefined): StreetGround | undefined {
  if (!block) return undefined;
  let sum = 0,
    count = 0,
    high = -Infinity;
  for (const { outer } of shapes)
    for (const p of outer) {
      if (edgeDistance(block, p.x, p.y) > STREET_REACH_M) continue;
      const h = at(p.x, p.y);
      if (!Number.isFinite(h)) continue;
      sum += h;
      count++;
      high = Math.max(high, h);
    }
  return count ? { mean: sum / count, high } : undefined;
}
/** Distance from a point to the outline of a ring, m. */
export function edgeDistance(ring: readonly Point[], x: number, y: number): number {
  let squared = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      dx = ring[i].x - a.x,
      dy = ring[i].y - a.y,
      l = dx * dx + dy * dy,
      t = l ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l)) : 0;
    squared = Math.min(squared, (a.x + t * dx - x) ** 2 + (a.y + t * dy - y) ** 2);
  }
  return Math.sqrt(squared);
}
/** Seat of a body (`fallback` without a ground). `raised`: a stilt house, over its ground and the water under it (`waterAt`). */
function bodySeat(shapes: Surface, eave: number, fallback: number, ground?: SeatGround, raised = false, waterAt?: City3dHeight): PieceSeat {
  const terrain = ground ? footprintTerrain(shapes, ground.at) : undefined;
  let seat = fallback,
    block: readonly Point[] | undefined;
  if (terrain && raised) seat = raisedSeat(terrain);
  else if (terrain) {
    if (terrain.high - terrain.low > CITY3D_PLINTH_M) {
      const c = ringCentre(shapes[0].outer);
      block = ground!.blockAt?.(c.x, c.y);
    }
    seat = terrainSeat(terrain, eave, streetGround(shapes, ground!.at, block), ground!.cut);
  }
  if (waterAt)
    for (const shape of shapes)
      for (const p of [...shape.outer, ringCentre(shape.outer)]) {
        const water = waterAt(p.x, p.y);
        if (Number.isFinite(water)) seat = Math.max(seat, water);
      }
  return { seat, low: Math.min(seat, terrain?.low ?? seat), high: terrain?.high ?? seat, shaped: !!terrain && ground!.cut && !raised && !waterAt, block };
}
/** Seats of the pieces of a silhouette from its city massing: the pieces of a body share one, unless their ground drops enough
 * for each wing to stand at its own level (the pieces of a roof clipped against each other keep together). `waterAt`: stilt sites. */
export function massingSeats(building: PlacedBuilding, massing: readonly MassingPiece[], ground?: SeatGround, waterAt?: City3dHeight): PieceSeat[] {
  const footprint = building.footprint,
    fallback = Number.isFinite(building.ground_z_m) ? building.ground_z_m : 0,
    stilts = massing.map(m => !!m.volumes?.some(v => (v.stilts_m ?? 0) > 0)),
    water = stilts.includes(true) ? waterAt : undefined,
    eaves = massing.map(m => {
      let eave = Infinity;
      for (const v of m.volumes ?? []) if (!v.minor && !v.base_m && v.eave_m > 0) eave = Math.min(eave, v.eave_m);
      return Number.isFinite(eave) ? eave : m.eave_m;
    });
  const seatOf = (pieces: readonly number[]): PieceSeat => {
    let eave = Infinity;
    for (const i of pieces) eave = Math.min(eave, eaves[i]);
    const shapes = pieces.length === footprint.length ? footprint : pieces.map(i => footprint[i]);
    return bodySeat(
      shapes,
      eave,
      fallback,
      ground,
      pieces.some(i => stilts[i]),
      water,
    );
  };
  const seats: PieceSeat[] = new Array(footprint.length),
    bodies = pieceBodies(footprint);
  let wings: number[] | undefined;
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i] !== i) continue;
    const pieces = bodies.flatMap((b, k) => (b === i ? [k] : [])),
      seat = seatOf(pieces);
    if (pieces.length < 2 || !seat.shaped || seat.high - seat.low <= SPLIT_DROP_M || pieces.some(k => massing[k].volumes?.some(v => v.pans))) {
      for (const k of pieces) seats[k] = seat;
      continue;
    }
    const of = (wings ??= pieceBodies(footprint, true));
    for (const k of pieces) seats[k] = of[k] < k ? seats[of[k]] : seatOf(pieces.filter(j => of[j] === k));
  }
  return seats.map((seat, i) => (massing[i].footing?.terrace && seat.shaped ? { ...seat, terrace: pieceTerrace(massing[i])?.ring } : seat));
}
/** Seat of a whole building standing at one level (a silhouette without massing, a native plan). */
export const wholeSeat = (building: PlacedBuilding, eave: number, ground?: SeatGround): PieceSeat => bodySeat(building.footprint, eave, Number.isFinite(building.ground_z_m) ? building.ground_z_m : 0, ground);
/** Wall height of a native plan over its ground: its lowest main volume. */
export function planEave(building: PlacedBuilding): number {
  let eave = Infinity;
  for (const v of building.volumes) if (v.role !== 'minor' && v.wall_height_m > 0) eave = Math.min(eave, v.z_m + v.wall_height_m - building.ground_z_m);
  return Number.isFinite(eave) && eave > 0 ? eave : 3;
}
/** Highest retaining wall of a built terrace, m: one standing higher is no terrace but a slope filler. */
const TERRACE_WALL_M = 1.4;
/** Level terrace under a piece (massing `footing.terrace`): a slab at the floor over its outline, its retaining wall
 * `wall_m` below the floor on the downhill edge, or down to the displayed ground wherever that lies lower (the shown
 * relief may differ from the generator's), sunk like a footing. None where its wall would stand too
 * high, or where the ground shaped to the floor (`shaped`) still rises through it. */
export function terraceFooting(terrace: { ring: Point[]; wall_m: number }, seat: number, heightAt?: City3dHeight, shaped = false): ArchitectureVolume['foundation'] | undefined {
  const footprint = [{ outer: terrace.ring, holes: [] }],
    terrain = heightAt ? footprintTerrain(footprint, heightAt) : undefined,
    ground = terrain?.low;
  if (terrain && (seat - terrain.low > TERRACE_WALL_M || (shaped && terrain.high > seat))) return undefined;
  return { footprint, z_min_m: Math.min(seat - terrace.wall_m, ground ?? Infinity) - CITY3D_FOOTING_DEPTH_M, z_max_m: seat };
}
/** A native plan (compact or detailed, houses crate) seated on the displayed terrain like the city volumes: the whole
 * plan moves to the `terrainSeat` of its footprint on the natural ground (`ground`), and each footing standing on the ground reaches below the lowest ground
 * sample. A closed plan without any footing gets a plinth under its footprint where the ground drops under it: nothing
 * floats. The plan itself is returned when nothing moves. */
export function seatPlan(building: PlacedBuilding, heightAt?: City3dHeight, ground: SeatGround | undefined = heightAt && { at: heightAt, cut: true }): PlacedBuilding {
  const drawn = heightAt && Number.isFinite(building.ground_z_m) ? footprintTerrain(building.footprint, heightAt) : undefined;
  if (!drawn || !ground) return building;
  const { seat, low, high } = wholeSeat(building, planEave(building), ground),
    terrain = { low: Math.min(low, drawn.low), high },
    dz = seat - building.ground_z_m,
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
    ...shapedTo(ground, heightAt),
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
