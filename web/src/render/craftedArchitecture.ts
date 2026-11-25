import type { Point, Vertex3 } from '../../../rust/bridge/housesContract';
import type { BuildingTriangle, BuildingVector, OverviewVolume } from './urbanBuildingGeometry';
import { LIT_WINDOW, OPENING } from './city3d/materials';
import { craftedCrown } from './craftedCrown';
import { craftedRoofFitting } from './craftedRoofFitting';
import { craftedTidal } from './craftedTidal';
import { hash } from './city3d/massing';

type Quad = (a: BuildingVector, b: BuildingVector, c: BuildingVector, d: BuildingVector, material: string) => void;
const finish = (name: string, hex: string) => 'city3d:detail:' + name + '@' + hex;

/** Frames follow the four corners of the existing opening, including the lean on a battered wall. */
function joinery(points: Vertex3[], outward: number, culture: string, volume: OverviewVolume, quad: Quad, entry = false, hoodRoom = 0): void {
  const [a, b, c, d] = points,
    w = Math.hypot(b.x - a.x, b.y - a.y),
    h = d.z - a.z;
  if (w < 0.22 || h < 0.3 || Math.abs(a.z - b.z) > 0.02 || Math.abs(c.z - d.z) > 0.02) return;
  const nx = (outward * (b.y - a.y)) / w,
    ny = (-outward * (b.x - a.x)) / w;
  const at = (u: number, v: number, depth: number): BuildingVector => {
    const t = v / h,
      s = u / w;
    return [a.x + s * (b.x - a.x) + t * (d.x - a.x + s * (c.x - d.x - b.x + a.x)) + depth * nx, a.y + s * (b.y - a.y) + t * (d.y - a.y + s * (c.y - d.y - b.y + a.y)) + depth * ny, a.z + v];
  };
  const door = entry || Math.abs(a.z - volume.z_m) < 0.18,
    tibetan = culture.includes('tibetan'),
    lattice = /chinese|japan|korea|newar|bhutan/.test(culture),
    industrial = /cyber|future|solarpunk|orbital|industrial|arcolog|diesel|space-/.test(culture),
    stone = /stone|ashlar|adobe|earth|brick/.test(volume.materials.coating),
    lagoon = culture === 'venetian-lagoon',
    jamb = finish('jamb', hoodRoom ? (lagoon ? 'ded4be' : 'bea889') : industrial ? '536267' : tibetan ? '57453c' : lattice ? '73513f' : stone ? '978570' : '776048'),
    head = finish('lintel', hoodRoom ? (lagoon ? 'e4dcca' : 'c8b69a') : tibetan ? '955641' : industrial ? '728286' : stone ? 'ad987d' : '826b51'),
    pane = finish('sash', industrial ? '58686b' : '705b48');
  const trim = Math.min(w * 0.12, tibetan ? 0.15 : 0.095 * Math.max(1, Math.min(2.5, w))),
    sillZ = door ? 0 : -trim * 0.9;
  // Splayed inner cheeks meet the glass; the lip catches light on its upper edge.
  quad(at(-trim, sillZ, 0.065), at(0, 0, 0.004), at(0, h, 0.004), at(-trim, h, 0.065), jamb);
  quad(at(w, 0, 0.004), at(w + trim, sillZ, 0.065), at(w + trim, h, 0.065), at(w, h, 0.004), jamb);
  const beam = (u0: number, u1: number, v0: number, v1: number, depth: number, mat: string): void => {
    quad(at(u0, v0, depth), at(u1, v0, depth), at(u1, v1, depth), at(u0, v1, depth), mat);
    quad(at(u0, v1, depth), at(u1, v1, depth), at(u1, v1, -0.018), at(u0, v1, -0.018), mat);
    quad(at(u0, v0, -0.018), at(u0, v0, depth), at(u0, v1, depth), at(u0, v1, -0.018), mat);
    quad(at(u1, v0, depth), at(u1, v0, -0.018), at(u1, v1, -0.018), at(u1, v1, depth), mat);
  };
  beam(-trim * 1.55, w + trim * 1.55, h, h + trim * (tibetan ? 1.8 : 1.12), tibetan ? 0.16 : 0.105, head);
  if (!door) beam(-trim * 1.4, w + trim * 1.4, sillZ - 0.025, 0.005, 0.13, jamb);
  if (!door && hoodRoom) {
    const spring = h + trim * 1.12, thick = Math.min(.125, w * .12);
    const rise = Math.min(w * (lagoon ? .57 : .42), hoodRoom - trim * 1.12 - thick);
    if (rise > .05) {
      // Istrian ogee or a relieving arch of brick and limestone built on the actual window head.
      const course = lagoon ? [[0,0],[.09,.30],[.24,.52],[.39,.65],[.5,1],[.61,.65],[.76,.52],[.91,.30],[1,0]]
                            : [[0,0],[.038,.38],[.146,.71],[.31,.92],[.5,1],[.69,.92],[.854,.71],[.962,.38],[1,0]];
      const hood = finish(lagoon ? 'istrian-hood' : 'brick-arch', lagoon ? 'e5d9c4' : 'ae674c');
      const rim = (i: number, outside: boolean, depth: number) => {
        const [u, v] = course[i];
        return at(u * w + (outside ? thick * (u * 2 - 1) : 0), spring + v * (rise + (outside ? thick : 0)), depth);
      };
      for (let i = 1; i < course.length; i++) {
        const m = lagoon || i % 2 ? hood : head, j = i - 1;
        quad(rim(j, true, .144), rim(i, true, .144), rim(i, false, .144), rim(j, false, .144), m);
        quad(rim(j, false, .024), rim(i, false, .024), rim(i, false, .144), rim(j, false, .144), m);
        quad(rim(j, true, .144), rim(i, true, .144), rim(i, true, .024), rim(j, true, .024), m);
      }
    }
  }
  const bar = (u0: number, u1: number, v0: number, v1: number, mat: string): void => quad(at(u0, v0, 0.023), at(u1, v0, 0.023), at(u1, v1, 0.023), at(u0, v1, 0.023), mat);
  if (door) {
    // An inset wooden leaf below its transom; the old deep opening remains visible in the reveal.
    const leaf = finish('door', industrial ? '546369' : lattice ? '7b4c38' : '70543f');
    bar(0.045, w - 0.045, 0.025, h * 0.83, leaf);
    bar(0.065, w - 0.065, h * 0.83 + 0.015, h * 0.83 + 0.06, pane);
    if (industrial) {
      // A folded sheet canopy on two diagonal brackets over the street door.
      const far = 0.56,
        high = h + trim * 2.6;
      quad(at(-0.22, high + 0.12, 0.025), at(w + 0.22, high + 0.12, 0.025), at(w + 0.22, high, far), at(-0.22, high, far), head);
      quad(at(-0.22, high - 0.07, far), at(w + 0.22, high - 0.07, far), at(w + 0.22, high, far), at(-0.22, high, far), jamb);
      for (const u of [-0.08, w + 0.08]) quad(at(u, h - 0.21, 0.04), at(u, high - 0.06, far - 0.08), at(u, high, far - 0.08), at(u, h - 0.15, 0.04), jamb);
    }
  } else if (w > 0.64 && (lattice || industrial || tibetan || /europe|tudor|elven|wizard|gothic|norse/.test(culture))) {
    bar(w * 0.5 - 0.022, w * 0.5 + 0.022, 0, h, pane);
    const v = h * (lattice ? 0.65 : 0.72);
    bar(0.012, w - 0.012, v, v + 0.036, pane);
  }
}

