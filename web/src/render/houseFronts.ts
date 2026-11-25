import type { Point } from '../../../rust/bridge/housesContract';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { OverviewVolume } from './urbanBuildingGeometry';
import type { RoofMesh } from './city3d/types';
import { hash } from './city3d/massing';
import { inRing, ringArea } from './city3d/roofGeometry';
import { OPENING, LIT_WINDOW } from './city3d/materials';
import { architectureUse, fittedSiteFront, type SiteBuilding } from './siteArchitecture';
import { buildHouseFront, type FrontDesign, type FrontFrame, type FrontDimensions } from './houseFrontKit';
import { historicFronts } from './houseHistoricFronts';
import { vernacularFronts } from './houseVernacularFronts';
import { legendFronts } from './houseLegendFronts';
import { skylineFronts } from './houseSkylineFronts';
import { mushroomGrower } from './houseModernFronts';
import { streetPorches } from './houseStreetPorches';
import { elvenGallerySite } from './craftedElvenTree';
import { maoriGables } from './houseMaoriGable';

export const cultureHouseFronts: Readonly<Record<string, FrontDesign>> = { ...historicFronts, ...vernacularFronts, ...legendFronts, ...streetPorches, ...skylineFronts };
type Fit = FrontFrame & Pick<FrontDimensions, 'width' | 'depth' | 'height' | 'eave' | 'doorWidth' | 'doorHeight' | 'hasGableDoor' | 'windows'>;
interface Front {
  volume: OverviewVolume;
  mesh: RoofMesh;
  frame: Fit;
}
const cache = new WeakMap<PlacedBuilding, Front | null>();

/** Rectangle/ring intersection in facade axes, including a concave ring enclosing the proposal. */
function intersects(ring: readonly Point[], f: Fit, near: number): boolean {
  const w = f.width / 2,
    d = (f.depth - near) / 2,
    mid = (near + f.depth) / 2;
  const local = ring.map(p => {
    const x = p.x - f.x,
      y = p.y - f.y;
    return { x: x * f.ny - y * f.nx, y: x * f.nx + y * f.ny - mid };
  });
  if (inRing(local, { x: 0, y: 0 })) return true;
  return local.some((a, i) => {
    const b = local[(i + 1) % local.length];
    if (Math.min(a.x, b.x) > w || Math.max(a.x, b.x) < -w || Math.min(a.y, b.y) > d || Math.max(a.y, b.y) < -d) return false;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    return Math.abs(a.x * dy - a.y * dx) <= w * Math.abs(dy) + d * Math.abs(dx) + 1e-8;
  });
}
function fits(building: PlacedBuilding, v: OverviewVolume, host: Point[], f: Fit) {
  if (intersects(host, f, 0.055)) return false;
  if (building.footprint.some(s => s.holes.some(r => intersects(r, f, 0.02))) || building.courtyards?.some(s => intersects(s.outer, f, 0.02))) return false;
  return !building.volumes.some(s => s !== v && s.z_m < f.z + f.height && s.z_m + s.wall_height_m + s.roof_height_m > f.z + 0.1 && s.footprint.some(p => intersects(p.outer, f, 0.02)));
}

/** Measure the same quads the renderer uses for the leaf and glass. Their first
 * edge is the sill, including the source's four-centimetre reveal. */
function facadeOpenings(v: OverviewVolume) {
  return (v.roof_mesh?.faces ?? []).flatMap(face => {
    const marked = !!(face as { entrance?: true }).entrance;
    if (face.vertices.length !== 4 || (!marked && face.material !== OPENING && face.material !== LIT_WINDOW && face.material !== 'city3d:wall:wood@393126')) return [];
    const [a, b, c, d] = face.vertices.map(i => v.roof_mesh.vertices[i]);
    const width = Math.hypot(b.x - a.x, b.y - a.y);
    if (width < 0.15 || Math.abs(a.z - b.z) > 0.06 || Math.abs(c.z - d.z) > 0.06 || c.z - a.z < 0.25) return [];
    return [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, bottom: a.z, top: c.z, width, ux: (b.x - a.x) / width, uy: (b.y - a.y) / width, door: marked || (Math.abs(a.z - v.z_m) < 0.17 && c.z - a.z > 0.55) }];
  });
}

