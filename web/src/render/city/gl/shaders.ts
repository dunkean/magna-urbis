/**
 * GLSL of the GPU town: fills and outlines of the plan and building meshes (per-feature colour tables, parchment
 * hatching, roof grain mean, ruins), paved squares, stroke instances (streets, walls, enclosures) in four variants,
 * textured fills, tower discs, and the drawn water into the stencil. One cohesive unit: the sources and nothing else.
 * Compiled by renderer.ts.
 */
// walls hook (cityWalls.ts)

export const FILL_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in uint aFeature;
uniform vec4 uView;
uniform highp sampler2D uColors;
uniform vec4 uTint;
// Live roof pans (cityGlGrain.ts): the mean tone of the Canvas grain, uneven snow mantle and wall rims of each pan
// (uGrainTab: family, gain, snow strength, flags; uRimTab: rim colour), with the frame's grain strength and level means.
uniform int uRoofGrain, uRims;
uniform highp sampler2D uGrainTab, uRimTab;
uniform float uGrainStrength;
uniform vec2 uGrain[18];
uniform vec4 uSnowMean[2];
out vec4 vColor;
out vec2 vPos;
void main() {
  vPos = aPos;
  int f = int(aFeature);
  ivec2 q = ivec2(f & 4095, f >> 12);
  vColor = texelFetch(uColors, q, 0);
  bool shown = vColor.a > 0.0;
  if (uRoofGrain == 1 && shown) {
    vec4 g = floor(texelFetch(uGrainTab, q, 0) * 255.0 + 0.5);
    int flags = int(g.a);
    if (uRims == 1 && (flags & 2) != 0) vColor = vec4(texelFetch(uRimTab, q, 0).rgb, 1.0);
    else if (g.b > 0.0) {
      // Snow patch: the pan at 1 - u (none from .97), then the mantle tile at u x depth; one source-over equivalent.
      float u = uGrainStrength;
      if (u > 0.03) {
        vec4 m = (flags & 1) != 0 ? uSnowMean[1] : uSnowMean[0];
        float k = u * g.b / 255.0, a = k * m.a, fillA = u < 0.97 ? 1.0 - u : 0.0, outA = 1.0 - (1.0 - fillA) * (1.0 - a);
        vColor = vec4((vColor.rgb * fillA * (1.0 - a) + k * m.rgb) / max(outA, 1e-4), outA);
      }
    } else if (g.r > 0.0) {
      float s = uGrainStrength * g.g / 255.0;
      if (s > 0.03) { vec2 m = uGrain[int(g.r) - 1]; vColor.rgb = vColor.rgb * (1.0 - s * m.x) + s * m.y; }
    }
  }
  // A tint (painted building shadows) replaces the colour of every feature drawn.
  if (uTint.a > 0.0) vColor = uTint;
  gl_Position = shown ? vec4(aPos * uView.xy + uView.zw, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
export const FILL_FS = `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vPos;
uniform float uRuinSpacing;
// Parchment hatching (live look): lines along x + y = const every uHatch.x metres, uHatch.y metres wide, uHatch.z
// metres per device pixel for the edge; the table alpha (hatch strength per feature) times uHatch.w.
uniform vec4 uHatch;
uniform vec3 uHatchColor;
uniform float uLineAlpha;
out vec4 outColor;
void main() {
  if (uHatch.x > 0.0) {
    float d = abs(fract((vPos.x + vPos.y) / uHatch.x + 0.5) - 0.5) * uHatch.x * 0.70710678;
    float a = vColor.a * uHatch.w * clamp((0.5 * uHatch.y - d) / uHatch.z + 0.5, 0.0, 1.0);
    if (a <= 0.0) discard;
    outColor = vec4(uHatchColor * a, a);
    return;
  }
  // uLineAlpha (live look, outline passes): the coverage of the Canvas sub-pixel stroke over a 1-pixel GL line.
  float lineAlpha = uLineAlpha > 0.0 ? uLineAlpha : 1.0;
  vec3 color = vColor.rgb;
  if (uRuinSpacing > 0.0) {
    float stripe = abs(fract((vPos.x - vPos.y) / uRuinSpacing + 0.5) - 0.5);
    float hatch = 1.0 - smoothstep(0.04, 0.13, stripe);
    color = mix(color, vec3(0.275, 0.231, 0.176), hatch);
  }
  float alpha = vColor.a * lineAlpha;
  outColor = vec4(color * alpha, alpha);
}`;
/** Paved squares (render background, below 0.3 m/px): a second pass over the plan mesh in
 * which only the features whose alpha byte is 253 (cityGlStyle PAVED_ALPHA) survive the
 * vertex stage, so the sett pattern costs fragments on the squares alone. Rows of setts in
 * origin-relative metres, joints once a sett spans ~3 px, per-sett variation, broad wear. */
export const PAVED_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in uint aFeature;
uniform vec4 uView;
uniform highp sampler2D uColors;
out vec3 vColor; out vec2 vPos;
void main() {
  int f = int(aFeature);
  vec4 c = texelFetch(uColors, ivec2(f & 4095, f >> 12), 0);
  vColor = c.rgb; vPos = aPos;
  gl_Position = abs(c.a * 255.0 - 253.0) < 0.5 ? vec4(aPos * uView.xy + uView.zw, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
export const PAVED_FS = `#version 300 es
precision highp float;
in vec3 vColor; in vec2 vPos;
uniform float uMpp;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 g = vPos / vec2(0.9, 0.6); g.x += 0.5 * floor(g.y);
  vec2 fr = fract(g);
  float shown = smoothstep(2.0, 4.5, 0.6 / uMpp), sett = 0.0;
  if (shown > 0.0) {
    float joint = min(min(fr.x, 1.0 - fr.x) * 0.9, min(fr.y, 1.0 - fr.y) * 0.6) / uMpp;
    sett = shown * (0.09 * (1.0 - smoothstep(0.25, 1.0, joint)) - 0.1 * (hash(floor(g)) - 0.5));
  }
  // Broad wear: two crossed warped waves over ~10 m (worn paths, repairs), no texture fetch.
  float wear = 0.5 * sin(vPos.x * 0.61 + 1.7 * sin(vPos.y * 0.37)) * sin(vPos.y * 0.53 + 1.3 * sin(vPos.x * 0.29));
  outColor = vec4(vColor * (1.0 - sett + 0.08 * wear), 1.0);
}`;
/** Segment instance → quad around the capsule; meta bits: 0-3 rank, 4 crossing,
 * 5/6 butt start/end, 7 dashed, 8 solid edge (bridges, quays). */
export const STROKE_VS = `#version 300 es
layout(location = 0) in vec4 aSeg;
layout(location = 1) in vec3 aShape;
layout(location = 2) in uvec2 aIds;
uniform vec4 uView;
uniform float uMpp, uDevPx, uEdgePx, uInnerScale, uMinPxScale;
uniform int uPass, uMaxRank, uCrossings;
uniform vec4 uOverride;
uniform highp sampler2D uColors;
#if VARIANT == 3
uniform highp sampler2D uMats;
out vec2 vWorld; flat out vec2 vMat;
#endif
out vec4 vColor; out vec2 vLocal; out float vAlong;
flat out float vLen; flat out float vHw; flat out uint vMeta; flat out float vFoot; flat out float vBase;
void main() {
  uint meta = aIds.y;
  int f = int(aIds.x), rank = int(meta & 15u);
  vColor = uOverride.a > 0.0 ? uOverride : texelFetch(uColors, ivec2(f & 4095, f >> 12), 0);
  float hw = 0.5 * max(aShape.x, aShape.y * uMinPxScale * uMpp);
  // Painted streets of 7 m and more: flagstone footways behind a kerb, drawn by the casing
  // pass (under every carriageway) so that junctions and bends stay one clean union; the
  // carriageway pass is narrowed by the footway. Shown once a footway spans 1.5 px.
#if VARIANT > 0
  float foot = rank <= 2 && (meta & 16u) == 0u && hw >= 3.5 ? clamp(0.22 * hw, 0.9, 2.0) : 0.0;
  if (foot < 1.5 * uMpp) foot = 0.0;
#else
  float foot = 0.0;
#endif
  vFoot = foot; vBase = hw;
  if (uPass == 0) hw += (meta & 256u) != 0u && uEdgePx > 0.0 ? max(1.2, 1.4 * uMpp) : uEdgePx * uMpp;
  else hw = (hw - foot) * uInnerScale;
  bool visible = vColor.a > 0.0 && (rank <= uMaxRank || ((meta & 16u) != 0u && uCrossings == 1));
  vec2 a = aSeg.xy, d = aSeg.zw - aSeg.xy;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0), n = vec2(-dir.y, dir.x);
  float pad = hw + uDevPx;
  float s0 = (meta & 32u) != 0u ? -uDevPx : -pad, s1 = (meta & 64u) != 0u ? len + uDevPx : len + pad;
  float s = mix(s0, s1, float(gl_VertexID & 1)), t = mix(-pad, pad, float(gl_VertexID >> 1));
  vLocal = vec2(s, t); vLen = len; vHw = hw; vMeta = meta; vAlong = aShape.z + s;
#if VARIANT == 3
  vWorld = a + dir * s + n * t;
  vec4 m = texelFetch(uMats, ivec2(f & 4095, f >> 12), 0) * 255.0;
  vMat = vec2(m.r - 1.0, m.g);
#endif
  gl_Position = visible ? vec4((a + dir * s + n * t) * uView.xy + uView.zw, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
/** Stroke shaders come in three variants (VARIANT, see strokeVariant): 0 = plain strokes
 * (walls, selection, unpainted palettes), 1 = painted street casing with footways,
 * 2 = painted street surface (setts, earth, gutters, verges, kerbs). Each pass then runs
 * only its own code: SwiftShader pays for every masked-off branch of a shared shader. */
export const STROKE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 vColor; in vec2 vLocal; in float vAlong;
flat in float vLen; flat in float vHw; flat in uint vMeta; flat in float vFoot; flat in float vBase;
#if VARIANT == 3
in vec2 vWorld; flat in vec2 vMat;
uniform highp sampler2DArray uAlbedo;
uniform float uExt[32];
#endif
uniform float uMpp, uDevPx, uFade;
uniform int uPass, uDashKind, uBridgeDeck, uSingle;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float s = vLocal.x, t = abs(vLocal.y), d;
  vec3 color = vColor.rgb;
  float cover = 1.0;
  // Painted streets (render background), in street-local metres (along, across):
  // a warmer stone tone, setts on the main streets (joints only once a sett is >= 3 px),
  // packed earth with two ruts on lanes, and worn, slightly irregular edges.
#if VARIANT == 2
  if ((vMeta & 16u) == 0u) {
    float u = t / max(vHw, 1e-3), rank = float(vMeta & 15u);
    float footway = 0.0;
    vec2 p = vec2(vAlong, vLocal.y);
    color = mix(color, vec3(0.80, 0.70, 0.52), 0.35);
    if (rank <= 2.0) {
      vec2 g = p / vec2(1.25, 0.9); g.x += 0.5 * floor(g.y);
      vec2 fr = fract(g);
      float joint = min(min(fr.x, 1.0 - fr.x) * 1.25, min(fr.y, 1.0 - fr.y) * 0.9) / uMpp;
      float shown = smoothstep(2.5, 5.0, 0.9 / uMpp);
      color *= 1.0 - shown * (0.17 * (1.0 - smoothstep(0.3, 1.1, joint)) - 0.1 * (hash(floor(g)) - 0.5) - 0.06 * (vnoise(p / 3.1) - 0.5));
      color *= 1.04 - 0.08 * u * u;
      // Streets without footways: a central gutter once the street is a few pixels wide.
      if (vFoot <= 0.0 && vHw > 5.0 * uMpp) { float g = t / max(0.3, 0.8 * uMpp); color *= 1.0 - 0.14 * smoothstep(5.0, 9.0, vHw / uMpp) * exp(-g * g); }
      footway = vFoot;
    } else {
      color = mix(color, vec3(0.66, 0.54, 0.38), 0.4);
      float rut = exp(-pow((u - 0.45) / 0.13, 2.0)) * smoothstep(1.5, 4.0, vHw / uMpp);
      float grain = vnoise(p / 1.7);
      color *= (1.0 - 0.15 * rut) * (0.93 + 0.12 * grain);
      // Grassy verges along earth lanes once the lane is a few pixels wide.
      float verge = smoothstep(0.78, 0.98, u + 0.12 * (grain - 0.5)) * smoothstep(2.0, 4.0, vHw / uMpp);
      color = mix(color, vec3(0.56, 0.56, 0.37), 0.45 * verge);
    }
    // Footways: only their outer tenth wears into the casing (flagstone kerb band) beneath.
    float wear = smoothstep(footway > 0.0 ? 0.9 : 0.72, 1.0, u + 0.1 * (vnoise(vec2(vAlong * 0.7, vLocal.y > 0.0 ? 3.0 : 9.0)) - 0.5));
    // Worn edges let the casing (drawn under every street) show through; where another street
    // passes below, its own surface shows instead, so junctions stay clean.
    cover = 1.0 - 0.5 * wear;
  }
#endif
  // Textured streets: the road layer of the street's role sampled in world metres (planks follow the street),
  // darkened toward the edge so the casing stays readable. Sampled outside any branch (derivatives).
#if VARIANT == 3
  {
    float ext = uExt[int(max(vMat.x, 0.0))];
    vec2 p = vMat.y > 0.5 ? vec2(vAlong, vLocal.y) : vWorld;
    vec3 tex = texture(uAlbedo, vec3(p / ext, max(vMat.x, 0.0))).rgb;
    if ((vMeta & 16u) == 0u && vMat.x >= 0.0) color = tex * (1.0 - 0.3 * smoothstep(0.8, 1.0, t / max(vHw, 1e-3)));
  }
#endif
  // Stone deck (render background): light parapets, a dark kerb line inside them, a deck a
  // shade darker with transverse joints once they are at least 3 px apart.
#if VARIANT != 1
  if (uBridgeDeck == 1 && uPass == 1 && (vMeta & 400u) == 272u) {
    float parapet = max(0.9, 1.3 * uMpp), kerb = max(0.3, 0.7 * uMpp), joint = max(1.6, 3.0 * uMpp);
    float edge = vHw - t;
    color = edge < parapet ? mix(color, vec3(0.93, 0.89, 0.80), 0.35)
      : edge < parapet + kerb ? color * 0.42
      : color * (mod(vAlong, joint) < max(0.25, 0.8 * uMpp) ? 0.7 : 0.84);
  }
#endif
  // Footways (casing pass, under every street): flagstones with transverse joints inside the
  // street's edge, the casing colour beyond it; the narrowed carriageways (pass 1) cover
  // them, so footways are one union through bends and junctions. The kerb is a radial band at
  // the footway's inner edge (caps included): the carriageways cover it where streets meet,
  // so it stays continuous through bends and opens at junctions.
#if VARIANT == 1
  if (vFoot > 0.0) {
    float r = s < 0.0 ? length(vec2(s, t)) : s > vLen ? length(vec2(s - vLen, t)) : t;
    vec3 flag = vec3(0.85, 0.79, 0.67) * (mod(vAlong, 1.3) < max(0.1, 0.6 * uMpp) ? 0.9 : 1.0);
    float inner = vBase - vFoot;
    if (r < vBase) color = r < inner + min(max(0.25, 0.9 * uMpp), 0.5 * vFoot) ? flag * 0.6 : flag;
  }
#endif
  if (s < 0.0) d = (vMeta & 32u) != 0u ? max(t - vHw, -s) : length(vec2(s, t)) - vHw;
  else if (s > vLen) d = (vMeta & 64u) != 0u ? max(t - vHw, s - vLen) : length(vec2(s - vLen, t)) - vHw;
  else d = t - vHw;
  float a = clamp(0.5 - d / uDevPx, 0.0, 1.0);
  if (uPass == 0 && (vMeta & 128u) != 0u) {
    float on = uDashKind == 2 ? max(1.3, 2.0 * uMpp) : 4.0 * uMpp, off = uDashKind == 2 ? max(0.5, uMpp) : 2.0 * uMpp;
    if (mod(vAlong, on + off) > on) a = 0.0;
  }
  // Single coverage (translucent streets under a stencil): a fragment claims its samples
  // whole, so overlapping segments of one class never blend twice; MSAA smooths the edge.
  if (uSingle == 1) a = a < 0.5 ? 0.0 : 1.0;
  if (a <= 0.0) discard;
  outColor = vec4(color, 1.0) * (vColor.a * a * cover * uFade);
}`;
/** Textured fills (roof pans, plazas): the albedo array sampled in world metres, rotated by the feature's
 * angle (roofs: u along the ridge, v down the slope), times its brightness. uOnly = 1 keeps only the features
 * that have a material (plazas over the flat plan fill); uOnly = 0 draws every feature, flat colour where none. */
export const TFILL_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in uint aFeature;
uniform vec4 uView;
uniform highp sampler2D uColors, uMats;
uniform float uExt[32], uMean[32];
uniform int uOnly;
out vec4 vColor; out vec2 vUv; flat out float vLayer; flat out float vBright; flat out float vMean; flat out float vRoof;
void main() {
  int f = int(aFeature);
  ivec2 q = ivec2(f & 4095, f >> 12);
  vColor = texelFetch(uColors, q, 0);
  vec4 m = texelFetch(uMats, q, 0) * 255.0;
  float layer = m.r - 1.0, ang = m.g / 255.0 * 6.2831853;
  vec2 dir = vec2(cos(ang), sin(ang)), p = aPos / uExt[int(max(layer, 0.0))];
  vUv = vec2(dot(p, vec2(-dir.y, dir.x)), dot(p, dir)); vLayer = layer; vBright = m.b / 128.0; vMean = uMean[int(max(layer, 0.0))]; vRoof = m.a;
  bool shown = vColor.a > 0.0 && (uOnly == 0 || layer >= 0.0);
  gl_Position = shown ? vec4(aPos * uView.xy + uView.zw, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
export const TFILL_FS = `#version 300 es
precision highp float;
in vec4 vColor; in vec2 vUv; flat in float vLayer; flat in float vBright; flat in float vMean; flat in float vRoof;
uniform highp sampler2DArray uAlbedo;
out vec4 outColor;
void main() {
  vec3 tex = texture(uAlbedo, vec3(vUv, max(vLayer, 0.0))).rgb * vBright;
  // Recenter roof grain around its mean; soft light preserves the culture tint.
  float grain = clamp((dot(tex, vec3(0.3, 0.59, 0.11)) / max(vMean, 0.02) - 1.0) * 0.35 + 0.5, 0.0, 1.0);
  vec3 base = vColor.rgb, curve = mix(((16.0 * base - 12.0) * base + 4.0) * base, sqrt(base), step(vec3(0.25), base));
  vec3 roof = grain <= 0.5 ? base - (1.0 - 2.0 * grain) * base * (1.0 - base) : base + (2.0 * grain - 1.0) * (curve - base);
  vec3 c = vLayer < 0.0 ? base : vRoof > 0.0 ? roof : min(tex, vec3(1.0));
  outColor = vec4(c * vColor.a, vColor.a);
}`;
export const DISC_VS = `#version 300 es
layout(location = 0) in vec2 aCenter;
uniform vec4 uView;
uniform float uRadius, uDevPx;
out vec2 vLocal;
void main() {
  vLocal = vec2(float(gl_VertexID & 1) * 2.0 - 1.0, float(gl_VertexID >> 1) * 2.0 - 1.0) * (uRadius + uDevPx);
  gl_Position = vec4((aCenter + vLocal) * uView.xy + uView.zw, 0.0, 1.0);
}`;
export const DISC_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
uniform float uRadius, uDevPx, uStroke;
uniform vec4 uFill, uEdge;
out vec4 outColor;
void main() {
  float d = length(vLocal) - uRadius, a = clamp(0.5 - d / uDevPx, 0.0, 1.0);
  if (a <= 0.0) discard;
  vec4 c = mix(uEdge, uFill, clamp(0.5 - (d + uStroke) / uDevPx, 0.0, 1.0));
  outColor = vec4(c.rgb, 1.0) * (c.a * a);
}`;

// Drawn river capsules into the stencil (bit 0x80): the town ground and streets are not drawn on them.
export const WATER_VS = `#version 300 es
layout(location = 0) in vec4 aSeg;
layout(location = 1) in vec2 aWidth;
uniform vec4 uView;
uniform vec2 uOrigin;
out vec2 vP;
flat out vec4 vSeg;
flat out vec2 vHalf;
void main() {
  vec2 a = aSeg.xy - uOrigin, b = aSeg.zw - uOrigin, d = b - a;
  float l = length(d);
  vec2 dir = l > 1e-6 ? d / l : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  vec2 half_ = aWidth * 0.5;
  float r = max(half_.x, half_.y) + 0.5;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 p = mix(a - dir * r, b + dir * r, corner.x) + nrm * r * (corner.y * 2.0 - 1.0);
  vP = p; vSeg = vec4(a, b); vHalf = half_;
  gl_Position = vec4(p * uView.xy + uView.zw, 0.0, 1.0);
}`;
export const WATER_FS = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vSeg;
flat in vec2 vHalf;
out vec4 outColor;
void main() {
  vec2 pa = vP - vSeg.xy, ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  if (length(pa - ba * h) > mix(vHalf.x, vHalf.y, h)) discard;
  outColor = vec4(0.0);
}`;
/** Stencil bit of the drawn water (cityGl draw: ground and streets kept off it). */
export const WATER_BIT = 0x80;
export const strokeVariant = (source: string, variant: 0 | 1 | 2 | 3): string => source.replace(/^#version 300 es\n/, `#version 300 es\n#define VARIANT ${variant}\n`);
