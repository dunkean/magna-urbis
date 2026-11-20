/**
 * Underdark 3D: the cave as an architect's sectional model. The camera looks down into the cave from outside, so a
 * real roof would hide the map: every rock mass rises as a wall to one roof level above the local floor and is cut
 * there. The cut face (poché) is a matte, nearly black fill with a fine lighter rim, the walls darken towards the cut,
 * the light is local (an ambient brighter in great chambers, darker in passages, pools from towns and fungi) and the
 * far cave dissolves into darkness. Shared by both 3D backends (terrain3d.ts, terrain3dGpu.ts) and the buildings.
 *
 * Everything derives from the layer the 3D view already has: the floor height and the soft rock field (`cave`,
 * 128 on the wall). No engine channel: the wall distance and the nearest floor come from a chamfer transform here.
 * The 2D map is not concerned.
 */
import type { CompositionRecipe } from './composition';

/** Display parameters of the 3D Underdark (composition `effects.underdark`). */
export interface UnderdarkCavern3d {
  /** Roof clearance of a medium chamber (m): passages get about half, great chambers about twice. */
  roof: number;
  /** 0 a lit cave, 1 the darkest: ambient level and how near the far cave dissolves. */
  darkness: number;
  /** Modelled mushrooms: 0 none, 1 the default abundance, up to 2. */
  fungi: number;
}
export const UNDERDARK_CAVERN_DEFAULTS: Readonly<UnderdarkCavern3d> = Object.freeze({ roof: 40, darkness: 0.45, fungi: 1 });
export const UNDERDARK_CAVERN_LIMITS = { roof: [10, 150], darkness: [0, 1], fungi: [0, 2] } as const;
/** The recipe's 3D Underdark parameters, each defaulted. */
export function underdarkCavernOf(recipe: Pick<CompositionRecipe, 'effects'> | undefined): UnderdarkCavern3d {
  const u = recipe?.effects.underdark,
    d = UNDERDARK_CAVERN_DEFAULTS;
  const pick = (v: number | undefined, key: keyof UnderdarkCavern3d): number => {
    const [lo, hi] = UNDERDARK_CAVERN_LIMITS[key];
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v!)) : d[key];
  };
  return { roof: pick(u?.roof, 'roof'), darkness: pick(u?.darkness, 'darkness'), fungi: pick(u?.fungi, 'fungi') };
}

interface CaveLayer {
  x: number;
  y: number;
  width: number;
  n: number;
  data: Float32Array;
  cave?: Uint8Array;
}
/** Per cell of the layer grid (texel centres at (i + .5) · cell): `roof` the absolute roof height (m); `texels` RGBA
 * for the ground shader: rock 0-1 (the soft field), roof above `base` (m), chamber openness 0-1, local clearance (m). */
export interface CavernField {
  n: number;
  x: number;
  y: number;
  width: number;
  base: number;
  roof: Float32Array;
  texels: Float32Array;
  /** 0-1 per cell: how far the rock rises towards the roof (full from 2.5 cells inside a mass; islands of a cell or two stay low). */
  wall: Float32Array;
}

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const D1 = 1,
  D2 = Math.SQRT2;
const FORWARD: readonly [number, number, number][] = [
  [-1, 0, D1],
  [0, -1, D1],
  [-1, -1, D2],
  [1, -1, D2],
];
const BACKWARD: readonly [number, number, number][] = [
  [1, 0, D1],
  [0, 1, D1],
  [1, 1, D2],
  [-1, 1, D2],
];

