/** City 3D display volumes. The City Bench scene holds three kinds of buildings:
 * silhouettes (footprint only), compact plans (native volumes, levels and
 * cartographic ridges, no roof mesh) and detailed native buildings (roof mesh).
 * This module gives the first two a display volume and roof so the shared
 * native 3D pass (UrbanBuildingPass, through Terrain3d.setBuildings) draws all
 * three the same way, with its sectors, overview LOD, cache and picking.
 * Native buildings pass through unchanged; no native geometry is modified. */
import type { ArchitectureVolume, PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { HouseMaterial, MaterialPattern, MaterialSlots, Point, Surface, Vertex3 } from '../../../rust/bridge/housesContract';
import { isBuildingProjection, surfaceTriangles, type Building3dScene, type Building3dVisual } from './urbanBuildingGeometry';
import type { NativeBuildingProjection, NativeBuildingProjectionScene } from '../ui/urbanBuildingProjection';
import { roleFamily } from './cityCanvas';
import type { Enclosure } from '../../../rust/bridge/urban';
import { loftRidges, pieceVolumes, readMassing, scaledRing, stiltDeck, stiltSupports, volumeRoof, type ResolvedVolume } from './cityMassing';
import { buildingTint } from './buildingPalette';
import type { TreeDwelling } from './cityTrees';

type RoofMesh = ArchitectureVolume['roof_mesh'];
type RoofMeshFace = RoofMesh['faces'][number];
/** City programme carried by silhouettes (urbanSilhouettes.ts), read defensively. */
interface Programme { role?: string; district_role?: string; wealth?: number; landmark?: boolean; households?: number }

export const CITY3D_LEVEL_M = 3;
/** Ground sampler in metres (physical, before display exaggeration). */
export type City3dHeight = (x: number, y: number) => number;

// ---------------------------------------------------------------- materials
/** Display-only materials: their pattern picks the shared house colour. */
const PATTERNS: MaterialPattern[] = ['tile', 'thatch', 'wood', 'stone', 'earth', 'fabric', 'snow', 'plain'];
export const CITY3D_MATERIALS: HouseMaterial[] = PATTERNS.map(pattern => ({ id: `city3d:${pattern}`, label: pattern, roles: [], pattern, origin: 'city3d', source_ref: null }));
// Layered ids `city3d:cover:<massing cover>`, `city3d:wall:<massing wall>`, `city3d:road:<surface>` keep the original massing
// material for the textured view (urbanBuilding3d.ts); their display pattern is the pattern the flat render always used.
const MESH_ROAD_PATTERNS: Record<string, MaterialPattern> = { bridge: 'stone', timber: 'wood' };
const WALL_ID: Record<MaterialPattern, string> = { tile: 'wall:brick', thatch: 'cover:thatch', wood: 'wall:timber', stone: 'wall:stone', earth: 'wall:earth', fabric: 'wall:hide', snow: 'cover:snow', plain: 'wall:plaster' };
const COVER_ID: Record<MaterialPattern, string> = { tile: 'cover:tile', thatch: 'cover:thatch', wood: 'cover:shingle', stone: 'cover:slate', earth: 'cover:earth', fabric: 'cover:felt', snow: 'cover:snow', plain: 'cover:plaster' };
const mat = (pattern: MaterialPattern): string => `city3d:${WALL_ID[pattern]}`;
const roofMat = (pattern: MaterialPattern): string => `city3d:${COVER_ID[pattern]}`;
const slots = (wall: MaterialPattern, roof: MaterialPattern): MaterialSlots => ({ frame: mat(wall), infill: mat(wall), coating: mat(wall), cladding: roofMat(roof), base: mat('stone'), roof_frame: mat('wood') });
/** Slots from the massing's own cover / wall ids (fallback patterns when unknown). */
const massingSlots = (wall: string, cover: string, fallbackWall: MaterialPattern, fallbackRoof: MaterialPattern): MaterialSlots => {
  const w = wall in WALLS ? `city3d:wall:${wall}` : mat(fallbackWall), c = cover in COVERS ? `city3d:cover:${cover}` : roofMat(fallbackRoof);
  return { frame: w, infill: w, coating: w, cladding: c, base: mat('stone'), roof_frame: mat('wood') };
};

// ---------------------------------------------------------------- massing rules
interface Massing { floors: number; wall: MaterialPattern; roof: MaterialPattern; pitchDeg: number; hip: boolean; flat?: boolean }
const FAMILY_MASSING: Record<string, Massing> = {
  dwelling: { floors: 2, wall: 'plain', roof: 'tile', pitchDeg: 40, hip: false },
  commerce: { floors: 2, wall: 'plain', roof: 'tile', pitchDeg: 35, hip: false },
  craft: { floors: 2, wall: 'wood', roof: 'tile', pitchDeg: 35, hip: false },
  worship: { floors: 4, wall: 'stone', roof: 'stone', pitchDeg: 48, hip: false },
  civic: { floors: 3, wall: 'stone', roof: 'tile', pitchDeg: 35, hip: true },
  defence: { floors: 5, wall: 'stone', roof: 'stone', pitchDeg: 0, hip: false, flat: true },
  garden: { floors: 1, wall: 'wood', roof: 'thatch', pitchDeg: 30, hip: false },
};
/** Massing covers and walls (urban/massing.rs) on the display materials. */
const COVERS: Record<string, MaterialPattern> = {
  tile: 'tile', slate: 'stone', thatch: 'thatch', reed: 'thatch', palm: 'thatch', bamboo: 'wood', shingle: 'wood', bark: 'wood', turf: 'earth', hide: 'fabric', felt: 'fabric',
  earth: 'earth', plaster: 'plain', stone: 'stone', snow: 'snow', metal: 'stone', lead: 'stone', fungal: 'plain',
};
const WALLS: Record<string, MaterialPattern> = { timber: 'wood', wood: 'wood', brick: 'tile', stone: 'stone', earth: 'earth', plaster: 'plain', bamboo: 'wood', wattle: 'earth', hide: 'fabric', coral: 'stone' };
CITY3D_MATERIALS.push(...Object.entries(COVERS).map(([k, pattern]) => ({ id: `city3d:cover:${k}`, label: k, roles: [], pattern, origin: 'city3d', source_ref: null } as HouseMaterial)),
  ...Object.entries(WALLS).map(([k, pattern]) => ({ id: `city3d:wall:${k}`, label: k, roles: [], pattern, origin: 'city3d', source_ref: null } as HouseMaterial)),
  { id: 'city3d:wall:opening', label: 'opening', roles: [], pattern: 'wood', origin: 'city3d', source_ref: null } as HouseMaterial,
  ...Object.entries(MESH_ROAD_PATTERNS).map(([k, pattern]) => ({ id: `city3d:road:${k}`, label: k, roles: [], pattern, origin: 'city3d', source_ref: null } as HouseMaterial)));
function hash(text: string): number { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }

/** Floors, materials and roof of a silhouette from its role family, role and wealth. */
export function silhouetteMassing(building: PlacedBuilding, area: number): Massing & { family: string } {
  const programme = (building as PlacedBuilding & { programme?: Programme }).programme, role = programme?.role ?? '';
  const family = roleFamily(role, building.function), base = FAMILY_MASSING[family] ?? FAMILY_MASSING.dwelling;
  const m = { ...base, family };
  if (family === 'dwelling') {
    if (/tenement/.test(role)) m.floors = 4;
    else if (/mansion|townhouse|palace/.test(role)) m.floors = 3;
    else if (/farm|platform|compound/.test(role)) m.floors = 1;
    if ((hash(building.id) & 3) === 0) m.floors += 1;
    const wealth = programme?.wealth;
    if (wealth !== undefined && wealth < 0.3) { m.floors = Math.max(1, m.floors - 1); m.roof = 'thatch'; m.wall = 'earth'; }
    else if (wealth !== undefined && wealth > 0.75) m.floors += 1;
  }
  if (/storage|granary|barn|warehouse/.test(role) || building.function === 'warehouse') { m.floors = Math.max(1, m.floors - 1); m.wall = 'wood'; }
  if (programme?.landmark) m.floors = Math.round(m.floors * 1.5);
  if (area < 30) m.floors = Math.min(m.floors, 1);
  return m;
}

// ---------------------------------------------------------------- geometry
const ringArea = (ring: readonly Point[]): number => ring.reduce((sum, p, i) => { const n = ring[(i + 1) % ring.length]; return sum + p.x * n.y - n.x * p.y; }, 0) / 2;
const ringLength = (ring: readonly Point[]): number => ring.reduce((sum, p, i) => { const n = ring[(i + 1) % ring.length]; return sum + Math.hypot(n.x - p.x, n.y - p.y); }, 0);
export const surfaceArea = (surface: Surface): number => surface.reduce((sum, shape) => sum + Math.abs(ringArea(shape.outer)) - shape.holes.reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);
function inRing(ring: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Minimum-area oriented rectangle: centre, unit long axis, half length and half width. */
export function orientedBox(ring: readonly Point[]): { center: Point; axis: Point; half: number; halfWidth: number; area: number } | undefined {
  let best: { center: Point; axis: Point; half: number; halfWidth: number; area: number } | undefined;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6) continue;
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) { const s = p.x * u.x + p.y * u.y, t = -p.x * u.y + p.y * u.x; u0 = Math.min(u0, s); u1 = Math.max(u1, s); v0 = Math.min(v0, t); v1 = Math.max(v1, t); }
    const area = (u1 - u0) * (v1 - v0);
    if (best && area >= best.area) continue;
    const s = (u0 + u1) / 2, t = (v0 + v1) / 2, center = { x: s * u.x - t * u.y, y: s * u.y + t * u.x };
    best = u1 - u0 >= v1 - v0 ? { center, axis: u, half: (u1 - u0) / 2, halfWidth: (v1 - v0) / 2, area } : { center, axis: { x: -u.y, y: u.x }, half: (v1 - v0) / 2, halfWidth: (u1 - u0) / 2, area };
  }
  return best;
}
function nearestOnSegment(p: Point, [a, b]: [Point, Point]): Point {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
function nearestOnRidges(p: Point, ridges: readonly [Point, Point][]): Point {
  let best = ridges[0][0], distance = Infinity;
  for (const ridge of ridges) { const q = nearestOnSegment(p, ridge), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < distance) { distance = d; best = q; } }
  return best;
}
/** Inward miter offset of a ring (outer rings CCW, holes CW), with a miter limit. */
function insetRing(ring: readonly Point[], distance: number, outer: boolean): Point[] {
  const ccw = ringArea(ring) > 0, points = ccw === outer ? ring : [...ring].reverse(), n = points.length, out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n], p = points[i], next = points[(i + 1) % n];
    const e0 = { x: p.x - prev.x, y: p.y - prev.y }, e1 = { x: next.x - p.x, y: next.y - p.y };
    const l0 = Math.hypot(e0.x, e0.y) || 1, l1 = Math.hypot(e1.x, e1.y) || 1;
    const n0 = { x: -e0.y / l0, y: e0.x / l0 }, n1 = { x: -e1.y / l1, y: e1.x / l1 };
    const bx = n0.x + n1.x, by = n0.y + n1.y, bl = Math.hypot(bx, by);
    if (bl < 1e-6) { out.push({ x: p.x + n1.x * distance, y: p.y + n1.y * distance }); continue; }
    const cos = (bx * n1.x + by * n1.y) / bl, k = distance / Math.max(1 / 3, cos);
    out.push({ x: p.x + bx / bl * k, y: p.y + by / bl * k });
  }
  return ccw === outer ? out : out.reverse();
}

