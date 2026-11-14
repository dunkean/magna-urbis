/** White water of steep rivers over the satellite ground: riffles, rapids, cascades and waterfalls as vector marks.
 *
 * The marks are built once per river network from the course lines the satellite ground draws (water surface level
 * per vertex, drawn width), binned in space, and painted by the vector map (canvas.ts) above the ground and under the
 * bridges. The GPU vector engine records them with the rest of the map and replays the list: nothing is computed per
 * frame. Every mark comes from a hash of the river id and its arc position: no regular spacing anywhere.
 *
 * Marks are short strokes with round caps (foam streaks along the flow), filled irregular blobs (rocks) and wide very
 * faint strokes (mist). Soft edges are stacked strokes of decreasing width (halo, core, inner core): the recorder of
 * the GPU engine has no gradients or blur. */
import { mapGroundSnow, roofSeasonKey } from './seasonPalette';

// ---------------------------------------------------------------- tunables
/** Master switch: false paints nothing and leaves the retained keys unchanged (the map draws as without this module).
 * Off: the marks have no 3D counterpart and read as strokes, not foam; the code stays for a later shader version. */
export const WHITE_WATER_ENABLED: boolean = false;
/** Resampling step of a course, m. */
export const SAMPLE_STEP = 2;
/** Window of the smoothed slope, m of channel. */
export const SLOPE_WINDOW = 60;
/** Calm water before a mouth in the sea or a lake, m (and the length of the fade in before it). */
export const MOUTH_CALM = 250, MOUTH_FADE = 100;
/** A level step smaller than this between two vertices is a flat reach (filled depression, lake), m. */
export const LEVEL_EPS = 1e-3;
/** Slopes (fraction): riffles start, rapids are full at the cascade threshold, cascades are full at the last one. */
export const RIFFLE_SLOPE = .015, CASCADE_SLOPE = .08, CASCADE_FULL_SLOPE = .25;
/** Waterfall: at least FALL_DROP m of level lost within FALL_RUN m of channel; the lip and the foot are where the local
 * gradient passes FALL_EDGE_SLOPE. */
export const FALL_DROP = 5, FALL_RUN = 25, FALL_EDGE_SLOPE = .12;

/** Patches: noise wavelength in channel widths, and the share of the channel inside patches at each slope class. */
export const PATCH_WAVE = 3.5, PATCH_COVER_RIFFLE = .22, PATCH_COVER_RAPID = .5, PATCH_COVER_CASCADE = .88, PATCH_SOFT = .1;
/** Streaks per m² of patch, at the riffle, rapid and full cascade slopes. */
export const STREAK_DENSITY_RIFFLE = .03, STREAK_DENSITY_RAPID = .07, STREAK_DENSITY_CASCADE = .22;
/** Channel width beyond which the streak rate per metre of channel stops growing, m. */
export const DENSITY_WIDTH_CAP = 18;
/** Streak size (m) and opacity; cascades stretch the streaks along the flow. */
export const STREAK_LENGTH_MIN = 2, STREAK_LENGTH_MAX = 9, STREAK_WIDTH_MIN = .25, STREAK_WIDTH_MAX = .9;
export const STREAK_ALPHA_MIN = .3, STREAK_ALPHA_MAX = .7, STREAK_CASCADE_STRETCH = .6;
/** Lateral spread of streaks (share of the half width) and their pull to the outside of bends (per radian of turn). */
export const STREAK_SPREAD = .8, BEND_BIAS = .45;
/** Cascades: share of streaks that join one of a few wandering threads (braided white bands). */
export const BRAID_SHARE = .65, BRAID_THREADS = 3;
/** Flecks: tiny foam bits around a streak, visible only close up (their width passes the pixel limit late). */
export const FLECK_CHANCE = .6, FLECK_WIDTH_MIN = .06, FLECK_WIDTH_MAX = .18, FLECK_LENGTH_MIN = .15, FLECK_LENGTH_MAX = .7;

/** Emergent rocks in cascades, per 100 m of full cascade; size (m). */
export const ROCK_PER_100M = 3, ROCK_SIZE_MIN = .8, ROCK_SIZE_MAX = 2.5;
/** Boulders at the water's edge of steep reaches, per 100 m, from this slope on. */
export const BANK_ROCK_PER_100M = 1.2, BANK_ROCK_SLOPE = .05;
/** Waterfall: drop streaks per metre of width, pool marks per m² of pool, pool length in widths, mist marks. */
export const FALL_DROP_STREAKS = 1.4, POOL_DENSITY = .3, POOL_LENGTH_MIN = 1, POOL_LENGTH_MAX = 2, MIST_MIN = 3, MIST_MAX = 5;
export const MIST_ALPHA = .05, MIST_SIZE = 1.8;

/** Zoom: marks fade in while the channel grows from ZOOM_START_PX to ZOOM_FULL_PX on screen; thinner strokes than
 * MIN_STROKE_PX and smaller rocks than MIN_ROCK_PX are not drawn. */
