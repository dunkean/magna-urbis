/**
 * Small plants of the water's edge on the tilted map: reeds on temperate, tropical and wetland banks and lake shores, sedge
 * in the cold zones, dry grass in the steppe and the savanna, grass and tamarisk tufts in the desert. Placement only
 * (bankPlantsLayer.ts draws it): deterministic, in blocks of the map, thicker against the water and broken into irregular
 * clumps and gaps. The water is the one the modelled trees keep off (treesWater.ts), so the plants stand along the banks
 * the ground draws; buildings, quays, ways and gardens keep theirs clear. Seasons tint them as the herbaceous ground.
 */
import type { ClimateZone } from '../../../../rust/bridge/terrainClimate';
import { forestHash } from '../../../../rust/bridge/terrainForest';
import { calendarSeason, seasonWeights } from '../../../../rust/bridge/terrainRenderV2Zones';
import { wayRoomOf, type TreeInputs } from '../../ui/terrain3dTrees';
import type { TreeBuildings } from './treesBuildings';

/** Side of a block (m). */
export const BANK_BLOCK = 48;
/** Floats per plant: block-local x, y, ground (m), height; radius, shape (0 blades, 1 tuft), phase, lean; colour, snow. */
export const BANK_STRIDE = 12;
/** Spacing of the water samples and of the candidate plants (m), and the farthest from the water a plant grows (m). */
const CELL = 1.5,
  REACH = 9;
/** Ground this low (m) is the sea's, and the rise over three metres past which a bank is bare (m). */
const SEA_SHORE = 0.8,
  STEEP = 1.6;
const MARGIN = Math.ceil(REACH / CELL),
  INNER = BANK_BLOCK / CELL,
  SIDE = INNER + 2 * MARGIN;

type Rgb = readonly [number, number, number];
interface Flora {
  /** Plant heights (m), radius over height, distance from the water (m), share of the bank covered. */
  low: number;
  high: number;
  girth: number;
  reach: number;
  cover: number;
  colour: Rgb;
  /** Share of woody tufts (tamarisk) among the blades, and their colour. */
  tufts: number;
  tuft: Rgb;
  /** Share of the plants that stand in the shallows. */
  wet: number;
}
const REEDS: Flora = { low: 1.2, high: 2.5, girth: 0.3, reach: 3.5, cover: 0.62, colour: [0.35, 0.4, 0.17], tufts: 0, tuft: [0, 0, 0], wet: 0.4 };
const SEDGE: Flora = { low: 0.4, high: 0.9, girth: 0.5, reach: 4, cover: 0.45, colour: [0.36, 0.38, 0.19], tufts: 0, tuft: [0, 0, 0], wet: 0.15 };
const GRASS: Flora = { low: 0.6, high: 1.3, girth: 0.4, reach: 7, cover: 0.42, colour: [0.5, 0.45, 0.24], tufts: 0.04, tuft: [0.34, 0.36, 0.2], wet: 0.05 };
const FLORA: Readonly<Record<ClimateZone, Flora>> = {
  temperate: REEDS,
  mediterranean: { ...REEDS, high: 3, cover: 0.45, colour: [0.4, 0.4, 0.2], tufts: 0.08, tuft: [0.33, 0.37, 0.24] },
  continental: REEDS,
  nordic: SEDGE,
  alpine: { ...SEDGE, cover: 0.3 },
  arctic: { ...SEDGE, high: 0.6, cover: 0.3 },
  steppe: { ...GRASS, colour: [0.48, 0.45, 0.25] },
  desert: { ...GRASS, reach: 9, cover: 0.34, colour: [0.54, 0.46, 0.28], tufts: 0.4, tuft: [0.38, 0.4, 0.26] },
  savanna: GRASS,
  tropical: { ...REEDS, high: 3.3, reach: 5, cover: 0.6, colour: [0.25, 0.38, 0.13] },
  wetland: { ...REEDS, reach: 7, cover: 0.75 },
};
/** Ground classes of the occupation raster no plant grows on: orchards, gardens, built ground and precincts. */
const KEPT_CLEAR = new Set([4, 5, 8, 9, 11, 12]);

const unit = (h: number, shift: number): number => (((h >>> shift) & 255) + 0.5) / 256;
const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function valueNoise(x: number, y: number, seed: number): number {
  const i = Math.floor(x),
    j = Math.floor(y),
    fx = smooth(0, 1, x - i),
    fy = smooth(0, 1, y - j),
    at = (a: number, b: number): number => unit(forestHash(i + a, j + b, 411, seed), 8);
  return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
}

export interface BankBlock {
  data: Float32Array;
  count: number;
}