/** Roof faces with Newell normals (pointing up), shared by every roof builder. */
class RoofBuilder {
  readonly vertices: Vertex3[] = [];
  readonly faces: RoofMeshFace[] = [];
  face(points: Vertex3[], material: string): void {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y);
    }
    const length = Math.hypot(nx, ny, nz); if (length < 1e-9) return;
    const sign = nz < 0 ? -1 : 1, normal: [number, number, number] = [sign * nx / length, sign * ny / length, sign * nz / length];
    const start = this.vertices.length; this.vertices.push(...points);
    this.faces.push({ vertices: points.map((_, i) => start + i), normal, material, kind: Math.abs(normal[2]) < 0.05 ? 'gable' : Math.abs(normal[2]) > 0.999 ? 'slab' : 'pan' });
  }
  mesh(): RoofMesh { return { vertices: this.vertices, faces: this.faces, edges: [], groups: [] }; }
}
/** Loft every eave edge to its projection on the ridges: hip, gable and L roofs. */
export function ridgeRoof(roof: RoofBuilder, ring: readonly Point[], ridges: readonly [Point, Point][], eave: number, top: number, material: string): void {
  const at = (p: Point, z: number): Vertex3 => ({ x: p.x, y: p.y, z });
  // Same ridge-axis construction as the 2D pans (cityMassing.loftRidges), checked in plan.
  const faces = ridges.length ? loftRidges(ring, ridges, eave, top) : undefined;
  if (faces) { for (const f of faces) roof.face(f, material); return; }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
    const pa = nearestOnRidges(a, ridges), pb = nearestOnRidges(b, ridges);
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 1e-3) roof.face([at(a, eave), at(b, eave), at(pa, top)], material);
    else roof.face([at(a, eave), at(b, eave), at(pb, top), at(pa, top)], material);
  }
}
function insetRoof(roof: RoofBuilder, surface: Surface, eave: number, rise: number, material: string): void {
  for (const shape of surface) {
    const perimeter = ringLength(shape.outer) + shape.holes.reduce((s, r) => s + ringLength(r), 0);
    const area = Math.abs(ringArea(shape.outer)) - shape.holes.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
    if (perimeter <= 0 || area <= 0) continue;
    const d = Math.min(6, 0.85 * area / perimeter), top = eave + rise;
    const rings = [{ ring: shape.outer, outer: true }, ...shape.holes.map(ring => ({ ring, outer: false }))];
    const inset = rings.map(({ ring, outer }) => insetRing(ring, d, outer));
    rings.forEach(({ ring }, r) => {
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length, a = ring[i], b = ring[j], c = inset[r][j], e = inset[r][i];
        roof.face([{ ...a, z: eave }, { ...b, z: eave }, { ...c, z: top }, { ...e, z: top }], material);
      }
    });
    for (const triangle of surfaceTriangles([{ outer: inset[0], holes: inset.slice(1) }])) roof.face(triangle.map(p => ({ x: p.x, y: p.y, z: top })), material);
  }
}
function flatRoof(roof: RoofBuilder, surface: Surface, z: number, material: string): void {
  for (const triangle of surfaceTriangles(surface)) roof.face(triangle.map(p => ({ x: p.x, y: p.y, z })), material);
}


