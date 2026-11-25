import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { Point } from '../../../rust/bridge/housesContract';
import { netPolygonArea, polygonArea, polygonContains } from '../gen/core/geom';
import { roleFamily } from './city/planLook';
import { OPENING, LIT_WINDOW } from './city3d/materials';
import type { BuildingTriangle, BuildingVector, OverviewVolume } from './urbanBuildingGeometry';

const CULTURES = new Set(['indian-temple', 'dravidian-temple', 'rajput-fort', 'south-asian-metropolis']);
const tile = 'city3d:cover:tile@a56c52',
  wood = 'city3d:wall:timber@765642';
const stone = 'city3d:wall:stone@c4a075',
  capstone = 'city3d:wall:stone@b18d68';
const cream = 'city3d:wall:plaster@d0bda1',
  concrete = 'city3d:wall:concrete@b8b2a5';
const shutter = 'city3d:wall:wood@675e4e';
type V = BuildingVector;
type Emit = (face: BuildingTriangle) => void;
interface Rect {
  l: number;
  r: number;
  back: number;
  front: number;
}
interface Frame {
  a: Point;
  x: number;
  y: number;
  nx: number;
  ny: number;
  length: number;
}
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const local = (f: Frame, p: Point): Point => ({ x: (p.x - f.a.x) * f.x + (p.y - f.a.y) * f.y, y: (p.x - f.a.x) * f.nx + (p.y - f.a.y) * f.ny });
const rectangle = (l: number, r: number, back: number, front: number): Point[] => [
  { x: l, y: back },
  { x: r, y: back },
  { x: r, y: front },
  { x: l, y: front },
];

function frameForEdge(a: Point, b: Point, winding: number): Frame {
  const length = Math.hypot(b.x - a.x, b.y - a.y),
    x = (b.x - a.x) / (length || 1),
    y = (b.y - a.y) / (length || 1);
  return { a, x, y, nx: winding * y, ny: -winding * x, length };
}
interface Aperture {
  center: Point;
  foot: number;
  head: number;
  door: boolean;
}
function openings(v: OverviewVolume): Aperture[] {
  const result: Aperture[] = [];
  for (const face of v.roof_mesh.faces) {
    if (face.vertices.length !== 4 || (face.material !== OPENING && face.material !== LIT_WINDOW)) continue;
    const [a, b, c] = face.vertices.map(i => v.roof_mesh.vertices[i]);
    if (Math.abs(a.z - b.z) > 0.03 || c.z - a.z < 0.4) continue;
    result.push({ center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, foot: a.z - v.z_m, head: c.z - v.z_m, door: !!(face as { entrance?: true }).entrance || Math.abs(a.z - v.z_m) < 0.16 });
  }
  return result;
}

/** Oriented rectangle versus any closed ring, including concave footprints. The
 * separating axes of each segment and the rectangle catch edges crossing between
 * sampled corners, small holes, and siblings wholly contained by the proposal. */
function crossing(poly: Point[], box: Rect): boolean {
  const cx = (box.l + box.r) * 0.5,
    cy = (box.back + box.front) * 0.5,
    w = (box.r - box.l) * 0.5,
    d = (box.front - box.back) * 0.5;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    if (Math.max(a.x, b.x) < box.l || Math.min(a.x, b.x) > box.r || Math.max(a.y, b.y) < box.back || Math.min(a.y, b.y) > box.front) continue;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    if (Math.abs((a.x - cx) * dy - (a.y - cy) * dx) <= w * Math.abs(dy) + d * Math.abs(dx) + 1e-8) return true;
  }
  return false;
}
function touches(poly: Point[], box: Rect): boolean {
  return crossing(poly, box) || polygonContains(poly, { x: (box.l + box.r) / 2, y: (box.back + box.front) / 2 });
}

/** All proposed parts use one facade frame. Polygons are convex; four faces are
 * enough for a plinth or lean-to, while the jharokha uses a clipped front plan. */
