/** Shared, flat-shaded trunk and crown geometry for the town grove. Positions in the template are ring direction,
 * radius and height. The root flare and lean are restored from the tree's instance, as in the original tree mesh. */
type RingPoint = [number, number, number, number];
export const GROVE_BLOCK = 256;
export const GROVE_STRIDE = 12;
export const GROVE_TEMPLATE_STRIDE = 16;
export const GROVE_TRUNK_COLOR = 0x4b3c2a;
const GROVE_TRUNK_LEVELS = [
  [1.6, 0],
  [1.05, 0.15],
  [0.85, 0.65],
  [0.6, 1.05],
] as const;
const GROVE_LOBE_LEVELS = [
  [0.55, -0.25],
  [1, 0.12],
  [0.86, 0.55],
  [0.45, 0.85],
] as const;

export interface GroveBlock {
  origin: [number, number];
  bounds: [number, number, number, number, number, number];
  /** Three vec4 values per instance: local x/y, altitude, seat; radius, height, lean x/y;
   * cosine/sine of the root phase, packed RGB, trunk flag. */
  trunks: Float32Array;
  lobes: Float32Array;
}

export interface GroveInstances {
  light: boolean;
  blocks: GroveBlock[];
}

export interface GroveTemplate {
  vertices: Float32Array;
  indices: Uint16Array;
}

/** One template for each primitive and detail level, shared by every town. Each triangle vertex also carries the
 * first three points of its face, so a sheared, flared trunk keeps the correct flat normal over both triangles. */
export function groveTemplate(trunk: boolean, light: boolean): GroveTemplate {
  const index = (trunk ? 0 : 2) + Number(light);
  return (TEMPLATES[index] ??= makeTemplate(trunk, light));
}

function makeTemplate(trunk: boolean, light: boolean): GroveTemplate {
  const n = trunk ? (light ? 5 : 7) : light ? 6 : 9;
  const rings = (trunk ? GROVE_TRUNK_LEVELS : GROVE_LOBE_LEVELS).map(([r, h], k) =>
    Array.from({ length: n }, (_, i): RingPoint => {
      const a = ((i + (trunk ? 0 : k * 0.5)) / n) * Math.PI * 2;
      return [Math.cos(a), Math.sin(a), r, h];
    }),
  );
  const data: number[] = [],
    indices: number[] = [];
  const face = (points: RingPoint[]): void => {
    const [a, b, c] = points;
    const first = data.length / GROVE_TEMPLATE_STRIDE;
    let normal = a;
    if (!trunk) {
      const ax = a[0] * a[2],
        ay = a[1] * a[2];
      const abx = b[0] * b[2] - ax,
        aby = b[1] * b[2] - ay,
        abz = b[3] - a[3];
      const acx = c[0] * c[2] - ax,
        acy = c[1] * c[2] - ay,
        acz = c[3] - a[3];
      const nx = aby * acz - abz * acy,
        ny = abz * acx - abx * acz,
        nz = abx * acy - aby * acx;
      const length = Math.hypot(nx, ny, nz);
      normal = [nx / length, nz / length, ny / length, 0];
    }
    for (const p of points) data.push(...p, ...normal, ...b, ...c);
    for (let i = 1; i + 1 < points.length; i++) indices.push(first, first + i, first + i + 1);
  };
  for (let k = 1; k < rings.length; k++)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      face([rings[k - 1][i], rings[k - 1][j], rings[k][j], rings[k][i]]);
    }
  if (!trunk) {
    face(rings[rings.length - 1]);
    face([...rings[0]].reverse());
  }
  return { vertices: Float32Array.from(data), indices: Uint16Array.from(indices) };
}

const TEMPLATES: GroveTemplate[] = [];

/** Template vertex attributes followed by instanced origin/seating, scale/shear and root phase/colour. */
export const GROVE_INSTANCE_GLSL = `
layout(location=0) in vec4 aPoint;
layout(location=1) in vec4 aFaceA;
layout(location=2) in vec4 aFaceB;
layout(location=3) in vec4 aFaceC;
layout(location=5) in vec4 aSeat;
layout(location=6) in vec4 aScale;
layout(location=7) in vec4 aRootColor;
vec3 groveLocal(vec4 p){
  float c=p.x,s=p.y;
  float root=p.w==0.?1.+.35*((4.*c*c*c-3.*c)*aRootColor.x-(3.*s-4.*s*s*s)*aRootColor.y):1.;
  vec2 xy=p.xy*(p.z*aScale.x*root)+aScale.zw*p.w;
  return vec3(xy,p.w*aScale.y);
}
vec3 groveNormal(){
  if(aRootColor.w<.5)return aFaceA.xyz;
  vec3 a=groveLocal(aFaceA);
  return normalize(cross(groveLocal(aFaceB)-a,groveLocal(aFaceC)-a)).xzy;
}
vec3 groveColor(){
  int rgb=int(aRootColor.z);
  return vec3(ivec3((rgb>>16)&255,(rgb>>8)&255,rgb&255))/255.;
}`;