/** Gable infill and its roof truss share a plane. The tie beam spans the wall heads and the post meets the ridge. */
function gableFrame(pts: Vertex3[], normal: BuildingVector, quad: Quad): void {
  if (pts.length !== 3) return;
  const [a, b, top] = [...pts].sort((p, q) => p.z - q.z);
  const width = Math.hypot(b.x - a.x, b.y - a.y),
    height = top.z - a.z;
  if (Math.abs(a.z - b.z) > 0.04 || width < 2.8 || height < 1.1) return;
  const ux = (b.x - a.x) / width,
    uy = (b.y - a.y) / width;
  const at = (s: number, z: number, d: number): BuildingVector => [a.x + ux * s + normal[0] * d, a.y + uy * s + normal[1] * d, a.z + z];
  const wood = finish('gable-timber', '775b46'),
    apex = (top.x - a.x) * ux + (top.y - a.y) * uy;
  const beam = (s0: number, z0: number, s1: number, z1: number, r: number): void => {
    const len = Math.hypot(s1 - s0, z1 - z0),
      dx = (-(z1 - z0) / len) * r,
      dz = ((s1 - s0) / len) * r;
    quad(at(s0 + dx, z0 + dz, 0.055), at(s1 + dx, z1 + dz, 0.055), at(s1 - dx, z1 - dz, 0.055), at(s0 - dx, z0 - dz, 0.055), wood);
    quad(at(s0 + dx, z0 + dz, 0.004), at(s1 + dx, z1 + dz, 0.004), at(s1 + dx, z1 + dz, 0.055), at(s0 + dx, z0 + dz, 0.055), wood);
  };
  beam(0.04, 0.01, width - 0.04, 0.01, 0.09);
  beam(apex, 0.1, apex, height - 0.12, 0.085);
  if (width > 4.5) {
    beam(width * 0.12, 0.12, apex - 0.09, height * 0.55, 0.065);
    beam(width * 0.88, 0.12, apex + 0.09, height * 0.55, 0.065);
  }
}

