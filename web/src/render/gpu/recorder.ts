/**
 * Canvas 2D recorder for the GPU vector engine (design: web/out/vector-gpu-2026-11-12/DESIGN.md).
 *
 * `RecordingCanvas.getContext('2d')` returns a `RecordingContext` that implements the Canvas 2D subset used by the vector
 * renderer and turns the calls into a `DisplayList` (displayList.ts). Anything it cannot represent sets `unsupported`
 * (first reason wins) and recording continues cheaply; the caller then falls back to the CPU engine.
 */
import {
  IDENTITY, SPRITE_STRIDE,
  type ClipNode, type Composite, type DisplayList, type DrawOp, type FillRule, type ImageSource, type LineCap,
  type LineJoin, type Mat, type Paint, type RecordedPath, type Repeat, type Rgba,
} from './displayList';
import {
  PlainPath, RecPath2D, matFromInit, pAppend, pArcTo, pClose, pCopy, pCubic, pEllipse, pLineTo, pMoveTo, pQuad, pRect,
  pReset, pRoundRect, pTransform, type PathData,
} from './path';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const finite = (v: number): boolean => v * 0 === 0;

// ---------------------------------------------------------------------------------------------------- matrices

const matEq = (a: Mat, b: Mat): boolean =>
  a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5]);

/** p after q: x -> p(q(x)). */
function compose(p: Mat, q: Mat): Mat {
  return [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
}

function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !finite(det)) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

// ---------------------------------------------------------------------------------------------------- colours

type ColorPaint = { readonly kind: 'color'; readonly rgba: Rgba };
const INVALID = 'invalid' as const;
type ColorEntry = ColorPaint | typeof INVALID | null;

const c255 = (v: number): number => v / 255;
const NAMED: Record<string, Rgba> = {
  black: [0, 0, 0, 1], white: [1, 1, 1, 1], red: [1, 0, 0, 1], green: [0, c255(128), 0, 1], blue: [0, 0, 1, 1],
  yellow: [1, 1, 0, 1], cyan: [0, 1, 1, 1], aqua: [0, 1, 1, 1], magenta: [1, 0, 1, 1], fuchsia: [1, 0, 1, 1],
  gray: [c255(128), c255(128), c255(128), 1], grey: [c255(128), c255(128), c255(128), 1], silver: [c255(192), c255(192), c255(192), 1],
  maroon: [c255(128), 0, 0, 1], olive: [c255(128), c255(128), 0, 1], lime: [0, 1, 0, 1], teal: [0, c255(128), c255(128), 1],
  navy: [0, 0, c255(128), 1], purple: [c255(128), 0, c255(128), 1], orange: [1, c255(165), 0, 1], brown: [c255(165), c255(42), c255(42), 1],
  transparent: [0, 0, 0, 0],
};

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const num = (s: string): number => (s.length ? Number(s) : NaN);

function parseHex(s: string): Rgba | null {
  const n = s.length - 1;
  if ((n !== 3 && n !== 4 && n !== 6 && n !== 8) || !/^#[0-9a-f]+$/.test(s)) return null;
  const h = (i: number, l: number): number => {
    const v = parseInt(s.slice(1 + i * l, 1 + i * l + l), 16);
    return l === 1 ? (v * 17) / 255 : v / 255;
  };
  const l = n <= 4 ? 1 : 2;
  return [h(0, l), h(1, l), h(2, l), n === 4 || n === 8 ? h(3, l) : 1];
}

function alphaOf(s: string | undefined): number {
  if (s === undefined) return 1;
  const v = s.endsWith('%') ? num(s.slice(0, -1)) / 100 : num(s);
  return finite(v) ? clamp01(v) : NaN;
}

function hueOf(s: string): number {
  const unit = /[a-z]+$/.exec(s)?.[0] ?? '';
  const v = num(unit ? s.slice(0, -unit.length) : s);
  return unit === '' || unit === 'deg' ? v : unit === 'rad' ? (v * 180) / Math.PI : unit === 'grad' ? v * 0.9 : unit === 'turn' ? v * 360 : NaN;
}

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla() and a few named colours to straight RGBA 0..1. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s.charCodeAt(0) === 35) return parseHex(s);
  const open = s.indexOf('(');
  if (open > 0 && s.charCodeAt(s.length - 1) === 41) {
    const fn = s.slice(0, open).trim();
    const args = s.slice(open + 1, -1).split(/[\s,/]+/).filter((a) => a.length > 0);
    if (args.length !== 3 && args.length !== 4) return null;
    const a = alphaOf(args[3]);
    if (fn === 'rgb' || fn === 'rgba') {
      const ch = (v: string): number => (v.endsWith('%') ? num(v.slice(0, -1)) / 100 : num(v) / 255);
      const r = ch(args[0]), gg = ch(args[1]), b = ch(args[2]);
      return finite(r) && finite(gg) && finite(b) && finite(a) ? [clamp01(r), clamp01(gg), clamp01(b), a] : null;
    }
    if (fn === 'hsl' || fn === 'hsla') {
      const pc = (v: string): number => num(v.endsWith('%') ? v.slice(0, -1) : v) / 100;
      const h = hueOf(args[0]), sat = clamp01(pc(args[1])), lig = clamp01(pc(args[2]));
      if (!finite(h) || !finite(sat) || !finite(lig) || !finite(a)) return null;
      const hh = (((h % 360) + 360) % 360) / 30;
      const f = (n: number): number => { const k = (n + hh) % 12; return lig - sat * Math.min(lig, 1 - lig) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return [clamp01(f(0)), clamp01(f(8)), clamp01(f(4)), a];
    }
    return null;
  }
  return NAMED[s] ?? null;
}