export const ZOOM_START_PX = 5, ZOOM_FULL_PX = 12, MIN_STROKE_PX = .6, MIN_ROCK_PX = 1.2;
/** Soft edges: halo and inner core of every foam stroke (width and opacity factors); the inner core from this width. */
export const HALO_WIDTH = 2.3, HALO_ALPHA = .3, INNER_WIDTH = .45, INNER_ALPHA = .5, INNER_FROM_PX = 3;
/** Most marks painted in one view; past it the least important go first (flecks, then streaks). */
export const MAX_MARKS_PER_VIEW = 3500;
/** River ice from the ground snow at the course's level: no foam over a frozen river; a fall stays as a quiet ice fall. */
export const ICE_SNOW_START = .35, ICE_SNOW_FULL = .65, ICE_FALL_ALPHA = .35;
/** Colours: foam, rock, lit rock top, mist, ice. */
export const FOAM_COLOR = '#f3f6f4', ROCK_COLOR = '#4e473e', ROCK_TOP_COLOR = '#6d665b', MIST_COLOR = '#eef2f1', ICE_COLOR = '#c6ced2';
export const ROCK_ALPHA = .9, ROCK_TOP_ALPHA = .75;
/** Spatial bin of the marks, m. */
export const BIN = 128;

// ---------------------------------------------------------------- input
/** One river course as the ground draws it: interleaved x, y (m) upstream to mouth, water level (m) and drawn width (m)
 * per vertex; `wet` (0 dry bed … 1 running, default 1) from the seasonal regime; `mouth` when it ends in the sea or a
 * lake (calm water there). */
export interface WhiteWaterCourse { id: number; points: ArrayLike<number>; level: ArrayLike<number>; width: ArrayLike<number>; wet?: ArrayLike<number>; mouth: boolean }

/** Mark kinds: foam disappears under river ice, a fall turns to an ice fall, rocks and mist go too. */
export const FOAM = 0, FALL = 1, ROCK = 2, MIST = 3;
const COLORS = [FOAM_COLOR, ROCK_COLOR, ROCK_TOP_COLOR, MIST_COLOR, ICE_COLOR];
const C_FOAM = 0, C_ROCK = 1, C_TOP = 2, C_MIST = 3, C_ICE = 4;

export interface WhiteWaterMarks {
  count: number;
  kind: Uint8Array; color: Uint8Array;
  /** Stroke width (m); 0 for a filled blob. */
  width: Float32Array;
  /** Size that decides visibility: stroke width, or blob diameter (m). */
  size: Float32Array;
  alpha: Float32Array; channel: Float32Array; altitude: Float32Array;
  /** 0 always kept … 1 first dropped when a view holds too many marks. */
  rank: Float32Array;
  start: Uint32Array; points: Uint16Array; xy: Float32Array;
  /** Bins (CSR) over the marks' centres; `reach` bounds a mark's extent from its centre. */
  bins: { x0: number; y0: number; cols: number; rows: number; start: Uint32Array; items: Uint32Array }; reach: number;
  falls: number;
}

// ---------------------------------------------------------------- hashing
function hashInt(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) ^ 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
/** Generator seeded by a river id, an arc position (m) and a salt. */
function rng(id: number, s: number, salt: number): () => number {
  let a = hashInt(id, Math.round(s * 64), salt);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const unit = (id: number, k: number, salt: number): number => hashInt(id, k, salt) / 4294967296;
/** 1D value noise in [0, 1], two octaves at an irrational ratio (no visible period), stretched back to a roughly
 * uniform spread so that a threshold at 1 - c covers about a share c of the channel. */
function noise1(id: number, x: number, salt: number): number {
  const one = (v: number, s: number): number => { const i = Math.floor(v), f = v - i, t = f * f * (3 - 2 * f); return unit(id, i, s) + (unit(id, i + 1, s) - unit(id, i, s)) * t; };
  return clamp((.65 * one(x, salt) + .35 * one(x * 2.37 + 17.3, salt + 101) - .5) * 2.1 + .5, 0, 1);
}
const smooth = (a: number, b: number, v: number): number => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v: number, a: number, b: number): number => v < a ? a : v > b ? b : v;

// ---------------------------------------------------------------- builder
class MarkList {
  kind: number[] = []; color: number[] = []; width: number[] = []; size: number[] = []; alpha: number[] = [];
  channel: number[] = []; altitude: number[] = []; rank: number[] = []; start: number[] = []; points: number[] = []; xy: number[] = [];
  add(kind: number, color: number, width: number, size: number, alpha: number, channel: number, altitude: number, rank: number, pts: number[]): void {
    if (pts.length < 4 || alpha <= 0) return;
    this.kind.push(kind); this.color.push(color); this.width.push(width); this.size.push(size); this.alpha.push(alpha);
    this.channel.push(channel); this.altitude.push(altitude); this.rank.push(rank);
    this.start.push(this.xy.length / 2); this.points.push(pts.length / 2);
    for (const v of pts) this.xy.push(v);
  }
}

