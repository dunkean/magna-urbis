import type { Point, Vertex3 } from '../../../rust/bridge/housesContract';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { RoofBuilder, inRing, ringArea, orientedBox } from './city3d/roofGeometry';
import { hash } from './city3d/massing';
import { roleFamily } from './city/planLook';
import type { OverviewVolume } from './urbanBuildingGeometry';
import type { RoofMesh } from './city3d/types';

const dormers = new Set('european-organic bastide hanseatic flemish-cloth-town industrial-victorian haussmannian garden-city rynek-town wizard-city gnomish'.split(' '));
const setbacks = new Set('american-grid global-high-rise modernist-functionalist gulf-contemporary chinese-megacity korean-high-rise japanese-contemporary corporate-arcology futuristic-space-colony cyberpunk solarpunk dystopian-brutalism'.split(' '));
const glass = 'city3d:detail:glazing@51686c',
  joinery = 'city3d:detail:frame@877a66',
  fascia = 'city3d:detail:roof-edge@79756a';
type Site = { volume: OverviewVolume; points: Vertex3[]; n: number[]; area: number };
type Room = { volume: OverviewVolume; mesh: RoofMesh };
type At = (along: number, back: number, height: number) => Vertex3;
const cache = new WeakMap<PlacedBuilding, Room | null>();

/** Select a single convex pan. Its boundary already excludes valleys, eave skirts and courtyard holes. */
function roofSites(building: PlacedBuilding, flat: boolean): Site[] {
  const sites: Site[] = [];
  for (const volume of building.volumes as OverviewVolume[]) {
    if (volume.role === 'minor' || volume.envelope === 'open' || volume.wall_height_m < (flat ? 4.8 : 2.6)) continue;
    if (flat ? volume.displayRoofForm !== 'flat' : !['gable', 'hip', 'shed'].includes(volume.displayRoofForm ?? '')) continue;
    const mesh = volume.roof_mesh;
    const [lo, hi] = volume.overview_roof_faces ?? [0, mesh.faces.length];
    for (let i = lo; i < hi; i++) {
      const face = mesh.faces[i],
        n = face.normal;
      if (face.material !== volume.materials.cladding || (flat ? n[2] < 0.998 : n[2] < 0.45 || n[2] > 0.94)) continue;
      const points = face.vertices.map(k => mesh.vertices[k]),
        area = ringArea(points);
      if (Math.abs(area) < (flat ? 30 : 10)) continue;
      if (
        points.some((a, j) => {
          const b = points[(j + 1) % points.length],
            c = points[(j + 2) % points.length];
          return ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) * Math.sign(area) < -0.001;
        })
      )
        continue;
      sites.push({ volume, points, n, area: Math.abs(area) });
    }
  }
  return sites.sort((a, b) => b.area - a.area);
}

/** A gabled dormer meets the parent pan along two real valleys. Its ridge ends exactly on the original roof plane. */
function dormer(mesh: RoofBuilder, at: At, w: number, slope: number, cover: string, wall: string): void {
  const head = 1.32,
    rise = Math.min(0.93, w * 0.65),
    peak = head + rise,
    side = head / slope,
    valley = peak / slope;
  const front = (s: number, h: number, offset = 0) => at(s, -offset, h);
  mesh.face([front(-w, 0), front(w, 0), front(w, head), front(0, peak), front(-w, head)], wall);
  mesh.face([front(-w, 0), front(-w, head), at(-w, side, head)], wall);
  mesh.face([front(w, head), front(w, 0), at(w, side, head)], wall);
  for (const sign of [-1, 1]) {
    const edge = sign * (w + 0.1),
      lip = head - (0.1 * rise) / w;
    mesh.face([at(edge, -0.16, lip), at(0, -0.16, peak), at(0, valley, peak), at(edge, lip / slope, lip)], cover);
    mesh.face([at(edge, -0.16, lip - 0.075), at(0, -0.16, peak - 0.075), at(0, -0.16, peak), at(edge, -0.16, lip)], fascia);
  }
  const win = Math.min(0.72, w * 0.78);
  const panel = (l: number, r: number, low: number, high: number, d: number, m: string) => mesh.face([front(l, low, d), front(r, low, d), front(r, high, d), front(l, high, d)], m);
  panel(-win - 0.07, win + 0.07, 0.16, head - 0.06, 0.025, joinery);
  panel(-win, win, 0.23, head - 0.13, 0.036, glass);
  panel(-0.033, 0.033, 0.23, head - 0.13, 0.05, joinery);
  mesh.face([front(-win - 0.12, 0.16, 0.11), front(win + 0.12, 0.16, 0.11), front(win + 0.12, 0.19), front(-win - 0.12, 0.19)], fascia);
}

