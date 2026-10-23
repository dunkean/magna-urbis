/** Shared presentation ground in metres. Own analytic-noise/band implementation,
 * not a port of WaveNoise/LEADR and not an erosion simulation. Hidden bands
 * become unresolved slope variance instead of amplifying the remaining bands. */
export type GroundSampler = (x: number, y: number, metresPerPixel?: number) => number;
export interface GroundOptions {
  seed: number;
  /** Sea-level Celsius and annual rain millimetres. */
  climate?: readonly [number, number];
  sourceCell?: number;
  /** Stable native macro surface, without expensive display noise/ground detail.
   * Supplying it avoids evaluating the full refined surface for four probes. */
  macroSampler?: GroundSampler;
}
const bands = [
  { wavelength: 8, amplitude: .17, aspect: .35, filterWidth: 1, c: .8, s: .6, variance: .20 },
  { wavelength: 2.2, amplitude: .04, aspect: .24, filterWidth: .5, c: -.6, s: .8, variance: 1.8 },
  { wavelength: .32, amplitude: .012, aspect: .85, filterWidth: .5, c: .28, s: .96, variance: 1.3 },
  { wavelength: .055, amplitude: .002, aspect: .72, filterWidth: 1, c: -.96, s: .28, variance: .40 },
] as const;
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
function smooth(a: number, b: number, v: number): number { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); }
function visibility(wavelength: number, footprint: number): number {
  const t = clamp((footprint / wavelength - .18) / .24);
  return 1 - t * t * t * (t * (t * 6 - 15) + 10);
}
function hash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x9e3779b9) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(z, 0xc2b2ae35) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Quintic gradient noise and exact first derivatives. */
function noise(x: number, y: number, z: number, seed: number, out: Float64Array): void {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx ** 3 * (fx * (fx * 6 - 15) + 10), uy = fy ** 3 * (fy * (fy * 6 - 15) + 10), uz = fz ** 3 * (fz * (fz * 6 - 15) + 10);
  const dx = 30 * fx * fx * (fx * (fx - 2) + 1), dy = 30 * fy * fy * (fy * (fy - 2) + 1), dz = 30 * fz * fz * (fz * (fz - 2) + 1);
  let value = 0, gx = 0, gy = 0, gz = 0;
  for (let k = 0; k < 8; k++) {
    const a = k & 1, b = (k >>> 1) & 1, c = k >>> 2, h = hash(ix + a, iy + b, iz + c, seed);
    const nx = (h & 1023) / 511.5 - 1, ny = ((h >>> 10) & 1023) / 511.5 - 1, nz = ((h >>> 20) & 1023) / 511.5 - 1;
    const wx = a ? ux : 1 - ux, wy = b ? uy : 1 - uy, wz = c ? uz : 1 - uz;
    const vx = a ? dx : -dx, vy = b ? dy : -dy, vz = c ? dz : -dz;
    const v = nx * (fx - a) + ny * (fy - b) + nz * (fz - c), w = wx * wy * wz;
    value += v * w; gx += nx * w + v * vx * wy * wz;
    gy += ny * w + v * wx * vy * wz; gz += nz * w + v * wx * wy * vz;
  }
  out[0] = value * 1.7; out[1] = gx * 1.7; out[2] = gy * 1.7; out[3] = gz * 1.7;
}
/** Compact C1 elliptical clasts on a jittered lattice. Cell coordinates are
 * dimensionless; occupied cells place roughly 2.5–13 cm radii at the .32 m band.
 * Saturating overlapping caps bounds the height without a hard max seam. */
