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
  let footprint = NaN, visible = true;
  return (x, y, metresPerPixel = 0): number => {
    const height = baseSampler(x, y, 0); if (height <= 0) return height;
    // Above the finest visible band the field is exactly 0: skip the macro probes.
    const px = Math.max(0, metresPerPixel);
    if (px !== footprint) { footprint = px; visible = bands.some(band => visibility(band.wavelength * band.aspect * band.filterWidth, px) > 0); }
    if (!visible) return height;
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

/** Shared with surfaceMicro; emitted after the material noise helpers. */
export const GROUND_COVER_GLSL = `
// Share of loose wind-blown sand of this fragment (the sand sea of the zone), set by v2ZoneEnv before the material.
float surfaceGroundSand=0.;
uint groundHash(ivec3 cell,uint seed){
  uvec3 p=uvec3(cell);uint h=(p.x*0x9e3779b9u)^(p.y*0x85ebca6bu)^(p.z*0xc2b2ae35u)^seed;
  h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);
}
vec4 groundGravel(vec2 point,uint seed){
  ivec2 cell=ivec2(floor(point));vec2 f=fract(point);float sum=0.,tone=0.;vec2 gradient=vec2(0.);
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
    float t=1.-q,weight=.6+1.8*float(h>>28u)/15.;sum+=weight*t*t;tone+=weight*t*t*(float((h>>12u)&15u)/15.-.5);
    gradient+=-4.*weight*t*vec2(c*uv.x*inverse.x-s*uv.y*inverse.y,s*uv.x*inverse.x+c*uv.y*inverse.y);
  }
  float attenuation=exp(-sum);return vec4(1.-attenuation,gradient.x*attenuation,tone*attenuation,gradient.y*attenuation);
}
// A compact C1 cap and its gradient in cell coordinates. Jitter and support
// stay inside the owning cell, including the shadow: no neighbour search.
vec3 surfaceGroundCap(vec2 d,vec2 radius){
  vec2 inverse=1./(radius*radius);float t=max(1.-dot(d*d,inverse),0.);
  return vec3(t*t,-4.*t*d*inverse);
}
vec3 surfaceGroundCover(vec2 world,float slope,float fp,float rock,float grass,uint salt,vec3 broad,vec3 fine){
  surfaceGroundSlope=vec2(0.);vec3 tone=vec3(0.);
  if(uQuality>0)return tone;
#ifdef RENDER3D_FOREST
  if(uGroundCover.w<.5||uForest==0||uForestBrushes!=0||uRenderV2>1||fp>=10.||surfaceGroundHeight<=0.)return tone;
  if(fp>=3.&&surfaceGroundEnv.z<.01)return tone;
  // v2GroundEnv scales groundField by this substrate gain. Cover normals are
  // already material-specific and must also survive on perfectly flat plains.
  if(uRenderV2==1)surfaceGroundNormalGain=mix(.02+.43*rock+.07*(1.-grass),.008,v2GroundSnow);
  bool supplied=surfaceGroundHasInputs&&all(equal(world,surfaceGroundPoint));
  vec3 occupation=supplied?surfaceGroundOccupation:vec3(0.);
  int cls=supplied?int(occupation.z):uHasOccupation==1?-1:0;
  // Unknown occupation is conservative until the caller supplies its existing
  // categorical sample. Fields, roads and buildings must never sprout cover.
  if(cls<0||cls==1||cls==4||cls==5||cls==7||cls==8||cls==9||cls==10)return tone;
  float snow=clamp(uRenderV2==1?v2GroundSnow:surfaceGroundEnv.w,0.,1.),exposed=1.-snow;
  if(exposed<=0.)return tone;
  float moisture=surfaceGroundEnv.x,green=surfaceGroundEnv.y;
  float land=supplied&&cls>0?sstep(0.,max(.3,fp),min(occupation.x,-occupation.y)):1.;
  exposed*=land*(1.-surfaceGroundWet);vec2 light=uGroundCover.xz;
  light=dot(light,light)>.0001?normalize(light):vec2(1.,0.);
  float herb=grass*(1.-rock)*exposed*(1.-sstep(.35,.7,slope));
  // Sward grain: continuous zero-mean bands under the 0.8 m mottle band. Discrete
  // tufts (lit elliptic caps on a lattice) read as small crescents up close.
  float swardKeep=1.-sstep(.125,.25,fp);
  if(herb>.01&&swardKeep>0.){
    float density=(.38+.55*sstep(.2,1.6,moisture))*(cls==2?1.:cls==3?.8:.72);
    if(uRenderV2==1){
      float phase=.5-.5*cos(6.283185307*uV2Season);
      float temperature=uMaterialClimate.x-.0065*surfaceGroundHeight+6.*(2.*phase-1.);
      green=sstep(.35,1.3,moisture)*sstep(1.,13.,temperature);
    }
    float fineKeep=1.-sstep(.035,.07,fp);
    vec3 s1=surfaceBand(world,1.,salt+817u),s2=fineKeep>0.?surfaceBand(world,.28,salt+818u):vec3(0.);
    float amount=herb*density;
    surfaceGroundSlope+=amount*(.03*swardKeep*s1.yz+.012*fineKeep*s2.yz);
    float grain=.6*swardKeep*s1.x+.4*fineKeep*s2.x;
    tone+=.07*amount*grain*mix(vec3(.85,.70,.32),vec3(.55,.85,.38),green);
  }
  // Wind forms need loose sand: a gravel plain stays flat. The satellite look takes its sand from the sand sea
  // of the zone (surfaceGroundSand), whose dunes are landforms drawn at every zoom by v2GroundDunes; only the
  // ripples are left to this close-range pass. The other looks keep a 90 m wave on arid sand.
  float sand=(uRenderV2==1?surfaceGroundSand:sstep(.3,.7,surfaceGroundEnv.z))*(1.-rock)*(1.-grass)*exposed*(1.-sstep(.35,.7,slope));
  float reach=.32;
  if(uRenderV2==0)reach=10.;
  if(sand>.01&&fp<reach){
    float angle=float(salt&1023u)*.006135923;vec2 wind=vec2(cos(angle),sin(angle));
    vec3 flow=surfaceBand(world,1600.,salt+821u);
    if(uRenderV2==0){
      // Long crests across the wind: a strong warp would break them into dimples.
      float phase=dot(world,wind)*.0698+2.5*flow.x+.07*surfaceGroundHeight;
      vec2 rate=wind*.0698+2.5*flow.yz+.07*surfaceGroundGradient;
      float keep=(1.-sstep(5.,10.,fp))*(1.-sstep(.125,.25,fp*length(rate)/6.283185307));
      surfaceGroundSlope+=sand*keep*.9*cos(phase)*rate;
      tone+=vec3(sand*keep*.05*sin(phase));
    }
    // Warped scalar phase gives a continuous wind field and its true gradient;
    // the terrain height bends the phase uphill without view-dependent noise.
    if(fp<.32){
      float ripple=dot(world,wind)*4.4879895+1400.*flow.x+.6*surfaceGroundHeight;
      vec2 rippleRate=wind*4.4879895+1400.*flow.yz+.6*surfaceGroundGradient;
      float rippleKeep=(1.-sstep(.16,.32,fp))*(1.-sstep(.125,.25,fp*length(rippleRate)/6.283185307));
      surfaceGroundSlope+=sand*rippleKeep*.065*cos(ripple)*rippleRate;
    }
  }
  float bank=supplied?surfaceGroundBank:1e9;
  float distance=min(surfaceGroundShore,bank);
  float bankKeep=exposed*sstep(0.,.3,distance)*(1.-sstep(8.,36.,distance))*(1.-sstep(.5,.9,slope));
  bankKeep*=max(surfaceGroundBeach,1.-.55*grass);
  if(bankKeep>.01&&fp<1.){
    // Gravel bars resolve as aggregates before individual cobbles/pebbles.
    // Every band is a centred derivative, including while levels crossfade.
    float coarse=1.-sstep(2.,18.,distance);
    float k=1.-sstep(.4,1.,fp),mediumKeep=1.-sstep(.12,.3,fp);
    float fineKeep=1.-sstep(.01,.026,fp);
    for(int level=0;level<3;level++){
      float keep=level==0?k*(1.-mediumKeep):level==1?mediumKeep*(1.-fineKeep):fineKeep;
      if(keep<=0.)continue;
      float cell=level==0?8.:level==1?2.4:.26;
      float height=level==0?.75:level==1?.32:.03;
      vec4 cap=groundGravel(world/cell,salt+827u+uint(level));vec2 g=cap.yw/cell;
      float amount=bankKeep*keep*(.45+.55*coarse);
      surfaceGroundSlope+=amount*height*g;
      tone+=amount*(vec3(height*.20*dot(g,light)-.10*cap.x)+cap.z*vec3(.28,.25,.20)+cap.x*vec3(.08,.07,.16));
    }
  }
  float scree=sstep(.22,.42,slope)*(1.-sstep(1.1,1.7,slope))*(1.-.85*grass)*exposed;
  float blockKeep=1.-sstep(1.2,3.,fp);
  if(scree>.01&&blockKeep>0.){
    vec2 q=world/16.;uint h=groundHash(ivec3(ivec2(floor(q)),839),salt);
    if(float(h>>24u)/255.<.12+.16*rock){
      // Boulders spread over the cell and cast a shadow of their own size: a near-centred
      // block with one fixed shadow drew the same crescent on a regular 16 m lattice.
      vec2 radius=.09+.12*vec2(float((h>>16u)&15u),float((h>>20u)&15u))/15.;
      float reach=max(radius.x,radius.y)*1.9;
      vec2 centre=reach+(1.-2.*reach)*vec2(float(h&255u),float((h>>8u)&255u))/255.;
      vec2 d=fract(q)-centre;vec3 cap=surfaceGroundCap(d,radius);
      float amount=scree*blockKeep;
      surfaceGroundSlope+=amount*cap.yz*1.3/16.;
      vec2 shadowRadius=vec2(1.2*max(radius.x,radius.y),.95*min(radius.x,radius.y));
      vec2 shadowD=d+light*.55*shadowRadius.x;
      vec2 shadowUv=vec2(dot(shadowD,light),dot(shadowD,vec2(-light.y,light.x)));
      float shadow=surfaceGroundCap(shadowUv,shadowRadius).x;
      // Equal kernel integrals keep the cast shadow and its lit cap neutral.
      float centredShadow=shadow-cap.x*(shadowRadius.x*shadowRadius.y)/(radius.x*radius.y);
      float tip=cap.x*(sqrt(cap.x)-.75);
      float shadowStrength=1.-sstep(.85,.99,uGroundCover.y/max(length(uGroundCover.xyz),.001));
      tone+=vec3(amount*(.3*tip-.10*centredShadow*shadowStrength));
    }
  }
#endif
  return tone;
}
`;

/** Emitted after NEURAL_EARTH_MATERIAL_GLSL; normals use X/up/Z. Albedo is linear. The shade function
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
  if(uQuality>0)return sum;
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
    // The crease of the 8 m band and the groove of the 2.2 m band lie on the zero set of a smooth noise. At
    // battlemap range (surfaceFineGrain is zero and surfaceFineBreak one at every wider zoom) the fine grain of
    // surfaceMicro shifts that zero set, so the line zigzags at 30 and 9 cm, and a groove stays open along
    // part of its length only: a broken joint in the light, not the isoline of a noise.
    float fray=k==0?.1:k==1?.08:0.,raw=n.x+fray*surfaceFineGrain.x;
    float inverse=inversesqrt(1.+raw*raw),v=.72*raw*inverse,value=v,derivative=1.;
    if(k==0){float rounded=sqrt(v*v+.02);value=.3-rounded;derivative=-v/rounded;}
    else if(k==1){float groove=exp2(-32.*v*v);value=.4-groove;derivative=44.36141956*v*groove;}
    float a=groundAmplitude[k]*keep*(k==1?surfaceFineBreak:1.),d=a*derivative*.72*inverse*inverse*inverse;
    vec3 g=vec3(.36*n.y+.48*n.z/aspect-.8*n.w,-.8*n.y+.6*n.z/aspect,.48*n.y+.64*n.z/aspect+.6*n.w);
    sum+=vec4(value*a,(vec3(c*g.x-s*g.z,g.y,s*g.x+c*g.z)/wavelength+fray*vec3(surfaceFineGrain.y,0.,surfaceFineGrain.z))*d);
  }return sum;
}
// surfaceMicroSlope is the relief of the colour bands of this fragment, so a
// lit crack is also a dark one. Slope only: the height keeps its ground bands.
vec4 groundField(vec3 point,uint seed,float footprint){
  vec2 slope=surfaceMicroSlope+surfaceGroundSlope*(1./max(surfaceGroundNormalGain,.008)-1.);
  float clasts;return groundFieldWithClasts(point,seed,footprint,clasts)+vec4(0.,slope.x,0.,slope.y);
}
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
  vec3 micro=surfaceMicro(world,length(macro.yz),fp,cover.x,cover.z,seed);
  float clasts,meshClasts;vec4 detail=groundFieldWithClasts(vec3(world.x,0.,world.y),seed,fp,clasts);vec2 gradient=(detail.yw+surfaceMicroSlope)*gain+surfaceGroundSlope*(1.-gain);
  // Subtract the slope already represented by the displaced mesh. Zero means
  // an undisplaced macro surface; tiny positive means all bands represented.
  if(meshFootprint>0.)gradient-=groundFieldWithClasts(vec3(world.x,0.,world.y),seed,meshFootprint,meshClasts).yw*gain;
  GroundMaterial m;m.normal=normalize(vec3(-macro.y-gradient.x,1.,-macro.z-gradient.y));
  float form=clamp(detail.x*18.,-1.,1.),cavity=clamp(-detail.x*20.,0.,1.)*cover.x;
  // The slope cover keeps its weights; earthMaterial supplies this fragment's lithology.
  vec3 rock=mix(macroColor,surfaceRockTone,.7),soil=mix(macroColor,surfaceSoilTone,.18);
  vec3 grass=macroColor*vec3(.96,1.02,.93),snow=mix(macroColor,vec3(.87,.91,.95),.35);
  vec3 color=rock*cover.x+soil*cover.y+grass*cover.z+snow*cover.w;
  color*=1.+form*dot(cover,vec4(.12,.055,.045,.012));
  // The visible cap that displaced this stone also lightens its mineral crest
  // and slightly polishes it. No independent high-frequency color noise.
  float cap=groundSmooth(.05,.7,clasts);color*=1.+cap*.12*cover.x;
  color*=micro*(1.-cavity*.11);
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
// Relief light of the fragment, written around its shading by v2ShadeGround (terrainRenderV2Relief): x is the
// share of the sky the terrain leaves open (scales the ambient term), y the share of the primary light that no
// cast shadow cuts, z the slope light of the landform (a gain on the whole lit response). Neutral at 1.
vec3 groundReliefLight=vec3(1.);
vec3 shadeTerrainGround(GroundMaterial m,vec3 view,vec3 light,vec3 light2,float strength){
  float sky=groundReliefLight.x,sun=groundReliefLight.y,form=groundReliefLight.z;
  if(uQuality>0){
    // One diffuse light over the retained material and macro normal.
    float diffuse=max(dot(m.normal,normalize(light)),0.)*sun;
    return groundToDisplay(m.albedo*mix(1.,(.5*m.occlusion*sky+.75*diffuse)*form,clamp(strength,0.,1.)));
  }
  // In a cast shadow only the sky lights the ground: the ambient term turns blue and the slope stays readable.
  float amount=clamp(strength,0.,1.);vec3 ambient=m.albedo*(.34+.16*clamp(m.normal.y,0.,1.))*m.occlusion*sky*mix(vec3(.90,.98,1.14),vec3(1.),sun);
  // The second light stands for the sky opposite the sun: enclosed ground loses half of it.
  vec3 direct=groundBrdf(m,view,light)*(2.2*sun)+groundBrdf(m,view,light2)*(.58*(.5+.5*sky));
  return groundToDisplay(mix(m.albedo,ambient*form,amount)+direct*(form*max(strength,0.)));
}
`;
