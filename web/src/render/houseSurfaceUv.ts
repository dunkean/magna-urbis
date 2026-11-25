import type { MaterialSlots, Point, Surface } from '../../../rust/bridge/housesContract';
import { isBuildingProjection, type Building3dVisual, type BuildingTriangle, type BuildingVector, type OverviewVolume } from './urbanBuildingGeometry';

/** A mapping belongs to the volume, not its individual triangles or the block that currently draws it.
 * Coordinates are physical metres. The sampler repeats each painted three-metre swatch. */
const TILE = 3;
const TURN = Math.PI * 2;
type Uv = [number, number];
type Project = ((p: BuildingVector) => Uv) & { underEave?: boolean };

function volumeFrame(surface: Surface, eave: number, rise: number, overhang = 0, form?: OverviewVolume['displayRoofForm']) {
  const ring = surface[0]?.outer ?? [];
  let cx = 0,
    cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length || 1;
  cy /= ring.length || 1;
  let perimeter = 0,
    longest = 0,
    ax = 1,
    ay = 0;
  let rmin = Infinity,
    rmax = 0;
  const edges = [];
  for (const [i, p] of ring.entries()) {
    const q = ring[(i + 1) % ring.length],
      x = q.x - p.x,
      y = q.y - p.y;
    const length = Math.hypot(x, y),
      radius = Math.hypot(p.x - cx, p.y - cy);
    rmin = Math.min(rmin, radius);
    rmax = Math.max(rmax, radius);
    if (length < 0.001) continue;
    edges.push({ x: p.x, y: p.y, dx: x / length, dy: y / length, length, start: perimeter });
    perimeter += length;
    if (length > longest) {
      longest = length;
      ax = x / length;
      ay = y / length;
    }
  }
  const halfWidth = ring.reduce((m, p) => Math.max(m, Math.abs((p.x - cx) * ay - (p.y - cy) * ax)), 0.01);
  const loop = Math.max(TILE, Math.round(perimeter / TILE) * TILE);
  return { cx, cy, ax, ay, halfWidth, edges, eave, rise, overhang, form, radius: rmax, round: ring.length >= 7 && rmin > 0.75 * rmax, loop, stretch: perimeter ? loop / perimeter : 1 };
}
type Frame = ReturnType<typeof volumeFrame>;

/** Select the matching footprint edge once for the entire triangle (also works for battered walls). */
function wallProjection(f: Frame, normal: BuildingVector, middle: Point): Project {
  if (f.round) {
    const centreAngle = Math.atan2(middle.y - f.cy, middle.x - f.cx);
    return p => {
      const angle = Math.atan2(p[1] - f.cy, p[0] - f.cx);
      // Unwrap just this triangle across the 2π cut. The full loop is an integer number of swatches.
      return [(angle / TURN + Math.round((centreAngle - angle) / TURN)) * f.loop, f.eave - p[2]];
    };
  }
  let best: Frame['edges'][number] | undefined,
    nearest = Infinity;
  const h = Math.hypot(normal[0], normal[1]) || 1;
  for (const e of f.edges) {
    if (Math.abs(e.dx * normal[1] - e.dy * normal[0]) < 0.91 * h) continue;
    const x = middle.x - e.x,
      y = middle.y - e.y;
    const t = Math.min(e.length, Math.max(0, x * e.dx + y * e.dy));
    const d = (x - t * e.dx) ** 2 + (y - t * e.dy) ** 2;
    if (d < nearest) {
      best = e;
      nearest = d;
    }
  }
  if (best) {
    const e = best;
    return p => [(e.start + (p[0] - e.x) * e.dx + (p[1] - e.y) * e.dy) * f.stretch, f.eave - p[2]];
  }
  return p => [(-(p[0] - f.cx) * normal[1] + (p[1] - f.cy) * normal[0]) / h, f.eave - p[2]];
}

/** One volume frame per slot set, prepared only for the detailed-material option. */
export function houseSurfaceMapper(building: Building3dVisual): (face: BuildingTriangle, material: string, aperture: boolean) => Project {
  const frames = new Map<MaterialSlots, Frame>();
  const fallback = volumeFrame(building.footprint, building.ground_z_m, 0);
  if (!isBuildingProjection(building)) {
    for (const v of building.volumes as OverviewVolume[]) {
      const f = volumeFrame(v.footprint, v.z_m + v.wall_height_m, v.roof_height_m, v.overhang_m, v.displayRoofForm);
      frames.set(v.materials, f);
      for (const level of v.levels) if (level.materials) frames.set(level.materials, f);
    }
  }
  return (face, material, aperture) => {
    const f = frames.get(face.materials) ?? fallback;
    const [nx, ny, nz] = face.normal,
      h = Math.hypot(nx, ny);
    if (aperture && h > 0.01) {
      // Start the joinery at the opening's own jamb and lintel. Both triangles of each facade quad contain them.
      const u = (p: BuildingVector) => (-(p[0] - f.cx) * ny + (p[1] - f.cy) * nx) / h;
      const jamb = Math.min(...face.points.map(u)),
        lintel = Math.max(...face.points.map(p => p[2]));
      return p => [u(p) - jamb, lintel - p[2]];
    }
    const organic = material.startsWith('city3d:tree:crown') || material.startsWith('city3d:cover:fungal');
    const cover = material.startsWith('city3d:cover:') || material === face.materials.cladding;
    if (!organic && ((!cover && Math.abs(nz) < 0.85) || (Math.abs(nz) < 0.09 && f.form !== 'barrel'))) {
      const [a, b, c] = face.points;
      const project = wallProjection(f, face.normal, { x: (a[0] + b[0] + c[0]) / 3, y: (a[1] + b[1] + c[1]) / 3 });
      const gableEnd = f.form === 'gable' && Math.abs(nx * f.ax + ny * f.ay) > 0.7;
      project.underEave = face.surface === 'wall' && !gableEnd && f.overhang > 0.09 && !face.material;
      return project;
    }
    if (cover && f.form === 'barrel' && f.rise > 0.01) {
      // Unroll the continuous arch through the crown. No change of texture origin as the curved skin turns.
      return p => {
        const x = p[0] - f.cx,
          y = p[1] - f.cy;
        const angle = Math.atan2((-x * f.ay + y * f.ax) / f.halfWidth, Math.max(0, p[2] - f.eave) / f.rise);
        return [x * f.ax + y * f.ay, angle * (f.halfWidth + f.rise) * 0.5];
      };
    }
    if (organic || f.round || f.form === 'dome' || f.form === 'tent' || f.form === 'cone' || h < 0.02) {
      // A single sheet over the crown, with no angular singularity at the pole.
      const stretch = f.radius > 0.01 ? Math.min(1.45, Math.hypot(f.radius, f.rise) / f.radius) : 1;
      return p => {
        const x = p[0] - f.cx,
          y = p[1] - f.cy;
        return [(x * f.ax + y * f.ay) * stretch, (-x * f.ay + y * f.ax) * stretch];
      };
    }
    // Actual roof pans have directional courses along their ridge, with an architectural datum at the eaves.
    const dx = nx / h,
      dy = ny / h;
    return p => {
      const x = p[0] - f.cx,
        y = p[1] - f.cy;
      return [-x * dy + y * dx, (x * dx + y * dy) * nz - (p[2] - f.eave) * h];
    };
  };
}
