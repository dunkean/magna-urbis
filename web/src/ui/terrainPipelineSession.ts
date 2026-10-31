import { GENERATION_STAGES, generationStageActive, type GenerationControl, type GenerationStageInfo } from '../../../rust/bridge/terrainGenerationRecipe';
import { coreOperations } from '../../../rust/bridge/terrainCheckpoints';
import type { TerrainData, TerrainRequest } from '../../../rust/bridge/terrain';

export class TerrainPipelineSession {
  private cancelled=false; private all:boolean; private credits=1; private release?:()=>void;
  private started=performance.now(); private until:number;
  readonly control:GenerationControl;
  constructor(readonly request:TerrainRequest,emit:(stage:GenerationStageInfo)=>void){
    this.all=!request.inspection?.step;
    const order=GENERATION_STAGES.map(([id])=>id),core=coreOperations(request.settings),cut=core.indexOf('coastCut');
    order.splice(order.indexOf('coastCut'),1);order.splice(order.indexOf(core[cut-1])+1,0,'coastCut');
    this.until=order.findIndex(id=>id===request.inspection?.until);
    this.control={previews:request.inspection?.previews??true,
      before:async(stage,detail)=>{
        this.check();const active=generationStageActive(request.settings,stage),index=order.indexOf(stage);
        const paused=active&&!this.all&&index>this.until&&this.credits<=0;
        emit({stage,status:'waiting',detail,paused});
        if(paused)await new Promise<void>(resolve=>this.release=resolve);
        this.check();if(active)this.credits=Math.max(0,this.credits-1);this.release=undefined;this.started=performance.now();emit({stage,status:'running',detail});
      },
      after:async(stage,height,detail)=>{this.check();emit({stage,status:generationStageActive(request.settings,stage)?'done':'skipped',detail,elapsedMs:performance.now()-this.started,height:this.control.previews?height?.slice():undefined});}
    };
  }
  private check(){if(this.cancelled)throw new Error('Génération annulée.');}
  command(command:'next'|'all'|'cancel'){
    if(command==='cancel')this.cancelled=true;
    if(command==='all')this.all=true;
    if(command==='next')this.credits++;
    this.release?.();
  }
}

/** Physical intermediate fields use the ordinary map renderer, with no import/re-generation. */
export function pipelinePreview(source:Float32Array,request:TerrainRequest):TerrainData{
  const n=Math.sqrt(source.length),r=Math.min(n,256),height=new Float32Array(r*r),normalX=new Float32Array(r*r),normalY=new Float32Array(r*r),normalZ=new Float32Array(r*r),cell=request.settings.width/n;
  let min=Infinity,max=-Infinity;
  for(const h of source){min=Math.min(min,h);max=Math.max(max,h);}
  for(let y=0;y<r;y++)for(let x=0;x<r;x++){
    const px=Math.min(n-2,Math.max(1,Math.floor((x+.5)*n/r))),py=Math.min(n-2,Math.max(1,Math.floor((y+.5)*n/r))),i=py*n+px,j=y*r+x;
    height[j]=source[i];const gx=(source[i+1]-source[i-1])/(2*cell),gy=(source[i+n]-source[i-n])/(2*cell),len=Math.hypot(gx,gy,1);normalX[j]=-gx/len;normalY[j]=-gy/len;normalZ[j]=1/len;
  }
  return {x:0,y:0,width:request.settings.width,resolution:r,minHeight:min,maxHeight:max,globalMinHeight:min,globalMaxHeight:max,motifSize:request.settings.motifSize,height,normalX,normalY,normalZ,caveMask:new Uint8Array(),generationMs:0,field:{n,data:source,exact:true,floor:0}};
}
