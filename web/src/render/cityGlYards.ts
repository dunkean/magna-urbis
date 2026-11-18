/** City GPU renderer — lot enclosures (fences, hedges and walls on parcel limits) as stroke instances, for the live
 * compositor's town layer. Same runs and gates as drawLotEnclosures (cityLotEnclosures.ts, yardStyle.ts yardRuns):
 * one feature per look (material, culture, fence style), widths in metres with the look's minimum pixel width, runs
 * butt-ended unless closed; gate jambs as short ticks across the gap (rank 0: cart gates, 1: doors). Colours come from
 * yardStyle per palette (`yardColors`), so a palette change rewrites a few texels, never the instances. */
import type { Point } from '../../../rust/bridge/urban';
import type { CityPalette } from './cityCanvas';
import type { YardBoundary } from './cityLotEnclosures';
import { yardRuns, yardStyle, type YardGate, type YardRun } from './yardStyle';
import { putPolyline, STROKE_STRIDE, strokeWriter, type CityGlStrokes } from './cityGlBuild';

export interface CityGlYards {
  runs: CityGlStrokes;
  jambs: CityGlStrokes;
  looks: YardBoundary[];
}
const MATERIALS: YardBoundary['material'][] = ['hedge', 'fence', 'wall'];
/** Half length of a jamb tick and the gap from which a gate is a cart gate (m), as drawLotEnclosures. */
const JAMB = 0.6,
  CART = 2.4;

/** The enclosures of several towns (each list as `scene.lotEnclosures`), relative to `origin`. */
export function buildYardStrokes(lists: readonly (readonly YardBoundary[] | undefined)[], origin: Point): CityGlYards | undefined {
  const runs: YardRun[] = [],
    gates: YardGate[] = [];
  for (const list of lists)
    if (list?.length) {
      const r = yardRuns(list);
      runs.push(...r.runs);
      gates.push(...r.gates);
    }
  if (!runs.length && !gates.length) return undefined;
  const looks: YardBoundary[] = [],
    index = new Map<string, number>();
  const lookOf = (e: YardBoundary): number => {
    const key = `${e.material}/${e.culture ?? ''}/${e.fenceStyle ?? ''}`;
    let i = index.get(key);
    if (i === undefined) {
      index.set(key, (i = looks.length));
      looks.push(e);
    }
    return i;
  };
  // Hedges under fences under walls, as the Canvas strokes are ordered.
  runs.sort((a, b) => MATERIALS.indexOf(a.source.material) - MATERIALS.indexOf(b.source.material));
  const rw = strokeWriter(runs.reduce((s, r) => s + r.path.length, 0));
  for (const r of runs) {
    if (r.path.length < 2) continue;
    const style = yardStyle(r.source.material, r.source.culture, 'terrain', r.source.fenceStyle);
    putPolyline(rw, r.closed ? [...r.path, r.path[0]] : r.path, origin, style.width, style.minPx, lookOf(r.source), 0, !r.closed);
  }
  const jw = strokeWriter(gates.length * 2);
  for (const g of gates) {
    const l = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
    if (!(l > 0)) continue;
    const style = yardStyle(g.source.material, g.source.culture, 'terrain', g.source.fenceStyle),
      look = lookOf(g.source);
    const n = { x: (-(g.b.y - g.a.y) / l) * JAMB, y: ((g.b.x - g.a.x) / l) * JAMB },
      rank = l >= CART ? 0 : 1;
    for (const p of [g.a, g.b])
      putPolyline(
        jw,
        [
          { x: p.x - n.x, y: p.y - n.y },
          { x: p.x + n.x, y: p.y + n.y },
        ],
        origin,
        style.width * 0.7,
        1.3,
        look,
        rank,
        true,
      );
  }
  const done = (w: ReturnType<typeof strokeWriter>): CityGlStrokes => ({ data: w.buffer.slice(0, w.n * STROKE_STRIDE * 4), count: w.n, firstWithRank: new Array(16).fill(0) });
  return { runs: done(rw), jambs: done(jw), looks };
}
/** Colour tables of the looks for a palette: the stroke (colour, opacity) and the jambs (opaque). */
export function yardColors(looks: readonly YardBoundary[], palette: CityPalette): { line: Uint8Array; jamb: Uint8Array } {
  const n = Math.max(1, looks.length),
    line = new Uint8Array(n * 4),
    jamb = new Uint8Array(n * 4);
  const put = (out: Uint8Array, i: number, hex: string, alpha: number): void => {
    const v = parseInt(hex.slice(1, 7), 16) || 0;
    out[i * 4] = (v >> 16) & 255;
    out[i * 4 + 1] = (v >> 8) & 255;
    out[i * 4 + 2] = v & 255;
    out[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  };
  looks.forEach((e, i) => {
    const s = yardStyle(e.material, e.culture, palette, e.fenceStyle);
    put(line, i, s.color, s.alpha);
    put(jamb, i, s.jamb, 1);
  });
  return { line, jamb };
}