/** A course resampled every SAMPLE_STEP m: position, level, width, flat flag, smoothed slope. */
interface Samples { n: number; total: number; x: Float64Array; y: Float64Array; level: Float64Array; width: Float64Array; wet: Float64Array; slope: Float64Array; tau: Float64Array }
function sampleCourse(c: WhiteWaterCourse): Samples | undefined {
  const n = Math.min(c.width.length, c.level.length, c.points.length >> 1);
  if (n < 2) return;
  const arc = new Float64Array(n);
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(c.points[2 * i] - c.points[2 * i - 2], c.points[2 * i + 1] - c.points[2 * i - 1]);
  const total = arc[n - 1];
  if (!(total > 4 * SAMPLE_STEP)) return;
  const S = Math.floor(total / SAMPLE_STEP) + 1;
  const x = new Float64Array(S), y = new Float64Array(S), level = new Float64Array(S), width = new Float64Array(S), flat = new Uint8Array(S), wet = new Float64Array(S).fill(1);
  for (let j = 0, k = 0; j < S; j++) {
    const s = j * SAMPLE_STEP;
    while (k < n - 2 && arc[k + 1] < s) k++;
    const span = arc[k + 1] - arc[k], t = span > 1e-9 ? clamp((s - arc[k]) / span, 0, 1) : 0;
    x[j] = c.points[2 * k] + (c.points[2 * k + 2] - c.points[2 * k]) * t;
    y[j] = c.points[2 * k + 1] + (c.points[2 * k + 3] - c.points[2 * k + 1]) * t;
    level[j] = c.level[k] + (c.level[k + 1] - c.level[k]) * t;
    width[j] = Math.max(0, c.width[k] + (c.width[k + 1] - c.width[k]) * t);
    flat[j] = c.level[k] - c.level[k + 1] > LEVEL_EPS ? 0 : 1;
    if (c.wet) wet[j] = smooth(.3, .7, c.wet[k] + (c.wet[k + 1] - c.wet[k]) * t);
  }
  // Smoothed slope over SLOPE_WINDOW; none on flat reaches, none near a mouth (fading in before the calm stretch).
  const half = Math.max(1, Math.round(SLOPE_WINDOW / 2 / SAMPLE_STEP)), slope = new Float64Array(S);
  for (let j = 0; j < S; j++) {
    if (flat[j]) continue;
    const a = Math.max(0, j - half), b = Math.min(S - 1, j + half);
    if (b > a) slope[j] = Math.max(0, (level[a] - level[b]) / ((b - a) * SAMPLE_STEP)) * wet[j];
    if (c.mouth) slope[j] *= smooth(MOUTH_CALM, MOUTH_CALM + MOUTH_FADE, total - j * SAMPLE_STEP);
  }
  // Arc in channel widths: patches scale with the river.
  const tau = new Float64Array(S);
  for (let j = 1; j < S; j++) tau[j] = tau[j - 1] + SAMPLE_STEP / Math.max(3, width[j]);
  return { n: S, total: (S - 1) * SAMPLE_STEP, x, y, level, width, wet, slope, tau };
}

/** Position, unit tangent and left normal at arc s. */
interface Frame { x: number; y: number; tx: number; ty: number; nx: number; ny: number; w: number; level: number; j: number }
function frameAt(c: Samples, s: number): Frame {
  const f = clamp(s / SAMPLE_STEP, 0, c.n - 1), i = Math.min(c.n - 2, Math.floor(f)), t = f - i;
  const a = Math.max(0, i - 3), b = Math.min(c.n - 1, i + 4);
  let tx = c.x[b] - c.x[a], ty = c.y[b] - c.y[a]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
  return { x: c.x[i] + (c.x[i + 1] - c.x[i]) * t, y: c.y[i] + (c.y[i + 1] - c.y[i]) * t, tx, ty, nx: -ty, ny: tx,
    w: c.width[i] + (c.width[i + 1] - c.width[i]) * t, level: c.level[i] + (c.level[i + 1] - c.level[i]) * t, j: Math.round(f) };
}
/** Signed turn of the course (radians) over about three channel widths around arc s; positive towards the normal. */
function turnAt(c: Samples, s: number, w: number): number {
  const d = Math.max(6, 1.5 * w), a = frameAt(c, s - d), b = frameAt(c, s + d);
  return Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty);
}
/** A polyline at lateral offset `u` (share of the half width, plus `jitter` m per inner point) over [s0, s1]. */
function along(c: Samples, s0: number, s1: number, u: number, n: number, jitter: number, R: () => number): number[] {
  const out: number[] = [];
  for (let q = 0; q < n; q++) {
    const s = s0 + (s1 - s0) * q / (n - 1), f = frameAt(c, s), off = u * f.w / 2 + (q && q < n - 1 ? (R() - .5) * 2 * jitter : 0);
    out.push(f.x + f.nx * off, f.y + f.ny * off);
  }
  return out;
}

