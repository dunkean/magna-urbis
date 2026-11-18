/**
 * Underdark 3D mushrooms: the Underdark's trees. Instanced low-poly lathes drawn from one small parametric family
 * (FUNGUS_FORMS: parasol, dome, bell, cone, funnel cup, puffball, morel, club, wall bracket, and the stalactites of the
 * section rim), placed by a CPU port of the 2D ground's fungal fields (rust/bridge/terrainRenderUnderdark.ts: udHash,
 * udFbm, the grove, moss and luminous-cluster fields and the two cap lattices), so a giant cap in 3D stands where the
 * 2D map paints its cap, and luminous clusters where it paints its specks.
 *
 * Ecology: giant parasols, domes and bells in the groves of humid floors (taller in great chambers, never above the
 * roof); luminous clusters of thin stems on the cluster field; puffball and club carpets on moss beds near the eye;
 * sparse pale cones and morels in narrow dry galleries; shelves on steep walls near water; stalactites along the rim of
 * the cut, denser near water. Towns, fungal farms, ways and water are cleared. Display only; built around the eye
 * when it settles, nearest first, bounded; nothing on ordinary maps (the program exists only in the Underdark).
 */
import { ForestRoom, type ForestCorridor } from '../render/forestRoom';
import type { ForestOccupation } from '../../../rust/bridge/terrainForest';
import { cavernRoofAt, cavernTexelAt, type CavernField } from '../render/underdarkCavern';
import { FUNGUS_BED } from './forestOccupation';
import { UNDERDARK_FARMS } from '../../../rust/bridge/terrainRenderUnderdark';

import { FUNGUS_CAPS, FUNGUS_FORM as F, FUNGUS_PARTS, FUNGUS_PROFILES, FUNGUS_RINGS } from '../render/fungusForms';

export const FUNGUS_SEGMENTS = 10;
export const FUNGUS_VERTICES = FUNGUS_SEGMENTS * (FUNGUS_RINGS - 1) * 6;
/** Geometric levels of detail (vertices per instance): 0 the full lathe (10 sides, 8 bands) near the focus and for large
 * forms up to 150 m; 1 six sides, three bands (foot, stem top, rim, apex) for the other forms over 1.5 m; 2 a six-sided
 * cap of one band for the small ones. Worst case at the 32 000 bound: 800 × 480 + 31 200 × 36 ≈ 1.5 M vertices. */
export const FUNGUS_LOD_VERTICES = [FUNGUS_VERTICES, 6 * 3 * 6, 6 * 1 * 6] as const;
const FUNGUS_FULL_MAX = 800;
/** Instances in level-of-detail order (FUNGUS_LOD_VERTICES), and how many of each level. */
export interface FungusStream {
  values: Float32Array;
  counts: [number, number, number];
}
/** Floats per instance: (x, y, ground z, cap radius) (height, stem radius, form, phase + 8 · flags) (r, g, b, glow + 2 · hue). */
export const FUNGUS_STRIDE = 12;
/** Instance flags: pale spots on the cap, ribs (gills or ridges) marked, hanging from the roof (cut away with it). */
const SPOTS = 1,
  RIBS = 2,
  CEILING = 4;
/** Glow hues: cool cyan-green, pale violet, warm amber. */
const CYAN = 0,
  VIOLET = 1,
  AMBER = 2;
/** Radii (m) around the eye: large forms and stalactites, small carpets and clusters. */
export const FUNGUS_FAR = 700,
  FUNGUS_NEAR = 160;
const FUNGUS_MAX = 32000;

export interface FungusInputs {
  seed: number;
  cavern: CavernField;
  /** Raw floor/rock height of the layer (before the cut), bilinear. */
  raw(x: number, y: number): number;
  /** Displayed ground height (the cut surface). */
  height(x: number, y: number): number | undefined;
  /** Displayed water cover 0..1. */
  water(x: number, y: number): number;
  /** Town glow (x, y, radius) per town: the built extent is about .62 of the radius. */
  towns?: Float32Array;
  /** Fungal farm lots (x, y, half-size, angle) × 32. */
  farms?: Float32Array;
  occupation?: ForestOccupation;
  /** Abundance 0-2 (composition `effects.underdark.fungi`). */
  abundance: number;
}

