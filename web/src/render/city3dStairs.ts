/** Stepped streets (role `stairs`, Rust `urban` network) as 3D flights for the town view. The ground tile keeps only a
 * plain strip under them (cityCanvas `stairMeshes`); the steps themselves are display meshes of the building pass
 * (ui/urbanBuilding3d.ts), built once per network and relief like the bridges and walls.
 *
 * Profile: the ground under the way (highest of its centre and both edges, so no tread sinks on a side slope) is
 * simplified to a few straight grades within STAIR_TOLERANCE_M; each grade becomes uniform steps whose riser follows the
 * comfort rule 2 risers + 1 tread = 0.63 m, clamped to STAIR_RISER_M. A flight of more than STAIR_FLIGHT_RISERS risers is
 * broken by landings, and every turn of the way is a level landing. A tread stands at the higher end of its riser, so the
 * top tread is the ground at the top end and the bottom one rises one riser from the ground at the bottom end: both
 * ends meet the surface of the street or lane they join. Each piece is a solid from its top down to a footing below the
 * ground, so its sides read as stone cheeks on the downhill side and nothing floats. */
import type { Layout, Point, Shape } from '../../../rust/bridge/urban';
import type { ArchitectureVolume, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { MaterialSlots } from '../../../rust/bridge/housesContract';
import { buildingTint } from './buildingPalette';
import { CITY3D_FOOTING_DEPTH_M, type City3dHeight } from './city3dMeshes';

/** Riser range, m: shallow stepped ramps (cordonata) to steep village stairs. */
export const STAIR_RISER_M = [0.1, 0.19] as const;
/** Most risers in one flight before a landing, and the landing depth, m. */
export const STAIR_FLIGHT_RISERS = 16,
  STAIR_LANDING_M = 1.2;
/** Largest gap between the ground and the simplified profile, m. */
export const STAIR_TOLERANCE_M = 0.1;
/** Below this grade (or less than half a riser of rise) a stretch is a sloped paved ramp, not steps. */
const RAMP_GRADE = 0.05;
/** A way turning by more than this angle turns on a level landing. */
const TURN_COS = Math.cos((30 * Math.PI) / 180);
const SAMPLE_M = 1;

/** Riser height (m) for a grade (rise over run), by the comfort rule 2r + t = 0.63 m with t = r / grade. */
export const stairRiser = (grade: number): number => Math.min(STAIR_RISER_M[1], Math.max(STAIR_RISER_M[0], 0.63 / (2 + 1 / Math.max(1e-6, grade))));

/** One piece of a flight along the way, between arc lengths s0 < s1: a level tread or landing (z0 = z1) or a sloped ramp. */
export interface StairPiece {
  s0: number;
  s1: number;
  z0: number;
  z1: number;
}

/** Pieces of a way of `length` metres. `ground(s)` is the ground under the way at arc length s; `turns` are the arc
 * lengths of its turning vertices; `width` sizes the turn landings. */
export function stairPieces(length: number, ground: (s: number) => number, turns: readonly number[], width: number): StairPiece[] {
  if (!(length > 0.2)) return [];
  const samples: { s: number; z: number }[] = [];
  const count = Math.max(2, Math.ceil(length / SAMPLE_M));
  for (let i = 0; i <= count; i++) {
    const s = (length * i) / count;
    samples.push({ s, z: ground(s) });
  }
  const highest = (a: number, b: number): number => Math.max(ground(a), ground(b), ...samples.filter(p => p.s > a && p.s < b).map(p => p.z));
  // Landings round the turns, merged when they touch, kept off the two ends.
  const landings: [number, number][] = [];
  const half = Math.max(0.6, width / 2, STAIR_LANDING_M / 2);
  for (const t of [...turns].sort((a, b) => a - b)) {
    const a = Math.max(0, t - half),
      b = Math.min(length, t + half),
      last = landings[landings.length - 1];
    if (last && a <= last[1]) last[1] = b;
    else landings.push([a, b]);
  }
  // Breakpoints of the profile: ends, landings (level at their highest ground), and the simplified grades between them.
  const knots: { s: number; z: number }[] = [];
  const grade = (a: { s: number; z: number }, b: { s: number; z: number }): void => {
    // Douglas-Peucker on the ground samples strictly between a and b; ground above the line (a sinking tread) counts
    // double, so the profile stays within half the tolerance below the ground.
    let worst = -1,
      gap = STAIR_TOLERANCE_M;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      if (p.s <= a.s + 1e-6 || p.s >= b.s - 1e-6) continue;
      const d = p.z - (a.z + ((b.z - a.z) * (p.s - a.s)) / (b.s - a.s)),
        weight = d > 0 ? 2 * d : -d;
      if (weight > gap) {
        gap = weight;
        worst = i;
      }
    }
    if (worst < 0) {
      knots.push(b);
      return;
    }
    grade(a, samples[worst]);
    grade(samples[worst], b);
  };
  let from = { s: 0, z: landings[0]?.[0] === 0 ? highest(0, landings[0][1]) : ground(0) };
  knots.push(from);
  for (const [a, b] of landings) {
    const z = highest(a, b);
    if (a > from.s + 1e-6) grade(from, { s: a, z });
    knots.push({ s: b, z });
    from = { s: b, z };
  }
  if (from.s < length - 1e-6) grade(from, { s: length, z: ground(length) });
  // Steps on each grade.
  const pieces: StairPiece[] = [];
  const push = (p: StairPiece): void => {
    const last = pieces[pieces.length - 1];
    if (last && last.z0 === last.z1 && p.z0 === p.z1 && Math.abs(last.z1 - p.z0) < 1e-9) last.s1 = p.s1;
    else pieces.push(p);
  };
  // Rounded to the comfort riser, never above the highest riser.
  const risers = (run: number, rise: number): number => Math.max(1, Math.round(Math.abs(rise) / stairRiser(Math.abs(rise) / run)), Math.ceil(Math.abs(rise) / STAIR_RISER_M[1] - 1e-9));
  /** Uniform steps from a to b, each tread at the higher end of its riser. */
  const flight = (a: { s: number; z: number }, b: { s: number; z: number }): void => {
    const n = risers(b.s - a.s, b.z - a.z),
      tread = (b.s - a.s) / n,
      riser = (b.z - a.z) / n;
    for (let j = 0; j < n; j++) {
      const z = a.z + riser * j,
        level = Math.max(z, z + riser);
      push({ s0: a.s + tread * j, s1: j === n - 1 ? b.s : a.s + tread * (j + 1), z0: level, z1: level });
    }
  };
  for (let k = 1; k < knots.length; k++) {
    const a = knots[k - 1],
      b = knots[k],
      run = b.s - a.s,
      rise = b.z - a.z;
    if (run < 1e-3) continue;
    if (Math.abs(rise) < STAIR_RISER_M[0] / 2 || Math.abs(rise) / run < RAMP_GRADE) {
      push({ s0: a.s, s1: b.s, z0: a.z, z1: b.z });
      continue;
    }
    const n = risers(run, rise);
    let flights = Math.ceil(n / STAIR_FLIGHT_RISERS);
    // Landings only where the remaining run still gives a walkable tread.
    if (run - (flights - 1) * STAIR_LANDING_M < n * 0.24) flights = 1;
    // A level landing on the grade stands at the line's height at its higher end (it never sinks into the slope);
    // the flights between landings share the run of the steps.
    const stepRun = run - (flights - 1) * STAIR_LANDING_M,
      line = (s: number): number => a.z + (rise * (s - a.s)) / run;
    let from = a;
    for (let f = 1; f < flights; f++) {
      const e = a.s + (stepRun * f) / flights + (f - 1) * STAIR_LANDING_M,
        z = Math.max(line(e), line(e + STAIR_LANDING_M));
      flight(from, { s: e, z });
      push({ s0: e, s1: e + STAIR_LANDING_M, z0: z, z1: z });
      from = { s: e + STAIR_LANDING_M, z };
    }
    flight(from, b);
  }
  return pieces;
}