interface Fall { lip: number; foot: number }
function findFalls(c: Samples, mouth: boolean): Fall[] {
  const run = Math.max(1, Math.round(FALL_RUN / SAMPLE_STEP)), out: Fall[] = [];
  for (let j = 0; j + run < c.n;) {
    if (c.level[j] - c.level[j + run] < FALL_DROP) { j++; continue; }
    let e = j;
    while (e + 1 + run < c.n && c.level[e + 1] - c.level[e + 1 + run] >= FALL_DROP) e++;
    let lip = -1, foot = -1;
    for (let q = j; q < e + run; q++) if ((c.level[q] - c.level[q + 1]) / SAMPLE_STEP >= FALL_EDGE_SLOPE) { if (lip < 0) lip = q; foot = q + 1; }
    if (lip < 0) { lip = j; foot = e + run; }
    const fall = { lip: lip * SAMPLE_STEP, foot: Math.max(foot * SAMPLE_STEP, lip * SAMPLE_STEP + 1) };
    const w = c.width[lip], last = out[out.length - 1];
    if (!(mouth && fall.foot > c.total - MOUTH_CALM) && c.wet[lip] > .5) {
      if (last && fall.lip - last.foot < 2 * Math.max(3, w)) last.foot = fall.foot; else out.push(fall);
    }
    j = e + run + 1;
  }
  return out;
}

/** An irregular rock with its lit top; `cushion` adds the white cushion upstream and the V wake downstream, `bank`
 * (±1, the side of the bank) a strip of foam on the water side instead. */
function addRock(m: MarkList, c: Samples, f: Frame, cx: number, cy: number, d: number, R: () => number, cushion: boolean, bank: number): void {
  const k = 7, base: number[] = [], top: number[] = [], phase = R() * Math.PI * 2;
  const sx = -.18 * d, sy = -.18 * d; // light from the north-west
  for (let q = 0; q < k; q++) {
    const a = phase + (q + (R() - .5) * .5) * Math.PI * 2 / k, r = d / 2 * (.72 + .4 * R());
    const along_ = Math.cos(a) * r * 1.15, across = Math.sin(a) * r;
    const px = along_ * f.tx + across * f.nx, py = along_ * f.ty + across * f.ny;
    base.push(cx + px, cy + py); top.push(cx + sx + px * .55, cy + sy + py * .55);
  }
  m.add(ROCK, C_ROCK, 0, d, ROCK_ALPHA, f.w, f.level, 0, base);
  m.add(ROCK, C_TOP, 0, d * .55, ROCK_TOP_ALPHA, f.w, f.level, .2, top);
  if (cushion) {
    const pts: number[] = [], r = d / 2 * 1.05 + .1;
    for (let q = 0; q < 4; q++) {
      const a = (-70 + 140 * q / 3 + (R() - .5) * 18) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      // Upstream direction rotated by a.
      const dx = -f.tx * ca + f.nx * sa, dy = -f.ty * ca + f.ny * sa;
      pts.push(cx + dx * r, cy + dy * r);
    }
    m.add(FOAM, C_FOAM, clamp(.3 * d, .2, .7), clamp(.3 * d, .2, .7), .75, f.w, f.level, .1, pts);
    const wakes = 2 + (R() < .5 ? 1 : 0);
    for (let q = 0; q < wakes; q++) {
      const side = q === 0 ? -1 : q === 1 ? 1 : R() < .5 ? -1 : 1, ang = side * (12 + 18 * R()) * Math.PI / 180;
      const dx = f.tx * Math.cos(ang) + f.nx * Math.sin(ang), dy = f.ty * Math.cos(ang) + f.ny * Math.sin(ang);
      const x0 = cx + f.tx * d * .4 + f.nx * side * d * .3, y0 = cy + f.ty * d * .4 + f.ny * side * d * .3;
      const len = d * (1.5 + 2.5 * R()) * (1 - .25 * q), fade = 1 - .3 * q, w = clamp(.2 * d, .2, .45) * (1 - .15 * q);
      const bend = (R() - .5) * .25 * len;
      const mx = x0 + dx * len * .5 + f.nx * bend * .3, my = y0 + dy * len * .5 + f.ny * bend * .3;
      m.add(FOAM, C_FOAM, w, w, .55 * fade, f.w, f.level, .15, [x0, y0, mx, my]);
      m.add(FOAM, C_FOAM, w * .8, w * .8, .25 * fade, f.w, f.level, .25, [mx, my, x0 + dx * len + f.nx * bend, y0 + dy * len + f.ny * bend]);
    }
  } else if (bank) {
    const ox = -bank * f.nx * d * .5, oy = -bank * f.ny * d * .5, w = .2 + .15 * R();
    m.add(FOAM, C_FOAM, w, w, .5, f.w, f.level, .2, [cx + ox - f.tx * d * .6, cy + oy - f.ty * d * .6, cx + ox * 1.15 + f.tx * d * .3, cy + oy * 1.15 + f.ty * d * .3, cx + ox * 1.05 + f.tx * d * 1.3, cy + oy * 1.05 + f.ty * d * 1.3]);
  }
}

