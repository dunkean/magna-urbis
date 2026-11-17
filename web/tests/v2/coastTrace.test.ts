import { describe, expect, it } from 'vitest';
import { seaCoastInputs, coastTraceExtensions, coastTraceLineDistance, coastTraceMode, lineFromStroke, parseCoastTrace, rasterizeCoastTrace, simplifyStroke, type CoastTrace, type CoastTraceLine } from '../../src/v2/coastTrace';
import { defaultSettings } from '../../src/v2/settings';
import { effectiveTerrainSettings, validateTerrainSettings } from '../../src/v2/terrainSettings';
import { terrainCacheKey } from '../../src/v2/engine';
import { terrainStageValidityKeys } from '../../src/v2/stageValidity';
import { coastTraceMessages } from '../../src/v2/coastTraceMessages';
import { translate } from '../../src/v2/i18n';

const trace = (...lines: CoastTraceLine[]): CoastTrace => ({ version: 1, lines });
const vertical = (x = .25): CoastTraceLine => lineFromStroke([x, .1, x, .9])!;
const island = (a = .25, b = .75): CoastTraceLine => lineFromStroke([a,a, b,a, b,b, a,b, a,a])!;
const at = (mask: Uint8Array, x: number, y: number, n = 96) => mask[Math.floor(y*n)*n+Math.floor(x*n)];

describe('coast trace rasterization', () => {
  it('extends an open line to the border and fixes the smaller sea side at creation', () => {
    const west = vertical();
    expect(west.closed).toBe(false);expect(west.flipped).toBe(false);
    expect(coastTraceExtensions(west)).toEqual([[.25,0],[.25,1]]);
    const before=rasterizeCoastTrace(trace(west),96);
    expect(at(before,.1,.5)).toBe(1);expect(at(before,.7,.5)).toBe(0);
    west.flipped=!west.flipped;
    const after=rasterizeCoastTrace(trace(west),96);
    expect(after.every((v,i)=>v===1-before[i])).toBe(true);
    const east=vertical(.8);expect(east.flipped).toBe(true);
    expect(at(rasterizeCoastTrace(trace(east),96),.9,.5)).toBe(1);
    // Reversing the stroke changes its border polygon, but creation still selects the west sea.
    const reversed=lineFromStroke([.25,.9,.25,.1])!;
    expect(reversed.flipped).toBe(true);
    expect(rasterizeCoastTrace(trace(reversed),96)).toEqual(before);
    // Moving across the midpoint preserves the saved side instead of selecting a new smaller region.
    expect(at(rasterizeCoastTrace(trace({...vertical(),points:[.8,.1,.8,.9]}),96),.5,.5)).toBe(1);
  });
  it('paints an island with sea around it and an inland sea on a land base', () => {
    const loop=island();expect(loop.closed).toBe(true);
    const mask=rasterizeCoastTrace(trace(loop),96);
    expect(at(mask,.5,.5)).toBe(0);expect(at(mask,.1,.5)).toBe(1);
    const lake=rasterizeCoastTrace(trace({...loop,flipped:true}),96);
    expect(at(lake,.5,.5)).toBe(1);expect(at(lake,.1,.5)).toBe(0);
  });
  it('unions open sea sides, then paints closed loops in drawing order', () => {
    const north=lineFromStroke([.1,.25,.9,.25])!;
    const mask=rasterizeCoastTrace(trace(vertical(),north),96);
    expect(at(mask,.1,.7)).toBe(1);expect(at(mask,.7,.1)).toBe(1);expect(at(mask,.7,.7)).toBe(0);
    const loop:CoastTraceLine={points:[.1,.4,.4,.4,.4,.6,.1,.6],closed:true,flipped:false};
    const combined=rasterizeCoastTrace(trace(vertical(),loop),96);
    expect(at(combined,.15,.5)).toBe(0);expect(at(combined,.15,.7)).toBe(1);expect(at(combined,.7,.5)).toBe(0);
    const lake={...island(.15,.2),flipped:true};
    expect(at(rasterizeCoastTrace(trace(vertical(),loop,lake),96),.17,.17)).toBe(1);
    expect(at(rasterizeCoastTrace(trace(island(.1,.9),{...island(.3,.7),flipped:true}),96),.5,.5)).toBe(1);
    expect(at(rasterizeCoastTrace(trace({...island(.3,.7),flipped:true},island(.1,.9)),96),.5,.5)).toBe(0);
  });
  it('fills self-intersecting loops with the even-odd rule', () => {
    const scribble:CoastTraceLine={points:[.2,.2,.8,.8,.2,.8,.8,.2],closed:true,flipped:false};
    const mask=rasterizeCoastTrace(trace(scribble),100);
    expect(at(mask,.5,.3,100)).toBe(0);expect(at(mask,.25,.5,100)).toBe(1);
  });
  it('packs north-west row-major sea cells into little-endian bits and lowercase hex', () => {
    expect(coastTraceMode(trace(vertical(.4)),3)).toBe('traced:3:4900');
    expect(coastTraceMode(trace(vertical(.5)),4)).toBe('traced:4:3333');
    const t=trace(vertical()),mode=coastTraceMode(t)!;
    expect(mode).toMatch(/^traced:96:[0-9a-f]{2304}$/);
    const bytes=mode.split(':')[2].match(/../g)!.map(b=>parseInt(b,16)),mask=rasterizeCoastTrace(t,96);
    expect(mask.every((v,i)=>v===((bytes[i>>3]>>(i&7))&1))).toBe(true);
  });
  it('returns no mode for empty or uniform masks and rejects tiny strokes', () => {
    expect(coastTraceMode(trace())).toBeUndefined();
    expect(lineFromStroke([.5,.5,.51,.5])).toBeUndefined();
    expect(lineFromStroke([.5,.5,NaN,.6])).toBeUndefined();
    expect(coastTraceMode(trace({points:[.5,.5,.5,.5],closed:false,flipped:false}))).toBeUndefined();
    expect(coastTraceMode(trace(island(0,1)))).toBeUndefined();
    expect(coastTraceMode(trace({...island(0,1),flipped:true}))).toBeUndefined();
    expect(()=>rasterizeCoastTrace(trace(),0)).toThrow();
  });
  it('simplifies long strokes, keeps endpoints, and supports line selection', () => {
    const points=Array.from({length:1500},(_,i)=>[i/1499,.5+.1*Math.sin(i/7)]).flat();
    const simplified=simplifyStroke(points);
    expect(simplified.length).toBeLessThanOrEqual(400);expect(simplified.slice(0,2)).toEqual(points.slice(0,2));expect(simplified.slice(-2)).toEqual(points.slice(-2));
    expect(coastTraceLineDistance(vertical(),.25,0)).toBe(0);
    expect(coastTraceLineDistance(vertical(),.5,.5)).toBeCloseTo(.25);
  });
  it('strictly validates and clones saved geometry', () => {
    const value=trace(vertical());expect(parseCoastTrace(value)).toEqual(value);expect(parseCoastTrace(value).lines[0].points).not.toBe(value.lines[0].points);
    for(const bad of [null,{version:2,lines:[]},{...value,extra:true},trace({...vertical(),points:[0,0,1]}),trace({...vertical(),points:[0,0,Infinity,1]}),trace({...vertical(),points:[0,0,2,1]}),{version:1,lines:[{points:[0,0,1,1],closed:false}]},trace({...vertical(),points:Array(402).fill(.5)})])expect(()=>parseCoastTrace(bad)).toThrow(/coastTrace/);
    expect(()=>validateTerrainSettings({coastTrace:value})).not.toThrow();
    expect(()=>validateTerrainSettings({coastTrace:{version:1,lines:[{points:[0,0,1,1],closed:false,flipped:0}]}})).toThrow();
  });
});

