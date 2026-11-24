/**
 * GLSL of the terrain of the world view (contract.ts), linked by terrainMesh.ts.
 *
 * The vertex shader places one square of the map (an instance of the grid mesh): it moves the odd vertices onto the
 * grid of the level above with the distance (patches.ts explains why that leaves no crack), evaluates the cubic
 * B-spline of the height grid and its slope from the sixteen control points around the vertex (the surface of
 * heights.ts, the one the 2D ground shades), adds the ground the towns shape (groundShape.ts), and projects. Positions are sums of whole cells times the cell size plus
 * one offset common to the frame, so two squares compute the very same bits for a vertex they share.
 *
 * The fragment shader shows the baked ground tile of the square, then the tile of the map drape over it (mapDrape.ts:
 * water, cartography, town plan; premultiplied, transparent where the ground shows). The tiles carry the map's own
 * relief shading, lit from above; a tilted view adds a slope light that is zero on flat ground and scaled by the rise
 * of the relief, and haze with the distance, so the top view is the tiles unchanged.
 *
 * In the Underdark (cave.ts, uCave) there is no sky: steep rock is a wall of dark columnar stone, the ground takes a
 * dim ambient and the warm light of the lanterns of the towns and of the nearest isolated buildings, and the far cave dissolves into darkness instead of the haze.
 */
import { GROUND_LAMPS } from './cave';
import { GROUND_SHAPE_GLSL } from './groundShapeTexture';
import { LATTICE } from './patches';

export const TERRAIN_VS = `#version 300 es
precision highp float; precision highp sampler2D;
layout(location=0) in vec2 aLattice;
// Origin of the square in cells of its level from the anchor of the frame, cell size (m), tile layer.
layout(location=1) in vec4 aSquare;
// The square inside its tile: origin and side in texture coordinates.
layout(location=2) in vec3 aTile;
// The square inside its tile of the map drape: origin, side, layer (negative: no drape tile).
layout(location=3) in vec4 aDrape;
uniform mat4 uProjection;
// Anchor of the cell grids, relative to the target (m).
uniform vec2 uAnchor;
// Target: map x, y and height as drawn. Positions are relative to it.
uniform vec3 uTarget;
// Eye relative to the target.
uniform vec3 uEye;
// Range of a level over its cell size, share of the range where the morph starts, height of the eye for the level distance.
uniform vec3 uLevel;
// Height grid: cells per metre, cells per side, lowest height drawn (m), metres drawn per metre of height.
uniform vec4 uGrid;
uniform sampler2D uHeights;
${GROUND_SHAPE_GLSL}
out vec3 vUv; out vec3 vDrapeUv; out vec2 vSlope; out float vDistance; out vec3 vWorld;
const float CELLS = ${LATTICE}.0;
vec4 weights(float t) { float t2 = t * t, t3 = t2 * t, s = 1.0 - t; return vec4(s * s * s, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0; }
vec4 slopes(float t) { float t2 = t * t, s = 1.0 - t; return vec4(-s * s, 3.0 * t2 - 4.0 * t, -3.0 * t2 + 2.0 * t + 1.0, t2) * 0.5; }
void main() {
  float cell = aSquare.z, range = uLevel.x * cell;
  vec2 unmoved = (aSquare.xy + aLattice) * cell + uAnchor;
  float morph = clamp((length(vec3(unmoved - uEye.xy, uLevel.z)) - uLevel.y * range) / ((1.0 - uLevel.y) * range), 0.0, 1.0);
  vec2 lattice = aLattice - fract(aLattice * 0.5) * 2.0 * morph;
  vec2 place = (aSquare.xy + lattice) * cell + uAnchor;
  vec2 g = clamp((uTarget.xy + place) * uGrid.x, vec2(0.0), vec2(uGrid.y)) - 0.5;
  vec2 b = floor(g), t = g - b;
  ivec2 first = ivec2(b) - 1, last = ivec2(int(uGrid.y) - 1);
  vec4 wx = weights(t.x), wy = weights(t.y), sx = slopes(t.x), sy = slopes(t.y);
  float height = 0.0; vec2 slope = vec2(0.0);
  for (int j = 0; j < 4; j++) {
    float row = 0.0, rowSlope = 0.0;
    for (int i = 0; i < 4; i++) {
      float control = texelFetch(uHeights, clamp(first + ivec2(i, j), ivec2(0), last), 0).r;
      row += control * wx[i]; rowSlope += control * sx[i];
    }
    height += row * wy[j]; slope += vec2(rowSlope * wy[j], row * sy[j]);
  }
  slope *= uGrid.x;
  if (height < uGrid.z) { height = uGrid.z; slope = vec2(0.0); }
  if (uShapeSide > 0) {
    vec2 at = uTarget.xy + place;
    if (shapeLayer(at) >= 0) {
      height += shapeMove(at);
      slope += 0.5 * vec2(shapeMove(at + vec2(1.0, 0.0)) - shapeMove(at - vec2(1.0, 0.0)), shapeMove(at + vec2(0.0, 1.0)) - shapeMove(at - vec2(0.0, 1.0)));
    }
  }
  vec3 position = vec3(place, height * uGrid.w - uTarget.z);
  gl_Position = uProjection * vec4(position, 1.0);
  vUv = vec3(aTile.xy + lattice / CELLS * aTile.z, aSquare.w);
  vDrapeUv = vec3(aDrape.xy + lattice / CELLS * aDrape.z, aDrape.w);
  vSlope = slope * uGrid.w;
  vDistance = length(position - uEye);
  vWorld = vec3(uTarget.xy + place, height * uGrid.w);
}`;