function addFall(m: MarkList, c: Samples, id: number, fall: Fall): void {
  const R = rng(id, fall.lip, 7), f = frameAt(c, fall.lip), wl = Math.max(1, f.w), drop = Math.max(fall.foot - fall.lip, .25 * wl);
  // Lip: two broken, irregular bands across the channel.
  for (let band = 0; band < 2; band++) {
    const pieces = 2 + Math.floor(R() * 2), s = fall.lip + band * (.1 * wl + R() * .08 * wl);
    let u = -.95;
    for (let p = 0; p < pieces && u < .9; p++) {
      const span = (1.9 / pieces) * (.75 + .5 * R()), u1 = Math.min(.95, u + span), pts: number[] = [];
      for (let q = 0; q < 4; q++) {
        const uq = u + (u1 - u) * q / 3, g = frameAt(c, s + (R() - .5) * .16 * wl), off = uq * g.w / 2;
        pts.push(g.x + g.nx * off, g.y + g.ny * off);
      }
      const w = clamp(.14 * wl * (.7 + .6 * R()), .4, 3.5) * (band ? .6 : 1);
      m.add(FALL, C_FOAM, w, w, band ? .5 : .82 + .1 * R(), wl, f.level, 0, pts);
      u = u1 + .04 + .08 * R();
    }
  }
  // Over the drop: streaks stretched along the flow.
  const nd = Math.round(FALL_DROP_STREAKS * wl) + 3;
  for (let q = 0; q < nd; q++) {
    const u = (R() * 2 - 1) * .92, s0 = fall.lip + R() * .25 * drop, len = (.45 + .55 * R()) * (fall.lip + drop - s0) + .3;
    const w = clamp(wl * .05 * (.6 + .8 * R()), .25, 1.4);
    m.add(FALL, C_FOAM, w, w, .55 + .3 * R(), wl, f.level, .05, along(c, s0, s0 + len, u, 3, Math.min(.2, .05 * len), R));
  }
  // Boiling pool: dense short marks fading over one to two widths.
  const g = frameAt(c, fall.lip + drop), foot = fall.lip + drop;
  const pool = (POOL_LENGTH_MIN + (POOL_LENGTH_MAX - POOL_LENGTH_MIN) * R()) * Math.max(3, g.w), np = Math.min(500, Math.round(POOL_DENSITY * Math.max(3, g.w) * pool));
  for (let q = 0; q < np; q++) {
    const a = foot + pool * R() ** 1.4, t = (a - foot) / pool, h = frameAt(c, a), u = (R() * 2 - 1) * .95;
    const cx = h.x + h.nx * u * h.w / 2, cy = h.y + h.ny * u * h.w / 2, ang = (R() - .5) * 2.2;
    const dx = h.tx * Math.cos(ang) + h.nx * Math.sin(ang), dy = h.ty * Math.cos(ang) + h.ny * Math.sin(ang);
    const len = (.6 + 2.2 * R()) * (1 - .5 * t), w = .2 + .5 * R();
    m.add(FOAM, C_FOAM, w, w, (.65 - .5 * t) * (.6 + .4 * R()), h.w, h.level, .1 + .4 * t, [cx - dx * len / 2, cy - dy * len / 2, cx + dx * len / 2, cy + dy * len / 2]);
  }
  // Mist: a few large translucent marks around the foot.
  const nm = MIST_MIN + Math.floor(R() * (MIST_MAX - MIST_MIN + 1));
  for (let q = 0; q < nm; q++) {
    const h = frameAt(c, foot + (R() - .2) * .6 * g.w), off = (R() - .5) * g.w, size = (.6 + .8 * R()) * MIST_SIZE * Math.max(3, g.w);
    const cx = h.x + h.nx * off, cy = h.y + h.ny * off, ang = R() * Math.PI, l = .25 * size;
    m.add(MIST, C_MIST, size, size, MIST_ALPHA * (.7 + .6 * R()), h.w, h.level, 0, [cx - Math.cos(ang) * l / 2, cy - Math.sin(ang) * l / 2, cx + Math.cos(ang) * l / 2, cy + Math.sin(ang) * l / 2]);
  }
  // A rock or two at the foot, with their cushions.
  const rocks = R() < .6 ? 1 : 2;
  for (let q = 0; q < rocks; q++) {
    const h = frameAt(c, foot + (.2 + .5 * R()) * g.w), side = R() < .5 ? -1 : 1, u = side * (.5 + .3 * R());
    const d = clamp(.12 * h.w * (.7 + .6 * R()), ROCK_SIZE_MIN, ROCK_SIZE_MAX);
    addRock(m, c, h, h.x + h.nx * u * h.w / 2, h.y + h.ny * u * h.w / 2, d, R, true, 0);
  }
}