describe('V2 coast trace settings', () => {
  it('provides translations for every new label in the additional interface languages',()=>{
    for(const row of coastTraceMessages)for(const language of ['es','pt','zh','ar','ru','ja'] as const)expect(translate(row[0],language)).not.toBe(row[0]);
  });
  it('injects the mode for procedural and neural sources and preserves the stored compass and other layers', () => {
    const s=defaultSettings();s.terrain={coastMask:4,islandMode:'archipelago',coastTrace:trace(vertical()),modification:{version:1,resolution:2,width:6000,delta:[0,0,0,0]}};
    const stored=structuredClone(s.terrain);
    for(const source of ['procedural','procedural-phasor','neural-wasm','neural-python','neural'] as const){s.runtime!.source=source;const effective=effectiveTerrainSettings(s,6000);expect(effective.coastMask).toBe(4);expect(effective.islandMode).toBe(coastTraceMode(stored.coastTrace!));expect(effective).not.toHaveProperty('coastTrace');}
    s.runtime!.source='procedural';s.terrain.sketch={version:1,resolution:2,heights:[0,0,0,0],processing:'surface'};
    expect(effectiveTerrainSettings(s,6000).islandMode).toBe('archipelago');
    delete s.terrain.sketch;s.options.importedHeight={w:1,h:1,rgba:new Uint8ClampedArray(4)};
    expect(effectiveTerrainSettings(s,6000).islandMode).toBe('archipelago');delete s.options.importedHeight;
    expect(s.terrain).toEqual(stored);
  });
  it('invalidates the terrain cache and coast stages through the existing mode signatures', () => {
    const s=defaultSettings();s.terrain={procedural:{},coastTrace:trace(vertical())};
    const cache=terrainCacheKey(s),keys=terrainStageValidityKeys(s);
    s.terrain.coastTrace!.lines[0].flipped=true;
    expect(terrainCacheKey(s)).not.toBe(cache);
    const next=terrainStageValidityKeys(s);
    expect(next.get('relief-coast-cut')).not.toBe(keys.get('relief-coast-cut'));
    expect(next.get('relief-coasts')).not.toBe(keys.get('relief-coasts'));
    expect(next.get('relief-source')).toBe(keys.get('relief-source'));
    delete s.terrain.coastTrace;
    expect(terrainCacheKey(s)).not.toBe(cache);
  });
});


