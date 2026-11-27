import type { Point } from '../../../rust/bridge/housesContract';
import type { Enclosure, Shape, MoatCrossing, MoatRun, MoatSpec as MoatLine } from '../../../rust/bridge/urban';
import { MoatLineIndex, TERRAIN_MIN_SCARP, framedSection, nextStation, pathDistance, runArc, runEndTaper, runFrame, sectionDepth, stationDepth, stationWidth, type MoatLocation, type RunFrame } from '../render/moatLine';
import { shapeBox, shapeContains } from '../render/city/model/geometry';
import { moatBankRise, moatForm, moatSpec, type MoatForm } from '../render/moatModel';

/** Ground cuts of the 3D terrain: the moats of the town circuits, dug from the stations of their runs (render/moatLine.ts) in
 * the form of the circuit (render/moatModel.ts: V ditch, earth scarps, revetted flat bottom, double ditch). Built once per set
 * of circuits (`city3d.ts` hands it to the terrain with `setGroundCuts`); the terrain lowers its heights through `lower`, as it
 * raises or lowers building footings (urbanBuildingGround.ts). Walls, bridges and quays keep the undug ground.
 *
 * Inside a station quad the ground is lowered to the section of the form: a level bottom across, smooth along, each scarp
 * rising to its own lip. With the undug ground sampler `ground`, the bed is the engine's, carried onto that ground
 * (moatLine.ts `runFrame`); without it (flat ground, tests) the section is dug under the height at the point.
 * - The open end of a run on a slope tapers to nothing over 1.5 ditch widths (moatLine.ts `runEndTaper`, which the revetment
 *   follows); a water or work end is dug to full depth.
 * - A causeway crossing fills the ditch across its corridor (2 m ramps); a bridge crossing leaves it dug.
 * - Where the form has an outer bank (the spoil thrown up beyond the counterscarp), the ground rises outside the outer lip.
 * - A sluice is a narrow cut from the head of a wet ditch to the water.
 * Detached trenches use their polygon outlines, including holes. */