// --- CPU port of the 2D ground's hash, noise and fbm (UNDERDARK_GLSL), all octaves resolved. ---
function udHash(x: number, y: number): number {
  const qx = Math.floor(x) | 0,
    qy = Math.floor(y) | 0;
  let h = (Math.imul(qx, 374761393) ^ Math.imul(qy, 668265263) ^ 2654435769) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
function udNoise(x: number, y: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const a = udHash(ix, iy),
    b = udHash(ix + 1, iy),
    c = udHash(ix, iy + 1),
    d = udHash(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
function udFbm(x: number, y: number, wavelength: number): number {
  let sum = 0,
    amp = 0.5,
    norm = 0;
  for (let k = 0; k < 4; k++) {
    sum += amp * (udNoise(x / wavelength + k * 17.31, y / wavelength + k * 9.17) - 0.5);
    norm += amp;
    wavelength *= 0.5;
    amp *= 0.55;
  }
  return sum / norm;
}
const ss = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

const wayRooms = new WeakMap<object, ForestRoom>();

/** Builds the instances around (x, y), nearest first, bounded; yields between lattice rows. */
export function* buildFungiSteps(inputs: FungusInputs, view: { x: number; y: number }): Generator<void, FungusStream> {
  const { cavern, abundance } = inputs,
    out: number[][] = [];
  if (abundance <= 0) return { values: new Float32Array(0), counts: [0, 0, 0] };
  const occ = inputs.occupation,
    ways = occ?.ways?.length ? (wayRooms.get(occ.ways) ?? (wayRooms.set(occ.ways, new ForestRoom(occ.ways as readonly ForestCorridor[], [])), wayRooms.get(occ.ways)!)) : undefined;
  const occupied = (x: number, y: number): boolean => {
    if (!occ) return false;
    const i = Math.floor(((x - occ.x) / occ.width) * occ.n),
      j = Math.floor(((y - occ.y) / occ.width) * occ.n);
    if (i < 0 || j < 0 || i >= occ.n || j >= occ.n) return false;
    const cls = occ.rgba[(j * occ.n + i) * 4 + 2];
    return cls === 4 || cls === 8 || cls === 9 || cls === 11 || cls === 12;
  };
  // Towns (their built extent and a margin), fungal farms, ways and water are cleared, as the surface trees are.
  const cleared = (x: number, y: number, margin: number): boolean => {
    const t = inputs.towns;
    if (t)
      for (let k = 0; k + 2 < t.length; k += 3) {
        const dx = x - t[k],
          dy = y - t[k + 1],
          r = t[k + 2] * 0.7 + margin;
        if (dx * dx + dy * dy < r * r) return true;
      }
    if (ways && !ways.keeps(x, y, margin + 0.5)) return true;
    return occupied(x, y);
  };
  const rockAt = (x: number, y: number): number => cavernTexelAt(cavern, x, y, 0);
  // Fungus beds (occupation class 13): the cultivated land of cave towns, filled with low luminous mushrooms.
  const bedAt = (x: number, y: number): boolean => {
    if (!occ) return false;
    const i = Math.floor(((x - occ.x) / occ.width) * occ.n),
      j = Math.floor(((y - occ.y) / occ.width) * occ.n);
    return i >= 0 && j >= 0 && i < occ.n && j < occ.n && occ.rgba[(j * occ.n + i) * 4 + 2] === FUNGUS_BED;
  };
  const slopeAt = (x: number, y: number): number => {
    const e = 3;
    return Math.hypot(inputs.raw(x + e, y) - inputs.raw(x - e, y), inputs.raw(x, y + e) - inputs.raw(x, y - e)) / (2 * e);
  };
  const far2 = FUNGUS_FAR * FUNGUS_FAR,
    near2 = FUNGUS_NEAR * FUNGUS_NEAR;
  const d2 = (x: number, y: number): number => (x - view.x) ** 2 + (y - view.y) ** 2;
  // Floor fields of the 2D ground at a point (underdarkFloor): wetness, rocky slope, moss, grove, luminous clusters.
  const floor = (x: number, y: number): { wet: number; rocky: number; moss: number; grove: number; cluster: number } => {
    const wet = Math.min(1, inputs.water(x, y) * 1.5);
    const rocky = ss(0.12, 0.45, slopeAt(x, y) + 0.15 * udFbm(x * 1.7 + 31, y * 1.7 + 5, 60));
    const moss = ss(0.05, 0.25, udFbm(x + 191, y + 23, 240) + 0.25 * wet - 0.1) * (1 - rocky);
    const grove = ss(0.04, 0.2, udFbm(x - 517, y + 233, 520) + 0.1 * wet + 0.2 * moss - 0.1) * (1 - rocky) * (1 - ss(0.15, 0.45, wet));
    const cluster = ss(0.12, 0.32, udFbm(x + 911, y + 377, 420) + 0.3 * moss);
    return { wet, rocky, moss, grove, cluster };
  };
  const headroom = (x: number, y: number, z: number): number => cavernRoofAt(cavern, x, y) - z;
  const push = (x: number, y: number, z: number, capR: number, h: number, stemR: number, form: number, phase: number, flags: number, c: readonly number[], glow: number, hue: number): void => {
    out.push([d2(x, y), x, y, z, capR, h, stemR, form, (((phase % 6.2831853) + 6.2831853) % 6.2831853) + 8 * flags, c[0], c[1], c[2], Math.min(glow, 0.99) + 2 * hue]);
  };
  const bx0 = view.x - FUNGUS_FAR,
    bx1 = view.x + FUNGUS_FAR,
    by0 = view.y - FUNGUS_FAR,
    by1 = view.y + FUNGUS_FAR;
  const keepScale = Math.min(abundance, 2);

  // 1. Giant caps where the 2D map paints its grove caps (underdarkMushroomCell, cells 31 and 19 m, same hashes and
  // sizes), thinned to scattered individuals: outside the forests the floor stays mostly bare rock.
  const CAPS = FUNGUS_CAPS;
  for (const [CELL, sx, sy] of [
    [31, 0, 0],
    [19, 0.37, 0.61],
  ] as const) {
    for (let j = Math.floor(by0 / CELL + sy); j <= Math.ceil(by1 / CELL + sy); j++) {
      yield;
      for (let i = Math.floor(bx0 / CELL + sx); i <= Math.ceil(bx1 / CELL + sx); i++) {
        const h = udHash(i + 17 + sx, j + 233 + sy);
        if (h > 0.7) continue;
        const cx = udHash(i + 5, j + 71) * 0.56 + 0.22,
          cy = udHash(i + 61, j + 2) * 0.56 + 0.22;
        const x = (i + cx - sx) * CELL,
          y = (j + cy - sy) * CELL;
        if (d2(x, y) > far2) continue;
        if (rockAt(x, y) > 0.35) continue;
        const f = floor(x, y);
        if (h > 0.7 * fungusGroveAt(x, y) || inputs.water(x, y) >= 0.05) continue;
        if (udHash(i + 401, j + 77) > 0.2 * keepScale) continue;
        const room = Math.min(cx, 1 - cx, cy, 1 - cy) * CELL,
          capR = Math.min(room * 0.95, CELL * (0.16 + 0.2 * udHash(i + 23, j + 9)));
        if (capR < 0.8 || cleared(x, y, capR)) continue;
        const z = inputs.height(x, y);
        if (z === undefined) continue;
        const k = udHash(i + 88, j + 13),
          tone = 0.8 + 0.4 * udHash(i + 1, j + 301),
          open = cavernTexelAt(cavern, x, y, 2);
        const form = k < 0.45 ? F.parasol : k < 0.8 ? (udHash(i + 7, j + 31) < 0.6 ? F.dome : F.bell) : F.bell;
        let height = capR * (form === F.parasol ? 2.4 : form === F.dome ? 1.45 : 1.9) * (0.85 + 0.3 * udHash(i + 3, j + 3)) * (1 + 0.35 * open);
        height = Math.min(height, Math.max(2, headroom(x, y, z) - 3));
        const luminous = udHash(i + 7, j + 7) >= 0.66;
        push(
          x,
          y,
          z,
          capR,
          height,
          capR * (form === F.parasol ? 0.11 : form === F.dome ? 0.26 : 0.17),
          form,
          udHash(i + 9, j + 4) * 6.283,
          (k > 0.55 && k < 0.8 ? SPOTS : 0) | RIBS,
          CAPS[k < 0.45 ? 0 : k < 0.8 ? 1 : 2].map(v => v * tone * 1.25),
          luminous ? 0.55 : 0,
          CYAN,
        );
      }
    }
  }
  // 2. Fungus forests: tree-sized parasols, domes and bells 10-34 m high (never above the roof) in the great humid
  // chambers, on a jittered 13 m lattice with clearings and varied spacing. Their stands follow a broad version of the
  // 2D grove field; the abundance widens the forests, it does not pack them.
  const forestEdge = 0.07 - 0.07 * (keepScale - 1);
  for (let j = Math.floor(by0 / 13); j <= Math.ceil(by1 / 13); j++) {
    yield;
    for (let i = Math.floor(bx0 / 13); i <= Math.ceil(bx1 / 13); i++) {
      const h = udHash(i + 1301, j + 29);
      if (h > 0.45) continue;
      const x = (i + 0.15 + 0.7 * udHash(i + 5, j + 1303)) * 13,
        y = (j + 0.15 + 0.7 * udHash(i + 1307, j + 9)) * 13;
      if (d2(x, y) > far2 || rockAt(x, y) > 0.25) continue;
      const open = cavernTexelAt(cavern, x, y, 2);
      if (open < 0.2) continue;
      const stand = ss(forestEdge, forestEdge + 0.16, udFbm(x - 517, y + 233, 700) + 0.12 * open),
        glade = ss(-0.12, 0.08, udFbm(x + 77, y - 913, 110));
      if (h > 0.45 * stand * glade * ss(0.2, 0.55, open) || inputs.water(x, y) >= 0.05 || bedAt(x, y)) continue;
      const k = udHash(i + 88, j + 1313),
        form = k < 0.55 ? F.parasol : k < 0.8 ? F.dome : F.bell;
      let height = (10 + 24 * udHash(i + 1315, j + 3) ** 1.5) * (0.6 + 0.5 * open);
      const capR = height * (form === F.parasol ? 0.36 : form === F.dome ? 0.55 : 0.42) * (0.85 + 0.3 * udHash(i + 1317, j + 1));
      if (cleared(x, y, capR + 4)) continue;
      const z = inputs.height(x, y);
      if (z === undefined) continue;
      height = Math.min(height, Math.max(3, cavernRoofAt(cavern, x, y) - z - 3));
      const c = FUNGUS_CAPS[k < 0.45 ? 0 : k < 0.8 ? 1 : 2],
        tone = (0.85 + 0.35 * udHash(i + 1319, j + 7)) * 1.25;
      push(
        x,
        y,
        z,
        capR,
        height,
        capR * (form === F.parasol ? 0.1 : form === F.dome ? 0.2 : 0.15),
        form,
        h * 60,
        (udHash(i, j + 1321) < 0.3 ? SPOTS : 0) | RIBS,
        c.map(v => v * tone),
        udHash(i + 1323, j) > 0.78 ? 0.45 : 0,
        udHash(i + 1325, j) > 0.5 ? CYAN : VIOLET,
      );
    }
  }
  // 3. Mushroom farms on the cultivated land (occupation class 13), near the focus: fields of a few beds each, every
  // field (a 44 m block) with its own row direction and spacing; rows broken into beds by cross paths, every fifth row
  // a path; per bed one size and form, caps at jittered spacing, a few beds glowing.
  const FARM = 130,
    farm2 = FARM * FARM,
    BLOCK = 44;
  for (let by = Math.floor((view.y - FARM) / BLOCK); by <= Math.floor((view.y + FARM) / BLOCK); by++) {
    for (let bx = Math.floor((view.x - FARM) / BLOCK); bx <= Math.floor((view.x + FARM) / BLOCK); bx++) {
      yield;
      const cxb = (bx + 0.5) * BLOCK,
        cyb = (by + 0.5) * BLOCK;
      if (!UNDERDARK_FARMS || d2(cxb, cyb) > (FARM + BLOCK) ** 2 || !occ) continue;
      const angle = udHash(bx + 3001, by + 7) * Math.PI,
        ca = Math.cos(angle),
        sa = Math.sin(angle);
      const spacing = 2.2 + 0.9 * udHash(bx + 3003, by + 11),
        reach = BLOCK * 0.75;
      for (let r = Math.floor(-reach / spacing); r <= Math.ceil(reach / spacing); r++) {
        if (((r % 5) + 5) % 5 === 4) continue;
        const bedLength = 6 + 6 * udHash(bx + r, by + 3005);
        for (let u = -reach; u <= reach;) {
          const seg = Math.floor(u / bedLength),
            within = u / bedLength - seg,
            sh = udHash(bx * 131 + r, by * 71 + seg);
          const size = sh < 0.4 ? 0.3 : sh < 0.8 ? 0.5 : 0.8,
            step = size * (1.6 + 0.9 * udHash(Math.floor(u * 7) + bx, r + by));
          u += step;
          if (within > 0.84 || sh > 0.93) continue;
          const v = r * spacing + (udHash(Math.floor(u * 5), r * 3 + by) - 0.5) * 0.5;
          const x = cxb + ca * u - sa * v,
            y = cyb + sa * u + ca * v;
          if (Math.floor(x / BLOCK) !== bx || Math.floor(y / BLOCK) !== by || d2(x, y) > farm2 || !bedAt(x, y)) continue;
          if (ways && !ways.keeps(x, y, 1)) continue;
          const z = inputs.height(x, y);
          if (z === undefined) continue;
          const jitter = 0.75 + 0.5 * udHash(Math.floor(u * 11), r + bx),
            height = size * jitter,
            form = sh < 0.45 ? F.dome : sh < 0.75 ? F.bell : F.parasol;
          const glow = udHash(bx + seg, by + r * 7) < 0.06 ? 0.55 : 0,
            tone = 0.85 + 0.3 * udHash(seg + bx, r);
          push(
            x,
            y,
            z,
            height * (form === F.parasol ? 0.5 : 0.38),
            height,
            height * 0.1,
            form,
            u * 3.1,
            0,
            (sh < 0.45 ? [0.56, 0.52, 0.45] : sh < 0.75 ? [0.5, 0.37, 0.24] : [0.44, 0.35, 0.4]).map(c => c * tone),
            glow,
            glow && sh > 0.5 ? VIOLET : CYAN,
          );
        }
      }
    }
  }
  // 4. Scattered mushrooms on the bare floor outside forests and farms: lone individuals and small groups of two to
  // five on a jittered 37 m lattice, mostly empty; sizes from ankle-high to a few metres, every form of the family.
  const SCATTER = [F.dome, F.bell, F.cone, F.parasol, F.morel, F.puffball, F.club, F.funnel] as const;
  for (let j = Math.floor(by0 / 37); j <= Math.ceil(by1 / 37); j++) {
    yield;
    for (let i = Math.floor(bx0 / 37); i <= Math.ceil(bx1 / 37); i++) {
      const h = udHash(i + 3701, j + 41);
      if (h > 0.14 * keepScale) continue;
      const x = (i + 0.1 + 0.8 * udHash(i + 3, j + 3703)) * 37,
        y = (j + 0.1 + 0.8 * udHash(i + 3705, j + 7)) * 37;
      if (d2(x, y) > far2 || rockAt(x, y) > 0.3 || inputs.water(x, y) >= 0.05 || bedAt(x, y) || cleared(x, y, 2)) continue;
      const f = floor(x, y);
      if (f.rocky > 0.6) continue;
      const count = 1 + Math.floor(5 * udHash(i + 3707, j + 3) ** 2),
        big = udHash(i + 3709, j + 5);
      for (let k = 0; k < count; k++) {
        const a = udHash(i + k * 13, j + 3711) * 6.283,
          r = k ? 1 + 3 * udHash(i + 3713, j + k) : 0;
        const px = x + Math.cos(a) * r,
          py = y + Math.sin(a) * r,
          z = inputs.height(px, py);
        if (z === undefined) continue;
        const u = udHash(i + k * 7, j + 3715),
          form = SCATTER[Math.floor(u * SCATTER.length)];
        const height = (0.4 + 3.2 * big ** 2) * (0.55 + 0.6 * udHash(i + 3717, j + k)) * (k ? 0.75 : 1);
        const capR = form === F.club ? 0 : height * (form === F.parasol ? 0.5 : form === F.cone ? 0.25 : form === F.puffball ? 0.55 : form === F.funnel ? 0.45 : 0.36);
        const tone = 0.8 + 0.4 * udHash(i + 3719, j + k);
        push(
          px,
          py,
          z,
          capR,
          height,
          height * (form === F.club ? 0.12 : 0.08),
          form,
          u * 6.283,
          form === F.dome && u > 0.85 ? SPOTS : 0,
          (u < 0.3 ? [0.56, 0.52, 0.44] : u < 0.55 ? [0.44, 0.3, 0.34] : u < 0.8 ? [0.52, 0.38, 0.24] : [0.34, 0.38, 0.32]).map(c => c * tone),
          udHash(i + 3721, j + k) < 0.05 ? 0.5 : 0,
          AMBER,
        );
      }
    }
  }
  // 5. Shelves on steep walls near water (7 m lattice), stacked two or three high, facing the chamber.
  // 6. Stalactites along the rim of the cut (9 m lattice), hanging from the roof level over the chamber.
  for (let j = Math.floor(by0 / 7); j <= Math.ceil(by1 / 7); j++) {
    yield;
    for (let i = Math.floor(bx0 / 7); i <= Math.ceil(bx1 / 7); i++) {
      const x = (i + 0.2 + 0.6 * udHash(i + 1501, j + 3)) * 7,
        y = (j + 0.2 + 0.6 * udHash(i + 7, j + 1503)) * 7;
      if (d2(x, y) > far2) continue;
      const rock = rockAt(x, y);
      if (rock < 0.45) continue;
      const roof = cavernRoofAt(cavern, x, y),
        e = 6;
      // Out of the rock: towards the chamber the wall bounds (the soft rock field falls that way; walls rise to the roof).
      const gx = rockAt(x + e, y) - rockAt(x - e, y),
        gy = rockAt(x, y + e) - rockAt(x, y - e),
        g = Math.hypot(gx, gy);
      if (g < 0.02) continue;
      const ox = -gx / g,
        oy = -gy / g,
        wet = Math.max(inputs.water(x + ox * 60, y + oy * 60), inputs.water(x + ox * 120, y + oy * 120));
      const clearance = cavernTexelAt(cavern, x, y, 3),
        cut = rock >= 0.75;
      if (cut) {
        // On the cut, next to the wall: the rim. Stalactites hang just over the wall, from the roof level.
        if (rockAt(x + ox * 14, y + oy * 14) > 0.5) continue;
        if (udHash(i + 1601, j + 5) > (0.22 + 0.45 * wet) * Math.min(1, 0.5 + 0.5 * keepScale)) continue;
        const sx = x + ox * (2 + 4 * udHash(i + 3, j + 1605)),
          sy = y + oy * (2 + 4 * udHash(i + 1607, j + 7));
        if (cleared(sx, sy, 0) && udHash(i, j + 1609) < 0.5) continue;
        // Short against the vault: a fringe never bridges a passage.
        const length = Math.min((3 + 9 * udHash(i + 1611, j + 1)) * (0.8 + 0.5 * wet), 0.3 * clearance);
        const z = Math.min(roof, cavernRoofAt(cavern, sx, sy));
        push(sx, sy, z, length * (0.11 + 0.06 * udHash(i + 2, j + 1613)), length, 0, F.stalactite, udHash(i + 9, j + 9) * 6.283, 0, [0.2, 0.19, 0.21], wet > 0.2 && udHash(i + 4, j + 1615) < 0.15 ? 0.25 : 0, CYAN);
        continue;
      }
      if (wet < 0.05 || udHash(i + 1701, j + 11) > 0.5 * Math.min(keepScale, 1.5)) continue;
      const z0 = inputs.height(x + ox * 12, y + oy * 12);
      if (z0 === undefined || cleared(x, y, 1)) continue;
      const stack = 1 + Math.floor(3 * udHash(i + 13, j + 1703)),
        facing = Math.atan2(oy, ox);
      for (let k = 0; k < stack; k++) {
        const r = 0.7 + 1.6 * udHash(i + k * 3, j + 1705),
          dz = k * (1.1 + 0.8 * udHash(i + 1707, j + k));
        // The shelf's back edge sits in the wall: it starts a little inside it and reaches out over the slope.
        push(x - ox * r * 0.3, y - oy * r * 0.3, Math.min(z0 + 0.6 + dz, roof - 2), r, r * 0.28, 0, F.bracket, facing, RIBS, udHash(i + k, j + 1709) < 0.5 ? [0.48, 0.36, 0.22] : [0.4, 0.4, 0.34], udHash(i + 1711, j + k) < 0.12 ? 0.5 : 0, AMBER);
      }
    }
  }
  // 7. Stalactites under the roof of the chambers (21 m lattice), denser over water; cut away with the roof around the focus.
  for (let j = Math.floor(by0 / 21); j <= Math.ceil(by1 / 21); j++) {
    yield;
    for (let i = Math.floor(bx0 / 21); i <= Math.ceil(bx1 / 21); i++) {
      const h = udHash(i + 2101, j + 17);
      if (h > 0.3) continue;
      const x = (i + 0.1 + 0.8 * udHash(i + 3, j + 2103)) * 21,
        y = (j + 0.1 + 0.8 * udHash(i + 2105, j + 5)) * 21;
      if (d2(x, y) > far2 || rockAt(x, y) > 0.2) continue;
      const wet = inputs.water(x, y);
      if (h > (0.12 + 0.25 * wet) * Math.min(1, 0.5 + 0.5 * keepScale)) continue;
      const clearance = cavernTexelAt(cavern, x, y, 3),
        length = Math.min((3 + 10 * udHash(i + 7, j + 2107)) * (0.8 + 0.5 * wet), 0.22 * clearance);
      push(x, y, cavernRoofAt(cavern, x, y) + 0.6, length * (0.1 + 0.05 * udHash(i, j + 2109)), length, 0, F.stalactite, h * 20, CEILING, [0.22, 0.21, 0.23], 0, CYAN);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const kept = out.slice(0, FUNGUS_MAX),
    counts: [number, number, number] = [0, 0, 0];
  // Level of detail: the full lathe within 25 m of the focus and for forms of 4 m and more within 150 m (800 at most,
  // the nearest), six sides elsewhere for forms over 1.5 m, a one-band cap for the small ones.
  const tiers = kept.map(e => {
    const d = Math.sqrt(e[0]),
      h = e[5];
    return d < 25 || (h >= 4 && d < 150) ? 0 : h >= 1.5 ? 1 : 2;
  });
  let full = 0;
  for (let k = 0; k < kept.length; k++) if (tiers[k] === 0 && ++full > FUNGUS_FULL_MAX) tiers[k] = kept[k][5] >= 1.5 ? 1 : 2;
  const order = kept.map((_, k) => k).sort((a, b) => tiers[a] - tiers[b] || kept[a][0] - kept[b][0]);
  for (const t of tiers) counts[t]++;
  const values = new Float32Array(kept.length * FUNGUS_STRIDE);
  order.forEach((k, at) => values.set(kept[k].slice(1), at * FUNGUS_STRIDE));
  return { values, counts };
}
export function buildFungi(inputs: FungusInputs, view: { x: number; y: number }): FungusStream {
  const work = buildFungiSteps(inputs, view);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

const glslNumber = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v));
const PROFILES = FUNGUS_PROFILES,
  PARTS = FUNGUS_PARTS;
const profileTable = PROFILES.flat()
  .map(([a, b, y]) => `vec3(${glslNumber(a)},${glslNumber(b)},${glslNumber(y)})`)
  .join(',');
const partTable = PARTS.map(([s, g]) => `vec2(${glslNumber(s)},${glslNumber(g)})`).join(',');

/** One lathe per instance from gl_VertexID; translated to WGSL by web/scripts/wgsl_shaders_3d.ts. */
export const FUNGUS_3D_GLSL = {
  vertex: `#version 300 es
precision highp float;
layout(location=0) in vec4 fungusBase;
layout(location=1) in vec4 fungusShape;
layout(location=2) in vec4 fungusColor;
uniform mat4 matrix;
uniform vec3 cameraOrigin;
uniform float exaggeration;
uniform vec4 fungusFade;
uniform vec4 uReveal;
uniform int fungusLod;
out vec3 world;
out vec3 fungusNormal;
out vec3 tint;
out vec3 chart;
out vec4 fungusInfo;
out vec2 plan;
const vec3 PROFILE[${PROFILES.length * FUNGUS_RINGS}]=vec3[${PROFILES.length * FUNGUS_RINGS}](${profileTable});
const vec2 PART[${PARTS.length}]=vec2[${PARTS.length}](${partTable});
// Profile ring of a lathe ring at a level of detail: all nine; foot, stem top, rim, apex; rim underside and apex.
int fungusK(int r){if(fungusLod==0)return clamp(r,0,8);if(fungusLod==1)return r<=0?0:r==1?2:r==2?5:8;return r<=0?4:8;}
vec2 fungusRing(int form,int k,float stem,float cap,float h){vec3 p=PROFILE[form*${FUNGUS_RINGS}+clamp(k,0,${FUNGUS_RINGS - 1})];return vec2(p.x*stem+p.y*cap,p.z*h);}
void main(){
  int v=int(gl_VertexID),quad=v/6,corner=v-quad*6;
  int sides=fungusLod==0?${FUNGUS_SEGMENTS}:6,band=quad/sides,seg=quad-band*sides;
  int dseg=corner==1||corner==2||corner==4?1:0,dring=corner==2||corner==4||corner==5?1:0;
  int ring=band+dring,form=int(fungusShape.z+.5);
  float flags=floor(fungusShape.w/8.),phase=fungusShape.w-8.*flags;
  float far=distance(fungusBase.xy,fungusFade.xy);
  // Low mushrooms (under 1.5 m) only near the eye, larger forms to the far radius.
  float fade=1.-(fungusShape.x<1.5&&fungusShape.x>0.?smoothstep(${(FUNGUS_NEAR * 0.75).toFixed(1)},${FUNGUS_NEAR.toFixed(1)},far):smoothstep(fungusFade.z,fungusFade.w,far));
  // Ceiling stalactites go with the roof where it is cut away.
  if(mod(floor(flags/4.),2.)>=1.&&distance(fungusBase.xy,uReveal.xy)<uReveal.z)fade=0.;
  if(fade<=0.){gl_Position=vec4(2.,2.,2.,1.);world=vec3(0.);fungusNormal=vec3(0.,1.,0.);tint=vec3(0.);chart=vec3(0.);fungusInfo=vec4(0.);plan=vec2(0.);return;}
  // A bracket is half a lathe, its back in the wall; every other form a full turn.
  float turn=form==8?3.14159265:6.28318531;
  float angle=float(seg+dseg)*turn/float(sides)+phase-(form==8?1.57079633:0.);
  vec2 dir=vec2(cos(angle),sin(angle));
  float cap=fungusBase.w,h=fungusShape.x,stem=fungusShape.y;
  int k=fungusK(ring);
  vec2 here=fungusRing(form,k,stem,cap,h),before=fungusRing(form,fungusK(ring-1),stem,cap,h),after=fungusRing(form,fungusK(ring+1),stem,cap,h);
  if(fungusK(ring-1)==k)before=here;if(fungusK(ring+1)==k)after=here;
  vec2 t=after-before;if(dot(t,t)<1e-8)t=vec2(0.,1.);
  vec2 n2=normalize(vec2(t.y,-t.x));
  vec3 local=vec3(dir.x*here.x,here.y,dir.y*here.x)*fade;
  fungusNormal=normalize(vec3(dir.x*n2.x,n2.y,dir.y*n2.x));
  world=vec3(fungusBase.x-cameraOrigin.x+local.x,fungusBase.z*exaggeration-cameraOrigin.y+local.y,fungusBase.y-cameraOrigin.z+local.z);
  vec2 part=PART[form];
  float kind=float(k)<=part.x?0.:float(k)<=part.y?1.:2.;
  tint=fungusColor.rgb;
  float hue=floor(fungusColor.w/2.);
  chart=vec3(angle,here.y/max(abs(h),.01),kind);
  fungusInfo=vec4(fungusColor.w-2.*hue,hue,flags,float(form));
  plan=vec2(fungusBase.x+local.x,fungusBase.y+local.z);
  gl_Position=matrix*vec4(world,1.);
}`,
  fragment: `#version 300 es
precision highp float;
in vec3 world;
in vec3 fungusNormal;
in vec3 tint;
in vec3 chart;
in vec4 fungusInfo;
in vec2 plan;
uniform vec3 eye;
uniform vec4 uCavern;
uniform vec4 uTownGlow[16]; uniform int uTownGlowCount;
out vec4 color;
float fungusHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec3 n=normalize(fungusNormal),V=normalize(eye-world);
  if(dot(n,V)<0.)n=-n;
  float kind=chart.z,glow=fungusInfo.x,flags=fungusInfo.z,form=fungusInfo.w;
  vec3 hue=fungusInfo.y<.5?vec3(.35,.95,.85):fungusInfo.y<1.5?vec3(.72,.55,1.):vec3(1.,.68,.32);
  // Stem pale and matte, underside darker (gills), cap its own colour.
  vec3 albedo=kind<.5?mix(vec3(.60,.57,.52),tint,.25):kind<1.5?tint*.62:tint;
  bool ribs=mod(flags,4.)>=2.,spots=mod(flags,2.)>=1.;
  if(kind>.5&&kind<1.5&&ribs)albedo*=.78+.22*smoothstep(.2,.8,abs(sin(chart.x*24.)));                // gills
  if(kind>1.5&&ribs&&form>5.5&&form<6.5)albedo*=.7+.3*smoothstep(.1,.6,abs(sin(chart.x*7.)*sin(chart.y*26.)));   // morel ridges
  if(kind>1.5&&spots){vec2 q=vec2(chart.x*3.,chart.y*9.);vec2 i=floor(q);float s=step(.6,fungusHash(i))*(1.-smoothstep(.18,.3,length(fract(q)-.5)));albedo=mix(albedo,vec3(.72,.68,.6),.8*s);}
  // No sky: a dim ambient that shows the form from the eye, and the warm pools of the town lanterns.
  float dark=uCavern.y,wrap=.45+.55*max(dot(n,V),0.);
  float lantern=0.;
  for(int k=0;k<16;k++){if(k>=uTownGlowCount)break;vec4 g=uTownGlow[k];float d=length(plan-g.xy)/max(g.z,1.);lantern+=exp(-d*d*.9);}
  vec3 light=vec3(.93,.97,1.04)*mix(1.05,.36,dark)*wrap+vec3(1.,.74,.46)*min(lantern,1.3)*mix(.3,1.1,dark);
  vec3 c=albedo*light;
  // Bioluminescence: gills and rim glow softly, the cap faintly; a glowing carpet or cluster glows whole.
  float own=glow*(kind<.5?.15:kind<1.5?1.:form>4.5&&form<7.5||form<3.5&&chart.y<.7?.55:.3);
  c+=hue*own*mix(.25,.55,dark);
  color=vec4(mix(c,vec3(.005,.005,.007),smoothstep(uCavern.z,uCavern.w,length(world-eye))),1.);
}`,
};
/** The 2D ground's giant-mushroom grove field at a dry, level point (0-1): where the groves stand (tests and shots). */
export const fungusGroveAt = (x: number, y: number): number => ss(0.04, 0.2, udFbm(x - 517, y + 233, 520) + 0.2 * ss(0.05, 0.25, udFbm(x + 191, y + 23, 240) - 0.1) - 0.1);
/** Caps the 2D ground paints on its 31 m lattice within a box (x, y, radius), decided at their centre as in
 * underdarkMushroomCell: for tests and shots. */
export function fungusCapCells(x0: number, y0: number, x1: number, y1: number): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [],
    CELL = 31;
  for (let j = Math.floor(y0 / CELL); j <= Math.ceil(y1 / CELL); j++)
    for (let i = Math.floor(x0 / CELL); i <= Math.ceil(x1 / CELL); i++) {
      if (udHash(i + 401, j + 77) > 0.2) continue;
      const cx = udHash(i + 5, j + 71) * 0.56 + 0.22,
        cy = udHash(i + 61, j + 2) * 0.56 + 0.22,
        x = (i + cx) * CELL,
        y = (j + cy) * CELL;
      if (udHash(i + 17, j + 233) > 0.7 * fungusGroveAt(x, y)) continue;
      const room = Math.min(cx, 1 - cx, cy, 1 - cy) * CELL;
      out.push({ x, y, r: Math.min(room * 0.95, CELL * (0.16 + 0.2 * udHash(i + 23, j + 9))) });
    }
  return out;
}
