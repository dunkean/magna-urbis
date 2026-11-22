/** Satellite 3D near trees: low-poly instanced trees standing on the crowns the ground shader paints
 * (rust/bridge/terrainForest.ts, forestCrown). The placement below is a CPU port of forestCrown on the same
 * hash, lattices, field, occupation, bank and beach rasters, so each tree stands on its painted crown; the
 * painted crown under a tree turns into its ground shade (uForestTrees in FOREST_PRELUDE_GLSL). Only crowns
 * within the render distance of the eye are built; trees grow out of their painted crown between 2/3 of it and it,
 * so the far view stays exactly the painted forest. Placement and radius follow the painted crown; height and crown
 * form follow the tree's social class in its stand and its biome (terrainForestStature.ts, treeForm), with rare giants. Colours follow the crown palette approximately (season,
 * autumn hues, leaf fall, snow load from a climate proxy): the painted crown keeps the exact Render colour. Display only. */
import { ForestClearingRoom } from '../render/forestClearance';
import { ForestRoom, forestCrownSetback, type ForestCorridor } from '../render/forestRoom';
import { calendarSeason, seasonWeights, type SeasonCalendar } from '../../../rust/bridge/terrainRenderV2Zones';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { FOREST_BIOMES, FOREST_GIANT_PAINTED, FOREST_HEDGE_WIDEN, FOREST_LANDMARK, FOREST_LANDMARK_MAX, FOREST_LONE_WIDEN, forestBiomeRow, forestGiant, forestSocial, forestWetConifer, type ForestBiome, type ForestSocial } from '../../../rust/bridge/terrainForestStature';
import { FOREST_CLUMP_GLSL, FOREST_CROWN_PIGMENTS, FOREST_FIELD, FOREST_PERLIN_GLSL, FOREST_TAU_TABLE, forestHash, type ForestField, type ForestOccupation } from '../../../rust/bridge/terrainForest';

/** Render distance of the near trees (m), adjustable: full trees within `near` (2/3 of it), none beyond `far`. Beyond,
 * the painted crowns are the forest's far level of detail. */
export const TREE_DISTANCE_MIN = 200,
  TREE_DISTANCE_MAX = 5000,
  TREE_DISTANCE_DEFAULT = 600;
/** Reference of the budget: 16000 trees within 360 m. The cap grows with the area (distance squared) up to TREE_CEILING
 * (a frame costs TREE_VERTICES vertices per tree); past it, trees farther than `full` are thinned, not dropped. */
const TREE_REFERENCE_FAR = 360,
  TREE_REFERENCE_MAX = 16000,
  TREE_CEILING = 36000;
export interface TreeLimits {
  near: number;
  far: number;
  /** Upper bound on drawn trees. Blocks are visited nearest first, so the cap drops the farthest trees, never a hole near the eye. */
  max: number;
  /** Beyond this distance a crown is kept with probability (full / distance)², so the far ring stays populated under the cap. */
  full: number;
}
export const clampTreeDistance = (metres: number): number => (Number.isFinite(metres) ? clamp(Math.round(metres), TREE_DISTANCE_MIN, TREE_DISTANCE_MAX) : TREE_DISTANCE_DEFAULT);
export function treeLimits(distance: number): TreeLimits {
  const far = clampTreeDistance(distance),
    scale = (far / TREE_REFERENCE_FAR) ** 2,
    uncapped = TREE_REFERENCE_MAX * scale;
  let full = far;
  if (uncapped > TREE_CEILING) {
    // Expected count with the thinning, relative to the reference density: f(R) = R²(1 + 2 ln(far / R)), increasing up to far.
    const target = (TREE_CEILING / TREE_REFERENCE_MAX) * TREE_REFERENCE_FAR ** 2;
    let lo = 1,
      hi = far;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (mid * mid * (1 + 2 * Math.log(far / mid)) < target) lo = mid;
      else hi = mid;
    }
    full = lo;
  }
  return { near: (far * 2) / 3, far, max: Math.round(Math.min(uncapped, TREE_CEILING)), full };
}
/** Soft upper bound: ~x for small x, never above `cap` (natural variation survives, no pile of identical stands). */
const softCap = (x: number, cap: number): number => cap * Math.tanh(x / cap);
/** Side of the blocks a stream visits (m): a crown belongs to the block that holds its centre. */
export const TREE_BLOCK = 24;
/** World blocks between two partial installs of a stream that is still being built (nearest blocks first). */
const PARTIAL_BLOCKS = 96;
/** Lathe of one tree: 10 segments around (even, for the alternating conifer bough tips), 8 bands between 9 rings: three
 * for the stem (flared foot, breast height, crown base), six for the crown profile. */
const SEGMENTS = 10,
  BANDS = 8;
export const TREE_VERTICES = SEGMENTS * BANDS * 6;
/** Floats per instance: (x, y, ground z, r) (h, crown length, form: 0 broadleaf 1 conifer 2 parasol broadleaf 3 parasol conifer, phase) (r, g, b, leafless flag + .45 x snow load). */
export const TREE_STRIDE = 12;

export interface TreeInputs {
  field: ForestField;
  occupation?: ForestOccupation;
  seed: number;
  climate: { temperature: number; precipitation: number };
  renderV2: number;
  zone: number;
  season: number;
  /** Calendar setting 'crownSnow' (0 bare crowns, 1 heavily laden); the zone default when absent. */
  crownSnow?: number;
  /** Climate zone and calendar of the map: the deciduous leaf state and the larch share, as the painted crowns read them
   * (v2SeasonLeaf, v2SeasonClimate). Absent: a climate proxy. */
  climateZone?: ClimateZone;
  calendar?: SeasonCalendar;
  /** Displayed water cover 0..1 at a point (tile water masks); undefined: dry. */
  water(x: number, y: number): number;
  height(x: number, y: number): number | undefined;
}
export interface TreeView {
  x: number;
  y: number;
  forwardX: number;
  forwardY: number;
  /** Render distance (m); the default when absent. */ distance?: number;
  /** Whether the block of side TREE_BLOCK with this centre can show in the frame: those blocks are built first, nearest
   * first, then the others (a tilted eye does not fill the unseen ground under it before the visible trees). */
  inView?: (x: number, y: number) => boolean;
  /** Every tree whose centre lies in this square instead, its corners on the TREE_BLOCK grid: no distance, direction,
   * thinning or cap (the world view builds its trees per block of the map, render/world/treesBlocks.ts). */
  area?: { minX: number; minY: number; maxX: number; maxY: number };
}

