import type { Street } from '../../../rust/bridge/urban';

/** The streets of a town levelled across their width in 3D (ui/urbanGroundShape.ts applies it before the lots):
 *
 * - the long profile of a street is the natural ground along its axis, sampled every `step` metres and smoothed over
 *   `smooth` metres, so it has no step at a vertex;
 * - across the street the ground is that profile, flat from edge to edge, and eases back to the natural ground over
 *   `margin` metres beyond the edge, where the lots take it as their reference;
 * - where streets meet, each one weighs by the distance to its edge: at a junction the ground passes from one profile to
 *   the other without a step.
 *
 * Stairs keep their steps (render/city3dStairs.ts), crossings and harbour platforms their decks: they are not levelled. Built
 * once per town content, in a grid of CELL metres; its cost is proportional to the length of the streets. */
export const STREET_LEVEL = Object.freeze({
  /** Spacing of the samples of the long profile and half window of its smoothing, m. */
  step: 2,
  smooth: 8,
  /** Width beyond the edge over which the levelled ground eases back to the natural one, m. */
  margin: 3,
  /** Width beyond the edge pulled to the street's height over whatever the lots and buildings did, m. */
  edge: 1,
  /** Most the ground moves under a street, m: a cross slope steeper than this over a half width keeps some tilt. */
  maxMove: 1.5,
});
/** Ways whose ground is not their own. */
const KEPT = new Set(['stairs', 'port-stairs', 'bridge', 'ford', 'causeway', 'quay', 'pier', 'mole', 'landing']);
const CELL = 16;
/** Edge distance (m) at which a street's weight halves, and the sharpness (1/m) of the blend between the pieces of one street. */
const EPS = 0.5,
  SHARP = 2;

interface Piece {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  length: number;
  /** Half widths at both ends, m. */
  ha: number;
  hb: number;
  /** Its street and the arc length of the street before it, m. */
  street: number;
  arc: number;
}
export interface StreetBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const smooth = (s: number): number => (s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s));
const cellKey = (x: number, y: number): number => (Math.floor(x / CELL) + 32768) * 65536 + Math.floor(y / CELL) + 32768;

export class StreetLevel {
  private readonly pieces: Piece[] = [];
  /** Long profile of each street: heights every `spacing[street]` metres of arc. */
  private readonly profiles: Float32Array[] = [];
  private readonly spacing: number[] = [];
  private readonly cells = new Map<number, number[]>();
  /** What each piece reaches, margin included. */
  readonly boxes: StreetBox[] = [];

  /** `natural`: the drawn ground before shaping, m. */
  constructor(private readonly natural: (x: number, y: number) => number | undefined) {}
  get empty(): boolean {
    return !this.pieces.length;
  }

