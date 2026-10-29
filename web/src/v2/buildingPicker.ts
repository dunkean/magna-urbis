import type {UrbanBuilding,Vec2} from '../gen/types';
import {TileIndex} from '../render/tileindex';

interface PickIndex{index:TileIndex;minX:number;minY:number;maxX:number;maxY:number}
const retained=new WeakMap<readonly UrbanBuilding[],PickIndex>();
/** Geometry arrays are immutable snapshots, as in the renderer. Indexes disappear with their source arrays. */
export function buildingCandidates(buildings:readonly UrbanBuilding[],point:Vec2):number[]{
  if(buildings.length<128)return Array.from({length:buildings.length},(_,i)=>i);
  let entry=retained.get(buildings);
  if(!entry){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    const raw=new Float64Array(buildings.length*4);
    buildings.forEach((building,i)=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of building.poly){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);}if(!building.poly.length)x0=y0=x1=y1=0;raw.set([x0,y0,x1,y1],i*4);minX=Math.min(minX,x0);minY=Math.min(minY,y0);maxX=Math.max(maxX,x1);maxY=Math.max(maxY,y1);});
    const size=Math.max(1,maxX-minX,maxY-minY),boxes=new Float32Array(raw.length),pad=size*2**-22+1e-6;
    for(let i=0;i<buildings.length;i++){const j=i*4;boxes[j]=raw[j]-minX-pad;boxes[j+1]=raw[j+1]-minY-pad;boxes[j+2]=raw[j+2]-minX+pad;boxes[j+3]=raw[j+3]-minY+pad;}
    entry={index:new TileIndex(size,Math.max(32,size/128),boxes),minX,minY,maxX,maxY};retained.set(buildings,entry);
  }
  if(point.x<entry.minX||point.y<entry.minY||point.x>entry.maxX||point.y>entry.maxY)return [];
  const x=point.x-entry.minX,y=point.y-entry.minY;
  return entry.index.query({minX:x,minY:y,maxX:x,maxY:y});
}
