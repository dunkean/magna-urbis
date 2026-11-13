import { describe, expect, it } from 'vitest';
import { paintHeight, paintZone, transformHeight, grayscaleHeight, terrainPaintDetail, type PaintBrush } from '../src/v2/reliefPaint';
import { applyTerrainModification, validateTerrainModification } from '../../rust/bridge/terrainModification';
import { parseTerrainZones } from '../../rust/bridge/terrainZones';

const brush: PaintBrush = { radius: .18, softness: .6, strength: 50, target: 300 };
describe('relief mini-paint data integrity', () => {
  it('levels the broad form while preserving the original fine noise', () => {
    const n=64,original=Float32Array.from({length:n*n},(_,i)=>100+((i%n+Math.floor(i/n))%2)*10),height=original.slice(),detail=terrainPaintDetail(original,n);
    paintHeight(height,original,n,.5,.5,{...brush,radius:.4,softness:.01,target:300},'level',detail);
    for(const i of [30*n+30,30*n+31,31*n+30,31*n+31])expect(height[i]-detail[i]).toBeCloseTo(300,4);
    expect(Math.abs(height[30*n+30]-height[30*n+31])).toBeGreaterThan(5);
  });
  it('keeps a sculpt as offsets, without mutating or accumulating onto its generated source', () => {
    const base=Float32Array.from({length:16**2},(_,i)=>i/7),delta=Array.from({length:16**2},(_,i)=>i%3===0?15:0),modification={version:1 as const,resolution:16,width:2400,delta};
    const first=applyTerrainModification(base,16,modification),second=applyTerrainModification(base,16,modification);
    expect(Array.from(first)).toEqual(Array.from(second));expect(first[0]).toBe(15);expect(base[0]).toBe(0);
    expect(()=>validateTerrainModification({...modification,delta:[NaN]})).toThrow();
    expect(()=>validateTerrainModification({...modification,delta:delta.map(()=>25000)})).toThrow();
  });
  it('edits local metre samples without quantizing or changing the source outside the brush', () => {
    const original=Float32Array.from({length:32**2},(_,i)=>i/13-20.125),height=original.slice();
    paintHeight(height,original,32,.5,.5,brush,'raise');
    expect(height[0]).toBe(original[0]);expect(height.at(-1)).toBe(original.at(-1));
    expect(height[16*32+16]).toBeGreaterThan(original[16*32+16]);
    expect(original[16*32+16]).toBe(Math.fround((16*32+16)/13-20.125));
    paintHeight(height,original,32,.5,.5,{...brush,softness:.01},'restore');
    expect(height[16*32+16]).toBe(original[16*32+16]);
  });
  it('constrains altitudes and smooths peaks without creating higher peaks', () => {
    const original=new Float32Array(32**2).fill(11990),height=original.slice();
    paintHeight(height,original,32,.5,.5,{...brush,strength:500},'raise');expect(Math.max(...height)).toBe(12000);
    const spike=new Float32Array(32**2);spike[16*32+16]=1000;
    paintHeight(spike,new Float32Array(spike.length),32,.5,.5,brush,'smooth');
    expect(spike[16*32+16]).toBeLessThan(1000);expect(Math.min(...spike)).toBeGreaterThanOrEqual(0);
  });
  it('maintains valid normalized zone masks when overpainting and erasing at map edges', () => {
    const weights=new Uint8Array(32**2*5);
    for(let k=0;k<20;k++)paintZone(weights,32,k%2?0:.08,.05,brush,k%5);
    expect(()=>parseTerrainZones({version:1,resolution:32,weights:Array.from(weights)})).not.toThrow();
    const sum=weights.reduce((a,b)=>a+b,0);paintZone(weights,32,.08,.05,brush,-1);
    expect(weights.reduce((a,b)=>a+b,0)).toBeLessThan(sum);
  });
  it('quantizes the grayscale preview only, preserving signed fractional metre data', () => {
    const heights=Float32Array.from([-123.456,-.001,.0001,987.654]),copy=heights.slice();
    const pixels=grayscaleHeight(heights,2,-123.456,987.654,2);
    for(let i=0;i<pixels.length;i+=4){expect(pixels[i]).toBe(pixels[i+1]);expect(pixels[i]).toBe(pixels[i+2]);expect(pixels[i+3]).toBe(255);}
    expect(Array.from(heights)).toEqual(Array.from(copy));expect(pixels[0]).toBe(0);expect(pixels[12]).toBe(255);
  });
  it('applies vertical transforms and centre crops without mutating the paint source', () => {
    const heights=Float32Array.from({length:64},(_,i)=>i/8-4),copy=heights.slice();
    expect(Array.from(transformHeight(heights,8,1,0,100))).toEqual(Array.from(heights));
    const transformed=transformHeight(heights,8,2,1,100);expect(transformed[0]).toBe((heights[0]-1)*2);
    const cropped=transformHeight(heights,8,1,0,50);expect(cropped[0]).toBeGreaterThan(heights[0]);expect(cropped.at(-1)).toBeLessThan(heights.at(-1)!);
    expect(Array.from(heights)).toEqual(Array.from(copy));
  });
});