  /** Adds a street; stairs, crossings, harbour platforms and the pieces at the water are left as they are. */
  add(street: Street): void {
    const path = street.path;
    if (KEPT.has(street.role) || path.length < 2) return;
    const arcs = [0];
    for (let k = 1; k < path.length; k++) arcs.push(arcs[k - 1] + Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y));
    const total = arcs[arcs.length - 1];
    if (!(total > 1e-3)) return;
    const count = Math.max(1, Math.ceil(total / STREET_LEVEL.step)),
      spacing = total / count,
      raw = new Float64Array(count + 1);
    for (let i = 0, k = 1; i <= count; i++) {
      const s = i * spacing;
      while (k < path.length - 1 && arcs[k] < s) k++;
      const a = path[k - 1],
        b = path[k],
        t = arcs[k] > arcs[k - 1] ? Math.min(1, Math.max(0, (s - arcs[k - 1]) / (arcs[k] - arcs[k - 1]))) : 0,
        h = this.natural(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y));
      if (h === undefined || !Number.isFinite(h)) return;
      raw[i] = h;
    }
    // Two passes of a box filter: a triangle of half width `smooth`, its window shortened at the ends.
    const half = Math.max(1, Math.round(STREET_LEVEL.smooth / 2 / spacing)),
      profile = boxFilter(boxFilter(raw, half), half);
    const index = this.profiles.push(Float32Array.from(profile)) - 1;
    this.spacing.push(spacing);
    const reach = STREET_LEVEL.margin;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1],
        b = path[k],
        length = arcs[k] - arcs[k - 1];
      // Sea and lake surfaces are flat at their level: nothing is shaped under water.
      if (length < 1e-6 || !((this.natural(a.x, a.y) ?? 0) > 0.05 && (this.natural(b.x, b.y) ?? 0) > 0.05)) continue;
      const piece: Piece = { ax: a.x, ay: a.y, bx: b.x, by: b.y, length, ha: 0.5 * (street.widths[k - 1] ?? 0), hb: 0.5 * (street.widths[k] ?? street.widths[k - 1] ?? 0), street: index, arc: arcs[k - 1] },
        out = Math.max(piece.ha, piece.hb) + reach,
        box: StreetBox = { x0: Math.min(a.x, b.x) - out, y0: Math.min(a.y, b.y) - out, x1: Math.max(a.x, b.x) + out, y1: Math.max(a.y, b.y) + out },
        id = this.pieces.push(piece) - 1;
      for (let y = box.y0; y < box.y1 + CELL; y += CELL)
        for (let x = box.x0; x < box.x1 + CELL; x += CELL) {
          const key = cellKey(Math.min(x, box.x1), Math.min(y, box.y1)),
            list = this.cells.get(key);
          if (!list) this.cells.set(key, [id]);
          else if (list[list.length - 1] !== id) list.push(id);
        }
      this.boxes.push(box);
    }
  }

  /** The levelled street at (x, y) into `out`: its height (m), how much of it the ground takes (1 on the street, easing to 0
   * over the margin) and how much it holds over the lots (1 on the street, 0 beyond `edge`). False where no street reaches. */
  at(x: number, y: number, out: Float64Array): boolean {
    const near = this.cells.get(cellKey(x, y));
    if (!near) return false;
    const { margin, edge } = STREET_LEVEL;
    let sum = 0,
      weights = 0,
      cover = 0,
      hold = 0;
    // The pieces of a street are consecutive in the list: each street is one term, its height blended over its pieces by
    // their distance, so that the inner side of a bend has no step.
    for (let k = 0; k < near.length;) {
      const street = this.pieces[near[k]].street;
      let end = k,
        nearest = Infinity,
        side = Infinity;
      // Only the pieces within their margin count: what a cell lists beyond it changes nothing, so cells join without a step.
      while (end < near.length && this.pieces[near[end]].street === street) {
        const p = this.pieces[near[end++]],
          t = along(p, x, y),
          d = Math.hypot(x - p.ax - t * (p.bx - p.ax), y - p.ay - t * (p.by - p.ay)),
          s = d - (p.ha + t * (p.hb - p.ha));
        if (s >= margin) continue;
        nearest = Math.min(nearest, d);
        side = Math.min(side, s);
      }
      if (side < margin) {
        let z = 0,
          w = 0;
        for (let i = k; i < end; i++) {
          const p = this.pieces[near[i]],
            t = along(p, x, y),
            d = Math.hypot(x - p.ax - t * (p.bx - p.ax), y - p.ay - t * (p.by - p.ay)),
            s = d - (p.ha + t * (p.hb - p.ha));
          if (s >= margin) continue;
          const e = (1 - smooth(s / margin)) * Math.exp(-SHARP * (d - nearest));
          z += e * this.profileAt(street, p.arc + t * p.length);
          w += e;
        }
        const c = 1 - smooth(side / margin),
          weight = c / (EPS + Math.max(0, side)) ** 2;
        sum += (weight * z) / w;
        weights += weight;
        cover = Math.max(cover, c);
        hold = Math.max(hold, 1 - smooth(side / edge));
      }
      k = end;
    }
    if (!(weights > 0)) return false;
    out[0] = sum / weights;
    out[1] = cover;
    out[2] = hold;
    return true;
  }

  private profileAt(street: number, s: number): number {
    const profile = this.profiles[street],
      g = Math.max(0, Math.min(profile.length - 1, s / this.spacing[street])),
      i = Math.min(profile.length - 2, Math.floor(g));
    return profile[i] + (g - i) * (profile[i + 1] - profile[i]);
  }
}

/** The move from `height` to the street's `level`, within STREET_LEVEL.maxMove. */
export const moved = (level: number, height: number): number => Math.max(-STREET_LEVEL.maxMove, Math.min(STREET_LEVEL.maxMove, level - height));

/** Mean over a window of `half` samples each side, shortened at the ends. */
function boxFilter(values: Float64Array, half: number): Float64Array {
  const n = values.length,
    prefix = new Float64Array(n + 1),
    out = new Float64Array(n);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half),
      b = Math.min(n - 1, i + half);
    out[i] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
  }
  return out;
}

/** Where along a piece (0..1) its nearest point to (x, y) lies. */
function along(p: Piece, x: number, y: number): number {
  return Math.max(0, Math.min(1, ((x - p.ax) * (p.bx - p.ax) + (y - p.ay) * (p.by - p.ay)) / (p.length * p.length)));
}
