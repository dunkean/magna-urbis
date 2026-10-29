import type { World, Settlement, Options, SiteArchetype } from '../gen/types';
import type { SettlementOutput, RoadOutput, SettlementRaster } from '../../../rust/bridge/settlements';
import type { TerrainData } from '../../../rust/bridge/terrain';
import { Rng } from '../gen/core/rng';
import { chooseSite } from '../gen/site/site';
import { sizeForPop } from '../gen/options';
import { circle,clipConvex,voronoiRegions } from '../gen/settlements/planner';
import { effectiveRegion, validateRegionSettings } from './regionSettings';
import type { V2Settings,ProgressCallback } from './contracts';
import type { SettlementEngine } from '../../../rust/bridge/settlementEngine';
import { loopbackServer } from './platform';
import { sampleGrid } from '../gen/core/grid';

export interface RustRegionSnapshot {placement:SettlementOutput;roads:RoadOutput|null}
let retainedEngine: { runtimeKey: string; terrainKey: string; engine: SettlementEngine } | undefined;
/** Routing resolution controls sampling, not the information content of an imported coarse heightmap. */
export function resampleRegionalRaster(source: SettlementRaster, n: number): SettlementRaster {
  if (source.n === n) return source;
  const width = source.width, cell = width / n, data = (values: Float32Array) => ({ w: source.n, h: source.n, cell: width / source.n, data: values });
  const height = new Float32Array(n * n), waterLevel = height.slice(), riverWidth = height.slice(), water = new Uint8Array(n * n), riverIds = new Int32Array(n * n);
  const h = data(source.height), levels = data(source.waterLevel);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, wx = (x + .5) * cell, wy = (y + .5) * cell;
    const j = Math.min(source.n - 1, Math.floor((y + .5) * source.n / n)) * source.n + Math.min(source.n - 1, Math.floor((x + .5) * source.n / n));
    height[i] = sampleGrid(h, wx, wy); waterLevel[i] = sampleGrid(levels, wx, wy);
    water[i] = source.water[j]; riverIds[i] = source.riverIds[j]; riverWidth[i] = source.riverWidth[j];
  }
  return { ...source, n, height, waterLevel, riverWidth, water, riverIds };
}
async function regionalRaster(world:World,resolution:number):Promise<SettlementRaster>{
  const native=(world.terrain as typeof world.terrain&{v2NativeTerrain?:TerrainData}).v2NativeTerrain;
  const raster = native ? (await import('../../../rust/bridge/settlements')).settlementRaster(native,resolution)
    : (await import('./rustUrban')).rustSettlementRaster(world);
  return resampleRegionalRaster(raster,resolution);
}
export async function planRustRegion(world:World,settings:V2Settings,onProgress?:ProgressCallback,roadsOnly=false):Promise<World>{
  const t0=performance.now(),{placement,roads,resolution}=effectiveRegion(settings);
  validateRegionSettings({placement,roads,resolution},world.mapSize);
  const runtime={profile:settings.runtime?.backend==='native'?'local':'web',server:settings.runtime?.backend==='native'?loopbackServer(settings.runtime.localServer??'http://127.0.0.1:8791'):'http://127.0.0.1:8791'} as const;
  onProgress?.({stage:'sites',label:roadsOnly?'Routing roads between retained sites…':'Rust · evaluating regional settlement sites…',completed:0,total:3});
  if(roadsOnly&&!world.settlements?.length)throw new Error('Place settlements before routing their roads.');
  const runtimeKey = JSON.stringify(runtime), terrainKey = JSON.stringify([world.stats['v2.terrainKey'] ?? null, world.mapSize, resolution]);
  if (!retainedEngine || retainedEngine.runtimeKey !== runtimeKey) {
    retainedEngine?.engine.dispose?.(); retainedEngine = undefined;
    retainedEngine = { runtimeKey, terrainKey: '', engine: await (await import('../../../rust/bridge/settlementEngine')).createSettlementEngine(runtime) };
  }
  // The worker serializes requests. A route-only change reuses both the sampled raster and the native/WASM handle.
  const raster = retainedEngine.terrainKey === terrainKey && world.stats['v2.terrainKey'] !== undefined ? undefined : await regionalRaster(world, resolution);
  const response=await retainedEngine.engine.run({id:1,seed:settings.options.seed,...(raster?{raster}:{}),...(roadsOnly?{sites:world.settlements!.map(s=>({key:s.key,population:s.population,culture:s.culture,center:s.center,radius:s.radius}))}:{place:placement}),roads,runtime});
  if('error'in response)throw new Error(response.error);
  retainedEngine.terrainKey = terrainKey;
  const previous=world.debug?.v2RustRegion as RustRegionSnapshot|undefined;
  const output=response.settlements??previous?.placement;
  if(!output?.settlements.length)throw new Error('No settlement can be placed with this recipe. Adjust the constraints or use a manual list.');
  if(!roadsOnly){
    const regions=voronoiRegions(output.settlements.map(s=>s.center),world.mapSize);
    world.settlements=output.settlements.map((s,index):Settlement=>({key:s.key,index,main:index===0,cls:s.cls as Settlement['cls'],population:s.population,culture:s.culture,center:s.center,archetype:s.archetype as SiteArchetype,radius:s.radius,extent:clipConvex(circle(s.center,s.radius),regions[index]),region:regions[index],fixed:s.scores.manual,name:s.name||undefined,detail:index===0?'main':s.cls==='farmstead'?'farmstead':'lazy'}));
    const main=world.settlements[0],opts:Options={...settings.options,...settings.local[main.key],population:main.population,culture:main.culture,size:sizeForPop(main.population),center:main.center,siteType:main.archetype,mapSize:world.mapSize};
    world.site=chooseSite(world.terrain,opts,world.mapSize,new Rng('magna-urbis:'+world.seed));
    // Native placement owns the site. The legacy adapter only supplies travel/site fields for land use.
    world.site.center={...main.center};world.site.archetype=main.archetype;world.site.reserveRadius=main.radius;
    for(const s of world.settlements){world.stats['v2.population:'+s.key]=s.population;world.stats['v2.culture:'+s.key]=s.culture;}
  }
  onProgress?.({stage:'roads',label:'Rust · projecting regional routes and crossings…',completed:2,total:3});
  world.roads=(response.roads?.segments??[]).map(s=>({path:s.path,width:s.width,kind:s.class==='highway'||s.class==='main'?'major':s.class==='local'?'minor':'track'}));
  world.bridges=(response.roads?.segments??[]).flatMap(s=>s.crossings.filter(c=>c.kind==='bridge').map(c=>({a:c.path[0],b:c.path[c.path.length-1],width:s.width})));
  world.debug={...world.debug,v2RustRegion:{placement:output,roads:response.roads} satisfies RustRegionSnapshot,v2BaseBridges:structuredClone(world.bridges),v2TownBridges:{}};
  const warnings=[...output.warnings,...(response.roads?.warnings??[])];
  Object.assign(world.stats,{'v2.stage':'region','v2.regionBackend':runtime.profile==='local'?'rust-native-cpu':'rust-wasm-cpu','v2.regionalRoads':world.roads.length,'v2.baseBridges':world.bridges.length,'v2.unreachable':response.roads?.unreachable.length??0,settlements:world.settlements!.length,'settlements.requested':output.requested,'settlements.warning':warnings.join(' | '),'ms.region':Math.round(performance.now()-t0)});
  onProgress?.({stage:'network',label:'Regional settlements and roads ready',completed:3,total:3});return world;
}