export const TERRAIN_FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray uTiles;
uniform sampler2DArray uDrape;
// Direction of the slope light (x east, y south, z up).
uniform vec3 uLight;
// Strength of the slope light, distance of the haze (m), share of the haze.
uniform vec3 uAir;
uniform vec3 uHaze;
// Underdark: share of the cave's light (0: none, the rise of the relief otherwise), fog start and end (m), darkness.
uniform vec4 uCave;
// Lanterns of the towns and of the nearest isolated buildings: map x, y and radius (m).
uniform vec4 uCaveLamps[${GROUND_LAMPS}]; uniform int uCaveLampCount;
in vec3 vUv; in vec3 vDrapeUv; in vec2 vSlope; in float vDistance; in vec3 vWorld;
out vec4 outColor;
float caveHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float caveNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(caveHash(i), caveHash(i + vec2(1.0, 0.0)), f.x), mix(caveHash(i + vec2(0.0, 1.0)), caveHash(i + vec2(1.0, 1.0)), f.x), f.y); }
// The ground in the cave's own light (the 3D ground's cavernSection, without its texels): columnar stone on the
// walls, read along the wall and its height; a dim ambient; the lanterns as point lights above their town.
vec3 caveGround(vec3 rgb, vec3 normal) {
  float dark = uCave.w, steep = smoothstep(0.35, 0.75, 1.0 - normal.z);
  if (steep > 0.0) {
    float px = max(length(dFdx(vWorld)), length(dFdy(vWorld)));
    vec2 across = length(normal.xy) > 1e-3 ? normalize(vec2(-normal.y, normal.x)) : vec2(1.0, 0.0);
    float t = dot(vWorld.xy, across), y = vWorld.z;
    float u = t / 2.1 + 0.45 * caveNoise(vec2(t * 0.07, y * 0.03)), column = floor(u), fu = fract(u);
    float joint = 1.0 - smoothstep(0.0, 0.09 + 0.5 * px / 2.1, min(fu, 1.0 - fu));
    float resolved = clamp(2.1 / px * 0.6 - 0.4, 0.0, 1.0);
    vec3 stone = vec3(0.12, 0.125, 0.14) * (0.8 + 0.4 * caveHash(vec2(column, 31.0))) * (0.75 + 0.5 * caveNoise(vec2(t, y * 1.4) * 0.35)) * (1.0 - 0.3 * resolved * joint);
    rgb = mix(rgb, stone, steep);
  }
  // Walls keep an ambient floor: a rock mass is never a flat black silhouette.
  float ambient = max(mix(1.15, 0.8, dark), 0.42 * steep + 0.2);
  vec3 lamps = vec3(0.0);
  for (int k = 0; k < ${GROUND_LAMPS}; k++) {
    if (k >= uCaveLampCount) break;
    vec4 g = uCaveLamps[k]; vec2 d = g.xy - vWorld.xy; float r = max(g.z, 1.0), fall = exp(-dot(d, d) / (r * r) * 0.45);
    if (fall < 0.003) continue;
    float facing = max(dot(normal, normalize(vec3(d, 25.0 + 0.15 * r))), 0.0);
    lamps += vec3(1.0, 0.8, 0.6) * fall * (0.3 + 0.8 * facing + 0.6 * steep * pow(facing, 12.0));
  }
  return rgb * (vec3(0.92, 0.97, 1.05) * ambient + lamps * mix(0.45, 0.9, dark));
}
void main() {
  // Ground seen at a low angle is squeezed along the screen's vertical, and a tile minified there shimmers: four
  // samples along that axis, spread by what the squeeze exceeds the other axis by. Unsqueezed, they are one sample.
  vec2 along = dFdy(vUv.xy);
  float squeeze = length(along) / max(length(dFdx(vUv.xy)), 1e-9);
  float excess = max(0.0, 1.0 - 1.0 / max(squeeze, 1e-9));
  vec2 spread = along * excess;
  vec3 rgb = 0.25 * (texture(uTiles, vec3(vUv.xy - 0.375 * spread, vUv.z)).rgb + texture(uTiles, vec3(vUv.xy - 0.125 * spread, vUv.z)).rgb + texture(uTiles, vec3(vUv.xy + 0.125 * spread, vUv.z)).rgb + texture(uTiles, vec3(vUv.xy + 0.375 * spread, vUv.z)).rgb);
  // The map drape over the ground, with the same four samples: its tile is of the same tiling, so its coordinates
  // are squeezed as the ground's. The level is explicit (the tiles have one) because the lookup is inside a branch.
  vec2 drapeSpread = dFdy(vDrapeUv.xy) * excess;
  if (vDrapeUv.z >= 0.0) {
    vec4 drape = 0.25 * (textureLod(uDrape, vec3(vDrapeUv.xy - 0.375 * drapeSpread, vDrapeUv.z), 0.0) + textureLod(uDrape, vec3(vDrapeUv.xy - 0.125 * drapeSpread, vDrapeUv.z), 0.0) + textureLod(uDrape, vec3(vDrapeUv.xy + 0.125 * drapeSpread, vDrapeUv.z), 0.0) + textureLod(uDrape, vec3(vDrapeUv.xy + 0.375 * drapeSpread, vDrapeUv.z), 0.0));
    rgb = drape.rgb + rgb * (1.0 - drape.a);
  }
  vec3 normal = normalize(vec3(-vSlope, 1.0));
  if (uCave.x > 0.0) {
    rgb = mix(rgb, caveGround(rgb, normal), uCave.x);
    outColor = vec4(mix(rgb, uHaze, smoothstep(uCave.y, uCave.z, vDistance) * uCave.x), 1.0);
    return;
  }
  rgb *= clamp(1.0 + uAir.x * (dot(normal, uLight) - uLight.z), 0.72, 1.18);
  float haze = min(0.62, 1.0 - exp(-pow(vDistance / uAir.y, 2.0) * 0.11)) * uAir.z;
  outColor = vec4(mix(rgb, uHaze, haze), 1.0);
}`;
