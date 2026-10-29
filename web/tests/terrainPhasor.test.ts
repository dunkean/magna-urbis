import { describe, expect, it } from 'vitest';
import { applyPhasorCpu, compactBudget, compactMountainWeight, configureCompactPlan, phasorAt, phasorUniforms, COMPACT_VERSION } from '../../rust/bridge/terrainPhasor';
import type { TerrainSettings } from '../../rust/bridge/terrain';
import { defaultSettings, terrainCacheKey } from '../src/v2/engine';
import { validateTerrainSettings } from '../src/v2/terrainSettings';
import { validateSettings } from '../src/v2/project';

const settings: TerrainSettings = { seed: 'compact-test', width: 5000, motifSize: 3000, relief: 'mountains', erosion: 1, mountainMix: .5, resolution: 512, source: 'procedural-phasor' };
describe('compact erosion and Phasor policy', () => {
  it('retains mountain variation above the old saturated upper band', () => {
    // With mountain mix .72, the old coverage clipped all these inputs to one.
    const coverage = [.05,.2,.4,.7].map(value => compactMountainWeight(value,.72));
    expect(coverage[3]-coverage[0]).toBeGreaterThan(.08);
    for(let i=1;i<coverage.length;i++) expect(coverage[i]).toBeGreaterThan(coverage[i-1]);
    for(const mix of [0,.5,.72,1]) for(const d of [-2,-1,0,1,2]) {
      expect(compactMountainWeight(d,mix)).toBeGreaterThan(0);
      expect(compactMountainWeight(d,mix)).toBeLessThan(1);
      expect(compactMountainWeight(d+.001,mix)).toBeGreaterThan(compactMountainWeight(d,mix));
    }
  });
  it('adds structural ridges to ordinary mountains without changing plains or hills', () => {
    const a=new Float32Array(41);a[13]=22;a[4]=20;a[37]=1;
    expect(configureCompactPlan(a,settings).parameters[32]).toBeGreaterThan(.5);
    expect(configureCompactPlan(a,{...settings,relief:'hills'}).parameters[32]).toBe(0);
    expect(configureCompactPlan(a,{...settings,relief:'flat'}).parameters[32]).toBe(0);
    expect(configureCompactPlan(a,{...settings,relief:'mixed',mountainMix:0}).parameters[32]).toBe(0);
    expect(a[32]).toBe(0);
  });
  it('bounds the working grid independently of the final million-cell surface', () => {
    for(const quality of ['fast','balanced','detailed'] as const) for(const width of [500,5000,10000,50000,100000]) {
      const {n}=compactBudget({...settings,width,phasor:{quality}});
      expect(n).toBeGreaterThanOrEqual(64);expect(n).toBeLessThanOrEqual(384);expect(n%16).toBe(0);
      expect((n+24)**2*112).toBeLessThan(19_000_000);
    }
  });
  it('retains uplift dose and physical padding while disabling dense erosion', () => {
    const input=new Float32Array(41);input[2]=320;input[4]=22.5;input[13]=60;input[19]=2;input[22]=.1;input[37]=1;input[38]=1;
    const {parameters:a,surface}=configureCompactPlan(input,settings);
    expect(a[13]*a[19]).toBeCloseTo(120);expect(a[4]*a[2]).toBeCloseTo(settings.width*1.44);
    expect(a[22]/a[4]).toBeCloseTo(input[22]/input[4]);expect(surface[3]).toBe(0);expect(a[16]).toBe(0);expect(a[38]).toBe(0);
    expect(input[2]).toBe(320);
  });
  it('has climate-dependent morphology with explicit recipe validation', () => {
    expect(phasorUniforms({...settings,climate:'arid'})[2]).toBeGreaterThan(phasorUniforms({...settings,climate:'cold'})[2]);
    expect(()=>validateTerrainSettings({phasor:{quality:'fast',intensity:1.2}})).not.toThrow();
    for(const phasor of [{quality:'unknown'},{intensity:-1},{intensity:Infinity},{typo:1}])expect(()=>validateTerrainSettings({phasor})).toThrow();
  });
  it('preserves flat ground, zero intensity and underwater elevations', () => {
    expect(phasorAt(150,250,2,17,90,1,()=>100)).toBe(100);
    expect(phasorAt(150,250,2,17,90,1,()=>-10)).toBe(-10);
    const slope=(x:number,y:number)=>100+.1*x+.2*y;
    expect(phasorAt(150,250,2,17,90,0,slope)).toBe(slope(150,250));
    expect(phasorAt(150,250,2,17,90,1,slope)).not.toBe(phasorAt(150,250,2,19,90,1,slope));
  });
  it('is deterministic and continuous across hash-cell boundaries', () => {
    const h=(x:number,y:number)=>200+.15*x+.2*y+3*Math.sin(x/150);
    for(const boundary of [0,90,180,-90]) {
      const a=phasorAt(boundary-1e-4,241,2,17,90,1,h),b=phasorAt(boundary+1e-4,241,2,17,90,1,h);
      expect(Math.abs(a-b)).toBeLessThan(.005);expect(a).toBe(phasorAt(boundary-1e-4,241,2,17,90,1,h));
    }
    const flat=new Float32Array(16*16).fill(90);
    expect(applyPhasorCpu(flat,{...settings,width:32})).toEqual(flat);
  });
  it('round-trips a new-source recipe and separates quality and climate cache identities', () => {
    const s=defaultSettings();s.runtime={backend:'rust',source:'procedural-phasor',compute:'gpu'};s.generation='procedural';s.terrain={phasor:{quality:'balanced',intensity:1}};
    expect(()=>validateSettings(JSON.parse(JSON.stringify(s)))).not.toThrow();
    const first=terrainCacheKey(s);s.terrain.phasor!.intensity=0;expect(terrainCacheKey(s)).not.toBe(first);
    expect(first).toContain(`"compactVersion":"${COMPACT_VERSION}"`);
    s.terrain.phasor!.intensity=1;s.terrain.climate='arid';expect(terrainCacheKey(s)).not.toBe(first);
    s.runtime.source='procedural';expect(terrainCacheKey(s)).not.toContain('compactVersion');
  });
});