describe('unified sea field',()=>{
  const zones=()=>({version:1 as const,resolution:8,weights:Array(8*8*5).fill(0)});
  const unpack=(mode:string)=>{const hex=mode.split(':')[2];return Uint8Array.from({length:96*96},(_,i)=>(parseInt(hex.slice((i>>3)*2,(i>>3)*2+2),16)>>(i&7))&1);};
  it('unites bilinearly sampled painted sea and traced sea, keeping zone weights unchanged',()=>{
    const z=zones();for(let y=0;y<8;y++)for(let x=5;x<8;x++)z.weights[(y*8+x)*5]=255;
    const saved=z.weights.slice(),coast=seaCoastInputs(z,trace(vertical()),4,'archipelago');
    const mask=unpack(coast.islandMode!);
    expect(at(mask,.1,.5)).toBe(1);expect(at(mask,.9,.5)).toBe(1);expect(at(mask,.45,.5)).toBe(0);
    expect(coast.coastMask).toBe(4);expect(z.weights).toEqual(saved);
  });
  it('uses the 128 threshold at cell centres and accepts a completely painted sea',()=>{
    const z=zones();for(let i=0;i<z.weights.length;i+=5)z.weights[i]=127;
    expect(seaCoastInputs(z,undefined,0,'island')).toEqual({coastMask:0,islandMode:'island'});
    for(let i=0;i<z.weights.length;i+=5)z.weights[i]=128;
    expect(unpack(seaCoastInputs(z,undefined,0,'island').islandMode!).every(v=>v===1)).toBe(true);
    for(let mask=0;mask<=255;mask++)expect(seaCoastInputs(z,undefined,mask,'island').coastMask).toBe(mask>0&&mask<255?mask:255);
  });
  it('samples across zone cell boundaries rather than taking the nearest zone',()=>{
    const z=zones();for(let y=0;y<8;y++)for(let x=4;x<8;x++)z.weights[(y*8+x)*5]=128;
    const mask=unpack(seaCoastInputs(z,undefined,0,'island').islandMode!);
    expect(at(mask,.51,.5)).toBe(0);expect(at(mask,.6,.5)).toBe(1);
  });
  it('retains compass and layout when neither painted sea nor trace defines sea',()=>{
    for(const mask of [0,1,85,254,255])expect(seaCoastInputs(zones(),undefined,mask,'peninsula')).toEqual({coastMask:mask,islandMode:'peninsula'});
  });
  it('ignores empty, all-land and all-sea traces in effective settings without removing recipe geometry', () => {
    for (const geometry of [trace(), trace({ points: [.5,.5,.5,.5], closed: false, flipped: false }), trace(island(0,1)), trace({ ...island(0,1), flipped: true })]) {
      const s = defaultSettings(); s.terrain = { coastTrace: geometry, coastMask: 4, islandMode: 'peninsula' };
      expect(seaCoastInputs(undefined, geometry, 4, 'peninsula')).toEqual({ coastMask: 4, islandMode: 'peninsula' });
      expect(effectiveTerrainSettings(s, 6000)).toMatchObject({ coastMask: 4, islandMode: 'peninsula' });
      expect(s.terrain.coastTrace).toBe(geometry);
    }
  });
  it('keeps coast edits downstream of every source generation',()=>{
    for(const source of ['procedural','neural-wasm','neural-python'] as const){
      const s=defaultSettings();s.runtime!.source=source;s.terrain={coastMask:0};
      for(const variant of ['automatic','heightmap','symbolic']){
        s.terrain={coastMask:0};
        if(variant==='symbolic')s.terrain.zones=zones();
        if(variant==='heightmap')s.terrain.sketch={version:1,resolution:8,heights:Array(64).fill(10),processing:'surface'};
        const before=terrainStageValidityKeys(s);s.terrain.coastMask=4;const after=terrainStageValidityKeys(s);
        expect(after.get('relief-source')).toBe(before.get('relief-source'));
        expect(after.get('relief-coast-cut')).not.toBe(before.get('relief-coast-cut'));s.terrain.coastMask=0;
      }
    }
  });
  it('rejects the removed fixed elevation drawing recipe',()=>expect(()=>validateTerrainSettings({drawing:{version:1,resolution:8,heights:Array(64).fill(0)}})).toThrow(/drawing/));
});