const V2_ZONE_FOREST: readonly (readonly [number, number, number])[] = [
  [1, 0.12, 0.45],
  [0.62, 0.3, 0.45],
  [1, 0.55, 0.55],
  [1, 0.92, 0.75],
  [1, 0.9, 0.85],
  [0.05, 0.98, 0.95],
  [0.22, 0.2, 0.5],
  [0.12, 0, 1],
  [0.42, 0, 1],
  [1, 0, 1],
  [0.55, 0.08, 0.7],
];
const CROWN_CDF = [0, 0, 0, 0.0005, 0.0063, 0.0336, 0.1125, 0.2742, 0.4998, 0.7261, 0.8874, 0.9665, 0.9936, 0.9994, 1, 1, 1];
const sstep = (a: number, b: number, v: number): number => {
  let t = (v - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};
const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const u8 = (h: number, shift: number): number => (((h >>> shift) & 255) + 0.5) / 256;
const tauOf = (d: number): number => {
  const u = clamp(d, 0, 0.985) * 32,
    k = Math.min(Math.floor(u), 31);
  return mix(FOREST_TAU_TABLE[k], FOREST_TAU_TABLE[k + 1], u - k);
};
const rhoOf = (tau: number): number => 0.5 + 0.4 * Math.max(0, (tau - 0.55) / 0.45);
const lookupCrown = (x: number): number => {
  const u = clamp(x) * 16,
    k = Math.min(Math.floor(u), 15);
  return mix(CROWN_CDF[k], CROWN_CDF[k + 1], u - k);
};
/** forestRadius: the field's crown allometry scaled by the biome (FOREST_BIOMES broad/needle). */
const radiusOf = (height: number, needle: number, dry: number, biome: ForestBiome): number => mix((0.24 * height + 1) * (1 + 0.45 * dry) * biome.broad, (0.07 * height + 0.55) * biome.needle, needle);
const heightGate = (h: number): number => sstep(2, 6, h);
/** Lone field tree, as the shader's forestFieldTree: one seeded point per FOREST_FIELD.cell, kept with probability
 * FOREST_FIELD.tree (times the natural potential), rooted in the lattice cell holding it on the nearest level. */
function fieldTree(i: number, j: number, level: number, s: number, centreLevel: number, cover: number, height: number, crownSeed: number): boolean {
  if (level !== Math.min(Math.floor(centreLevel + 0.5), 5)) return false;
  const cx = Math.floor(((i + 0.5) * s) / FOREST_FIELD.cell),
    cy = Math.floor(((j + 0.5) * s) / FOREST_FIELD.cell),
    h = forestHash(cx, cy, 733, crownSeed);
  if (u8(h, 16) >= FOREST_FIELD.tree * Math.min(cover * 3, 1) * heightGate(height)) return false;
  const tx = (cx + 0.1 + 0.8 * u8(h, 0)) * FOREST_FIELD.cell,
    ty = (cy + 0.1 + 0.8 * u8(h, 8)) * FOREST_FIELD.cell;
  return Math.floor(tx / s) === i && Math.floor(ty / s) === j;
}

/** Bilinear RGBA8 sample (0..255 per channel) of a square raster with texel centres at x+(i+.5)·width/n, clamped. */
function bilinear(rgba: Uint8Array, n: number, x0: number, y0: number, width: number, x: number, y: number, out: Float64Array): boolean {
  const u = (x - x0) / width,
    v = (y - y0) / width;
  if (u < 0 || v < 0 || u > 1 || v > 1) return false;
  const gx = u * n - 0.5,
    gy = v * n - 0.5,
    ix = Math.floor(gx),
    iy = Math.floor(gy),
    fx = gx - ix,
    fy = gy - iy;
  const i0 = clamp(ix, 0, n - 1),
    i1 = clamp(ix + 1, 0, n - 1),
    j0 = clamp(iy, 0, n - 1),
    j1 = clamp(iy + 1, 0, n - 1);
  for (let c = 0; c < 4; c++) {
    const a = rgba[(j0 * n + i0) * 4 + c],
      b = rgba[(j0 * n + i1) * 4 + c],
      d = rgba[(j1 * n + i0) * 4 + c],
      e = rgba[(j1 * n + i1) * 4 + c];
    out[c] = (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
  }
  return true;
}

/** Same gradients, fades and lattices as forestGradient/forestPerlin/forestGlade. */
function gradient(cx: number, cy: number, seed: number, out: number[]): void {
  const h = forestHash(cx, cy, 991, (seed ^ 0x6a09e667) >>> 0);
  out[0] = (h & 255) / 128 + (0.5 / 128 - 1);
  out[1] = ((h >>> 8) & 255) / 128 + (0.5 / 128 - 1);
}
const g00 = [0, 0],
  g10 = [0, 0],
  g01 = [0, 0],
  g11 = [0, 0];
function perlin(x: number, y: number, ox: number, oy: number, seed: number): number {
  const cx = Math.floor(x),
    cy = Math.floor(y),
    fx = x - cx,
    fy = y - cy;
  gradient(cx + ox, cy + oy, seed, g00);
  gradient(cx + ox + 1, cy + oy, seed, g10);
  gradient(cx + ox, cy + oy + 1, seed, g01);
  gradient(cx + ox + 1, cy + oy + 1, seed, g11);
  const n00 = g00[0] * fx + g00[1] * fy,
    n10 = g10[0] * (fx - 1) + g10[1] * fy,
    n01 = g01[0] * fx + g01[1] * (fy - 1),
    n11 = g11[0] * (fx - 1) + g11[1] * (fy - 1);
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10),
    uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  return n00 + ux * (n10 - n00) + uy * (n01 - n00) + ux * uy * (n00 - n10 - n01 + n11);
}
function patchValue(x: number, y: number, seed: number): number {
  const fine = perlin(x / 56, y / 56, 0, 0, seed);
  // mat2(.83,.39,-.21,1.27) is column-major in GLSL.
  const glade = perlin((0.83 * x - 0.21 * y) / 210 + 43.1, (0.39 * x + 1.27 * y) / 210 - 17.7, 7919, -4421, seed);
  return clamp((0.5 * fine + 0.866 * glade) * 0.6 + 0.5);
}

interface Stand {
  cover: number;
  height: number;
  needle: number;
  tone: number;
}
interface Climate {
  trop: number;
  dry: number;
  humid: number;
  kind: [number, number, number];
  kappaBase: number;
}

/** Live crown ratio (crown length over tree height) of a 3D tree by social class (ForestSocial.rank: young,
 * suppressed, intermediate, co-dominant, dominant, open-grown), broadleaf then tall conifer. A forest-grown broadleaf
 * carries its crown on the upper half to two thirds of the stem, a dominant's reaching lowest; young trees are crown
 * almost to the ground, open-grown trees nearly as deep as they are tall. The spire profile additionally limits the clear stem in metres (treeForm). */
const CROWN_RATIO: readonly (readonly [number, number])[] = [
  [0.85, 0.9],
  [0.6, 0.55],
  [0.6, 0.5],
  [0.64, 0.55],
  [0.68, 0.6],
  [0.88, 0.92],
];
/** Lightness of a class: young foliage reads lighter, shade crowns under the canopy darker. */
const CLASS_TONE = [1.05, 0.93, 0.97, 1, 1, 1];
/** Tree forms (instance float 6, read by TREE_3D_GLSL): broadleaf ovoid, conifer spire, broadleaf parasol, conifer parasol. */
const FORM_BROAD = 0,
  FORM_SPIRE = 1,
  FORM_PARASOL = 2;
/** 3D form of one tree on top of its painted crown's class: `height` over the stand top height, `crown` the live crown
 * ratio, `shape` the instance form, `tone`. */
interface TreeForm {
  height: number;
  crown: number;
  shape: number;
  tone: number;
}
/** Giants keep a full crown on a stout stem: temperate veterans about 0.7 of their height, tropical emergents a clear bole
 * of about half their height, landmark trees in open land 0.85. Conifer spires retain low boughs.
 * Parasols (flat-topped crown in the upper third, on a bare bole): savanna acacias, the savanna share of broadleaves, and
 * Mediterranean umbrella pines, half of the conifers of a Mediterranean climate; `pick` (0..1) draws them. */
function treeForm(form: TreeForm, social: ForestSocial, biome: ForestBiome, giant: boolean, needle: boolean, margin: number, krumm: number, kind: readonly number[], wetConifer: number, top: number, v: number, w: number, pick: number): void {
  let crown: number;
  if (giant) {
    form.height = (needle ? mix(biome.giantHeight, 2.4, wetConifer) : biome.giantHeight) * (0.9 + 0.2 * v);
    crown = social.rank === 5 ? 0.85 : needle ? 0.82 : mix(0.7, 0.5, kind[1]);
    form.tone = 1;
  } else {
    form.height = social.share;
    crown = CROWN_RATIO[social.rank][needle ? 1 : 0] + biome.crown;
    // Short conifers retain more of their lower boughs.
    if (needle && social.rank < 5) crown = mix(0.8, crown, sstep(15, 30, top * social.share));
    // Crowns at a margin get side light and keep their lower branches.
    if (social.rank < 5) crown += margin * (needle ? 0.2 : 0.1);
    form.tone = CLASS_TONE[social.rank];
  }
  const desert = biome === FOREST_BIOMES[7];
  const parasol = krumm < 0.5 && pick < (needle ? 0.5 * kind[0] : desert ? 0.75 : kind[2]);
  if (parasol) crown = desert ? 0.45 + 0.12 * v : 0.38;
  form.shape = (needle ? FORM_SPIRE : FORM_BROAD) + (parasol ? FORM_PARASOL : 0);
  // Krummholz is branched to the ground.
  crown = mix(crown, 0.95, krumm);
  crown += (w - 0.5) * 0.12;
  // On a tall fir a fractional bole can be several storeys high. Anchor the first live boughs in metres.
  if (needle && !parasol) crown = Math.max(crown, 0.76, 1 - (3 + 3 * w) / Math.max(1.5, top * form.height));
  form.crown = clamp(crown, 0.25, 0.97);
}

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
  if (!room) wayRooms.set(ways, (room = new ForestRoom(ways as readonly ForestCorridor[], [])));
  return room;
}
const clearingRooms = new WeakMap<object, ForestClearingRoom>(),
  orchardRooms = new WeakMap<object, ForestRoom>();
