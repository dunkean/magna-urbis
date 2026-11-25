import { fungalDwelling } from './craftedFungalDwelling';
import type { ArchitectureVolume } from '../../../rust/bridge/urbanArchitecture';
import type { Vertex3 } from '../../../rust/bridge/housesContract';
import { RoofBuilder } from './city3d/roofGeometry';
import { craftedElvenTree } from './craftedElvenTree';
import type { OverviewVolume } from './urbanBuildingGeometry';

type Mesh = ArchitectureVolume['roof_mesh'];
const BATTEN = 'city3d:detail:sapling@816747';
const SHADE = 'city3d:detail:sapling@65513d';
const cache = new WeakMap<ArchitectureVolume, Mesh>();

/** Intersect a vertical line with the actual, faceted upper covering. The source pans used
 * here are convex. Sampling their planes keeps small details seated on sloped facets. */
function heightField(mesh: Mesh, faces: Mesh['faces']): (x: number, y: number) => number | undefined {
  const tris = faces
    .flatMap(f => {
      const [a, ...rest] = f.vertices.map(i => mesh.vertices[i]);
      return rest.slice(1).map((c, i) => {
        const b = rest[i],
          ux = b.x - a.x,
          uy = b.y - a.y,
          vx = c.x - a.x,
          vy = c.y - a.y;
        return { a, ux, uy, vx, vy, uz: b.z - a.z, vz: c.z - a.z, det: ux * vy - uy * vx };
      });
    })
    .filter(t => Math.abs(t.det) > 1e-8);
  return (x, y) => {
    for (const t of tris) {
      const dx = x - t.a.x,
        dy = y - t.a.y;
      const u = (dx * t.vy - dy * t.vx) / t.det,
        v = (dy * t.ux - dx * t.uy) / t.det;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) return t.a.z + u * t.uz + v * t.vz;
    }
  };
}

function decoratedMesh(mesh: Mesh, keep: Mesh['faces'], addition: RoofBuilder): Mesh {
  const start = mesh.vertices.length;
  return { ...mesh, vertices: [...mesh.vertices, ...addition.vertices], faces: [...keep, ...addition.faces.map(f => ({ ...f, vertices: f.vertices.map(i => i + start) }))] };
}

/** Clip a planar convex pan in its own 3D plane. */
function clip(poly: Vertex3[], distance: (p: Vertex3) => number): Vertex3[] {
  const result: Vertex3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = distance(a),
      db = distance(b);
    if (da >= 0) result.push(a);
    if (da * db < 0) {
      const t = da / (da - db);
      result.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) });
    }
  }
  return result;
}

