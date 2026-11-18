/**
 * Which tier of baked ground tiles a square of a tilted frame is draped with (contract.ts). Called by the draped
 * ground for each square it draws.
 */

/** Octaves of screen density a square's tier holds past the edges of its range before it changes: a camera that
 * moves a little, or a square that sits on a boundary, does not switch tiers back and forth. */
const HYSTERESIS = 0.25;

/** The tier of the tiles for a square whose nearest corner is `depth` metres along the view axis of a camera of focal
 * length `focal` (device pixels): the coarsest tier whose density is at least the density of the screen there, which
 * is the rule of the top view (tiles minified by less than 2 across the view axis, never magnified) and gives its tier
 * when the camera looks straight down. Capped at the tier of the square (one tile holds it) and at the finest tier
 * baked. Tier k has `tilePixels * 2^k / mapSize` pixels per metre. `previous`: the tier the square had in the last
 * frame (-1: none), kept while the density stays within HYSTERESIS of its range. */
export function drapeTier(focal: number, depth: number, mapSize: number, tilePixels: number, squareTier: number, finestTier: number, previous = -1): number {
  const level = Math.log2(focal / depth / (tilePixels / mapSize)),
    cap = Math.min(squareTier, finestTier);
  if (previous >= 0 && previous <= cap && level <= previous + HYSTERESIS && level > previous - 1 - HYSTERESIS) return previous;
  return Math.max(0, Math.min(Math.ceil(level - 1e-9), cap));
}
