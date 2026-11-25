import type { Point, Vertex3 } from '../../../rust/bridge/housesContract';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { OverviewVolume } from './urbanBuildingGeometry';
import { hash, type Programme } from './city3d/massing';
import { LIT_WINDOW, OPENING } from './city3d/materials';
import { RoofBuilder, ringArea } from './city3d/roofGeometry';

const slate = 'city3d:cover:slate@565e72';
const copper = 'city3d:cover:metal@64807b';
const bronze = 'city3d:cover:metal@9b8154';
const limestone = 'city3d:wall:ashlar@c1b69f';
const glass = 'city3d:wall:glass@586f7a';
const cache = new WeakMap<PlacedBuilding, PlacedBuilding>();

/** A brass meridian above the observatory spindle. Its strip has a diamond cross-section. */
function meridian(mesh: RoofBuilder, centre: Point, z: number, radius: number, bearing: number, width: number) {
  const at = (angle: number, radial: number, sideways: number): Vertex3 => {
    const u = (radius + radial) * Math.cos(angle);
    return { x: centre.x + Math.cos(bearing) * u - Math.sin(bearing) * sideways, y: centre.y + Math.sin(bearing) * u + Math.cos(bearing) * sideways, z: z + (radius + radial) * Math.sin(angle) };
  };
  const tube = (i: number) => {
    const a = (i * Math.PI) / 8;
    return [at(a, width, 0), at(a, 0, width), at(a, -width, 0), at(a, 0, -width)];
  };
  for (let i = 0; i < 16; i++) {
    const a = tube(i),
      b = tube(i + 1);
    for (let j = 0; j < 4; j++) mesh.face([a[j], b[j], b[(j + 1) % 4], a[(j + 1) % 4]], bronze);
  }
}

/** Only the authored, round wizard shafts have this cone and sixteen-sided plan in the city massing.
 * Keeps, libraries and other monuments keep every tower. Other cone roofs and neighbouring wings keep their geometry. */
