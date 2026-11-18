import type {World,Polyline,Vec2} from '../gen/types';
import {nearestOnPolyline,deleteRoad,setRoadPath,splitRoadWithGap} from './networkEdits';
import {editableRoadGeometry,roadGeometry,clampRoadPoint,roadBorderPoint} from './roadControlModel';
import {fixedRoadEndpoint,entryForControl,roadOutput,refreshRoadExitConnections} from './roadEditing';

const identified=new WeakMap<World,World>();
/** Keep selection independent of the array index after a split, deletion or urban projection. */
export function identifyRoads(world:World):World{
  const cached=identified.get(world);if(cached)return cached;
  const next=(world.roads??[]).every(r=>r.editorId)?world:{...world,roads:world.roads?.map(r=>r.editorId?r:{...r,editorId:crypto.randomUUID()})};
  identified.set(world,next);identified.set(next,next);return next;
}
/** A segment is the routed stretch between two constraints, not one sampled terrain edge. */
export function roadControlSegment(world:World,index:number,point:Vec2):number{
  const g=editableRoadGeometry(world.roads![index],world.mapSize),hit=nearestOnPolyline(g.path,point);
  let segment=0;while(segment<g.controls.length-2&&g.controlIndices[segment+1]<=hit.segment)segment++;
  return segment;
}
export function translatedRoadSegment(world:World,road:number,segment:number,base:Polyline,dx:number,dy:number):Polyline{
  if(segment<0||segment+1>=base.length)throw new Error('Choose a road segment.');
  return base.map((p,i)=>{
    if(i!==segment&&i!==segment+1)return {...p};
    if((i===0||i===base.length-1)&&fixedRoadEndpoint(world,road,i===0?0:1))throw new Error('Road connections to places stay fixed.');
    const moved={x:p.x+dx,y:p.y+dy};return entryForControl(world,road,i)>=0?roadBorderPoint(moved,world.mapSize):clampRoadPoint(moved,world.mapSize);
  });
}
/** Inserting an unchanged waypoint preserves the existing routed path exactly. */
export function insertRoadControlGeometry(world:World,index:number,point:Vec2):{geometry:ReturnType<typeof roadGeometry>;index:number}{
  const g=editableRoadGeometry(world.roads![index],world.mapSize),hit=nearestOnPolyline(g.path,point);
  const existing=g.controls.findIndex(p=>Math.hypot(p.x-hit.point.x,p.y-hit.point.y)<1e-5);
  if(existing>=0)return {geometry:g,index:existing};
  let at=1;while(at<g.controlIndices.length-1&&g.controlIndices[at]<=hit.segment)at++;
  const path=g.path.slice(),controls=g.controls.slice();
  if(!path.some(p=>Math.hypot(p.x-hit.point.x,p.y-hit.point.y)<1e-5))path.splice(hit.segment+1,0,hit.point);
  controls.splice(at,0,hit.point);return {geometry:roadGeometry(path,controls),index:at};
}
export function deleteRoadControlSegment(world:World,index:number,segment:number):World{
  const g=editableRoadGeometry(world.roads![index],world.mapSize),last=g.controls.length-1;
  if(segment<0||segment>=last)throw new Error('Choose a road segment.');
  const left=segment>0?roadGeometry(g.path.slice(0,g.controlIndices[segment]+1),g.controls.slice(0,segment+1)):undefined;
  const right=segment+1<last?roadGeometry(g.path.slice(g.controlIndices[segment+1]),g.controls.slice(segment+1)):undefined;
  if(left&&right)return refreshRoadExitConnections(splitRoadWithGap(world,index,left,right));
  const keep=left??right;if(!keep)return refreshRoadExitConnections(deleteRoad(world,index).world);
  const edge=roadOutput(world)?.segments[index];
  return refreshRoadExitConnections(setRoadPath(world,index,keep.path,{controls:keep.controls,connections:[left?edge?.a:undefined,right?edge?.b:undefined]}).world);
}
