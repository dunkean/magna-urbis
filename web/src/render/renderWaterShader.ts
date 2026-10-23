/** Render style water compositor (TerrainGl, `render` only).
 *
 * Input: a screen-space coverage layer of the rivers and retained water bodies
 * (alpha = water). One full-screen pass turns it into painted water:
 * - depth from the distance to the bank (12 rays bracketing the bank on geometric
 *   rings, then bisecting it, softly minimized so channels get a rounded cross-section),
 *   on the style's water ramp like the sea and lakes;
 * - a lighter shallow shelf and a thin shoreline glint inside the bank of wide water;
 * - a soft damp shadow on the land just outside it;
 * - gentle world-anchored surface variation (static value noise).
 * Land pixels cost at most 24 taps; nothing is computed on the CPU per pixel. */
import { WATER_STYLE_GLSL } from './waterStyle';

export const RENDER_WATER_RINGS = 12;

export const RENDER_WATER_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uLayer;
uniform vec2 uCanvas, uOrigin;
uniform float uPx, uDpr, uBand, uBankPx;
uniform float uRings[${RENDER_WATER_RINGS}]; uniform int uRingCount;
${WATER_STYLE_GLSL}
out vec4 outColor;
float cover(vec2 f) { return textureLod(uLayer, clamp(f, vec2(.5), uCanvas - .5) / uCanvas, 0.).a; }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
const vec2 DIRS[8] = vec2[8](vec2(1, 0), vec2(.7071, .7071), vec2(0, 1), vec2(-.7071, .7071), vec2(-1, 0), vec2(-.7071, -.7071), vec2(0, -1), vec2(.7071, -.7071));
void main() {
  vec2 f = gl_FragCoord.xy;
  float a = cover(f);
  // Land side: how close the water is, over three rings within the bank width.
  float bank = 0.;
  if (a < .999) for (int k = 1; k <= 3; k++) {
    float r = uBankPx * float(k) / 3., m = 0.;
    for (int i = 0; i < 8; i++) m = max(m, cover(f + DIRS[i] * r));
    bank += m / 3.;
  }
  if (a <= .002 && bank <= .002) discard;
  // Water side: distance to the bank in device pixels. Each of 12 rays brackets the bank on
  // the geometric rings and bisects it; a soft minimum of the rays (temperature 0.3 × the
  // nearest) rounds the cross-section between two banks, so channels have no crease on
  // their axis, and it is continuous across lakes. Open water saturates past the band.
  float reach = uRings[uRingCount - 1], depth = reach, wide = 0.;
  if (a > .002) {
    float hits[12], best = 2. * reach;
    vec2 nearest = vec2(1, 0);
    for (int i = 0; i < 12; i++) {
      float turn = float(i) * .5235988;
      vec2 d = vec2(cos(turn), sin(turn));
      float previous = 0.;
      hits[i] = 1e6;
      for (int k = 0; k < ${RENDER_WATER_RINGS}; k++) {
        if (k >= uRingCount || previous >= 2.5 * best) break;
        float r = uRings[k];
        if (cover(f + d * r) < .5) {
          float lo = previous, hi = r;
          for (int j = 0; j < 4; j++) { float mid = .5 * (lo + hi); if (cover(f + d * mid) < .5) hi = mid; else lo = mid; }
          hits[i] = .5 * (lo + hi);
          if (hits[i] < best) { best = hits[i]; nearest = d; }
          break;
        }
        previous = r;
      }
    }
    float t = .3 * best + .25, sum = 0.;
    for (int i = 0; i < 12; i++) sum += exp(-(min(hits[i], 2. * reach) - best) / t);
    // A lone straight bank reads 0.755 × its distance: normalized back.
    depth = max(0., (best - t * log(sum)) / .755 + a - 1.);
    // Wide water: still water a few pixels away from the nearest bank.
    wide = cover(f - nearest * 5. * uDpr);
  }
  vec2 world = uOrigin + vec2(f.x, uCanvas.y - f.y) * uPx;
  // The style's depth ramp over the distance to the bank, as for the sea and lakes.
  vec3 color = styledWater(.85 * depth * uPx / uBand);
  // Shallow shelf: a lighter, greener teal over the first pixels.
  float shelf = 1. - smoothstep(0., 3. * uDpr, depth);
  color = mix(color, vec3(.16, .33, .32), shelf * .3 * wide);
  // Shoreline glint about one pixel inside the bank.
  float rim = smoothstep(.2 * uDpr, .9 * uDpr, depth) * (1. - smoothstep(1.2 * uDpr, 2.4 * uDpr, depth));
  color = mix(color, vec3(.40, .55, .52), rim * .18 * wide);
  // Gentle surface variation, finer octave only where it stays above a pixel.
  float fine = smoothstep(6., 2., uPx);
  float n = vnoise(world / 170.) * .6 + vnoise(world / 45. + 7.3) * .4 * fine + (1. - fine) * .2;
  color *= .9 + .2 * n;
  // Wet bank: soft dark shadow on the land side.
  vec3 bankColor = vec3(.055, .085, .045);
  float bankA = .55 * bank * bank;
  outColor = vec4(color * a + bankColor * bankA * (1. - a), a + bankA * (1. - a));
}`;

/** Ring radii in device pixels: geometric from 1 px to 1.5 depth bands (clamped): open
 * water reaches the end of the ramp before the rays run out. */
export function renderWaterRings(metresPerPixel: number, band: number): Float32Array {
  const max = Math.max(4, Math.min(256, 1.5 * band / Math.max(1e-6, metresPerPixel)));
  return Float32Array.from({ length: RENDER_WATER_RINGS }, (_, k) => max ** (k / (RENDER_WATER_RINGS - 1)));
}