// ---------------------------------------------------------------- volume details
// Six-digit suffixes are final sRGB; bucket tone, never individual channels.
const hex6 = (t: readonly number[]): string => t.map(v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
const tinted = (id: string, tint: string): string => tint ? `${id}@${tint}` : id;
function paletteSlots(plain: MaterialSlots, culture: string, wall: string, cover: string, tone: number, role: string): MaterialSlots {
  const p = buildingTint(culture, wall, cover, Math.round(tone * 15) / 15, role), w = tinted(plain.coating, hex6(p.wall));
  return { ...plain, frame: w, infill: w, coating: w, base: w, cladding: tinted(plain.cladding, hex6(p.roof)) };
}
const OPENING = 'city3d:wall:opening@393126';
const ringCentre = (ring: readonly Point[]): Point => ({ x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length });

/** Roof faces with a hut overhang: eave vertices pushed outward from the centre and dropped a little. */
function overhung(points: Vertex3[], eave: number, c: Point, d: number): Vertex3[] {
  return points.map(p => { if (Math.abs(p.z - eave) > 1e-6) return p; const dx = p.x - c.x, dy = p.y - c.y, l = Math.hypot(dx, dy) || 1; return { x: p.x + dx / l * d, y: p.y + dy / l * d, z: p.z - d * 0.35 }; });
}
/** Facade quad on an edge: `s0..s1` metres along it from `a`, `z0..z1` up, `off` out of the wall. */
function facadeQuad(roof: RoofBuilder, a: Point, b: Point, outward: number, s0: number, s1: number, z0: number, z1: number, off: number, material: string, batter?: { center: Point; ground: number; height: number }): void {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / l, uy = (b.y - a.y) / l, nx = uy * outward * off, ny = -ux * outward * off;
  const p = (s: number, z: number): Vertex3 => {
    const k = batter ? 1 - 0.08 * (z - batter.ground) / batter.height : 1, c = batter?.center ?? { x: 0, y: 0 };
    return { x: c.x + (a.x + ux * s - c.x) * k + nx, y: c.y + (a.y + uy * s - c.y) * k + ny, z };
  };
  roof.face([p(s0, z0), p(s1, z0), p(s1, z1), p(s0, z1)], material);
}
/** Box on the roof: four walls and a flat top, turned by `angle`, standing at `z`. */
function featureBox(roof: RoofBuilder, x: number, y: number, w: number, d: number, h: number, angle: number, z: number, material: string): void {
  const ca = Math.cos(angle), sa = Math.sin(angle), at = (s: number, t: number, zz: number): Vertex3 => ({ x: x + s * ca - t * sa, y: y + s * sa + t * ca, z: zz });
  const c: [number, number][] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  for (let i = 0; i < 4; i++) { const [s0, t0] = c[i], [s1, t1] = c[(i + 1) % 4]; roof.face([at(s0, t0, z), at(s1, t1, z), at(s1, t1, z + h), at(s0, t0, z + h)], material); }
  roof.face(c.map(([s, t]) => at(s, t, z + h)), material);
}
function featureDome(roof: RoofBuilder, x: number, y: number, r: number, h: number, z: number, material: string): void {
  const n = 8, rings = [0, 0.45, 0.8, 1].map(t => ({ k: Math.cos(t * Math.PI / 2), z: z + h * Math.sin(t * Math.PI / 2) }));
  const at = (i: number, k: number, zz: number): Vertex3 => ({ x: x + Math.cos(i / n * Math.PI * 2) * r * k, y: y + Math.sin(i / n * Math.PI * 2) * r * k, z: zz });
  for (let s = 0; s + 1 < rings.length; s++) for (let i = 0; i < n; i++) roof.face([at(i, rings[s].k, rings[s].z), at(i + 1, rings[s].k, rings[s].z), at(i + 1, rings[s + 1].k, rings[s + 1].z), at(i, rings[s + 1].k, rings[s + 1].z)], material);
}
/** All tree parts enter the existing sector/material batches, including rails. */
function treeDetails(roof: RoofBuilder, tree: TreeDwelling, base: number, wood: string, canopy: string): Point[] {
  const { center: c, radius: r, trunkRadius: tr, height: h, lean } = tree, n = 12;
  const trunk = (t: number, k: number): Vertex3[] => Array.from({ length: n }, (_, i) => {
    const a = i / n * Math.PI * 2 + t * 0.18, root = t === 0 ? 1 + 0.32 * Math.cos(a * 4) : 1;
    return { x: c.x + lean.x * t + Math.cos(a) * tr * k * root, y: c.y + lean.y * t + Math.sin(a) * tr * k * root, z: base + h * t };
  });
  const rings = [trunk(0, 1.5), trunk(0.12, 1.05), trunk(0.5, 0.91), trunk(1.03, 0.65)];
  const loft = (a: Vertex3[], b: Vertex3[], material: string): void => { for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; roof.face([a[i], a[j], b[j], b[i]], material); } };
  for (let i = 1; i < rings.length; i++) loft(rings[i - 1], rings[i], wood);
  for (const p of tree.platforms) {
    const z = base + p.height, pc = { x: c.x + lean.x * p.height / h, y: c.y + lean.y * p.height / h }, count = p.shape === 'polygon' ? 6 : 12;
    const arc = p.shape === 'partial' ? Math.PI * 1.5 : Math.PI * 2, steps = p.shape === 'partial' ? count + 1 : count;
    const ring = (radius: number): Point[] => Array.from({ length: steps }, (_, i) => { const a = p.angle + i / count * arc; return { x: pc.x + Math.cos(a) * radius, y: pc.y + Math.sin(a) * radius }; });
    const outer = ring(p.radius), inner = ring(tr * 1.15), shape = p.shape === 'partial' ? { outer: outer.concat([...inner].reverse()), holes: [] } : { outer, holes: [[...inner].reverse()] };
    const edges = p.shape === 'partial' ? outer.length - 1 : outer.length;
    for (let i = 0; i < edges; i++) {
      const j = (i + 1) % outer.length, points = [outer[i], outer[j], inner[j], inner[i]];
      roof.face(points.map(p => ({ ...p, z: z + 0.22 })), wood); roof.face(points.map(p => ({ ...p, z })), wood);
    }
    loft(shape.outer.map(p => ({ ...p, z })), shape.outer.map(p => ({ ...p, z: z + 0.22 })), wood);
    if (p.shape !== 'partial') loft(inner.map(p => ({ ...p, z })), inner.map(p => ({ ...p, z: z + 0.22 })), wood);
    for (let i = 0; i < edges; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length], length = Math.hypot(b.x - a.x, b.y - a.y);
      featureBox(roof, a.x, a.y, 0.1, 0.1, 0.95, 0, z + 0.22, wood);
      featureBox(roof, (a.x + b.x) / 2, (a.y + b.y) / 2, length, 0.09, 0.1, Math.atan2(b.y - a.y, b.x - a.x), z + 1.08, wood);
    }
    const a = p.angle + arc * 0.45, offset = (tr + p.radius) * 0.5, x = pc.x + Math.cos(a) * offset, y = pc.y + Math.sin(a) * offset;
    const size = Math.max(0.65, Math.min(r * 0.43, (p.radius - tr) * 1.1)), podHeight = Math.max(1.2, Math.min(2.2, r * 0.5));
    featureBox(roof, x, y, size, size * 0.85, podHeight, a, z + 0.22, wood);
    featureDome(roof, x, y, size * 0.72, size * 0.32, z + 0.22 + podHeight, canopy);
    featureBox(roof, x + Math.cos(a) * size * 0.51, y + Math.sin(a) * size * 0.51, 0.04, size * 0.32, podHeight * 0.65, a, z + 0.23, OPENING);
  }
  return rings[0].map(({ x, y }) => ({ x, y }));
}
/** Posts and a floor under a body raised on stilts: thin prisms on a 2.2 m grid inside the ring, a plank floor above them. */
function stiltPosts(roof: RoofBuilder, ring: readonly Point[], ground: number, h: number, floor: string, post: string): void {
  const xs = ring.map(p => p.x), ys = ring.map(p => p.y), inside = (x: number, y: number): boolean => {
    let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i].y > y) !== (ring[j].y > y) && x < (ring[j].x - ring[i].x) * (y - ring[i].y) / (ring[j].y - ring[i].y) + ring[i].x) c = !c; return c;
  };
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), nx = Math.max(1, Math.round((x1 - x0) / 2.2)), ny = Math.max(1, Math.round((y1 - y0) / 2.2));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    const x = x0 + (x1 - x0) * i / nx, y = y0 + (y1 - y0) * j / ny;
    if (inside(x, y) && (inside(x + 0.3, y) || inside(x - 0.3, y) || inside(x, y + 0.3))) featureBox(roof, x, y, 0.22, 0.22, h, 0, ground, post);
  }
  const top = ring.map(p => ({ x: p.x, y: p.y, z: ground + h }));
  roof.face(top, floor); roof.face([...top].reverse(), floor);
}
/** Parapet, roof-top features, trim, facade openings and tent pole of a volume (detailed LOD only), into its roof mesh. */
function volumeDetails(roof: RoofBuilder, v: ResolvedVolume, ground: number, wallId: string, id: string): void {
  const d = v.detail ?? {}, ring = d.form === 'battered' ? scaledRing(v.shape.outer, 0.92) : v.shape.outer, n = ring.length, eave = ground + v.eave_m, out = ringArea(ring) >= 0 ? 1 : -1;
  const parapet = v.roof === 'flat' ? d.parapet_m ?? 0 : 0;
  if (parapet > 0.05) {
    const inner = insetRing(ring, 0.3, true), top = eave + parapet;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = ring[i], b = ring[j], e = inner[i], f = inner[j];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.3) continue;
      roof.face([{ ...a, z: eave }, { ...b, z: eave }, { ...b, z: top }, { ...a, z: top }], wallId);
      roof.face([{ ...e, z: eave }, { ...f, z: eave }, { ...f, z: top }, { ...e, z: top }], wallId);
      roof.face([{ ...a, z: top }, { ...b, z: top }, { ...f, z: top }, { ...e, z: top }], wallId);
    }
  }
  for (const f of v.roof === 'flat' ? d.features ?? [] : []) {
    if (f.kind === 'dome') { featureDome(roof, f.x, f.y, f.w / 2, f.h, eave, wallId); continue; }
    featureBox(roof, f.x, f.y, f.w, f.d, f.h, f.angle, eave, wallId);
    const ca = Math.cos(f.angle), sa = Math.sin(f.angle), z0 = f.kind === 'stair' ? eave + 0.05 : eave + f.h - 1.3, z1 = f.kind === 'stair' ? eave + 1.9 : eave + f.h - 0.2;
    const at = (s: number, t: number, z: number): Vertex3 => ({ x: f.x + s * ca - t * sa, y: f.y + s * sa + t * ca, z });
    const hw = f.kind === 'stair' ? 0.4 : 0.3, sx = f.w / 2 + 0.04, sy = f.d / 2 + 0.04;
    roof.face([at(sx, -hw, z0), at(sx, hw, z0), at(sx, hw, z1), at(sx, -hw, z1)], OPENING);
    if (f.kind === 'windcatcher') for (const [s, t] of [[-sx, 0], [0, sy], [0, -sy]]) roof.face(s ? [at(s, -hw, z0), at(s, hw, z0), at(s, hw, z1), at(s, -hw, z1)] : [at(-hw, t, z0), at(hw, t, z0), at(hw, t, z1), at(-hw, t, z1)], OPENING);
  }
  if (v.roof === 'tent' && v.rise_m > 0.05) {
    const c = ringCentre(ring), top = eave + v.rise_m, r = 0.07, form = d.form, DARK = 'city3d:wall:wood@393126';
    if (form) {
      // Door on the longest facet: a dark flap rising up the slope.
      const e = ring.map((a, i) => ({ a, b: ring[(i + 1) % n] })).sort((x, y) => Math.hypot(y.b.x - y.a.x, y.b.y - y.a.y) - Math.hypot(x.b.x - x.a.x, x.b.y - x.a.y))[0];
      const m = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, l = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1, ux = (e.b.x - e.a.x) / l, uy = (e.b.y - e.a.y) / l;
      const ol = Math.hypot(m.x - c.x, m.y - c.y) || 1, ox = (m.x - c.x) / ol * 0.04, oy = (m.y - c.y) / ol * 0.04, w = Math.min(0.5, l * 0.3);
      if (form === 'yurt') facadeQuad(roof, e.a, e.b, out, l / 2 - w, l / 2 + w, ground + 0.02, ground + Math.min(1.4, v.eave_m - 0.1), 0.04, DARK);
      else {
        const t = 0.4, lift = (p: Point, k: number): Vertex3 => ({ x: p.x + (c.x - p.x) * k + ox, y: p.y + (c.y - p.y) * k + oy, z: ground + 0.02 + (top - ground - 0.02) * k });
        const b0 = { x: m.x - ux * w, y: m.y - uy * w }, b1 = { x: m.x + ux * w, y: m.y + uy * w };
        roof.face([lift(b0, 0), lift(b1, 0), lift({ x: b1.x - ux * w * 0.5, y: b1.y - uy * w * 0.5 }, t), lift({ x: b0.x + ux * w * 0.5, y: b0.y + uy * w * 0.5 }, t)], DARK);
      }
    }
    if (form === 'yurt') {
      // Dark crown ring on the apex (a flat cap seen from above and the side).
      const cr = Math.min(0.55, v.rise_m * 0.9), z0 = top - 0.12;
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, b = a + Math.PI / 4; roof.face([{ x: c.x + Math.cos(a) * cr, y: c.y + Math.sin(a) * cr, z: z0 }, { x: c.x + Math.cos(b) * cr, y: c.y + Math.sin(b) * cr, z: z0 }, { x: c.x + Math.cos(b) * cr * 0.7, y: c.y + Math.sin(b) * cr * 0.7, z: top + 0.1 }, { x: c.x + Math.cos(a) * cr * 0.7, y: c.y + Math.sin(a) * cr * 0.7, z: top + 0.1 }], DARK); }
      roof.face(Array.from({ length: 8 }, (_, i) => ({ x: c.x + Math.cos(i * Math.PI / 4) * cr * 0.7, y: c.y + Math.sin(i * Math.PI / 4) * cr * 0.7, z: top + 0.1 })), DARK);
      return;
    }
    if (form === 'tipi') {
      // Poles crossing above the apex: thin crossed blades.
      const h = hash(id);
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * Math.PI * 2 + (h % 7) * 0.1, tx = c.x + Math.cos(a) * 0.35, ty = c.y + Math.sin(a) * 0.35, hw = 0.035, sx = -Math.sin(a) * hw, sy = Math.cos(a) * hw;
        roof.face([{ x: c.x * 0.9 + tx * 0.1 + sx, y: c.y * 0.9 + ty * 0.1 + sy, z: top - 0.5 }, { x: c.x * 0.9 + tx * 0.1 - sx, y: c.y * 0.9 + ty * 0.1 - sy, z: top - 0.5 }, { x: tx - sx, y: ty - sy, z: top + 0.9 }, { x: tx + sx, y: ty + sy, z: top + 0.9 }], 'city3d:wall:wood');
        roof.face([{ x: c.x * 0.9 + tx * 0.1 - sy, y: c.y * 0.9 + ty * 0.1 + sx, z: top - 0.5 }, { x: c.x * 0.9 + tx * 0.1 + sy, y: c.y * 0.9 + ty * 0.1 - sx, z: top - 0.5 }, { x: tx + sy, y: ty - sx, z: top + 0.9 }, { x: tx - sy, y: ty + sx, z: top + 0.9 }], 'city3d:wall:wood');
      }
      return;
    }
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, b = a + Math.PI / 2; roof.face([{ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, z: top }, { x: c.x + Math.cos(b) * r, y: c.y + Math.sin(b) * r, z: top }, { x: c.x, y: c.y, z: top + 1 }], 'city3d:wall:wood'); }
    return;
  }
  // Edges by length: red trim band, then a door and windows on the longest ones.
  const facade = v.shape.outer, batter = d.form === 'battered' ? { center: ringCentre(facade), ground, height: v.eave_m } : undefined;
  const edges = facade.map((a, i) => { const b = facade[(i + 1) % n]; return { a, b, l: Math.hypot(b.x - a.x, b.y - a.y) }; }).filter(e => e.l >= 2.2).sort((x, y) => y.l - x.l);
  const h = hash(id), storey = v.eave_m / Math.max(1, v.floors), hut = (d.overhang_m ?? 0) > 0 || v.roof === 'cone';
  const scale = d.form ? 1 : Math.max(1, Math.min(2.5, storey / CITY3D_LEVEL_M));
  if (scale > 1.8) for (const e of edges) {
    facadeQuad(roof, e.a, e.b, out, 0, e.l, eave - 0.65, eave - 0.05, 0.06, 'city3d:wall:timber');
    for (const s of [0.3, e.l - 0.8]) facadeQuad(roof, e.a, e.b, out, s, s + 0.5, ground, eave, 0.07, 'city3d:wall:timber');
  }
  if (d.trim === 'red' && parapet > 0) for (const e of edges) facadeQuad(roof, e.a, e.b, out, 0.15, e.l - 0.15, eave - 0.95, eave - 0.4, 0.03, 'city3d:wall:plaster@a75e4b');
  let windows = 0;
  edges.slice(0, hut ? 1 : 2).forEach((e, k) => {
    const doorW = (hut ? 0.8 : 1.0) * scale, doorH = (hut ? 1.6 : 2.1) * scale, doorAt = Math.max(0.3, Math.min(e.l - doorW - 0.3, ((h >>> (k * 3)) % 100) / 100 * e.l));
    if (k === 0 || (h >>> 5) % 3 === 0) facadeQuad(roof, e.a, e.b, out, doorAt, doorAt + doorW, ground + 0.02, ground + Math.min(doorH, v.eave_m - 0.2), 0.04, OPENING, batter);
    if (hut) return;
    const medina = v.roof === 'flat', gap = (medina ? 3.4 : 2.6) * scale, count = Math.floor((e.l - 1) / gap), ww = (medina ? 0.4 : 0.85) * scale, wh = (medina ? 0.55 : 1.1) * scale;
    for (let f = medina ? 1 : 0; f < v.floors && windows < 10; f++) for (let c = 0; c < count && windows < 10; c++) {
      const s = 0.5 + (c + 0.5) * (e.l - 1) / count - ww / 2, z0 = f * storey + (medina ? 1.8 : 1.0) * scale;
      if (z0 + wh > v.eave_m - 0.25 || (medina && (h >>> (c + f)) % 3 === 0)) continue;
      if (f === 0 && s < doorAt + doorW + 0.3 && s + ww > doorAt - 0.3) continue;
      facadeQuad(roof, e.a, e.b, out, s, s + ww, ground + z0, ground + z0 + wh, 0.04, OPENING, batter); windows++;
    }
  });
}

