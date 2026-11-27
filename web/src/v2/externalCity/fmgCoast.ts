import { clipRingBox } from '../../gen/geo/bool';
import type { CoastTrace } from '../coastTrace';

export interface FmgShore {
  /** FMG sea bearing in half turns. East is 0, north is 0.5. */
  sea: number;
  /** Distance from the burg to the shore in units of the sampled arc radius. */
  distance: number;
  /** Coordinates east/south of the nearest shore point, in the same units. */
  points: [number, number][];
}

export function parseFmgShore(sea: number | undefined, value: unknown): FmgShore | undefined {
  if (sea === undefined || sea < 0 || sea > 2 || !value || typeof value !== 'object') return;
  const { distance, points } = value as Record<string, unknown>;
  const bounded = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 2;
  if (!bounded(distance) || distance < 0 || !Array.isArray(points) || points.length < 3 || points.length > 9) return;
  if (!points.every(p => Array.isArray(p) && p.length === 2 && p.every(bounded))) return;
  return { sea, distance, points };
}

/** Fit the FMG arc to the district scale. Smooth the cell corners and extend the fitted tangent away from the sampled shore. */
export function fmgCoastTrace(shore: FmgShore): CoastTrace | undefined {
  const angle = -shore.sea * Math.PI, nx = Math.cos(angle), ny = Math.sin(angle);
  const arc = shore.points.map(([x, y]) => ({ along: -ny * x + nx * y, across: nx * x + ny * y })).sort((a, b) => a.along - b.along);
  if (arc[arc.length - 1].along - arc[0].along < 0.3) return;
  // FMG has no city footprint and places port markers almost on the coast. Give the generated town a dry core;
  // the distance from other burg markers still affects how far the shore sits beyond it.
  const gap = 0.12 + Math.min(0.15, shore.distance * 0.30);
  const bend = (offset: number) => Math.max(0.065, gap + Math.max(-0.11, Math.min(0.11, offset * 0.35)));
  const point = (along: number, across: number): [number, number] => [0.5 - ny * along + nx * across, 0.5 + nx * along + ny * across];
  const contour = arc.map(({ along, across }, i) => {
    const smoothed = ((arc[i - 1]?.across ?? across) + 2 * across + (arc[i + 1]?.across ?? across)) / 4;
    return point(along * 0.4, bend(smoothed));
  });
  const start = point(-2, bend(arc[0].across)), end = point(2, bend(arc[arc.length - 1].across));
  const ring = clipRingBox([start, ...contour, end, point(2, 2), point(-2, 2), start], { x0: 0, y0: 0, x1: 1, y1: 1 });
  if (ring.length < 3) return;
  return { version: 1, lines: [{ points: ring.flat().map(v => Math.max(0, Math.min(1, v))), closed: true, flipped: true }] };
}
