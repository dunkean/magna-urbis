/** Painted regional roads for the `render` map style (terrainRoads.ts, preset "render").
 *
 * Every road is a stack of strokes: a soft ground shadow, a dark casing, the surface,
 * then surface detail (a lit crown on paved roads, a stipple of joints or gravel, ruts on
 * dirt). Bridges are stone decks: shadow on the water, dark outline, light parapets,
 * a thin inner line, the deck and its transverse joints.
 *
 * Widths are `max(px, k · metres) + max(addPx, k · addMetres)` with `k` the view scale
 * (screen px per metre, CSS variable `--road-k` on the layer): a road keeps a cartographic
 * weight at region zoom and its true width (the city's regional streets) at town zoom. */
import type { RoadClass, RoadSurface } from '../../../rust/bridge/settlements';

export type RoadStrokeLayer = 'ditch' | 'verge' | 'shadow' | 'casing' | 'fill' | 'detail';
/** Bottom to top. Each (layer, colour, opacity) is one group with the opacity on the group,
 * so overlapping strokes at junctions never darken twice (no blobs). */
export const ROAD_STROKE_LAYERS: readonly RoadStrokeLayer[] = ['ditch', 'verge', 'shadow', 'casing', 'fill', 'detail'];
export interface RoadStroke {
  layer: RoadStrokeLayer; color: string;
  /** Share of the road's base width (screen px floor and metres alike). */
  scale: number;
  /** Width added on top of the base: screen floor, metres. */
  addPx: number; addM: number;
  opacity?: number; dash?: string; cap?: 'butt' | 'round';
  /** Ditches: the band between this stroke and a narrower cut (same base) is kept, through a mask. */
  cut?: { addPx: number; addM: number };
}

/** Cartographic floor of each class at region zoom, screen px. */
export const RENDER_ROAD_PX: Record<RoadClass, number> = { highway: 4, main: 3.2, local: 2.4, track: 1.8, trail: 1.3 };

const FILL: Record<RoadSurface, Partial<Record<RoadClass, string>> & { default: string }> = {
  paved: { highway: '#e0c088', main: '#d6b47c', default: '#ccb084' },
  flagstone: { default: '#cfc3a6' },
  gravel: { default: '#c6b594' },
  dirt: { trail: '#a98a62', default: '#9f7c51' },
};
const CASING: Record<RoadSurface, string> = { paved: '#2e2216', flagstone: '#2a241c', gravel: '#392f23', dirt: '#3b2b1a' };

/** Roadsides of the made-up regional roads: verge half-width and ditch outer half-width (m).
 * Metres only (no screen floor): they open up at town zoom and vanish under the casing at region zoom. */
const ROADSIDE: Partial<Record<RoadClass, [number, number]>> = { highway: [4, 5.6], main: [3.2, 4.6], local: [2.2, 3.2] };

export function renderRoadStrokes(c: RoadClass, s: RoadSurface): RoadStroke[] {
  const fill = FILL[s][c] ?? FILL[s].default, trail = c === 'trail', side = s === 'dirt' ? undefined : ROADSIDE[c];
  const strokes: RoadStroke[] = side ? [
    // Ditches: two dark bands beyond the verges.
    { layer: 'ditch', color: '#141c0e', scale: 1, addPx: 0, addM: 2 * side[1], opacity: 0.42, cut: { addPx: 0, addM: 2 * side[0] } },
    // Verges: worn, dusty shoulders lightening the ground on both sides.
    { layer: 'verge', color: '#d9caa0', scale: 1, addPx: 0, addM: 2 * side[0], opacity: 0.16 },
  ] : trail ? [] : [
    // Dust kicked up along dirt tracks.
    { layer: 'verge', color: '#c9ae80', scale: 1, addPx: 1.6, addM: 3, opacity: 0.2 },
  ];
  strokes.push(
    { layer: 'shadow', color: '#0b1208', scale: 1, addPx: trail ? 2 : 3.5, addM: trail ? 1.5 : 3, opacity: trail ? 0.22 : 0.32 },
    s === 'dirt'
      ? { layer: 'casing', color: CASING.dirt, scale: 1, addPx: 1, addM: 0.6, opacity: 0.6, dash: trail ? '1.2 2.4' : undefined }
      : { layer: 'casing', color: CASING[s], scale: 1, addPx: 1.6, addM: 1 },
    { layer: 'fill', color: fill, scale: 1, addPx: 0, addM: 0, dash: trail ? '1.2 2.4' : undefined },
  );
  if (trail) return strokes;
  if (s === 'paved' || s === 'flagstone') {
    strokes.push({ layer: 'detail', color: s === 'paved' ? '#7d6141' : '#6d604c', scale: 0.82, addPx: 0, addM: 0, opacity: s === 'paved' ? 0.26 : 0.34, dash: s === 'paved' ? '0.6 1.8' : '0.5 1.5', cap: 'butt' });
    strokes.push({ layer: 'detail', color: '#f2dfb4', scale: 0.32, addPx: 0, addM: 0, opacity: 0.45 });
  } else if (s === 'gravel') strokes.push({ layer: 'detail', color: '#8d7c60', scale: 0.62, addPx: 0, addM: 0, opacity: 0.38, dash: '0.4 1.1', cap: 'butt' });
  else strokes.push({ layer: 'detail', color: '#674a2b', scale: 0.34, addPx: 0, addM: 0, opacity: 0.45, dash: '4 2.5' });
  return strokes;
}