// ---------------------------------------------------------------- buildings
function baseVolume(id: string, footprint: Surface, z: number, wall: number, rise: number, materials: MaterialSlots, roof: RoofMesh, roofSystem: string, foundation: ArchitectureVolume['foundation'], levels?: ArchitectureVolume['levels']): ArchitectureVolume {
  return { id, footprint, levels: levels ?? [{ index: 0, footprint, z_m: z, height_m: wall }], z_m: z, wall_height_m: wall, roof_height_m: rise,
    roof_system: roofSystem, roof_pitch_deg: 0, overhang_m: 0, roof_spec: {} as ArchitectureVolume['roof_spec'], materials, role: 'main', envelope: 'walled', roof_mesh: roof, foundation };
}

/** Extruded silhouette: walls of `floors × 3 m`, a gable or hip roof on
 * rectangular shapes, a pitched border elsewhere, a foundation down to the lowest
 * terrain sample so no wall floats above a slope. */
export function silhouetteBuilding(building: PlacedBuilding, heightAt?: City3dHeight, waterAt?: City3dHeight): PlacedBuilding {
  const footprint = building.footprint, area = surfaceArea(footprint), m = silhouetteMassing(building, area);
  const culture = building.culture.culture, programme = (building as PlacedBuilding & { programme?: Programme }).programme;
  const role = `${programme?.role ?? ''} ${m.family}${programme?.landmark ? ' monument' : ''}`;
  let low = Infinity, high = -Infinity;
  if (heightAt) for (const shape of footprint) for (const p of shape.outer) { const h = heightAt(p.x, p.y); if (Number.isFinite(h)) { low = Math.min(low, h); high = Math.max(high, h); } }
  let ground = Number.isFinite(building.ground_z_m) ? building.ground_z_m : (Number.isFinite(low) ? (low + high) / 2 : 0);
  if (Number.isFinite(low)) ground = Math.max(low, Math.min(high, ground));
  const massing = readMassing((building as PlacedBuilding & { programme?: unknown }).programme, footprint, building.id);
  const raised = massing?.some((m, i) => pieceVolumes(footprint[i], m).some(v => (v.detail?.stilts_m ?? 0) > 0));
  if (raised && waterAt) for (const shape of footprint) for (const p of [...shape.outer, ringCentre(shape.outer)]) {
    const water = waterAt(p.x, p.y); if (Number.isFinite(water)) ground = Math.max(ground, water);
  }
  if (massing) {
    // City massing (cityMassing.ts): one volume per preview piece, its own height and roof.
    const foundation = { footprint, z_min_m: Math.min(ground, Number.isFinite(low) ? low : ground) - 0.3, z_max_m: ground };
    const volumes = footprint.flatMap((shape, i) => {
      const piece = massing[i]; if (!piece) return [];
      return pieceVolumes(shape, piece).map((v, j) => {
        const plain = massingSlots(v.wall, v.cover, WALLS[v.wall] ?? m.wall, COVERS[v.cover] ?? m.roof), roof = new RoofBuilder();
        const materials = paletteSlots(plain, culture, v.wall, v.cover, v.tone, role + (v.wall === 'stone' ? ' monument' : '')), wallId = materials.coating;
        if (v.tree) {
          for (const face of volumeRoof(v, i, j)) roof.face(face.points.map(p => ({ ...p, z: p.z + ground })), materials.cladding);
          const trunk = treeDetails(roof, v.tree, ground, wallId, materials.cladding), bodyShape = { outer: trunk, holes: [] };
          const volume = baseVolume(`${building.id}:city3d:${i}:${j}`, [v.shape], ground, v.eave_m, v.rise_m, materials, roof.mesh(), 'RF-DOME',
            { ...foundation, footprint: [bodyShape] }, [{ index: 0, footprint: [{ outer: scaledRing(v.shape.outer, v.tree.trunkRadius / v.tree.radius), holes: [] }], z_m: ground, height_m: v.eave_m }]);
          volume.envelope = 'open'; return volume;
        }
        const over = v.detail?.overhang_m ?? 0, centre = ringCentre(v.shape.outer), lift = v.detail?.stilts_m ?? 0;
        const body = wallId;
        if (lift > 0) {
          stiltPosts(roof, stiltDeck(v.shape.outer), ground, lift, wallId, materials.roof_frame);
          for (const p of stiltSupports(v.shape.outer)) featureBox(roof, p.x, p.y, 0.32, 0.32, lift + 0.45, 0, ground, materials.roof_frame);
        }
        const base = ground + lift;
        for (const face of volumeRoof(v, i, j)) roof.face((over > 0 ? overhung(face.points, v.eave_m, centre, over) : face.points).map(p => ({ x: p.x, y: p.y, z: p.z + base })), materials.cladding);
        const form = v.detail?.form, organic = form === 'tree' || form === 'mushroom';
        const bodyShape = organic ? { outer: scaledRing(v.shape.outer, form === 'tree' ? 0.22 : 0.3), holes: [] } : v.shape;
        if (organic) {
          flatRoof(roof, [v.shape], base + v.eave_m, materials.cladding);
          volumeDetails(roof, { ...v, shape: bodyShape, detail: { ...v.detail, overhang_m: 0.1 } }, base, body, `${building.id}:${i}:${j}`);
        } else if (form === 'battered') {
          const bottom = v.shape.outer, top = scaledRing(bottom, 0.92);
          for (let k = 0; k < bottom.length; k++) { const n = (k + 1) % bottom.length; roof.face([{ ...bottom[k], z: base }, { ...bottom[n], z: base }, { ...top[n], z: base + v.eave_m }, { ...top[k], z: base + v.eave_m }], wallId); }
          volumeDetails(roof, v, base, body, `${building.id}:${i}:${j}`);
        } else volumeDetails(roof, v, base, body, `${building.id}:${i}:${j}`);
        const system = v.roof === 'flat' ? 'RF-FLAT' : v.roof === 'hip' || v.roof === 'pyramid' || v.roof === 'tent' ? 'RF-HIP' : 'RF-GABLE';
        const volume = baseVolume(`${building.id}:city3d:${i}:${j}`, [v.shape], base, v.eave_m, Math.max(0, v.rise_m), materials, roof.mesh(), system,
          { ...foundation, footprint: [bodyShape], z_max_m: lift > 0 ? foundation.z_min_m : ground },
          [{ index: 0, footprint: [bodyShape], z_m: base, height_m: v.eave_m }]);
        if (form === 'battered') volume.envelope = 'open';
        return volume;
      });
    });
    const treeCrowns = massing.some(p => p.volumes?.some(v => v.form === 'tree'));
    return { ...building, ground_z_m: ground, roof_footprint: treeCrowns ? volumes.flatMap(v => v.footprint) : building.roof_footprint.length ? building.roof_footprint : footprint, volumes };
  }
  const plain = slots(m.wall, m.roof), materials = paletteSlots(plain, culture, WALL_ID[m.wall].split(':')[1], COVER_ID[m.roof].split(':')[1], hash(building.id) / 0xffffffff, role);
  const wall = m.floors * CITY3D_LEVEL_M, eave = ground + wall, roof = new RoofBuilder();
  let rise = 0;
  for (const shape of footprint) {
    const box = orientedBox(shape.outer); if (!box) continue;
    const pitch = Math.tan(m.pitchDeg * Math.PI / 180);
    const shapeRise = m.flat || box.halfWidth < 1.2 ? 0 : Math.min(box.halfWidth * pitch, 12);
    rise = Math.max(rise, shapeRise);
    if (shapeRise <= 0.05) { flatRoof(roof, [shape], eave, materials.cladding); continue; }
    const rectangular = !shape.holes.length && Math.abs(ringArea(shape.outer)) >= 0.82 * box.area;
    if (rectangular) {
      const half = m.hip ? Math.max(0, box.half - box.halfWidth) : box.half, c = box.center, u = box.axis;
      ridgeRoof(roof, shape.outer, [[{ x: c.x - u.x * half, y: c.y - u.y * half }, { x: c.x + u.x * half, y: c.y + u.y * half }]], eave, eave + shapeRise, materials.cladding);
    } else insetRoof(roof, [shape], eave, Math.min(shapeRise, 4), materials.cladding);
  }
  const foundation = { footprint, z_min_m: Math.min(ground, Number.isFinite(low) ? low : ground) - 0.3, z_max_m: ground };
  return { ...building, ground_z_m: ground, roof_footprint: building.roof_footprint.length ? building.roof_footprint : footprint,
    volumes: [baseVolume(`${building.id}:city3d`, footprint, ground, wall, rise, materials, roof.mesh(), m.flat ? 'RF-FLAT' : m.hip ? 'RF-HIP' : 'RF-GABLE', foundation)] };
}