/** The point indexes of clearings and orchards, kept with the occupation that carries them: the world view builds
 * its trees in many small blocks, each of which would index the whole map again. */
function clearingRoomOf(clearings: NonNullable<ForestOccupation['clearings']>): ForestClearingRoom {
  let room = clearingRooms.get(clearings);
  if (!room) clearingRooms.set(clearings, (room = new ForestClearingRoom(clearings)));
  return room;
}
function orchardRoomOf(orchards: NonNullable<NonNullable<ForestOccupation['detail']>['orchards']>): ForestRoom {
  let room = orchardRooms.get(orchards);
  if (!room) orchardRooms.set(orchards, (room = new ForestRoom([], orchards)));
  return room;
}
/** Same instance order and arithmetic, with one bounded world block per step. Blocks run nearest first; `partial`
 * receives the stream built so far every PARTIAL_BLOCKS blocks, so trees appear around the eye before the rest. That
 * partial stream is a view of the buffer being filled: valid during the call only (the uploads copy it). */
export function* buildNearTreesSteps(inputs: TreeInputs, view: TreeView, partial?: (values: Float32Array) => void): Generator<void, Float32Array> {
  const limits = treeLimits(view.distance ?? TREE_DISTANCE_DEFAULT),
    TREE_FAR = limits.far,
    TREE_MAX = limits.max,
    full2 = limits.full * limits.full;
  const { field, occupation: occ, seed } = inputs,
    T = inputs.climate.temperature,
    P = inputs.climate.precipitation;
  const humid = P / Math.max(20 * T + 280, 120),
    trop = sstep(13, 19, T - 6),
    dry = 1 - sstep(0.8, 2, humid);
  const savanna = trop * sstep(0.3, 0.6, dry);
  const kind: [number, number, number] = [(1 - trop) * sstep(10, 14, T) * sstep(0.35, 0.7, dry), trop - savanna, savanna];
  const climate: Climate = { trop, dry, humid, kind, kappaBase: mix(0.25, 0.78, sstep(0.9, 1.8, humid)) * (1 - 0.6 * trop) * (1 - 0.5 * kind[0]) * (1 - 0.85 * kind[2]) };
  const zone = inputs.renderV2 > 0 && inputs.zone > 0 ? V2_ZONE_FOREST[clamp(inputs.zone - 1, 0, 10)] : undefined;
  const px = new Float64Array(4),
    crownSeed = (seed ^ 0x2c1b3c6d) >>> 0;
  // Biome stature (terrainForestStature.ts): crown size and spacing, class shares, giants; the same row as forestBiome().
  const biomeRow = forestBiomeRow(inputs.renderV2, inputs.zone),
    biome = FOREST_BIOMES[biomeRow],
    tropicalCanopy = biomeRow === 9 ? 1 : kind[1],
    wetConifer = forestWetConifer(trop, humid, T);
  const fieldAt = (x: number, y: number): Stand | undefined => {
    if (!bilinear(field.rgba, field.n, field.x, field.y, field.width, x, y, px)) return undefined;
    let cover = px[0] / 255,
      needle = px[2] / 255;
    if (zone) {
      cover = clamp(cover * zone[0]);
      needle = mix(needle, zone[1], zone[2]);
    }
    return { cover, height: (px[1] / 255) * 50 * (zone && inputs.zone === 6 ? 0.35 : 1), needle, tone: px[3] / 255 };
  };
  const clearingRoom = occ?.clearings?.length ? clearingRoomOf(occ.clearings) : undefined;
  const occCell = occ ? occ.width / occ.n : 1;
  // Exact ways: no trunk stands on a road or a street, whatever the raster resolution (crowns may still overhang an earth way).
  const wayRoom = occ?.ways?.length ? wayRoomOf(occ.ways) : undefined;
  const occAt = (x: number, y: number): [number, number, number] | undefined => {
    if (!occ || !bilinear(occ.rgba, occ.n, occ.x, occ.y, occ.width, x, y, px)) return undefined;
    const i = clamp(Math.floor(((x - occ.x) / occ.width) * occ.n), 0, occ.n - 1),
      j = clamp(Math.floor(((y - occ.y) / occ.width) * occ.n), 0, occ.n - 1);
    return [((px[0] - 128) / 16) * occCell, ((px[1] - 128) / 16) * occCell, occ.rgba[(j * occ.n + i) * 4 + 2]];
  };
  // Field and commons shares of the classed texels of the 2x2 footprint, as the shader's forestOpenShares: wood and
  // unclassified texels do not count, so the rules follow the smooth open distance along a wood edge, not the class
  // texels. Commons are unworked: their crowns follow the natural stand.
  const shares = (x: number, y: number): [number, number] => {
    if (!occ) return [0, 0];
    const gx = ((x - occ.x) / occ.width) * occ.n - 0.5,
      gy = ((y - occ.y) / occ.width) * occ.n - 0.5,
      i0 = Math.floor(gx),
      j0 = Math.floor(gy),
      fx = gx - i0,
      fy = gy - j0;
    let fieldShare = 0,
      wildShare = 0,
      classed = 0;
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const cls = occ.rgba[(clamp(j0 + dy, 0, occ.n - 1) * occ.n + clamp(i0 + dx, 0, occ.n - 1)) * 4 + 2],
          w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        if (cls > 0) {
          classed += w;
          if (cls === 1) fieldShare += w;
          else if (cls === 6) wildShare += w;
        }
      }
    return classed > 0 ? [fieldShare / classed, wildShare / classed] : [0, 0];
  };
  const bankRange = 48 + (3 * field.width) / field.n,
    bankDensity = field.bankDensity ?? 1;
  const bankDens = (w: number): number => {
    const c = 0.55 + 0.35 * sstep(8, 36, w);
    return 1 - Math.pow(1 - c, Math.max(bankDensity, 0));
  };
  const bankAt = (x: number, y: number): [number, number] => {
    if (!field.bank || !bilinear(field.bank, field.n, field.x, field.y, field.width, x, y, px)) return [-1e3, 0];
    const w = px[2] / 2;
    if (w <= 0) return [-1e3, 0];
    return [w - Math.hypot(px[0] - 128, px[1] - 128) * (bankRange / 127), w];
  };
  const gallery = (b: [number, number]): number => (b[0] > 0 ? bankDens(b[1]) * (1 - 0.6 * sstep(0.35, 1, 1 - b[0] / Math.max(b[1], 1))) : 0);
  const beach = field.beach;
  const beachAt = (x: number, y: number): number => {
    if (!beach || inputs.renderV2 <= 0) return 0;
    const u = ((x - beach.x) / beach.width) * beach.n - 0.5,
      v = ((y - beach.y) / beach.width) * beach.n - 0.5;
    if (u < -0.5 || v < -0.5 || u > beach.n - 0.5 || v > beach.n - 0.5) return 0;
    const i = Math.floor(u),
      j = Math.floor(v),
      fx = u - i,
      fy = v - j,
      n = beach.n;
    const at = (a: number, b: number): number => beach.data[clamp(b, 0, n - 1) * n + clamp(a, 0, n - 1)];
    return ((at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy) / 255;
  };
  const kappaOf = (height: number, needle: number): number => climate.kappaBase * mix(0.55, 1, sstep(3, 10, height)) * mix(1, 0.85, needle);
  const density = (c: number, kappa: number): number => clamp(c + kappa * (1 - 0.5 * sstep(0.55, 0.9, c)) * (0.985 - c), c, 0.985);

  // Lattice levels a fragment at (x, y) searches (forestCanopyNear): its stand's level and the next.
  const levelsAt = (x: number, y: number): [number, number, number] | undefined => {
    const st = fieldAt(x, y);
    if (!st) return undefined;
    const o = occAt(x, y);
    const cover = o && o[1] > 0 && o[0] < 0 ? Math.max(st.cover, 0.25 * heightGate(st.height)) : st.cover;
    const b = bankAt(x, y),
      near = b[0] > -16 ? bankDens(b[1]) : 0;
    const dl = Math.max(density(cover, kappaOf(st.height, st.needle)), near);
    const level = clamp(2 * Math.log2(radiusOf(st.height, st.needle, dry, biome) / rhoOf(tauOf(dl)) / 2), 0, 5.999),
      l0 = Math.floor(level),
      w = level - l0;
    return [l0, 1 - Math.pow(1 - dl, 1 - w), 1 - Math.pow(1 - dl, w)];
  };

  const season = inputs.season,
    sx = Math.max(-Math.sin(6.2831853 * season), 0);
  const at = (((season % 1) + 1) % 1) * 4,
    winter = Math.max(0, 1 - Math.min(Math.abs(at), Math.abs(at - 4)));
  const evergreen = inputs.renderV2 > 0 ? kind[0] + kind[1] : 1;
  // Deciduous leaf state and larch share of the zone's year, as the painted crowns under these trees read them.
  const year = inputs.renderV2 > 0 && inputs.climateZone ? calendarSeason(inputs.climateZone, inputs.calendar) : undefined,
    w = seasonWeights(season);
  const leaf = year ? clamp(year.leaf.reduce((sum, v, i) => sum + v * w[i], 0)) : 1 - winter * (1 - evergreen) * 0.9,
    larchShare = year?.larch ?? 0;
  const snow = inputs.renderV2 > 0 ? winter * (1 - sstep(2, 10, T)) : 0,
    crownSnow = clamp(inputs.crownSnow ?? 0.7);
  // Mean crown load of forestSnowLoad; the tree shader spreads it over the crown (instance colour w, fraction).
  const snowLoad = (needle: boolean): number => 0.45 * snow * (needle ? mix(0.24, 0.62, crownSnow) : mix(0.2, 0.8, crownSnow));
  const temperate = 1 - kind[0] - kind[1] - kind[2];
  const pigments = FOREST_CROWN_PIGMENTS;
  const conifer = pigments.conifer.map((c, i) => mix(c, pigments.dryConifer[i], dry));
  const broadleaf = pigments.broad.map((c, i) => mix(mix(c, pigments.tropical[i], trop), pigments.dry[i], dry * (1 - 0.5 * trop)));
  // Instance stream in a typed array grown by doubling: partial installs hand out a view of it (the uploads copy it),
  // the finished stream a copy cut to length.
  let out = new Float32Array(1024 * TREE_STRIDE),
    count = 0;
  const area = view.area,
    cap = area ? Infinity : TREE_MAX * TREE_STRIDE;
  const inArea = (x: number, y: number): boolean => x >= area!.minX && x < area!.maxX && y >= area!.minY && y < area!.maxY;
  const emit = (x: number, y: number, z: number, r: number, h: number, depth: number, needle: number, phase: number, cr: number, cg: number, cb: number, w: number): void => {
    if (count + TREE_STRIDE > out.length) {
      const grown = new Float32Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[count] = x;
    out[count + 1] = y;
    out[count + 2] = z;
    out[count + 3] = r;
    out[count + 4] = h;
    out[count + 5] = depth;
    out[count + 6] = needle;
    out[count + 7] = phase;
    out[count + 8] = cr;
    out[count + 9] = cg;
    out[count + 10] = cb;
    out[count + 11] = w;
    count += TREE_STRIDE;
  };
  // Planted trees precede the natural candidates in the same budgeted stream and GPU buffer.
  // Decode the same nearest detail texel and use the shader's hash/grid, including its crown setback.
  const detail = occ?.detail;
  // Exact parcel boundaries supplement the categorical raster along sub-texel edges.
  const orchardRoom = detail?.orchards?.length ? orchardRoomOf(detail.orchards) : undefined;
  const inside = (ring: readonly { x: number; y: number }[], x: number, y: number): boolean => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  for (const patch of detail?.orchards ?? []) {
    const [ca, sa] = patch.along;
    const us = patch.poly.map(p => p.x * ca + p.y * sa),
      vs = patch.poly.map(p => -p.x * sa + p.y * ca);
    // The lattice range around the eye, or around the area (its corners in the orchard's frame).
    const corners = area ? [area.minX, area.minY, area.maxX, area.minY, area.minX, area.maxY, area.maxX, area.maxY] : [view.x, view.y],
      cu: number[] = [],
      cv: number[] = [];
    for (let k = 0; k < corners.length; k += 2) {
      cu.push(corners[k] * ca + corners[k + 1] * sa);
      cv.push(-corners[k] * sa + corners[k + 1] * ca);
    }
    const reach = area ? 1 : TREE_FAR + 1;
    const i0 = Math.floor(Math.max(Math.min(...us), Math.min(...cu) - reach) / 8),
      i1 = Math.ceil(Math.min(Math.max(...us), Math.max(...cu) + reach) / 8);
    const j0 = Math.floor(Math.max(Math.min(...vs), Math.min(...cv) - reach) / 8),
      j1 = Math.ceil(Math.min(Math.max(...vs), Math.max(...cv) + reach) / 8);
    for (let j = j0; j <= j1; j++) {
      yield;
      for (let i = i0; i <= i1; i++) {
        const h = forestHash(i, j, 877, seed),
          h2 = forestHash(i, j, 878, seed);
        const u = (i + 0.5 + (u8(h, 0) - 0.5) * 0.12) * 8,
          v = (j + 0.5 + (u8(h, 8) - 0.5) * 0.12) * 8;
        const x = ca * u - sa * v,
          y = sa * u + ca * v,
          dx = x - view.x,
          dy = y - view.y;
        const d2 = dx * dx + dy * dy;
        if (area) {
          if (!inArea(x, y)) continue;
        } else {
          if (d2 > TREE_FAR * TREE_FAR || dx * view.forwardX + dy * view.forwardY < -48) continue;
          if (d2 > full2 && u8(forestHash(i, j, 879, seed), 0) >= full2 / d2) continue;
        }
        if (!inside(patch.poly, x, y) || patch.holes?.some(hole => inside(hole, x, y)) || occAt(x, y)?.[2] !== 4) continue;
        const di = clamp(Math.floor(((x - detail!.x) / detail!.width) * detail!.n), 0, detail!.n - 1),
          dj = clamp(Math.floor(((y - detail!.y) / detail!.width) * detail!.n), 0, detail!.n - 1);
        const d = (dj * detail!.n + di) * 4,
          radius = 2.3 + 0.4 * u8(h, 16),
          height = 6 + 1.2 * u8(h2, 16);
        const a = 0.5 * Math.atan2((detail!.rgba[d + 2] / 255) * 2 - 1, (detail!.rgba[d + 1] / 255) * 2 - 1);
        if (Math.cos(a) * ca + Math.sin(a) * sa <= 0.9999 || (detail!.rgba[d + 3] / 255) * 6 <= radius * 1.2) continue;
        if (clearingRoom && !clearingRoom.keeps(x, y, radius)) continue;
        if (heightGate(fieldAt(x, y)?.height ?? 0) <= 0.5 || inputs.water(x, y) >= 0.05) continue;
        const z = inputs.height(x, y);
        if (z === undefined || z <= 0) continue;
        const tint = u8(Math.imul(h2, 0x9e3779b9) >>> 0, 0),
          tone = 0.86 + 0.28 * tint;
        const summer = 0.5 - 0.5 * Math.cos(6.2831853 * (inputs.renderV2 > 0 ? season : 0.5));
        const fruitLeaf = inputs.renderV2 > 0 ? leaf : 1;
        const fall = sx * temperate * 0.65;
        let c = [mix(0.25, 0.22, summer) * tone, mix(0.34, 0.37, summer) * tone, mix(0.15, 0.16, summer) * tone];
        c = c.map((v, k) => mix(mix(v, [0.47, 0.34, 0.12][k], fall), [0.31, 0.27, 0.23][k] * (0.85 + 0.3 * tint), 1 - fruitLeaf));
        // Standard fruit trees: a 2.4-2.9 m stem under the crown (crown 60 % of the height).
        emit(x, y, z, radius, height, 0.6 * height, 0, u8(h, 24) * 6.2831853 + tint, c[0], c[1], c[2], (fruitLeaf < 0.5 ? 1 : 0) + snowLoad(false));
        if (count >= cap) return out.slice(0, count);
      }
    }
  }
  const far2 = TREE_FAR * TREE_FAR,
    block = TREE_BLOCK;
  const bx0 = Math.floor((view.x - TREE_FAR) / block),
    bx1 = Math.floor((view.x + TREE_FAR) / block);
  const by0 = Math.floor((view.y - TREE_FAR) / block),
    by1 = Math.floor((view.y + TREE_FAR) / block);
  // Blocks in the view first, then the others, each nearest first: partial streams and the instance cap keep the
  // visible trees around the eye.
  const blocks: [number, number, number][] = [],
    unseen = 4 * (TREE_FAR + block) ** 2;
  if (area) for (let by = Math.round(area.minY / block); by < Math.round(area.maxY / block); by++) for (let bx = Math.round(area.minX / block); bx < Math.round(area.maxX / block); bx++) blocks.push([0, bx, by]);
  else
    for (let by = by0; by <= by1; by++)
      for (let bx = bx0; bx <= bx1; bx++) {
        const dx = (bx + 0.5) * block - view.x,
          dy = (by + 0.5) * block - view.y,
          d2 = dx * dx + dy * dy;
        if (d2 > (TREE_FAR + block) ** 2 || dx * view.forwardX + dy * view.forwardY < -2 * block) continue;
        blocks.push([view.inView && !view.inView((bx + 0.5) * block, (by + 0.5) * block) ? d2 + unseen : d2, bx, by]);
      }
  blocks.sort((a, b) => a[0] - b[0]);
  const social: ForestSocial = { share: 1, width: 1, rank: 4 },
    form: TreeForm = { height: 1, crown: 0.5, shape: 0, tone: 1 };
  let shown = count;
  for (let b = 0; b < blocks.length; b++) {
    yield;
    if (partial && b > 0 && b % PARTIAL_BLOCKS === 0 && count > shown) {
      shown = count;
      partial(out.subarray(0, count));
    }
    const bx = blocks[b][1],
      by = blocks[b][2],
      cxm = (bx + 0.5) * block,
      cym = (by + 0.5) * block;
    const levels = levelsAt(cxm, cym);
    if (!levels) continue;
    for (let k = 0; k < 2; k++) {
      if ((k === 0 ? levels[1] : levels[2]) <= 0.002) continue;
      const level = levels[0] + k,
        s = 2 * Math.pow(2, level * 0.5);
      // A crown centre lies at (cell + .1514 .. .8486) * s: only the cells whose centre range meets the block are visited.
      const i0 = Math.ceil((bx * block) / s - 0.849),
        i1 = Math.floor(((bx + 1) * block) / s - 0.151),
        j0 = Math.ceil((by * block) / s - 0.849),
        j1 = Math.floor(((by + 1) * block) / s - 0.151);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const h = forestHash(i, j, level * 2, crownSeed);
          const cx = (i + 0.15 + 0.7 * u8(h, 0)) * s,
            cy = (j + 0.15 + 0.7 * u8(h, 8)) * s;
          // Each crown belongs to the block holding its centre.
          if (Math.floor(cx / block) !== bx || Math.floor(cy / block) !== by) continue;
          const ex = cx - view.x,
            ey = cy - view.y;
          const e2 = ex * ex + ey * ey;
          if (!area) {
            if (e2 > far2) continue;
            if (e2 > full2 && u8(forestHash(i, j, level * 2 + 61, crownSeed), 0) >= full2 / e2) continue;
          }
          if (orchardRoom && !orchardRoom.keeps(cx, cy, 0)) continue;
          if (wayRoom && !wayRoom.keeps(cx, cy, 0.5)) continue;
          const h2 = forestHash(i, j, level * 2 + 1, crownSeed);
          const centre = fieldAt(cx, cy);
          if (!centre) continue;
          let { cover, needle } = centre;
          const height = centre.height;
          let open = -1e3,
            forced = -1e3,
            allow = 0,
            hedge = 0,
            openGallery = 0.5,
            occupied = false,
            tilledPlot = false,
            field = false,
            town = false;
          const o = occAt(cx, cy);
          if (o) {
            open = o[0];
            forced = o[1];
            const cls = o[2];
            tilledPlot = cls === 5; // kitchen and market-garden plots root no crown
            town = cls === 7;
            const [fieldShare, wildShare] = shares(cx, cy);
            field = fieldShare > 0.5; // cultivated fields: edge hedge and lone field trees only (forestCrown)
            allow = (cls === 6 ? 0.12 : cls === 3 ? 0.05 : cls === 2 ? 0.02 : cls === 7 ? 0.03 : 0) * heightGate(height);
            hedge = (cls >= 1 && cls <= 3 ? 0.6 : 0) * sstep(3, 8, height) * (1 - dry);
            if (field || cls === 7 || cls === 8 || cls === 9 || cls === 11) openGallery = 0;
            occupied = cls === 4 || cls === 8 || cls === 9 || cls === 11 || cls === 12;
            if (wildShare > 0.5) open = -1e3; // commons: the natural stand
          }
          if (forced > 0) cover = Math.max(cover, 0.25 * heightGate(height));
          let kappa = kappaOf(height, needle);
          const gal = gallery(bankAt(cx, cy));
          let riparian = false;
          if (gal > cover) {
            riparian = true;
            cover = gal;
            kappa = 0;
            needle *= 0.3;
          }
          const dens = density(cover, kappa),
            share = cover / Math.max(dens, 1e-3),
            radius = radiusOf(height, needle, dry, biome);
          if (o && occ && open < 0 && open > -radius) {
            const e = occCell,
              openAt = (x: number, y: number): number => occAt(x, y)?.[0] ?? -1e3;
            const gx = openAt(cx + e, cy) - openAt(cx - e, cy),
              gy = openAt(cx, cy + e) - openAt(cx, cy - e),
              gl = Math.max(Math.hypot(gx, gy), 1e-4);
            const side = occAt(cx + (gx / gl) * (0.5 * e - open), cy + (gy / gl) * (0.5 * e - open))?.[2] ?? 0;
            if ((side === 4 || side === 8 || side === 9 || side === 11) && open > -forestCrownSetback(radius, u8(h2, 16))) occupied = true;
          }
          if (occupied) continue;
          const centreLevel = clamp(2 * Math.log2(radius / rhoOf(tauOf(dens)) / 2), 0, 5.999);
          const weight = Math.max(0, 1 - Math.abs(centreLevel - level));
          const tau = tauOf(1 - Math.pow(1 - dens, weight)),
            q = Math.min(1, tau / 0.55),
            rho = rhoOf(tau);
          const krumm = (1 - sstep(3, 7, height)) * sstep(0.35, 0.7, needle);
          const beyond = open + (u8(Math.imul(h, 0x165667b1) >>> 0, 8) - 0.5) * radius;
          let alive: boolean, edge: number;
          if (beyond > 0) {
            const stray = field ? 0 : 0.18 * (1 - sstep(0, 4 * radius, open)) * Math.min(cover * 3, 1);
            alive = !tilledPlot && u8(Math.imul(h2, 0x27d4eb2d) >>> 0, 24) < Math.max(allow + (open < (field ? FOREST_FIELD.hedge : 5) ? hedge : 0) + stray, openGallery * gal);
            edge = 1;
            if (field && !alive) alive = fieldTree(i, j, level, s, centreLevel, cover, height, crownSeed);
          } else {
            // The stand threshold (two Perlin lattices) only for the crowns the q draw keeps; edge only matters for live crowns.
            alive = u8(h, 16) < q;
            edge = 0;
            if (alive) {
              const threshold = mix(lookupCrown(0.8 * patchValue(cx, cy, seed) + 0.2 * u8(h2, 0)), u8(h2, 0), krumm);
              alive = threshold < share;
              edge = 1 - sstep(0, 0.1, share - threshold);
            }
          }
          if (!alive || inputs.water(cx, cy) >= (inputs.renderV2 > 0 ? 0.05 : 0.5)) continue;
          if (inputs.renderV2 > 0 && u8(forestHash(i, j, level * 2 + 37, crownSeed), 0) < beachAt(cx, cy)) continue;
          const isNeedle = u8(h2, 8) < needle,
            larch = isNeedle && u8(Math.imul(h, 0x27d4eb2d) >>> 0, 16) < larchShare;
          // Social class and giants, as forestCrown paints them (forestSocial, forestGiant): margins are stand gaps,
          // wood edges within 2.5 radii and bank galleries; giants grow in old-growth cores, landmark trees in meadows.
          const margin = Math.max(edge, open > -1e3 ? 1 - sstep(0, 2.5 * radius, -open) : 0, riparian ? 0.6 : 0),
            closure = sstep(0.55, 0.9, dens) * sstep(8, 18, height) * (1 - margin),
            lone = beyond > 0,
            hedgeRow = town || open < (field ? FOREST_FIELD.hedge : 5);
          forestSocial(social, biomeRow, u8(h2, 16), u8(Math.imul(h2, 0x85ebca6b) >>> 0, 24), u8(h, 24), margin, closure, krumm, kind[1], lone);
          const giantGate = (1 - krumm) * sstep(4, 10, height);
          const giant = lone ? !field && !hedgeRow && u8(h2, 24) < Math.min(FOREST_LANDMARK * biome.giant, FOREST_LANDMARK_MAX) * giantGate : forestGiant(cx, cy, u8(h2, 24), biome.giant * giantGate, crownSeed, forestHash);
          // The ground carries the closed tropical understory. Model a stable sample of canopy stems;
          // bank galleries, forest margins, lone trees and emergents keep their original locations.
          if (tropicalCanopy > 0 && !giant && !lone && !riparian) {
            const omit = tropicalCanopy * closure * (social.rank < 3 ? 0.88 : 0.56);
            if (u8(forestHash(i, j, level * 2 + 89, crownSeed), 8) < omit) continue;
          }
          const r = Math.min(rho * s * (0.8 + 0.4 * u8(h, 24)) * (giant ? biome.giantWiden : social.width) * (lone ? (hedgeRow ? FOREST_HEDGE_WIDEN : FOREST_LONE_WIDEN) : 1 + 0.2 * margin) * (1 + 0.3 * krumm), 1.14 * s);
          if (clearingRoom && !clearingRoom.keeps(cx, cy, r)) continue;
          // The painted crown's height (forestCrown) decides, as there, whether a tree stands here; its 3D form is below.
          if (height * (giant ? FOREST_GIANT_PAINTED : social.share) < 1.5 || r < 0.4) continue;
          const z = inputs.height(cx, cy);
          if (z === undefined || z <= 0) continue;
          const hf = forestHash(i, j, level * 2 + 83, crownSeed);
          treeForm(form, social, biome, giant, isNeedle, margin, krumm, kind, wetConifer, softCap(height * biome.stature, biome.cap), u8(Math.imul(h2, 0x85ebca6b) >>> 0, 24), u8(hf, 16), u8(hf, 0));
          // Use the paint's species pigments and local field tone, preserving the seasonal tint of each crown.
          const tint = u8(Math.imul(h2, 0x9e3779b9) >>> 0, 0),
            tone = (0.86 + 0.28 * tint) * form.tone * (1 + 0.34 * (centre.tone - 0.5));
          const pigment = isNeedle ? conifer : broadleaf;
          let c: [number, number, number] = riparian ? [pigment[0] * 1.06, pigment[1] * 1.08, pigment[2] * 0.96] : [pigment[0], pigment[1], pigment[2]];
          c = [c[0] * tone, c[1] * tone, c[2] * tone];
          if (larch && inputs.renderV2 > 0) {
            // Larches: gold in autumn, bare in winter, as their painted crowns.
            const t = 0.85 * sx,
              gold = 0.9 + 0.2 * tint;
            c = [mix(c[0], 0.7 * gold, t), mix(c[1], 0.52 * gold, t), mix(c[2], 0.17 * gold, t)];
            c = [mix(c[0], 0.31 * (0.85 + 0.3 * tint), 1 - leaf), mix(c[1], 0.27 * (0.85 + 0.3 * tint), 1 - leaf), mix(c[2], 0.23 * (0.85 + 0.3 * tint), 1 - leaf)];
          }
          if (!isNeedle && inputs.renderV2 > 0) {
            const fall = sx * temperate;
            if (fall > 0) {
              const pick = (tint * 5.31) % 1,
                late = (tint * 3.77) % 1;
              const hue = pick < 0.38 ? [0.86, 0.46, 0.07] : pick < 0.56 ? [0.64, 0.18, 0.07] : pick < 0.86 ? [0.86, 0.66, 0.1] : [0.3, 0.4, 0.12];
              const lift = pick < 0.38 ? 1.35 : pick < 0.56 ? 1.08 : pick < 0.86 ? 1.4 : 1;
              const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2],
                hueLum = 0.2126 * hue[0] + 0.7152 * hue[1] + 0.0722 * hue[2];
              const t = fall * (pick < 0.86 ? 0.92 : 0.4) * (0.75 + 0.25 * late);
              c = [mix(c[0], (hue[0] * lum * lift) / hueLum, t), mix(c[1], (hue[1] * lum * lift) / hueLum, t), mix(c[2], (hue[2] * lum * lift) / hueLum, t)];
            }
            const bare = [0.31 * (0.85 + 0.3 * tint), 0.27 * (0.85 + 0.3 * tint), 0.23 * (0.85 + 0.3 * tint)];
            c = [mix(c[0], bare[0], 1 - leaf), mix(c[1], bare[1], 1 - leaf), mix(c[2], bare[2], 1 - leaf)];
          }
          // Same centre and radius as the painted crown it stands on. Height at the biome's real size next to the buildings
          // (3 m storeys): the stand top height saturates smoothly below the biome cap, then each tree takes its class
          // share of it, so the stand structure survives the cap; a giant's height comes from its class, not the field.
          let width = r;
          let tree = softCap(height * biome.stature, biome.cap) * form.height;
          // Broaden slender crowns within their existing planting cell before reducing height.
          // Clearings still win: a constrained crown keeps its painted radius and a shorter stem.
          if (form.shape === FORM_SPIRE) {
            const broader = Math.min(Math.max(width, tree / 10.4), 1.14 * s);
            if (broader === width || !clearingRoom || clearingRoom.keeps(cx, cy, broader)) width = broader;
            tree = Math.min(tree, 10.4 * width);
          }
          tree = Math.max(1.5, tree);
          const crown = form.shape === FORM_SPIRE ? Math.max(form.crown * tree, tree - Math.min(3.5, 1.6 * width)) : form.crown * tree;
          // Keep the whole modelled forest crown off planted parcels, including sub-texel boundary slivers.
          if (orchardRoom && open > -1.5 * radius) {
            let overlaps = false;
            for (let k = 0; k < 8; k++) {
              const a = (k * Math.PI) / 4;
              if (!orchardRoom.keeps(cx + 1.22 * width * Math.cos(a), cy + 1.22 * width * Math.sin(a), 0)) {
                overlaps = true;
                break;
              }
            }
            if (overlaps) continue;
          }
          emit(cx, cy, z, width, tree, crown, form.shape, u8(h, 24) * 6.2831853 + tint, c[0], c[1], c[2], ((!isNeedle || larch) && leaf < 0.5 ? 1 : 0) + snowLoad(isNeedle));
          if (count >= cap) return out.slice(0, count);
        }
    }
  }
  return out.slice(0, count);
}

