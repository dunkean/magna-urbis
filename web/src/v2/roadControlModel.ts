import type { Polyline, Vec2, World } from '../gen/types';

export type EditableRoad = NonNullable<World['roads']>[number];
export interface RoadGeometry { path: Polyline; controls: Polyline; controlIndices: number[]; routingVariant?: number }
const seededGeometry = new WeakMap<EditableRoad,{size:number;geometry:RoadGeometry}>();
const copy = (p: Vec2): Vec2 => ({ x: p.x, y: p.y });
export const sameRoadPoint = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x-b.x, a.y-b.y) < 1e-5;
export const insideRoadMap = (p: Vec2, size: number): boolean => p.x >= 0 && p.y >= 0 && p.x <= size && p.y <= size;
export const clampRoadPoint = (p: Vec2, size: number): Vec2 => ({ x: Math.max(0,Math.min(size,p.x)), y: Math.max(0,Math.min(size,p.y)) });
/** Geometric nearest border, including corner projections for outside clicks. */
export function roadBorderPoint(p: Vec2, size: number): Vec2 {
  const q = clampRoadPoint(p,size);
  if (!insideRoadMap(p,size)) return q;
  const distances = [q.x,size-q.x,q.y,size-q.y], side = distances.indexOf(Math.min(...distances));
  return side === 0 ? {x:0,y:q.y} : side === 1 ? {x:size,y:q.y} : side === 2 ? {x:q.x,y:0} : {x:q.x,y:size};
}
export function roadArcs(path: readonly Vec2[]): number[] {
  const arcs=[0]; for(let i=1;i<path.length;i++)arcs.push(arcs[i-1]+Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y));
  return arcs;
}
/** Controls always index the actual routed path, in travel order (also on looping routes). */
export function roadGeometry(path: Polyline, controls: Polyline): RoadGeometry {
  if(path.length<2||controls.length<2)throw new Error('A road needs two distinct points.');
  const indices=[0]; let previous=0;
  for(let i=1;i<controls.length-1;i++) {
    let found=-1;
    for(let k=previous+1;k<path.length-1;k++)if(sameRoadPoint(path[k],controls[i])){found=k;break;}
    if(found<0)throw new Error('Road controls must follow the routed path.');
    indices.push(found);previous=found;
  }
  indices.push(path.length-1);
  return {path,controls:indices.map(i=>copy(path[i])),controlIndices:indices};
}
/** Terrain bends are routing results, not mandatory waypoints. Start with one steering handle. */
export function editableRoadGeometry(road: EditableRoad, mapSize: number): RoadGeometry {
  if(road.controls && road.controlIndices && road.controls.length===road.controlIndices.length
    && road.controlIndices[0]===0 && road.controlIndices.at(-1)===road.path.length-1
    && road.controlIndices.every((k,i)=>Number.isInteger(k)&&k>=0&&k<road.path.length&&(i===0||k>road.controlIndices![i-1])&&sameRoadPoint(road.path[k],road.controls![i]))) {
    return {path:road.path,controls:road.controls,controlIndices:road.controlIndices};
  }
  const cached=seededGeometry.get(road);if(cached?.size===mapSize)return cached.geometry;
  const path=road.path.map(copy),indices=[0,path.length-1];
  // A straight road still needs an interior handle to move between fixed attachments.
  if(indices.length===2) {
    const arcs=roadArcs(path),half=arcs.at(-1)!/2;
    let k=1;while(k<path.length-1&&arcs[k]<half)k++;
    if(Math.abs(arcs[k]-half)<1e-5)indices.splice(1,0,k);
    else {
      const t=(half-arcs[k-1])/(arcs[k]-arcs[k-1]);
      path.splice(k,0,{x:path[k-1].x+(path[k].x-path[k-1].x)*t,y:path[k-1].y+(path[k].y-path[k-1].y)*t});
      indices[1]++;indices.splice(1,0,k);
    }
  }
  const geometry={path,controls:indices.map(i=>copy(path[i])),controlIndices:indices};seededGeometry.set(road,{size:mapSize,geometry});return geometry;
}
/** Keep only constraints belonging to a clipped/split piece. Its new endpoints are constraints too. */
export function roadPieceGeometry(path: Polyline, controls: readonly Vec2[]): RoadGeometry {
  const kept: Polyline=[copy(path[0])];let previous=0;
  for(const p of controls) {
    let k=-1;for(let j=previous+1;j<path.length-1;j++)if(sameRoadPoint(path[j],p)){k=j;break;}
    if(k>=0){kept.push(copy(p));previous=k;}
  }
  kept.push(copy(path.at(-1)!));return roadGeometry(path,kept);
}
export function sliceRoadPath(path: Polyline, from: number, to: number): Polyline {
  const arcs=roadArcs(path),total=arcs.at(-1)!;
  from=Math.max(0,from);to=Math.min(total,to);
  const at=(s:number):Vec2=>{
    let i=1;while(i<path.length-1&&arcs[i]<s)i++;
    const t=(s-arcs[i-1])/Math.max(1e-12,arcs[i]-arcs[i-1]);
    return {x:path[i-1].x+(path[i].x-path[i-1].x)*t,y:path[i-1].y+(path[i].y-path[i-1].y)*t};
  };
  return [at(from),...path.filter((_,i)=>arcs[i]>from+1e-5&&arcs[i]<to-1e-5).map(copy),at(to)];
}