const FLAT_SYSTEMS = /FLAT|TERRACE|SLAB|PARAPET/;
/** Compact plan: native volumes and levels kept, roofs lofted to the plan's
 * cartographic ridges (or a pitched border / flat crown when it has none). */
export function compactBuilding(building: PlacedBuilding): PlacedBuilding {
  const ridges = building.cartographic?.ridges ?? [];
  const volumes = building.volumes.map(volume => {
    if (volume.roof_mesh?.faces.length) return volume;
    const roof = new RoofBuilder(), eave = volume.z_m + volume.wall_height_m, rise = Math.max(0, volume.roof_height_m), material = volume.materials.cladding;
    const own = ridges.filter(([a, b]) => volume.footprint.some(shape => inRing(shape.outer, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })));
    if (rise < 0.2 || FLAT_SYSTEMS.test(volume.roof_system)) flatRoof(roof, volume.footprint, eave + rise, material);
    else if (own.length) for (const shape of volume.footprint) ridgeRoof(roof, shape.outer, own, eave, eave + rise, material);
    else insetRoof(roof, volume.footprint, eave, rise, material);
    return { ...volume, roof_mesh: roof.mesh() };
  });
  return { ...building, volumes };
}

export type City3dKind = 'silhouette' | 'compact' | 'detailed';
export interface City3dDisplayScene extends Building3dScene { buildings: Building3dVisual[]; kinds: Record<City3dKind, number> }
export const city3dDisplayKind = (building: Building3dVisual): City3dKind => isBuildingProjection(building) ? 'compact' : city3dKind(building);
/** A shared exterior belongs to this exact indexed accepted-plan projection. */
export function projectionDetailMatches(base: NativeBuildingProjection, detail: PlacedBuilding): boolean {
  return detail.id === base.id && detail.parcel_id === base.parcel_id && detail.function === base.function
    && detail.recipe_id === base.recipe_id && detail.variant_id === base.variant_id
    && detail.ground_z_m === base.ground_z_m && detail.footprint === base.footprint && detail.roof_footprint === base.roof_footprint;
}
/** Cold accepted plans stay typed projections. Geometry/picking display their
 * exact contours and recorded height; no guessed roof/native record is made. */
