/**
 * Yard enclosure runs, gates and material batches. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads the globally joined enclosure runs and gates, the palette and ground under each batch.
 */
import type { PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import type { MaterialPattern, Point, Surface, Vertex3 } from '../../../../rust/bridge/housesContract';
import { type YardLine, type YardMesh, type YardStation } from '../urbanBuildingGeometry';
import { type CityPalette } from '../cityCanvas';
import type { LotEnclosure } from '../../../../rust/bridge/urban';
import type { YardBoundary } from '../cityLotEnclosures';
import { TOP_LIGHT, yardMeshTint, yardRuns, yardStyle, type YardRun, type YardGate } from '../yardStyle';
import { SeatedMeshes } from './seatedMeshes';
import { City3dHeight } from './types';
import { RoofBuilder } from './roofGeometry';
import { mat, tinted, roofMat, slots } from './materials';
import { baseVolume } from './volume';

/** Low yard boundaries on exactly the 2D runs and gate gaps. Each run is one polyline with mitred joints; terrain is sampled
 * once per station (<= 6 m) and every vertex keeps the ground under it, so the display exaggeration lifts the fence with the
 * relief and never stretches it. Cost and triangles stay linear in fence length.
 * Looks: plank fence = a sheet of boards between posts; wattle = a woven sheet zig-zagging between stakes, two tones;
 * hedge = a two-tier volume with a bulging side and an irregular top; wall = a body under a wider coping. Sheets are single faces
 * (the pass draws both sides) and posts two crossed quads: a tenth of a metre needs no box. Gates get a jamb on each side.
 * Colours come from yardStyle, shared with the plan. Everything starts below the ground: no z-fighting.
 * Batched per 128 m cell, material and culture. The batch footprint is a zero-area diagonal of its box: it gives the
 * renderer its bounds but never constrains the terrain (no trench to the batch's lowest point), excludes trees or
 * draws an overview cap; beyond the near level the pass draws `yard.lines`, a plain ribbon (eachBuildingTriangle). */

const YARD_STATION_M = 6,
  POST_M = 3,
  PANEL_M = 1.5,
  YARD_MITER = 2.5;

const noise = (x: number, y: number, salt: number): number => {
  let h = Math.imul(Math.round(x * 4) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(Math.round(y * 4) + salt, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
};

/** Stations of a run, at most YARD_STATION_M apart, with the ground under each; `mx, my` is the left offset, mitred on the vertices. */
function yardStations(path: readonly Point[], closed: boolean, heightAt?: City3dHeight): YardStation[] {
  const last = path.length - 1,
    normals: Point[] = [],
    out: YardStation[] = [];
  for (let i = 0; i < last; i++) {
    const a = path[i],
      b = path[i + 1],
      l = Math.hypot(b.x - a.x, b.y - a.y);
    normals.push({ x: -(b.y - a.y) / l, y: (b.x - a.x) / l });
  }
  const miter = (i: number): Point => {
    const p = i > 0 ? normals[i - 1] : closed ? normals[last - 1] : normals[0],
      q = i < last ? normals[i] : closed ? normals[0] : normals[last - 1];
    const bx = p.x + q.x,
      by = p.y + q.y,
      bl = Math.hypot(bx, by);
    if (bl < 1e-6) return q;
    const k = Math.min(YARD_MITER, 1 / Math.max(0.4, (bx * q.x + by * q.y) / bl)) / bl;
    return { x: bx * k, y: by * k };
  };
  let s = 0;
  const push = (x: number, y: number, m: Point): void => {
    out.push({ x, y, mx: m.x, my: m.y, s, g: heightAt?.(x, y) || 0 });
  };
  for (let i = 0; i < last; i++) {
    const a = path[i],
      b = path[i + 1],
      l = Math.hypot(b.x - a.x, b.y - a.y),
      k = Math.max(1, Math.ceil(l / YARD_STATION_M));
    for (let j = 0; j < k; j++) {
      push(a.x + ((b.x - a.x) * j) / k, a.y + ((b.y - a.y) * j) / k, j ? normals[i] : miter(i));
      s += l / k;
    }
  }
  push(path[last].x, path[last].y, miter(last));
  return out;
}

/** The same line with stations at most `step` apart. */
function yardFiner(line: readonly YardStation[], step: number): YardStation[] {
  const out: YardStation[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      k = Math.max(1, Math.ceil((b.s - a.s) / step)),
      at = (u: number, v: number, t: number): number => u + (v - u) * t;
    for (let j = 0; j < k; j++) {
      const t = j / k;
      out.push({ x: at(a.x, b.x, t), y: at(a.y, b.y, t), mx: at(a.mx, b.mx, t), my: at(a.my, b.my, t), s: at(a.s, b.s, t), g: at(a.g, b.g, t) });
    }
  }
  out.push(line[line.length - 1]);
  return out;
}

interface YardBatch {
  details: import('../craftedBoundaries').BoundaryLine[];
  sheetFaces: [number, number][];
  culture: string;
  roof: RoofBuilder;
  ground: number[];
  lines: YardLine[];
  material: LotEnclosure['material'];
  bottom: number;
  top: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface YardGroup {
  runs: YardRun[];
  gates: YardGate[];
  inputs: unknown[];
}

/** The join and gate solve is town-wide. Group its final output in encounter order, including jambs that
 * belong to a gate in a different batch. A change at either end of a run can then invalidate both batches. */
export function city3dLotEnclosures(enclosures: readonly LotEnclosure[], heightAt?: City3dHeight, palette: CityPalette = 'terrain', reuse?: SeatedMeshes): PlacedBuilding[] {
  const { runs, gates } = yardRuns(enclosures as readonly YardBoundary[]),
    groups = new Map<string, YardGroup>(),
    gatePosts = new Set<Point>();
  const groupAt = (e: YardBoundary, p: Point): YardGroup => {
    const key = `${Math.floor(p.x / 128)}/${Math.floor(p.y / 128)}/${e.material}/${e.fenceStyle ?? ''}/${e.culture ?? ''}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { runs: [], gates: [], inputs: [palette] }));
    return group;
  };
  for (const { a, b } of gates) {
    gatePosts.add(a);
    gatePosts.add(b);
  }
  for (const run of runs) {
    const e = run.source,
      path = run.path,
      group = groupAt(e, path[path.length >> 1]);
    group.runs.push(run);
    if (reuse) {
      group.inputs.push('run', e.material, e.fenceStyle, e.culture, e.height, run.closed, gatePosts.has(path[0]), gatePosts.has(path[path.length - 1]), path.length);
      for (const p of path) group.inputs.push(p.x, p.y);
    }
  }
  for (const gate of gates) {
    const { a, b, source: e } = gate,
      group = groupAt(e, a);
    group.gates.push(gate);
    if (reuse) group.inputs.push('gate', e.material, e.fenceStyle, e.culture, e.height, a.x, a.y, b.x, b.y);
  }
  return SeatedMeshes.compose(reuse, batch => {
    const buildings: PlacedBuilding[] = [];
    for (const [key, group] of groups) buildings.push(...batch(key, group.inputs, heightAt, at => yardBatch(key, group, gatePosts, palette, at)));
    return buildings;
  });
}

function yardBatch(key: string, { runs, gates }: YardGroup, gatePosts: Set<Point>, palette: CityPalette, heightAt?: City3dHeight): PlacedBuilding[] {
  const first = runs[0]?.source ?? gates[0].source;
  const batch: YardBatch = { details: [], sheetFaces: [], culture: first.culture ?? '', roof: new RoofBuilder(), ground: [], lines: [], material: first.material, bottom: Infinity, top: -Infinity, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const tints = (e: YardBoundary): { body: string; alt: string; top: string; wood: string } => {
    const look = yardStyle(e.material, e.culture, palette, e.fenceStyle);
    const id = e.material === 'hedge' ? 'city3d:yard:hedge' : e.material === 'wall' ? mat('stone') : e.fenceStyle === 'plank' ? 'city3d:wall:timber' : 'city3d:wall:wattle';
    return {
      body: tinted(id, yardMeshTint(look.color)),
      alt: tinted(id, yardMeshTint(look.accent)),
      top: tinted(e.material === 'wall' ? roofMat('stone') : id, yardMeshTint(e.material === 'fence' ? look.color : look.accent, TOP_LIGHT)),
      wood: tinted('city3d:wall:timber', yardMeshTint(look.jamb)),
    };
  };
  type F = (st: YardStation, j: number) => number;
  const painter = (batch: YardBatch) => {
    const at = (st: YardStation, o: number, z: number): Vertex3 => ({ x: st.x + st.mx * o, y: st.y + st.my * o, z });
    const face = (pts: Vertex3[], grounds: number[], m: string): void => {
      const before = batch.roof.vertices.length;
      batch.roof.face(pts, m);
      if (batch.roof.vertices.length === before) return;
      batch.ground.push(...grounds);
      for (const p of pts) {
        batch.bottom = Math.min(batch.bottom, p.z);
        batch.top = Math.max(batch.top, p.z);
      }
    };
    /** A band over stations: bottom/top heights and left/right offsets per station; two sides, an optional top, optional end caps. */
    const band = (ss: readonly YardStation[], lo: F, hi: F, o0: F, o1: F, m: string, top = true, ends = true, cap = m): void => {
      const P = ss.map((st, j) => ({ st, b: lo(st, j), t: hi(st, j), l: o0(st, j), r: o1(st, j) }));
      for (let j = 1; j < P.length; j++) {
        const p = P[j - 1],
          q = P[j],
          g = [p.st.g, q.st.g, q.st.g, p.st.g];
        face([at(p.st, p.l, p.b), at(q.st, q.l, q.b), at(q.st, q.l, q.t), at(p.st, p.l, p.t)], g, m);
        face([at(p.st, p.r, p.b), at(q.st, q.r, q.b), at(q.st, q.r, q.t), at(p.st, p.r, p.t)], g, m);
        if (top) face([at(p.st, p.l, p.t), at(q.st, q.l, q.t), at(q.st, q.r, q.t), at(p.st, p.r, p.t)], g, cap);
      }
      if (ends) for (const p of [P[0], P[P.length - 1]]) face([at(p.st, p.l, p.b), at(p.st, p.r, p.b), at(p.st, p.r, p.t), at(p.st, p.l, p.t)], [p.st.g, p.st.g, p.st.g, p.st.g], m);
    };
    /** A single face along the line, `off` from it, two tones alternating panel by panel. */
    const sheet = (ss: readonly YardStation[], hi: F, off: F, even: string, odd: string): void => {
      for (let j = 1; j < ss.length; j++) {
        const p = ss[j - 1],
          q = ss[j];
        face([at(p, off(p, j - 1), p.g - 0.12), at(q, off(q, j), q.g - 0.12), at(q, off(q, j), q.g + hi(q, j)), at(p, off(p, j - 1), p.g + hi(p, j - 1))], [p.g, q.g, q.g, p.g], j % 2 ? odd : even);
      }
    };
    const post = (p: Point, g: number, h: number, half: number, m: string): void => {
      for (const [dx, dy] of [
        [half, half],
        [half, -half],
      ])
        face(
          [
            { x: p.x - dx, y: p.y - dy, z: g - 0.15 },
            { x: p.x + dx, y: p.y + dy, z: g - 0.15 },
            { x: p.x + dx, y: p.y + dy, z: g + h },
            { x: p.x - dx, y: p.y - dy, z: g + h },
          ],
          [g, g, g, g],
          m,
        );
    };
    return { band, sheet, post };
  };
  const { band, sheet, post } = painter(batch);
  const extend = (p: Point, h: number): void => {
    batch.minX = Math.min(batch.minX, p.x - h);
    batch.minY = Math.min(batch.minY, p.y - h);
    batch.maxX = Math.max(batch.maxX, p.x + h);
    batch.maxY = Math.max(batch.maxY, p.y + h);
  };
  for (const run of runs) {
    const e = run.source,
      line = yardStations(run.path, run.closed, heightAt),
      t = tints(e);
    const ends = !run.closed;
    let half: number, height: number;
    if (e.material === 'wall') {
      const H = Math.max(0.8, e.height ?? 1.3);
      half = H > 2 ? 0.22 : 0.18;
      height = H + 0.1;
      band(
        line,
        st => st.g - 0.3,
        st => st.g + H,
        () => -half,
        () => half,
        t.body,
        false,
        ends,
      );
      band(
        line,
        st => st.g + H,
        st => st.g + H + 0.1,
        () => -half - 0.04,
        () => half + 0.04,
        t.top,
        true,
        ends,
      );
    } else if (e.material === 'hedge') {
      // A base under a narrower crown (0.5-0.6 m wide): the crown bulges and its top undulates every 3 m.
      const H = 1.1 + 0.25 * (noise(line[0].x, line[0].y, 7) - 0.5),
        ss = yardFiner(line, POST_M);
      const w = ss.map(st => 0.2 + 0.06 * noise(st.x, st.y, 3)),
        crown = ss.map(st => H + 0.2 * (noise(st.x, st.y, 5) - 0.5));
      half = 0.28;
      height = H;
      band(
        line,
        st => st.g - 0.2,
        st => st.g + 0.65 * H,
        () => -half,
        () => half,
        t.body,
        true,
        ends,
      );
      band(
        ss,
        st => st.g + 0.65 * H,
        (st, j) => st.g + crown[j],
        (_, j) => -w[j],
        (_, j) => w[j],
        t.body,
        true,
        ends,
        t.top,
      );
    } else {
      const wattle = e.fenceStyle === 'wattle',
        ss = yardFiner(line, PANEL_M),
        top = wattle ? ss.map(st => 0.8 + 0.06 * noise(st.x, st.y, 9)) : ss.map(st => 0.98 + 0.05 * noise(st.x, st.y, 11));
      half = 0.05;
      height = wattle ? 0.85 : 1;
      const start = batch.roof.faces.length;
      sheet(ss, (_, j) => top[j], wattle ? (_, j) => (j % 2 && !(run.closed && j === ss.length - 1) ? 0.05 : -0.05) : () => 0, t.body, t.alt);
      batch.sheetFaces.push([start, batch.roof.faces.length]);
      // Each jamb replaces the regular post at its endpoint. A closed run's last station repeats its first post.
      const posts = yardFiner(line, POST_M),
        first = gatePosts.has(run.path[0]) ? 1 : 0,
        end = posts.length - (run.closed || gatePosts.has(run.path[run.path.length - 1]) ? 1 : 0);
      for (let i = first; i < end; i++) {
        const st = posts[i];
        post(st, st.g, wattle ? 0.95 : 1.12, wattle ? 0.035 : 0.05, t.wood);
      }
    }
    batch.details.push({ points: line, closed: run.closed, kind: e.material === 'hedge' ? 'hedge' : e.material === 'wall' ? 'stone' : e.fenceStyle === 'plank' ? 'boards' : 'woven', height, half, side: t.body, cap: t.top });
    batch.lines.push({ stations: line, closed: run.closed, height, half, side: t.body, top: t.top });
    for (const p of run.path) extend(p, half + 0.1);
  }
  // Jambs: a post either side of a gate, a pier in a wall.
  for (const g of gates) {
    const e = g.source,
      t = tints(e);
    for (const p of [g.a, g.b]) {
      const ground = heightAt?.(p.x, p.y) || 0;
      if (e.material === 'wall') {
        const H = Math.max(0.8, e.height ?? 1.3) + 0.3,
          l = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y),
          ux = (g.b.x - g.a.x) / l,
          uy = (g.b.y - g.a.y) / l,
          out = p === g.a ? -0.6 : 0.6;
        const st: YardStation = { x: p.x, y: p.y, mx: -uy, my: ux, s: 0, g: ground };
        band(
          [st, { ...st, x: p.x + ux * out, y: p.y + uy * out }],
          () => ground - 0.3,
          () => ground + H,
          () => -0.31,
          () => 0.31,
          t.body,
          true,
          true,
          t.top,
        );
      } else post(p, ground, e.material === 'hedge' ? 1.45 : 1.3, 0.09, t.wood);
      extend(p, 0.4);
    }
  }
  if (!batch.roof.faces.length) return [];
  const lo = { x: batch.minX, y: batch.minY },
    hi = { x: batch.maxX, y: batch.maxY },
    footprint: Surface = [{ outer: [lo, hi, hi, lo], holes: [] }];
  const pattern: MaterialPattern = batch.material === 'wall' ? 'stone' : 'wood',
    origin = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
  const volume = baseVolume(`yard:${key}:v`, footprint, batch.bottom, batch.top - batch.bottom, 0, slots(pattern, pattern), batch.roof.mesh(), 'RF-FLAT', { footprint: [], z_min_m: batch.bottom, z_max_m: batch.bottom }, []);
  volume.envelope = 'open';
  const building: import('../craftedBoundaries').BoundaryBuilding & { yard: YardMesh } = {
    id: `yard:${key}`,
    parcel_id: '',
    function: 'collective',
    culture: { culture: batch.culture, pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
    recipe_id: 'city3d-yard',
    variant_id: `yard:${batch.material}`,
    transform: { origin, orientation_deg: 0 },
    ground_z_m: batch.bottom,
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
    diagnostics: ['city3d yard enclosure'],
    resolved: null,
    boundary: { lines: batch.details },
    yard: { ground: batch.ground, lines: batch.lines, sheetFaces: batch.sheetFaces },
  };
  return [building];
}
