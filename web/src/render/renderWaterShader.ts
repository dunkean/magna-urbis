/** Render style water compositor (TerrainGl, `render` only).
 *
 * Input: a screen-space coverage layer of the rivers and retained water bodies
 * (alpha = water). One full-screen pass turns it into painted water:
 * - depth from the distance to the bank (12 rays bracketing the bank on geometric
 *   rings, then bisecting it, softly minimized so channels get a rounded cross-section),
 *   on the style's water ramp like the sea and lakes;
 * - a lighter shallow shelf and a thin shoreline glint inside the bank of wide water;
 * - a soft damp shadow on the land just outside it;
 * - gentle world-anchored surface variation (static value noise);
 * - the climate's fresh-water tone over it (waterPalette.ts);
 * - with uRegime, the seasonal regime carried by the river colour (waterRegime.ts regimeRgb):
 *   exposed alluvium, broken riffles on steep open water, and ice with a darker edge line;
 *   uRegime 2 (City Bench retained banks, city zoom) fades the damp bank shadow on a dry bed.
 * Land pixels cost at most 24 taps; nothing is computed on the CPU per pixel. */
import { FRESH_WATER_GLSL } from './waterPalette';
import { WATER_STYLE_GLSL, WATER_SURFACE_GLSL } from './waterStyle';
import { WATER_REGIME_GLSL } from './waterRegime';
import { RIVER_NOISE_GLSL } from './riverSurface';

export const RENDER_WATER_RINGS = 12;

