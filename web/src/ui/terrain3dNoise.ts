import type { TerrainLook } from './terrainGl';

/** Isolated presentation surface. The derivative attenuation follows the idea
 * described by Inigo Quilez in function2009; analytic gradient noise and its
 * directional use are also documented by Gustavson/McEwan's psrdnoise tutorial.
 * This is our gradient-noise implementation, not a port of psrdnoise.
 * https://iquilezles.org/articles/function2009/function2009.pdf
 * https://stegu.github.io/psrdnoise/2d-tutorial/
 */
type Sampler = (x: number, y: number, metresPerPixel?: number) => number;
const clamp = (v: number, low: number, high: number): number => Math.max(low, Math.min(high, v));
const smooth = (low: number, high: number, v: number): number => { const t = clamp((v - low) / (high - low), 0, 1); return t * t * (3 - 2 * t); };
const hashes = new Uint32Array(4096), valid = new Uint8Array(4096), gradientX = new Float64Array(4096), gradientY = new Float64Array(4096);

function gradient(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h = (h ^ (h >>> 16)) >>> 0;
  const slot = h & 4095;
  if (!valid[slot] || hashes[slot] !== h) {
    const angle = h / 4294967296 * Math.PI * 2;
    hashes[slot] = h; gradientX[slot] = Math.cos(angle); gradientY[slot] = Math.sin(angle); valid[slot] = 1;
  }
  return slot;
}
/** Value and analytic derivatives, written into reusable storage. */
function noise(x: number, y: number, seed: number, out: Float64Array): void {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const aa = gradient(ix, iy, seed), ax = gradientX[aa], ay = gradientY[aa];
  const ab = gradient(ix + 1, iy, seed), bx = gradientX[ab], by = gradientY[ab];
  const ac = gradient(ix, iy + 1, seed), cx = gradientX[ac], cy = gradientY[ac];
  const ad = gradient(ix + 1, iy + 1, seed), dx = gradientX[ad], dy = gradientY[ad];
  const a = ax * fx + ay * fy, b = bx * (fx - 1) + by * fy, c = cx * fx + cy * (fy - 1), d = dx * (fx - 1) + dy * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const du = 30 * fx * fx * (fx * (fx - 2) + 1), dv = 30 * fy * fy * (fy * (fy - 2) + 1);
  out[0] = (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4;
  out[1] = (ax + (bx - ax) * u + (cx - ax) * v + (ax - bx - cx + dx) * u * v + du * ((b - a) + (a - b - c + d) * v)) * 1.4;
  out[2] = (ay + (by - ay) * u + (cy - ay) * v + (ay - by - cy + dy) * u * v + dv * ((c - a) + (a - b - c + d) * u)) * 1.4;
}

/** A canonical height function: x/y are metres; mpp is deliberately ignored.
 * Base probes, seeds and all wavelengths stay fixed through every camera LOD.
 * Coherent derivative-weighted ridged fBm supplies shallow erosion-like detail;
 * this is a display residual, not a hydraulic erosion simulation.
 */
export function createTerrain3dNoiseSampler(baseSampler: Sampler, look: TerrainLook): Sampler {
  const cell = Math.max(.25, look.sourceCell), detail = { ...look.detail }, seed = look.seed >>> 0;
  const base = (x: number, y: number): number => baseSampler(x, y, 0);
  if (!look.refine || detail.amplitude === 0) return base;
  const octaves = Math.min(12, Math.max(1, Math.round(detail.octaves) + 4)), lacunarity = clamp(detail.lacunarity + .5, 1.5, 2.5);
  const samples = new Float64Array(3), probes = Math.max(.125, cell * .25), radius = cell * 4;
  return (x, y): number => {
    const h = base(x, y); if (h <= 0) return h;
    const gx = (base(x + probes, y) - base(x - probes, y)) / (2 * probes), gy = (base(x, y + probes) - base(x, y - probes)) / (2 * probes);
    const slope = Math.hypot(gx, gy), north = base(x, y - radius), south = base(x, y + radius), east = base(x + radius, y), west = base(x - radius, y);
    const relief = Math.max(Math.abs(h - north), Math.abs(h - south), Math.abs(h - east), Math.abs(h - west)) / radius;
    const crest = smooth(.002, .025, (h - (north + south + east + west) * .25) / radius) * smooth(.04, .2, Math.max(slope, relief));
    const mountain = smooth(.04, .2, slope);
    if (crest === 0 && mountain === 0) return h;
    const downhillX = gx / Math.max(slope, 1e-6), downhillY = gy / Math.max(slope, 1e-6);
    let wavelength = cell * 8 * detail.start, residual = 0, accumulatedX = 0, accumulatedY = 0;
    for (let k = 0; k < octaves && wavelength >= .125; k++, wavelength /= lacunarity) {
      const angle = .37 + k * 2.399963229728653, c = Math.cos(angle), s = Math.sin(angle), ratio = wavelength / cell;
      noise((x * c - y * s) / wavelength, (x * s + y * c) / wavelength, (seed + k * 7919) >>> 0, samples);
      const rounded = Math.sqrt(samples[0] * samples[0] + .0025), signal = samples[0] * .45 + (.24 - rounded) * .55;
      const derivative = .45 - .55 * samples[0] / rounded;
      const dx = (samples[1] * c + samples[2] * s) * derivative, dy = (-samples[1] * s + samples[2] * c) * derivative;
      const broad = smooth(1.4, 3.5, ratio), fine = 1 - smooth(.045, .12, ratio);
      const envelope = broad * crest + fine * mountain * 3 + (1 - Math.max(broad, fine)) * mountain * .015;
      const terrainSlope = broad > .5 ? Math.max(slope, relief) : slope;
      const slopeWeight = Math.pow(Math.max(terrainSlope + detail.flat, 1e-6), detail.slope);
      accumulatedX += dx * (broad + fine * .15); accumulatedY += dy * (broad + fine * .15);
      const erosionWeight = 1 / (1 + .65 * (accumulatedX * accumulatedX + accumulatedY * accumulatedY));
      const directionWeight = 1 / (1 + 1.5 * Math.abs(dx * downhillX + dy * downhillY));
      const hurst = Math.pow(Math.max(ratio, 1), clamp(detail.hurst, .7, 1.3) - 1) * Math.pow(Math.min(ratio, 1), Math.max(0, detail.hurst - 1));
      residual += signal * wavelength * detail.amplitude * hurst * envelope * slopeWeight * erosionWeight * directionWeight;
    }
    return h + residual * (detail.shore > 0 ? clamp(h / detail.shore, 0, 1) : 1);
  };
}

/** Isolated host wrapper uses its native level(0) and existing detail uniforms.
 * terrain3dDetail returns a delta, for s += terrain3dDetail(world,s). Noise
 * derivatives condition the fractal and provide its lighting normal; envelope
 * derivatives are deliberately omitted, as in the original display refiner. */
export const TERRAIN_3D_NOISE_GLSL = `
float terrain3dBaseHeight(vec2 world) {
  float h=level(0,world).x;return uFloor>0.?max(h,uFloor):h;
}
vec3 terrain3dGradientNoise(vec2 p, uint seed) {
  vec2 cell = floor(p), f = p - cell; vec2 g[4];
  for (int k=0;k<4;k++) {
    uvec2 q=uvec2(ivec2(cell))+uvec2(k&1,k>>1);
    uint h=q.x*374761393u^q.y*668265263u^seed;
    h=(h^(h>>13u))*1274126177u;h^=h>>16u;
    float angle=float(h)/4294967296.0*6.283185307179586;g[k]=vec2(cos(angle),sin(angle));
  }
  float a=dot(g[0],f),b=dot(g[1],f-vec2(1.,0.)),c=dot(g[2],f-vec2(0.,1.)),d=dot(g[3],f-vec2(1.));
  vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
  float value=a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y;
  vec2 gradient=g[0]+(g[1]-g[0])*u.x+(g[2]-g[0])*u.y+(g[0]-g[1]-g[2]+g[3])*u.x*u.y
    +du*vec2((b-a)+(a-b-c+d)*u.y,(c-a)+(a-b-c+d)*u.x);
  return vec3(value,gradient)*1.4;
}
vec3 terrain3dSurface(vec2 world,float sourceCell,uint seed,vec4 a,vec3 b,int octaveCount) {
  float cell=max(.25,sourceCell),h=terrain3dBaseHeight(world);if(h<=0.)return vec3(h,0.,0.);
  float probe=max(.125,cell*.25),radius=cell*4.;
  vec2 g=vec2(terrain3dBaseHeight(world+vec2(probe,0.))-terrain3dBaseHeight(world-vec2(probe,0.)),terrain3dBaseHeight(world+vec2(0.,probe))-terrain3dBaseHeight(world-vec2(0.,probe)))/(2.*probe);
  float slope=length(g),n=terrain3dBaseHeight(world-vec2(0.,radius)),s=terrain3dBaseHeight(world+vec2(0.,radius)),e=terrain3dBaseHeight(world+vec2(radius,0.)),w=terrain3dBaseHeight(world-vec2(radius,0.));
  float relief=max(max(abs(h-n),abs(h-s)),max(abs(h-e),abs(h-w)))/radius;
  float crest=smoothstep(.002,.025,(h-(n+s+e+w)*.25)/radius)*smoothstep(.04,.2,max(slope,relief));
  float mountain=smoothstep(.04,.2,slope);if(a.x==0.||(crest==0.&&mountain==0.))return vec3(h,g);
  vec2 downhill=g/max(slope,1e-6),accumulated=vec2(0.),residualGradient=vec2(0.);float wavelength=cell*8.*a.w,residual=0.;
  for(int k=0;k<12;k++) {
    if(k>=min(12,max(1,octaveCount+4))||wavelength<.125)break;
    float angle=.37+float(k)*2.399963229728653,c=cos(angle),sn=sin(angle),ratio=wavelength/cell;
    vec3 v=terrain3dGradientNoise(vec2(world.x*c-world.y*sn,world.x*sn+world.y*c)/wavelength,seed+uint(k*7919));
    float rounded=sqrt(v.x*v.x+.0025),signal=v.x*.45+(.24-rounded)*.55;
    vec2 d=vec2(v.y*c+v.z*sn,-v.y*sn+v.z*c)*(.45-.55*v.x/rounded);
    float broad=smoothstep(1.4,3.5,ratio),fine=1.-smoothstep(.045,.12,ratio);
    float envelope=broad*crest+fine*mountain*3.+(1.-max(broad,fine))*mountain*.015;
    float slopeWeight=pow(max((broad>.5?max(slope,relief):slope)+b.y,1e-6),b.x);
    accumulated+=d*(broad+fine*.15);
    float weight=1./(1.+.65*dot(accumulated,accumulated))/(1.+1.5*abs(dot(d,downhill)));
    float hurst=pow(max(ratio,1.),clamp(a.y,.7,1.3)-1.)*pow(min(ratio,1.),max(0.,a.y-1.));
    float amplitude=wavelength*a.x*hurst*envelope*slopeWeight*weight;
    residual+=signal*amplitude;residualGradient+=d*(amplitude/wavelength);
    wavelength/=clamp(a.z+.5,1.5,2.5);
  }
  float shore=b.z>0.?clamp(h/b.z,0.,1.):1.;
  return vec3(h+residual*shore,g+residualGradient*shore);
}
vec3 terrain3dDetail(vec2 world,vec3 base) {
  return terrain3dSurface(world,uSourceCell,uSeed,uDetailA,uDetailB,uOctaves)-base;
}
`;