// ---------------------------------------------------------------- meshes
type RoofMesh = ArchitectureVolume['roof_mesh'];
interface Way {
  points: Point[];
  cum: number[];
  normals: Point[];
  length: number;
}
function way(path: readonly Point[]): Way | undefined {
  const points: Point[] = [path[0]];
  for (const p of path.slice(1)) {
    const q = points[points.length - 1];
    if (Math.hypot(p.x - q.x, p.y - q.y) > 0.05) points.push(p);
  }
  if (points.length < 2) return undefined;
  const cum = [0],
    normals: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      l = Math.hypot(b.x - a.x, b.y - a.y);
    cum.push(cum[i - 1] + l);
    normals.push({ x: -(b.y - a.y) / l, y: (b.x - a.x) / l });
  }
  return { points, cum, normals, length: cum[cum.length - 1] };
}
/** Centre and left offset (unit normal, mitred on a vertex) at arc length s. */
function station(w: Way, s: number): { p: Point; n: Point } {
  let i = 0;
  while (i < w.normals.length - 1 && w.cum[i + 1] <= s) i++;
  const a = w.points[i],
    b = w.points[i + 1],
    t = (s - w.cum[i]) / (w.cum[i + 1] - w.cum[i]),
    n = w.normals[i];
  const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  // On a vertex the two sides meet on the bisector, scaled so the width stays the same (limited on sharp turns).
  const vertex = t < 1e-6 && i > 0 ? i : t > 1 - 1e-6 && i + 1 < w.normals.length ? i + 1 : -1;
  if (vertex < 0) return { p, n };
  const m = w.normals[vertex - 1],
    q = w.normals[vertex],
    bx = m.x + q.x,
    by = m.y + q.y,
    bl = Math.hypot(bx, by);
  if (bl < 1e-6) return { p, n };
  const k = Math.min(2, 1 / Math.max(0.5, (bx * q.x + by * q.y) / bl)) / bl;
  return { p, n: { x: bx * k, y: by * k } };
}

