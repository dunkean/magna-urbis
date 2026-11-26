/** Fit the actual flat-capped, mitered channel to the public cut before it enters the routing graph. */
import type { Polygon, Polyline, Vec2 } from '../core/geom';
import { dist, lerp } from '../core/geom';
import { prepareIntersection } from '../geo/bool';
import { ribbon } from '../geo/offset';
import { area } from '../geo/poly';

export const MIN_CHANNEL_WIDTH = 2.2;

export interface Channel {
  path: Polyline;
  width: number;
}

/** Keep the preferred section wherever it fits. Only search a constrained section, to centimetre precision. */
export function fitChannel(preferred: number, tryPath: (width: number) => Polyline | undefined): Channel | undefined {
  if (preferred < MIN_CHANNEL_WIDTH) return;
  const full = tryPath(preferred);
  if (full) return { path: full, width: preferred };
  if (preferred === MIN_CHANNEL_WIDTH) return;
  let lo = MIN_CHANNEL_WIDTH,
    hi = preferred;
  let path = tryPath(lo);
  if (!path) return;
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2;
    const fitted = tryPath(mid);
    if (fitted) {
      lo = mid;
      path = fitted;
    } else hi = mid;
  }
  return { path, width: lo };
}

/** Only an obstruction at the flat cap may shorten its leg. An interior obstruction constrains width instead. */
function capSetback(overlap: Polygon, tip: Vec2, inner: Vec2, width: number): number | undefined {
  const length = dist(tip, inner);
  if (length < 0.02) return;
  const dx = (inner.x - tip.x) / length,
    dy = (inner.y - tip.y) / length;
  let first = Infinity,
    depth = 0;
  for (const p of overlap) {
    const x = p.x - tip.x,
      y = p.y - tip.y;
    const along = x * dx + y * dy;
    if (along < -0.001 || along + 0.02 >= length || Math.abs(x * dy - y * dx) > width / 2 + 0.001) return;
    first = Math.min(first, along);
    depth = Math.max(depth, along);
  }
  return first <= 0.001 ? depth + 0.01 : undefined;
}

export function canalClearance(occupied: Polygon[]) {
  // One prepared spatial index for the completed blocks, roofs and private passages.
  const intersect = prepareIntersection(occupied.map(outer => ({ outer, holes: [] })));
  const clear = (path: Polyline, width: number) => {
    const strip = ribbon(path, width);
    if (!(area(strip) > 0)) return false;
    const hit = intersect(strip);
    return !hit.failed && !hit.pieces.length;
  };
  const fitCut = (axis: Polyline, preferred: number) =>
    fitChannel(preferred, width => {
      const strip = ribbon(axis, width);
      if (!(area(strip) > 0)) return;
      const hit = intersect(strip);
      if (hit.failed) return;
      if (!hit.pieces.length) return axis;

      // An oblique lot boundary can project across a flat cap even when it misses the axis.
      // Take the setback from the actual intersection, preserving the width along the rest of the cut.
      const ends = [0, axis.length - 1].map(i => {
        const tip = axis[i],
          inner = axis[i === 0 ? 1 : i - 1];
        return { i, tip, inner, setback: 0 };
      });
      for (const { outer } of hit.pieces) {
        let atCap = false;
        for (const end of ends) {
          const setback = capSetback(outer, end.tip, end.inner, width);
          if (setback === undefined) continue;
          end.setback = Math.max(end.setback, setback);
          atCap = true;
          break;
        }
        if (!atCap) return;
      }
      if (axis.length === 2 && ends[0].setback + ends[1].setback + 0.02 >= dist(axis[0], axis[1])) return;
      const path = axis.slice();
      for (const end of ends) if (end.setback) path[end.i] = lerp(end.tip, end.inner, end.setback / dist(end.tip, end.inner));
      return clear(path, width) ? path : undefined;
    });
  return { clear, fitCut };
}