function gravel(x: number, z: number, seed: number, out: Float64Array): void {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  let sum = 0, gx = 0, gz = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const h = hash(ix + i, 0, iz + j, seed);
    if ((h & 7) > 4) continue;
    const dx = fx - (i + .5 + ((h & 255) / 255 - .5));
    const dz = fz - (j + .5 + (((h >>> 8) & 255) / 255 - .5));
    const angle = (h >>> 24) & 3;
    const c = angle === 0 ? 1 : angle === 2 ? 0 : angle === 1 ? .7071067811865476 : -.7071067811865476;
    const s = angle === 0 ? 0 : angle === 2 ? 1 : .7071067811865476;
    const u = c * dx + s * dz, v = -s * dx + c * dz;
    const ru = .10 + .30 * ((h >>> 16) & 15) / 15, rv = .10 + .30 * ((h >>> 20) & 15) / 15;
    const iu = 1 / (ru * ru), iv = 1 / (rv * rv), q = u * u * iu + v * v * iv;
    if (q >= 1) continue;
    const t = 1 - q, weight = .6 + 1.8 * (h >>> 28) / 15, derivative = -4 * weight * t;
    sum += weight * t * t;
    gx += derivative * (c * u * iu - s * v * iv);
    gz += derivative * (s * u * iu + c * v * iv);
  }
  const attenuation = Math.exp(-sum);
  out[0] = 1 - attenuation; out[1] = gx * attenuation; out[2] = 0; out[3] = gz * attenuation;
}
function field(x: number, y: number, z: number, seed: number, footprint: number, out: Float64Array, scratch: Float64Array): void {
  out.fill(0); const turn = (seed >>> 29) & 3;
  for (let k = 0; k < bands.length; k++) {
    // Conservative isotropic bandwidth of the compressed direction. Narrow
    // nonlinear joint grooves receive an additional half-width allowance.
    const band = bands[k], keep = visibility(band.wavelength * band.aspect * band.filterWidth, footprint);
    out[4] += (band.amplitude / band.wavelength) ** 2 * (1 + 1 / band.aspect ** 2) * band.variance * (1 - keep * keep);
    if (keep <= 0) continue;
    let c: number = band.c, s: number = band.s;
    if (turn === 1) { c = -band.s; s = band.c; } else if (turn === 2) { c = -band.c; s = -band.s; } else if (turn === 3) { c = band.s; s = -band.c; }
    const rx = c * x + s * z, rz = -s * x + c * z, wavelength = band.wavelength;
    if (k === 2) {
      gravel(rx / wavelength, rz / (wavelength * band.aspect), (seed + Math.imul(k + 1, 0x6c8e9cf5)) >>> 0, scratch);
      const a = band.amplitude * keep, gx = scratch[1] / wavelength, gz = scratch[3] / (wavelength * band.aspect);
      out[0] += (scratch[0] - .1) * a;
      out[1] += (c * gx - s * gz) * a; out[3] += (s * gx + c * gz) * a;
      continue;
    }
    noise((.36 * rx - .8 * y + .48 * rz) / wavelength + 17.137 + k * 9.173,
      (.48 * rx + .6 * y + .64 * rz) / (wavelength * band.aspect) + 3.731 - k * 5.731,
      (-.8 * rx + .6 * rz) / wavelength - 11.517 + k * 7.337,
      (seed + Math.imul(k + 1, 0x6c8e9cf5)) >>> 0, scratch);
    const raw = scratch[0], inverse = 1 / Math.sqrt(1 + raw * raw), v = .72 * raw * inverse;
    let value = v, derivative = 1;
    if (k === 0) { const rounded = Math.sqrt(v * v + .02); value = .3 - rounded; derivative = -v / rounded; }
    else if (k === 1) { const groove = 2 ** (-32 * v * v); value = .4 - groove; derivative = 64 * Math.LN2 * v * groove; }
    const a = band.amplitude * keep, d = a * derivative * .72 * inverse ** 3 / wavelength;
    const nx = scratch[1], ny = scratch[2] / band.aspect, nz = scratch[3];
    const gx = .36 * nx + .48 * ny - .8 * nz, gy = -.8 * nx + .6 * ny, gz = .48 * nx + .64 * ny + .6 * nz;
    out[0] += value * a; out[1] += (c * gx - s * gz) * d;
    out[2] += gy * d; out[3] += (s * gx + c * gz) * d;
  }
}
/** [height metres, dH/dX, dH/dUp, dH/dZ, unresolved slope variance]. */
export function sampleGroundField(point: readonly [number, number, number], seed: number, footprint = 0): Float64Array {
  const out = new Float64Array(5);
  field(point[0], point[1], point[2], seed >>> 0, Math.max(0, footprint), out, new Float64Array(4));
  return out;
}
function displacementGain(height: number, slope: number, temperature: number, rain: number): number {
  const localTemperature = temperature - .0065 * Math.max(height, 0), wet = smooth(250, 1400, rain);
  const snow = (1 - smooth(-5, 1, localTemperature)) * (1 - smooth(.55, 1.3, slope));
  const exposed = 1 - snow, rock = smooth(.25, .9, slope) * exposed;
  const growth = smooth(-8, 4, localTemperature) * (1 - smooth(28, 42, localTemperature));
  const grass = wet * growth * (exposed - rock), soil = exposed - rock - grass;
  return smooth(.025, .18, slope) * smooth(0, 2, height) * (rock + .16 * soil + .045 * grass + .018 * snow);
}
/** Fixed physical ground residual. Base probes always use mpp=0. A caller can
 * filter at a fixed mesh-level footprint and morph levels, without regenerating
 * the source. Flat plains/water get zero displacement; rock is bounded by
 * -10.1/+5.6 cm, with smaller soil/grass/snow fractions. */
