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
import { loftRidges, pieceVolumes, readMassing, volumeRoof } from './cityMassing';

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
const mat = (pattern: MaterialPattern): string => `city3d:${pattern}`;
const slots = (wall: MaterialPattern, roof: MaterialPattern): MaterialSlots => ({ frame: mat(wall), infill: mat(wall), coating: mat(wall), cladding: mat(roof), base: mat('stone'), roof_frame: mat('wood') });

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
  earth: 'earth', plaster: 'plain', stone: 'stone', snow: 'snow', metal: 'stone', lead: 'stone',
};
const WALLS: Record<string, MaterialPattern> = { timber: 'wood', wood: 'wood', brick: 'tile', stone: 'stone', earth: 'earth', plaster: 'plain', bamboo: 'wood', wattle: 'earth', hide: 'fabric', coral: 'stone' };
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

// ---------------------------------------------------------------- buildings
function baseVolume(id: string, footprint: Surface, z: number, wall: number, rise: number, materials: MaterialSlots, roof: RoofMesh, roofSystem: string, foundation: ArchitectureVolume['foundation'], levels?: ArchitectureVolume['levels']): ArchitectureVolume {
  return { id, footprint, levels: levels ?? [{ index: 0, footprint, z_m: z, height_m: wall }], z_m: z, wall_height_m: wall, roof_height_m: rise,
    roof_system: roofSystem, roof_pitch_deg: 0, overhang_m: 0, roof_spec: {} as ArchitectureVolume['roof_spec'], materials, role: 'main', envelope: 'walled', roof_mesh: roof, foundation };
}

/** Extruded silhouette: walls of `floors × 3 m`, a gable or hip roof on
 * rectangular shapes, a pitched border elsewhere, a foundation down to the lowest
 * terrain sample so no wall floats above a slope. */
export function silhouetteBuilding(building: PlacedBuilding, heightAt?: City3dHeight): PlacedBuilding {
  const footprint = building.footprint, area = surfaceArea(footprint), m = silhouetteMassing(building, area);
  let low = Infinity, high = -Infinity;
  if (heightAt) for (const shape of footprint) for (const p of shape.outer) { const h = heightAt(p.x, p.y); if (Number.isFinite(h)) { low = Math.min(low, h); high = Math.max(high, h); } }
  let ground = Number.isFinite(building.ground_z_m) ? building.ground_z_m : (Number.isFinite(low) ? (low + high) / 2 : 0);
  if (Number.isFinite(low)) ground = Math.max(low, Math.min(high, ground));
  const massing = readMassing((building as PlacedBuilding & { programme?: unknown }).programme, footprint);
  if (massing) {
    // City massing (cityMassing.ts): one volume per preview piece, its own height and roof.
    const foundation = { footprint, z_min_m: Math.min(ground, Number.isFinite(low) ? low : ground) - 0.3, z_max_m: ground };
    const volumes = footprint.flatMap((shape, i) => {
      const piece = massing[i]; if (!piece) return [];
      return pieceVolumes(shape, piece).map((v, j) => {
        const materials = slots(WALLS[v.wall] ?? m.wall, COVERS[v.cover] ?? m.roof), roof = new RoofBuilder();
        for (const face of volumeRoof(v, i, j)) roof.face(face.points.map(p => ({ x: p.x, y: p.y, z: p.z + ground })), materials.cladding);
        const system = v.roof === 'flat' ? 'RF-FLAT' : v.roof === 'hip' || v.roof === 'pyramid' || v.roof === 'tent' ? 'RF-HIP' : 'RF-GABLE';
        return baseVolume(`${building.id}:city3d:${i}:${j}`, [v.shape], ground, v.eave_m, Math.max(0, v.rise_m), materials, roof.mesh(), system, { ...foundation, footprint: [v.shape] });
      });
    });
    return { ...building, ground_z_m: ground, roof_footprint: building.roof_footprint.length ? building.roof_footprint : footprint, volumes };
  }
  const wall = m.floors * CITY3D_LEVEL_M, eave = ground + wall, materials = slots(m.wall, m.roof), roof = new RoofBuilder();
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
export function city3dScene(scene: PlacementBatch, options: { heightAt?: City3dHeight; details?: ReadonlyMap<string, PlacedBuilding> } = {}): PlacementBatch & { kinds: Record<City3dKind, number> } {
  const kinds: Record<City3dKind, number> = { silhouette: 0, compact: 0, detailed: 0 };
  const buildings = scene.buildings.map(source => {
    const detail = options.details?.get(source.id);
    if (detail) { kinds.detailed++; return detail; }
    const kind = city3dKind(source); kinds[kind]++;
    return kind === 'silhouette' ? silhouetteBuilding(source, options.heightAt) : kind === 'compact' ? compactBuilding(source) : source;
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
export function city3dBridges(streets: readonly { path: Point[]; widths: number[]; role: string }[], heightAt?: City3dHeight): PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  const h = (p: Point): number => (heightAt ? heightAt(p.x, p.y) : 0) || 0;
  streets.forEach((street, si) => {
    if ((street.role !== 'bridge' && street.role !== 'causeway') || street.path.length < 2) return;
    const a = street.path[0], b = street.path[street.path.length - 1];
    const span = street.path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - street.path[i].x, p.y - street.path[i].y), 0);
    const deck = Math.max(h(a), h(b)) + 0.6 + (street.role === 'bridge' ? Math.min(4, span / 40) : 0);
    const width = Math.max(3, ...street.widths.filter(Number.isFinite)) + 0.8;
    const materials = slots('stone', 'stone'), volumes: ArchitectureVolume[] = [], footprint: Surface = [];
    for (let i = 1; i < street.path.length; i++) {
      const p = street.path[i - 1], q = street.path[i], len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 0.2) continue;
      const nx = -(q.y - p.y) / len * width / 2, ny = (q.x - p.x) / len * width / 2;
      const quad = [{ x: p.x + nx, y: p.y + ny }, { x: q.x + nx, y: q.y + ny }, { x: q.x - nx, y: q.y - ny }, { x: p.x - nx, y: p.y - ny }];
      const shape = { outer: quad, holes: [] }, roof = new RoofBuilder();
      flatRoof(roof, [shape], deck, materials.cladding); footprint.push(shape);
      volumes.push(baseVolume(`bridge:${si}:${i}:deck`, [shape], deck - 0.9, 0.9, 0, materials, roof.mesh(), 'RF-FLAT', { footprint: [shape], z_min_m: deck - 0.9, z_max_m: deck - 0.9 }));
      // Piers, only where the deck stands clear of the ground (over water or a ravine).
      if (street.role === 'bridge') for (let t = 14; t < len - 4; t += 14) {
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
export function city3dWalls(enclosures: readonly Enclosure[], heightAt?: City3dHeight, key = 'w'): PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  const g = (p: Point): number => (heightAt ? heightAt(p.x, p.y) : 0) || 0;
  const push = (b: PlacedBuilding | undefined): void => { if (b) out.push(b); };
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
      if (t.shape === 'round' && wall && ROUND_ROOFED.has(style) && t.kind !== 'flank') mesh.cone(ring, z, 1.4 * t.radius_m, mat('tile'));
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
        else if (style === 'wengcheng') mesh.pitched(gh.shape, zTop, 3.5, mat('tile'));
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
      mesh.pitched(a.shape, eave, 1.6, mat('tile'));
      push(wallPiece(`${id}:lean-to:${ai}`, `${style}:lean-to`, mesh, 'plain'));
    });
  });
  return out;
}