/** Chamfer distance (cells) to the nearest seed, with the seed's index. */
function chamfer(n: number, seed: (i: number) => boolean): { dist: Float32Array; near: Int32Array } {
  const dist = new Float32Array(n * n),
    near = new Int32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const s = seed(i);
    dist[i] = s ? 0 : 1e9;
    near[i] = s ? i : -1;
  }
  for (const [pass, steps] of [
    [0, FORWARD],
    [1, BACKWARD],
  ] as const) {
    for (let k = 0; k < n * n; k++) {
      const i = pass ? n * n - 1 - k : k,
        x = i % n,
        y = (i - x) / n;
      for (const [dx, dy, w] of steps) {
        const ax = x + dx,
          ay = y + dy;
        if (ax < 0 || ay < 0 || ax >= n || ay >= n) continue;
        const j = ay * n + ax,
          d = dist[j] + w;
        if (d < dist[i]) {
          dist[i] = d;
          near[i] = near[j];
        }
      }
    }
  }
  return { dist, near };
}

/** The roof of the cave and the shader texels; `clearance` is the roof of a medium chamber (UnderdarkCavern3d.roof). */
export function cavernField(layer: CaveLayer, clearance: number): CavernField | undefined {
  const { n, data, cave } = layer;
  if (!cave || cave.length !== n * n || data.length !== n * n || n < 4) return undefined;
  const cell = layer.width / n,
    open = (i: number): boolean => cave[i] < 128;
  // Open cells: distance to the wall; rock cells: their nearest opening (its floor is the floor of that wall).
  const toRock = chamfer(n, i => !open(i)).dist,
    opening = chamfer(n, open),
    toOpen = opening.near;
  // Chamber size: the inscribed radius spread around at half its decay, so the walls of a great chamber, and the rock
  // just behind them, know the chamber they bound (a dome there, a low vault along a passage).
  const size = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) size[i] = open(i) ? toRock[i] : 0;
  for (const [pass, steps] of [
    [0, FORWARD],
    [1, BACKWARD],
    [0, FORWARD],
    [1, BACKWARD],
  ] as const) {
    for (let k = 0; k < n * n; k++) {
      const i = pass ? n * n - 1 - k : k,
        x = i % n,
        y = (i - x) / n;
      for (const [dx, dy, w] of steps) {
        const ax = x + dx,
          ay = y + dy;
        if (ax < 0 || ay < 0 || ax >= n || ay >= n) continue;
        const v = size[ay * n + ax] - 0.5 * w;
        if (v > size[i]) size[i] = v;
      }
    }
  }
  let base = Infinity;
  for (let i = 0; i < n * n; i++) base = Math.min(base, data[i]);
  const local = new Float32Array(n * n),
    floor = new Float32Array(n * n);
  let roof = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    floor[i] = open(i) || toOpen[i] < 0 ? data[i] : data[toOpen[i]];
    // A 200 m chamber keeps 1.2 of the clearance, a great one 2. A passage is a vault: its apex never lower than
    // 1.5 × its half-width (about 3 × the spread size at its wall), up to 2.2 × the clearance.
    local[i] = Math.max(clearance * (0.4 + 1.6 * smooth(0, 1, (size[i] * cell) / 400)), Math.min(3 * size[i] * cell, 2.2 * clearance));
    roof[i] = floor[i] + local[i];
  }
  // The nearest-opening floors meet in seams inside the rock: a few box passes over rock cells smooth them.
  for (let pass = 0; pass < 3; pass++) {
    const next = roof.slice();
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (open(i)) continue;
        let sum = 0,
          count = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const ax = x + dx,
              ay = y + dy;
            if (ax < 0 || ay < 0 || ax >= n || ay >= n) continue;
            sum += roof[ay * n + ax];
            count++;
          }
        next[i] = Math.max(sum / count, floor[i] + 0.9 * local[i]);
      }
    roof = next;
  }
  const texels = new Float32Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    texels[i * 4] = cave[i] / 255;
    texels[i * 4 + 1] = roof[i] - base;
    texels[i * 4 + 2] = open(i) ? smooth(0, 1, (toRock[i] * cell) / 250) : 0;
    texels[i * 4 + 3] = local[i];
  }
  // A mass rises to the roof from 1 to 2.5 cells inside it; a grain of rock (no cell that deep) stays a low ledge.
  const wall = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) wall[i] = open(i) ? 0 : smooth(1, 2.5, opening.dist[i]);
  return { n, x: layer.x, y: layer.y, width: layer.width, base, roof, texels, wall };
}

