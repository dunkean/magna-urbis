import { describe,expect,it } from 'vitest';
import excerpt from './fixtures/surface-neural-teacher-40km-excerpt.json';
import { createTiltedStrataScenario,geologyFromScenario,rockUnitAtScenario,stratumCoordinateM,validateGeologyScenario } from '../src/surface/geologyScenario';
import { compileSurfaceWorld,retargetSurfaceWorld } from '../src/surface/compiler';
import { generateSurfaceCandidates } from '../src/surface/population';
import type { TerrainGrid } from '../src/surface/model';

function realTerrain():TerrainGrid {
  return {width:excerpt.width,height:excerpt.height,originX:excerpt.originX,originZ:excerpt.originZ,spacingM:excerpt.spacingM,heights:new Float32Array(excerpt.heights),
    source:{id:'genuine-neural-teacher-excerpt',version:excerpt.sourceSHA256,sourceLOD:0,sourceLODKnown:false,nativeSpacingM:excerpt.spacingM,provenance:excerpt.provenance}};
}
function scenario() {return createTiltedStrataScenario({originX:excerpt.originX+3.5*excerpt.spacingM,originZ:excerpt.originZ+3.5*excerpt.spacingM,
  basalContactElevationM:1165,strikeRadians:0,dipRadians:.2,strata:[{name:'Authored thin quartz bed',unitId:3,thicknessM:8},
    {name:'Authored carbonate bed',unitId:2,thicknessM:8},{name:'Authored open marl cap',unitId:4,thicknessM:null}]});}