/** Crown profiles of the lathe, shared by the tree shaders of the 3D view (below) and of the world view
 * (render/world/treesShader.ts). */
export const TREE_PROFILE_GLSL = `// Crown profiles, from the crown base (u 0) to the top (u 1), radius over the crown radius; a 0 radius closes on the
// stem. Broadleaf: an ovoid widest below the middle of the crown with a rounded underside, as forest broadleaf crowns
// (crown shape models, e.g. Pretzsch 2009). Conifer: three stacked whorl tiers of a
// spire. Parasol: the flat-topped crown of savanna acacias and Mediterranean umbrella pines, widest near the top.
const float BROAD_U[6]=float[6](0.,.1,.3,.55,.8,1.);
const float BROAD_R[6]=float[6](0.,.72,.98,.9,.68,0.);
const float NEEDLE_U[6]=float[6](0.,.3,.33,.62,.65,1.);
const float NEEDLE_R[6]=float[6](1.,.6,.78,.4,.52,0.);
const float PARASOL_U[6]=float[6](0.,.3,.62,.86,.96,1.);
const float PARASOL_R[6]=float[6](0.,.55,.88,1.,.92,0.);
`;
/** Instanced low-poly trees, one lathe per instance from gl_VertexID: a flared, tapering stem, then stacked cones
 * (conifers), a lumpy ovoid (broadleaf) or a flat-topped parasol (savanna acacias, umbrella pines). Translated to WGSL by web/scripts/wgsl_shaders_3d.ts. */
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
${TREE_PROFILE_GLSL}void main(){
  int v=int(gl_VertexID),quad=v/6,corner=v-quad*6;
  int band=quad/${SEGMENTS},seg=quad-band*${SEGMENTS};
  int dseg=corner==1||corner==2||corner==4?1:0,dring=corner==2||corner==4||corner==5?1:0;
  int ring=band+dring;
  float fade=1.-smoothstep(treeFade.z,treeFade.w,distance(treeBase.xy,treeFade.xy));
  if(fade<=0.){gl_Position=vec4(2.,2.,2.,1.);world=vec3(0.);treeNormal=vec3(0.,1.,0.);tint=vec3(0.);treeLevel=0.;crownChart=vec4(0.);crownInfo=vec4(0.,1.,0.,0.);return;}
  // Form (instance z): 0 broadleaf, 1 conifer spire, 2 broadleaf parasol, 3 conifer parasol (umbrella pine).
  int form=int(treeShape.z+.5);bool needle=form==1||form==3,parasol=form>=2,spire=form==1;
  // The instance carries the crown length (live crown ratio times height, buildNearTreesSteps): the crown base.
  float r=treeBase.w,h=treeShape.x,bottom=clamp(h-treeShape.y,.02*h,.75*h);
  float angle=float(seg+dseg)*${((2 * Math.PI) / SEGMENTS).toFixed(7)}+treeShape.w;
  vec2 dir=vec2(cos(angle),sin(angle));
  // Stem girth: diameter at breast height from the slenderness of the tree (height over diameter 30-60 for broadleaves,
  // 45-80 for conifers, low for dominant and open-grown trees; Wonn & O'Hara 2001) or from its crown, whichever is larger
  // (crown diameter about 12-25 times the stem diameter for broadleaves, Hemery et al. 2005; about 8-12 for conifers), at
  // the stout end of both ranges so a stem reads from afar. A 25 m broadleaf with a 10 m crown: 0.8 m; a 60 m emergent
  // with a 28 m crown: about 2.3 m; a 30 m spruce: 0.67 m; open-grown trees with wide crowns get stout stems. Never under
  // 0.5 m, about a pixel and a half at 300 m. The foot flares (to buttresses on the largest stems) and the stem tapers to
  // about 0.65 of its breast-height girth under a high crown (stem taper curves, e.g. Kozak 1988).
  float dbh=max(max(needle?h/45.:h/32.,2.*r/(needle?8.:12.)),.5),stem=.5*dbh,collar=stem*mix(1.,.65,smoothstep(1.5,10.,bottom));
  float radius,y;
  // Snow: the mean load of the crown is the fraction of treeColor.w over .45 (its integer part is the leafless flag).
  // It lies on the top of the crown and on a spire's bough tips; the gaps between boughs and the underside stay dark.
  float load=fract(treeColor.w)/.45,cap=0.,arc=0.;
  if(ring<3){radius=ring==0?stem*(1.45+.55*smoothstep(1.,2.5,dbh)):ring==1?stem:collar;y=ring==0?-.4:ring==1?min(1.3,.4*bottom):bottom;}
  else {
    int k=ring-3;float u=parasol?PARASOL_U[k]:spire?NEEDLE_U[k]:BROAD_U[k];
    for(int j=k;j<5;j++){
      float du=(parasol?PARASOL_U[j+1]-PARASOL_U[j]:spire?NEEDLE_U[j+1]-NEEDLE_U[j]:BROAD_U[j+1]-BROAD_U[j])*(h-bottom);
      float dr=(parasol?PARASOL_R[j+1]-PARASOL_R[j]:spire?NEEDLE_R[j+1]-NEEDLE_R[j]:BROAD_R[j+1]-BROAD_R[j])*r;
      arc+=sqrt(du*du+dr*dr);
    }
    cap=spire?((seg+dseg)%2==0?1.3:.45)*mix(.8,1.2,u):mix(.45,1.4,u);
    // The underside closes on the stem: no flat disc and no ring of sky between trunk and crown.
    radius=max(r*(parasol?PARASOL_R[k]:spire?NEEDLE_R[k]:BROAD_R[k]),k==0?collar:0.);y=bottom+u*(h-bottom);
    // Alternating branch tips keep spruce serrated from above while the stacked cones keep a narrow spire.
    if(spire)radius*=((seg+dseg)%2==0?1.:.68)*(1.+.045*sin(3.*angle+treeShape.w));
    // Leafless broadleaves keep a narrower, sparser outline; leafy ones get lumps.
    else radius*=(1.+.13*sin(3.*angle+2.*treeShape.w)*(1.-abs(u-.5)*1.4))*(!needle&&treeColor.w>.5?.8:1.);
  }
  vec3 local=vec3(dir.x*radius,y*fade,dir.y*radius);
  if(ring<3)treeNormal=vec3(dir.x,0.,dir.y);
  else if(spire)treeNormal=normalize(vec3(dir*(h-bottom),r).xzy);
  else {float mid=bottom+(parasol?.72:.4)*(h-bottom),hd=max(.55*(h-bottom),.1);treeNormal=normalize(vec3(local.x/(r*r),(y-mid)/(hd*hd),local.z/(r*r)));}
  world=vec3(treeBase.x-cameraOrigin.x+local.x,treeBase.z*exaggeration-cameraOrigin.y+local.y,treeBase.y-cameraOrigin.z+local.z);
  tint=ring<3?vec3(.24,.19,.14):treeColor.rgb;
  treeLevel=ring<3?0.:clamp((y-bottom)/max(h-bottom,.1),0.,1.);
  crownChart=vec4(dir*arc,fract(treeShape.w*.15915494),r);
  crownInfo=vec4(needle?1.:0.,ring<3||treeColor.w>.5?1.:0.,ring<3?0.:min(load*cap,.95),min(arc/max(r,.1),1.));
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