function reshape(v: OverviewVolume, b: PlacedBuilding, landmark: boolean): OverviewVolume {
  if (v.displayRoofForm !== 'cone' || v.wall_height_m <= 8 || v.footprint.length !== 1) return v;
  const shape = v.footprint[0],
    source = shape.outer;
  if (source.length !== 16 || shape.holes.length || v.stiltHeight_m) return v;
  const seed = hash(v.id),
    keep = landmark || seed % 5 === 0;
  const centre = source.reduce((p, q) => ({ x: p.x + q.x / source.length, y: p.y + q.y / source.length }), { x: 0, y: 0 });
  const radii = source.map(p => Math.hypot(p.x - centre.x, p.y - centre.y)),
    radius = Math.min(...radii);
  if (radius < 1.1 || radius < Math.max(...radii) * 0.85) return v;
  const originalMesh = v.roof_mesh;
  const openings = originalMesh.faces.filter(f => f.material === OPENING || f.material === LIT_WINDOW);
  const hasDoor = openings.some(f => f.vertices.some(i => Math.abs(originalMesh.vertices[i].z - v.z_m) < 0.15));
  // In the common narrow shafts no original facet was wide enough for a doorway. Give these studios eight
  // longer walls. When a door exists keep its wall plane, width, sill, head and orientation exactly.
  const ring = !hasDoor && (!keep || radius < 2.95) ? source.filter((_, i) => i % 2 === 0) : source;
  const shell = ringArea(ring) < 0 ? [...ring].reverse() : ring;
  const footprint = ring === source ? v.footprint : [{ outer: ring, holes: [] }];
  const wall = keep ? v.wall_height_m : Math.min(v.wall_height_m, 3.25 + 0.32 * ((seed >>> 9) % 5));
  const eave = v.z_m + wall,
    mesh = new RoofBuilder();
  const metal = seed & 16 ? copper : slate;
  const at = (i: number, scale: number, h: number): Vertex3 => {
    const p = shell[i % shell.length];
    return { x: centre.x + (p.x - centre.x) * scale, y: centre.y + (p.y - centre.y) * scale, z: eave + h };
  };
  const band = (lo: number, hi: number, h0: number, h1: number, mat: string, alternating = mat) => {
    for (let i = 0; i < shell.length; i++) {
      const a = at(i, lo, h0),
        b = at(i + 1, lo, h0),
        c = at(i + 1, hi, h1);
      mesh.face(hi === 0 ? [a, b, c] : [a, b, c, at(i, hi, h1)], i % 2 ? mat : alternating);
    }
  };
  const collar = (scale: number, h: number, height: number, mat: string) => band(scale, scale, h, h + height, mat);
  let rise: number;
  if (!keep) {
    // A low reading lantern or a faceted copper studio dome.
    band(1, 0.965, 0, 0.14, limestone);
    if (seed & 8) {
      const shoulder = radius * 0.31,
        crown = shoulder + 0.49;
      band(0.965, 0.5, 0.14, shoulder, slate);
      collar(0.5, shoulder, 0.49, glass);
      for (let i = 0; i < shell.length; i++) {
        const a = at(i, 0.507, shoulder),
          b = at(i + 1, 0.507, shoulder);
        const p = { x: a.x + (b.x - a.x) * 0.12, y: a.y + (b.y - a.y) * 0.12, z: a.z };
        mesh.face([a, p, { ...p, z: p.z + 0.49 }, { ...a, z: a.z + 0.49 }], bronze);
      }
      rise = crown + radius * 0.21;
      band(0.514, 0, crown, rise, metal);
    } else {
      rise = radius * 0.49 + 0.22;
      band(0.965, 0.82, 0.14, rise * 0.5, metal);
      band(0.82, 0.53, rise * 0.5, rise * 0.81, metal);
      band(0.53, 0.19, rise * 0.81, rise * 0.97, metal);
      band(0.19, 0, rise * 0.97, rise, bronze);
    }
  } else if (seed & 8) {
    // Faceted observatory drum under a shallow hemisphere; the spindle carries crossed meridians.
    const shoulder = radius * 0.62,
      top = shoulder + radius * 0.71;
    band(1, 0.77, 0, shoulder * 0.57, slate);
    collar(0.77, shoulder * 0.57, shoulder * 0.43, limestone);
    band(0.77, 0.66, shoulder, shoulder + radius * 0.35, copper);
    band(0.66, 0.4, shoulder + radius * 0.35, shoulder + radius * 0.6, copper);
    band(0.4, 0.09, shoulder + radius * 0.6, top, copper);
    const globe = Math.min(1.44, radius * 0.345),
      spindle = top + globe * 0.35;
    band(0.09, 0.044, top, spindle, bronze);
    band(0.044, 0.019, spindle, spindle + globe * 2.1, bronze);
    meridian(mesh, centre, eave + spindle + globe, globe, (seed >>> 9) * 0.031, globe * 0.065);
    meridian(mesh, centre, eave + spindle + globe, globe * 0.93, (seed >>> 9) * 0.031 + Math.PI / 2, globe * 0.055);
    rise = spindle + globe * 2.1;
  } else {
    // An octagonal lantern and a concave slate needle, with bronze at the changes of pitch.
    const shoulder = radius * 0.67,
      lantern = shoulder + Math.min(1.93, radius * 0.47);
    rise = lantern + radius * (1.21 + 0.12 * ((seed >>> 4) % 3));
    band(1, 0.57, 0, shoulder, metal);
    collar(0.57, shoulder, lantern - shoulder, limestone);
    for (let i = 0; i < shell.length; i += 2) {
      const p = at(i, 0.577, shoulder + 0.12),
        q = at(i + 1, 0.577, shoulder + 0.12);
      const tip = at(i, 0.577, lantern - 0.1);
      mesh.face([p, q, { ...q, z: tip.z - 0.19 }, { x: (p.x + q.x) * 0.5, y: (p.y + q.y) * 0.5, z: tip.z }, { ...p, z: tip.z - 0.19 }], glass);
    }
    band(0.578, 0.6, lantern - 0.1, lantern, bronze);
    band(0.6, 0.28, lantern, lantern + (rise - lantern) * 0.3, metal);
    band(0.28, 0.063, lantern + (rise - lantern) * 0.3, rise - 0.45, metal);
    band(0.063, 0, rise - 0.45, rise, bronze);
  }
  const roofEnd = mesh.faces.length;
  // Source openings up to the new eave survive unsquashed. Doorless source shafts receive a door on the
  // facet nearest the lot access, preserving the same access in detail, picking and the frontage fitter.
  for (const f of openings) {
    const pts = f.vertices.map(i => originalMesh.vertices[i]);
    if (ring === source && pts.every(p => p.z <= eave - 0.08)) mesh.face(pts, f.material);
  }
  const facets = shell.map((a, i) => {
    const end = shell[(i + 1) % shell.length],
      dx = end.x - a.x,
      dy = end.y - a.y,
      len = Math.hypot(dx, dy);
    const pos = { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2 };
    return { len, ux: dx / len, uy: dy / len, pos, distance: b.entrance ? Math.hypot(pos.x - b.entrance.x, pos.y - b.entrance.y) : 0 };
  });
  const doorSide = facets.reduce((closest, f) => (f.distance < closest.distance ? f : closest));
  const panel = (f: typeof doorSide, width: number, z0: number, z1: number, mat: string) => {
    const at = (u: number, z: number): Vertex3 => ({ x: f.pos.x + u * f.ux + 0.042 * f.uy, y: f.pos.y + u * f.uy - 0.042 * f.ux, z: v.z_m + z });
    mesh.face([at(-width / 2, z0), at(width / 2, z0), at(width / 2, z1), at(-width / 2, z1)], mat);
  };
  if (!hasDoor) panel(doorSide, Math.min(1.06, doorSide.len * 0.91), 0.024, 2.1, OPENING);
  if (!keep)
    for (const [i, f] of facets.entries()) {
      if (i % 2 === 0 || f === doorSide || f.len < 1.11) continue;
      panel(f, Math.min(1.07, f.len * 0.56), 1.04, 2.39, glass);
    }
  const materials = { ...v.materials, cladding: metal };
  return {
    ...v,
    footprint,
    levels: v.levels.filter(l => l.z_m < eave).map(l => ({ ...l, footprint: ring === source ? l.footprint : footprint, height_m: Math.min(l.height_m, eave - l.z_m) })),
    wall_height_m: wall,
    roof_height_m: rise,
    materials,
    roof_mesh: mesh.mesh(),
    displayRoofForm: keep ? 'cone' : 'dome',
    overview_roof_faces: [0, roofEnd],
    overview_faces: undefined,
  };
}

export function craftedMageCity(building: PlacedBuilding): PlacedBuilding {
  if (building.culture?.culture !== 'wizard-city') return building;
  const cached = cache.get(building);
  if (cached) return cached;
  const landmark = !!(building as PlacedBuilding & { programme?: Programme }).programme?.landmark;
  const volumes = (building.volumes as OverviewVolume[]).map(v => reshape(v, building, landmark));
  const result = volumes.some((v, i) => v !== building.volumes[i]) ? { ...building, volumes } : building;
  cache.set(building, result);
  cache.set(result, result);
  return result;
}