/** Bilinear roof height (m) at a world point, same texel convention as the shaders. */
export function cavernRoofAt(field: CavernField, x: number, y: number): number {
  const n = field.n,
    g = ((x - field.x) / field.width) * n - 0.5,
    h = ((y - field.y) / field.width) * n - 0.5;
  const i = Math.floor(g),
    j = Math.floor(h),
    fx = g - i,
    fy = h - j;
  const at = (a: number, b: number): number => field.roof[Math.min(n - 1, Math.max(0, b)) * n + Math.min(n - 1, Math.max(0, a))];
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
}
/** Bilinear wall weight (CavernField.wall). */
export function cavernWallAt(field: CavernField, x: number, y: number): number {
  const n = field.n,
    g = ((x - field.x) / field.width) * n - 0.5,
    h = ((y - field.y) / field.width) * n - 0.5;
  const i = Math.floor(g),
    j = Math.floor(h),
    fx = g - i,
    fy = h - j;
  const at = (a: number, b: number): number => field.wall[Math.min(n - 1, Math.max(0, b)) * n + Math.min(n - 1, Math.max(0, a))];
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
}
/** The layer's heights as the section model shows them, per cell of the field's grid: rock stops at the roof of its
 * chamber and rises to it as a wall from its contour; floors stay as they are (the 3D view's surface does the same per
 * vertex). The relief of the tilted map is this grid. */
export function cavernSectionHeights(data: Float32Array, field: CavernField): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const roof = field.roof[i],
      height = Math.min(data[i], roof);
    out[i] = height + (roof - height) * field.wall[i];
  }
  return out;
}
/** Bilinear texel channel (0 rock, 1 roof - base, 2 openness, 3 clearance). */
export function cavernTexelAt(field: CavernField, x: number, y: number, channel: number): number {
  const n = field.n,
    g = ((x - field.x) / field.width) * n - 0.5,
    h = ((y - field.y) / field.width) * n - 0.5;
  const i = Math.floor(g),
    j = Math.floor(h),
    fx = g - i,
    fy = h - j;
  const at = (a: number, b: number): number => field.texels[(Math.min(n - 1, Math.max(0, b)) * n + Math.min(n - 1, Math.max(0, a))) * 4 + channel];
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
}

/** IEEE half floats of the texels (WebGPU rgba16float upload), rounded to nearest. */
export function halfFloats(values: Float32Array): Uint16Array {
  const out = new Uint16Array(values.length),
    f = new Float32Array(1),
    u = new Uint32Array(f.buffer);
  for (let i = 0; i < values.length; i++) {
    f[0] = values[i];
    const x = u[0],
      sign = (x >>> 16) & 0x8000,
      e = ((x >>> 23) & 255) - 112,
      m = x & 0x7fffff;
    if (e <= 0) out[i] = sign | (e < -10 ? 0 : (((m | 0x800000) >>> (1 - e)) + 0x1000) >>> 13);
    else if (e >= 31) out[i] = sign | 0x7c00;
    else out[i] = sign | Math.min(0x7bff, ((e << 10) | (m >>> 13)) + ((m >>> 12) & 1));
  }
  return out;
}
/** Fog of the cave (world units of the 3D view, exaggeration included): dissolving into darkness from `start` to `end`. */
export function cavernFog(orbitDistance: number, exaggeration: number, darkness: number): [number, number] {
  const reach = Math.max(orbitDistance, 260 * exaggeration);
  return [reach * (1.35 - 0.5 * darkness), reach * (3.6 - 1.6 * darkness)];
}
/** Uniform `uCavern` of the ground shader: roof base (m), darkness, fog start and end (world units). */
export function cavernUniform(field: CavernField | undefined, cavern: UnderdarkCavern3d, orbitDistance: number, exaggeration: number): [number, number, number, number] {
  const [start, end] = cavernFog(orbitDistance, exaggeration, cavern.darkness);
  return [field?.base ?? 0, cavern.darkness, start, end];
}