export function createGroundDisplacementSampler(baseSampler: GroundSampler, options: GroundOptions): GroundSampler {
  const seed = options.seed >>> 0, climate = options.climate ?? [14, 900];
  const macroSampler = options.macroSampler ?? baseSampler, sharedMacro = macroSampler === baseSampler;
  const probe = Math.max(.125, Math.min(2, Math.max(0, options.sourceCell ?? 20) * .025));
  const value = new Float64Array(5), scratch = new Float64Array(4);
  return (x, y, metresPerPixel = 0): number => {
    const height = baseSampler(x, y, 0); if (height <= 0) return height;
    const macroHeight = sharedMacro ? height : macroSampler(x, y, 0);
    const gx = (macroSampler(x + probe, y, 0) - macroSampler(x - probe, y, 0)) / (2 * probe);
    const gy = (macroSampler(x, y + probe, 0) - macroSampler(x, y - probe, 0)) / (2 * probe);
    const gain = displacementGain(macroHeight, Math.hypot(gx, gy), climate[0], climate[1]);
    if (gain <= 0) return height;
    field(x, 0, y, seed, Math.max(0, metresPerPixel), value, scratch);
    return height + value[0] * gain;
  };
}
const glslFloat = (v: number): string => Number.isInteger(v) ? `${v}.` : String(v);
const glslArray = (key: keyof typeof bands[number]): string => bands.map(b => glslFloat(b[key])).join(',');

/** Self-contained; normals use X/up/Z. Albedo is linear. The shade function
 * returns display RGB, and raster compatibility converts unlit albedo itself. */