function builder(v: OverviewVolume, f: Frame, emit: Emit) {
  const world = ([s, d, z]: V): V => [f.a.x + s * f.x + d * f.nx, f.a.y + s * f.y + d * f.ny, v.z_m + z];
  const flip = f.x * f.ny - f.y * f.nx < 0;
  const face = (localPoints: V[], material: string) => {
    const points = localPoints.map(world);
    if (flip) points.reverse();
    const a = points[0];
    for (let i = 1; i + 1 < points.length; i++) {
      const b = points[i],
        c = points[i + 1],
        x = b[0] - a[0],
        y = b[1] - a[1],
        z = b[2] - a[2],
        dx = c[0] - a[0],
        dy = c[1] - a[1],
        dz = c[2] - a[2];
      const normal: V = [y * dz - z * dy, z * dx - x * dz, x * dy - y * dx],
        length = Math.hypot(...normal);
      if (length < 1e-8) continue;
      emit({ points: [a, b, c], normal: [normal[0] / length, normal[1] / length, normal[2] / length], surface: 'roof', material, materials: v.materials });
    }
  };
  const loft = (bottom: Point[], top: Point[], z0: number, z1: number, material: string, underside = false) => {
    for (let i = 0; i < bottom.length; i++) {
      const j = (i + 1) % bottom.length,
        a = bottom[i],
        b = bottom[j],
        c = top[j],
        d = top[i];
      face(
        [
          [a.x, a.y, z0],
          [b.x, b.y, z0],
          [c.x, c.y, z1],
          [d.x, d.y, z1],
        ],
        material,
      );
    }
    face(
      top.map(({ x, y }) => [x, y, z1]),
      material,
    );
    if (underside) face(bottom.map(({ x, y }): V => [x, y, z0]).reverse(), material);
  };
  const box = (l: number, r: number, b: number, d: number, z0: number, z1: number, material: string, under = false) => {
    if (r <= l || d <= b || z1 <= z0) return;
    const ring = rectangle(l, r, b, d);
    loft(ring, ring, z0, z1, material, under);
  };
  return { face, loft, box };
}
type Builder = ReturnType<typeof builder>;

function porch(g: Builder, box: Rect, station: number, head: number, v: OverviewVolume, style: string) {
  const tamil = style === 'dravidian-temple',
    modern = style === 'south-asian-metropolis',
    desert = style === 'rajput-fort';
  const { l, r, front } = box,
    d = front - 0.26,
    postD = d - 0.18;
  const plinth = tamil ? 0.32 : 0.24,
    top = Math.min(v.wall_height_m - 0.03, head + 0.77),
    low = modern ? top - 0.12 : top - Math.min(0.78, d * 0.34);
  const base = modern ? concrete : desert ? stone : cream,
    pillar = modern ? concrete : desert ? stone : wood;
  g.box(l + 0.13, r - 0.13, 0.018, d + 0.03, 0.005, plinth, base);
  const step = Math.min(0.72, station - l - 0.12, r - station - 0.12);
  if (step > 0.26) g.box(station - step, station + step, d + 0.035, front, 0, 0.13, base);
  const n = r - l > 5.1 ? 3 : 2,
    left = l + 0.35,
    right = r - 0.35;
  for (let i = 0; i < n; i++) {
    const s = left + (i * (right - left)) / (n - 1);
    if (i > 0 && i < n - 1 && Math.abs(s - station) < 0.72) continue;
    const foot = rectangle(s - 0.19, s + 0.19, postD - 0.19, postD + 0.19);
    const shaft = rectangle(s - 0.095, s + 0.095, postD - 0.095, postD + 0.095);
    g.loft(foot, foot, plinth, plinth + 0.16, base);
    g.loft(shaft, shaft, plinth + 0.16, low - 0.26, pillar);
    g.loft(shaft, rectangle(s - 0.23, s + 0.23, postD - 0.13, postD + 0.13), low - 0.26, low - 0.13, pillar);
  }
  g.box(l + 0.12, r - 0.12, postD - 0.13, postD + 0.13, low - 0.14, low + 0.035, pillar, true);
  if (tamil) {
    // A thinnai is occupied space: a raised seat on either side of the entry.
    g.box(l + 0.2, station - 0.64, 0.09, 0.61, plinth, plinth + 0.37, cream);
    g.box(station + 0.64, r - 0.2, 0.09, 0.61, plinth, plinth + 0.37, cream);
  }
  if (modern || desert) {
    g.box(l, r, 0, d + 0.16, low + 0.02, top, modern ? concrete : capstone, true);
  } else {
    // The short hipped returns let the separate tiled roof read from the plan and the street.
    const hip = Math.min(0.82, (r - l) * 0.2),
      back = 0.005,
      lip = d + 0.15;
    g.face(
      [
        [l + hip, back, top],
        [r - hip, back, top],
        [r, lip, low],
        [l, lip, low],
      ],
      tile,
    );
    g.face(
      [
        [l, back, low + 0.08],
        [l + hip, back, top],
        [l, lip, low],
      ],
      tile,
    );
    g.face(
      [
        [r - hip, back, top],
        [r, back, low + 0.08],
        [r, lip, low],
      ],
      tile,
    );
    g.box(l, r, lip - 0.1, lip, low - 0.095, low, wood, true);
  }
}