function addCourse(m: MarkList, course: WhiteWaterCourse): number {
  const c = sampleCourse(course);
  if (!c) return 0;
  const id = course.id | 0, falls = findFalls(c, course.mouth);
  // Stretches given to the falls (lip to the end of the pool): no regular streaks there.
  const quiet = falls.map(f => { const w = Math.max(3, frameAt(c, f.foot).w); return [f.lip - .4 * w, f.foot + POOL_LENGTH_MAX * w] as const; });
  const busy = (s: number): boolean => quiet.some(([a, b]) => s >= a && s <= b);
  for (const fall of falls) addFall(m, c, id, fall);
  // Streaks: a Poisson walk at the slope's rate, thinned by the patch noise.
  let s = unit(id, 0, 3) * 4, k = 0;
  while (s < c.total) {
    const j = Math.min(c.n - 1, Math.round(s / SAMPLE_STEP)), sl = c.slope[j], w = Math.max(.5, c.width[j]);
    if (sl < RIFFLE_SLOPE * .75 || busy(s)) { s += 2 * SAMPLE_STEP; continue; }
    const rapid = smooth(RIFFLE_SLOPE, CASCADE_SLOPE, sl), casc = smooth(CASCADE_SLOPE, CASCADE_FULL_SLOPE, sl);
    const rho = STREAK_DENSITY_RIFFLE + (STREAK_DENSITY_RAPID - STREAK_DENSITY_RIFFLE) * rapid + (STREAK_DENSITY_CASCADE - STREAK_DENSITY_RAPID) * casc;
    s += -Math.log(1 - unit(id, k++, 5)) / (rho * Math.min(w, DENSITY_WIDTH_CAP));
    if (s >= c.total) break;
    const f = frameAt(c, s), sl2 = c.slope[f.j];
    if (sl2 < RIFFLE_SLOPE * .75 || busy(s)) continue;
    const r2 = smooth(RIFFLE_SLOPE, CASCADE_SLOPE, sl2), c2 = smooth(CASCADE_SLOPE, CASCADE_FULL_SLOPE, sl2);
    const cover = PATCH_COVER_RIFFLE + (PATCH_COVER_RAPID - PATCH_COVER_RIFFLE) * r2 + (PATCH_COVER_CASCADE - PATCH_COVER_RAPID) * c2;
    const R = rng(id, s, 1);
    // Riffles start softly: below the riffle slope the patches thin out.
    const inPatch = smooth(1 - cover - PATCH_SOFT, 1 - cover + PATCH_SOFT, noise1(id, c.tau[f.j] / PATCH_WAVE, 11)) * smooth(RIFFLE_SLOPE * .75, RIFFLE_SLOPE * 1.3, sl2);
    if (R() >= inPatch) continue;
    const fw = Math.max(.5, f.w), len = (STREAK_LENGTH_MIN + (STREAK_LENGTH_MAX - STREAK_LENGTH_MIN) * R() ** 2) * (1 + STREAK_CASCADE_STRETCH * c2);
    const width = Math.min(STREAK_WIDTH_MIN + (STREAK_WIDTH_MAX - STREAK_WIDTH_MIN) * R(), Math.max(STREAK_WIDTH_MIN, .16 * fw));
    const alpha = clamp(STREAK_ALPHA_MIN + (STREAK_ALPHA_MAX - STREAK_ALPHA_MIN) * R() * (.6 + .4 * r2 + .2 * c2), STREAK_ALPHA_MIN, STREAK_ALPHA_MAX);
    const bias = clamp(-turnAt(c, s, fw) * BEND_BIAS, -.35, .35);
    let u = bias + (R() + R() - 1) * STREAK_SPREAD;
    if (c2 > 0 && R() < c2 * BRAID_SHARE) {
      const t = Math.floor(R() * BRAID_THREADS);
      u = ((t + .5) / BRAID_THREADS * 2 - 1) * .75 + (noise1(id * 7 + t, c.tau[f.j] / 2, 23) - .5) * .5 + (R() - .5) * .08;
    }
    const room = 1 - (width / 2 + .15) / (fw / 2);
    u = room > 0 ? clamp(u, -room, room) : 0;
    m.add(FOAM, C_FOAM, width, width, alpha, fw, f.level, .5 * R(), along(c, s - len / 2, s + len / 2, u, 4, Math.min(.3, .05 * len), R));
    if (R() < FLECK_CHANCE) {
      const nf = 1 + Math.floor(R() * 3);
      for (let q = 0; q < nf; q++) {
        const h = frameAt(c, s + (R() - .5) * len * 1.2), fu = clamp(u + (R() - .5) * 2 / (fw / 2), -.92, .92);
        const cx = h.x + h.nx * fu * h.w / 2, cy = h.y + h.ny * fu * h.w / 2, ang = (R() - .5) * 1.2;
        const dx = h.tx * Math.cos(ang) + h.nx * Math.sin(ang), dy = h.ty * Math.cos(ang) + h.ny * Math.sin(ang);
        const l = FLECK_LENGTH_MIN + (FLECK_LENGTH_MAX - FLECK_LENGTH_MIN) * R(), fwid = FLECK_WIDTH_MIN + (FLECK_WIDTH_MAX - FLECK_WIDTH_MIN) * R();
        m.add(FOAM, C_FOAM, fwid, fwid, .35 + .35 * R(), h.w, h.level, .5 + .5 * R(), [cx - dx * l / 2, cy - dy * l / 2, cx + dx * l / 2, cy + dy * l / 2]);
      }
    }
  }
  // Emergent rocks in cascades, few.
  for (let s2 = unit(id, 1, 13) * 30, q = 0; s2 < c.total;) {
    s2 += -Math.log(1 - unit(id, q++, 17)) / (ROCK_PER_100M / 100);
    if (s2 >= c.total) break;
    const f = frameAt(c, s2), casc = smooth(CASCADE_SLOPE, CASCADE_FULL_SLOPE, c.slope[f.j]), R = rng(id, s2, 19);
    if (busy(s2) || R() >= casc || f.w < 3) continue;
    const u = (R() * 2 - 1) * .7, d = clamp(ROCK_SIZE_MIN + (ROCK_SIZE_MAX - ROCK_SIZE_MIN) * R(), ROCK_SIZE_MIN, Math.max(ROCK_SIZE_MIN, .35 * f.w));
    addRock(m, c, f, f.x + f.nx * u * f.w / 2, f.y + f.ny * u * f.w / 2, d, R, true, 0);
  }
  // Boulders half in the water at the edge of steep reaches.
  for (let s2 = unit(id, 2, 29) * 50, q = 0; s2 < c.total;) {
    s2 += -Math.log(1 - unit(id, q++, 31)) / (BANK_ROCK_PER_100M / 100);
    if (s2 >= c.total) break;
    const f = frameAt(c, s2), R = rng(id, s2, 37);
    if (busy(s2) || R() >= smooth(BANK_ROCK_SLOPE, CASCADE_SLOPE * 1.5, c.slope[f.j]) || f.w < 2) continue;
    const side = R() < .5 ? -1 : 1, d = ROCK_SIZE_MIN + (2 - ROCK_SIZE_MIN) * R(), off = side * (f.w / 2 + (R() - .3) * .3 * d);
    addRock(m, c, f, f.x + f.nx * off, f.y + f.ny * off, d, R, false, side);
  }
  return falls.length;
}

