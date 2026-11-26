import type { Rgba } from './contract';

const c255 = (v: number): number => v / 255;
const NAMED: Record<string, Rgba> = {
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  green: [0, c255(128), 0, 1],
  blue: [0, 0, 1, 1],
  yellow: [1, 1, 0, 1],
  cyan: [0, 1, 1, 1],
  aqua: [0, 1, 1, 1],
  magenta: [1, 0, 1, 1],
  fuchsia: [1, 0, 1, 1],
  gray: [c255(128), c255(128), c255(128), 1],
  grey: [c255(128), c255(128), c255(128), 1],
  silver: [c255(192), c255(192), c255(192), 1],
  maroon: [c255(128), 0, 0, 1],
  olive: [c255(128), c255(128), 0, 1],
  lime: [0, 1, 0, 1],
  teal: [0, c255(128), c255(128), 1],
  navy: [0, 0, c255(128), 1],
  purple: [c255(128), 0, c255(128), 1],
  orange: [1, c255(165), 0, 1],
  brown: [c255(165), c255(42), c255(42), 1],
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
  return Number.isFinite(v) ? clamp01(v) : NaN;
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
    const args = s
      .slice(open + 1, -1)
      .split(/[\s,/]+/)
      .filter(a => a.length > 0);
    if (args.length !== 3 && args.length !== 4) return null;
    const a = alphaOf(args[3]);
    if (fn === 'rgb' || fn === 'rgba') {
      const ch = (v: string): number => (v.endsWith('%') ? num(v.slice(0, -1)) / 100 : num(v) / 255);
      const r = ch(args[0]),
        gg = ch(args[1]),
        b = ch(args[2]);
      return Number.isFinite(r) && Number.isFinite(gg) && Number.isFinite(b) && Number.isFinite(a) ? [clamp01(r), clamp01(gg), clamp01(b), a] : null;
    }
    if (fn === 'hsl' || fn === 'hsla') {
      const pc = (v: string): number => num(v.endsWith('%') ? v.slice(0, -1) : v) / 100;
      const h = hueOf(args[0]),
        sat = clamp01(pc(args[1])),
        lig = clamp01(pc(args[2]));
      if (!Number.isFinite(h) || !Number.isFinite(sat) || !Number.isFinite(lig) || !Number.isFinite(a)) return null;
      const hh = (((h % 360) + 360) % 360) / 30;
      const f = (n: number): number => {
        const k = (n + hh) % 12;
        return lig - sat * Math.min(lig, 1 - lig) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      };
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
    } catch {
      normaliser = null;
    }
  }
  const n = normaliser;
  if (!n) return null;
  n.fillStyle = '#010203';
  n.fillStyle = s;
  const r = n.fillStyle;
  if (typeof r !== 'string') return null;
  if (r === '#010203') {
    n.fillStyle = '#030201';
    n.fillStyle = s;
    if (n.fillStyle === '#030201') return 'invalid';
  }
  return r;
}

export function canvasColor(css: string): Rgba | 'invalid' | null {
  const rgba = parseColor(css);
  if (rgba) return rgba;
  const normalized = normaliseColor(css);
  return normalized === 'invalid' || normalized === null ? normalized : parseColor(normalized);
}
