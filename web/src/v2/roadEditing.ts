import type { Polyline, Vec2, World } from '../gen/types';
import type { ExitReport, RoadOutput } from '../../../rust/bridge/settlements';
import { deleteRoads, nearestOnPolyline, roadClassOf, setConnectedRoadPaths, splitRoadWithGap } from './networkEdits';
import { clampRoadPoint, editableRoadGeometry, roadArcs, roadBorderPoint, roadPieceGeometry, sameRoadPoint, sliceRoadPath, type RoadGeometry } from './roadControlModel';

export function roadOutput(world: World): RoadOutput | undefined {
  return (world.debug?.v2RustRegion as {roads?:RoadOutput}|undefined)?.roads;
}
export function roadExitReports(world: World): readonly ExitReport[] {
  const native=roadOutput(world)?.exits;if(native)return native;
  // A regenerated map replaces manual roads; do not revive their old fallback entries.
  return ((world.debug?.v2RoadExits as ExitReport[]|undefined)??[]).filter(e=>e.point&&e.class&&world.roads?.some(r=>sameRoadPoint(r.path[0],e.point!)||sameRoadPoint(r.path.at(-1)!,e.point!)));
}
export function withRoadExitReports(world: World, exits: readonly ExitReport[]): World {
  const output=roadOutput(world),debug={...world.debug};
  if(output)debug.v2RustRegion={...(debug.v2RustRegion as object),roads:{...output,exits:[...exits]}};
  else debug.v2RoadExits=[...exits];
  return {...world,debug};
}
export function entryForControl(world: World, road: number, control: number): number {
  const geometry=editableRoadGeometry(world.roads![road],world.mapSize);
  if(control!==0&&control!==geometry.controls.length-1)return -1;
  return roadExitReports(world).findIndex(e=>e.class!==null&&e.point!==null&&sameRoadPoint(e.point,geometry.controls[control]));
}
export function roadEndpointPeers(world: World, road: number, end: 0|1): {road:number;end:0|1}[] {
  const roads=world.roads??[],native=roadOutput(world),output=native?.segments.length===roads.length?native:undefined,segment=output?.segments[road],point=end?roads[road].path.at(-1)!:roads[road].path[0];
  const junction=segment ? (end?segment.b:segment.a) : undefined;
  return roads.flatMap((r,i)=>i===road?[]:([0,1] as const).flatMap(side=>{
    const s=output?.segments[i],connected=junction!==undefined&&s ? (side?s.b:s.a)===junction : sameRoadPoint(side?r.path.at(-1)!:r.path[0],point);
    return connected?[{road:i,end:side}]:[];
  }));
}
export function fixedRoadEndpoint(world: World, road: number, end: 0|1): boolean {
  const native=roadOutput(world),output=native?.segments.length===world.roads?.length?native:undefined,s=output?.segments[road],site=s?output!.junctions[end?s.b:s.a]?.site:undefined;
  const p=end?world.roads![road].path.at(-1)!:world.roads![road].path[0];
  // Native sites also include mills, chapels and other isolated activities. Their access point stays attached.
  return !!(site&&site!=='exit')||(world.settlements??[]).some(t=>sameRoadPoint(t.center,p))||(world.landuse?.farmsteads??[]).some(f=>f.gate&&sameRoadPoint(f.gate,p));
}
/** Whole-road movement keeps town and network attachments fixed; entries slide on the border. */
export function translatedRoadControls(world: World, road: number, controls: Polyline, dx: number, dy: number): Polyline {
  if(controls.length===2&&([0,1] as const).every(end=>fixedRoadEndpoint(world,road,end)||roadEndpointPeers(world,road,end).length)) {
    const path=world.roads![road].path,half=roadArcs(path).at(-1)!/2;
    const midpoint=sliceRoadPath(path,half,half)[0];
    controls=[controls[0],midpoint,controls[1]];
  }
  return controls.map((p,i)=>{
    const end=i===0?0:i===controls.length-1?1:undefined;
    if(end!==undefined&&(fixedRoadEndpoint(world,road,end)||roadEndpointPeers(world,road,end).length))return {...p};
    const q={x:p.x+dx,y:p.y+dy};
    return end!==undefined&&roadExitReports(world).some(e=>e.class&&e.point&&sameRoadPoint(e.point,p))?roadBorderPoint(q,world.mapSize):clampRoadPoint(q,world.mapSize);
  });
}
/** Moving a junction reroutes all incident edges atomically, rather than detaching one. */
export function connectedRoadControls(world: World, index: number, controls: Polyline): {index:number;controls:Polyline}[] {
  const before=editableRoadGeometry(world.roads![index],world.mapSize).controls,result=new Map<number,Polyline>([[index,controls]]);
  for(const end of [0,1] as const) {
    const from=end?before.at(-1)!:before[0],to=end?controls.at(-1)!:controls[0];
    if(sameRoadPoint(from,to))continue;
    if(fixedRoadEndpoint(world,index,end))throw new Error('Road connections to places stay fixed.');
    for(const peer of roadEndpointPeers(world,index,end)) {
      const next=result.get(peer.road)??editableRoadGeometry(world.roads![peer.road],world.mapSize).controls.map(p=>({...p}));
      next[peer.end?next.length-1:0]={...to};result.set(peer.road,next);
    }
  }
  return [...result].map(([index,controls])=>({index,controls}));
}
export function commitRoutedRoads(world: World, changes: {index:number;geometry:RoadGeometry}[]): World {
  let next=setConnectedRoadPaths(world,changes);
  const exits=roadExitReports(world).map(e=>{
    if(!e.point)return e;
    for(const change of changes) {
      const old=world.roads![change.index].path;
      if(sameRoadPoint(e.point,old[0]))return {...e,point:{...change.geometry.path[0]}};
      if(sameRoadPoint(e.point,old.at(-1)!))return {...e,point:{...change.geometry.path.at(-1)!}};
    }
    return e;
  });
  next=withRoadExitReports(next,exits);return refreshRoadExitConnections(next);
}
export function insertRoadWaypoint(geometry: RoadGeometry, point: Vec2): {controls:Polyline;index:number} {
  const hit=nearestOnPolyline(geometry.path,point);
  let index=1;while(index<geometry.controlIndices.length-1&&geometry.controlIndices[index]<=hit.segment)index++;
  // A double click on an existing constraint selects it without adding a duplicate.
  const existing=geometry.controls.findIndex(p=>sameRoadPoint(p,hit.point));
  if(existing>=0)return {controls:geometry.controls.map(p=>({...p})),index:existing};
  const controls=geometry.controls.map(p=>({...p}));controls.splice(index,0,{...hit.point});return {controls,index};
}
export function roadCutPieces(geometry: RoadGeometry, control: number, gap: number): [RoadGeometry,RoadGeometry] {
  if(control<=0||control>=geometry.controls.length-1)throw new Error('Choose an interior control point to cut the road.');
  const arcs=roadArcs(geometry.path),at=arcs[geometry.controlIndices[control]],total=arcs.at(-1)!;
  const half=Math.min(Math.max(gap/2,.01),at*.45,(total-at)*.45);
  return [roadPieceGeometry(sliceRoadPath(geometry.path,0,at-half),geometry.controls.slice(0,control)),
    roadPieceGeometry(sliceRoadPath(geometry.path,at+half,total),geometry.controls.slice(control+1))];
}
export function cutRoadControl(world: World, road: number, control: number, gap: number): World {
  const [first,second]=roadCutPieces(editableRoadGeometry(world.roads![road],world.mapSize),control,gap);
  return refreshRoadExitConnections(splitRoadWithGap(world,road,first,second));
}

