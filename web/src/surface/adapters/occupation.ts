import type { Surface } from '../../../../rust/bridge/housesContract';
import type { Building3dScene } from '../../render/urbanBuildingGeometry';
import type { World } from '../../gen/types';
import { buildingOccupationSurfaces } from '../../ui/urbanBuildingProjection';
import { Occupation, type OccupationInput, type TerrainGrid } from '../model';
import { fingerprint } from '../compiler';

export interface SurfaceRoad { id?: string; sourceIndex?: number; points: readonly (readonly [number, number])[]; widthM: number; surface?: string; class?: string; profile?: string; a?: number; b?: number }
const contains = (surface: Surface, x: number, y: number): boolean => surface.some(shape => {
  let inside = false;
  for (const ring of [shape.outer, ...shape.holes]) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
});
function segmentTouchesBox(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let near = 0, far = 1;
  for (const [a, delta, low, high] of [[ax, bx - ax, x0, x1], [ay, by - ay, y0, y1]]) {
    if (Math.abs(delta) < 1e-12) { if (a < low || a > high) return false; continue; }
    const t0 = (low - a) / delta, t1 = (high - a) / delta;
    near = Math.max(near, Math.min(t0, t1)); far = Math.min(far, Math.max(t0, t1));
    if (near > far) return false;
  }
  return true;
}

/** Conservative cell coverage prevents thin walls/roads falling between DEM
 * samples. Courtyard cells wholly inside a hole remain natural. Explicit accepted
 * occupancy records override visual overlays, including an explicitly empty set. */
export function occupationFromMagnaScene(terrain: TerrainGrid, scene?: Building3dScene,
  roads: readonly SurfaceRoad[] = [], base?: OccupationInput): OccupationInput {
  const surfaces = (scene?.occupationBuildings ?? scene?.buildings ?? []).flatMap(building => [...buildingOccupationSurfaces(building)]);
  return occupationFromMagnaSurfaces(terrain, surfaces, roads, base);
}

/** Two-dimensional source masses remain occupation geometry, never fabricated
 * native building records. Only layers already generated in World are read. */
export function occupationFromMagnaWorld(terrain: TerrainGrid, world: World, base?: OccupationInput): OccupationInput {
  const urban = [world.urban, ...(world.settlements ?? []).filter(s => !s.main).map(s => s.urban), ...Object.values(world.megaDetail ?? {})];
  const surfaces: Surface[] = urban.filter(u => !!u).map(u => u!.masses);
  const roads = (world.roads ?? []).map(road => ({ points: road.path.map(p => [p.x, p.y] as [number, number]), widthM: road.width }));
  for (const layer of urban) for (const street of layer?.streets ?? []) roads.push({ points: street.path.map(p => [p.x, p.y] as [number, number]), widthM: street.width });
  return occupationFromMagnaSurfaces(terrain, surfaces, roads, base);
}

export function occupationFromMagnaSurfaces(terrain: TerrainGrid, surfaces: readonly Surface[],
  roads: readonly SurfaceRoad[] = [], base?: OccupationInput): OccupationInput {
  const n = terrain.width * terrain.height;
  if (base && (base.classes.length !== n || base.orientationRadians && base.orientationRadians.length !== n)) throw new Error('Occupation base must match terrain grid.');
  const classes = base?.classes.slice() ?? new Uint8Array(n), orientationRadians = base?.orientationRadians?.slice() ?? new Float32Array(n);
  const half = terrain.spacingM / 2;
  const visitBox = (x0: number, y0: number, x1: number, y1: number, visit: (index: number, x: number, y: number) => void) => {
    const a = Math.max(0, Math.ceil((x0 - half - terrain.originX) / terrain.spacingM));
    const b = Math.min(terrain.width - 1, Math.floor((x1 + half - terrain.originX) / terrain.spacingM));
    const c = Math.max(0, Math.ceil((y0 - half - terrain.originZ) / terrain.spacingM));
    const d = Math.min(terrain.height - 1, Math.floor((y1 + half - terrain.originZ) / terrain.spacingM));
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) visit(j * terrain.width + i, terrain.originX + i * terrain.spacingM, terrain.originZ + j * terrain.spacingM);
  };
  for (const road of roads) {
    if (!(road.widthM > 0) || !Number.isFinite(road.widthM)) throw new Error('Road width must be finite and positive.');
    if (road.points.some(p => !p.every(Number.isFinite))) throw new Error('Road coordinates must be finite.');
    for (let i = 1; i < road.points.length; i++) {
      const [ax, ay] = road.points[i - 1], [bx, by] = road.points[i], dx = bx - ax, dy = by - ay, den = dx * dx + dy * dy;
      const radius = road.widthM / 2;
      visitBox(Math.min(ax, bx) - radius, Math.min(ay, by) - radius, Math.max(ax, bx) + radius, Math.max(ay, by) + radius, (index, x, y) => {
        const t = den ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / den)) : 0;
        if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= radius + half * Math.SQRT2) {
          classes[index] = Occupation.Road; orientationRadians[index] = Math.atan2(dy, dx);
        }
      });
    }
  }
  for (const surface of surfaces) {
    const points = surface.flatMap(shape => shape.outer);
    if (!points.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    visitBox(x0, y0, x1, y1, (index, x, y) => {
      const corners = [[x - half, y - half], [x + half, y - half], [x - half, y + half], [x + half, y + half]];
      let touched = contains(surface, x, y) || corners.some(([a, b]) => contains(surface, a, b));
      if (!touched) for (const shape of surface) for (const ring of [shape.outer, ...shape.holes]) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (segmentTouchesBox(a.x, a.y, b.x, b.y, x - half, y - half, x + half, y + half)) touched = true;
      }
      if (touched) classes[index] = Occupation.Built;
    });
  }
  return { version: `magna-occupation:${fingerprint([terrain.originX, terrain.originZ, terrain.width, terrain.height, terrain.spacingM, classes, orientationRadians])}`,
    classes, orientationRadians };
}
