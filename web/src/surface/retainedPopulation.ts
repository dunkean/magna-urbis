import {fingerprint,getCanonicalSurfaceContext} from './compiler';
import {SURFACE_POPULATION_VERSION,type SurfaceWorld,type TerrainGrid} from './model';

/** Borrow an exact canonical eligibility/height sampler from a retained packet.
 * This is NOT a reconstructed compile input: unknown climate/process inputs are
 * never inferred. Nothing returned here replaces the packet's actual world. */
export function recoverRetainedPopulationSampler(packet:{world:SurfaceWorld;terrainParents?:Array<{terrain:TerrainGrid;canonicalContextId:string}>}) {
  const w=packet.world,c=getCanonicalSurfaceContext(w);
  const expectedPopulation=fingerprint([c.versions.environment,c.versions.occupation,w.seed,SURFACE_POPULATION_VERSION].join(':'));
  if(expectedPopulation!==c.versions.population)throw new Error('Retained population recipe differs; refusing to migrate acceptance silently');
  if(!w.canonicalContextRef){
    if(fingerprint(w.terrain)!==w.versions.terrain)throw new Error('Canonical source terrain version differs from its saved heightfield');
    return{sampler:w,parent:w.terrain,contextId:c.id,terrainHash:w.versions.terrain};
  }
  const matching=(packet.terrainParents??[]).filter(p=>p.canonicalContextId===c.id&&p.terrain.width===c.grid.width&&p.terrain.height===c.grid.height&&p.terrain.originX===c.grid.originX&&p.terrain.originZ===c.grid.originZ&&p.terrain.spacingM===c.grid.spacingM&&p.terrain.source.id===c.source.id&&p.terrain.source.version===c.source.version);
  let terrain:TerrainGrid|undefined,parent:TerrainGrid|undefined;
  for(const p of matching){
    // Values must be stored, finite Float32 samples. A context layer is never
    // substituted for missing heights. The terrain hash verifies the original
    // serialized kernel/source declaration; actual parent support stays intact.
    if(!(p.terrain.heights instanceof Float32Array)||p.terrain.heights.length!==c.grid.width*c.grid.height||p.terrain.heights.some(v=>!Number.isFinite(v)))continue;
    for(const reconstruction of [p.terrain.reconstruction,undefined,'bilinear-samples','cubic-bspline-controls'] as const){
      const candidate={...p.terrain,source:{...c.source}};
      if(reconstruction===undefined)delete candidate.reconstruction;else candidate.reconstruction=reconstruction;
      if(fingerprint(candidate)===c.versions.terrain){terrain=candidate;parent=p.terrain;break;}
    }
    if(terrain)break;
  }
  if(!terrain||!parent)throw new Error('No stored parent heightfield reproduces the exact canonical terrain hash; refusing inferred heights');
  const v=c.versions,id=fingerprint([v.environment,v.occupation,v.population,v.materialLibrary,v.surfaceState,w.seed,v.surfaceLayers].join(':'));
  if(fingerprint([id,'canonical-context-1'].join(':'))!==c.id)throw new Error('Canonical identity cannot be recovered from stored versions');
  const sampler:SurfaceWorld={...w,id,terrain,bounds:{...c.bounds},fields:c.fields,versions:{...v},geology:{...w.geology,bedrock:c.fields.bedrock},canonicalContext:undefined,canonicalContextRef:undefined,geometryDetail:undefined};
  return{sampler,parent,contextId:c.id,terrainHash:c.versions.terrain};
}
