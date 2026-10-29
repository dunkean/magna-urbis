/** Compact procedural source policy and scalar Phasor reference. No WASM/GPU imports. */
import type { TerrainSettings } from './terrain';
import { seedHash } from './terrainAdjust';

export const COMPACT_RELIEFS = ['flat', 'hills', 'valley', 'canyon', 'mountains', 'mixed', 'high-mountains'] as const;
export type PhasorQuality = 'fast' | 'balanced' | 'detailed';
export interface PhasorSettings { quality?: PhasorQuality; intensity?: number }
export const COMPACT_VERSION = 'compact-erosion-phasor-v2-summits';
export const COMPACT_PROFILES = {
  temperate: { incision: 1, thermal: 1, amplitude: 1, wavelength: 1 },
  oceanic: { incision: 1.2, thermal: 1.3, amplitude: .7, wavelength: 1.15 },
  mediterranean: { incision: .95, thermal: .85, amplitude: 1.15, wavelength: .9 },
  arid: { incision: .65, thermal: .65, amplitude: 1.3, wavelength: .85 },
  cold: { incision: .7, thermal: 1.5, amplitude: .5, wavelength: 1.2 },
  tropical: { incision: 1.4, thermal: 1.25, amplitude: .85, wavelength: .9 },
} as const;
export const compactProfile = (s: Pick<TerrainSettings, 'climate'>) => COMPACT_PROFILES[s.climate ?? 'temperate'];
/** Soft regional coverage retains variations above the old smoothstep's upper cutoff.
 * Used by the GPU uplift before erosion, not as detail painted onto a flat summit. */
export function compactMountainWeight(distribution: number, mountainMix: number): number {
  const x = (distribution + (mountainMix - .5) * 1.4) / .28;
  return .5 + .5 * x / Math.sqrt(1 + x*x);
}
export function validatePhasorSettings(value?: PhasorSettings): void {
  if (value?.quality !== undefined && !['fast','balanced','detailed'].includes(value.quality)) throw new Error('Unknown compact Phasor quality.');
  if (value?.intensity !== undefined && (!Number.isFinite(value.intensity) || value.intensity < 0 || value.intensity > 2)) throw new Error('Compact Phasor intensity must be between 0 and 2.');
}
export function compactBudget(settings: Pick<TerrainSettings, 'width' | 'phasor'>): { n: number; steps: number } {
  validatePhasorSettings(settings.phasor);
  const quality = settings.phasor?.quality ?? 'balanced';
  const cell = quality === 'fast' ? 100 : quality === 'detailed' ? 40 : 65;
  return { n: Math.max(64, Math.min(384, Math.ceil(settings.width * 1.44 / cell / 16) * 16)), steps: quality === 'fast' ? 8 : quality === 'detailed' ? 20 : 12 };
}
/** Preserve physical extent, uplift dose and incision coefficient when changing the grid. */
export function configureCompactPlan(original: Float32Array, settings: TerrainSettings, coast?: Float32Array): { parameters: Float32Array; surface: Float32Array } {
  const a = original.slice(), budget = compactBudget(settings), profile = compactProfile(settings);
  const previousCell = a[4], oldSteps = a[13];
  a[2] = budget.n; a[4] = settings.width * 1.44 / budget.n;
  a[13] = budget.steps;
  a[19] *= oldSteps / a[13]; a[22] *= a[4] / previousCell * profile.incision;
  a[16] = 0; // Phasor replaces the legacy fine ridged texture.
  if (settings.relief === 'flat') a[12] *= .06;
  // Structural ridges belong to uplift before erosion, including ordinary mountains.
  if (settings.relief === 'mountains') a[32] = .55;
  else if (settings.relief === 'mixed') a[32] = .55 * Math.sqrt(settings.mountainMix);
  a[37] *= profile.thermal; a[38] = 0; // No post-drainage domain warp.
  const surface = (coast ?? a.slice(24, 32)).slice();
  surface[0] = budget.n + 24; surface[1] = settings.width / budget.n; surface[2] = -12 * surface[1];
  if (coast) {
    surface[3] = Math.min(2, surface[3]);
  } else { surface[3] = 0; }
  return { parameters: a, surface };
}
export function phasorUniforms(settings: TerrainSettings, coast = false): Float32Array {
  validatePhasorSettings(settings.phasor);
  const profile = compactProfile(settings);
  return new Float32Array([settings.width / 1024, seedHash(settings.seed) & 65535,
    coast ? 0 : (settings.phasor?.intensity ?? 1) * profile.amplitude,
    Math.max(48, Math.min(160, settings.motifSize / 24)) * profile.wavelength, ...new Array(12).fill(0)]);
}
const smooth = (a: number, b: number, v: number): number => { const t = Math.max(0, Math.min(1, (v-a)/(b-a))); return t*t*(3-2*t); };
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ seed) >>> 0;
  h = Math.imul(h ^ h >>> 16, 0x7feb352d) >>> 0; h = Math.imul(h ^ h >>> 15, 0x846ca68b) >>> 0;
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
/** Finite-support complex Gabor convolution, followed by a rounded triangle profile.
 * Carriers use the slope at their immutable impulses, not a query-local rotation.
 * This is a new GPU-oriented adaptation of Grenier 2024, not upstream byte parity. */
