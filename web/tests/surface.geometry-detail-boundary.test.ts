import { describe,expect,it } from 'vitest';
import { deriveSurfaceGeometryDetail,hydrateSurfaceGeometryDetail,validateSurfaceGeometryDetail } from '../src/surface/geometryDetail';
import { createTiltedStrataScenario,validateGeologyScenario } from '../src/surface/geologyScenario';
import type { TerrainGrid } from '../src/surface/model';

function source():TerrainGrid{return {width:9,height:9,originX:0,originZ:0,spacingM:1,heights:Float32Array.from({length:81},(_,i)=>3*(i%9)-Math.floor(i/9)),
  source:{id:'unit-real-height-source',version:'actual-v1',sourceLOD:-6,nativeSpacingM:1,sourceLODKnown:true}};}
const json=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?Array.from(v as unknown as ArrayLike<number>):v));
describe('strict physical geometry detail boundary',()=>{
  it('validates typed fields without cloning and restores exact typed constructors from JSON arrays',()=>{
    const t=source(),detail=deriveSurfaceGeometryDetail(t,{canonicalContextId:'canonical-1',geologyScenario:createTiltedStrataScenario()});
    validateSurfaceGeometryDetail(detail,t,'canonical-1');const retained=hydrateSurfaceGeometryDetail(detail,t,'canonical-1');
    expect(retained.slopeRadians).toBe(detail.slopeRadians);expect(retained.normalXYZ).toBe(detail.normalXYZ);expect(retained.treeSupport).toBe(detail.treeSupport);
    const restored=hydrateSurfaceGeometryDetail(json(detail),t,'canonical-1');
    expect(restored.slopeRadians).toBeInstanceOf(Float32Array);expect(restored.treeSupport).toBeInstanceOf(Uint8Array);expect(restored.localBedrockUnitId).toBeInstanceOf(Uint16Array);
    expect(restored.normalXYZ).toEqual(detail.normalXYZ);expect(restored.id).toBe(detail.id);
    expect(()=>validateSurfaceGeometryDetail(json(detail),t,'canonical-1')).toThrow(/typed constructor/);
  });
  it('rejects edited source bytes, wrong canonical references, stale identities and forged support descriptors',()=>{
    const t=source(),detail=deriveSurfaceGeometryDetail(t,{canonicalContextId:'canonical-1'});
    expect(()=>hydrateSurfaceGeometryDetail(detail,t,'other')).toThrow(/context mismatch/);
    t.heights[40]+=.125;expect(()=>hydrateSurfaceGeometryDetail(detail,t,'canonical-1')).toThrow(/identity/);t.heights[40]-=.125;
    expect(()=>hydrateSurfaceGeometryDetail({...detail,id:'forged'},t)).toThrow(/identity/);
    expect(()=>hydrateSurfaceGeometryDetail({...detail,supportDescriptor:{...detail.supportDescriptor,vetoMinimumConfidence:0}},t)).toThrow(/support descriptor/);
    expect(()=>hydrateSurfaceGeometryDetail({...detail,fullSupportBounds:null},t)).toThrow(/bounds mismatch/);
    expect(()=>hydrateSurfaceGeometryDetail(detail,{...t,source:{...t.source,version:'edited-v2'}})).toThrow(/source\/grid\/kernel/);
  });
  it('rejects malformed lengths, wrong typed arrays, nonfinite/range values, normals and unsupported cliff vetoes',()=>{
    const t=source(),detail=deriveSurfaceGeometryDetail(t);
    const changes:Array<(v:any)=>void>=[v=>v.normalXYZ.pop(),v=>v.slopeRadians[0]=-1,v=>v.slopeRadians[0]=Math.PI,
      v=>v.edgeConfidence[0]=NaN,v=>v.bedrockExposure[0]=2,v=>v.normalXYZ[0]=.5,v=>v.treeSupport[0]=0,v=>v.treeSupport[40]=.5,
      v=>v.statistics.meanSlopeRadians+=.1,v=>v.aspectRadians[40]+=.2,v=>v.rockExposurePotential[40]=0];
    for(const change of changes){const bad=json(detail);change(bad);expect(()=>hydrateSurfaceGeometryDetail(bad,t)).toThrow();}
    expect(()=>hydrateSurfaceGeometryDetail({...detail,slopeRadians:new Float64Array(detail.slopeRadians as ArrayLike<number>)},t)).toThrow(/typed constructor/);
    expect(()=>hydrateSurfaceGeometryDetail(detail,t,undefined,1)).toThrow(/before allocation/);
    const cyclic:any={...detail.source};cyclic.self=cyclic;expect(()=>hydrateSurfaceGeometryDetail({...detail,source:cyclic},t)).toThrow(/cyclic/);
  });
  it('preserves an independently versioned conditioned layer without changing raw geometry identity',()=>{
    const t=source(),detail=deriveSurfaceGeometryDetail(t,{canonicalContextId:'canonical-1'}),conditioned={...detail,surfaceConditioning:{version:'surface-conditioning-1',canonicalEnvironmentVersion:'env-2',
      bedrockExposure:Float32Array.from(detail.bedrockExposure as ArrayLike<number>,v=>v*.25)}};
    const checked=hydrateSurfaceGeometryDetail(conditioned,t,'canonical-1');expect(checked.id).toBe(detail.id);expect(checked.surfaceConditioning?.bedrockExposure).toBe(conditioned.surfaceConditioning.bedrockExposure);
    const restored=hydrateSurfaceGeometryDetail(json(conditioned),t,'canonical-1');expect(restored.surfaceConditioning?.bedrockExposure).toBeInstanceOf(Float32Array);
    for(const bad of [{...conditioned,surfaceConditioning:{...conditioned.surfaceConditioning,version:'unknown'}},
      {...conditioned,surfaceConditioning:{...conditioned.surfaceConditioning,canonicalEnvironmentVersion:''}},
      {...conditioned,surfaceConditioning:{...conditioned.surfaceConditioning,bedrockExposure:new Float32Array(80)}}])expect(()=>hydrateSurfaceGeometryDetail(bad,t)).toThrow();
  });
  it('limits explicit rock catalogues to core-compatible units and checks local IDs against the physical scenario',()=>{
    const s=createTiltedStrataScenario();expect(()=>validateGeologyScenario({...s,units:[{...s.units[0],id:0}]})).toThrow(/catalogue/);
    expect(()=>validateGeologyScenario({...s,units:Array.from({length:65},(_,i)=>({...s.units[0],id:i+1}))})).toThrow(/scenario/);
    const t=source(),detail=deriveSurfaceGeometryDetail(t,{geologyScenario:s}),bad=json(detail);bad.localBedrockUnitId[0]=65535;
    expect(()=>hydrateSurfaceGeometryDetail(bad,t)).toThrow(/Local bedrock/);
    expect(()=>hydrateSurfaceGeometryDetail({...detail,geologyScenario:undefined},t)).toThrow(/together/);
  });
});
