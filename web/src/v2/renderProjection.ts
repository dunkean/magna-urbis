import type { World,TerrainLayer } from '../gen/types';

/** Rendering owns cartographic geometry. Backend archives and input rasters stay in the project. */
export function renderProjection(source:World):World{
  const {importedHeight:_input,...options}=source.options;
  const {v2NativeTerrain:_native,v2ForestField:_forest,v2NaturalForest:_cover,v2EngineStats:_provenance,...terrain}=source.terrain as TerrainLayer&Record<string,unknown>;
  const {'v2.terrainKey':_terrainKey,'v2.planKey':_planKey,'v2.placementKey':_placementKey,...stats}=source.stats;
  const debug=source.debug?.urban===undefined?undefined:{urban:source.debug.urban};
  return {...source,options,terrain:terrain as TerrainLayer,stats,debug};
}
/** Count unique backing stores; shared views must not be mistaken for extra allocations. */
export function arrayBufferBytes(value:unknown):number{
  const visited=new WeakSet<object>(),buffers=new Set<ArrayBufferLike>();
  const walk=(item:unknown):void=>{
    if(!item||typeof item!=='object'||visited.has(item))return;visited.add(item);
    if(ArrayBuffer.isView(item)){buffers.add(item.buffer);return;}
    if(item instanceof ArrayBuffer){buffers.add(item);return;}
    if(item instanceof Map){for(const [key,value]of item){walk(key);walk(value);}return;}
    if(item instanceof Set){for(const value of item)walk(value);return;}
    for(const child of Object.values(item))walk(child);
  };walk(value);return [...buffers].reduce((bytes,buffer)=>bytes+buffer.byteLength,0);
}
