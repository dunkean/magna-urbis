/** Renderer-only, inferred arrangement of existing material/cover probabilities.
 * No DEM, soil, geology, hydrology or population fields are modified. */
export const SURFACE_DETAIL_DISTRIBUTION_VERSION = 'surface-detail-distribution-1';
export const DETAIL_BANDS = Object.freeze([
  Object.freeze({ metres: 12, weight: .4 }),
  Object.freeze({ metres: 1.7, weight: .35 }),
  Object.freeze({ metres: .17, weight: .25 }),
]);
const TAU = 2 * Math.PI;
const fract = (v: number) => v - Math.floor(v);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** CDF of distance to the centre of a unit square, under uniform area measure.
 * Unlike thresholded value noise this has a known probability calibration. */
export function squareRadiusCdf(radius: number): number {
  if (!Number.isFinite(radius) || radius < 0) throw Error('Invalid detail radius');
  if (radius >= Math.SQRT1_2) return 1;
  const r2 = radius * radius;
  if (radius <= .5) return Math.PI * r2;
  return clamp(Math.PI * r2 - 4 * (r2 * Math.acos(.5 / radius) - .5 * Math.sqrt(r2 - .25)), 0, 1);
}
/** Three periodic shears each have determinant one, preserving area measure.
 * The rank therefore has a uniform marginal on [0,1]. It allocates materials,
 * never RGB. Phase/coordinates are in a fixed metric world frame. */
export function detailRank(x: number, z: number, phaseX = 0, phaseZ = 0): number {
  if (![x,z,phaseX,phaseZ].every(Number.isFinite)) throw Error('Invalid detail coordinates');
  let u = fract(x + phaseX), v = fract(z + phaseZ);
  u = fract(u + .22 * Math.sin(TAU * v));
  v = fract(v + .22 * Math.sin(TAU * u));
  u = fract(u + .16 * Math.sin(TAU * v));
  return squareRadiusCdf(Math.hypot(u - .5, v - .5));
}
/** Circular box convolution of one probability interval. Periodic wrapping
 * preserves its integral even for probability 0/1 or intervals crossing zero. */
export function intervalMass(rank: number, start: number, probability: number, halfWidth: number): number {
  if (![rank,start,probability,halfWidth].every(Number.isFinite) || probability < 0 || probability > 1 || halfWidth < 0) throw Error('Invalid detail probability/filter');
  if (probability === 0 || probability === 1 || halfWidth >= .5) return probability;
  const q = fract(rank - start), h = Math.max(.000001, halfWidth);
  const lo = q - h, hi = q + h;
  const overlap = (a: number, b: number) => Math.max(0, Math.min(hi, b) - Math.max(lo, a));
  return clamp((overlap(0, probability) + overlap(1, 1 + probability) + overlap(-1, probability - 1)) / (2 * h), 0, 1);
}
export function detailMass(x: number, z: number, start: number, probability: number, footprintMetres: number, phaseX = 0, phaseZ = 0): number {
  if (!Number.isFinite(footprintMetres) || footprintMetres < 0) throw Error('Invalid detail footprint');
  let mass = 0;
  for (const band of DETAIL_BANDS) mass += band.weight * intervalMass(detailRank(x / band.metres, z / band.metres, phaseX, phaseZ), start, probability, footprintMetres / band.metres);
  return mass;
}
/** Existing fractions may sum below one: the remainder is uncovered support.
 * It is deliberately not renormalised, so ground and low cover are not one
 * artificial global partition with the canopy. */
export function redistributeDetail(weights: readonly number[], x: number, z: number, footprintMetres: number, phaseX = 0, phaseZ = 0): number[] {
  let start = 0;
  return weights.map(probability => {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1 || start + probability > 1 + 1e-9) throw Error('Invalid existing material probabilities');
    const result = detailMass(x,z,start,probability,footprintMetres,phaseX,phaseZ);
    start += probability;
    return result;
  });
}
