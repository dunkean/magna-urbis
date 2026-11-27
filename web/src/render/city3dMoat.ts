import type { Enclosure, MoatCrossing, MoatRun, MoatSpec as MoatLine } from '../../../rust/bridge/urban';
import type { Point, Vertex3 } from '../../../rust/bridge/housesContract';
import { TERRAIN_MIN_SCARP, nextStation, pathDistance, quadCount, quadReaches, reachFill, reachStations, reachStrip, reachWater, runArc, runEndTaper, stationDepth, stationWidth, wettedSpan, type RunFrame } from './moatLine';
import { moatForm, moatScarp, moatSpec, moatState, moatWaterColour, type MoatForm, type MoatSpec, type MoatState } from './moatModel';

/** Moats (fortification ditches) in the 3D view, from the stations of their runs (moatLine.ts). The ground itself is dug: the
 * terrain lowers its heights inside every run in the form of the ditch (ui/urbanGroundCuts.ts). Here, built once with the other
 * wall meshes (no per-frame work):
 * - the water of each reach whose fill holds a sheet: one flat strip at one height, over the wetted width of the dug section;
 * - the revetment of a faced ditch (masonry, timber, dressed stone): a battered face from the lip to the bed, on both lips;
 * - the dams between two reaches and the sluice at a head by the water;
 * - a deck with parapets over the ditch at each bridge crossing (a causeway is undug ground, the street is drawn on it).
 * `g` is the placement height: the undug ground on which walls, bridges and quays stand; `frame` is a run on that ground
 * (moatLine.ts `runFrame`). */
const MOAT_WATER_DEFAULT = '#6f8f98';
type Shape = { outer: Point[]; holes: Point[][] };
type Face = (points: Vertex3[], material: string) => void;
type Prism = (shape: Shape, bottom: (p: Point) => number, top: (p: Point) => number, side: string, cap: string | undefined, under?: boolean) => void;

const lerpPoint = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const area2 = (r: readonly Point[]): number => r.reduce((s, p, i) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0);
/** A quad as two triangles facing up (counter-clockwise from above, like the engine's footprints); slivers are dropped. */
function up(face: Face, q: readonly Vertex3[], material: string): void {
  for (const t of [
    [q[0], q[1], q[2]],
    [q[0], q[2], q[3]],
  ]) {
    const a = area2(t);
    if (Math.abs(a) > 1e-6) face(a > 0 ? t : t.reverse(), material);
  }
}
/** A band along a -> b: `o0..o1` across (left positive), from `t0` before a to `t1` beyond b; counter-clockwise. */
const band = (a: Point, b: Point, o0: number, o1: number, t0 = 0, t1 = 0): Shape => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1,
    s = { x: (b.x - a.x) / l, y: (b.y - a.y) / l },
    at = (t: number, o: number): Point => ({ x: a.x + s.x * t - s.y * o, y: a.y + s.y * t + s.x * o }),
    r = [at(t0, o0), at(l + t1, o0), at(l + t1, o1), at(t0, o1)];
  return { outer: area2(r) < 0 ? r.reverse() : r, holes: [] };
};

/** Non-source inputs the walls read from the season and the moat review controls: the form, the spec (forced sluices or dams
 * supply a fresh one, so review geometry is always rebuilt), the town state and the resolved fill of each reach, which can
 * change between two dates with the same rounded season key. */
export function moatMeshInputs(enclosure: Enclosure): unknown[] {
  const form = moatForm(enclosure),
    spec = moatSpec(enclosure),
    town = moatState({ moat: spec }),
    inputs: unknown[] = [form, spec, town];
  for (const run of enclosure.moat?.runs ?? []) run.reaches.forEach((reach, ri) => inputs.push(reachFill(reach, ri, form, town)));
  return inputs;
}