/** Set back on all sides, with a recessed glazed face under a projecting roof and solid end walls. */
function attic(mesh: RoofBuilder, at: At, w: number, d: number, h: number, volume: OverviewVolume): void {
  const wall = volume.materials.coating,
    cover = volume.materials.cladding;
  mesh.face([at(-w, d, 0), at(-w, 0, 0), at(-w, 0, h), at(-w, d, h)], wall);
  mesh.face([at(w, 0, 0), at(w, d, 0), at(w, d, h), at(w, 0, h)], wall);
  mesh.face([at(w, d, 0), at(-w, d, 0), at(-w, d, h), at(w, d, h)], wall);
  const front = (u: number, v: number, depth = 0.27) => at(u, depth, v);
  mesh.face([front(-w, 0), front(w, 0), front(w, 0.59), front(-w, 0.59)], wall);
  mesh.face([front(-w, 0.59), front(w, 0.59), front(w, h), front(-w, h)], glass);
  const bays = Math.max(2, Math.round((2 * w) / 1.38));
  for (let j = 0; j <= bays; j++) {
    const u = -w + (2 * w * j) / bays;
    mesh.face([front(u - 0.042, 0.59, 0.24), front(u + 0.042, 0.59, 0.24), front(u + 0.042, h, 0.24), front(u - 0.042, h, 0.24)], fascia);
  }
  const lip = 0.16;
  const base = [at(-w - lip, -lip, h), at(w + lip, -lip, h), at(w + lip, d + lip, h), at(-w - lip, d + lip, h)];
  const top = base.map(p => ({ ...p, z: p.z + 0.19 }));
  mesh.face(base.slice().reverse(), fascia);
  for (let i = 0; i < 4; i++) mesh.face([base[i], base[(i + 1) % 4], top[(i + 1) % 4], top[i]], fascia);
  mesh.face(top, cover);
}

function fit(building: PlacedBuilding, site: Site, flat: boolean, seed: number): Room | undefined {
  const { volume, points, n } = site,
    box = orientedBox(points);
  if (!box) return;
  const slope = Math.hypot(n[0], n[1]) / n[2];
  const bx = flat ? -box.axis.y : -n[0] / Math.hypot(n[0], n[1]),
    by = flat ? box.axis.x : -n[1] / Math.hypot(n[0], n[1]);
  const ux = by,
    uy = -bx;
  const origin = points.reduce((s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length }), { x: 0, y: 0 });
  const along = (p: Point) => (p.x - origin.x) * ux + (p.y - origin.y) * uy;
  const back = (p: Point) => (p.x - origin.x) * bx + (p.y - origin.y) * by;
  const xs = points.map(along),
    ys = points.map(back);
  const w = flat ? Math.min(5, (Math.max(...xs) - Math.min(...xs)) * 0.24) : Math.min(1.56, box.half * 0.3);
  const depth = flat ? Math.min(5.6, (Math.max(...ys) - Math.min(...ys)) * 0.46) : (1.32 + Math.min(0.93, w * 0.65)) / slope;
  if (w < (flat ? 1.52 : 0.8) || depth < (flat ? 2.1 : 1.15)) return;
  const front = -depth * 0.5,
    margin = flat ? 0.55 : 0.18;
  const roofZ = (x: number, y: number) => points[0].z - ((x - points[0].x) * n[0] + (y - points[0].y) * n[1]) / n[2];
  for (const shift of [(((seed >>> 8) % 3) - 1) * w * 0.68, 0]) {
    const x = origin.x + ux * shift + bx * front,
      y = origin.y + uy * shift + by * front;
    const z = roofZ(x, y),
      at: At = (u, b, h) => ({ x: x + ux * u + bx * b, y: y + uy * u + by * b, z: z + h });
    const corners = [at(-w - margin, -margin, 0), at(w + margin, -margin, 0), at(w + margin, depth + margin, 0), at(-w - margin, depth + margin, 0)];
    if (!corners.every(p => inRing(points, p))) continue;
    // Conservative rectangle overlap in the room's axes also catches obstructions crossing between corners.
    const overlaps = (ring: Point[]) => ring.some(p => along(p) >= shift - w - margin) && ring.some(p => along(p) <= shift + w + margin) && ring.some(p => back(p) >= front - margin) && ring.some(p => back(p) <= front + depth + margin);
    if (volume.footprint.some(shape => shape.holes.some(overlaps))) continue;
    if (building.volumes.some(v => v !== volume && v.z_m + v.wall_height_m + v.roof_height_m > z + 0.02 && v.footprint.some(s => overlaps(s.outer)))) continue;
    const source = volume.roof_mesh;
    if (
      source.faces.some(face => {
        const ps = face.vertices.map(i => source.vertices[i]);
        return ps.some(p => p.z > roofZ(p.x, p.y) + 0.12) && overlaps(ps);
      })
    )
      continue;
    const mesh = new RoofBuilder();
    if (flat) attic(mesh, at, w, depth, 2.25 + (seed % 4) * 0.16, volume);
    else dormer(mesh, at, w, slope, volume.materials.cladding, volume.materials.coating);
    return { volume, mesh: mesh.mesh() };
  }
}

/** At most one occupied roof addition per dwelling, cached with its generated display building. */
export function craftedRoofRoom(building: PlacedBuilding): Room | null {
  const cached = cache.get(building);
  if (cached !== undefined) return cached;
  const culture = building.culture?.culture ?? '',
    flat = setbacks.has(culture);
  let result: Room | null = null;
  const seed = hash(building.id);
  const role = (building as PlacedBuilding & { programme?: { role?: string } }).programme?.role;
  if ((building.function === 'domestic' || building.function === 'mixed') && (flat || dormers.has(culture)) && roleFamily(role, building.function) === 'dwelling' && seed % 100 < 69) {
    for (const site of roofSites(building, flat)) {
      result = fit(building, site, flat, seed) ?? null;
      if (result) break;
    }
  }
  cache.set(building, result);
  return result;
}