function cut(t:TerrainGrid,x:number,z:number,width:number,height:number):TerrainGrid {
  return {...t,width,height,originX:t.originX+x*t.spacingM,originZ:t.originZ+z*t.spacingM,
    heights:Float32Array.from({length:width*height},(_,i)=>t.heights[(z+Math.floor(i/width))*t.width+x+i%width])};
}
describe('explicit tilted strata scenario',()=>{
  it('intersects physical beds with a genuine unchanged neural heightfield under one climate',()=>{
    const t=realTerrain(),before=new Uint8Array(t.heights.buffer).slice(),s=scenario(),geology=geologyFromScenario(t,s);
    const world=compileSurfaceWorld({seed:456,terrain:t,geology,climate:{version:'one-declared-climate',meanAnnualTempC:14,annualPrecipMm:950,elevationCorrected:true}});
    expect(new Uint8Array(t.heights.buffer)).toEqual(before);expect(new Uint8Array(world.terrain.heights.buffer)).toEqual(before);
    expect(new Set(world.fields.bedrock).size).toBeGreaterThanOrEqual(3);
    expect(Array.from(world.fields.temperatureC).every(value=>value===14)).toBe(true);
    const granite=world.fields.bedrock.findIndex(id=>id===1),carbonate=world.fields.bedrock.findIndex(id=>id===2);
    expect(granite).toBeGreaterThanOrEqual(0);expect(carbonate).toBeGreaterThanOrEqual(0);
    expect(Math.abs(world.fields.sand[granite]-world.fields.sand[carbonate])).toBeGreaterThan(.2);
    for(let i=0;i<64;i++)expect(world.fields.sand[i]+world.fields.silt[i]+world.fields.clay[i]).toBeCloseTo(1,6);
    expect(geology.provenance).toContain('demonstration');expect(geology.scenario).toEqual(s);
    expect([...world.fields.sourceRock].every(id=>geology.units.some(unit=>unit.id===id))).toBe(true);
  });
  it('keeps shared world contacts identical across different tile shapes and at planetary offsets',()=>{
    const t=realTerrain(),s=scenario(),full=geologyFromScenario(t,s),left=cut(t,0,0,5,8),right=cut(t,3,1,5,6);
    const a=geologyFromScenario(left,s),b=geologyFromScenario(right,s);expect(a.version).toBe(full.version);expect(b.version).toBe(full.version);
    for(let z=0;z<6;z++)for(let x=0;x<5;x++)expect(b.bedrock[z*5+x]).toBe(full.bedrock[(z+1)*8+x+3]);
    for(let z=0;z<8;z++)for(let x=0;x<5;x++)expect(a.bedrock[z*5+x]).toBe(full.bedrock[z*8+x]);
    const moved={...t,originX:t.originX+20000000,originZ:t.originZ-10000000};
    const translated=createTiltedStrataScenario({...s,originX:s.originX+20000000,originZ:s.originZ-10000000});
    expect(geologyFromScenario(moved,translated).bedrock).toEqual(full.bedrock);
  });
  it('uses true normal thickness, explicit upper contacts and strike rather than climate or random colour',()=>{
    const s=createTiltedStrataScenario({originX:0,originZ:0,basalContactElevationM:0,strikeRadians:0,dipRadians:0});
    expect(rockUnitAtScenario(s,0,0,-.01)).toBe(1);expect(rockUnitAtScenario(s,0,0,0)).toBe(3);
    expect(rockUnitAtScenario(s,0,0,119.999)).toBe(3);expect(rockUnitAtScenario(s,0,0,120)).toBe(2);
    expect(rockUnitAtScenario(s,0,0,200)).toBe(4);
    const inclined=createTiltedStrataScenario({strikeRadians:0,dipRadians:Math.PI/6});
    expect(stratumCoordinateM(inclined,90,0,100)).toBeCloseTo(stratumCoordinateM(inclined,0,0,100),12);
    expect(stratumCoordinateM(inclined,0,10,100)).toBeCloseTo(100*Math.cos(Math.PI/6)+5,12);
    expect(geologyFromScenario(realTerrain(),createTiltedStrataScenario({dipRadians:.1})).version).not.toBe(geologyFromScenario(realTerrain(),createTiltedStrataScenario({dipRadians:.2})).version);
  });
  it('leaves the default compiler scenario unchanged and preserves candidate identities on geometry retarget',()=>{
    const t=realTerrain(),baseline=compileSurfaceWorld({seed:9,terrain:t});expect(new Set(baseline.fields.bedrock)).toEqual(new Set([1]));
    const base=compileSurfaceWorld({seed:9,terrain:t,geology:geologyFromScenario(t,scenario())});
    const fine={...t,source:{...t.source,sourceLOD:-2,nativeSpacingM:t.spacingM/2}},retargeted=retargetSurfaceWorld(base,fine);
    const bounds={minX:t.originX+40,minZ:t.originZ+40,maxX:t.originX+220,maxZ:t.originZ+220};
    expect(generateSurfaceCandidates(retargeted,bounds)).toEqual(generateSurfaceCandidates(base,bounds));
  });
  it('rejects malformed strata, unknown units, nonfinite source heights, budgets and cancellation',()=>{
    const t=realTerrain(),s=scenario();expect(()=>validateGeologyScenario({...s,dipRadians:Math.PI/2})).toThrow();
    expect(()=>createTiltedStrataScenario({strata:[{name:'Missing unit',unitId:999,thicknessM:null}]})).toThrow();
    expect(()=>createTiltedStrataScenario({strata:[{name:'Finite cap',unitId:3,thicknessM:5}]})).toThrow();
    expect(()=>geologyFromScenario(t,s,{memoryBudgetBytes:1})).toThrow(/before allocation/);
    const controller=new AbortController();controller.abort();expect(()=>geologyFromScenario(t,s,{signal:controller.signal})).toThrow(/abort/i);
    t.heights[0]=NaN;expect(()=>geologyFromScenario(t,s)).toThrow(/Non-finite/);
  });
  it('snapshots the retained descriptor and rejects a contradictory canonical rock map',()=>{
    const t=realTerrain(),g=geologyFromScenario(t,scenario()),w=compileSurfaceWorld({seed:1,terrain:t,geology:g});
    const descriptor=structuredClone(w.geology.scenario);(g.scenario as any).originX+=1000;
    expect(w.geology.scenario).toEqual(descriptor);
    const bad=geologyFromScenario(t,scenario());bad.bedrock[0]=bad.bedrock[0]===1?2:1;
    expect(()=>compileSurfaceWorld({seed:1,terrain:t,geology:bad})).toThrow(/bedrock differs/);
  });
});