// Stone corbels carry a splayed, shaded bay. The spaces between its shafts are
// open so the actual upper window stays visible behind the balcony.
function jharokha(g: Builder, box: Rect, foot: number, head: number) {
  const { l, r, front } = box,
    d = front - 0.12,
    cut = Math.min(0.38, (r - l) * 0.17);
  const plan = (pad: number): Point[] => [
    { x: l - pad, y: 0.007 },
    { x: r + pad, y: 0.007 },
    { x: r + pad, y: d - cut },
    { x: r - cut + pad, y: d + pad },
    { x: l + cut - pad, y: d + pad },
    { x: l - pad, y: d - cut },
  ];
  const z = foot - 0.28,
    roof = head + 0.27;
  for (const s of [l + 0.35, r - 0.35]) {
    g.loft(rectangle(s - 0.14, s + 0.14, 0.01, 0.17), rectangle(s - 0.2, s + 0.2, 0.01, d * 0.79), z - 0.57, z - 0.09, stone, true);
  }
  g.loft(plan(0.025), plan(0.07), z - 0.1, z + 0.055, capstone, true);
  g.loft(plan(-0.03), plan(-0.03), z + 0.055, z + 0.46, stone);
  for (const p of plan(-0.12).slice(2)) {
    g.box(p.x - 0.065, p.x + 0.065, p.y - 0.065, p.y + 0.065, z + 0.46, roof - 0.15, stone);
    g.loft(rectangle(p.x - 0.065, p.x + 0.065, p.y - 0.065, p.y + 0.065), rectangle(p.x - 0.14, p.x + 0.14, p.y - 0.1, p.y + 0.1), roof - 0.15, roof, capstone);
  }
  g.loft(plan(0.11), plan(0.09), roof, roof + 0.13, capstone, true);
  // The rear stone weathering slopes towards the weather edge.
  const ledge = plan(0.055);
  const top = ledge.map(p => [p.x, p.y, roof + 0.16 + 0.22 * (1 - p.y / front)] as V);
  for (let i = 0; i < top.length; i++) {
    const j = (i + 1) % top.length;
    g.face([[ledge[i].x, ledge[i].y, roof + 0.13], [ledge[j].x, ledge[j].y, roof + 0.13], top[j], top[i]], stone);
  }
  g.face(top, stone);
}

function balcony(g: Builder, b: Rect, bottom: number, top: number) {
  const { l, r, front } = b,
    inner = 0.015,
    d = front - 0.09;
  g.box(l, r, inner, front, bottom - 0.16, bottom, concrete, true);
  g.box(l + 0.055, r - 0.055, d - 0.1, d, bottom, bottom + 0.84, cream);
  g.box(l + 0.055, l + 0.18, inner, d, bottom, bottom + 0.84, cream);
  g.box(r - 0.2, r - 0.055, inner, d, bottom, top - 0.08, cream);
  g.box(l + 0.12, l + 0.27, d - 0.19, d - 0.04, bottom + 0.84, top - 0.08, concrete);
  g.box(l - 0.03, r + 0.03, inner, front + 0.025, top - 0.085, top + 0.075, concrete, true);
}

/** Stair enclosure on an actual flat rooftop. The doorway is a gap in the front
 * wall with a recessed leaf and the landing opens directly onto the terrace. */