type Normaliser = { fillStyle: string | CanvasGradient | CanvasPattern };
let normaliser: Normaliser | null | undefined;
/** Browser fallback: let a 1x1 canvas normalise the colour. 'invalid' when the canvas rejects it, null without a canvas. */
function normaliseColor(s: string): string | null {
  if (normaliser === undefined) {
    normaliser = null;
    try {
      if (typeof OffscreenCanvas !== 'undefined') normaliser = new OffscreenCanvas(1, 1).getContext('2d');
      else if (typeof document !== 'undefined') normaliser = document.createElement('canvas').getContext('2d');
    } catch { normaliser = null; }
  }
  const n = normaliser;
  if (!n) return null;
  n.fillStyle = '#010203'; n.fillStyle = s;
  const r = n.fillStyle;
  if (typeof r !== 'string') return null;
  if (r === '#010203') { n.fillStyle = '#030201'; n.fillStyle = s; if (n.fillStyle === '#030201') return INVALID; }
  return r;
}

const COLORS = new Map<string, ColorEntry>();
function colorEntry(s: string): ColorEntry {
  let e = COLORS.get(s);
  if (e !== undefined) return e;
  let rgba = parseColor(s);
  e = null;
  if (rgba === null) {
    const n = normaliseColor(s);
    if (n === INVALID) e = INVALID;
    else if (n !== null) rgba = parseColor(n);
  }
  if (rgba !== null) e = { kind: 'color', rgba };
  if (COLORS.size >= 4096) COLORS.clear();
  COLORS.set(s, e);
  return e;
}

const BLACK: ColorPaint = { kind: 'color', rgba: [0, 0, 0, 1] };

const samePaint = (a: Paint, b: Paint): boolean => a === b || (a.kind === 'color' && b.kind === 'color'
  && a.rgba[0] === b.rgba[0] && a.rgba[1] === b.rgba[1] && a.rgba[2] === b.rgba[2] && a.rgba[3] === b.rgba[3]);

// ---------------------------------------------------------------------------------------------------- patterns

/** Pattern made by a RecordingContext: an image, a repetition and a live matrix (Canvas `pattern.setTransform`). */
export class RecPattern {
  private matrix: Mat = IDENTITY;
  private smooth: Paint | null = null;
  private sharp: Paint | null = null;
  constructor(readonly source: ImageSource, readonly repeat: Repeat) {}
  setTransform(m?: DOMMatrix2DInit): void {
    const next = m ? matFromInit(m) : IDENTITY;
    if (!next) return;
    this.matrix = next; this.smooth = this.sharp = null;
  }
  get transform(): Mat { return this.matrix; }
  /** Paint snapshot; the same object until setTransform, so consecutive draws merge by identity. */
  paint(smoothing: boolean): Paint {
    if (smoothing) return this.smooth ??= { kind: 'pattern', source: this.source, repeat: this.repeat, transform: this.matrix, smoothing: true };
    return this.sharp ??= { kind: 'pattern', source: this.source, repeat: this.repeat, transform: this.matrix, smoothing: false };
  }
}

// ---------------------------------------------------------------------------------------------------- images

let IW = 0, IH = 0;
/** Intrinsic size of an image source into IW/IH; false when it cannot be read (e.g. SVG image elements). */
function imageSize(img: unknown): boolean {
  if (img instanceof RecordingCanvas) return false;
  const o = img as { naturalWidth?: unknown; naturalHeight?: unknown; videoWidth?: unknown; videoHeight?: unknown; displayWidth?: unknown; displayHeight?: unknown; width?: unknown; height?: unknown };
  if (typeof o.naturalWidth === 'number' && typeof o.naturalHeight === 'number') { IW = o.naturalWidth; IH = o.naturalHeight; return true; }
  if (typeof o.videoWidth === 'number' && typeof o.videoHeight === 'number') { IW = o.videoWidth; IH = o.videoHeight; return true; }
  if (typeof o.displayWidth === 'number' && typeof o.displayHeight === 'number') { IW = o.displayWidth; IH = o.displayHeight; return true; }
  if (typeof o.width === 'number' && typeof o.height === 'number') { IW = o.width; IH = o.height; return true; }
  return false;
}

// ---------------------------------------------------------------------------------------------------- state