/** The plants of the block (bx, by), in an order whose every prefix covers the block evenly. */
export function* bankBlockSteps(inputs: TreeInputs, bx: number, by: number, buildings?: TreeBuildings): Generator<void, BankBlock> {
  const minX = bx * BANK_BLOCK,
    minY = by * BANK_BLOCK,
    wet = new Uint8Array(SIDE * SIDE);
  let some = false,
    all = true;
  for (let j = 0; j < SIDE; j++) {
    for (let i = 0; i < SIDE; i++) {
      const on = inputs.water(minX + (i - MARGIN + 0.5) * CELL, minY + (j - MARGIN + 0.5) * CELL) >= 0.5;
      if (on) {
        wet[j * SIDE + i] = 1;
        some = true;
      } else all = false;
    }
    if (j % 8 === 7) yield;
  }
  if (!some || all) return { data: new Float32Array(0), count: 0 };
  /** Distance (m) from a cell to the nearest cell of the other kind, up to `reach`. */
  const edge = (i: number, j: number, reach: number): number => {
    const own = wet[j * SIDE + i],
      n = Math.min(MARGIN, Math.ceil(reach / CELL));
    let best = Infinity;
    for (let dy = -n; dy <= n; dy++) {
      const y = j + dy;
      if (y < 0 || y >= SIDE) continue;
      for (let dx = -n; dx <= n; dx++) {
        const x = i + dx;
        if (x >= 0 && x < SIDE && wet[y * SIDE + x] !== own) best = Math.min(best, dx * dx + dy * dy);
      }
    }
    return Math.sqrt(best) * CELL;
  };
  const zone = inputs.climateZone ?? 'temperate',
    flora = FLORA[zone],
    seed = (inputs.seed ^ 0x51ed270b) >>> 0,
    occ = inputs.occupation,
    ways = occ?.ways?.length ? wayRoomOf(occ.ways) : undefined,
    year = calendarSeason(zone, inputs.calendar),
    weights = seasonWeights(inputs.season),
    tint = [0, 1, 2].map(c => weights.reduce((sum, w, k) => sum + w * year.herb[k][c], 0)),
    quarter = (((inputs.season % 1) + 1) % 1) * 4,
    winter = Math.max(0, 1 - Math.min(quarter, 4 - quarter)),
    snow = 0.6 * winter * (1 - smooth(2, 10, inputs.climate.temperature)),
    plants: number[][] = [];
  const clear = (x: number, y: number): boolean => {
    if (occ) {
      const i = Math.max(0, Math.min(occ.n - 1, Math.floor(((x - occ.x) / occ.width) * occ.n))),
        j = Math.max(0, Math.min(occ.n - 1, Math.floor(((y - occ.y) / occ.width) * occ.n)));
      if (KEPT_CLEAR.has(occ.rgba[(j * occ.n + i) * 4 + 2])) return false;
    }
    return (!ways || ways.keeps(x, y, 0.5)) && (!buildings || buildings.keeps(x, y, 0.5));
  };
  for (let j = 0; j < INNER; j++) {
    for (let i = 0; i < INNER; i++) {
      const gi = bx * INNER + i,
        gj = by * INNER + j,
        h = forestHash(gi, gj, 613, seed),
        si = i + MARGIN,
        sj = j + MARGIN,
        under = wet[sj * SIDE + si] === 1;
      // In the shallows: one cell from the bank at most.
      if (under && unit(h, 24) >= flora.wet) continue;
      const distance = edge(si, sj, under ? CELL : flora.reach);
      if (distance > (under ? CELL * 1.5 : flora.reach)) continue;
      const x = minX + (i + 0.1 + 0.8 * unit(h, 0)) * CELL,
        y = minY + (j + 0.1 + 0.8 * unit(h, 8)) * CELL,
        near = under ? 1 : 1 - (distance / flora.reach) ** 1.5,
        // Clumps of a few metres in stands of some twenty, with bare stretches between.
        clump = 0.55 * valueNoise(x / 21, y / 21, seed) + 0.3 * valueNoise(x / 6.5 + 7.7, y / 6.5, seed) + 0.15 * unit(h, 16);
      if (clump > 0.18 + 0.62 * flora.cover * near) continue;
      if (!clear(x, y)) continue;
      const z = inputs.height(x, y);
      // Neither at the sea, whose shores are beaches and rock, nor on a steep bank.
      if (z === undefined || z <= SEA_SHORE || Math.abs((inputs.height(x + 3, y) ?? z) - z) > STEEP || Math.abs((inputs.height(x, y + 3) ?? z) - z) > STEEP) continue;
      const h2 = forestHash(gi, gj, 617, seed),
        tuft = unit(h2, 0) < flora.tufts,
        height = (tuft ? 0.8 + 1.4 * unit(h2, 8) : flora.low + (flora.high - flora.low) * unit(h2, 8)) * (0.65 + 0.35 * near),
        tone = 0.82 + 0.36 * unit(h2, 16),
        base = tuft ? flora.tuft : flora.colour;
      plants.push([x - minX, y - minY, z, height, height * (tuft ? 0.55 : flora.girth), tuft ? 1 : 0, 6.2831853 * unit(h2, 24), unit(h, 24), base[0] * tone * tint[0], base[1] * tone * tint[1], base[2] * tone * tint[2], snow * (0.5 + 0.5 * unit(h, 8))]);
    }
    if (j % 4 === 3) yield;
  }
  // Shuffled once: every level of detail and density draws a prefix of one array.
  let state = Math.imul(bx, 0x9e3779b1) ^ Math.imul(by, 0x85ebca77) ^ 0x6c8e9cf5 || 1;
  for (let i = plants.length - 1; i > 0; i--) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const j = (state >>> 0) % (i + 1);
    [plants[i], plants[j]] = [plants[j], plants[i]];
  }
  return { data: Float32Array.from(plants.flat()), count: plants.length };
}

/** Share of the plants drawn, and of those drawn as full clumps, for a plant of BANK_SIZE_M spanning `pixels`. */
export const BANK_SIZE_M = 1.6;
export const bankDrawShare = (pixels: number): number => Math.min(1, (pixels / 7) ** 2) * smooth(1, 2.5, pixels);
export const bankFullShare = (pixels: number): number => smooth(14, 32, pixels);
