import type { Point, Polygon, Surface } from '../../../../rust/bridge/housesContract';
import type { Building3dScene, Building3dVisual } from '../urbanBuildingGeometry';
import { ringContains } from '../ringRows';
import { WALK_EYE_HEIGHT } from './camera';
import type { WorldRelief } from './contract';

export const WALK_RADIUS = 0.3;
const CELL = 32,
  SKIN = 1e-5;
const flatHeight = (): number => 0;
interface Entry {
  shape: Polygon;
  rings: Point[][];
  ground: number;
  low: number;
  high: number;
  scaled: boolean;
  cells: Entry[][];
  seen: number;
}
interface Hit {
  t: number;
  nx: number;
  ny: number;
}
function inside(shape: Polygon, x: number, y: number): boolean {
  if (!ringContains(shape.outer, x, y)) return false;
  for (let i = 0; i < shape.holes.length; i++) if (ringContains(shape.holes[i], x, y)) return false;
  return true;
}

function accept(hit: Hit, dx: number, dy: number, t: number, nx: number, ny: number): void {
  if (t >= -1e-9 && t <= 1 && dx * nx + dy * ny < -1e-9 && t < hit.t) {
    hit.t = Math.max(0, t);
    hit.nx = nx;
    hit.ny = ny;
  }
}
/** Earliest contact with a segment's capsule, including its round ends. Continuous
 * sweeps prevent even fast wheel/touch steps from crossing a thin palisade. */
function sweep(x: number, y: number, dx: number, dy: number, a: Point, b: Point, hit: Hit): void {
  hit.t = Infinity;
  const ex = b.x - a.x,
    ey = b.y - a.y,
    length = Math.hypot(ex, ey);
  if (length > 1e-9) {
    const nx = -ey / length,
      ny = ex / length,
      d = (x - a.x) * nx + (y - a.y) * ny,
      v = dx * nx + dy * ny;
    if (Math.abs(v) > 1e-12)
      for (let sign = -1; sign <= 1; sign += 2) {
        const t = (sign * WALK_RADIUS - d) / v;
        const along = ((x + dx * t - a.x) * ex + (y + dy * t - a.y) * ey) / length;
        if (along >= 0 && along <= length) accept(hit, dx, dy, t, nx * sign, ny * sign);
      }
  }
  const speed2 = dx * dx + dy * dy;
  if (speed2 > 1e-16)
    for (let end = 0; end < 2; end++) {
      const p = end ? b : a;
      const px = x - p.x,
        py = y - p.y,
        dot = px * dx + py * dy;
      const disc = dot * dot - speed2 * (px * px + py * py - WALK_RADIUS ** 2);
      if (disc < 0) continue;
      const t = (-dot - Math.sqrt(disc)) / speed2;
      accept(hit, dx, dy, t, (px + dx * t) / WALK_RADIUS, (py + dy * t) / WALK_RADIUS);
    }
}

/** Shared by both cameras and the WebGL/WebGPU views. Index visible geometry,
 * never parcel bounds or roof overhangs; retain courtyards and gate passages.
 * Optional terrain selects the single camera's worldSeat height rules. */
export class Terrain3dCollisions {
  private cells = new Map<number, Map<number, Entry[]>>();
  private buildings = new Map<string, Entry[]>();
  /** Capacity is reserved on insertion; movement reuses this list and contact. */
  private candidates: (Entry | undefined)[] = [];
  private candidateCount = 0;
  private entryCount = 0;
  private serial = 0;
  private readonly contact: Hit = { t: Infinity, nx: 0, ny: 0 };

  constructor(
    scene?: Building3dScene,
    private readonly terrain?: WorldRelief,
    private readonly terrainExaggeration = 1,
  ) {
    for (const building of scene?.buildings ?? []) this.replace(building);
  }