interface RoofEdge {
  a: Vertex3;
  b: Vertex3;
  nx: number;
  ny: number;
  count: number;
  slope: number;
  differentSlope: boolean;
}
const vertexKey = (p: Vertex3): string => [p.x, p.y, p.z].map(v => Math.round(v * 1000)).join(',');

/** Clearance above the glazing, with room on both sides of the projecting stonework. */
function windowHoodRoom(pts: Vertex3[], openings: Vertex3[][], volume: OverviewVolume): number {
  const [a, b, c] = pts, w = Math.hypot(b.x - a.x, b.y - a.y);
  if (w < .35 || a.z < volume.z_m + .25) return 0;
  const ux = (b.x - a.x) / w, uy = (b.y - a.y) / w;
  const along = (p: Point) => (p.x - a.x) * ux + (p.y - a.y) * uy;
  const across = (p: Point) => (p.x - a.x) * uy - (p.y - a.y) * ux;
  const ring = volume.footprint[0].outer;
  if (!ring.some((p,i) => {
    const q = ring[(i + 1) % ring.length];
    return Math.abs(across(p)) < .13 && Math.abs(across(q)) < .13 &&
      Math.min(along(p), along(q)) <= -.16 && Math.max(along(p), along(q)) >= w + .16;
  })) return 0;
  let room = volume.z_m + volume.wall_height_m - c.z - .025;
  for (const other of openings) {
    if (other === pts || other.some(p => Math.abs(across(p)) > .16) || other[2].z <= c.z) continue;
    const x0 = along(other[0]), x1 = along(other[1]);
    if (Math.max(x0, x1) > -.18 && Math.min(x0, x1) < w + .18) room = Math.min(room, other[0].z - c.z - .16);
  }
  return room >= .3 ? room : 0;
}

