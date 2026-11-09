import { routeRoad } from './roadRoute';
import type { World, Vec2 } from '../gen/types';
import type { V2Settings } from './contracts';
self.onmessage=async({data}:MessageEvent<{world:World;settings:V2Settings;start:Vec2;end:Vec2}>)=>{
  try{const result=await routeRoad(data.world,data.settings,data.start,data.end);const segment=result.segments[0];self.postMessage({path:result.path,cls:segment?.class,width:segment?.width});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
