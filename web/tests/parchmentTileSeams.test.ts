import './vectorWaterWasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRenderGeometry } from '../../rust/bridge/renderGeometry';
import { fakeWorld, mockCanvas, MockPath2D } from '../scripts/fakeworld';
import { createCanvasRenderer, type CanvasLike } from '../src/render/canvas';
import type { Polygon } from '../src/gen/types';
const square = (x:number,y:number,w:number,h:number): Polygon => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
beforeAll(() => loadRenderGeometry());

describe('parchment tile forest fringe', () => {
  it('does not paint the woodland fringe when the surrounding land is outside the viewport', () => {
    const w=fakeWorld({mapSize:3000,buildings:0,streets:0,landAreas:0});
    w.urban=undefined; w.site=undefined; w.settlements=[]; w.roads=[];
    w.terrain.rivers=[]; w.terrain.lakes=[]; w.options.contours=false; w.options.labels=false;
    w.landuse!.areas=[{kind:'forest',poly:square(0,0,3000,3000)}];
    const run=(withRemoteMeadow:boolean) => {
      const world={...w,landuse:{...w.landuse!,areas:[...w.landuse!.areas,...(withRemoteMeadow?[{kind:'meadow' as const,poly:square(20,20,100,100)}]:[])]}};
      const m=mockCanvas(300,300);
      const renderer=createCanvasRenderer(m.canvas as unknown as CanvasLike,world,'parchment',{Path2D:MockPath2D as never,dpr:1,raster:false,terrain:()=>null});
      renderer.draw({cx:1500,cy:2400,scale:1}); renderer.dispose();
      return m.log.calls.translate ?? 0;
    };
    expect(run(true)).toBe(run(false));
  });
});