const COMPOSITES = new Set(['source-over', 'source-in', 'source-out', 'source-atop', 'destination-over', 'destination-in',
  'destination-out', 'destination-atop', 'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
const RECORDABLE = new Set<string>(['source-over', 'multiply', 'destination-in', 'destination-out']);
const EMPTY_DASH: readonly number[] = [];

type Style = string | CanvasGradient | CanvasPattern;

class State {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  /** Snapshot of a..f, created lazily and shared until the transform changes. */
  mat: Mat | null = IDENTITY;
  alpha = 1;
  composite = 'source-over';
  comp: Composite | null = 'source-over';
  fillStyle: Style = '#000000'; fillPaint: Paint | null = BLACK; fillPattern: RecPattern | null = null; fillReason = '';
  strokeStyle: Style = '#000000'; strokePaint: Paint | null = BLACK; strokePattern: RecPattern | null = null; strokeReason = '';
  lineWidth = 1; cap: LineCap = 'butt'; join: LineJoin = 'miter'; miter = 10;
  dash: readonly number[] = EMPTY_DASH; dashSolid = true; dashOffset = 0;
  smoothing = true; smoothingQuality: ImageSmoothingQuality = 'low';
  font = '10px sans-serif'; textAlign: CanvasTextAlign = 'start'; textBaseline: CanvasTextBaseline = 'alphabetic'; direction: CanvasDirection = 'inherit';
  filter = 'none';
  shadowBlur = 0; shadowX = 0; shadowY = 0; shadowColor = 'rgba(0, 0, 0, 0)'; shadowVisible = false;
  clip: ClipNode | null = null;

  copy(o: State): void {
    this.a = o.a; this.b = o.b; this.c = o.c; this.d = o.d; this.e = o.e; this.f = o.f; this.mat = o.mat;
    this.alpha = o.alpha; this.composite = o.composite; this.comp = o.comp;
    this.fillStyle = o.fillStyle; this.fillPaint = o.fillPaint; this.fillPattern = o.fillPattern; this.fillReason = o.fillReason;
    this.strokeStyle = o.strokeStyle; this.strokePaint = o.strokePaint; this.strokePattern = o.strokePattern; this.strokeReason = o.strokeReason;
    this.lineWidth = o.lineWidth; this.cap = o.cap; this.join = o.join; this.miter = o.miter;
    this.dash = o.dash; this.dashSolid = o.dashSolid; this.dashOffset = o.dashOffset;
    this.smoothing = o.smoothing; this.smoothingQuality = o.smoothingQuality;
    this.font = o.font; this.textAlign = o.textAlign; this.textBaseline = o.textBaseline; this.direction = o.direction;
    this.filter = o.filter;
    this.shadowBlur = o.shadowBlur; this.shadowX = o.shadowX; this.shadowY = o.shadowY; this.shadowColor = o.shadowColor; this.shadowVisible = o.shadowVisible;
    this.clip = o.clip;
  }
}

interface SpriteRec {
  type: 'sprites'; source: ImageSource; smoothing: boolean; composite: Composite; clip: ClipNode | null;
  instances: Float32Array; count: number;
}

type AnyPath = RecordedPath & PathData;
const ruleOf = (r: unknown): FillRule => (r === 'evenodd' ? 'evenodd' : 'nonzero');
const isClear = (p: Paint): boolean => p.kind === 'color' && p.rgba[3] <= 0;

// ---------------------------------------------------------------------------------------------------- canvas

/** Canvas stand-in whose 2D context records a display list (satisfies canvas.ts `CanvasLike`). */
export class RecordingCanvas {
  private ctx: RecordingContext | null = null;
  constructor(public width: number, public height: number) {}
  getContext(id: '2d', options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null {
    void options;
    if (id !== '2d') return null;
    return (this.ctx ??= new RecordingContext(this)) as unknown as CanvasRenderingContext2D;
  }
  /** The ops recorded since the previous finish(); the context stays usable (its state is kept). */
  finish(): DisplayList { return (this.ctx ??= new RecordingContext(this)).finish(); }
}

/** Canvas 2D subset that records a DisplayList. Cast to CanvasRenderingContext2D by RecordingCanvas.getContext. */
export class RecordingContext {
  private s = new State();
  private stack: State[] = [];
  private depth = 0;
  private ops: DrawOp[] = [];
  private last: DrawOp | null = null;
  private drawn = false;
  private reason: string | undefined;
  private nCalls = 0; private nPaths = 0; private nSprites = 0;
  private t0 = now();
  private clipSeq = 0;
  /** Bumped on every transform change; the default path re-checks its frame against it. */
  private ctmVer = 0;
  // Default path: points are kept in `pathFrame` coordinates (the CTM when it started), so the common case
  // (a path built and drawn under one transform) needs no conversion. `pathM` maps incoming user points into that frame.
  private path = new PlainPath();
  private pathShared = false;
  private pathFrame: Mat = IDENTITY;
  private pathM: Mat | null = null;
  private pathVer = -1;

  constructor(private readonly owner: RecordingCanvas) {}

  get canvas(): HTMLCanvasElement { return this.owner as unknown as HTMLCanvasElement; }
  /** First reason the recording cannot be replayed faithfully, if any. */
  get unsupported(): string | undefined { return this.reason; }

  private fail(reason: string): void { if (this.reason === undefined) this.reason = reason; }

  finish(): DisplayList {
    const ops = this.ops;
    for (const op of ops) if (op.type === 'sprites') {
      const r = op as unknown as SpriteRec, n = r.count * SPRITE_STRIDE;
      if (r.instances.length > n) r.instances = r.instances.slice(0, n);
    }
    const list: DisplayList = {
      width: this.owner.width, height: this.owner.height, ops,
      stats: { calls: this.nCalls, ops: ops.length, paths: this.nPaths, sprites: this.nSprites, recordMs: now() - this.t0 },
      ...(this.reason !== undefined ? { unsupported: this.reason } : {}),
    };
    this.ops = []; this.last = null;
    this.nCalls = this.nPaths = this.nSprites = 0; this.t0 = now();
    return list;
  }

  // ---- state
  save(): void {
    let t = this.stack[this.depth];
    if (!t) this.stack[this.depth] = t = new State();
    t.copy(this.s); this.depth++;
  }
  restore(): void {
    if (this.depth === 0) return;
    const t = this.stack[--this.depth], s = this.s;
    if (t.a !== s.a || t.b !== s.b || t.c !== s.c || t.d !== s.d || t.e !== s.e || t.f !== s.f) this.ctmVer++;
    s.copy(t);
  }
  reset(): void {
    this.s = new State(); this.depth = 0; this.ops = []; this.last = null; this.drawn = false; this.ctmVer++;
    this.beginPath();
  }

  get globalAlpha(): number { return this.s.alpha; }
  set globalAlpha(v: number) { if (v >= 0 && v <= 1) this.s.alpha = v; }
  get globalCompositeOperation(): GlobalCompositeOperation { return this.s.composite as GlobalCompositeOperation; }
  set globalCompositeOperation(v: GlobalCompositeOperation) {
    if (!COMPOSITES.has(v)) return;
    this.s.composite = v; this.s.comp = RECORDABLE.has(v) ? v as Composite : null;
  }
  get fillStyle(): Style { return this.s.fillStyle; }
  set fillStyle(v: Style) {
    const s = this.s;
    if (typeof v === 'string') {
      const e = colorEntry(v);
      if (e === INVALID) return;
      s.fillStyle = v; s.fillPaint = e; s.fillPattern = null; s.fillReason = e ? '' : `colour ${v}`;
    } else if (v instanceof RecPattern) { s.fillStyle = v; s.fillPaint = null; s.fillPattern = v; }
    else { s.fillStyle = v; s.fillPaint = null; s.fillPattern = null; s.fillReason = 'addColorStop' in v ? 'gradient' : 'native pattern'; }
  }
  get strokeStyle(): Style { return this.s.strokeStyle; }
  set strokeStyle(v: Style) {
    const s = this.s;
    if (typeof v === 'string') {
      const e = colorEntry(v);
      if (e === INVALID) return;
      s.strokeStyle = v; s.strokePaint = e; s.strokePattern = null; s.strokeReason = e ? '' : `colour ${v}`;
    } else if (v instanceof RecPattern) { s.strokeStyle = v; s.strokePaint = null; s.strokePattern = v; }
    else { s.strokeStyle = v; s.strokePaint = null; s.strokePattern = null; s.strokeReason = 'addColorStop' in v ? 'gradient' : 'native pattern'; }
  }
  get lineWidth(): number { return this.s.lineWidth; }
  set lineWidth(v: number) { if (v > 0 && v !== Infinity) this.s.lineWidth = v; }
  get lineCap(): CanvasLineCap { return this.s.cap; }
  set lineCap(v: CanvasLineCap) { if (v === 'butt' || v === 'round' || v === 'square') this.s.cap = v; }
  get lineJoin(): CanvasLineJoin { return this.s.join; }
  set lineJoin(v: CanvasLineJoin) { if (v === 'round' || v === 'bevel' || v === 'miter') this.s.join = v; }
  get miterLimit(): number { return this.s.miter; }
  set miterLimit(v: number) { if (v > 0 && v !== Infinity) this.s.miter = v; }
  get lineDashOffset(): number { return this.s.dashOffset; }
  set lineDashOffset(v: number) { if (finite(v)) this.s.dashOffset = v; }
  setLineDash(segments: readonly number[]): void {
    const n = segments.length;
    let sum = 0;
    for (let i = 0; i < n; i++) { const v = segments[i]; if (!(v >= 0) || v === Infinity) return; sum += v; }
    const s = this.s, len = n % 2 ? n * 2 : n, cur = s.dash;
    if (cur.length === len) {
      let same = true;
      for (let i = 0; i < len; i++) if (cur[i] !== segments[i % n]) { same = false; break; }
      if (same) return;
    }
    if (!n) { s.dash = EMPTY_DASH; s.dashSolid = true; return; }
    const out = new Array<number>(len);
    for (let i = 0; i < len; i++) out[i] = segments[i % n];
    s.dash = out; s.dashSolid = sum === 0;
  }
  getLineDash(): number[] { return this.s.dash.slice(); }
  get imageSmoothingEnabled(): boolean { return this.s.smoothing; }
  set imageSmoothingEnabled(v: boolean) { this.s.smoothing = !!v; }
  get imageSmoothingQuality(): ImageSmoothingQuality { return this.s.smoothingQuality; }
  set imageSmoothingQuality(v: ImageSmoothingQuality) { if (v === 'low' || v === 'medium' || v === 'high') this.s.smoothingQuality = v; }
  get font(): string { return this.s.font; }
  set font(v: string) { this.s.font = v; }
  get textAlign(): CanvasTextAlign { return this.s.textAlign; }
  set textAlign(v: CanvasTextAlign) { this.s.textAlign = v; }
  get textBaseline(): CanvasTextBaseline { return this.s.textBaseline; }
  set textBaseline(v: CanvasTextBaseline) { this.s.textBaseline = v; }
  get direction(): CanvasDirection { return this.s.direction; }
  set direction(v: CanvasDirection) { this.s.direction = v; }
  get filter(): string { return this.s.filter; }
  set filter(v: string) { if (typeof v === 'string' && v.length) this.s.filter = v; }
  get shadowBlur(): number { return this.s.shadowBlur; }
  set shadowBlur(v: number) { if (v >= 0 && v !== Infinity) this.s.shadowBlur = v; }
  get shadowOffsetX(): number { return this.s.shadowX; }
  set shadowOffsetX(v: number) { if (finite(v)) this.s.shadowX = v; }
  get shadowOffsetY(): number { return this.s.shadowY; }
  set shadowOffsetY(v: number) { if (finite(v)) this.s.shadowY = v; }
  get shadowColor(): string { return this.s.shadowColor; }
  set shadowColor(v: string) {
    const e = colorEntry(v);
    if (e === INVALID) return;
    this.s.shadowColor = v; this.s.shadowVisible = e === null || e.rgba[3] > 0;
  }
  getContextAttributes(): CanvasRenderingContext2DSettings { return { alpha: true, colorSpace: 'srgb', desynchronized: false, willReadFrequently: false }; }

  // ---- transform
  private matNow(): Mat { const s = this.s; return s.mat ??= [s.a, s.b, s.c, s.d, s.e, s.f]; }
  private setT(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const s = this.s;
    s.a = a; s.b = b; s.c = c; s.d = d; s.e = e; s.f = f; s.mat = null; this.ctmVer++;
  }
  setTransform(a?: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number): void {
    if (typeof a === 'number') {
      if (finite(a) && finite(b!) && finite(c!) && finite(d!) && finite(e!) && finite(f!)) this.setT(a, b!, c!, d!, e!, f!);
      return;
    }
    const m = a ? matFromInit(a) : IDENTITY;
    if (m) this.setT(m[0], m[1], m[2], m[3], m[4], m[5]);
  }
  resetTransform(): void { this.setT(1, 0, 0, 1, 0, 0); }
  getTransform(): DOMMatrix {
    const s = this.s;
    if (typeof DOMMatrix !== 'undefined') return new DOMMatrix([s.a, s.b, s.c, s.d, s.e, s.f]);
    return {
      a: s.a, b: s.b, c: s.c, d: s.d, e: s.e, f: s.f, m11: s.a, m12: s.b, m21: s.c, m22: s.d, m41: s.e, m42: s.f, is2D: true,
      isIdentity: s.a === 1 && s.b === 0 && s.c === 0 && s.d === 1 && s.e === 0 && s.f === 0,
    } as unknown as DOMMatrix;
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (!finite(a) || !finite(b) || !finite(c) || !finite(d) || !finite(e) || !finite(f)) return;
    const s = this.s;
    this.setT(s.a * a + s.c * b, s.b * a + s.d * b, s.a * c + s.c * d, s.b * c + s.d * d, s.a * e + s.c * f + s.e, s.b * e + s.d * f + s.f);
  }
  translate(x: number, y: number): void {
    if (!finite(x) || !finite(y)) return;
    const s = this.s;
    this.setT(s.a, s.b, s.c, s.d, s.e + s.a * x + s.c * y, s.f + s.b * x + s.d * y);
  }
  scale(x: number, y: number): void {
    if (!finite(x) || !finite(y)) return;
    const s = this.s;
    this.setT(s.a * x, s.b * x, s.c * y, s.d * y, s.e, s.f);
  }
  rotate(angle: number): void {
    if (!finite(angle)) return;
    const c = Math.cos(angle), n = Math.sin(angle);
    this.transform(c, n, -n, c, 0, 0);
  }

  // ---- default path
  /** The default path, ready for a mutation: copied when an op holds it, frame synced with the CTM. */
  private wpath(): PlainPath {
    let p = this.path;
    if (this.pathShared) { const q = new PlainPath(); pCopy(q, p); this.path = p = q; this.pathShared = false; }
    if (this.pathVer !== this.ctmVer) {
      this.pathVer = this.ctmVer;
      const t = this.matNow();
      if (p.cmds.length === 0) { this.pathFrame = t; this.pathM = null; }
      else if (matEq(t, this.pathFrame)) this.pathM = null;
      else {
        // The CTM changed mid-path: move the path to device space and map further points by the CTM.
        if (!matEq(this.pathFrame, IDENTITY)) {
          pTransform(p, this.pathFrame); this.pathFrame = IDENTITY;
        }
        this.pathM = matEq(t, IDENTITY) ? null : t;
      }
    }
    return p;
  }
  beginPath(): void {
    if (this.pathShared) { this.path = new PlainPath(); this.pathShared = false; }
    else pReset(this.path);
    this.pathVer = -1;
  }
  moveTo(x: number, y: number): void { const p = this.wpath(); pMoveTo(p, x, y, this.pathM); }
  lineTo(x: number, y: number): void { const p = this.wpath(); pLineTo(p, x, y, this.pathM); }
  closePath(): void { if (this.path.hasPt) pClose(this.wpath()); }
  rect(x: number, y: number, w: number, h: number): void { const p = this.wpath(); pRect(p, x, y, w, h, this.pathM); }
  roundRect(x: number, y: number, w: number, h: number, radii?: number | DOMPointInit | (number | DOMPointInit)[]): void {
    const p = this.wpath(); pRoundRect(p, x, y, w, h, radii, this.pathM);
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean): void {
    const p = this.wpath(); pEllipse(p, x, y, r, r, 0, start, end, !!ccw, this.pathM);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void { const p = this.wpath(); pArcTo(p, x1, y1, x2, y2, r, this.pathM); }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number, ccw?: boolean): void {
    const p = this.wpath(); pEllipse(p, x, y, rx, ry, rot, start, end, !!ccw, this.pathM);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void { const p = this.wpath(); pQuad(p, cx, cy, x, y, this.pathM); }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const p = this.wpath(); pCubic(p, c1x, c1y, c2x, c2y, x, y, this.pathM);
  }

  // ---- drawing
  private userPath(a: Path2D): RecPath2D | null {
    if (!(a instanceof RecPath2D)) { this.fail('native Path2D'); return null; }
    if (!a.readable) { this.fail('unreadable path'); return null; }
    return a;
  }
  /** The recordable composite, or null after marking an unrecordable state (composite, filter, shadow). */
  private composite(): Composite | null {
    const s = this.s;
    if (s.comp === null) { this.fail(`composite ${s.composite}`); return null; }
    if (s.filter !== 'none') { this.fail(`filter ${s.filter}`); return null; }
    if (s.shadowVisible && (s.shadowBlur > 0 || s.shadowX !== 0 || s.shadowY !== 0)) { this.fail('shadow'); return null; }
    return s.comp;
  }
  private push(op: DrawOp): void {
    this.ops.push(op); this.last = op;
    if (op.type !== 'clear') this.drawn = true;
  }

  private emitFill(path: AnyPath, t: Mat, rule: FillRule, isDefault: boolean): void {
    const comp = this.composite(); if (!comp) return;
    const s = this.s, paint = s.fillPattern ? s.fillPattern.paint(s.smoothing) : s.fillPaint;
    if (!paint) { this.fail(s.fillReason || 'fill style'); return; }
    if (comp !== 'destination-in' && (s.alpha <= 0 || isClear(paint) || path.cmds.length === 0)) return;
    if (isDefault) this.pathShared = true;
    this.nPaths++;
    const l = this.last;
    if (l !== null && l.type === 'fill' && comp !== 'destination-in' && l.rule === rule && l.alpha === s.alpha && l.composite === comp
      && l.clip === s.clip && matEq(l.transform, t) && samePaint(l.paint, paint)) {
      (l.paths as RecordedPath[]).push(path);
      return;
    }
    this.push({ type: 'fill', transform: t, alpha: s.alpha, composite: comp, clip: s.clip, paths: [path], rule, paint });
  }

  private emitStroke(path: AnyPath, t: Mat, isDefault: boolean): void {
    const comp = this.composite(); if (!comp) return;
    const s = this.s, paint = s.strokePattern ? s.strokePattern.paint(s.smoothing) : s.strokePaint;
    if (!paint) { this.fail(s.strokeReason || 'stroke style'); return; }
    if (comp !== 'destination-in' && (s.alpha <= 0 || isClear(paint) || path.cmds.length === 0)) return;
    if (isDefault) this.pathShared = true;
    this.nPaths++;
    const dash = s.dashSolid ? EMPTY_DASH : s.dash, l = this.last;
    if (l !== null && l.type === 'stroke' && comp !== 'destination-in' && l.alpha === s.alpha && l.composite === comp && l.clip === s.clip
      && l.width === s.lineWidth && l.cap === s.cap && l.join === s.join && l.miterLimit === s.miter && l.dashOffset === s.dashOffset
      && sameDash(l.dash, dash) && matEq(l.transform, t) && samePaint(l.paint, paint)) {
      (l.paths as RecordedPath[]).push(path);
      return;
    }
    this.push({
      type: 'stroke', transform: t, alpha: s.alpha, composite: comp, clip: s.clip, paths: [path], paint,
      width: s.lineWidth, cap: s.cap, join: s.join, miterLimit: s.miter, dash, dashOffset: s.dashOffset,
    });
  }

  fill(a?: Path2D | CanvasFillRule, b?: CanvasFillRule): void {
    this.nCalls++;
    if (this.reason !== undefined) return;
    if (a === undefined || typeof a === 'string') { this.emitFill(this.path, this.pathFrame, ruleOf(a), true); return; }
    const p = this.userPath(a);
    if (p) this.emitFill(p, this.matNow(), ruleOf(b), false);
  }

  stroke(a?: Path2D): void {
    this.nCalls++;
    if (this.reason !== undefined) return;
    if (a !== undefined) { const p = this.userPath(a); if (p) this.emitStroke(p, this.matNow(), false); return; }
    // Canvas strokes the default path with the line styles of the CTM at stroke time: express it in that space.
    const p = this.path, ctm = this.matNow();
    if (p.cmds.length === 0 || matEq(this.pathFrame, ctm)) { this.emitStroke(p, ctm, true); return; }
    const inv = invert(ctm);
    if (!inv) return;
    const q = new PlainPath(); pAppend(q, p, compose(inv, this.pathFrame));
    this.emitStroke(q, ctm, false);
  }

  clip(a?: Path2D | CanvasFillRule, b?: CanvasFillRule): void {
    this.nCalls++;
    let path: AnyPath, t: Mat, rule: FillRule;
    if (a === undefined || typeof a === 'string') { path = this.path; t = this.pathFrame; rule = ruleOf(a); this.pathShared = true; }
    else { const p = this.userPath(a); if (!p) return; path = p; t = this.matNow(); rule = ruleOf(b); }
    this.s.clip = { parent: this.s.clip, path, rule, transform: t, id: ++this.clipSeq };
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.nCalls++;
    if (this.reason !== undefined || !finite(x) || !finite(y) || !finite(w) || !finite(h) || w === 0 || h === 0) return;
    const p = new PlainPath(); pRect(p, x, y, w, h, null);
    this.emitFill(p, this.matNow(), 'nonzero', false);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.nCalls++;
    if (this.reason !== undefined || !finite(x) || !finite(y) || !finite(w) || !finite(h) || (w === 0 && h === 0)) return;
    const p = new PlainPath();
    if (w === 0 || h === 0) { pMoveTo(p, x, y, null); pLineTo(p, x + w, y + h, null); } else pRect(p, x, y, w, h, null);
    this.emitStroke(p, this.matNow(), false);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.nCalls++;
    if (this.reason !== undefined || !this.drawn || !finite(x) || !finite(y) || !finite(w) || !finite(h) || w === 0 || h === 0) return;
    this.push({ type: 'clear', transform: this.matNow(), clip: this.s.clip, x, y, w, h });
  }

  drawImage(image: CanvasImageSource, a: number, b: number, c?: number, d?: number, e?: number, f?: number, g?: number, h?: number): void {
    this.nCalls++;
    if (this.reason !== undefined) return;
    if (!imageSize(image)) { this.fail('image source'); return; }
    const iw = IW, ih = IH;
    if (!(iw > 0 && ih > 0)) return;
    let sx = 0, sy = 0, sw = iw, sh = ih, dx = a, dy = b, dw = iw, dh = ih;
    if (e !== undefined) { sx = a; sy = b; sw = c ?? NaN; sh = d ?? NaN; dx = e; dy = f ?? NaN; dw = g ?? NaN; dh = h ?? NaN; }
    else if (c !== undefined) { dw = c; dh = d ?? NaN; }
    if (!finite(sx) || !finite(sy) || !finite(sw) || !finite(sh) || !finite(dx) || !finite(dy) || !finite(dw) || !finite(dh)) return;
    if (sw < 0) { sx += sw; sw = -sw; }
    if (sh < 0) { sy += sh; sh = -sh; }
    if (dw < 0) { dx += dw; dw = -dw; }
    if (dh < 0) { dy += dh; dh = -dh; }
    // Clip the source rectangle to the image, the destination in proportion (Canvas rule).
    if (sx < 0 && sw > 0) { const k = -sx / sw; dx += dw * k; dw -= dw * k; sw += sx; sx = 0; }
    if (sy < 0 && sh > 0) { const k = -sy / sh; dy += dh * k; dh -= dh * k; sh += sy; sy = 0; }
    if (sx + sw > iw && sw > 0) { dw *= (iw - sx) / sw; sw = iw - sx; }
    if (sy + sh > ih && sh > 0) { dh *= (ih - sy) / sh; sh = ih - sy; }
    if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return;
    const comp = this.composite(); if (!comp) return;
    const s = this.s;
    if (comp !== 'destination-in' && s.alpha <= 0) return;
    let op = this.last as SpriteRec | null;
    if (op === null || op.type !== 'sprites' || comp === 'destination-in' || op.source !== image || op.composite !== comp
      || op.clip !== s.clip || op.smoothing !== s.smoothing) {
      op = { type: 'sprites', source: image, smoothing: s.smoothing, composite: comp, clip: s.clip, instances: new Float32Array(comp === 'destination-in' ? SPRITE_STRIDE : 16 * SPRITE_STRIDE), count: 0 };
      this.push(op as unknown as DrawOp);
    }
    let k = op.count * SPRITE_STRIDE;
    if (k + SPRITE_STRIDE > op.instances.length) {
      const next = new Float32Array(op.instances.length * 2); next.set(op.instances); op.instances = next;
    }
    const v = op.instances;
    v[k++] = sx; v[k++] = sy; v[k++] = sw; v[k++] = sh; v[k++] = dx; v[k++] = dy; v[k++] = dw; v[k++] = dh;
    v[k++] = s.a; v[k++] = s.b; v[k++] = s.c; v[k++] = s.d; v[k++] = s.e; v[k++] = s.f; v[k] = s.alpha;
    op.count++; this.nSprites++;
  }

  /**
   * Many drawImage calls at once (trusted producer): `data` holds 8 floats per item (sx, sy, sw, sh, dx, dy, dw, dh,
   * already inside the source and positive), `order` the items to draw in turn. Same result as calling drawImage for
   * each, with the current state, but without per-call overhead (cached sprite batches of the woods).
   */
  drawImageBatch(image: CanvasImageSource, data: Float32Array, order: ArrayLike<number>): void {
    this.nCalls++;
    if (this.reason !== undefined || !order.length) return;
    if (!imageSize(image)) { this.fail('image source'); return; }
    const comp = this.composite(); if (!comp) return;
    if (comp === 'destination-in') { for (let i = 0; i < order.length; i++) { const o = order[i] * 8; this.drawImage(image, data[o], data[o + 1], data[o + 2], data[o + 3], data[o + 4], data[o + 5], data[o + 6], data[o + 7]); } return; }
    const s = this.s;
    if (s.alpha <= 0) return;
    let op = this.last as SpriteRec | null;
    if (op === null || op.type !== 'sprites' || op.source !== image || op.composite !== comp || op.clip !== s.clip || op.smoothing !== s.smoothing) {
      op = { type: 'sprites', source: image, smoothing: s.smoothing, composite: comp, clip: s.clip, instances: new Float32Array(16 * SPRITE_STRIDE), count: 0 };
      this.push(op as unknown as DrawOp);
    }
    const need = (op.count + order.length) * SPRITE_STRIDE;
    if (need > op.instances.length) { const next = new Float32Array(Math.max(need, op.instances.length * 2)); next.set(op.instances); op.instances = next; }
    const v = op.instances;
    let k = op.count * SPRITE_STRIDE;
    for (let i = 0; i < order.length; i++) {
      const o = order[i] * 8;
      v[k++] = data[o]; v[k++] = data[o + 1]; v[k++] = data[o + 2]; v[k++] = data[o + 3]; v[k++] = data[o + 4]; v[k++] = data[o + 5]; v[k++] = data[o + 6]; v[k++] = data[o + 7];
      v[k++] = s.a; v[k++] = s.b; v[k++] = s.c; v[k++] = s.d; v[k++] = s.e; v[k++] = s.f; v[k++] = s.alpha;
    }
    op.count += order.length; this.nSprites += order.length;
  }

  createPattern(image: CanvasImageSource, repetition: string | null): CanvasPattern | null {
    if (!imageSize(image) || !(IW > 0 && IH > 0)) return null;
    const r: Repeat = repetition === 'repeat-x' || repetition === 'repeat-y' || repetition === 'no-repeat' ? repetition : 'repeat';
    return new RecPattern(image, r) as unknown as CanvasPattern;
  }

  // ---- not recordable: mark the list and stay cheap
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient { void x0; void y0; void x1; void y1; return this.gradient(); }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient { void x0; void y0; void r0; void x1; void y1; void r1; return this.gradient(); }
  createConicGradient(angle: number, x: number, y: number): CanvasGradient { void angle; void x; void y; return this.gradient(); }
  private gradient(): CanvasGradient { this.fail('gradient'); return { addColorStop: () => {} } as CanvasGradient; }
  fillText(text: string, x: number, y: number, maxWidth?: number): void { void text; void x; void y; void maxWidth; this.nCalls++; this.fail('text'); }
  strokeText(text: string, x: number, y: number, maxWidth?: number): void { void text; void x; void y; void maxWidth; this.nCalls++; this.fail('text'); }
  measureText(text: string): TextMetrics {
    this.fail('measureText');
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.s.font)?.[1] ?? 10), w = text.length * size * 0.55;
    return {
      width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: size * 0.75, actualBoundingBoxDescent: size * 0.25,
      fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2, emHeightAscent: size * 0.8, emHeightDescent: size * 0.2,
      alphabeticBaseline: 0, hangingBaseline: size * 0.8, ideographicBaseline: -size * 0.2,
    } as unknown as TextMetrics;
  }
  createImageData(a: number | ImageData, b?: number): ImageData {
    const w = typeof a === 'number' ? Math.max(1, Math.abs(a | 0)) : a.width, h = typeof a === 'number' ? Math.max(1, Math.abs((b ?? 1) | 0)) : a.height;
    if (typeof ImageData !== 'undefined') return new ImageData(w, h);
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' } as unknown as ImageData;
  }
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData { void sx; void sy; this.fail('getImageData'); return this.createImageData(sw, sh); }
  putImageData(data: ImageData, dx: number, dy: number): void { void data; void dx; void dy; this.nCalls++; this.fail('putImageData'); }
  isPointInPath(...args: unknown[]): boolean { void args; this.fail('isPointInPath'); return false; }
  isPointInStroke(...args: unknown[]): boolean { void args; this.fail('isPointInStroke'); return false; }
}

const sameDash = (a: readonly number[], b: readonly number[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