/** All the marks of a network, binned. Pure: the same courses give the same marks. */
export function buildWhiteWater(courses: readonly WhiteWaterCourse[]): WhiteWaterMarks {
  const m = new MarkList();
  let falls = 0;
  for (const course of courses) falls += addCourse(m, course);
  const count = m.kind.length, cx = new Float64Array(count), cy = new Float64Array(count);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, reach = 0;
  for (let i = 0; i < count; i++) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (let p = m.start[i], e = p + m.points[i]; p < e; p++) { const x = m.xy[2 * p], y = m.xy[2 * p + 1]; a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    cx[i] = (a + c) / 2; cy[i] = (b + d) / 2;
    reach = Math.max(reach, Math.hypot(c - a, d - b) / 2 + m.width[i] / 2);
    x0 = Math.min(x0, cx[i]); y0 = Math.min(y0, cy[i]); x1 = Math.max(x1, cx[i]); y1 = Math.max(y1, cy[i]);
  }
  if (!count) { x0 = y0 = 0; x1 = y1 = 0; }
  const cols = Math.max(1, Math.floor((x1 - x0) / BIN) + 1), rows = Math.max(1, Math.floor((y1 - y0) / BIN) + 1);
  const start = new Uint32Array(cols * rows + 1), items = new Uint32Array(count), cell = new Uint32Array(count);
  for (let i = 0; i < count; i++) { cell[i] = Math.floor((cy[i] - y0) / BIN) * cols + Math.floor((cx[i] - x0) / BIN); start[cell[i] + 1]++; }
  for (let b = 0; b < cols * rows; b++) start[b + 1] += start[b];
  const fill = start.slice(0, cols * rows);
  for (let i = 0; i < count; i++) items[fill[cell[i]]++] = i;
  return { count, kind: Uint8Array.from(m.kind), color: Uint8Array.from(m.color), width: Float32Array.from(m.width), size: Float32Array.from(m.size),
    alpha: Float32Array.from(m.alpha), channel: Float32Array.from(m.channel), altitude: Float32Array.from(m.altitude), rank: Float32Array.from(m.rank),
    start: Uint32Array.from(m.start), points: Uint16Array.from(m.points), xy: Float32Array.from(m.xy), bins: { x0, y0, cols, rows, start, items }, reach, falls };
}

// ---------------------------------------------------------------- display state
/** The network of the displayed map: a stable object per network, built on its first paint. */
export interface WhiteWaterSource { courses: () => readonly WhiteWaterCourse[] }
let source: WhiteWaterSource | undefined, marks: WhiteWaterMarks | undefined, revision = 0;
/** Set by the page that draws a satellite ground (V2 water pass); undefined clears it (other styles, no water). */
export function setWhiteWater(next: WhiteWaterSource | undefined): void {
  if (next === source) return;
  source = next; marks = undefined; revision++;
}
/** Changes whenever the marks change: part of the retained vector map's keys. */
export const whiteWaterRevision = (): number => WHITE_WATER_ENABLED && source ? revision : 0;

let snowKey = '';
const snowMemo = new Map<number, number>();
/** River ice (0 open … 1 frozen) from the ground snow at a level, memoized per 10 m and per season. */
function iceAt(level: number): number {
  const key = roofSeasonKey();
  if (key !== snowKey) { snowKey = key; snowMemo.clear(); }
  const q = Math.round(level / 10);
  let v = snowMemo.get(q);
  if (v === undefined) { v = smooth(ICE_SNOW_START, ICE_SNOW_FULL, mapGroundSnow(q * 10)); snowMemo.set(q, v); }
  return v;
}

type Bucket = { layer: number; color: number; width: number; alpha: number; path: Path2D };
const widthIndex = (w: number): number => clamp(Math.round(Math.log2(w) * 4) + 80, 0, 159);
const widthOf = (i: number): number => 2 ** ((i - 80) / 4);

/** Paints the marks over `rect` (map metres) at `scale` px per metre, through `Path` (the recorder's path class on the
 * GPU engine). Returns the number of marks painted. */