export function city3dProjectionScene(scene: NativeBuildingProjectionScene, options: { details?: ReadonlyMap<string, PlacedBuilding> } = {}): City3dDisplayScene {
  const kinds: Record<City3dKind, number> = { silhouette: 0, compact: 0, detailed: 0 };
  const buildings = scene.buildings.map(base => {
    const detail = options.details?.get(base.id);
    if (detail && projectionDetailMatches(base, detail)) { kinds.detailed++; return detail; }
    kinds.compact++; return base;
  });
  return { buildings, materials: scene.materials, kinds, occupationBuildings: scene.buildings };
}
export const city3dKind = (building: PlacedBuilding): City3dKind =>
  building.recipe_id === 'silhouette' || !building.volumes.length ? 'silhouette'
    : building.volumes.some(v => v.roof_mesh?.faces.length) ? 'detailed' : 'compact';

/** Display batch for the 3D pass. `details` replaces buildings by their realized
 * native exterior (same id). Ids, parcels and functions are those of the scene. */
export function city3dScene(scene: PlacementBatch, options: { heightAt?: City3dHeight; waterAt?: City3dHeight; details?: ReadonlyMap<string, PlacedBuilding> } = {}): PlacementBatch & { kinds: Record<City3dKind, number> } {
  const kinds: Record<City3dKind, number> = { silhouette: 0, compact: 0, detailed: 0 };
  const buildings = scene.buildings.map(source => {
    const detail = options.details?.get(source.id);
    if (detail) { kinds.detailed++; return detail; }
    const kind = city3dKind(source); kinds[kind]++;
    return kind === 'silhouette' ? silhouetteBuilding(source, options.heightAt, options.waterAt) : kind === 'compact' ? compactBuilding(source) : source;
  });
  return { ...scene, materials: [...(scene.materials ?? []), ...CITY3D_MATERIALS], buildings, kinds };
}

/** Cubic B-spline of cell-centred samples, as Terrain3d samples its surface; water clamps to 0. */
export function rasterHeight(data: Float32Array, n: number, width: number): City3dHeight {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const weights = (t: number): number[] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
  return (x, y) => {
    const gx = clamp(x / width, 0, 1) * n - .5, gy = clamp(y / width, 0, 1) * n - .5, bx = Math.floor(gx), by = Math.floor(gy);
    const wx = weights(gx - bx), wy = weights(gy - by);
    let h = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) h += data[clamp(by + j - 1, 0, n - 1) * n + clamp(bx + i - 1, 0, n - 1)] * wx[i] * wy[j];
    return Math.max(0, h);
  };
}

// ---------------------------------------------------------------- bridges
/** Bridge and causeway streets as stone decks over the water: the plan drapes
 * streets into the ground texture, which hides them under the water surface.
 * Each segment becomes a deck (0.9 m thick, at the higher bank plus 0.6 m, raised
 * by the clearance of wide spans) with piers down to the bed every ~14 m. These are
 * city volumes for the 3D view only, not authoritative architecture. */
export function city3dBridges(streets: readonly { path: Point[]; widths: number[]; role: string }[], heightAt?: City3dHeight, waterAt?: City3dHeight): PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  const h = (p: Point): number => (heightAt ? heightAt(p.x, p.y) : 0) || 0;
  streets.forEach((street, si) => {
    if ((street.role !== 'bridge' && street.role !== 'causeway') || street.path.length < 2) return;
    const a = street.path[0], b = street.path[street.path.length - 1];
    const span = street.path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - street.path[i].x, p.y - street.path[i].y), 0);
    let water = -Infinity;
    if (waterAt) for (let i = 1; i < street.path.length; i++) {
      const p = street.path[i - 1], q = street.path[i], steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 8));
      for (let k = 0; k <= steps; k++) { const z = waterAt(p.x + (q.x - p.x) * k / steps, p.y + (q.y - p.y) * k / steps); if (Number.isFinite(z)) water = Math.max(water, z); }
    }
    const deck = Math.max(h(a), h(b), water) + 0.6 + (street.role === 'bridge' ? Math.min(4, span / 40) : 0);
    const width = Math.max(3, ...street.widths.filter(Number.isFinite)) + 0.8;
    // Narrow bridges are timber decks (as in the textured 2D plan), wider ones stone paving.
    const materials: MaterialSlots = { ...slots('stone', 'stone'), cladding: width < 4.8 ? 'city3d:road:timber' : 'city3d:road:bridge' }, volumes: ArchitectureVolume[] = [], footprint: Surface = [];
    for (let i = 1; i < street.path.length; i++) {
      const p = street.path[i - 1], q = street.path[i], len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 0.2) continue;
      const nx = -(q.y - p.y) / len * width / 2, ny = (q.x - p.x) / len * width / 2;
      const quad = [{ x: p.x + nx, y: p.y + ny }, { x: q.x + nx, y: q.y + ny }, { x: q.x - nx, y: q.y - ny }, { x: p.x - nx, y: p.y - ny }];
      const shape = { outer: quad, holes: [] }, roof = new RoofBuilder();
      flatRoof(roof, [shape], deck, materials.cladding); footprint.push(shape);
      volumes.push(baseVolume(`bridge:${si}:${i}:deck`, [shape], deck - 0.9, 0.9, 0, materials, roof.mesh(), 'RF-FLAT', { footprint: [shape], z_min_m: deck - 0.9, z_max_m: deck - 0.9 }));
      // Two parapets share the deck's volume batch and leave the bank ends open.
      const railWidth = Math.min(0.45, width * 0.1), railHeight = 1.05;
      for (const side of [-1, 1]) {
        const inner = 1 - railWidth / (width / 2);
        const rail = { outer: [{ x: p.x + nx * side, y: p.y + ny * side }, { x: q.x + nx * side, y: q.y + ny * side },
          { x: q.x + nx * side * inner, y: q.y + ny * side * inner }, { x: p.x + nx * side * inner, y: p.y + ny * side * inner }], holes: [] };
        const cap = new RoofBuilder(); flatRoof(cap, [rail], deck + railHeight, materials.cladding);
        volumes.push(baseVolume(`bridge:${si}:${i}:parapet:${side}`, [rail], deck, railHeight, 0, materials, cap.mesh(), 'RF-FLAT', { footprint: [rail], z_min_m: deck, z_max_m: deck }));
      }
      // Piers, only where the deck stands clear of the ground (over water or a ravine).
      for (let t = 14; t < len - 4; t += 14) {
        const c = { x: p.x + (q.x - p.x) * t / len, y: p.y + (q.y - p.y) * t / len }, bed = h(c);
        if (deck - 0.9 - bed < 1.5) continue;
        const ux = (q.x - p.x) / len * 0.9, uy = (q.y - p.y) / len * 0.9, wx = nx * 0.8, wy = ny * 0.8;
        const pier = { outer: [{ x: c.x - ux + wx, y: c.y - uy + wy }, { x: c.x + ux + wx, y: c.y + uy + wy }, { x: c.x + ux - wx, y: c.y + uy - wy }, { x: c.x - ux - wx, y: c.y - uy - wy }], holes: [] };
        volumes.push(baseVolume(`bridge:${si}:${i}:pier:${t}`, [pier], bed, deck - 0.9 - bed, 0, materials, new RoofBuilder().mesh(), 'RF-FLAT', { footprint: [pier], z_min_m: bed - 0.5, z_max_m: bed }));
      }
    }
    if (!volumes.length) return;
    const mid = street.path[street.path.length >> 1];
    out.push({ id: `city3d-bridge:${si}`, parcel_id: '', function: 'open_space', culture: { culture: '', pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
      recipe_id: 'city3d-bridge', variant_id: street.role, transform: { origin: mid, orientation_deg: 0 }, ground_z_m: deck - 0.9,
      footprint, roof_footprint: footprint, courtyards: [], circulation: [], entrance: mid, access_id: '',
      volumes, useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'recipe_volumes', diagnostics: ['city3d bridge deck (display only)'], resolved: null });
  });
  return out;
}

// ---------------------------------------------------------------- walls
/** Fortifications (Rust `urban::fortification`, Enclosure) as display volumes:
 * the plan only paints them on the ground texture. Every face is draped on the
 * relief (bottom below the ground, top at ground + height at each vertex), so long
 * curtains follow slopes without stepping. Curtains are cut into pieces of at most
 * WALL_CHUNK m so the building pass culls them by sector. Ditches and glacis stay
 * on the plan texture; gate passages and water-gate spans leave the curtain open.
 * Display only, never authoritative geometry. */