interface Circuit {
  moat?: MoatLine;
  ditch?: Enclosure['ditch'];
  outworks?: Enclosure['outworks'];
  bastions?: Enclosure['bastions'];
  style?: string;
}
interface Corridor {
  crossing: MoatCrossing;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface CutRun {
  run: MoatRun;
  form: MoatForm;
  /** Nominal depth (m), for stations without engine heights. */
  depth: number;
  arc: number[];
  causeways: Corridor[];
  frame?: RunFrame;
}
interface Sluice {
  head: Point;
  s: Point;
  length: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A sluice channel: half width, edge ramp and depth (m). */
const SLUICE = { half: 1.5, edge: 1, depth: 1.5 };
/** Ramp of a causeway beyond its half width (m). */
const CAUSEWAY_RAMP = 2;
/** Grid nodes handed out per chunk by `nodes`. */
const NODES_CHUNK = 4096;

const smooth = (x: number): number => {
  const s = Math.max(0, Math.min(1, x));
  return s * s * (3 - 2 * s);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class UrbanGroundCuts {
  private readonly index: MoatLineIndex;
  /** By circuit of the index, by run. */
  private readonly runs: CutRun[][] = [];
  private readonly forms: MoatForm[] = [];
  /** Width of the outer bank of each circuit (m), 0 without one. */
  private readonly banks: number[] = [];
  private readonly bank: number;
  private readonly sluices: Sluice[] = [];
  private readonly trenches: { shape: Shape; rings: Point[][]; box: ReturnType<typeof shapeBox>; form: MoatForm; width: number; depth: number }[] = [];
  /** Ravelins and bastions of moated circuits: where one stands in a run, the ground stays undug (an island in the ditch). */
  private readonly islands: { shape: Shape; box: ReturnType<typeof shapeBox> }[] = [];
  readonly empty: boolean;

  constructor(
    circuits: readonly Circuit[] = [],
    /** The undug ground (the placement height of walls and bridges), in the frame of the heights given to `lower`. */
    private readonly ground?: (p: Point) => number,
  ) {
    const lines: { runs: readonly MoatRun[]; bank: number }[] = [];
    for (const e of circuits) {
      const runs = e.moat?.runs ?? [];
      const form = moatForm(e);
      // The engine emits one polygon per reach, followed by the detached trenches.
      const derived = runs.reduce((n, r) => n + r.reaches.length, 0);
      for (const work of (e.ditch ?? []).slice(derived)) {
        const shape = work.shape;
        if (shape.outer.length < 3 || work.height_m <= 0) continue;
        const rings = [shape.outer, ...(shape.holes ?? [])].filter(r => r.length >= 3).map(r => [...r, r[0]]);
        // Twice the area divided by the perimeter gives the width of an annular strip.
        let twiceArea = 0,
          perimeter = 0;
        for (const [i, ring] of rings.entries()) {
          let area = 0;
          for (let j = 1; j < ring.length; j++) {
            const a = ring[j - 1],
              b = ring[j];
            area += a.x * b.y - b.x * a.y;
            perimeter += Math.hypot(b.x - a.x, b.y - a.y);
          }
          twiceArea += (i === 0 ? 1 : -1) * Math.abs(area);
        }
        this.trenches.push({ shape, rings, box: shapeBox(shape), form, width: Math.max(0.5, twiceArea / Math.max(1, perimeter)), depth: work.height_m });
      }
      if (!runs.length) continue;
      for (const { shape } of [...(e.outworks ?? []).filter(w => w.kind === 'ravelin'), ...(e.bastions ?? [])]) if (shape.outer.length >= 3) this.islands.push({ shape, box: shapeBox(shape) });
      const depth = e.moat?.depth_m || form.depthM,
        bank = form.bankM?.[0] ?? 0,
        causeways = (e.moat?.crossings ?? [])
          .filter(c => c.kind === 'causeway' && c.path.length >= 2)
          .map(crossing => {
            const pad = crossing.half_width_m + CAUSEWAY_RAMP,
              xs = crossing.path.map(p => p.x),
              ys = crossing.path.map(p => p.y);
            return { crossing, x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
          });
      this.runs.push(runs.map((run, ri) => ({ run, form, depth, arc: runArc(run), causeways: causeways.filter(c => c.crossing.run === ri) })));
      this.forms.push(form);
      this.banks.push(bank);
      lines.push({ runs, bank });
      for (const [head, shore] of moatSpec(e)?.sluices ?? []) {
        const length = Math.hypot(shore.x - head.x, shore.y - head.y);
        if (length < 0.5) continue;
        const pad = SLUICE.half + SLUICE.edge + 3;
        this.sluices.push({ head, s: { x: (shore.x - head.x) / length, y: (shore.y - head.y) / length }, length, x0: Math.min(head.x, shore.x) - pad, y0: Math.min(head.y, shore.y) - pad, x1: Math.max(head.x, shore.x) + pad, y1: Math.max(head.y, shore.y) + pad });
      }
    }
    this.index = new MoatLineIndex(lines);
    this.bank = Math.max(0, ...this.banks);
    this.empty = this.index.empty && !this.sluices.length && !this.trenches.length;
  }

  /** The nodes (i, j) of a grid of `step` metres that `lower` may move, in chunks, each node once. */
  *nodes(step: number): Generator<[number, number][]> {
    const seen = new Set<number>();
    let out: [number, number][] = [];
    const add = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let j = Math.ceil(y0 / step); j * step <= y1; j++)
        for (let i = Math.ceil(x0 / step); i * step <= x1; i++) {
          const key = (i + 2 ** 20) * 2 ** 21 + (j + 2 ** 20);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push([i, j]);
        }
    };
    for (const q of this.index.quads) {
      const pad = this.banks[q.circuit] + step;
      add(q.x0 - pad, q.y0 - pad, q.x1 + pad, q.y1 + pad);
      if (out.length >= NODES_CHUNK) {
        yield out;
        out = [];
      }
    }
    for (const { box } of this.trenches) {
      add(box.minX, box.minY, box.maxX, box.maxY);
      if (out.length >= NODES_CHUNK) {
        yield out;
        out = [];
      }
    }
    for (const s of this.sluices) add(s.x0, s.y0, s.x1, s.y1);
    if (out.length) yield out;
  }

  /** Height of the dug ground at (x, y), given the undug `height`. */
  lower(x: number, y: number, height: number): number {
    if (this.empty) return height;
    const at = this.index.locate(x, y),
      sluice = this.sluiceCut(x, y),
      z = Math.min(at && !this.island(x, y) ? this.dug(at, x, y, height) : height, height - sluice, height - this.trenchDepth(x, y));
    // A bank never stands in a ditch or a crossing.
    return z < height ? z : height + this.bankRise(x, y);
  }

  /** The bed and lips of a run on the undug ground, once it can be read. */
  private frame(cut: CutRun): RunFrame | undefined {
    if (!this.ground) return undefined;
    return (cut.frame ??= runFrame(cut.run, this.ground, cut.depth));
  }
  private dug(at: MoatLocation, x: number, y: number, height: number): number {
    const cut = this.runs[at.circuit][at.run],
      { run, form } = cut,
      k1 = nextStation(run, at.k),
      width = lerp(stationWidth(run, at.k), stationWidth(run, k1), at.t),
      frame = this.frame(cut),
      section = frame ? framedSection(form, frame, at.k, k1, at.t, at.u, width, TERRAIN_MIN_SCARP) : height - sectionDepth(form, lerp(stationDepth(run, at.k, cut.depth), stationDepth(run, k1, cut.depth), at.t), width, at.u, TERRAIN_MIN_SCARP),
      z = Math.min(height, section);
    return height - (height - z) * this.endTaper(cut, at, width) * this.causeway(cut, x, y);
  }
  /** 1 along the run, falling to 0 at an open end on a slope (moatLine.ts `runEndTaper`, shared with the revetment). */
  private endTaper({ run, arc }: CutRun, at: MoatLocation, width: number): number {
    return run.closed ? 1 : runEndTaper(run, arc, lerp(arc[at.k], arc[at.k + 1], at.t), width);
  }
  /** 0 inside the corridor of a causeway of the run, 1 beyond its ramps. */
  private causeway({ causeways }: CutRun, x: number, y: number): number {
    let dig = 1;
    for (const c of causeways) if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1) dig = Math.min(dig, smooth((pathDistance({ x, y }, c.crossing.path) - c.crossing.half_width_m) / CAUSEWAY_RAMP));
    return dig;
  }
  private island(x: number, y: number): boolean {
    return this.islands.some(({ shape, box }) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && shapeContains(shape, { x, y }));
  }
  private trenchDepth(x: number, y: number): number {
    let cut = 0;
    for (const { shape, rings, box, form, width, depth } of this.trenches) {
      if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY || !shapeContains(shape, { x, y })) continue;
      const distance = Math.min(...rings.map(r => pathDistance({ x, y }, r)));
      cut = Math.max(cut, sectionDepth(form, depth, width, Math.min(0.5, distance / width), TERRAIN_MIN_SCARP));
    }
    return cut;
  }
  private sluiceCut(x: number, y: number): number {
    let cut = 0;
    for (const s of this.sluices) {
      if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) continue;
      const dx = x - s.head.x,
        dy = y - s.head.y,
        t = dx * s.s.x + dy * s.s.y,
        o = Math.abs(dy * s.s.x - dx * s.s.y),
        first = -3,
        last = s.length + 2;
      if (t < first || t > last || o > SLUICE.half + SLUICE.edge) continue;
      cut = Math.max(cut, SLUICE.depth * smooth(Math.min(t - first, last - t) / SLUICE.edge) * smooth((SLUICE.half + SLUICE.edge - o) / SLUICE.edge));
    }
    return cut;
  }
  private bankRise(x: number, y: number): number {
    if (!this.bank) return 0;
    const hit = this.index.nearOuterLip(x, y, this.bank);
    if (!hit || hit.d >= this.banks[hit.circuit]) return 0;
    return moatBankRise(this.forms[hit.circuit], hit.d) * this.causeway(this.runs[hit.circuit][hit.run], x, y);
  }
}