export function phasorAt(x: number, y: number, cell: number, seed: number, wavelength: number, intensity: number,
  height: (x: number, y: number) => number): number {
  const span = Math.max(cell,wavelength*.3);
  const h = height(x,y), gx = (height(x+span,y)-height(x-span,y))/(2*span), gy = (height(x,y+span)-height(x,y-span))/(2*span);
  const slope = Math.hypot(gx,gy);
  const curvature = (height(x+span,y)+height(x-span,y)+height(x,y+span)+height(x,y-span)-4*h)/(span*span);
  const mask = smooth(.012,.20,slope) * (1-smooth(.0005,.004,curvature)) * smooth(1,12,h);
  if (mask === 0 || intensity === 0) return h;
  let delta = 0, parent = 1;
  for (let octave=0;octave<3;octave++) {
    const wave = wavelength / 3**octave, resolved = smooth(4,7,wave/cell);
    if (!resolved) continue;
    let real=0, imag=0, weight=0;
    const cx=Math.floor(x/wave),cy=Math.floor(y/wave);
    for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) {
      const ix=cx+dx,iy=cy+dy, px=(ix+.15+.7*hash(ix,iy,seed+octave*17))*wave,py=(iy+.15+.7*hash(ix,iy,seed+octave*17+1))*wave;
      const rx=(x-px)/wave,ry=(y-py)/wave,r=Math.hypot(rx,ry);
      if(r>=2)continue;
      const radius=Math.max(cell,wave*.4);
      const sx=height(px+radius,py)-height(px-radius,py),sy=height(px,py+radius)-height(px,py-radius),len=Math.max(1e-6,Math.hypot(sx,sy));
      const jitter=(hash(ix,iy,seed+octave*17+2)-.5)*.5,cs=Math.cos(jitter),sn=Math.sin(jitter);
      const ax=(-sy*cs-sx*sn)/len,ay=(-sy*sn+sx*cs)/len;
      const angle=2*Math.PI*((rx*ax+ry*ay)*(0.85+.3*hash(ix,iy,seed+3))+hash(ix,iy,seed+4));
      const w=Math.exp(-2*(rx*rx+ry*ry))*(1-smooth(1.3,2,r));
      real+=w*Math.cos(angle);imag+=w*Math.sin(angle);weight+=w;
    }
    const c=real/Math.sqrt(real*real+imag*imag+.015*weight*weight+1e-12), pattern=2/Math.PI*Math.asin(Math.max(-1,Math.min(1,c)));
    const amplitude=Math.min(wave*.025,slope*wave*.12)*intensity*mask*resolved*parent;
    delta+=amplitude*pattern;
    parent*=.2*smooth(-.8,.7,pattern);
  }
  return Math.max(.3,h+delta);
}
export function applyPhasorCpu(values: Float32Array, settings: TerrainSettings): Float32Array {
  const n=Math.sqrt(values.length),cell=settings.width/n, u=phasorUniforms(settings);
  const sample=(x:number,y:number):number=>{
    const px=Math.max(0,Math.min(n-1,x/cell-.5)),py=Math.max(0,Math.min(n-1,y/cell-.5)),ix=Math.floor(px),iy=Math.floor(py),tx=px-ix,ty=py-iy;
    const at=(a:number,b:number)=>values[Math.min(n-1,b)*n+Math.min(n-1,a)];
    return (at(ix,iy)*(1-tx)+at(ix+1,iy)*tx)*(1-ty)+(at(ix,iy+1)*(1-tx)+at(ix+1,iy+1)*tx)*ty;
  };
  const out=new Float32Array(values.length);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)out[y*n+x]=phasorAt((x+.5)*cell,(y+.5)*cell,cell,u[1],u[3],u[2],sample);
  return out;
}
