import type { Terrain3d } from './terrain3d';
import type { LandUseLayer, LandKind } from '../gen/types';
import type { CityScene } from '../render/cityCanvas';
import type { SemanticDepth, SemanticLook } from '../render/composition';
import { RURAL_SEMANTIC, URBAN_SEMANTIC, urbanClassOf } from '../render/semanticLayer';

export interface SemanticLimits3dInput { landuse?: LandUseLayer; scenes: readonly CityScene[]; rural: SemanticLook; urban: SemanticLook; depth: SemanticDepth; opacity: number; classes: Readonly<Record<LandKind, boolean>> }
type Point = { x: number; y: number };
interface Limit { rings: readonly (readonly Point[])[]; color: string; kind?: LandKind; minX: number; minY: number; maxX: number; maxY: number }
type Box = Pick<Limit,'minX'|'minY'|'maxX'|'maxY'>;
/** Unlike the general painter's index, queries stop before collecting or sorting the whole map. */
class LimitBins {
  private cells=new Map<number,number[]>();private overflow:number[]=[];private cell:number;private x:number;private y:number;
  constructor(private limits: readonly Limit[]){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const l of limits){minX=Math.min(minX,l.minX);minY=Math.min(minY,l.minY);maxX=Math.max(maxX,l.maxX);maxY=Math.max(maxY,l.maxY);}
    this.x=Number.isFinite(minX)?minX:0;this.y=Number.isFinite(minY)?minY:0;this.cell=Math.max(1,(maxX-minX)/63,(maxY-minY)/63);
    limits.forEach((l,i)=>{
      const [x0,y0,x1,y1]=this.range(l);if((x1-x0+1)*(y1-y0+1)>256){this.overflow.push(i);return;}
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const key=y*64+x,list=this.cells.get(key);if(list)list.push(i);else this.cells.set(key,[i]);}
    });
  }
  private range(b: Box): number[]{const at=(v:number,o:number)=>Math.max(0,Math.min(63,Math.floor((v-o)/this.cell)));return [at(b.minX,this.x),at(b.minY,this.y),at(b.maxX,this.x),at(b.maxY,this.y)];}
  *query(box: Box): Generator<number>{
    const [x0,y0,x1,y1]=this.range(box),seen=new Set<number>();let visits=0,yielded=0;
    const lists: readonly number[][]=[this.overflow,...Array.from({length:(x1-x0+1)*(y1-y0+1)},(_,i)=>this.cells.get((y0+Math.floor(i/(x1-x0+1)))*64+x0+i%(x1-x0+1))??[])];
    for(const list of lists)for(const i of list){
      if(++visits>4096 || yielded>=512)return;if(seen.has(i))continue;seen.add(i);const l=this.limits[i];
      if(l.minX<=box.maxX && l.maxX>=box.minX && l.minY<=box.maxY && l.maxY>=box.minY){yielded++;yield i;}
    }
  }
}
interface Geometry { limits: Limit[]; bins: LimitBins }
const ruralCache = new WeakMap<LandUseLayer, Geometry>(), urbanCache = new WeakMap<CityScene, Geometry>();
function limit(rings: readonly (readonly Point[])[], color: string, kind?: LandKind): Limit {
  const out: Limit = { rings, color, kind, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for(const ring of rings)for(const p of ring){out.minX=Math.min(out.minX,p.x);out.minY=Math.min(out.minY,p.y);out.maxX=Math.max(out.maxX,p.x);out.maxY=Math.max(out.maxY,p.y);}
  return out;
}
function ruralGeometry(landuse: LandUseLayer): Geometry {
  let g=ruralCache.get(landuse);if(g)return g;
  const limits=landuse.areas.map(a=>limit([a.poly,...a.holes??[]],RURAL_SEMANTIC[a.kind].color,a.kind));
  ruralCache.set(landuse,g={limits,bins:new LimitBins(limits)});return g;
}
function urbanGeometry(scene: CityScene): Geometry {
  let g=urbanCache.get(scene);if(g)return g;
  const limits: Limit[]=[];
  for(const block of scene.blocks){const cls=urbanClassOf(block);if(cls)limits.push(limit((block.ground??[block.shape]).flatMap(s=>[s.outer,...s.holes??[]]),URBAN_SEMANTIC[cls].color));}
  urbanCache.set(scene,g={limits,bins:new LimitBins(limits)});return g;
}
/** Limits only, using the text projector's terrain occlusion. Bounded candidates, projections and CPU time. */
export function drawSemanticLimits3d(ctx: CanvasRenderingContext2D, terrain: Terrain3d, projection: NonNullable<ReturnType<Terrain3d['labelProjector']>>, input: SemanticLimits3dInput): void {
  if(input.depth!=='readable' || input.opacity<=0)return;
  const camera=terrain.getCamera(), radius=camera.distance*4, box={minX:camera.x-radius,minY:camera.y-radius,maxX:camera.x+radius,maxY:camera.y+radius};
  const geometry: Geometry[]=[];
  if(input.urban!=='off')for(const scene of input.scenes)geometry.push(urbanGeometry(scene));
  if(input.rural!=='off' && input.landuse)geometry.push(ruralGeometry(input.landuse));
  const start=performance.now();let probes=0, candidates=0;
  ctx.save();ctx.lineJoin='round';ctx.lineCap='round';ctx.globalAlpha=Math.min(.85,.25+input.opacity);
  outer: for(const g of geometry)for(const id of g.bins.query(box)){
    if(++candidates>512 || probes>=768 || performance.now()-start>6)break outer;
    const l=g.limits[id];if(l.kind && input.classes[l.kind]===false)continue;
    if((l.maxX-l.minX)*projection.scale<3 && (l.maxY-l.minY)*projection.scale<3)continue;
    const path=new Path2D();let drawn=false;
    for(const ring of l.rings){
      const stride=Math.max(1,Math.ceil(ring.length/48));let previous: [number,number]|null=null;
      const steps=Math.ceil(ring.length/stride);
      for(let i=0;i<=steps;i++){
        const p=ring[i===steps?0:i*stride];if(!p)continue;
        if(++probes>768 || performance.now()-start>6)break;
        const point=projection.project(p.x,p.y);
        if(point && previous){path.moveTo(previous[0],previous[1]);path.lineTo(point[0],point[1]);drawn=true;}
        previous=point;
      }
    }
    if(drawn){ctx.strokeStyle='rgba(255,255,240,.55)';ctx.lineWidth=2.1;ctx.stroke(path);ctx.strokeStyle=l.color;ctx.lineWidth=.9;ctx.stroke(path);}
  }
  ctx.restore();
}
