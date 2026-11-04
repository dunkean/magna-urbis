/** Minimum roof/ground contrast, a rule of the palette (not per culture): a roof colour too close to the map ground tone
 * is moved along OKLab lightness (away from the ground, keeping its hue and chroma) until the distance reaches MIN_ROOF_CONTRAST. */
export type Rgb01 = [number, number, number];
const lin = (v: number): number => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const gam = (v: number): number => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
export function toOklab(c: readonly number[]): [number, number, number] {
  const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function fromOklab(L: number, a: number, b: number): Rgb01 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return rgb.map(v => Math.max(0, Math.min(1, gam(Math.max(0, v))))) as Rgb01;
}
/** Perceptual distance (OKLab) between two sRGB colours in 0..1. */
export function colourDistance(a: readonly number[], b: readonly number[]): number {
  const p = toOklab(a), q = toOklab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
export const MIN_ROOF_CONTRAST = 0.13;
/** `roof` and `ground` are sRGB 0..1. Returns the roof unchanged when it already reads against the ground. */
export function roofAgainstGround(roof: Rgb01, ground: readonly number[], min = MIN_ROOF_CONTRAST): Rgb01 {
  if (colourDistance(roof, ground) >= min) return roof;
  const [L, a, b] = toOklab(roof), gL = toOklab(ground)[0];
  // Roofs are the darker mass on a light ground, the lighter one on a dark ground; fall back to the other side when out of gamut.
  const preferred = L <= gL ? -1 : 1;
  for (const dir of [preferred, -preferred]) {
    let best: Rgb01 | undefined;
    for (let k = 1; k <= 24; k++) {
      const cand = fromOklab(Math.max(0, Math.min(1, L + dir * k * 0.015)), a, b);
      if (colourDistance(cand, ground) >= min) { best = cand; break; }
    }
    if (best) return best;
  }
  return roof;
}