/** 3D ground, inside the Underdark branch (terrain3d.ts): the cavern texels sit in the cave-mask slot
 * (uForestBeach, uForestBeachRect), so the WebGPU stage needs no new binding. Uses UNDERDARK_GLSL's udFbm, the
 * town lanterns (uTownGlow) and the displayed water (displayWaterCover). */
export const CAVERN_3D_GLSL = `
uniform vec4 uCavern;
// The modelled mushrooms' area: focus x, y, then where they fade out (the painted caps take over there).
uniform vec4 uFungusArea;
// The towns' lanterns as the cave's point lights (x, y, radius), day and night: a town always shows by its own light.
uniform vec4 uCaveLamps[16]; uniform int uCaveLampCount;
float cavernHaze=0.;
// Section cut, rock walls and the cave's own light. base: the shaded ground (floor, water and rock already mixed);
// rock 0-1; y: the fragment's height (m); glow: the town lantern field; px: the pixel footprint (m); slope: the
// physical gradient (m/m); wet: water cover at the fragment.
vec3 cavernSection(vec3 base,float rock,float y,float glow,vec2 world,float px,vec2 slope,float wet){
  vec3 rect=uForestBeachRect;vec4 cav=texture(uForestBeach,(world-rect.xy)/rect.z);
  float dark=uCavern.y,headroom=cav.g+uCavern.x-y,clearance=max(cav.a,1.);
  vec3 n=normalize(vec3(-slope.x,1.,-slope.y));
  float steep=rock*smoothstep(.35,.75,1.-n.y),up=clamp(1.-headroom/clearance,0.,1.);
  // Rock walls: strata along the height, crevices, a rough grain, read along the wall (t), not from above.
  vec2 across=length(n.xz)>1e-3?normalize(vec2(-n.z,n.x)):vec2(1.,0.);
  float t=dot(world,across);
  if(steep>0.){
    // Columnar basalt: vertical columns about 2 m wide along the wall (irregular), dark joints between them, a few
    // cross fractures, each column face its own tone; near-black, slightly cool, matte.
    float u=t/2.1+.45*udNoise(vec2(t*.07,y*.03)),col=floor(u),fu=fract(u);
    float joint=1.-smoothstep(.0,.09+.5*px/2.1,min(fu,1.-fu));
    float fracture=step(.86,udHash(vec2(col,floor(y/3.5+udHash(vec2(col,7.))))))*(1.-smoothstep(0.,.06+.3*px/3.5,abs(fract(y/3.5+udHash(vec2(col,7.)))-.5)*2.-.94));
    float tone=.8+.4*udHash(vec2(col,31.)),grain=udFbm(vec2(t,y*1.4)+vec2(31.,7.),9.,px);
    float resolved=clamp(2.1/px*.6-.4,0.,1.);
    vec3 stone=vec3(.085,.09,.105)*tone*(1.+.5*grain)*(1.-.3*resolved*max(joint,fracture));
    base=mix(base,stone,steep);
    // Each column face turns a little: the lanterns catch alternate faces (faint glints only where light falls).
    n=normalize(n+steep*resolved*vec3(across.x,0.,across.y)*(fu-.5)*.9);
  }
  // Scree at the foot of the walls: pale fallen stones on the rock ledge.
  float scree=rock*(1.-steep)*(1.-smoothstep(.04,.2,up))*smoothstep(.62,.8,udNoise(world/2.3))*clamp(3./px,0.,1.);
  base=mix(base,vec3(.30,.29,.28),.6*scree);
  // Light: a dim cool ambient, brighter in great chambers, darker in passages; the lanterns as point lights above
  // their town (they light the walls that face them).
  // Walls keep an ambient floor: a rock mass is never a flat black silhouette.
  float ambient=max(mix(1.,.28,dark)*mix(.55,1.1,cav.b),.42*steep+.2);
  vec3 lamps=vec3(0.);
  for(int k=0;k<16;k++){
    if(k>=uCaveLampCount)break;
    vec4 g=uCaveLamps[k];vec2 d=g.xy-world;float r=max(g.z,1.),fall=exp(-dot(d,d)/(r*r)*.45);
    if(fall<.003)continue;
    vec3 l=normalize(vec3(d.x,25.+.15*r-(y-(cav.g+uCavern.x-clearance)),d.y));
    float facing=max(dot(n,l),0.);
    lamps+=vec3(1.,.8,.6)*fall*(.3+.8*facing+.6*steep*pow(facing,12.));
  }
  vec3 light=vec3(.92,.97,1.05)*ambient+lamps*mix(.22,.75,dark);
  // Wet rock near water: darker, a faint cool sheen.
  float damp=max(wet,steep*smoothstep(0.,.5,displayWaterCover(world-n.xz*30.)));
  vec3 c=base*light*(1.-.25*damp)+vec3(.05,.09,.10)*damp*steep*(1.-.5*dark);
  // Open water keeps more of its own faint glow and mirrors the lanterns.
  float pool=wet*(1.-rock);
  c=mix(c,base*max(light,vec3(.8))+vec3(1.,.72,.42)*.12*min(glow,1.2)+vec3(.02,.05,.055),pool);
  // Walls fade into the dark under the missing vault, a rounded shadow under the rim.
  c*=mix(1.,mix(1.,.6,smoothstep(.3,1.,up))*(1.-.25*smoothstep(.8,.95,up)),rock);
  // The cut: an even matte section fill, nothing of the plateau beneath it.
  float tol=2.+.15*px,cut=rock*smoothstep(.45,.75,rock)*(1.-smoothstep(.4*tol,tol,headroom));
  c=mix(c,vec3(.020,.019,.024),cut);
  // A fine lighter line where the fill meets the wall, one or two pixels wide at every zoom.
  float w=max(fwidth(headroom),.02),line=(1.-smoothstep(.6,1.6,abs(headroom-tol)/w))*smoothstep(.45,.75,rock);
  cavernHaze=glow;
  return mix(c,vec3(.15,.15,.16)*mix(1.,.65,dark),.75*line);
}
// The far cave dissolves into darkness (world units of the view); around the towns the darkness is a warm haze.
vec3 cavernFog(vec3 c,float d){
  vec3 dusk=vec3(.005,.005,.007)+vec3(.075,.048,.026)*min(cavernHaze,1.)*mix(.6,1.,uCavern.y);
  return mix(c,dusk,smoothstep(uCavern.z,uCavern.w,d));
}
`;