/** The water of a run, in the state its form, the climate and the season give each reach (moatModel.ts): per reach whose fill
 * holds a sheet, one flat strip at one height (moatLine.ts `reachWater`), clipped to the wetted width of the dug section at
 * each station; a dry station closes the strip. `depth`: the nominal depth, for stations without engine heights.
 * `engraved`: a plan in ink keeps its wash. Returns the plan strips of the reaches that hold water. */
export function moatWater(run: MoatRun, frame: RunFrame, form: MoatForm, depth: number, face: Face, waterColor = MOAT_WATER_DEFAULT, town: MoatState = '', engraved = false): Shape[] {
  const owner = quadReaches(run),
    wet: Shape[] = [];
  run.reaches.forEach((reach, ri) => {
    const stations = reachStations(run, reach),
      fill = reachFill(reach, ri, form, town),
      mean = stations.reduce((s, k) => s + stationDepth(run, k, depth), 0) / Math.max(1, stations.length),
      z = reachWater(run, frame, reach, fill, mean);
    if (z === undefined) return;
    const material = `city3d:water@${moatWaterColour(fill, waterColor, engraved).replace('#', '')}`,
      spans = new Map<number, [number, number] | undefined>(),
      span = (k: number): [number, number] | undefined => {
        if (!spans.has(k)) spans.set(k, wettedSpan(form, frame, run, k, z, TERRAIN_MIN_SCARP));
        return spans.get(k);
      },
      at = (k: number, u: number): Vertex3 => ({ ...lerpPoint(run.inner[k], run.outer[k], u), z });
    let drawn = false;
    for (let k = 0; k < owner.length; k++) {
      if (owner[k] !== ri) continue;
      const k1 = nextStation(run, k),
        a = span(k),
        b = span(k1);
      if (!a || !b) continue;
      up(face, [at(k, a[0]), at(k1, b[0]), at(k1, b[1]), at(k, a[1])], material);
      drawn = true;
    }
    if (drawn) wet.push(reachStrip(run, reach));
  });
  return wet;
}

/** Coping of a revetment: its width on the bank (m) and its rise over the ground at the lip (m, flush). */
const COPING_WIDTH = 0.4,
  COPING_RISE = 0.04;
/** The facing goes this far under the bed (m), so its lower edge never shows against the terrain grid. */
const FACING_SINK = 0.6;

/** The revetment of a faced ditch: along both lips of the run, a battered face from the lip down under the bed, with a
 * coping flush with the bank. The terrain cut is sampled on a grid of metres, so its scarp is a ramp at least
 * TERRAIN_MIN_SCARP long; this face stands just in front of it, its foot where the ramp meets the bed, and gives the ditch
 * its wall. At an open end on a slope the facing shortens with the cut (moatLine.ts `runEndTaper`) and stops where the
 * ditch does. `crossings`: those of this run; a causeway fills the ditch, so its corridor is not faced. Earth forms have none. */
