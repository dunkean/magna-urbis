import type { World } from '../gen/types';
import type { V2Action } from './contracts';

/** One bounded worker snapshot. Identity tokens never substitute an imported or edited world. */
export class WorkerWorld {
  private current?: {id:number;world:World};
  resolve(id:number|undefined,provided:World|undefined):World|undefined{
    if(provided)return provided;
    if(id===undefined)return undefined;
    if(id!==this.current?.id)throw new Error('The generation worker snapshot expired. Retry with the retained project.');
    return this.current.world;
  }
  retain(id:number,world:World):void{this.current={id,world};}
  clear():void{this.current=undefined;}
}
export function generationWorldInput(action:V2Action,world:World|undefined,retained?:{id:number;world:World}):{world?:World;retainedWorldId?:number}{
  if(action==='terrain'||action==='all')return {};
  return world&&world===retained?.world?{retainedWorldId:retained.id}:{world};
}