/** Roof of the cave as a mesh (the lid of the section model): a grid of at most `side` points a side over the field,
 * at the roof height (+ .6 m over the cut). Vertex: x, z (m, absolute), y, rock 0-1, openness. */
export function cavernRoofMesh(field: CavernField, side = 257): { vertices: Float32Array; indices: Uint32Array } {
  const m = Math.max(2, Math.min(side, field.n + 1)),
    vertices = new Float32Array(m * m * 5),
    indices = new Uint32Array((m - 1) * (m - 1) * 6);
  for (let j = 0; j < m; j++)
    for (let i = 0; i < m; i++) {
      const x = field.x + (i / (m - 1)) * field.width,
        y = field.y + (j / (m - 1)) * field.width,
        o = (j * m + i) * 5;
      vertices[o] = x;
      vertices[o + 1] = cavernRoofAt(field, x, y) + 0.6;
      vertices[o + 2] = y;
      vertices[o + 3] = cavernTexelAt(field, x, y, 0);
      vertices[o + 4] = cavernTexelAt(field, x, y, 2);
    }
  let k = 0;
  for (let j = 0; j + 1 < m; j++)
    for (let i = 0; i + 1 < m; i++) {
      const a = j * m + i,
        b = a + 1,
        c = a + m,
        d = c + 1;
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  return { vertices, indices };
}
/** Cutaway of the roof around the orbit target (m): focus x, y, radius, width of the section band. */
export function cavernReveal(x: number, y: number, orbitDistance: number, exaggeration: number): [number, number, number, number] {
  const radius = Math.max(220, (1.1 * orbitDistance) / Math.max(exaggeration, 0.2));
  return [x, y, radius, radius * 0.02];
}
/** The roof (lid) of the cave, cut away around the focus. Translated to WGSL by web/scripts/wgsl_shaders_3d.ts. */
export const CAVERN_ROOF_GLSL = {
  vertex: `#version 300 es
precision highp float;
layout(location=0) in vec3 roofPosition;
layout(location=1) in vec2 roofInfo;
uniform mat4 matrix;
uniform vec3 cameraOrigin;
uniform float exaggeration;
out vec3 world;
out vec3 physical;
out vec2 info;
void main(){
  physical=roofPosition;info=roofInfo;
  world=vec3(roofPosition.x-cameraOrigin.x,roofPosition.y*exaggeration-cameraOrigin.y,roofPosition.z-cameraOrigin.z);
  gl_Position=matrix*vec4(world,1.);
}`,
  fragment: `#version 300 es
precision highp float;
in vec3 world;
in vec3 physical;
in vec2 info;
uniform vec3 eye;
uniform vec4 uCavern;
uniform vec4 uReveal;
uniform vec4 uTownGlow[16]; uniform int uTownGlowCount;
out vec4 color;
float roofHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float roofNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(roofHash(i),roofHash(i+vec2(1.,0.)),f.x),mix(roofHash(i+vec2(0.,1.)),roofHash(i+vec2(1.,1.)),f.x),f.y);}
void main(){
  float past=distance(physical.xz,uReveal.xy)-uReveal.z;
  if(past<0.)discard;
  float dark=uCavern.y,glow=0.;
  for(int k=0;k<16;k++){if(k>=uTownGlowCount)break;vec4 g=uTownGlow[k];vec2 q=(physical.xz-g.xy)/max(g.z,1.);glow+=exp(-dot(q,q)*.45);}
  vec3 c;
  if(eye.y>world.y){
    // Seen from above: the lid is the section fill, with the section band along the cutaway.
    float band=1.-smoothstep(0.,uReveal.w,past),line=1.-smoothstep(.6,1.8,past/max(fwidth(past),.01));
    // The outside of the cave roof: dark stone with a faint relief (the roof's own domes and a grain) under a soft
    // light from above, warmed where the glow of a town below leaks through and towards the cut opening.
    vec3 nrm=normalize(cross(dFdx(world),dFdy(world)));if(nrm.y<0.)nrm=-nrm;
    float grain=roofNoise(physical.xz/61.)*.6+roofNoise(physical.xz/17.)*.4+.25*(roofNoise(physical.xz/5.)-.5);
    float relief=.5+.5*clamp(dot(nrm,normalize(vec3(-.4,.85,-.3)))*1.4-.2,0.,1.);
    vec3 stone=vec3(.15,.142,.152)*(.7+.6*grain)*relief*mix(1.15,.8,dark);
    stone+=vec3(1.,.72,.42)*(.035*min(glow,1.2)+.025*exp(-past/max(uReveal.z*.2,1.)));
    c=mix(stone,vec3(.16,.155,.16)*mix(1.,.7,dark),.75*max(line,band));
  } else {
    // Seen from inside: the vault, dark stone with a faint relief, lit from below by the lanterns.
    float grain=roofNoise(physical.xz/23.)*.6+roofNoise(physical.xz/7.)*.4;
    c=vec3(.22,.21,.225)*(.75+.5*grain)*(vec3(.92,.97,1.05)*mix(.9,.3,dark)*mix(.55,1.,info.y)+vec3(1.,.8,.6)*min(glow,1.4)*mix(.5,1.3,dark));
  }
  vec3 dusk=vec3(.005,.005,.007)+vec3(.075,.048,.026)*min(glow,1.)*mix(.6,1.,dark);
  color=vec4(mix(c,dusk,smoothstep(uCavern.z,uCavern.w,length(world-eye))),1.);
}`,
};