const WALL_STEP = 8, WALL_CHUNK = 80;
const WALL_PATTERN: Record<string, MaterialPattern> = { timber: 'wood', 'timber-earth': 'wood', thorn: 'thatch', stone: 'stone', brick: 'earth', 'rammed-earth': 'earth', 'earth-stone': 'stone' };
const ROUND_ROOFED = new Set(['curtain', 'flanked', 'concentric']);
type WallShape = { outer: Point[]; holes: Point[][] };
type Z = (p: Point) => number;

/** Edges no longer than `step` (so a draped top follows the relief). */
function densify(ring: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + (b.x - a.x) * j / k, y: a.y + (b.y - a.y) * j / k });
  }
  return out;
}
class WallMesh {
  readonly roof = new RoofBuilder();
  readonly footprint: Surface = [];
  bottom = Infinity; top = -Infinity;
  private face(points: Vertex3[], material: string): void {
    for (const p of points) { this.bottom = Math.min(this.bottom, p.z); this.top = Math.max(this.top, p.z); }
    this.roof.face(points, material);
  }
  /** Prism between two draped levels; `cap` closes the top, `under` the bottom (lintels, spans). */
  prism(shape: WallShape, zb: Z, zt: Z, side: string, cap: string | undefined, under = false): void {
    const rings = [shape.outer, ...shape.holes].filter(r => r.length >= 3).map(r => densify(r, WALL_STEP));
    if (!rings.length || Math.abs(ringArea(rings[0])) < 0.05) return;
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      this.face([{ ...a, z: zb(a) }, { ...b, z: zb(b) }, { ...b, z: zt(b) }, { ...a, z: zt(a) }], side);
    }
    const flat = { outer: rings[0], holes: rings.slice(1) };
    if (cap) for (const t of surfaceTriangles([flat])) this.face(t.map(p => ({ ...p, z: zt(p) })), cap);
    if (under) for (const t of surfaceTriangles([flat])) this.face(t.map(p => ({ ...p, z: zb(p) })).reverse(), side);
    this.footprint.push(flat);
  }
  cone(ring: readonly Point[], z: number, rise: number, material: string): void {
    const c = centroid(ring), apex = { ...c, z: z + rise };
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; this.face([{ ...a, z }, { ...b, z }, apex], material); }
  }
  pitched(shape: WallShape, eave: number, rise: number, material: string): void {
    const before = this.roof.vertices.length;
    insetRoof(this.roof, [shape], eave, rise, material);
    for (const p of this.roof.vertices.slice(before)) { this.bottom = Math.min(this.bottom, p.z); this.top = Math.max(this.top, p.z); }
  }
  get empty(): boolean { return !this.roof.faces.length; }
}
const centroid = (ring: readonly Point[]): Point => { let x = 0, y = 0; for (const p of ring) { x += p.x; y += p.y; } return ring.length ? { x: x / ring.length, y: y / ring.length } : { x: 0, y: 0 }; };

/** Closed curtain path with arc-length stations and outward miter offsets. */
class Curtain {
  readonly pts: Point[]; readonly cum: number[] = [0]; readonly normals: Point[] = []; readonly miters: Point[] = []; readonly length: number;
  constructor(path: readonly Point[]) {
    const pts = path.slice(), f = pts[0], l = pts[pts.length - 1];
    if (pts.length > 1 && Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) pts.pop();
    this.pts = pts; const n = pts.length, sign = ringArea(pts) > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
      // The interior lies on the left of a positive ring: outward is the right normal.
      this.normals.push({ x: sign * (b.y - a.y) / len, y: -sign * (b.x - a.x) / len });
      this.cum.push(this.cum[i] + len);
    }
    this.length = this.cum[n];
    for (let i = 0; i < n; i++) {
      // Miter of unit offset: bisector scaled by 1/cos(half turn), limited to 2.5.
      const p = this.normals[(i + n - 1) % n], q = this.normals[i], bx = p.x + q.x, by = p.y + q.y, bl = Math.hypot(bx, by);
      if (bl < 1e-6) { this.miters.push(q); continue; }
      const cos = (bx * q.x + by * q.y) / bl, k = Math.min(2.5, 1 / Math.max(0.4, cos)) / bl;
      this.miters.push({ x: bx * k, y: by * k });
    }
  }
  private segment(s: number): number { let lo = 0, hi = this.pts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.cum[m] <= s) lo = m; else hi = m - 1; } return lo; }
  /** Point and outward offset direction at arc length s (the miter on vertices). */
  at(s: number): { p: Point; o: Point } {
    const L = this.length; s = ((s % L) + L) % L;
    const i = this.segment(s), a = this.pts[i], b = this.pts[(i + 1) % this.pts.length], t = (s - this.cum[i]) / Math.max(1e-9, this.cum[i + 1] - this.cum[i]);
    return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, o: t < 1e-6 ? this.miters[i] : this.normals[i] };
  }
  /** Arc length of the nearest point of the path. */
  project(q: Point): number {
    let best = 0, distance = Infinity;
    for (let i = 0; i < this.pts.length; i++) {
      const a = this.pts[i], b = this.pts[(i + 1) % this.pts.length], p = nearestOnSegment(q, [a, b]), d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < distance) { distance = d; best = this.cum[i] + Math.hypot(p.x - a.x, p.y - a.y); }
    }
    return best;
  }
  /** Stations from s0 to s1 (s1 may pass the start): every vertex, at most `step` apart. */
  private stations(s0: number, s1: number, step: number): { p: Point; o: Point }[] {
    const marks = [s0];
    for (let lap = 0; lap < 2; lap++) for (let i = 0; i < this.pts.length; i++) { const s = this.cum[i] + lap * this.length; if (s > s0 + 1e-6 && s < s1 - 1e-6) marks.push(s); }
    marks.push(s1); marks.sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 1; i < marks.length; i++) { const k = Math.max(1, Math.ceil((marks[i] - marks[i - 1]) / step)); for (let j = 0; j < k; j++) out.push(marks[i - 1] + (marks[i] - marks[i - 1]) * j / k); }
    out.push(s1);
    return out.map(s => this.at(s));
  }
  /** Strip between the outward offsets a < b over [s0, s1]. */
  strip(s0: number, s1: number, a: number, b: number, step = WALL_STEP): WallShape {
    const st = this.stations(s0, s1, step), off = (x: { p: Point; o: Point }, d: number): Point => ({ x: x.p.x + x.o.x * d, y: x.p.y + x.o.y * d });
    return { outer: [...st.map(x => off(x, a)), ...st.reverse().map(x => off(x, b))], holes: [] };
  }
}