/** Only the exclusive stem belongs to the entry; stop at a town or the first shared junction. */
export function roadEntryDeletionPlan(world: World, entry: number): number[] {
  const report=roadExitReports(world)[entry];if(!report?.point)return [];
  const roads=world.roads??[],first=roads.findIndex(r=>sameRoadPoint(r.path[0],report.point!)||sameRoadPoint(r.path.at(-1)!,report.point!));
  if(first<0)return [];
  const result:number[]=[],seen=new Set<number>();let road=first,end:0|1=sameRoadPoint(roads[first].path[0],report.point)?0:1;
  while(!seen.has(road)) {
    seen.add(road);result.push(road);
    const far=end?0:1;
    if(fixedRoadEndpoint(world,road,far))break;
    const peers=roadEndpointPeers(world,road,far);
    if(peers.length!==1)break;
    road=peers[0].road;end=peers[0].end;
  }
  return result;
}
export function deleteRoadEntry(world: World, entry: number): World {
  const next=deleteRoads(world,roadEntryDeletionPlan(world,entry));
  const kept=roadExitReports(world).filter((e,i)=>i!==entry&&(!e.class||!e.point||next.roads?.some(r=>sameRoadPoint(r.path[0],e.point!)||sameRoadPoint(r.path.at(-1)!,e.point!))));
  return refreshRoadExitConnections(withRoadExitReports(next,kept));
}
/** New boundary endpoints are explicit regional entries, even on maps without a native snapshot. */
export function addRoadEntries(world: World, road: number, ends: readonly (0|1)[]): World {
  const r=world.roads![road],cls=roadClassOf(world,road),exits=[...roadExitReports(world)];
  for(const end of ends) {
    const p=end?r.path.at(-1)!:r.path[0];
    if(exits.some(e=>e.class!==null&&e.point&&sameRoadPoint(e.point,p)))continue;
    const other=end?r.path[0]:r.path.at(-1)!,gateway=(world.settlements??[]).find(t=>sameRoadPoint(t.center,other))?.key??'manual-entry';
    exits.push({requested:cls==='trail'?'track':cls,class:cls,point:{...p},gateway,reason:null});
  }
  return refreshRoadExitConnections(withRoadExitReports(world,exits));
}
/** A cut must not continue to appear as a connected regional link in the results panel. */
export function refreshRoadExitConnections(world: World): World {
  const roads=world.roads??[],exits=roadExitReports(world).map(e=>{
    if(!e.point||!e.class)return e;
    const gateway=(world.settlements??[]).find(t=>t.key===e.gateway),seen=new Set<number>(),queue=roads.flatMap((r,i)=>sameRoadPoint(r.path[0],e.point!)||sameRoadPoint(r.path.at(-1)!,e.point!)?[i]:[]);
    let connected=!gateway&&queue.length>0;
    for(let k=0;k<queue.length;k++) {
      const i=queue[k];if(seen.has(i))continue;seen.add(i);
      for(const end of [0,1] as const) {
        const p=end?roads[i].path.at(-1)!:roads[i].path[0];
        if(gateway&&sameRoadPoint(p,gateway.center))connected=true;
        for(const peer of roadEndpointPeers(world,i,end))if(!seen.has(peer.road))queue.push(peer.road);
      }
    }
    return {...e,connected};
  });
  return withRoadExitReports(world,exits);
}