function frontage(building: PlacedBuilding, v: OverviewVolume, seed: number, dwelling: boolean): Fit | undefined {
  const tree = v.displayTree;
  if (tree) return elvenGallerySite(tree, v.z_m);
  const shape = v.levels?.[0]?.footprint?.[0] ?? v.footprint[0],
    ring = shape?.outer;
  if (!ring || ring.length < 3) return;
  const winding = Math.sign(ringArea(ring)),
    cx = ring.reduce((n, p) => n + p.x, 0) / ring.length,
    cy = ring.reduce((n, p) => n + p.y, 0) / ring.length;
  const radii = ring.map(p => Math.hypot(p.x - cx, p.y - cy));
  const round = ring.length >= 8 && Math.min(...radii) > 0.77 * Math.max(...radii);
  const openings = facadeOpenings(v),
    lot = building.entrance;
  const doors = openings.filter(o => o.door).sort((a, b) => (lot ? Math.hypot(a.x - lot.x, a.y - lot.y) - Math.hypot(b.x - lot.x, b.y - lot.y) : 0));
  const target = lot ?? { x: cx, y: cy };
  const maori = dwelling && building.culture?.culture === 'maori-pa' && v.displayRoofForm === 'gable';
  const ends = maori ? maoriGables(v, ring) : [];
  if (dwelling && building.culture?.culture === 'maori-pa' && !ends.length) return;
  const edges = ring
    .map((a, i) => {
      const b = ring[(i + 1) % ring.length],
        len = Math.hypot(b.x - a.x, b.y - a.y) || 0.001,
        ux = (b.x - a.x) / len,
        uy = (b.y - a.y) / len;
      const nx = winding * uy,
        ny = -winding * ux;
      const onEdge = (p: (typeof openings)[number]) => {
        const along = (p.x - a.x) * ux + (p.y - a.y) * uy;
        return Math.abs(ux * p.ux + uy * p.uy) > 0.985 && along >= -0.02 && along <= len + 0.02 && Math.abs((p.x - a.x) * nx + (p.y - a.y) * ny - 0.04) < 0.13;
      };
      const door = doors.find(onEdge);
      const aim = door ?? target;
      const station = (aim.x - a.x) * ux + (aim.y - a.y) * uy;
      const along = Math.max(0, Math.min(len, station)),
        gap = Math.hypot(target.x - a.x - along * ux, target.y - a.y - along * uy);
      const end = ends.find(([p, q]) => p === a && q === b);
      return { a, len, ux, uy, nx, ny, station, gap, end, door, onEdge };
    })
    .sort((a, b) => Number(!!b.door) - Number(!!a.door) || a.gap - b.gap || b.len - a.len);
  for (const e of edges) {
    if (ends.length && !e.end) continue;
    const door = e.door;
    if (!dwelling && !door) continue;
    if (doors.length && !door && !e.end) continue;
    const station = e.end ? e.len / 2 : door ? e.station : round ? e.len / 2 : Math.min(e.len - 0.72, Math.max(0.72, e.station));
    // Never move a surround away from its door to make a wide porch fit. Try a narrower
    // porch or another real entrance; rounded dwellings may span adjoining recessed facets.
    const span = round ? Math.min(...radii) * 1.52 : e.end ? e.len - 0.1 : door ? 2 * Math.min(station, e.len - station) - 0.02 : e.len - 0.14;
    const width = e.end ? span : Math.min((building.culture?.culture === 'giant-hold' ? 10.1 : 6.4) + (seed % 7) * 0.13, span);
    const minWidth = door ? Math.max(1.2, door.width + 0.11) : 1.45;
    if (width < minWidth) continue;
    const shelterRoof = building.culture?.culture === 'inuit-camp' || building.culture?.culture === 'native-plains';
    const z = door && !e.end ? door.bottom : v.z_m;
    const height = e.end ? e.end[2].z - z : shelterRoof ? Math.min(2.45, (v.wall_height_m + v.roof_height_m) * 0.74) : Math.min(v.z_m + v.wall_height_m - z, 8.8);
    if (height < 0.55) continue;
    for (const scale of e.end ? [1] : [1, 0.7]) {
      const w = width * scale;
      if (w < minWidth) continue;
      const s = e.end || door || round ? station : Math.min(e.len - w / 2, Math.max(w / 2, station));
      const x = e.a.x + e.ux * s,
        y = e.a.y + e.uy * s;
      const windows = openings.filter(o => !o.door && e.onEdge(o)).map(o => ({ x: (o.x - x) * e.ny - (o.y - y) * e.nx, bottom: o.bottom - z, top: o.top - z, width: o.width }));
      if (e.end) {
        // Both side walls continue forward. Protect every off-centre door and window beside them.
        const sideClear = w / 2 - Math.min(0.19, w * 0.0425) * 1.19;
        if (openings.some(o => e.onEdge(o) && Math.abs((o.x - x) * e.ny - (o.y - y) * e.nx) + o.width / 2 + 0.035 > sideClear)) continue;
        if (!door && windows.some(o => Math.abs(o.x) < o.width / 2 + 0.63 && o.bottom < 1.8)) continue;
      }
      const aligned = door && !e.end;
      const frame = {
        x,
        y,
        z,
        nx: e.nx,
        ny: e.ny,
        eave: e.end ? v.wall_height_m : undefined,
        hasGableDoor: !!e.end && !!door,
        width: w,
        depth: Math.min(2.48, Math.max(0.74, w * 0.42)) * scale,
        height,
        doorWidth: aligned ? door.width : undefined,
        doorHeight: aligned ? door.top - z : undefined,
        windows,
      };
      if (fits(building, v, ring, frame)) return frame;
    }
  }
}

export function detailedHouseFront(building: PlacedBuilding): Front | null {
  const known = cache.get(building);
  if (known !== undefined) return known;
  const site: SiteBuilding = building;
  const use = architectureUse(site);
  const culture = building.culture?.culture ?? '';
  const regional = cultureHouseFronts[culture];
  const design = site.programme?.fungalFarm ? mushroomGrower : use && regional && fittedSiteFront(use, culture, regional);
  let front: Front | null = null;
  if (design) {
    const seed = hash(building.id) >>> 0;
    const hosts = (building.volumes as OverviewVolume[])
      .filter(v => v.role !== 'minor' && v.footprint.length && (v.wall_height_m >= 0.6 || ((culture === 'native-plains' || culture === 'inuit-camp') && v.wall_height_m + v.roof_height_m >= 0.73)))
      .map(volume => ({ volume, area: Math.abs(ringArea(volume.footprint[0].outer)) }))
      .sort((a, b) => b.area - a.area);
    for (const { volume: v } of hosts) {
      const f = frontage(building, v, seed, use === 'home' || !!site.programme?.fungalFarm);
      if (!f) continue;
      const mesh = buildHouseFront(f, { ...f, floor: v.stiltHeight_m ? Math.max(0, v.stiltHeight_m + f.z - v.z_m) : 0, seed, wall: v.materials.coating, cover: v.materials.cladding }, design);
      if (mesh.faces.length) {
        front = { volume: v, mesh, frame: f };
        break;
      }
    }
  }
  cache.set(building, front);
  return front;
}