export const GROUND_FIELD_GLSL = `
float groundSmooth(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
vec3 groundToLinear(vec3 c){return pow(max(c,vec3(0.)),vec3(2.2));}
vec3 groundToDisplay(vec3 c){
#ifdef RENDER3D_FOREST
  if(uRenderV2>0)return pow(max(c,vec3(0.)),vec3(1./2.2));
#endif
  return pow(clamp(c,vec3(0.),vec3(1.)),vec3(1./2.2));
}
uint groundHash(ivec3 cell,uint seed){
  uvec3 p=uvec3(cell);uint h=(p.x*0x9e3779b9u)^(p.y*0x85ebca6bu)^(p.z*0xc2b2ae35u)^seed;
  h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);
}
vec4 groundNoise(vec3 point,uint seed){
  ivec3 cell=ivec3(floor(point));vec3 f=fract(point),u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
  vec4 n=vec4(0.);
  for(int k=0;k<8;k++){
    ivec3 corner=ivec3(k&1,(k>>1)&1,k>>2);uint h=groundHash(cell+corner,seed);
    vec3 g=vec3(float(h&1023u),float((h>>10u)&1023u),float((h>>20u)&1023u))/511.5-1.;
    vec3 w=mix(1.-u,u,vec3(corner)),d=mix(-du,du,vec3(corner));float v=dot(g,f-vec3(corner));
    n+=vec4(v*w.x*w.y*w.z,g*w.x*w.y*w.z+v*vec3(d.x*w.y*w.z,w.x*d.y*w.z,w.x*w.y*d.z));
  }return n*1.7;
}
vec4 groundGravel(vec2 point,uint seed){
  ivec2 cell=ivec2(floor(point));vec2 f=fract(point);float sum=0.;vec2 gradient=vec2(0.);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    ivec2 neighbour=cell+ivec2(i,j);uint h=groundHash(ivec3(neighbour.x,0,neighbour.y),seed);
    if((h&7u)>4u)continue;
    vec2 offset=vec2(i,j)+.5+(vec2(float(h&255u),float((h>>8u)&255u))/255.-.5);
    vec2 d=f-offset;int angle=int((h>>24u)&3u);
    float c=angle==0?1.:angle==2?0.:angle==1?.7071067811865476:-.7071067811865476;
    float s=angle==0?0.:angle==2?1.:.7071067811865476;
    vec2 uv=vec2(c*d.x+s*d.y,-s*d.x+c*d.y);
    vec2 radius=.10+.30*vec2(float((h>>16u)&15u),float((h>>20u)&15u))/15.;
    vec2 inverse=1./(radius*radius);float q=dot(uv*uv,inverse);if(q>=1.)continue;
    float t=1.-q,weight=.6+1.8*float(h>>28u)/15.;sum+=weight*t*t;
    gradient+=-4.*weight*t*vec2(c*uv.x*inverse.x-s*uv.y*inverse.y,s*uv.x*inverse.x+c*uv.y*inverse.y);
  }
  float attenuation=exp(-sum);return vec4(1.-attenuation,gradient.x*attenuation,0.,gradient.y*attenuation);
}
const float groundWavelength[4]=float[4](${glslArray('wavelength')});
const float groundAmplitude[4]=float[4](${glslArray('amplitude')});
const float groundAspect[4]=float[4](${glslArray('aspect')});
const float groundFilterWidth[4]=float[4](${glslArray('filterWidth')});
const float groundRotationC[4]=float[4](${glslArray('c')});
const float groundRotationS[4]=float[4](${glslArray('s')});
const float groundVarianceFactor[4]=float[4](${glslArray('variance')});
float groundVisibility(float wavelength,float footprint){
  float t=clamp((footprint/wavelength-.18)/.24,0.,1.);return 1.-t*t*t*(t*(t*6.-15.)+10.);
}
float groundSlopeVariance(float footprint){
  float variance=0.;for(int k=0;k<4;k++){
    float a=groundAmplitude[k]/groundWavelength[k];
    float keep=groundVisibility(groundWavelength[k]*groundAspect[k]*groundFilterWidth[k],max(footprint,0.));
    variance+=a*a*(1.+1./(groundAspect[k]*groundAspect[k]))*groundVarianceFactor[k]*(1.-keep*keep);
  }return variance;
}
vec4 groundFieldWithClasts(vec3 point,uint seed,float footprint,out float clasts){
  vec4 sum=vec4(0.);clasts=0.;int turn=int((seed>>29u)&3u);
  for(int k=0;k<4;k++){
    float wavelength=groundWavelength[k];
    float keep=groundVisibility(wavelength*groundAspect[k]*groundFilterWidth[k],max(footprint,0.));if(keep<=0.)continue;
    float c=groundRotationC[k],s=groundRotationS[k],aspect=groundAspect[k];
    if(turn==1){float old=c;c=-s;s=old;}else if(turn==2){c=-c;s=-s;}else if(turn==3){float old=c;c=s;s=-old;}
    vec3 r=vec3(c*point.x+s*point.z,point.y,-s*point.x+c*point.z);
    if(k==2){
      vec4 cap=groundGravel(r.xz/vec2(wavelength,wavelength*aspect),seed+uint(k+1)*0x6c8e9cf5u);
      vec2 g=cap.yw/vec2(wavelength,wavelength*aspect);float a=groundAmplitude[k]*keep;
      sum+=vec4((cap.x-.1)*a,(c*g.x-s*g.y)*a,0.,(s*g.x+c*g.y)*a);clasts=cap.x*keep;continue;
    }
    vec3 q=vec3(dot(r,vec3(.36,-.8,.48)),dot(r,vec3(.48,.6,.64))/aspect,dot(r,vec3(-.8,0.,.6)))/wavelength;
    q+=vec3(17.137,3.731,-11.517)+float(k)*vec3(9.173,-5.731,7.337);
    vec4 n=groundNoise(q,seed+uint(k+1)*0x6c8e9cf5u);
    float inverse=inversesqrt(1.+n.x*n.x),v=.72*n.x*inverse,value=v,derivative=1.;
    if(k==0){float rounded=sqrt(v*v+.02);value=.3-rounded;derivative=-v/rounded;}
    else if(k==1){float groove=exp2(-32.*v*v);value=.4-groove;derivative=44.36141956*v*groove;}
    float a=groundAmplitude[k]*keep,d=a*derivative*.72*inverse*inverse*inverse/wavelength;
    vec3 g=vec3(.36*n.y+.48*n.z/aspect-.8*n.w,-.8*n.y+.6*n.z/aspect,.48*n.y+.64*n.z/aspect+.6*n.w);
    sum+=vec4(value*a,vec3(c*g.x-s*g.z,g.y,s*g.x+c*g.z)*d);
  }return sum;
}
vec4 groundField(vec3 point,uint seed,float footprint){float clasts;return groundFieldWithClasts(point,seed,footprint,clasts);}
// rock / soil / grass / snow; continuous and sums to one.
vec4 groundCover(vec3 macro,vec2 climate){
  float grade=length(macro.yz),temperature=climate.x-.0065*max(macro.x,0.),wet=groundSmooth(250.,1400.,climate.y);
  float snow=(1.-groundSmooth(-5.,1.,temperature))*(1.-groundSmooth(.55,1.3,grade));
  float exposed=1.-snow,rock=groundSmooth(.25,.9,grade)*exposed;
  float growth=groundSmooth(-8.,4.,temperature)*(1.-groundSmooth(28.,42.,temperature));
  float grass=wet*growth*(exposed-rock),soil=exposed-rock-grass;
  return vec4(rock,soil,grass,snow);
}
float groundGain(vec3 macro,vec4 cover){
  return groundSmooth(.025,.18,length(macro.yz))*groundSmooth(0.,2.,macro.x)*dot(cover,vec4(1.,.16,.045,.018));
}
// Fixed XZ reference plane prevents the displaced height feeding its own phase.
// Gradients are delta only; cover-envelope derivatives are macro approximations.
vec3 groundDisplacement(vec3 macro,vec2 world,float footprint,vec2 climate,uint seed){
  vec4 cover=groundCover(macro,climate),detail=groundField(vec3(world.x,0.,world.y),seed,footprint);
  return vec3(detail.x,detail.y,detail.w)*groundGain(macro,cover);
}
struct GroundMaterial {vec3 albedo;vec3 normal;float roughness;float occlusion;};
GroundMaterial terrainGroundMaterial(vec3 macro,vec2 world,float footprint,vec3 macroColor,vec2 climate,uint seed,float meshFootprint){
  float fp=max(0.,footprint);vec4 cover=groundCover(macro,climate);float gain=groundGain(macro,cover);
  float clasts;vec4 detail=groundFieldWithClasts(vec3(world.x,0.,world.y),seed,fp,clasts);vec2 gradient=detail.yw*gain;
  // Subtract the slope already represented by the displaced mesh. Zero means
  // an undisplaced macro surface; tiny positive means all bands represented.
  if(meshFootprint>0.)gradient-=groundField(vec3(world.x,0.,world.y),seed,meshFootprint).yw*gain;
  GroundMaterial m;m.normal=normalize(vec3(-macro.y-gradient.x,1.,-macro.z-gradient.y));
  float form=clamp(detail.x*18.,-1.,1.),cavity=clamp(-detail.x*20.,0.,1.)*cover.x;
  vec3 rock=mix(macroColor,vec3(.43,.42,.39),.7),soil=mix(macroColor,vec3(.40,.32,.22),.18);
  vec3 grass=macroColor*vec3(.96,1.02,.93),snow=mix(macroColor,vec3(.87,.91,.95),.35);
  vec3 color=rock*cover.x+soil*cover.y+grass*cover.z+snow*cover.w;
  color*=1.+form*dot(cover,vec4(.12,.055,.045,.012));
  // The visible cap that displaced this stone also lightens its mineral crest
  // and slightly polishes it. No independent high-frequency color noise.
  float cap=groundSmooth(.05,.7,clasts);color*=1.+cap*.12*cover.x;
  float grade=length(macro.yz),strataKeep=groundVisibility(.65/max(1.,grade),fp);
  float strata=sin((macro.x+.13*world.x-.09*world.y)*9.66643893+detail.x*3.);
  color*=1.+cover.x*.022*strata*strataKeep;color*=1.-cavity*.11;
  float wet=groundSmooth(500.,1800.,climate.y)*(1.-cover.w),roughness=dot(cover,vec4(.52,.83,.91,.76));
  roughness-=wet*(.08*cover.y+.10*cavity);roughness+=(form*.025-cap*.055)*cover.x;
  float alpha2=pow(clamp(roughness,.38,.98),4.)+gain*gain*groundSlopeVariance(fp);
  m.albedo=groundToLinear(clamp(color,vec3(.015),vec3(.96)));m.roughness=clamp(pow(alpha2,.25),.38,.98);
  // Local cavity approximation, not traced visibility or a shadow map.
  m.occlusion=clamp(1.-.22*cavity-.04*max(-form,0.)*cover.y,.72,1.);return m;
}
GroundMaterial terrainGroundMaterial(vec3 macro,vec2 world,float footprint,vec3 macroColor,vec2 climate,uint seed){
  return terrainGroundMaterial(macro,world,footprint,macroColor,climate,seed,0.);
}
vec3 groundBrdf(GroundMaterial m,vec3 view,vec3 light){
  vec3 n=m.normal,v=normalize(view),l=normalize(light),halfVector=normalize(v+l);
  float nv=max(dot(n,v),.001),nl=max(dot(n,l),0.),nh=max(dot(n,halfVector),0.),vh=max(dot(v,halfVector),0.);
  float a=m.roughness*m.roughness,a2=a*a,denominator=nh*nh*(a2-1.)+1.;
  float distribution=a2/(3.14159265*denominator*denominator);
  float visibility=.5/max(nl*sqrt(nv*nv*(1.-a2)+a2)+nv*sqrt(nl*nl*(1.-a2)+a2),.001);
  float fresnel=.04+.96*pow(1.-vh,5.);
  return ((1.-fresnel)*m.albedo/3.14159265+vec3(distribution*visibility*fresnel))*nl;
}
vec3 shadeTerrainGround(GroundMaterial m,vec3 view,vec3 light,vec3 light2,float strength){
  float amount=clamp(strength,0.,1.);vec3 ambient=m.albedo*(.34+.16*clamp(m.normal.y,0.,1.))*m.occlusion;
  vec3 direct=groundBrdf(m,view,light)*2.2+groundBrdf(m,view,light2)*.58;
  return groundToDisplay(mix(m.albedo,ambient,amount)+direct*max(strength,0.));
}
`;
