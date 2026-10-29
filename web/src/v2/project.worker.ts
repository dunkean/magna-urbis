import { parseProjectInput, serializeProjectChunks } from './project';
import type { V2Settings } from './contracts';
import type { World } from '../gen/types';
import { resultTransferBuffers } from './transfer';
const ctx = self as unknown as Worker;
ctx.onmessage = ({ data }: MessageEvent<{ action:'parse'; text:string } | { action:'serialize'; settings:V2Settings; world?:World; mods:unknown[] }>) => {
  try {
    if (data.action === 'parse') {
      const result=parseProjectInput(data.text);ctx.postMessage({result},resultTransferBuffers(result));
    }
    else ctx.postMessage({ result: new Blob(serializeProjectChunks(data.settings,data.world,data.mods),{type:'application/json'}) });
  }catch(error){ctx.postMessage({error:error instanceof Error?error.message:String(error)});}
};
