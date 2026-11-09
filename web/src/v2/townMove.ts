import type { World, Vec2, UrbanLayer } from '../gen/types';
import { pointInRing } from '../gen/geo/poly';
import { translateLand, translateBuildingScene } from '../ui/urbanSnapshot';
import type { RustTownSnapshot } from './rustUrban';
import { setRoadPath } from './networkEdits';

/** Direct translation of one city: terrain and all other cities remain shared. */
export function moveTown(source:World,key:string,target:Vec2):World{
  const town=source.settlements?.find(s=>s.key===key);
  if(!town||!Number.isFinite(target.x)||!Number.isFinite(target.y))throw new Error('Invalid town position.');
  const dx=Math.max(0,Math.min(source.mapSize,target.x))-town.center.x,dy=Math.max(0,Math.min(source.mapSize,target.y))-town.center.y;
  if(!dx&&!dy)return source;
  const point=(p:Vec2)=>({x:p.x+dx,y:p.y+dy});
  const urban=(u:UrbanLayer|undefined)=>u&&translateLand(u,dx,dy);
  const moved={...town,center:point(town.center),extent:translateLand(town.extent,dx,dy),urban:urban(town.main?source.urban:town.urban),fixed:true,
    crossing:town.crossing&&point(town.crossing),harbor:town.harbor&&point(town.harbor)};
  const debug={...source.debug},cities=debug.v2RustCities as Record<string,RustTownSnapshot>|undefined;
  if(cities?.[key]){
    const original=cities[key],snapshot={...original};
    for(const field of ['layouts','compositionLayouts','partitions','cadastralPartitions','programmePartitions','requests'] as const){
      if(original[field])Object.assign(snapshot,{[field]:translateLand(original[field],dx,dy)});
    }
    // Architectural resolved plans are local opaque records. Move their world surfaces only.
    if(original.scene)snapshot.scene=translateBuildingScene(original.scene,dx,dy);
    if(original.houseBaseline&&original.scene)snapshot.houseBaseline={...original.houseBaseline,originals:Object.fromEntries(Object.entries(original.houseBaseline.originals).map(([id,s])=>{
      const b=translateBuildingScene({...original.scene!,...s},dx,dy);return [id,{...s,buildings:b.buildings,open_spaces:b.open_spaces}];
    }))};
    debug.v2RustCities={...cities,[key]:snapshot};
  }
  const regional=debug.v2RustRegion as {placement?:{settlements?:{key:string;center:Vec2}[]};roads?:unknown}|undefined;
  if(regional?.placement)debug.v2RustRegion={...regional,placement:{...regional.placement,settlements:regional.placement.settlements?.map(s=>s.key===key?{...s,center:point(s.center)}:s)}};
  const bridges=debug.v2TownBridges as Record<string,NonNullable<World['bridges']>>|undefined;
  if(bridges?.[key])debug.v2TownBridges={...bridges,[key]:translateLand(bridges[key],dx,dy)};
  let next:World={...source,debug,settlements:source.settlements!.map(s=>s.key===key?moved:s),
    ...(town.main||key==='main'?{urban:moved.urban,site:source.site&&{...source.site,center:point(source.site.center),
      crossing:source.site.crossing&&point(source.site.crossing),harbor:source.site.harbor&&point(source.site.harbor),feature:source.site.feature&&point(source.site.feature),citadelSpot:source.site.citadelSpot&&point(source.site.citadelSpot)}}:{}),
    stats:{...source.stats,'v2.townMove':Number(source.stats['v2.townMove']??0)+1}};
  // Reconnect only the ends attached to this town. Other road vertices stay fixed.
  const output=regional?.roads as {segments?:{a:number;b:number}[];junctions?:{site:string|null}[]}|undefined;
  for(let i=0;i<(source.roads?.length??0);i++){
    const road=source.roads![i],segment=output?.segments?.[i],path=road.path;
    const attached=(end:0|1)=>segment&&output?.junctions ? output.junctions[end?segment.b:segment.a]?.site===key
      : Math.hypot(path[end?path.length-1:0].x-town.center.x,path[end?path.length-1:0].y-town.center.y)<=Math.max(5,town.radius*1.2);
    const start=attached(0),end=attached(1);
    if(start||end)next=setRoadPath(next,i,path.map((p,j)=>j===0&&start||j===path.length-1&&end?point(p):p),{snap:.1}).world;
  }
  if(bridges){const base=next.debug?.v2BaseBridges as NonNullable<World['bridges']>|undefined;next.bridges=[...(base??[]),...Object.values(next.debug!.v2TownBridges as typeof bridges).flat()];}
  if(source.names){
    const local=new Set(['quarter','street','square','church','castle','gate']);
    const prefix=`urban:${encodeURIComponent(key)}:`;
    next.names={...(next.names??source.names),entries:(next.names??source.names).entries.map(e=>{
      const own=e.id.startsWith(prefix)||e.reference?.key===key&&e.reference.form==='name'||['town','village','farm'].includes(e.kind)&&Math.hypot(e.anchor.x-town.center.x,e.anchor.y-town.center.y)<1||local.has(e.kind)&&pointInRing(town.extent,e.anchor);
      return own?{...e,anchor:point(e.anchor),path:e.path?.map(point),replacedAnchor:e.replacedAnchor&&point(e.replacedAnchor)}:e;
    })};
  }
  return next;
}