function terraceRoom(g: Builder, b: Rect, z: number, modern: boolean, wall: string) {
  const { l, r, back, front } = b,
    t = 0.15,
    door = Math.min(1.04, (r - l) * 0.42),
    h = modern ? 2.25 : 2.12,
    s = l + 0.28;
  g.box(l, r, back, back + t, z, z + h, wall);
  g.box(l, l + t, back + t, front, z, z + h, wall);
  g.box(r - t, r, back + t, front, z, z + h, wall);
  g.box(l + t, s, front - t, front, z, z + h, wall);
  g.box(s + door, r - t, front - t, front, z, z + h, wall);
  g.box(s, s + door, front - t, front, z + 1.85, z + h, wall);
  g.box(s, s + door, front - t - 0.09, front - t - 0.055, z + 0.035, z + 1.84, shutter);
  g.box(l - 0.1, r + 0.1, back - 0.1, front + 0.13, z + h, z + h + 0.16, modern ? concrete : capstone, true);
}

interface Plan {
  frame: Frame;
  commands: Array<(g: Builder) => void>;
}
const plans = new WeakMap<PlacedBuilding, { v: OverviewVolume; plan: Plan } | null>();
function mainBody(b: PlacedBuilding): OverviewVolume | null {
  let main: OverviewVolume | null = null,
    best = 0;
  const ground = Math.min(...b.volumes.map(v => v.z_m));
  for (const v of b.volumes as OverviewVolume[]) {
    if (v.envelope === 'open' || v.role === 'minor' || v.stiltHeight_m || v.z_m > ground + 0.5 || v.wall_height_m < 2.4 || v.footprint.length !== 1) continue;
    const area = netPolygonArea(v.footprint[0].outer, v.footprint[0].holes);
    if (area > best && area >= 13) {
      main = v;
      best = area;
    }
  }

  return main;
}