/** Only the boundary of the roof covering receives a fascia. A ridge is shared by two inclined pans. */
function roofEdges(volume: OverviewVolume, culture: string, quad: Quad): void {
  if (!volume.overview_roof_faces) return;
  const mesh = volume.roof_mesh,
    edges = new Map<string, RoofEdge>();
  const [start, end] = volume.overview_roof_faces;
  let highest = -Infinity;
  for (let i = start; i < end; i++) {
    const f = mesh.faces[i];
    if (f.kind === 'gable' && f.material === volume.materials.coating && /european-organic|tudor|norse|germanic|franconian/.test(culture) && /plaster|wood|timber|wattle/.test(f.material))
      gableFrame(
        f.vertices.map(k => mesh.vertices[k]),
        f.normal,
        quad,
      );
    if (f.material !== volume.materials.cladding || f.normal[2] < 0.1) continue;
    const pts = f.vertices.map(k => mesh.vertices[k]);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length,
      cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k],
        b = pts[(k + 1) % pts.length],
        dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy);
      highest = Math.max(highest, a.z);
      if (len < 0.025) continue;
      const ka = vertexKey(a),
        kb = vertexKey(b),
        key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      const edge = edges.get(key);
      if (edge) {
        edge.count++;
        edge.differentSlope ||= Math.abs(edge.slope - (edge.nx * f.normal[0] + edge.ny * f.normal[1])) > 0.12;
      } else {
        const sign = dy * (a.x - cx) - dx * (a.y - cy) >= 0 ? 1 : -1,
          nx = (sign * dy) / len,
          ny = (-sign * dx) / len;
        edges.set(key, { a: sign > 0 ? a : b, b: sign > 0 ? b : a, nx, ny, count: 1, slope: nx * f.normal[0] + ny * f.normal[1], differentSlope: false });
      }
    }
  }
  const cover = volume.materials.cladding,
    metal = /metal|steel|zinc|lead|solar/.test(cover),
    thatch = /thatch|reed/.test(cover);
  const fascia = finish('fascia', metal ? '56646a' : thatch ? '917b55' : '796956');
  const cap = finish('ridge', cover.match(/@([0-9a-f]{6})$/i)?.[1] ?? (metal ? '879093' : /tile/.test(cover) ? 'ac7659' : '786f62'));
  for (const { a, b, nx, ny, count, differentSlope } of edges.values()) {
    const p = (v: Vertex3, width: number, lift: number): BuildingVector => [v.x + nx * width, v.y + ny * width, v.z + lift];
    if (count === 1) {
      const lip = thatch ? 0.078 : 0.045,
        depth = thatch ? 0.16 : 0.105;
      quad(p(a, lip, -depth), p(b, lip, -depth), p(b, lip, 0.004), p(a, lip, 0.004), fascia);
      quad(p(a, lip, 0.004), p(b, lip, 0.004), p(b, 0, 0), p(a, 0, 0), cap);
    } else if (count === 2 && differentSlope && Math.min(a.z, b.z) > highest - 0.03 && Math.hypot(a.x - b.x, a.y - b.y) > 0.6) {
      const half = thatch ? 0.19 : 0.135;
      for (const [x0, z0, x1, z1] of [
        [-half, -0.01, -half * 0.48, 0.077],
        [-half * 0.48, 0.077, half * 0.48, 0.077],
        [half * 0.48, 0.077, half, -0.01],
      ])
        quad(p(b, x0, z0), p(a, x0, z0), p(a, x1, z1), p(b, x1, z1), cap);
    }
  }
}

/** These fittings belong to the close mesh and share its draw call and material lighting. */
export function craftedArchitecture(volume: OverviewVolume, culture: string, emit: (face: BuildingTriangle) => void, hasRoofRoom = false): void {
  const mesh = volume.roof_mesh,
    ring = volume.footprint[0]?.outer;
  if (!mesh || !ring?.length) return;
  const quad: Quad = (a, b, c, d, material) => {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = d[0] - a[0],
      vy = d[1] - a[1],
      vz = d[2] - a[2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      len = Math.hypot(nx, ny, nz);
    if (len < 1e-8) return;
    const normal: BuildingVector = [nx / len, ny / len, nz / len];
    emit({ points: [a, b, c], material, materials: volume.materials, normal, surface: 'roof' });
    emit({ points: [a, c, d], material, materials: volume.materials, normal, surface: 'roof' });
  };
  const winding =
    ring.reduce((s, a, i) => {
      const b = ring[(i + 1) % ring.length];
      return s + a.x * b.y - b.x * a.y;
    }, 0) >= 0
      ? 1
      : -1;
  const regional = culture === 'venetian-lagoon' || culture === 'byzantine-greek';
  const openings = regional ? mesh.faces.filter(f => (f.material === OPENING || f.material === LIT_WINDOW) && f.vertices.length === 4)
    .map(f => ({ f, points: f.vertices.map(i => mesh.vertices[i]) })) : [];
  const selected = new Map<OverviewVolume['roof_mesh']['faces'][number], number>();
  if (openings.length) {
    const all = openings.map(o => o.points), start = hash(volume.id) % all.length;
    for (let i = 0; i < all.length && selected.size < 4; i++) {
      const { f, points } = openings[(start + i) % all.length];
      if ((f as { entrance?: boolean }).entrance) continue;
      const room = windowHoodRoom(points, all, volume);
      if (room) selected.set(f, room);
    }
  }
  for (const face of mesh.faces) {
    if ((face.material === OPENING || face.material === LIT_WINDOW) && face.vertices.length === 4)
      joinery(
        face.vertices.map(i => mesh.vertices[i]),
        winding,
        culture,
        volume,
        winding < 0 ? (a, b, c, d, m) => quad(b, a, d, c, m) : quad,
        !!(face as { entrance?: true }).entrance,
        selected.get(face),
      );
  }
  roofEdges(volume, culture, quad);
  craftedCrown(volume, culture, quad);
  if (culture === 'merfolk-tidal') craftedTidal(volume, emit);
  if (!hasRoofRoom) craftedRoofFitting(volume, culture, quad);
}