export const RENDER_WATER_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uLayer;
uniform vec2 uCanvas, uOrigin;
uniform float uPx, uDpr, uBand, uBankPx;
uniform float uRings[${RENDER_WATER_RINGS}]; uniform int uRingCount;
uniform int uRegime;
${WATER_STYLE_GLSL}
${WATER_SURFACE_GLSL}
${FRESH_WATER_GLSL}
${WATER_REGIME_GLSL}
${RIVER_NOISE_GLSL}
out vec4 outColor;
vec4 tap(vec2 f) { return textureLod(uLayer, clamp(f, vec2(.5), uCanvas - .5) / uCanvas, 0.); }
float cover(vec2 f) { return tap(f).a; }
const vec2 DIRS[8] = vec2[8](vec2(1, 0), vec2(.7071, .7071), vec2(0, 1), vec2(-.7071, .7071), vec2(-1, 0), vec2(-.7071, -.7071), vec2(0, -1), vec2(.7071, -.7071));
void main() {
  vec2 f = gl_FragCoord.xy;
  vec4 own = tap(f);
  float a = own.a;
  vec2 world = uOrigin + vec2(f.x, uCanvas.y - f.y) * uPx;
  // Land side: how close the water is, over three rings within the bank width.
  float bank = 0.;
  vec4 near = vec4(0.);
  float margin=uBankPx;
  if(a<.999)margin*=mix(.3,1.25,riverNoise(world/43.));
  if (a < .999) for (int k = 1; k <= 3; k++) {
    float r = margin * float(k) / 3., m = 0.;
    for (int i = 0; i < 8; i++) { vec4 t = tap(f + DIRS[i] * r); if (t.a > m) { m = t.a; if (k == 1) near = t; } }
    bank += m / 3.;
  }
  if (a <= .002 && bank <= .002) discard;
  // Water side: distance to the bank in device pixels. Each of 12 rays brackets the bank on
  // the geometric rings and bisects it; a soft minimum of the rays (temperature 0.3 × the
  // nearest) rounds the cross-section between two banks, so channels have no crease on
  // their axis, and it is continuous across lakes. Open water saturates past the band.
  float reach = uRings[uRingCount - 1], depth = reach, wide = 0.;
  vec2 nearest = vec2(0.);
  bool capsule = uRegime >= 3;
  // Open vector water has an analytic cross-section. Only raster water and shore ice
  // need to search the image for a bank. A tile border never sets a running river's depth.
  if (a > .002 && (!capsule || (uRegime!=4 && own.g < .95*a))) {
    float hits[12], best = 2. * reach;
    nearest = vec2(1, 0);
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
    if(uRegime==0)wide = cover(f - nearest * 5. * uDpr);
  }
  // The style's depth ramp over the distance to the bank, as for the sea and lakes.
  vec3 color = styledWater(capsule ? 0. : .85 * depth * uPx / uBand);
  // Shallow shelf: a lighter, greener teal over the first pixels.
  float shelf = 1. - smoothstep(0., 3. * uDpr, depth);
  // Shoreline glint about one pixel inside the bank.
  float rim = smoothstep(.2 * uDpr, .9 * uDpr, depth) * (1. - smoothstep(1.2 * uDpr, 2.4 * uDpr, depth));
  // Wet bank: soft dark shadow on the land side.
  vec3 bankColor = vec3(.055, .085, .045);
  float bankA = .55 * bank * bank;
  if (uRegime >= 1) {
    // Decoded back to dry and ice (regimeRgb stores running and open water so MAX keeps them on overlaps).
    vec3 regime = clamp(own.rgb / max(own.a, 1e-3), 0., 1.); regime.rg = 1. - regime.rg;
    if(uRegime==4)regime.g=0.; // The ground computes satellite ice from its seasonal snow.
    // Flow direction in the world (y down): along the bank, perpendicular to the nearest bank.
    vec2 bankDir = vec2(nearest.x, -nearest.y), along = vec2(-bankDir.y, bankDir.x);
    // Centre of the channel: 0 at the bank, 1 a few pixels in (hairline streams stay near 0.3).
    float centre = smoothstep(.2 * uDpr, 2.5 * uDpr, depth);
    float dryOn = smoothstep(0., .1, regime.r);
    float pools = mix(1., waterDryPools(world, regime.r, centre), dryOn);
    float deep = capsule ? min(1.,regime.b/.30) : smoothstep(1.,22.,depth*uPx);
    color = freshWaterTone(color*(1.02-.15*deep));
    if(capsule)color=mix(color,vec3(.63,.74,.75),.34*max(0.,(regime.b-.30)/.70));
    // Satellite open water carries the bed transmission through the blue stop.
    // Keep the existing red-minus-blue sediment discriminator for exposed ground.
    if(uRegime==4) {
      float foam=max(0.,(regime.b-.30)/.70);
      // The winter palette can have a pale red channel. Supply the complete
      // wet-water marker so it always decodes as water beneath seasonal ice.
      vec3 opticalWater=vec3(.10,.30+.28*foam,.255+.26*(1.-deep));
      color=mix(color,opticalWater,1.-regime.r);
    }
    if(pools<1.) {
      // Bend and rotate the sediment fields. Gravel lenses overlap at different
      // scales so individual lattice cells never form squares across a broad bar.
      vec2 q=vec2(dot(world,vec2(.83,.56)),dot(world,vec2(-.56,.83)));
      float bend=riverNoise(world/38.);
      float wash=riverNoise(q/53.+vec2(1.7,-.8)*bend);
      float lens=riverNoise(vec2(q.x/21.,q.y/9.)+vec2(-2.3,1.6)*wash);
      float fine=(riverNoise(world/2.1+vec2(1.8,-2.4)*lens)-.5)*(1.-smoothstep(.45,1.8,uPx));
      float deposits=smoothstep(.19,.85,.65*wash+.35*lens);
      float scour=capsule?deep:centre*(1.-deposits);
      if(capsule && regime.r>.998) pools=max(pools,.65*smoothstep(.67,.99,deep));
      vec3 gravel=mix(uWaterBed,vec3(.66,.63,.56),.50);
      vec3 bed=mix(gravel,uWaterBed*1.07,deposits*(1.-.45*scour))*mix(1.,.47,scour)
              +vec3(.055*(wash-.5)+.048*fine);
      if(capsule && uPx<2.){
        // Gravel accumulates on raised bars. A jittered clast and its own lit face share a
        // cell, with a bare-sand margin between cells; unresolved grains average away.
        vec2 g=q/1.1+vec2(.48*lens,.38*wash);
        ivec2 cell=ivec2(floor(g));
        vec2 jitter=vec2(riverCorner(cell),riverCorner(cell+ivec2(13,37)));
        vec2 stone=(fract(g)-(.30+.40*jitter))/vec2(.19,.13);
        float r=length(stone),aa=max(.09,6.*uPx);
        float pebble=(1.-smoothstep(.72-aa,1.+aa,r))*(1.-smoothstep(.14,.62,uPx));
        float shoal=(1.-smoothstep(.12,.56,scour))*smoothstep(.23,.71,lens+.45*(wash-.5));
        float shingle=riverNoise(world/1.7+vec2(1.3,-.7)*wash);
        float bench=shoal*(1.-smoothstep(.9,2.,uPx));
        bed=mix(bed,vec3(.73,.68,.58),.58*bench);
        bed+=bench*(.15*(shingle-.5)+pebble*(.21*jitter.x-.12*stone.y-.08*stone.x));
        bed*=1.-(.13+.13*wash)*smoothstep(.12,.56,scour)*(1.-smoothstep(1.,2.,uPx));
      }
      // The satellite decodes exposed sediment by red minus blue before toning.
      bed.b=min(bed.b,bed.r-.155);
      color=mix(bed,color,pools);
    }
    // Ice follows the bed: shore ice grows from both banks (up to 40 m) and closes the whole course when frozen,
    // so a thaw leaves a dark open thread down the fast centre. Hairline streams freeze first. Dark bank line on both sides.
    float shelf = 40. * regime.g;
    // Open water never evaluates the shelf: smoothstep(0, 0, 0) is undefined and drew a dark seam along the banks.
    float frozen = regime.g >= .97 ? 1. : regime.g < .05 ? 0. : 1. - smoothstep(.8 * shelf, shelf, depth * uPx);
    if (frozen > 0.) color = mix(color, waterIceColor(world, 1. - smoothstep(.6 * uDpr, 2.2 * uDpr, depth), 0., along), frozen);
    // Land side: a dry bed has pale bars, not a dark wet bank; ice keeps a faint one.
    vec3 neighbour = 1. - clamp(near.rgb / max(near.a, 1e-3), 0., 1.);
    if(uRegime==4)neighbour.g=0.;
    bankColor = mix(bankColor, uWaterBed, smoothstep(.3, .8, neighbour.r));
    bankA *= 1. - (uRegime == 2 ? smoothstep(.3, .8, neighbour.r) : .6 * smoothstep(.3, .8, max(neighbour.r, neighbour.g)));
  } else color = freshWaterTone(waterSurfaceShade(color, world, uPx, shelf, rim, wide));
  outColor = vec4(color * a + bankColor * bankA * (1. - a), a + bankA * (1. - a));
}`;

/** Ring radii in device pixels: geometric from 1 px to 1.5 depth bands (clamped): open
 * water reaches the end of the ramp before the rays run out. */
export function renderWaterRings(metresPerPixel: number, band: number): Float32Array {
  const max = Math.max(4, Math.min(256, (1.5 * band) / Math.max(1e-6, metresPerPixel)));
  return Float32Array.from({ length: RENDER_WATER_RINGS }, (_, k) => max ** (k / (RENDER_WATER_RINGS - 1)));
}
