/** Satellite 3D near trees: low-poly instanced trees standing on the crowns the ground shader paints
 * (rust/bridge/terrainForest.ts, forestCrown). The placement below is a CPU port of forestCrown on the same
 * hash, lattices, field, occupation, bank and beach rasters, so each tree stands on its painted crown; the
 * painted crown under a tree turns into its ground shade (uForestTrees in FOREST_PRELUDE_GLSL). Only crowns
 * within the render distance of the eye are built; trees grow out of their painted crown between 2/3 of it and it,
 * so the far view stays exactly the painted forest. Colours follow the crown palette approximately (season,
 * autumn hues, leaf fall, snow load from a climate proxy): the painted crown keeps the exact Render colour. Display only. */
import { ForestRoom, forestCrownSetback, type ForestCorridor } from '../render/forestRoom';
import { calendarSeason, seasonWeights, type SeasonCalendar } from '../../../rust/bridge/terrainRenderV2Zones';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { FOREST_CLUMP_GLSL, FOREST_PERLIN_GLSL, FOREST_TAU_TABLE, forestHash, type ForestField, type ForestOccupation } from '../../../rust/bridge/terrainForest';

/** Render distance of the near trees (m), adjustable: full trees within `near` (2/3 of it), none beyond `far`. Beyond,
 * the painted crowns are the forest's far level of detail. */
export const TREE_DISTANCE_MIN = 200, TREE_DISTANCE_MAX = 1500, TREE_DISTANCE_DEFAULT = 600;
/** Reference of the budget: 16000 trees within 360 m. The cap grows with the area (distance squared) up to TREE_CEILING
 * (a frame costs TREE_VERTICES vertices per tree); past it, trees farther than `full` are thinned, not dropped. */
const TREE_REFERENCE_FAR = 360, TREE_REFERENCE_MAX = 16000, TREE_CEILING = 36000;
export interface TreeLimits {
  near: number; far: number;
  /** Upper bound on drawn trees. Blocks are visited nearest first, so the cap drops the farthest trees, never a hole near the eye. */
  max: number;
  /** Beyond this distance a crown is kept with probability (full / distance)², so the far ring stays populated under the cap. */
  full: number;
}
export const clampTreeDistance = (metres: number): number => Number.isFinite(metres) ? clamp(Math.round(metres), TREE_DISTANCE_MIN, TREE_DISTANCE_MAX) : TREE_DISTANCE_DEFAULT;
export function treeLimits(distance: number): TreeLimits {
  const far = clampTreeDistance(distance), scale = (far / TREE_REFERENCE_FAR) ** 2, uncapped = TREE_REFERENCE_MAX * scale;
  let full = far;
  if (uncapped > TREE_CEILING) {
    // Expected count with the thinning, relative to the reference density: f(R) = R²(1 + 2 ln(far / R)), increasing up to far.
    const target = TREE_CEILING / TREE_REFERENCE_MAX * TREE_REFERENCE_FAR ** 2;
    let lo = 1, hi = far;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (mid * mid * (1 + 2 * Math.log(far / mid)) < target) lo = mid; else hi = mid; }
    full = lo;
  }
  return { near: far * 2 / 3, far, max: Math.round(Math.min(uncapped, TREE_CEILING)), full };
}
/** Soft upper bound: ~x for small x, never above `cap` (natural variation survives, no pile of identical giants). */
const softCap = (x: number, cap: number): number => cap * Math.tanh(x / cap);
/** Realistic sizes next to 3 m storeys (display only, no vertical exaggeration on either): a mature broadleaf stand
 * of 20-30 m gives 15-22 m trees under 25 m with 4-10 m wide crowns, a conifer up to 30 m with a 5 m wide spire. */
const TREE_HEIGHT_CAP = { broad: 25, needle: 30 }, TREE_RADIUS_CAP = { broad: 5, needle: 2.8 };
/** World blocks between two partial installs of a stream that is still being built (nearest blocks first). */
const PARTIAL_BLOCKS = 96;
const SEGMENTS = 12, BANDS = 6;
export const TREE_VERTICES = SEGMENTS * BANDS * 6;
/** Floats per instance: (x, y, ground z, r) (h, crown depth, needle, phase) (r, g, b, leafless flag + .45 x snow load). */
export const TREE_STRIDE = 12;

export interface TreeInputs {
  field: ForestField; occupation?: ForestOccupation; seed: number; climate: { temperature: number; precipitation: number };
  renderV2: number; zone: number; season: number;
  /** Calendar setting 'crownSnow' (0 bare crowns, 1 heavily laden); the zone default when absent. */
  crownSnow?: number;
  /** Climate zone and calendar of the map: the deciduous leaf state and the larch share, as the painted crowns read them
   * (v2SeasonLeaf, v2SeasonClimate). Absent: a climate proxy. */
  climateZone?: ClimateZone; calendar?: SeasonCalendar;
  /** Displayed water cover 0..1 at a point (tile water masks); undefined: dry. */
  water(x: number, y: number): number;
  height(x: number, y: number): number | undefined;
}
export interface TreeView { x: number; y: number; forwardX: number; forwardY: number; /** Render distance (m); the default when absent. */ distance?: number }

