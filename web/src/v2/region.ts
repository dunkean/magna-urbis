import type { World, Settlement, Options, SiteArchetype } from '../gen/types';
import type { SettlementOutput, RoadOutput, SettlementRaster, RoadSite } from '../../../rust/bridge/settlements';
import type { TerrainData } from '../../../rust/bridge/terrain';
import { Rng } from '../gen/core/rng';
import { chooseSiteRust } from '../../../rust/bridge/siteNative';
import { sizeForPop } from '../gen/options';
import { circle,clipConvex,voronoiRegions } from '../gen/settlements/planner';
import { effectiveRegion, validateRegionSettings } from './regionSettings';
import type { V2Settings,ProgressCallback } from './contracts';
import type { SettlementEngine } from '../../../rust/bridge/settlementEngine';
import { loopbackServer } from './platform';
import { sampleGrid } from '../gen/core/grid';
import { stepSeed } from '../../../rust/bridge/generationSeed';
import { effectiveTerrainSettings } from './terrainSettings';
import type { ResourcePayload } from '../../../rust/bridge/resources';

export interface RustRegionSnapshot {placement:SettlementOutput;roads:RoadOutput|null}
/** Road endpoints: settlements, then activity access points (settlements.ts roadSitesOf; not imported to keep that bundle lazy). */
const roadSitesOf=(o:SettlementOutput):RoadSite[]=>[...o.settlements.map(s=>({key:s.key,population:s.population,culture:s.culture,center:s.center,radius:s.radius})),
  ...(o.activities??[]).map(a=>({key:a.id,population:0,culture:a.culture,center:a.access,radius:0,access:a.accessClass,parent:a.parent}))];
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
async function regionalRaster(world:World,resolution:number,settings:V2Settings):Promise<SettlementRaster>{
  const native=(world.terrain as typeof world.terrain&{v2NativeTerrain?:TerrainData}).v2NativeTerrain;
  const raster = native ? (await import('../../../rust/bridge/settlements')).settlementRaster(native,resolution)
    : (await import('./rustUrban')).rustSettlementRaster(world);
  // Resource-model inputs (Rust `resources::RegionInput`): geology, soil, potentials and activity anchors derive from them.
  const effective=effectiveTerrainSettings(settings,world.mapSize),climate=effective.climateValues!;
  raster.region??={seed:settings.options.seed,temperature:climate.temperature,precipitation:climate.precipitation,biome:effective.climateZone??'temperate',x:native?.x??0,y:native?.y??0};
  return resampleRegionalRaster(raster,resolution);
}
const runtimeOf=(settings:V2Settings)=>({profile:settings.runtime?.backend==='native'?'local':'web',server:settings.runtime?.backend==='native'?loopbackServer(settings.runtime.localServer??'http://127.0.0.1:8791'):'http://127.0.0.1:8791'} as const);
async function engineFor(runtime:ReturnType<typeof runtimeOf>):Promise<NonNullable<typeof retainedEngine>>{
  const runtimeKey=JSON.stringify(runtime);
  if(!retainedEngine||retainedEngine.runtimeKey!==runtimeKey){
    retainedEngine?.engine.dispose?.();retainedEngine=undefined;
    retainedEngine={runtimeKey,terrainKey:'',engine:await(await import('../../../rust/bridge/settlementEngine')).createSettlementEngine(runtime)};
  }
  return retainedEngine;
}
/** Compact resource payload of the retained terrain (view layers, rural soil): once per terrain, undefined without a Rust region. */
let retainedResources:{key:string;payload:ResourcePayload}|undefined;
export async function regionResources(world:World,settings:V2Settings):Promise<ResourcePayload|undefined>{
  if(!settings.runtime?.backend||settings.runtime.backend==='typescript')return undefined;
  const {resolution}=effectiveRegion(settings),runtime=runtimeOf(settings);
  const terrainKey=JSON.stringify([world.stats['v2.terrainKey']??null,world.stats['v2.waterEditRevision']??0,world.mapSize,resolution]),key=JSON.stringify([runtime,terrainKey,settings.options.seed]);
  if(retainedResources?.key===key)return retainedResources.payload;
  const engine=await engineFor(runtime);
  const raster=engine.terrainKey===terrainKey&&world.stats['v2.terrainKey']!==undefined?undefined:await regionalRaster(world,resolution,settings);
  const response=await engine.engine.run({id:1,seed:stepSeed(settings.options.seed,'settle-sites'),...(raster?{raster}:{}),roads:null,resources:true,runtime});
  if('error'in response)throw new Error(response.error);
  engine.terrainKey=terrainKey;
  if(!response.resources)throw new Error('The engine returned no resource payload.');
  retainedResources={key,payload:response.resources};return response.resources;
}
export async function planRustRegion(world:World,settings:V2Settings,onProgress?:ProgressCallback,roadsOnly=false):Promise<World>{
  const t0=performance.now(),{placement,roads,resolution}=effectiveRegion(settings);
  validateRegionSettings({placement,roads,resolution},world.mapSize);
  const runtime=runtimeOf(settings);
  onProgress?.({stage:'sites',label:roadsOnly?'Routing roads between retained sites…':'Rust · evaluating regional settlement sites…',completed:0,total:3});
  if(roadsOnly&&!world.settlements?.length)throw new Error('Place settlements before routing their roads.');
  const terrainKey = JSON.stringify([world.stats['v2.terrainKey'] ?? null, world.stats['v2.waterEditRevision'] ?? 0, world.mapSize, resolution]);
  const engine = await engineFor(runtime);
  // The worker serializes requests. A route-only change reuses both the sampled raster and the native/WASM handle.
  const raster = engine.terrainKey === terrainKey && world.stats['v2.terrainKey'] !== undefined ? undefined : await regionalRaster(world, resolution, settings);
  const placeSeed = stepSeed(settings.options.seed, 'settle-sites'), roadSeed = stepSeed(settings.options.seed, 'settle-roads');
  // Reroute: the retained settlements, then the retained activity sites' access points.
  const retainedActivities=(world.debug?.v2RustRegion as RustRegionSnapshot|undefined)?.placement.activities??[];
  const retainedSites=():RoadSite[]=>[...world.settlements!.map(s=>({key:s.key,population:s.population,culture:s.culture,center:s.center,radius:s.radius})),...roadSitesOf({settlements:[],warnings:[],requested:0,usableKm2:0,ms:0,activities:retainedActivities})];
  let response=await engine.engine.run({id:1,seed:roadsOnly?roadSeed:placeSeed,...(raster?{raster}:{}),...(roadsOnly?{sites:retainedSites()}:{place:placement}),roads:!roadsOnly&&placeSeed!==roadSeed?null:roads,runtime});
  if('error'in response)throw new Error(response.error);
  if (!roadsOnly && placeSeed !== roadSeed) {
    const placed = response.settlements;
    if (!placed) throw new Error('Missing retained settlement placement.');
    const routed = await engine.engine.run({ id: 2, seed: roadSeed,
      sites: roadSitesOf(placed), roads, runtime });
    if ('error' in routed) throw new Error(routed.error);
    response = { ...routed, settlements: placed };
  }
  engine.terrainKey = terrainKey;
  const previous=world.debug?.v2RustRegion as RustRegionSnapshot|undefined;
  const output=response.settlements??previous?.placement;
  if(!output?.settlements.length)throw new Error('No settlement can be placed with this recipe. Adjust the constraints or use a manual list.');
  if(!roadsOnly){
    const regions=voronoiRegions(output.settlements.map(s=>s.center),world.mapSize);
    world.settlements=output.settlements.map((s,index):Settlement=>({key:s.key,index,main:index===0,cls:s.cls as Settlement['cls'],population:s.population,culture:s.culture,center:s.center,archetype:s.archetype as SiteArchetype,radius:s.radius,extent:clipConvex(circle(s.center,s.radius),regions[index]),region:regions[index],fixed:s.scores.manual,name:s.name||undefined,detail:index===0?'main':s.cls==='farmstead'?'farmstead':'lazy'}));
    const main=world.settlements[0],opts:Options={...settings.options,...settings.local[main.key],population:main.population,culture:main.culture,size:sizeForPop(main.population),center:main.center,siteType:main.archetype,mapSize:world.mapSize};
    world.site=await chooseSiteRust(world.terrain,opts,world.mapSize,new Rng('magna-urbis:'+world.seed),runtime);
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