export function moatRevetment(run: MoatRun, frame: RunFrame, form: MoatForm, crossings: readonly MoatCrossing[], face: Face, material: string, coping: string): void {
  if (form.revetment === 'earth') return;
  const filled = crossings.filter(c => c.kind === 'causeway' && c.path.length >= 2),
    arc = runArc(run),
    taper = (j: number): number => runEndTaper(run, arc, arc[j], stationWidth(run, j));
  for (let k = 0; k < quadCount(run); k++) {
    const k1 = nextStation(run, k),
      f0 = taper(k),
      f1 = taper(k1);
    if (f0 < 0.01 && f1 < 0.01) continue;
    for (const outer of [false, true]) {
      const lip = (j: number): Point => (outer ? run.outer[j] : run.inner[j]),
        ground = (j: number): number => (outer ? frame.outer[j] : frame.inner[j]),
        a = lip(k),
        b = lip(k1);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.2 || filled.some(c => pathDistance(lerpPoint(a, b, 0.5), c.path) < c.half_width_m + 0.5)) continue;
      // `off` metres from the lip of station j towards the other lip (negative: onto the bank).
      const at = (j: number, off: number, z: number): Vertex3 => {
          const p = lip(j),
            o = outer ? run.inner[j] : run.outer[j],
            w = stationWidth(run, j) || 1;
          return { x: p.x + ((o.x - p.x) / w) * off, y: p.y + ((o.y - p.y) / w) * off, z };
        },
        foot = (j: number): number => {
          const w = stationWidth(run, j);
          return Math.min(0.45 * w, Math.max(TERRAIN_MIN_SCARP, moatScarp(form, ground(j) - frame.bed[j], w)));
        };
      const top = (j: number): number => ground(j) + COPING_RISE,
        // The full face reaches FACING_SINK under the bed; the taper of the cut shortens it towards a sloping end.
        bottom = (j: number, f: number): number => top(j) - f * (top(j) - (frame.bed[j] - FACING_SINK));
      up(face, [at(k, -COPING_WIDTH, top(k)), at(k1, -COPING_WIDTH, top(k1)), at(k1, 0, top(k1)), at(k, 0, top(k))], coping);
      up(face, [at(k, 0, top(k)), at(k1, 0, top(k1)), at(k1, foot(k1), bottom(k1, f1)), at(k, foot(k), bottom(k, f0))], material);
    }
  }
}

/** Dams and sluices of a circuit's ditch: a dam is a wall across the ditch, its crest half a metre under the lip, that holds
 * the upper reach; a sluice is two cheek walls and a lintel over the channel cut from the head of a wet ditch to the water. */
export function moatWorks(moat: MoatSpec | undefined, depth: number, g: (p: Point) => number, prism: Prism, side: string, top: string): number {
  let n = 0;
  for (const [a, b] of moat?.dams ?? []) {
    const crest = Math.min(g(a), g(b)) - 0.5;
    prism(
      band(a, b, -0.9, 0.9, -0.5, 0.5),
      p => Math.min(g(p), crest) - depth - 0.5,
      () => crest,
      side,
      top,
    );
    n++;
  }
  for (const [head, shore] of moat?.sluices ?? []) {
    const z = g(head);
    for (const [o0, o1] of [
      [-2.1, -1.4],
      [1.4, 2.1],
    ])
      prism(
        band(head, shore, o0, o1, -1.5, 0),
        () => z - 2,
        () => z + 0.3,
        side,
        top,
      );
    // The gate frame over the channel, at the head.
    prism(
      band(head, shore, -2.1, 2.1, -1.5, -Math.hypot(shore.x - head.x, shore.y - head.y) - 0.3),
      () => z + 0.3,
      () => z + 1,
      side,
      top,
      true,
    );
    n++;
  }
  return n;
}

/** Bridges over the moat at its `bridge` crossings: a level deck along the crossing path, at the undug ground of its ends
 * (+0.3 m), 0.7 m thick, with parapets on both sides. A causeway needs nothing: the ground is not dug there. */
export function moatDecks(moat: MoatLine | undefined, g: (p: Point) => number, prism: Prism, side: string, deck: string): number {
  let n = 0;
  for (const c of moat?.crossings ?? []) {
    if (c.kind !== 'bridge' || c.path.length < 2) continue;
    const path = c.path,
      hw = c.half_width_m,
      z = Math.max(g(path[0]), g(path[path.length - 1])) + 0.3;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i],
        b = path[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.1) continue;
      // Inner joints overlap by half a metre: no gap on the outside of a bend.
      const t0 = i ? -0.5 : 0,
        t1 = i + 2 < path.length ? 0.5 : 0;
      prism(
        band(a, b, -hw - 0.4, hw + 0.4, t0, t1),
        () => z - 0.7,
        () => z,
        side,
        deck,
        true,
      );
      for (const o of [-hw - 0.4, hw])
        prism(
          band(a, b, o, o + 0.4, t0, t1),
          () => z,
          () => z + 0.9,
          side,
          side,
        );
    }
    n++;
  }
  return n;
}