  replace(building: Building3dVisual): void {
    this.clearCandidates();
    const previous = this.buildings.get(building.id);
    for (const entry of previous ?? []) for (const cell of entry.cells) cell.splice(cell.indexOf(entry), 1);
    this.entryCount -= previous?.length ?? 0;
    const entries: Entry[] = [];
    this.buildings.set(building.id, entries);
    const insert = (footprint: Surface, low: number, high: number, scaled = false): void => {
      if (!Number.isFinite(low) || !Number.isFinite(high) || high - low < 0.01) return;
      for (const shape of footprint) {
        if (shape.outer.length < 3) continue;
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
        if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
        const rings = [shape.outer, ...shape.holes];
        // ringContains lazily buckets long rings: prepare that cache with the index.
        for (const ring of rings) ringContains(ring, x0, y0);
        const entry: Entry = { shape, rings, ground: building.ground_z_m, low, high, scaled, cells: [], seen: 0 };
        entries.push(entry);
        if (++this.entryCount > this.candidates.length) this.candidates.push(undefined);
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          let row = this.cells.get(cy);
          if (!row) this.cells.set(cy, (row = new Map()));
          for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
            let cell = row.get(cx);
            if (!cell) row.set(cx, (cell = []));
            entry.cells.push(cell);
            cell.push(entry);
          }
        }
      }
    };
    if (building.walkSolids) {
      for (const solid of building.walkSolids) insert(solid.footprint, solid.z_min_m, solid.z_max_m, true);
    } else if (building.recipe_id.startsWith('city3d-') || 'yard' in building) {
      // Quays, bridges and boardwalk decks are walkable ground, not solid lots.
      return;
    } else if ('projection' in building) {
      insert(building.footprint, building.ground_z_m, building.ground_z_m + building.height_m);
    } else {
      for (const volume of building.volumes) {
        if (volume.envelope !== 'open') for (const level of volume.levels) insert(level.footprint, level.z_m, level.z_m + level.height_m);
        const f = volume.foundation;
        if (f) insert(f.footprint, f.z_min_m, f.z_max_m);
      }
      for (const f of building.structural_foundations ?? []) insert(f.footprint, f.z_min_m, f.z_max_m);
    }
  }

  private clearCandidates(): void {
    for (let i = 0; i < this.candidateCount; i++) this.candidates[i] = undefined;
    this.candidateCount = 0;
  }

  private nearby(x: number, y: number, dx = 0, dy = 0): number {
    this.clearCandidates();
    const serial = ++this.serial;
    let count = 0;
    for (let cy = Math.floor((Math.min(y, y + dy) - WALK_RADIUS) / CELL); cy <= Math.floor((Math.max(y, y + dy) + WALK_RADIUS) / CELL); cy++) {
      const row = this.cells.get(cy);
      if (!row) continue;
      for (let cx = Math.floor((Math.min(x, x + dx) - WALK_RADIUS) / CELL); cx <= Math.floor((Math.max(x, x + dx) + WALK_RADIUS) / CELL); cx++) {
        const cell = row.get(cx);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const entry = cell[i];
          if (entry.seen !== serial) {
            entry.seen = serial;
            this.candidates[count++] = entry;
          }
        }
      }
    }
    this.candidateCount = count;
    return count;
  }

  /** Native storeys keep physical height. Old-view fortifications scale whole;
   * world-view fortifications retain their height above the local terrain. */
  private overlaps(entry: Entry, feet: number, exaggeration: number): boolean {
    let low: number, high: number;
    if (this.terrain && entry.scaled) {
      const lift = feet * (1 - (exaggeration > 0 ? 1 / exaggeration : 1));
      low = entry.low + lift;
      high = entry.high + lift;
    } else if (entry.scaled) {
      low = entry.low * exaggeration;
      high = entry.high * exaggeration;
    } else {
      low = entry.ground * exaggeration + (entry.low - entry.ground) * (this.terrain && entry.low < entry.ground ? exaggeration : 1);
      high = entry.ground * exaggeration + (entry.high - entry.ground) * (this.terrain && entry.high < entry.ground ? exaggeration : 1);
    }
    return low < feet + WALK_EYE_HEIGHT && high > feet + 0.1;
  }

  private feetAt(x: number, y: number, heightAt: (x: number, y: number) => number, exaggeration: number): number {
    return this.terrain ? this.terrain.heightAt(x, y) : heightAt(x, y) * exaggeration;
  }

  /** Callers in animation loops supply `out`; all query/contact scratch is retained. */
  move(x: number, y: number, dx: number, dy: number, heightAt: (x: number, y: number) => number = flatHeight, exaggeration = 1, out: [number, number] = [0, 0]): [number, number] {
    if (this.terrain) exaggeration = this.terrainExaggeration;
    // Orbit/fly can place the initial eye inside a building. Move it to the
    // closest free edge rather than leaving the walker trapped behind walls.
    for (let pass = 0; pass < 12; pass++) {
      let corrected = false;
      const count = this.nearby(x, y);
      for (let e = 0; e < count; e++) {
        const entry = this.candidates[e]!;
        if (!this.overlaps(entry, this.feetAt(x, y, heightAt, exaggeration), exaggeration)) continue;
        const contained = inside(entry.shape, x, y);
        let best = Infinity,
          qx = x,
          qy = y,
          ax = 0,
          ay = 0;
        for (let r = 0; r < entry.rings.length; r++) {
          const ring = entry.rings[r];
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[j],
              b = ring[i];
            const ex = b.x - a.x,
              ey = b.y - a.y,
              length2 = ex * ex + ey * ey;
            if (length2 < 1e-16) continue;
            const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / length2));
            const px = a.x + t * ex,
              py = a.y + t * ey,
              distance = Math.hypot(x - px, y - py);
            if (distance < best) {
              best = distance;
              qx = px;
              qy = py;
              ax = -ey;
              ay = ex;
            }
          }
        }
        if ((!contained && best >= WALK_RADIUS - SKIN) || !Number.isFinite(best)) continue;
        let nx = best > 1e-9 ? (x - qx) / best : ax / Math.hypot(ax, ay);
        let ny = best > 1e-9 ? (y - qy) / best : ay / Math.hypot(ax, ay);
        if ((contained && best > 1e-9) || (best <= 1e-9 && inside(entry.shape, qx + nx * SKIN, qy + ny * SKIN))) {
          nx = -nx;
          ny = -ny;
        }
        x = qx + nx * (WALK_RADIUS + SKIN);
        y = qy + ny * (WALK_RADIUS + SKIN);
        corrected = true;
        break;
      }
      if (!corrected) break;
    }
    // Successive contacts remove only motion into a wall, retaining its tangent.
    for (let pass = 0; pass < 6 && Math.hypot(dx, dy) > 1e-8; pass++) {
      let t = Infinity,
        nx = 0,
        ny = 0;
      const count = this.nearby(x, y, dx, dy),
        contact = this.contact;
      for (let e = 0; e < count; e++) {
        const entry = this.candidates[e]!;
        for (let r = 0; r < entry.rings.length; r++) {
          const ring = entry.rings[r];
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            sweep(x, y, dx, dy, ring[j], ring[i], contact);
            if (contact.t >= t) continue;
            const feet = this.feetAt(x + dx * contact.t, y + dy * contact.t, heightAt, exaggeration);
            if (this.overlaps(entry, feet, exaggeration)) {
              t = contact.t;
              nx = contact.nx;
              ny = contact.ny;
            }
          }
        }
      }
      if (t === Infinity) {
        x += dx;
        y += dy;
        break;
      }
      x += dx * t + nx * SKIN;
      y += dy * t + ny * SKIN;
      dx *= 1 - t;
      dy *= 1 - t;
      const into = Math.min(0, dx * nx + dy * ny);
      dx -= into * nx;
      dy -= into * ny;
    }
    out[0] = x;
    out[1] = y;
    return out;
  }
}
