import { GROVE_INSTANCE_GLSL, type GroveBlock } from '../../render/city3d/groveInstances';
import type { BuildingFrame } from '../urbanBuilding3d';

/** The grove shares the separate 3D view's flat building fragment shader and its terrain exaggeration. */
export const BENCH_GROVE_VS = `#version 300 es
precision highp float;
precision highp int;
${GROVE_INSTANCE_GLSL}
uniform mat4 matrix;
uniform vec3 offset;
uniform float exaggeration;
uniform vec2 sectorOrigin;
out vec3 n,base,facadePosition,grainPosition,houseUv,roofEdge;
flat out float materialClass,houseLayer;
flat out vec3 extra;
void main(){
  vec3 p=groveLocal(aPoint)+aSeat.xyz;
  float ground=min(p.z,aSeat.w), h=p.z-ground;
  vec3 normal=groveNormal();
  n=normalize(vec3(normal.x,normal.y/(h>.01?1.:exaggeration),normal.z));
  base=groveColor();materialClass=houseLayer=0.;
  facadePosition=vec3(p.x+sectorOrigin.x,h,p.y+sectorOrigin.y);
  grainPosition=vec3(p.x,h,p.y);houseUv=extra=vec3(0.);roofEdge=vec3(1.);
  gl_Position=matrix*vec4(vec3(p.x,h+ground*exaggeration,p.y)+offset,1.);
}`;

/** Same vertex inputs as GROVE_INSTANCE_GLSL and the prefix of the shared building parameter buffer. */
export const BENCH_GROVE_WGSL = `
struct Frame {
  matrix: mat4x4<f32>,
  offset: vec3<f32>,
  exaggeration: f32,
  sectorOrigin: vec2<f32>,
}
@group(0) @binding(0) var<storage,read> frame: Frame;
struct Output {
  @location(0) n: vec3<f32>,
  @location(1) base: vec3<f32>,
  @location(2) facadePosition: vec3<f32>,
  @location(3) grainPosition: vec3<f32>,
  @location(4) @interpolate(flat) materialClass: f32,
  @location(5) @interpolate(flat) houseLayer: f32,
  @location(6) @interpolate(flat) extra: vec3<f32>,
  @location(7) houseUv: vec3<f32>,
  @location(8) roofEdge: vec3<f32>,
  @builtin(position) clip: vec4<f32>,
}
fn groveLocal(p: vec4<f32>, scale: vec4<f32>, phase: vec2<f32>) -> vec3<f32> {
  let c = p.x;
  let s = p.y;
  let root = select(1., 1. + .35 * ((4.*c*c*c-3.*c)*phase.x-(3.*s-4.*s*s*s)*phase.y), p.w == 0.);
  return vec3<f32>(p.xy * (p.z * scale.x * root) + scale.zw * p.w, p.w * scale.y);
}
@vertex fn main(@location(0) point: vec4<f32>, @location(1) a: vec4<f32>, @location(2) b: vec4<f32>, @location(3) c: vec4<f32>,
  @location(5) seat: vec4<f32>, @location(6) scale: vec4<f32>, @location(7) rootColor: vec4<f32>) -> Output {
  let p = groveLocal(point, scale, rootColor.xy) + seat.xyz;
  var normal = a.xyz;
  if (rootColor.w > .5) {
    let pa = groveLocal(a, scale, rootColor.xy);
    normal = normalize(cross(groveLocal(b, scale, rootColor.xy)-pa, groveLocal(c, scale, rootColor.xy)-pa)).xzy;
  }
  let ground = min(p.z, seat.w);
  let h = p.z - ground;
  let heightScale = select(frame.exaggeration, 1., h > .01);
  let n = normalize(vec3<f32>(normal.x, normal.y/heightScale, normal.z));
  let rgb = u32(rootColor.z);
  let base = vec3<f32>(f32((rgb >> 16u) & 255u), f32((rgb >> 8u) & 255u), f32(rgb & 255u)) / 255.;
  let facade = vec3<f32>(p.x+frame.sectorOrigin.x, h, p.y+frame.sectorOrigin.y);
  var clip = frame.matrix * vec4<f32>(vec3<f32>(p.x, h+ground*frame.exaggeration, p.y) + frame.offset, 1.);
  clip.z = (clip.z+clip.w)*.5;
  return Output(n, base, facade, vec3<f32>(p.x,h,p.y), 0., 0., vec3<f32>(0.), vec3<f32>(0.), vec3<f32>(1.), clip);
}`;

/** Coarse frustum and projected-size rejection, shared by the bench's GL and GPU backends. */
export function groveBlockVisible(block: GroveBlock, frame: BuildingFrame): boolean {
  const [x0, y0, z0, x1, y1, z1] = block.bounds,
    e = frame.exaggeration,
    m = frame.matrix;
  const lo = Math.min(z0, z0 * e),
    hi = Math.max(z1, z1 * e);
  const x = (x0 + x1) / 2 - frame.cameraX,
    y = (lo + hi) / 2 - frame.targetHeight,
    z = (y0 + y1) / 2 - frame.cameraY;
  const radius = Math.hypot(x1 - x0, hi - lo, y1 - y0) / 2;
  const depth = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (frame.focal < Math.max(1, depth - radius) * 0.12) return false;
  for (let axis = 0; axis < 3; axis++)
    for (let sign = -1; sign <= 1; sign += 2) {
      const a = m[3] + sign * m[axis],
        b = m[7] + sign * m[4 + axis],
        c = m[11] + sign * m[8 + axis];
      if (a * x + b * y + c * z + m[15] + sign * m[12 + axis] < -radius * Math.hypot(a, b, c)) return false;
    }
  return true;
}