const V2_ZONE_FOREST: readonly (readonly [number, number, number])[] = [
  [1, .12, .45], [.62, .30, .45], [1, .55, .55], [1, .92, .75], [1, .90, .85], [.05, .98, .95], [.22, .20, .50], [.12, 0, 1], [.42, 0, 1], [1, 0, 1], [.55, .08, .70]];
const CROWN_CDF = [0, 0, 0, .0005, .0063, .0336, .1125, .2742, .4998, .7261, .8874, .9665, .9936, .9994, 1, 1, 1];
const sstep = (a: number, b: number, v: number): number => { let t = (v - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp = (v: number, a = 0, b = 1): number => v < a ? a : v > b ? b : v;
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const u8 = (h: number, shift: number): number => (((h >>> shift) & 255) + .5) / 256;
const tauOf = (d: number): number => { const u = clamp(d, 0, .985) * 32, k = Math.min(Math.floor(u), 31); return mix(FOREST_TAU_TABLE[k], FOREST_TAU_TABLE[k + 1], u - k); };
const rhoOf = (tau: number): number => .5 + .4 * Math.max(0, (tau - .55) / .45);
const lookupCrown = (x: number): number => { const u = clamp(x) * 16, k = Math.min(Math.floor(u), 15); return mix(CROWN_CDF[k], CROWN_CDF[k + 1], u - k); };
const radiusOf = (height: number, needle: number, dry: number): number => mix((.24 * height + 1) * (1 + .45 * dry), .07 * height + .55, needle);
const heightGate = (h: number): number => sstep(2, 6, h);

/** Bilinear RGBA8 sample (0..255 per channel) of a square raster with texel centres at x+(i+.5)·width/n, clamped. */
function bilinear(rgba: Uint8Array, n: number, x0: number, y0: number, width: number, x: number, y: number, out: Float64Array): boolean {
  const u = (x - x0) / width, v = (y - y0) / width;
  if (u < 0 || v < 0 || u > 1 || v > 1) return false;
  const gx = u * n - .5, gy = v * n - .5, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
  const i0 = clamp(ix, 0, n - 1), i1 = clamp(ix + 1, 0, n - 1), j0 = clamp(iy, 0, n - 1), j1 = clamp(iy + 1, 0, n - 1);
  for (let c = 0; c < 4; c++) {
    const a = rgba[(j0 * n + i0) * 4 + c], b = rgba[(j0 * n + i1) * 4 + c], d = rgba[(j1 * n + i0) * 4 + c], e = rgba[(j1 * n + i1) * 4 + c];
    out[c] = (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
  }
  return true;
}

/** Same gradients, fades and lattices as forestGradient/forestPerlin/forestGlade. */
function gradient(cx: number, cy: number, seed: number, out: number[]): void {
  const h = forestHash(cx, cy, 991, (seed ^ 0x6a09e667) >>> 0);
  out[0] = (h & 255) / 128 + (.5 / 128 - 1); out[1] = ((h >>> 8) & 255) / 128 + (.5 / 128 - 1);
}
const g00 = [0, 0], g10 = [0, 0], g01 = [0, 0], g11 = [0, 0];
function perlin(x: number, y: number, ox: number, oy: number, seed: number): number {
  const cx = Math.floor(x), cy = Math.floor(y), fx = x - cx, fy = y - cy;
  gradient(cx + ox, cy + oy, seed, g00); gradient(cx + ox + 1, cy + oy, seed, g10); gradient(cx + ox, cy + oy + 1, seed, g01); gradient(cx + ox + 1, cy + oy + 1, seed, g11);
  const n00 = g00[0] * fx + g00[1] * fy, n10 = g10[0] * (fx - 1) + g10[1] * fy, n01 = g01[0] * fx + g01[1] * (fy - 1), n11 = g11[0] * (fx - 1) + g11[1] * (fy - 1);
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  return n00 + ux * (n10 - n00) + uy * (n01 - n00) + ux * uy * (n00 - n10 - n01 + n11);
}
function patchValue(x: number, y: number, seed: number): number {
  const fine = perlin(x / 56, y / 56, 0, 0, seed);
  // mat2(.83,.39,-.21,1.27) is column-major in GLSL.
  const glade = perlin((.83 * x - .21 * y) / 210 + 43.1, (.39 * x + 1.27 * y) / 210 - 17.7, 7919, -4421, seed);
  return clamp((.5 * fine + .866 * glade) * .6 + .5);
}

interface Stand { cover: number; height: number; needle: number }
interface Climate { trop: number; dry: number; humid: number; kind: [number, number, number]; kappaBase: number }

/** Builds the instance stream of the crowns within the render distance of the eye, in front of it. */
export function buildNearTrees(inputs: TreeInputs, view: TreeView): Float32Array {
  const work = buildNearTreesSteps(inputs, view);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

const wayRooms = new WeakMap<object, ForestRoom>();
/** One point index per list of ways, kept with the occupation that carries it. */
function wayRoomOf(ways: NonNullable<ForestOccupation['ways']>): ForestRoom {
  let room = wayRooms.get(ways);
  if (!room) wayRooms.set(ways, room = new ForestRoom(ways as readonly ForestCorridor[], []));
  return room;
}
/** Same instance order and arithmetic, with one bounded world block per step. Blocks run nearest first; `partial`
 * receives the stream built so far every PARTIAL_BLOCKS blocks, so trees appear around the eye before the rest. */
export function* buildNearTreesSteps(inputs: TreeInputs, view: TreeView, partial?: (values: Float32Array) => void): Generator<void, Float32Array> {
  const limits = treeLimits(view.distance ?? TREE_DISTANCE_DEFAULT), TREE_FAR = limits.far, TREE_MAX = limits.max, full2 = limits.full * limits.full;
  const { field, occupation: occ, seed } = inputs, T = inputs.climate.temperature, P = inputs.climate.precipitation;
  const humid = P / Math.max(20 * T + 280, 120), trop = sstep(13, 19, T - 6), dry = 1 - sstep(.8, 2, humid);
  const savanna = trop * sstep(.3, .6, dry);
  const kind: [number, number, number] = [(1 - trop) * sstep(10, 14, T) * sstep(.35, .7, dry), trop - savanna, savanna];
  const climate: Climate = { trop, dry, humid, kind, kappaBase: mix(.25, .78, sstep(.9, 1.8, humid)) * (1 - .6 * trop) * (1 - .5 * kind[0]) * (1 - .85 * kind[2]) };
  const zone = inputs.renderV2 > 0 && inputs.zone > 0 ? V2_ZONE_FOREST[clamp(inputs.zone - 1, 0, 10)] : undefined;
  const px = new Float64Array(4), crownSeed = (seed ^ 0x2c1b3c6d) >>> 0;
  const fieldAt = (x: number, y: number): Stand | undefined => {
    if (!bilinear(field.rgba, field.n, field.x, field.y, field.width, x, y, px)) return undefined;
    let cover = px[0] / 255, needle = px[2] / 255;
    if (zone) { cover = clamp(cover * zone[0]); needle = mix(needle, zone[1], zone[2]); }
    return { cover, height: px[1] / 255 * 50 * (zone && inputs.zone === 6 ? .35 : 1), needle };
  };
  const occCell = occ ? occ.width / occ.n : 1;
  // Exact ways: no trunk stands on a road or a street, whatever the raster resolution (crowns may still overhang an earth way).
  const wayRoom = occ?.ways?.length ? wayRoomOf(occ.ways) : undefined;
  const occAt = (x: number, y: number): [number, number, number] | undefined => {
    if (!occ || !bilinear(occ.rgba, occ.n, occ.x, occ.y, occ.width, x, y, px)) return undefined;
    const i = clamp(Math.floor((x - occ.x) / occ.width * occ.n), 0, occ.n - 1), j = clamp(Math.floor((y - occ.y) / occ.width * occ.n), 0, occ.n - 1);
    return [(px[0] - 128) / 16 * occCell, (px[1] - 128) / 16 * occCell, occ.rgba[(j * occ.n + i) * 4 + 2]];
  };
  const bankRange = 48 + 3 * field.width / field.n, bankDensity = field.bankDensity ?? 1;
  const bankDens = (w: number): number => { const c = .55 + .35 * sstep(8, 36, w); return 1 - Math.pow(1 - c, Math.max(bankDensity, 0)); };
  const bankAt = (x: number, y: number): [number, number] => {
    if (!field.bank || !bilinear(field.bank, field.n, field.x, field.y, field.width, x, y, px)) return [-1e3, 0];
    const w = px[2] / 2; if (w <= 0) return [-1e3, 0];
    return [w - Math.hypot(px[0] - 128, px[1] - 128) * (bankRange / 127), w];
  };
  const gallery = (b: [number, number]): number => b[0] > 0 ? bankDens(b[1]) * (1 - .6 * sstep(.35, 1, 1 - b[0] / Math.max(b[1], 1))) : 0;
  const beach = field.beach;
  const beachAt = (x: number, y: number): number => {
    if (!beach || inputs.renderV2 <= 0) return 0;
    const u = (x - beach.x) / beach.width * beach.n - .5, v = (y - beach.y) / beach.width * beach.n - .5;
    if (u < -.5 || v < -.5 || u > beach.n - .5 || v > beach.n - .5) return 0;
    const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, n = beach.n;
    const at = (a: number, b: number): number => beach.data[clamp(b, 0, n - 1) * n + clamp(a, 0, n - 1)];
    return ((at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy) / 255;
  };
  const kappaOf = (height: number, needle: number): number => climate.kappaBase * mix(.55, 1, sstep(3, 10, height)) * mix(1, .85, needle);
  const density = (c: number, kappa: number): number => clamp(c + kappa * (1 - .5 * sstep(.55, .9, c)) * (.985 - c), c, .985);

  // Lattice levels a fragment at (x, y) searches (forestCanopyNear): its stand's level and the next.
  const levelsAt = (x: number, y: number): [number, number, number] | undefined => {
    const st = fieldAt(x, y); if (!st) return undefined;
    const o = occAt(x, y);
    const cover = o && o[1] > 0 && o[0] < 0 ? Math.max(st.cover, .25 * heightGate(st.height)) : st.cover;
    const b = bankAt(x, y), near = b[0] > -16 ? bankDens(b[1]) : 0;
    const dl = Math.max(density(cover, kappaOf(st.height, st.needle)), near);
    const level = clamp(2 * Math.log2(radiusOf(st.height, st.needle, dry) / rhoOf(tauOf(dl)) / 2), 0, 5.999), l0 = Math.floor(level), w = level - l0;
    return [l0, 1 - Math.pow(1 - dl, 1 - w), 1 - Math.pow(1 - dl, w)];
  };

  const season = inputs.season, sx = Math.max(-Math.sin(6.2831853 * season), 0);
  const at = (season % 1 + 1) % 1 * 4, winter = Math.max(0, 1 - Math.min(Math.abs(at), Math.abs(at - 4)));
  const evergreen = inputs.renderV2 > 0 ? kind[0] + kind[1] : 1;
  // Deciduous leaf state and larch share of the zone's year, as the painted crowns under these trees read them.
  const year = inputs.renderV2 > 0 && inputs.climateZone ? calendarSeason(inputs.climateZone, inputs.calendar) : undefined, w = seasonWeights(season);
  const leaf = year ? clamp(year.leaf.reduce((sum, v, i) => sum + v * w[i], 0)) : 1 - winter * (1 - evergreen) * .9, larchShare = year?.larch ?? 0;
  const snow = inputs.renderV2 > 0 ? winter * (1 - sstep(2, 10, T)) : 0, crownSnow = clamp(inputs.crownSnow ?? .7);
  // Mean crown load of forestSnowLoad; the tree shader spreads it over the crown (instance colour w, fraction).
  const snowLoad = (needle: boolean): number => .45 * snow * (needle ? mix(.24, .62, crownSnow) : mix(.2, .8, crownSnow));
  const temperate = 1 - kind[0] - kind[1] - kind[2];
  const out: number[] = [];
  // Planted trees precede the natural candidates in the same budgeted stream and GPU buffer.
  // Decode the same nearest detail texel and use the shader's hash/grid, including its crown setback.
  const detail = occ?.detail;
  // Exact parcel boundaries supplement the categorical raster along sub-texel edges.
  const orchardRoom = detail?.orchards?.length ? new ForestRoom([], detail.orchards) : undefined;
  const inside = (ring: readonly { x: number; y: number }[], x: number, y: number): boolean => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  for (const patch of detail?.orchards ?? []) {
    const [ca, sa] = patch.along;
    const us = patch.poly.map(p => p.x * ca + p.y * sa), vs = patch.poly.map(p => -p.x * sa + p.y * ca);
    const eyeU = view.x * ca + view.y * sa, eyeV = -view.x * sa + view.y * ca;
    const i0 = Math.floor(Math.max(Math.min(...us), eyeU - TREE_FAR - 1) / 8), i1 = Math.ceil(Math.min(Math.max(...us), eyeU + TREE_FAR + 1) / 8);
    const j0 = Math.floor(Math.max(Math.min(...vs), eyeV - TREE_FAR - 1) / 8), j1 = Math.ceil(Math.min(Math.max(...vs), eyeV + TREE_FAR + 1) / 8);
    for (let j = j0; j <= j1; j++) {
      yield;
      for (let i = i0; i <= i1; i++) {
        const h = forestHash(i, j, 877, seed), h2 = forestHash(i, j, 878, seed);
        const u = (i + .5 + (u8(h, 0) - .5) * .12) * 8, v = (j + .5 + (u8(h, 8) - .5) * .12) * 8;
        const x = ca * u - sa * v, y = sa * u + ca * v, dx = x - view.x, dy = y - view.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > TREE_FAR * TREE_FAR || dx * view.forwardX + dy * view.forwardY < -48) continue;
        if (d2 > full2 && u8(forestHash(i, j, 879, seed), 0) >= full2 / d2) continue;
        if (!inside(patch.poly, x, y) || patch.holes?.some(hole => inside(hole, x, y)) || occAt(x, y)?.[2] !== 4) continue;
        const di = clamp(Math.floor((x - detail!.x) / detail!.width * detail!.n), 0, detail!.n - 1), dj = clamp(Math.floor((y - detail!.y) / detail!.width * detail!.n), 0, detail!.n - 1);
        const d = (dj * detail!.n + di) * 4, radius = 2.3 + .4 * u8(h, 16), height = 6 + 1.2 * u8(h2, 16);
        const a = .5 * Math.atan2(detail!.rgba[d + 2] / 255 * 2 - 1, detail!.rgba[d + 1] / 255 * 2 - 1);
        if (Math.cos(a) * ca + Math.sin(a) * sa <= .9999 || detail!.rgba[d + 3] / 255 * 6 <= radius * 1.2) continue;
        if (heightGate(fieldAt(x, y)?.height ?? 0) <= .5 || inputs.water(x, y) >= .05) continue;
        const z = inputs.height(x, y); if (z === undefined || z <= 0) continue;
        const tint = u8(Math.imul(h2, 0x9e3779b9) >>> 0, 0), tone = .86 + .28 * tint;
        const summer = .5 - .5 * Math.cos(6.2831853 * (inputs.renderV2 > 0 ? season : .5));
        const fruitLeaf = inputs.renderV2 > 0 ? leaf : 1;
        const fall = sx * temperate * .65;
        let c = [mix(.25, .22, summer) * tone, mix(.34, .37, summer) * tone, mix(.15, .16, summer) * tone];
        c = c.map((v, k) => mix(mix(v, [.47, .34, .12][k], fall), [.31, .27, .23][k] * (.85 + .3 * tint), 1 - fruitLeaf));
        out.push(x, y, z, radius, height, radius * .8, 0, u8(h, 24) * 6.2831853 + tint, c[0], c[1], c[2], (fruitLeaf < .5 ? 1 : 0) + snowLoad(false));
        if (out.length >= TREE_MAX * TREE_STRIDE) return new Float32Array(out);
      }
    }
  }
  const far2 = TREE_FAR * TREE_FAR, block = 24;
  const bx0 = Math.floor((view.x - TREE_FAR) / block), bx1 = Math.floor((view.x + TREE_FAR) / block);
  const by0 = Math.floor((view.y - TREE_FAR) / block), by1 = Math.floor((view.y + TREE_FAR) / block);
  // Visible blocks, nearest first: partial streams and the instance cap both keep the trees around the eye.
  const blocks: [number, number, number][] = [];
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
    const dx = (bx + .5) * block - view.x, dy = (by + .5) * block - view.y, d2 = dx * dx + dy * dy;
    if (d2 > (TREE_FAR + block) ** 2 || dx * view.forwardX + dy * view.forwardY < -2 * block) continue;
    blocks.push([d2, bx, by]);
  }
  blocks.sort((a, b) => a[0] - b[0]);
  let shown = out.length;
  for (let b = 0; b < blocks.length; b++) {
    yield;
    if (partial && b > 0 && b % PARTIAL_BLOCKS === 0 && out.length > shown) { shown = out.length; partial(new Float32Array(out)); }
    const bx = blocks[b][1], by = blocks[b][2], cxm = (bx + .5) * block, cym = (by + .5) * block;
    const levels = levelsAt(cxm, cym); if (!levels) continue;
    for (let k = 0; k < 2; k++) {
      if ((k === 0 ? levels[1] : levels[2]) <= .002) continue;
      const level = levels[0] + k, s = 2 * Math.pow(2, level * .5);
      const i0 = Math.floor(bx * block / s), i1 = Math.floor((bx + 1) * block / s), j0 = Math.floor(by * block / s), j1 = Math.floor((by + 1) * block / s);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const h = forestHash(i, j, level * 2, crownSeed), h2 = forestHash(i, j, level * 2 + 1, crownSeed);
        const cx = (i + .15 + .7 * u8(h, 0)) * s, cy = (j + .15 + .7 * u8(h, 8)) * s;
        // Each crown belongs to the block holding its centre.
        if (Math.floor(cx / block) !== bx || Math.floor(cy / block) !== by) continue;
        const ex = cx - view.x, ey = cy - view.y;
        const e2 = ex * ex + ey * ey;
        if (e2 > far2) continue;
        if (e2 > full2 && u8(forestHash(i, j, level * 2 + 61, crownSeed), 0) >= full2 / e2) continue;
        if (orchardRoom && !orchardRoom.keeps(cx, cy, 0)) continue;
        if (wayRoom && !wayRoom.keeps(cx, cy, .5)) continue;
        const centre = fieldAt(cx, cy); if (!centre) continue;
        let { cover, needle } = centre; const height = centre.height;
        let open = -1e3, forced = -1e3, allow = 0, hedge = 0, openGallery = .5, occupied = false, tilledPlot = false;
        const o = occAt(cx, cy);
        if (o) {
          open = o[0]; forced = o[1]; const cls = o[2];
          tilledPlot = cls === 5;   // kitchen and market-garden plots root no crown
          allow = (cls === 6 ? .12 : cls === 3 ? .05 : cls === 2 ? .02 : cls === 7 ? .03 : 0) * heightGate(height);
          hedge = (cls >= 1 && cls <= 3 ? .6 : 0) * sstep(3, 8, height) * (1 - dry);
          if (cls === 7 || cls === 8 || cls === 9 || cls === 11) openGallery = 0;
          occupied = cls === 4 || cls === 8 || cls === 9 || cls === 11 || cls === 12;
        }
        if (forced > 0) cover = Math.max(cover, .25 * heightGate(height));
        let kappa = kappaOf(height, needle);
        const gal = gallery(bankAt(cx, cy));
        let riparian = false;
        if (gal > cover) { riparian = true; cover = gal; kappa = 0; needle *= .3; }
        const dens = density(cover, kappa), share = cover / Math.max(dens, 1e-3), radius = radiusOf(height, needle, dry);
        if (o && occ && open < 0 && open > -radius) {
          const e = occCell, openAt = (x: number, y: number): number => occAt(x, y)?.[0] ?? -1e3;
          const gx = openAt(cx + e, cy) - openAt(cx - e, cy), gy = openAt(cx, cy + e) - openAt(cx, cy - e), gl = Math.max(Math.hypot(gx, gy), 1e-4);
          const side = occAt(cx + gx / gl * (.5 * e - open), cy + gy / gl * (.5 * e - open))?.[2] ?? 0;
          if ((side === 4 || side === 8 || side === 9 || side === 11) && open > -forestCrownSetback(radius, u8(h2, 16))) occupied = true;
        }
        if (occupied) continue;
        const centreLevel = clamp(2 * Math.log2(radius / rhoOf(tauOf(dens)) / 2), 0, 5.999);
        const weight = Math.max(0, 1 - Math.abs(centreLevel - level));
        const tau = tauOf(1 - Math.pow(1 - dens, weight)), q = Math.min(1, tau / .55), rho = rhoOf(tau);
        let threshold = lookupCrown(.8 * patchValue(cx, cy, seed) + .2 * u8(h2, 0));
        const krumm = (1 - sstep(3, 7, height)) * sstep(.35, .7, needle); threshold = mix(threshold, u8(h2, 0), krumm);
        const beyond = open + (u8(Math.imul(h, 0x165667b1) >>> 0, 8) - .5) * radius;
        let alive: boolean, edge: number;
        if (beyond > 0) {
          const stray = .18 * (1 - sstep(0, 4 * radius, open)) * Math.min(cover * 3, 1);
          alive = !tilledPlot && u8(Math.imul(h2, 0x27d4eb2d) >>> 0, 24) < Math.max(allow + (open < 5 ? hedge : 0) + stray, openGallery * gal); edge = 1;
        } else { alive = u8(h, 16) < q && threshold < share; edge = 1 - sstep(0, .1, share - threshold); }
        if (!alive || inputs.water(cx, cy) >= (inputs.renderV2 > 0 ? .05 : .5)) continue;
        if (inputs.renderV2 > 0 && u8(forestHash(i, j, level * 2 + 37, crownSeed), 0) < beachAt(cx, cy)) continue;
        const isNeedle = u8(h2, 8) < needle, larch = isNeedle && u8(Math.imul(h, 0x27d4eb2d) >>> 0, 16) < larchShare, emergent = kind[1] * sstep(.9, .97, u8(h2, 24));
        const r = Math.min(rho * s * (.8 + .4 * u8(h, 24)) * (1 + .1 * edge) * (beyond > 0 ? .75 : 1) * (1 + .6 * emergent + .3 * krumm), 1.14 * s);
        const th = height * (mix(.82, .66, kind[1]) + mix(.36, .6, kind[1]) * u8(h2, 16)) * (1 + .45 * emergent);
        const depth = r * (isNeedle ? mix(3.2, 1.1, krumm) : mix(.55, .22, kind[2]));
        if (th < 1.5 || r < .4) continue;
        const z = inputs.height(cx, cy); if (z === undefined || z <= 0) continue;
        // Approximate crown colour (display RGB): stand palette, per-tree tone, autumn hue, leaf fall, snow.
        const tint = u8(Math.imul(h2, 0x9e3779b9) >>> 0, 0), tone = .86 + .28 * tint;
        let c: [number, number, number] = isNeedle ? [.15, .23, .16] : [mix(.24, .27, dry), mix(.33, .31, dry), mix(.15, .19, dry)];
        if (riparian) c = [c[0] * 1.06, c[1] * 1.08, c[2] * .96];
        c = [c[0] * tone, c[1] * tone, c[2] * tone];
        if (larch && inputs.renderV2 > 0) {
          // Larches: gold in autumn, bare in winter, as their painted crowns.
          const t = .85 * sx, gold = .9 + .2 * tint;
          c = [mix(c[0], .70 * gold, t), mix(c[1], .52 * gold, t), mix(c[2], .17 * gold, t)];
          c = [mix(c[0], .31 * (.85 + .3 * tint), 1 - leaf), mix(c[1], .27 * (.85 + .3 * tint), 1 - leaf), mix(c[2], .23 * (.85 + .3 * tint), 1 - leaf)];
        }
        if (!isNeedle && inputs.renderV2 > 0) {
          const fall = sx * temperate;
          if (fall > 0) {
            const pick = (tint * 5.31) % 1, late = (tint * 3.77) % 1;
            const hue = pick < .38 ? [.86, .46, .07] : pick < .56 ? [.64, .18, .07] : pick < .86 ? [.86, .66, .10] : [.30, .40, .12];
            const lift = pick < .38 ? 1.35 : pick < .56 ? 1.08 : pick < .86 ? 1.4 : 1;
            const lum = .2126 * c[0] + .7152 * c[1] + .0722 * c[2], hueLum = .2126 * hue[0] + .7152 * hue[1] + .0722 * hue[2];
            const t = fall * (pick < .86 ? .92 : .4) * (.75 + .25 * late);
            c = [mix(c[0], hue[0] * lum * lift / hueLum, t), mix(c[1], hue[1] * lum * lift / hueLum, t), mix(c[2], hue[2] * lum * lift / hueLum, t)];
          }
          const bare = [.31 * (.85 + .3 * tint), .27 * (.85 + .3 * tint), .23 * (.85 + .3 * tint)];
          c = [mix(c[0], bare[0], 1 - leaf), mix(c[1], bare[1], 1 - leaf), mix(c[2], bare[2], 1 - leaf)];
        }
        // Same centre as the painted crown it stands on, at real sizes next to the buildings (3 m storeys): heights and
        // radii saturate smoothly below TREE_HEIGHT_CAP / TREE_RADIUS_CAP. Stand crowns widen a little so the canopy closes.
        const kindCap = isNeedle ? 'needle' : 'broad';
        const tree = softCap(th, TREE_HEIGHT_CAP[kindCap]), width = softCap(r * (beyond > 0 ? 1 : 1.12), TREE_RADIUS_CAP[kindCap]);
        // Keep the whole modelled forest crown off planted parcels, including sub-texel boundary slivers.
        if (orchardRoom && open > -1.5 * radius) {
          let overlaps = false;
          for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4;
            if (!orchardRoom.keeps(cx + 1.22 * width * Math.cos(a), cy + 1.22 * width * Math.sin(a), 0)) { overlaps = true; break; }
          }
          if (overlaps) continue;
        }
        out.push(cx, cy, z, width, tree, Math.min(depth * tree / th, .94 * tree), isNeedle ? 1 : 0, u8(h, 24) * 6.2831853 + tint, c[0], c[1], c[2], ((!isNeedle || larch) && leaf < .5 ? 1 : 0) + snowLoad(isNeedle));
        if (out.length >= TREE_MAX * TREE_STRIDE) return new Float32Array(out);
      }
    }
  }
  return new Float32Array(out);
}

/** Instanced low-poly trees, one lathe per instance from gl_VertexID: a trunk, then stacked cones (conifers)
 * or a lumpy ellipsoid (broadleaf). Translated to WGSL by web/scripts/wgsl_shaders_3d.ts. */
export const TREE_3D_GLSL = {
  vertex: `#version 300 es
precision highp float;
layout(location=0) in vec4 treeBase;
layout(location=1) in vec4 treeShape;
layout(location=2) in vec4 treeColor;
uniform mat4 matrix;
uniform vec3 cameraOrigin;
uniform float exaggeration;
uniform vec4 treeFade;
out vec3 world;
out vec3 treeNormal;
out vec3 tint;
out float treeLevel;
// Crown chart for the leaf clumps: xy the crown surface unrolled from its top (direction times the profile's arc
// length in metres, so clumps keep their metric size down the flanks and stick to the tree), z a per-tree seed, w the
// crown radius. Info: x needle, y no foliage (trunk, leafless crown), z snow share, w rim distance (0 top, 1 rim).
out vec4 crownChart;
out vec4 crownInfo;
const float BROAD_U[5]=float[5](0.,.22,.5,.8,1.);
const float BROAD_R[5]=float[5](.5,.93,1.,.74,0.);
const float NEEDLE_U[5]=float[5](0.,.34,.37,.68,1.);
const float NEEDLE_R[5]=float[5](1.,.62,.82,.42,0.);
void main(){
  int v=int(gl_VertexID),quad=v/6,corner=v-quad*6;
  int band=quad/${SEGMENTS},seg=quad-band*${SEGMENTS};
  int dseg=corner==1||corner==2||corner==4?1:0,dring=corner==2||corner==4||corner==5?1:0;
  int ring=band+dring;
  float fade=1.-smoothstep(treeFade.z,treeFade.w,distance(treeBase.xy,treeFade.xy));
  if(fade<=0.){gl_Position=vec4(2.,2.,2.,1.);world=vec3(0.);treeNormal=vec3(0.,1.,0.);tint=vec3(0.);treeLevel=0.;crownChart=vec4(0.);crownInfo=vec4(0.,1.,0.,0.);return;}
  bool needle=treeShape.z>.5;
  float r=treeBase.w,h=treeShape.x,bottom=needle?min(max(h-treeShape.y,.05*h),.1*h):clamp(h-treeShape.y,.3*h,.4*h);
  // A broadleaf seen from the side is a full crown on a short bole, deeper than its painted dome suggests.
  float angle=float(seg+dseg)*${(2 * Math.PI / SEGMENTS).toFixed(7)}+treeShape.w;
  vec2 dir=vec2(cos(angle),sin(angle));
  float trunk=max(.07*r,.12),radius,y;
  // Snow: the mean load of the crown is the fraction of treeColor.w over .45 (its integer part is the leafless flag).
  // It lies on the top of the crown and on a spire's bough tips; the gaps between boughs and the underside stay dark.
  float load=fract(treeColor.w)/.45,cap=0.,arc=0.;
  if(ring<2){radius=trunk;y=ring==0?-.4:bottom;}
  else {
    int k=ring-2;float u=needle?NEEDLE_U[k]:BROAD_U[k];
    for(int j=k;j<4;j++){
      float du=(needle?NEEDLE_U[j+1]-NEEDLE_U[j]:BROAD_U[j+1]-BROAD_U[j])*(h-bottom),dr=(needle?NEEDLE_R[j+1]-NEEDLE_R[j]:BROAD_R[j+1]-BROAD_R[j])*r;
      arc+=sqrt(du*du+dr*dr);
    }
    cap=needle?((seg+dseg)%2==0?1.3:.45)*mix(.8,1.2,u):mix(.45,1.4,u);
    radius=r*(needle?NEEDLE_R[k]:BROAD_R[k]);y=bottom+u*(h-bottom);
    // Alternating branch tips keep spruce serrated from above while the stacked cones keep a narrow spire.
    if(needle)radius*=((seg+dseg)%2==0?1.:.68)*(1.+.045*sin(3.*angle+treeShape.w));
    // Leafless broadleaves keep a narrower, sparser outline; leafy ones get lumps.
    if(!needle)radius*=(1.+.13*sin(3.*angle+2.*treeShape.w)*(1.-abs(u-.5)*1.4))*(treeColor.w>.5?.8:1.);
  }
  vec3 local=vec3(dir.x*radius,y*fade,dir.y*radius);
  if(ring<2)treeNormal=vec3(dir.x,0.,dir.y);
  else if(needle)treeNormal=normalize(vec3(dir*(h-bottom),r).xzy);
  else {float mid=.5*(bottom+h),hd=max(.5*(h-bottom),.1);treeNormal=normalize(vec3(local.x/(r*r),(y-mid)/(hd*hd),local.z/(r*r)));}
  world=vec3(treeBase.x-cameraOrigin.x+local.x,treeBase.z*exaggeration-cameraOrigin.y+local.y,treeBase.y-cameraOrigin.z+local.z);
  tint=ring<2?vec3(.24,.19,.14):treeColor.rgb;
  treeLevel=ring<2?0.:clamp((y-bottom)/max(h-bottom,.1),0.,1.);
  crownChart=vec4(dir*arc,fract(treeShape.w*.15915494),r);
  crownInfo=vec4(needle?1.:0.,ring<2||treeColor.w>.5?1.:0.,ring<2?0.:min(load*cap,.95),min(arc/max(r,.1),1.));
  gl_Position=matrix*vec4(world,1.);
}`,
  fragment: `#version 300 es
precision highp float;
in vec3 world;
in vec3 treeNormal;
in vec3 tint;
in float treeLevel;
in vec4 crownChart;
in vec4 crownInfo;
uniform vec3 eye;
uniform vec3 treeLight;
uniform float fogDistance;
uniform int uNight;
out vec4 color;
float groundSmooth(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
// Same gradient decoding as the painted crowns' forestGradient; the lattice seed is free (each crown offsets its lookup).
vec2 forestGradient(ivec2 c){
  uvec2 p=uvec2(c);uint h=(p.x*0x9e3779b9u)^(p.y*0x85ebca6bu)^0x6a09e667u;
  h=(h^(h>>16u))*0x7feb352du;h=h^(h>>15u);
  return vec2(float(h&255u),float((h>>8u)&255u))*(1./128.)+(.5/128.-1.);
}
${FOREST_PERLIN_GLSL}
${FOREST_CLUMP_GLSL}
void main(){
  vec3 n=normalize(treeNormal),l=normalize(treeLight);
  // Pixel footprint (m), taken before any branch, as the 3D ground does for the painted crowns.
  float fp=max(.001,max(length(dFdx(world)),length(dFdy(world))));
  vec3 albedo=tint;float snow=crownInfo.z,r=crownChart.w,foliage=1.-crownInfo.y;
  // Leaf clumps of the painted crowns (applyForest): same metric scale, strength, rim weighting and fade with the
  // footprint; nothing once the crown spans under a few pixels. Needles carry a weak albedo grain and no relief.
  if(foliage>0.&&r>2.5*fp){
    vec3 clump=forestClump(crownChart.xy,r,fp,crownChart.z);
    float detail=foliage*(crownInfo.x>.5?.3:1.)*mix(.55,1.,crownInfo.w);
    albedo*=1.+.3*detail*clump.x;
    // Snow gathers on the clumps and leaves the gaps dark, as on the painted crowns.
    snow=min(snow*(1.+1.5*detail*clump.x),.95);
    if(crownInfo.x<.5){
      // Clump relief in the chart, laid on the surface: radial chart axis along the meridian, the other around it.
      float len=length(crownChart.xy);vec2 d=len>1e-4?crownChart.xy/len:vec2(1.,0.);
      vec3 across=vec3(-d.y,0.,d.x),down=cross(n,across);
      vec2 g=clump.yz;
      n=normalize(n-detail*(dot(g,d)*down+dot(g,vec2(-d.y,d.x))*across));
    }
  }
  albedo=mix(albedo,vec3(.84,.88,.90),snow);
  // Relative to an upward crown top, the colour the painted crown shows from above.
  float lit=(.5+.62*max(dot(n,l),0.))/(.5+.62*max(l.y,0.));
  float occ=mix(.58,1.,treeLevel);
  vec3 base=albedo*lit*occ;
  if(uNight==1)base*=vec3(.149,.196,.31);
  float fog=1.-exp(-pow(length(world-eye)/fogDistance,2.)*.11);
  base=mix(base,uNight==1?vec3(.018,.028,.065):vec3(.77,.85,.88),min(.62,fog));
  color=vec4(base,1.);
}`,
};
