/**
 * Affine matrices and device-pixel boxes of the WebGL2 vector rasterizer (replay.ts, resources.ts).
 * `Mat` is the Canvas 2D matrix [a, b, c, d, e, f]; a `Box` is [x0, y0, x1, y1].
 */
import type { Mat } from './contract';

export type Box = readonly [number, number, number, number];

export function compose(a: Mat, b: Mat): Mat {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
export function inverse(m: Mat): Mat | null {
  const d = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(d) || Math.abs(d) < 1e-30) return null;
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}
export function scale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}
/** Flattening tolerance bucket (a power of two) of a transform. */
export function tolerance(m: Mat): number {
  // Largest singular value keeps the flattening error <= .25 px even under shear.
  const a = m[0] * m[0] + m[1] * m[1],
    b = m[2] * m[2] + m[3] * m[3],
    c = m[0] * m[2] + m[1] * m[3];
  const s = Math.sqrt((a + b + Math.hypot(a - b, 2 * c)) / 2);
  return 2 ** Math.max(-40, Math.min(40, Math.floor(Math.log2(0.25 / Math.max(s, 1e-12)))));
}
export function transformedBox(b: Box, m: Mat, pad = 0): Box {
  if (b[2] < b[0] || b[3] < b[1]) return [Infinity, Infinity, -Infinity, -Infinity];
  const x0 = m[0] * b[0],
    x1 = m[0] * b[2],
    x2 = m[2] * b[1],
    x3 = m[2] * b[3];
  const y0 = m[1] * b[0],
    y1 = m[1] * b[2],
    y2 = m[3] * b[1],
    y3 = m[3] * b[3];
  return [Math.min(x0, x1) + Math.min(x2, x3) + m[4] - pad, Math.min(y0, y1) + Math.min(y2, y3) + m[5] - pad, Math.max(x0, x1) + Math.max(x2, x3) + m[4] + pad, Math.max(y0, y1) + Math.max(y2, y3) + m[5] + pad];
}
export const overlaps = (a: Box, b: Box): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
export const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
export const intersect = (a: Box, b: Box): Box => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
