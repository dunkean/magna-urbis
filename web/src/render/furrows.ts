/**
 * World-anchored furrows, one definition for the three painters: the SVG pattern (landuse.ts), the GPU stripe fill
 * (recorder `fillStripes`, cover shader) and the Canvas plough lines (furrowLines).
 */
import type { Polygon, Polyline } from '../gen/types';
import type { Stripe } from './gpu/contract';
import { bboxOf } from '../gen/geo/poly';

export const furrowDegrees = (angle: number): number => Math.round((angle * 180) / Math.PI) % 180;
const rawSpacing = (mapSize: number): number => Math.max(2.4, (1.5 * mapSize) / 1600);
// Match the SVG pattern's existing tenth-meter serialization, including its independently rounded offset.
export const furrowSpacing = (mapSize: number): number => Math.round(rawSpacing(mapSize) * 10) / 10;
export const furrowOffset = (mapSize: number): number => Math.round(rawSpacing(mapSize) * 5) / 10;

/** The furrows of a holding as world stripes: lines along the rounded strip direction, at `offset + k * period` across it. */
export function furrowStripe(mapSize: number, angle: number, width: number): Stripe {
  const theta = (furrowDegrees(angle) * Math.PI) / 180;
  return { nx: -Math.sin(theta), ny: Math.cos(theta), period: furrowSpacing(mapSize), offset: furrowOffset(mapSize), width };
}

/** Lines cover the holder's bounds; the renderer clips them to its actual strips and holes. */
export function furrowLines(poly: Polygon, mapSize: number, angle: number): Polyline[] {
  if (poly.length < 3 || !Number.isFinite(angle)) return [];
  const box = bboxOf(poly),
    { nx, ny, period: sp, offset } = furrowStripe(mapSize, angle, 0);
  const dx = ny,
    dy = -nx;
  const corners = [
    { x: box.x0, y: box.y0 },
    { x: box.x1, y: box.y0 },
    { x: box.x1, y: box.y1 },
    { x: box.x0, y: box.y1 },
  ];
  const along = corners.map(p => p.x * dx + p.y * dy),
    across = corners.map(p => p.x * nx + p.y * ny);
  const lo = Math.min(...along),
    hi = Math.max(...along);
  const first = Math.ceil((Math.min(...across) - offset) / sp),
    last = Math.floor((Math.max(...across) - offset) / sp);
  const out: Polyline[] = [];
  for (let i = first; i <= last; i++) {
    const n = i * sp + offset;
    out.push([
      { x: dx * lo + nx * n, y: dy * lo + ny * n },
      { x: dx * hi + nx * n, y: dy * hi + ny * n },
    ]);
  }
  return out;
}
/** Stable crop tone for a whole holding, shared by SVG and Canvas. */
export function holdingTone(poly: readonly { x: number; y: number }[]): number {
  const p = poly[0];
  if (!p) return 0;
  const hash = Math.imul(Math.round(p.x * 10), 0x45d9f3b) ^ Math.imul(Math.round(p.y * 10), 0x119de1f3);
  return (hash ^ (hash >>> 16)) & 3;
}