function layingOut(building: PlacedBuilding, v: OverviewVolume): Plan | undefined {
  const culture = building.culture?.culture;

  const role = (building as PlacedBuilding & { programme?: { role?: string } }).programme?.role;
  if (roleFamily(role, building.function) !== 'dwelling') return;
  let seed = 2166136261;
  for (const c of building.id) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  const shape = v.footprint[0],
    winding = Math.sign(polygonArea(shape.outer)),
    apertures = openings(v);
  const doors = apertures.filter(o => o.door);
  const entrance = building.entrance;
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  if (entrance) doors.sort((a, b) => distance(a.center, entrance) - distance(b.center, entrance));
  const entry = doors[0];
  const target = entry?.center ?? entrance;
  const frames = shape.outer.map((p, i) => frameForEdge(p, shape.outer[(i + 1) % shape.outer.length], winding)).filter(f => f.length >= 3.1);
  const miss = (f: Frame) => {
    if (!target) return -f.length;
    const p = local(f, target);
    return Math.hypot(p.y, p.x - clamp(p.x, 0, f.length));
  };
  frames.sort((a, b) => miss(a) - miss(b) || b.length - a.length);
  const f = frames[0];
  if (!f) return;
  const loc = (p: Point) => local(f, p);
  const host = shape.outer.map(loc);
  const holes = [...building.footprint.flatMap(s => s.holes), ...(building.courtyards ?? []).map(s => s.outer), ...shape.holes].map(h => h.map(loc));
  const others = building.volumes.filter(s => s !== v).map(s => ({ lo: s.z_m - v.z_m, hi: s.z_m + s.wall_height_m + s.roof_height_m - v.z_m, rings: s.footprint.map(q => q.outer.map(loc)) }));
  const blocked = (b: Rect, lo: number, hi: number) => holes.some(h => touches(h, b)) || others.some(o => o.lo < hi - 0.02 && o.hi > lo + 0.02 && o.rings.some(r => touches(r, b)));
  const clearOutside = (b: Rect, lo: number, hi: number) => !touches(host, b) && !blocked(b, lo, hi);
  const station = target ? clamp(loc(target).x, 0.6, f.length - 0.6) : f.length * (0.4 + (seed % 17) * 0.012);
  const modern = culture === 'south-asian-metropolis',
    desert = culture === 'rajput-fort';
  const upper = apertures.filter(o => !o.door && o.foot > 1.45 && o.head < v.wall_height_m - 0.24 && Math.abs(loc(o.center).y) < 0.12).sort((a, b) => a.foot - b.foot || Math.abs(loc(a.center).x - station) - Math.abs(loc(b.center).x - station))[0];
  const commands: Plan['commands'] = [];
  let bay = false;
  if (upper && (desert || modern)) {
    const center = loc(upper.center).x,
      w = Math.min(f.length - 0.48, (modern ? 3.55 : 2.15) + (seed % 4) * 0.19);
    const l = clamp(center - w / 2, 0.24, f.length - w - 0.24),
      d = modern ? 1.32 : 1.04,
      b = { l, r: l + w, back: 0.005, front: d };
    if (center > l + 0.23 && center < b.r - 0.23 && clearOutside({ ...b, l: l - 0.12, r: b.r + 0.12, front: d + 0.12 }, upper.foot - 0.83, upper.head + 0.48)) {
      commands.push(desert ? g => jharokha(g, b, upper.foot, upper.head) : g => balcony(g, b, upper.foot - 0.72, upper.head + 0.32));
      bay = true;
    }
  }
  if (!bay && target && miss(f) < (entry ? 0.17 : 1.2)) {
    const head = entry?.head ?? 1.98,
      w = Math.min(f.length - 0.36, (culture === 'dravidian-temple' ? 6.4 : 5.25) + (seed % 4) * 0.21);
    for (const scale of [1, 0.76]) {
      const span = Math.max(2.6, w * scale),
        l = clamp(station - span * 0.5, 0.15, f.length - span - 0.15);
      const d = (culture === 'dravidian-temple' ? 1.9 : modern ? 1.55 : 1.6) * scale + (seed % 3) * 0.08;
      const b = { l, r: l + span, back: 0.005, front: d + 0.2 };
      if (station < l + 0.32 || station > b.r - 0.32 || head > v.wall_height_m - 0.16 || !clearOutside(b, 0, head + 0.78)) continue;
      commands.push(g => porch(g, b, station, head, v, culture));
      break;
    }
  }
  // Preserve existing multi-storey silhouettes, courts, parapets and rooftop equipment.
  if ((!desert && !modern) || v.displayRoofForm !== 'flat' || f.length < 5.7 || (seed % 4 === 0 && !modern)) return { frame: f, commands };
  const eave = v.wall_height_m;
  const raised = v.roof_mesh.faces.filter(face => face.vertices.some(i => v.roof_mesh.vertices[i].z > v.z_m + eave + 0.13)).map(face => face.vertices.map(i => loc(v.roof_mesh.vertices[i])));
  const rw = modern ? 2.65 : 2.45,
    rd = modern ? 2.9 : 2.65;
  for (const frac of [seed & 1 ? 0.31 : 0.68, seed & 1 ? 0.68 : 0.31]) {
    const l = clamp(f.length * frac - rw * 0.5, 0.72, f.length - rw - 0.72),
      front = -(1.15 + (seed % 3) * 0.2);
    const b = { l, r: l + rw, back: front - rd, front };
    const reserve = { l: b.l - 0.17, r: b.r + 0.17, back: b.back - 0.17, front: b.front + 0.22 };
    if (!polygonContains(host, { x: l + rw / 2, y: front - rd / 2 }) || crossing(host, reserve) || blocked(reserve, eave, eave + 2.5) || raised.some(p => touches(p, reserve))) continue;
    commands.push(g => terraceRoom(g, b, eave + 0.012, modern, v.materials.coating));
    break;
  }
  return { frame: f, commands };
}

/** At most one frontage and one terrace room per domestic building. Placement
 * and collision results follow the same immutable building as its original mesh.
 * Cache dimensions and the accepted bays; triangles are streamed into the caller's batch. */
export function craftedIndianMassing(building: PlacedBuilding, volume: OverviewVolume, emit: Emit): void {
  if (!CULTURES.has(building.culture?.culture)) return;
  let saved = plans.get(building);
  if (saved === undefined) {
    const v = mainBody(building),
      plan = v && layingOut(building, v);
    saved = v && plan?.commands.length ? { v, plan } : null;
    plans.set(building, saved);
  }
  if (saved?.v !== volume) return;
  const g = builder(volume, saved.plan.frame, emit);
  for (const command of saved.plan.commands) command(g);
}