const hex6 = (t: readonly number[]): string =>
  t
    .map(v =>
      Math.max(0, Math.min(255, Math.round(v * 255)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

/** RGB of a CSS colour (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`), or undefined. */
function cssRgb(color: string): [number, number, number] | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(color)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}
/** A lighter tone of the same hue and saturation: HSL lightness raised by `lift`, capped below white. */
export function stairRiserTone(rgb: readonly number[], lift = 0.15): number[] {
  const [r, g, b] = rgb.map(v => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2,
    d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)),
    h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const L = Math.min(0.88, l + lift),
    c = (1 - Math.abs(2 * L - 1)) * s,
    x = c * (1 - Math.abs((h % 2) - 1)),
    m = L - c / 2;
  const [R, G, B] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [R + m, G + m, B + m].map(v => v * 255);
}

/** The stepped streets of the towns as one display building per flight. `heightAt` is the displayed ground before
 * exaggeration; the building pass lifts every vertex with the relief (ids `city3d-stairs`). `streetColor` is the CSS colour
 * the 3D ground paints the street in (cityCanvas `stairStreetColor`): the treads and ramps take it, the risers a lighter
 * tone of it, so a flight continues the street it prolongs; without it, the culture's stone. Cheeks stay in that stone. */
export function city3dStairs(layouts: readonly Layout[], heightAt?: City3dHeight, streetColor?: (street: Layout['streets'][number]) => string): PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  const h = (p: Point): number => (heightAt ? heightAt(p.x, p.y) : 0) || 0;
  layouts.forEach((layout, li) => {
    const stoneRgb = layout.culture ? buildingTint(layout.culture, 'stone', 'stone', 0.5, 'defence').wall.map(v => v * 255) : undefined;
    const stone = `city3d:wall:stone${stoneRgb ? `@${hex6(stoneRgb.map(v => v / 255))}` : ''}`;
    layout.streets.forEach((street, si) => {
      if (street.role !== 'stairs' || street.path.length < 2) return;
      // One colour per flight, chosen here: no per-frame work, two materials whatever the number of steps.
      const bed = (streetColor && cssRgb(streetColor(street))) ?? stoneRgb,
        tread = bed ? `city3d:road:stairs@${hex6(bed.map(v => v / 255))}` : 'city3d:road:stairs',
        riser = bed ? `city3d:road:stairs@${hex6(stairRiserTone(bed).map(v => v / 255))}` : 'city3d:road:stairs';
      const materials: MaterialSlots = { frame: stone, infill: stone, coating: stone, cladding: tread, base: stone, roof_frame: riser };
      const w = way(street.path);
      if (!w) return;
      const widths = street.widths.filter(v => Number.isFinite(v) && v > 0);
      const width = Math.max(1.2, widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : 2),
        half = width / 2;
      const turns: number[] = [];
      for (let i = 1; i < w.normals.length; i++) {
        const a = w.normals[i - 1],
          b = w.normals[i];
        if (a.x * b.x + a.y * b.y < TURN_COS) turns.push(w.cum[i]);
      }
      // The ground under the centre and both edges, read once every SAMPLE_M and interpolated: the profile and the
      // cheek footings share these samples (the terrain sampler is the cost of this pass).
      const count = Math.max(2, Math.ceil(w.length / SAMPLE_M)),
        rows: [number, number, number][] = [];
      for (let i = 0; i <= count; i++) {
        const { p, n } = station(w, (w.length * i) / count);
        rows.push([h(p), h({ x: p.x + n.x * half, y: p.y + n.y * half }), h({ x: p.x - n.x * half, y: p.y - n.y * half })]);
      }
      const sampled = (s: number, pick: (row: [number, number, number]) => number): number => {
        const t = Math.max(0, Math.min(count, (s / w.length) * count)),
          i = Math.min(count - 1, Math.floor(t));
        return pick(rows[i]) + (pick(rows[i + 1]) - pick(rows[i])) * (t - i);
      };
      const pieces = stairPieces(w.length, s => sampled(s, r => Math.max(r[0], r[1], r[2])), turns, width);
      if (!pieces.length) return;
      const mesh = stairMesh(w, pieces, half, (s, side) => sampled(s, r => (side > 0 ? r[1] : r[2])), tread, riser, stone);
      const footprint: Shape[] = [{ outer: [...w.points.map((_, i) => side(w, i, half)), ...w.points.map((_, i) => side(w, i, -half)).reverse()], holes: [] }];
      const id = `city3d-stairs:${li}:${si}`;
      const volume = {
        id,
        footprint: [],
        levels: [],
        z_m: mesh.low,
        wall_height_m: mesh.high - mesh.low,
        roof_height_m: 0,
        roof_system: 'RF-FLAT',
        roof_pitch_deg: 0,
        overhang_m: 0,
        roof_spec: {} as ArchitectureVolume['roof_spec'],
        materials,
        role: 'main',
        envelope: 'open',
        roof_mesh: mesh.mesh,
        foundation: { footprint: [], z_min_m: mesh.low, z_max_m: mesh.low },
        // Far sectors keep the treads alone (the first faces): a stepped ribbon, a quarter of the triangles.
        overview_faces: [0, mesh.treads],
      } as ArchitectureVolume;
      const origin = w.points[w.points.length >> 1];
      out.push({
        id,
        parcel_id: '',
        function: 'open_space',
        culture: { culture: layout.culture, pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
        recipe_id: 'city3d-stairs',
        variant_id: street.role,
        transform: { origin, orientation_deg: 0 },
        ground_z_m: mesh.low,
        footprint,
        roof_footprint: footprint,
        courtyards: [],
        circulation: [],
        entrance: origin,
        access_id: '',
        volumes: [volume],
        useful_area_m2: 0,
        domestic_units: 0,
        structural_features: [],
        simplification: 'recipe_volumes',
        diagnostics: ['city3d stairs (display only)'],
        resolved: null,
      } as PlacedBuilding);
    });
  });
  return out;
}
const side = (w: Way, i: number, offset: number): Point => {
  const { p, n } = station(w, w.cum[i]);
  return { x: p.x + n.x * offset, y: p.y + n.y * offset };
};

/** Faces of a flight: all treads, landings and ramps first (the overview keeps them), then risers, cheeks and end faces. */
function stairMesh(w: Way, pieces: readonly StairPiece[], half: number, edgeGround: (s: number, side: number) => number, tread: string, riser: string, stone: string): { mesh: RoofMesh; treads: number; low: number; high: number } {
  const mesh: RoofMesh = { vertices: [], faces: [], edges: [], groups: [] };
  let low = Infinity,
    high = -Infinity;
  const face = (points: { x: number; y: number; z: number }[], outward: [number, number, number], material: string): void => {
    // Newell normal, the winding turned to face `outward`.
    let nx = 0,
      ny = 0,
      nz = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] < 0) {
      points = points.slice().reverse();
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const start = mesh.vertices.length;
    mesh.vertices.push(...points);
    for (const p of points) {
      low = Math.min(low, p.z);
      high = Math.max(high, p.z);
    }
    mesh.faces.push({ vertices: points.map((_, i) => start + i), normal: [nx / l, ny / l, nz / l], material, kind: Math.abs(nz / l) < 0.05 ? 'gable' : 'slab' });
  };
  // Sub-pieces split at the way's vertices, so every quad lies on one segment (or ends on a mitred vertex).
  const parts: { s0: number; s1: number; z0: number; z1: number }[] = [];
  for (const p of pieces) {
    const cuts = [p.s0, ...w.cum.filter(s => s > p.s0 + 1e-6 && s < p.s1 - 1e-6), p.s1];
    for (let i = 1; i < cuts.length; i++) {
      const at = (s: number): number => p.z0 + ((p.z1 - p.z0) * (s - p.s0)) / (p.s1 - p.s0);
      parts.push({ s0: cuts[i - 1], s1: cuts[i], z0: at(cuts[i - 1]), z1: at(cuts[i]) });
    }
  }
  const edge = (s: number): { l: Point; r: Point } => {
    const { p, n } = station(w, s);
    return { l: { x: p.x + n.x * half, y: p.y + n.y * half }, r: { x: p.x - n.x * half, y: p.y - n.y * half } };
  };
  const edges = parts.map(p => [edge(p.s0), edge(p.s1)] as const);
  const up: [number, number, number] = [0, 0, 1];
  parts.forEach((p, i) => {
    const [a, b] = edges[i];
    face(
      [
        { ...a.l, z: p.z0 },
        { ...b.l, z: p.z1 },
        { ...b.r, z: p.z1 },
        { ...a.r, z: p.z0 },
      ],
      up,
      tread,
    );
  });
  const treads = mesh.faces.length;
  const foot = (s: number, side: number, top: number): number => Math.min(edgeGround(s, side), top) - CITY3D_FOOTING_DEPTH_M;
  const along = (i: number): [number, number, number] => {
    const [a, b] = edges[i],
      cx = (b.l.x + b.r.x - a.l.x - a.r.x) / 2,
      cy = (b.l.y + b.r.y - a.l.y - a.r.y) / 2,
      l = Math.hypot(cx, cy) || 1;
    return [cx / l, cy / l, 0];
  };
  parts.forEach((p, i) => {
    const [a, b] = edges[i],
      u = along(i);
    // Cheeks: both sides from the footing up to the top.
    for (const [q0, q1, sign] of [
      [a.l, b.l, 1],
      [a.r, b.r, -1],
    ] as const)
      face(
        [
          { ...q0, z: foot(p.s0, sign, p.z0) },
          { ...q1, z: foot(p.s1, sign, p.z1) },
          { ...q1, z: p.z1 },
          { ...q0, z: p.z0 },
        ],
        [-u[1] * sign, u[0] * sign, 0],
        stone,
      );
    // Riser (or drop) to the next piece, facing the lower one; closing faces at both ends of the way.
    const next = parts[i + 1];
    if (next) {
      const dz = next.z0 - p.z1;
      if (Math.abs(dz) > 1e-4)
        face(
          [
            { ...b.l, z: Math.min(p.z1, next.z0) },
            { ...b.r, z: Math.min(p.z1, next.z0) },
            { ...b.r, z: Math.max(p.z1, next.z0) },
            { ...b.l, z: Math.max(p.z1, next.z0) },
          ],
          dz > 0 ? [-u[0], -u[1], 0] : u,
          riser,
        );
    } else
      face(
        [
          { ...b.l, z: foot(p.s1, 1, p.z1) },
          { ...b.r, z: foot(p.s1, -1, p.z1) },
          { ...b.r, z: p.z1 },
          { ...b.l, z: p.z1 },
        ],
        u,
        stone,
      );
    if (i === 0)
      face(
        [
          { ...a.l, z: foot(p.s0, 1, p.z0) },
          { ...a.r, z: foot(p.s0, -1, p.z0) },
          { ...a.r, z: p.z0 },
          { ...a.l, z: p.z0 },
        ],
        [-u[0], -u[1], 0],
        stone,
      );
  });
  return { mesh, treads, low, high };
}
