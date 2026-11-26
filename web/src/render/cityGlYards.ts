/** City GPU renderer — lot enclosures (fences, hedges and walls on parcel limits) as stroke instances, for the live
 * compositor's town layer. Same runs and gates as drawLotEnclosures (cityLotEnclosures.ts, yardStyle.ts yardRuns):
 * one feature per look (material, culture, fence style), widths in metres with the look's minimum pixel width, runs
 * butt-ended unless closed; gate jambs as short ticks across the gap (rank 0: cart gates, 1: doors). Colours come from
 * yardStyle per palette (`yardColors`), so a palette change rewrites a few texels, never the instances. */
import type { Point } from '../../../rust/bridge/urban';
import type { CityPalette } from './cityCanvas';
import type { YardBoundary } from './cityLotEnclosures';
import { RetainedYardRuns, yardStyle, type YardGate, type YardRun } from './yardStyle';
import { orderedStrokes, putPolyline, STROKE_STRIDE, strokeWriter, type CityGlStrokes } from './cityGlBuild';

export interface CityGlYards {
  runs: CityGlStrokes;
  jambs: CityGlStrokes;
  looks: YardBoundary[];
}
const MATERIALS: YardBoundary['material'][] = ['hedge', 'fence', 'wall'];
/** Half length of a jamb tick and the gap from which a gate is a cart gate (m), as drawLotEnclosures. */
const JAMB = 0.6,
  CART = 2.4;

export class YardStrokeBuilder {
  private towns: RetainedYardRuns[] = [];
  readonly looks: YardBoundary[] = [];
  private lookIndex = new Map<string, number>();
  private buffers = new WeakMap<YardRun | YardGate, ArrayBuffer>();
  constructor(private origin: Point) {}
  private buffer(part: YardRun | YardGate): ArrayBuffer {
    let data = this.buffers.get(part);
    if (data) return data;
    const e = part.source,
      key = [e.material, e.culture ?? '', e.fenceStyle ?? ''].join('/');
    let look = this.lookIndex.get(key);
    if (look === undefined) {
      this.lookIndex.set(key, (look = this.looks.length));
      this.looks.push(e);
    }
    const style = yardStyle(e.material, e.culture, 'terrain', e.fenceStyle);
    const w = strokeWriter('path' in part ? part.path.length : 2);
    if ('path' in part) putPolyline(w, part.closed ? [...part.path, part.path[0]] : part.path, this.origin, style.width, style.minPx, look, 0, !part.closed);
    else {
      const { a, b } = part,
        len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 0) {
        const nx = (-(b.y - a.y) / len) * JAMB,
          ny = ((b.x - a.x) / len) * JAMB;
        for (const p of [a, b])
          putPolyline(
            w,
            [
              { x: p.x - nx, y: p.y - ny },
              { x: p.x + nx, y: p.y + ny },
            ],
            this.origin,
            style.width * 0.7,
            1.3,
            look,
            len >= CART ? 0 : 1,
            true,
          );
      }
    }
    data = w.buffer.slice(0, w.n * STROKE_STRIDE * 4);
    this.buffers.set(part, data);
    return data;
  }
  build(lists: readonly (readonly YardBoundary[] | undefined)[]): CityGlYards | undefined {
    const groups = lists.map((list, i) => (this.towns[i] ??= new RetainedYardRuns()).update(list ?? []));
    this.towns.length = lists.length;
    const runs = groups.flatMap(g => g.runs).sort((a, b) => MATERIALS.indexOf(a.source.material) - MATERIALS.indexOf(b.source.material));
    const gates = groups.flatMap(g => g.gates);
    if (!runs.length && !gates.length) return;
    return { runs: orderedStrokes(runs.map(r => this.buffer(r))), jambs: orderedStrokes(gates.map(g => this.buffer(g))), looks: this.looks };
  }
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