function wallPiece(id: string, variant: string, mesh: WallMesh, pattern: MaterialPattern): PlacedBuilding | undefined {
  if (mesh.empty) return undefined;
  const ground = mesh.bottom, materials = slots(pattern, pattern), origin = centroid(mesh.footprint.flatMap(s => s.outer));
  const volume = baseVolume(`${id}:v`, mesh.footprint, ground, mesh.top - ground, 0, materials, mesh.roof.mesh(), 'RF-FLAT', { footprint: mesh.footprint, z_min_m: ground, z_max_m: ground }, []);
  return { id, parcel_id: '', function: 'collective', culture: { culture: '', pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
    recipe_id: 'city3d-wall', variant_id: variant, transform: { origin, orientation_deg: 0 }, ground_z_m: ground,
    footprint: mesh.footprint, roof_footprint: mesh.footprint, courtyards: [], circulation: [], entrance: origin, access_id: '',
    volumes: [volume], useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'recipe_volumes', diagnostics: ['city3d fortification (display only)'], resolved: null };
}

/** Curtains, towers, gatehouses, bastions, outworks and lean-tos of every
 * enclosure. Stone curtains carry a wall walk and merlons; palisades are a
 * timber line (on an earth bank for `gord`); hedges stay on the plan. */
export function city3dWalls(enclosures: readonly Enclosure[], heightAt?: City3dHeight, key = 'w', culture = ''): PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  const g = (p: Point): number => (heightAt ? heightAt(p.x, p.y) : 0) || 0;
  const push = (b: PlacedBuilding | undefined): void => {
    if (!b) return;
    const paint = (id: string): string => {
      const m = /^city3d:(wall|cover):(.+)$/.exec(id); if (!m || !culture) return id;
      const p = buildingTint(culture, m[2], m[2], 0.5, m[2] === 'stone' || m[2] === 'earth' ? 'defence' : 'dwelling');
      return tinted(id, hex6(m[1] === 'cover' ? p.roof : p.wall));
    };
    out.push({ ...b, culture: { ...b.culture, culture }, volumes: b.volumes.map(v => ({ ...v,
      materials: Object.fromEntries(Object.entries(v.materials).map(([k, id]) => [k, paint(id)])) as unknown as MaterialSlots,
      roof_mesh: { ...v.roof_mesh, faces: v.roof_mesh.faces.map(f => ({ ...f, material: paint(f.material) })) } })) });
  };
  enclosures.forEach((e, ei) => {
    if (e.kind === 'hedge' || e.path.length < 4) return;
    const id = `city3d-wall:${key}:${ei}`, curtain = new Curtain(e.path), L = curtain.length;
    if (L < 20) return;
    const wall = e.kind === 'wall', style = e.style || (wall ? 'flanked' : 'palisade');
    const h = wall ? 1.5 : 0.75, c = e.curtain_width_m || (wall ? 3 : 1.5), H = e.height_m || (wall ? 9 : 3.5);
    const pattern = WALL_PATTERN[e.material ?? ''] ?? (wall ? 'stone' : 'wood'), side = mat(pattern);
    const top = mat(e.material === 'earth-stone' ? 'earth' : pattern), wood = mat('wood'), earth = mat('earth');
    // Openings: land gates over their passage width, water gates over the river arc.
    const gatehouses = e.gatehouses ?? [], cuts: [number, number][] = [];
    for (const gh of gatehouses) if (gh.kind === 'water') {
      let a = curtain.project(gh.passage[0]), b = curtain.project(gh.passage[1]);
      if (((b - a) % L + L) % L > L / 2) [a, b] = [b, a];
      cuts.push([a, a + ((b - a) % L + L) % L]);
    }
    e.gates.forEach((q, gi) => {
      const gh = gatehouses.find(x => x.gate === gi && x.kind !== 'water'), s = curtain.project(q);
      // An oblique street crosses the curtain over passage / sin(angle) of its length.
      let sin = 1;
      if (gh) { const dx = gh.passage[1].x - gh.passage[0].x, dy = gh.passage[1].y - gh.passage[0].y, l = Math.hypot(dx, dy) || 1, o = curtain.at(s).o; sin = Math.max(0.5, Math.abs(dx * o.x + dy * o.y) / l); }
      const w = (gh?.passage_width_m ?? 5) / 2 / sin + 0.3;
      cuts.push([s - w, s + w]);
    });
    const norm = cuts.flatMap(([a, b]): [number, number][] => { const k = Math.floor(a / L) * L; a -= k; b -= k; return b > L ? [[a, L], [0, b - L]] : [[a, b]]; }).sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const cut of norm) { const last = merged[merged.length - 1]; if (last && cut[0] <= last[1]) last[1] = Math.max(last[1], cut[1]); else merged.push([cut[0], cut[1]]); }
    const runs: [number, number][] = [];
    if (!merged.length) runs.push([0, L]);
    else for (let i = 0; i < merged.length; i++) {
      const s0 = merged[i][1], s1 = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + L;
      if (s1 - s0 > 0.5) runs.push([s0, s1]);
    }
    // Curtain: wall walk at ground + height, merlons on the outer edge.
    const crenel = wall && style !== 'bastioned';
    let piece = 0;
    for (const [r0, r1] of runs) {
      const k = Math.max(1, Math.ceil((r1 - r0) / WALL_CHUNK));
      for (let j = 0; j < k; j++) {
        const s0 = r0 + (r1 - r0) * j / k, s1 = r0 + (r1 - r0) * (j + 1) / k, mesh = new WallMesh();
        if (wall) {
          mesh.prism(curtain.strip(s0, s1, -h, c - h), p => g(p) - 1, p => g(p) + H, side, top);
          if (crenel) for (let s = s0 + 0.6; s + 1.2 < s1; s += 2.4)
            mesh.prism(curtain.strip(s, s + 1.2, c - h - 0.6, c - h, 2), p => g(p) + H - 0.05, p => g(p) + H + 1, side, side);
        } else {
          let base = -0.5;
          if (style === 'gord') { mesh.prism(curtain.strip(s0, s1, -h, c - h), p => g(p) - 0.5, p => g(p) + 1.5, earth, earth); base = 1.3; }
          const at = style === 'gord' ? c - h - 0.7 : -0.2;
          mesh.prism(curtain.strip(s0, s1, at, at + 0.4), p => g(p) + base, p => g(p) + H, wood, wood);
        }
        push(wallPiece(`${id}:curtain:${piece++}`, `${style}:curtain`, mesh, wall ? pattern : 'wood'));
      }
    }
    // Towers: a flat platform; a cone on the corner and gate towers of the European round styles.
    (e.towers_detail ?? []).forEach((t, ti) => {
      const ring = t.footprint?.outer; if (!ring || ring.length < 3) return;
      const mesh = new WallMesh(), z = g(t.center) + (t.height_m || H + 3), low = Math.min(...ring.map(g)) - 1;
      mesh.prism({ outer: ring, holes: [] }, () => low, () => z, wall ? side : wood, wall ? top : wood);
      if (t.shape === 'round' && wall && ROUND_ROOFED.has(style) && t.kind !== 'flank') mesh.cone(ring, z, 1.4 * t.radius_m, roofMat('tile'));
      else if (!wall) mesh.pitched({ outer: ring, holes: [] }, z, 1.6, wood);
      push(wallPiece(`${id}:tower:${ti}`, `${style}:tower:${t.shape}`, mesh, wall ? pattern : 'wood'));
    });
    // Gatehouses: masses either side, a lintel block over the passage; water gates span the river on piers.
    gatehouses.forEach((gh, gi) => {
      const mesh = new WallMesh(), material = gh.kind === 'timber' ? wood : side;
      if (gh.kind === 'water') {
        const [a, b] = gh.passage, ground = Math.max(g(a), g(b)), zTop = ground + (gh.height_m || H);
        for (const m of gh.masses ?? []) mesh.prism(m, p => g(p) - 1, () => zTop, material, top);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len >= 0.5) {
          const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, o = curtain.at(curtain.project({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).o;
          const n = o.x * -u.y + o.y * u.x >= 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x }; // outward side of the span
          const rect = (t0: number, t1: number, d0: number, d1: number): WallShape => ({ outer: [[t0, d0], [t1, d0], [t1, d1], [t0, d1]].map(([t, d]) => ({ x: a.x + u.x * t + n.x * d, y: a.y + u.y * t + n.y * d })), holes: [] });
          const deck = ground + Math.min(4, Math.max(2.5, (gh.height_m || H) - 3));
          mesh.prism(rect(0, len, -h, c - h), () => deck, () => zTop, side, top, true);
          for (let t = 8; t < len - 3; t += 8) { const bed = g({ x: a.x + u.x * t, y: a.y + u.y * t }); if (deck - bed > 1) mesh.prism(rect(t - 0.9, t + 0.9, -h + 0.2, c - h - 0.2), () => bed - 1, () => deck, side, undefined); }
        }
        push(wallPiece(`${id}:gate:${gi}`, `${style}:gate:water`, mesh, pattern));
        return;
      }
      const q = e.gates[gh.gate] ?? gh.passage[0], ground = g(q), zTop = ground + (gh.height_m || H + 2);
      // Only the masses stand on the ground: the passage between them stays open.
      if (!gh.masses?.length) return;
      for (const m of gh.masses) mesh.prism(m, p => g(p) - 1, () => zTop, material, top);
      const clear = Math.min(5.5, Math.max(3, zTop - ground - 2));
      if (gh.shape?.outer?.length >= 3) {
        mesh.prism(gh.shape, () => ground + clear, () => zTop, material, top, true);
        if (gh.kind === 'timber') mesh.pitched(gh.shape, zTop, 2, wood);
        else if (style === 'wengcheng') mesh.pitched(gh.shape, zTop, 3.5, roofMat('tile'));
      }
      push(wallPiece(`${id}:gate:${gi}`, `${style}:gate:${gh.kind}`, mesh, gh.kind === 'timber' ? 'wood' : pattern));
    });
    // Bastions and outworks (the glacis stays on the plan), draped like the curtain.
    const works = [...(e.bastions ?? []).map(w => ({ ...w, kind: 'bastion' })), ...(e.outworks ?? []).filter(w => w.kind !== 'glacis')];
    works.forEach((w, wi) => {
      if (!w.shape?.outer || w.shape.outer.length < 3) return;
      const mesh = new WallMesh(), height = w.height_m || 0.8 * H;
      mesh.prism(w.shape, p => g(p) - 1, p => g(p) + height, side, top);
      push(wallPiece(`${id}:${w.kind}:${wi}`, `${style}:${w.kind}`, mesh, pattern));
    });
    // Lean-tos against the outer face: low walls under a pitched roof.
    (e.attached ?? []).forEach((a, ai) => {
      if (!a.shape?.outer || a.shape.outer.length < 3) return;
      const mesh = new WallMesh(), eave = g(centroid(a.shape.outer)) + Math.max(2.4, (a.height_m || 5) - 1.6);
      mesh.prism(a.shape, p => g(p) - 0.5, () => eave, mat('plain'), undefined);
      mesh.pitched(a.shape, eave, 1.6, roofMat('tile'));
      push(wallPiece(`${id}:lean-to:${ai}`, `${style}:lean-to`, mesh, 'plain'));
    });
  });
  return out;
}