function longhouse(volume: ArchitectureVolume): Mesh {
  const mesh = volume.roof_mesh,
    ring = volume.footprint[0]?.outer;
  if (ring?.length !== 4 || volume.footprint.length !== 1 || volume.footprint[0].holes.length) return mesh;
  const edges = ring.map((p, i) => {
    const q = ring[(i + 1) % 4];
    return { dx: q.x - p.x, dy: q.y - p.y, l: Math.hypot(q.x - p.x, q.y - p.y) };
  });
  const axis = edges.reduce((a, b) => (b.l > a.l ? b : a)),
    ux = axis.dx / axis.l,
    uy = axis.dy / axis.l;
  const cx = ring.reduce((sum, p) => sum + p.x, 0) / 4,
    cy = ring.reduce((sum, p) => sum + p.y, 0) / 4;
  const along = (p: { x: number; y: number }): number => (p.x - cx) * ux + (p.y - cy) * uy;
  const across = (p: { x: number; y: number }): number => -(p.x - cx) * uy + (p.y - cy) * ux;
  const half = Math.max(...ring.map(p => Math.abs(along(p)))),
    width = Math.max(...ring.map(p => Math.abs(across(p))));
  if (half < width * 2 || width < 0.8) return mesh;
  const pans = mesh.faces.filter(f => f.material === volume.materials.cladding && f.normal[2] > 0.1);
  if (!pans.length) return mesh;
  const zAt = heightField(mesh, pans),
    out = new RoofBuilder(),
    keep = mesh.faces.filter(f => !pans.includes(f));
  const onRoof = (s: number, t: number, lift: number): Vertex3 => {
    const x = cx + ux * s - uy * t,
      y = cy + uy * s + ux * t;
    return { x, y, z: (zAt(x, y) ?? volume.z_m + volume.wall_height_m) + lift };
  };
  const hearths = Math.max(1, Math.min(5, Math.round((2 * half) / 8))),
    vents = Array.from({ length: hearths }, (_, i) => (((i + 0.5) / hearths) * 2 - 1) * half);
  const length = Math.min(0.7, half / 6),
    throat = Math.min(0.34, width * 0.17);
  for (const pan of pans) {
    let pieces = [pan.vertices.map(i => mesh.vertices[i])];
    for (const v of vents) {
      const next: Vertex3[][] = [];
      for (const piece of pieces) {
        if (piece.every(p => along(p) <= v - length) || piece.every(p => along(p) >= v + length) || piece.every(p => across(p) <= -throat) || piece.every(p => across(p) >= throat)) {
          next.push(piece);
          continue;
        }
        const middle = clip(
          clip(piece, p => along(p) - v + length),
          p => v + length - along(p),
        );
        next.push(
          clip(piece, p => v - length - along(p)),
          clip(piece, p => along(p) - v - length),
          clip(middle, p => -throat - across(p)),
          clip(middle, p => across(p) - throat),
        );
      }
      pieces = next.filter(p => p.length > 2);
    }
    for (const p of pieces) out.face(p, pan.material);
  }
  // A strip of bark propped over one edge of each real hearth opening sheds rain. A dark
  // reveal gives the opening depth without closing the smoke path through the roof.
  for (const v of vents) {
    const corners = [onRoof(v - length, -throat, 0), onRoof(v + length, -throat, 0), onRoof(v + length, throat, 0), onRoof(v - length, throat, 0)];
    for (let k = 0; k < 4; k++) {
      const a = corners[k],
        b = corners[(k + 1) % 4];
      out.face([a, b, { ...b, z: b.z - 0.16 }, { ...a, z: a.z - 0.16 }], SHADE);
    }
    out.face([onRoof(v - length - 0.08, throat + 0.17, 0.04), onRoof(v + length + 0.08, throat + 0.17, 0.04), onRoof(v + length + 0.08, -0.06, 0.29), onRoof(v - length - 0.08, -0.06, 0.29)], volume.materials.cladding);
  }
  // Bent saplings secure the sheets. Follow the native barrel's quarter-width facet joints.
  const spans = Math.max(2, Math.min(10, Math.round((2 * half) / 4)));
  const batten = 0.042;
  for (let i = 0; i <= spans; i++) {
    const s = ((i / spans) * 2 - 1) * (half - 0.27);
    if (vents.some(v => Math.abs(v - s) < length + 0.18)) continue;
    for (let j = -4; j < 4; j++) {
      const t = (width * 0.995 * j) / 4,
        u = (width * 0.995 * (j + 1)) / 4;
      out.face([onRoof(s - batten, t, 0.03), onRoof(s - batten, u, 0.03), onRoof(s, u, 0.085), onRoof(s, t, 0.085)], SHADE);
      out.face([onRoof(s, t, 0.085), onRoof(s, u, 0.085), onRoof(s + batten, u, 0.03), onRoof(s + batten, t, 0.03)], BATTEN);
    }
  }
  return decoratedMesh(mesh, keep, out);
}

/** Authored near-view roof, retaining the actual shell, native door meshes and material slots.
 * Other cultures and standard display modes keep the original roof mesh. */
export function craftedRoofMesh(volume: OverviewVolume, culture: string): Mesh {
  const raw = volume.materials.cladding;
  const isCap = culture === 'myconid-colony' && (raw.startsWith('city3d:cover:fungal') || volume.displayRoofForm === 'dome');
  const isLonghouse = culture === 'native-iroquoian' && raw.startsWith('city3d:cover:bark');
  const tree = culture === 'elven' ? volume.displayTree : undefined;
  if ((!isCap && !isLonghouse && !tree) || !volume.roof_mesh) return volume.roof_mesh;
  let mesh = cache.get(volume);
  if (!mesh) {
    mesh = tree ? craftedElvenTree(tree, volume.z_m) : isCap ? fungalDwelling(volume) : longhouse(volume);
    cache.set(volume, mesh);
  }
  return mesh;
}