export function renderCrossingStrokes(kind: 'bridge' | 'ford' | 'causeway'): RoadStroke[] {
  const butt = 'butt' as const;
  if (kind === 'bridge') return [
    { layer: 'shadow', color: '#04090b', scale: 1, addPx: 7, addM: 6, opacity: 0.5, cap: butt },
    { layer: 'casing', color: '#231a12', scale: 1, addPx: 4.4, addM: 3.4, cap: butt },
    { layer: 'casing', color: '#dacba9', scale: 1, addPx: 3, addM: 2.4, cap: butt },
    { layer: 'casing', color: '#4a3c2d', scale: 1, addPx: 1.2, addM: 0.8, cap: butt },
    { layer: 'fill', color: '#a8957a', scale: 1, addPx: 0, addM: 0, cap: butt },
    { layer: 'detail', color: '#7a6850', scale: 1, addPx: 0, addM: 0, opacity: 0.55, dash: '1 3.2', cap: butt },
  ];
  if (kind === 'causeway') return [
    { layer: 'shadow', color: '#04090b', scale: 1, addPx: 5, addM: 4, opacity: 0.4 },
    { layer: 'casing', color: '#2f281e', scale: 1, addPx: 2.6, addM: 2 },
    { layer: 'casing', color: '#a69676', scale: 1, addPx: 1, addM: 0.8 },
    { layer: 'fill', color: '#c4b493', scale: 1, addPx: 0, addM: 0 },
  ];
  return [
    { layer: 'casing', color: '#7fb0b2', scale: 1, addPx: 0.6, addM: 0.4, opacity: 0.7, dash: '1 2' },
    { layer: 'detail', color: '#d4e6e1', scale: 0.4, addPx: 0, addM: 0, opacity: 0.8, dash: '0.6 2.4' },
  ];
}

/** CSS stroke width of one stroke on a road of base `px` (screen floor) and `metres`. */
export function roadStrokeWidth(stroke: Pick<RoadStroke, 'scale' | 'addPx' | 'addM'>, px: number, metres: number): string {
  const f = (v: number): string => String(+v.toFixed(3));
  const base = `max(${f(px * stroke.scale)}px, calc(var(--road-k, 0) * ${f(metres * stroke.scale)}px))`;
  return stroke.addPx || stroke.addM ? `calc(${base} + max(${f(stroke.addPx)}px, calc(var(--road-k, 0) * ${f(stroke.addM)}px)))` : base;
}

/** Station of the projection of `p` on `points` (metres along the polyline). */
function project(points: readonly { x: number; y: number }[], station: number[], p: { x: number; y: number }): number {
  let best = Infinity, at = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    if (d < best) { best = d; at = station[i - 1] + t * (station[i] - station[i - 1]); }
  }
  return at;
}

/** The road cut at its crossings: pieces between crossings (to be curved) and the crossing
 * spans themselves (kept straight), so a smoothed road runs exactly onto its bridges. */
export function splitAtCrossings<P extends { x: number; y: number }, K extends string>(path: readonly P[], crossings: readonly { path: readonly P[]; kind: K }[]): { path: P[]; crossing?: K }[] {
  if (path.length < 2 || !crossings.length) return [{ path: [...path] }];
  const station = [0];
  for (let i = 1; i < path.length; i++) station.push(station[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = station[station.length - 1];
  const spans = crossings.filter(c => c.path.length > 1).map(c => {
    const a = project(path, station, c.path[0]), b = project(path, station, c.path[c.path.length - 1]);
    return [Math.min(a, b), Math.max(a, b), c.kind] as const;
  }).sort((a, b) => a[0] - b[0]);
  const pointAt = (d: number): P => {
    let i = 1; while (i < station.length - 1 && station[i] < d) i++;
    const t = (d - station[i - 1]) / (station[i] - station[i - 1] || 1), a = path[i - 1], b = path[i];
    return { ...a, x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };
  const piece = (from: number, to: number): P[] => [pointAt(from), ...path.filter((_, j) => station[j] > from && station[j] < to), pointAt(to)];
  const out: { path: P[]; crossing?: K }[] = [];
  let at = 0;
  for (const [from, to, kind] of spans) {
    if (to <= at) continue;
    const start = Math.max(at, from);
    if (start - at > 0.01) out.push({ path: piece(at, start) });
    if (to - start > 0.01) out.push({ path: piece(start, to), crossing: kind });
    at = to;
  }
  if (total - at > 0.01) out.push({ path: piece(at, total) });
  return out;
}