export function drawWhiteWater(ctx: CanvasRenderingContext2D, Path: new () => Path2D, rect: { minX: number; minY: number; maxX: number; maxY: number }, scale: number): number {
  if (!WHITE_WATER_ENABLED || !source) return 0;
  const m = marks ??= buildWhiteWater(source.courses());
  if (!m.count) return 0;
  const { x0, y0, cols, rows, start, items } = m.bins, r = m.reach;
  const bx0 = clamp(Math.floor((rect.minX - r - x0) / BIN), 0, cols - 1), bx1 = clamp(Math.floor((rect.maxX + r - x0) / BIN), 0, cols - 1);
  const by0 = clamp(Math.floor((rect.minY - r - y0) / BIN), 0, rows - 1), by1 = clamp(Math.floor((rect.maxY + r - y0) / BIN), 0, rows - 1);
  if (rect.maxX + r < x0 || rect.maxY + r < y0 || rect.minX - r > x0 + cols * BIN || rect.minY - r > y0 + rows * BIN) return 0;
  const shown: number[] = [], alphas: number[] = [], colors: number[] = [], histogram = new Uint32Array(32);
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
    const b = by * cols + bx;
    for (let k = start[b]; k < start[b + 1]; k++) {
      const i = items[k], kind = m.kind[i];
      if (m.size[i] * scale < (m.width[i] > 0 ? MIN_STROKE_PX : MIN_ROCK_PX)) continue;
      const fade = smooth(ZOOM_START_PX, ZOOM_FULL_PX, m.channel[i] * scale);
      if (fade <= 0) continue;
      const ice = iceAt(m.altitude[i]);
      let a = m.alpha[i] * fade, color = m.color[i];
      if (kind === FALL && ice >= .5) { color = C_ICE; a *= ICE_FALL_ALPHA; }
      else a *= 1 - ice;
      if (a < .02) continue;
      shown.push(i); alphas.push(a); colors.push(color);
      histogram[Math.min(31, Math.floor(m.rank[i] * 32))]++;
    }
  }
  // Too many marks for one view: the highest ranks go (flecks first, then streaks); rocks and falls stay.
  let limit = 2;
  if (shown.length > MAX_MARKS_PER_VIEW) {
    let sum = 0, b = 0;
    for (; b < 32 && sum + histogram[b] <= MAX_MARKS_PER_VIEW; b++) sum += histogram[b];
    limit = Math.max(1, b) / 32;
  }
  const buckets = new Map<number, Bucket>();
  const bucket = (layer: number, color: number, wi: number, alpha: number): Bucket | undefined => {
    const ai = Math.round(alpha * 40);
    if (ai <= 0) return;
    const key = ((layer * 8 + color) * 161 + wi + 1) * 41 + Math.min(40, ai);
    let found = buckets.get(key);
    if (!found) buckets.set(key, found = { layer, color, width: wi < 0 ? 0 : widthOf(wi), alpha: Math.min(40, ai) / 40, path: new Path() });
    return found;
  };
  const trace = (path: Path2D, i: number, close: boolean): void => {
    const p0 = m.start[i], n = m.points[i];
    path.moveTo(m.xy[2 * p0], m.xy[2 * p0 + 1]);
    for (let p = 1; p < n; p++) path.lineTo(m.xy[2 * (p0 + p)], m.xy[2 * (p0 + p) + 1]);
    if (close) path.closePath();
  };
  let painted = 0;
  for (let k = 0; k < shown.length; k++) {
    const i = shown[k];
    if (m.rank[i] >= limit) continue;
    const a = alphas[k], color = colors[k], w = m.width[i];
    painted++;
    if (w <= 0) { const b = bucket(color === C_TOP ? 3 : 2, color, -1, a); if (b) trace(b.path, i, true); continue; }
    if (m.kind[i] === MIST) {
      // Three stacked strokes: a soft disc with no hard edge.
      for (const [f, g] of [[1, .35], [.72, .35], [.45, .3]] as const) { const b = bucket(0, color, widthIndex(w * f), a * g); if (b) trace(b.path, i, false); }
      continue;
    }
    const halo = bucket(1, color, widthIndex(w * HALO_WIDTH), a * HALO_ALPHA); if (halo) trace(halo.path, i, false);
    const core = bucket(4, color, widthIndex(w), a); if (core) trace(core.path, i, false);
    if (w * scale >= INNER_FROM_PX) { const inner = bucket(5, color, widthIndex(w * INNER_WIDTH), a * INNER_ALPHA); if (inner) trace(inner.path, i, false); }
  }
  if (!buckets.size) return 0;
  const ordered = [...buckets.values()].sort((a, b) => a.layer - b.layer || a.width - b.width || a.alpha - b.alpha);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const b of ordered) {
    ctx.globalAlpha = b.alpha;
    if (b.width <= 0) { ctx.fillStyle = COLORS[b.color]; ctx.fill(b.path, 'nonzero'); }
    else { ctx.strokeStyle = COLORS[b.color]; ctx.lineWidth = b.width; ctx.stroke(b.path); }
  }
  ctx.restore();
  return painted;
}
