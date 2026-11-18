/**
 * Which tier of baked ground tiles a square of a tilted frame is draped with (contract.ts). Called by the draped
 * ground for each square it draws.
 */

/** The tier of the tiles for a square whose nearest corner is `depth` metres along the view axis of a camera of focal
 * length `focal` (device pixels): the coarsest tier whose density is at least the density of the screen there, which
 * is the rule of the top view (tiles minified by less than 2 across the view axis, never magnified) and gives its tier
 * when the camera looks straight down. Capped at the tier of the square (one tile holds it) and at the finest tier
 * baked. Tier k has `tilePixels * 2^k / mapSize` pixels per metre. */
export function drapeTier(focal: number, depth: number, mapSize: number, tilePixels: number, squareTier: number, finestTier: number): number {
  const wanted = Math.ceil(Math.log2(focal / depth / (tilePixels / mapSize)) - 1e-9);
  return Math.max(0, Math.min(wanted, squareTier, finestTier));
}
