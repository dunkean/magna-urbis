import { assertNotAborted } from '../surface/model';
import { SURFACE_PACKET_MAX_BYTES,SURFACE_UPLOAD_CHUNK_BYTES } from '../surface/limits';
export { SURFACE_UPLOAD_CHUNK_BYTES } from '../surface/limits';

/** Ordered, bounded HTTP/1-compatible upload of the exact compiler packet.
 * Every slice is a view of the original bytes; no geometry or numeric field is
 * decoded, rounded or regenerated. The broker forwards only the complete packet. */
export async function postSurfaceBinary(url:string,binary:ArrayBuffer,sessionId:string,signal?:AbortSignal,transport:typeof fetch=fetch):Promise<void> {
  assertNotAborted(signal);
  if(typeof url!=='string'||!url||typeof sessionId!=='string'||!sessionId||sessionId.length>1024||!(binary instanceof ArrayBuffer)
    ||binary.byteLength<16||binary.byteLength>SURFACE_PACKET_MAX_BYTES)throw new Error('Invalid bounded surface binary upload');
  const bytes=new Uint8Array(binary),total=bytes.byteLength;
  for(let offset=0;offset<total;offset+=SURFACE_UPLOAD_CHUNK_BYTES){
    assertNotAborted(signal);
    const end=Math.min(total,offset+SURFACE_UPLOAD_CHUNK_BYTES);
    const response=await transport(url,{method:'POST',signal,headers:{'Content-Type':'application/octet-stream','X-Surface-Session':sessionId,
      'X-Surface-Offset':String(offset),'X-Surface-Total':String(total)},body:bytes.subarray(offset,end)});
    assertNotAborted(signal);
    if(!response.ok)throw new Error(`Surface binary upload failed: HTTP ${response.status} ${(await response.text()).slice(0,2048)}`);
    const acknowledgement=await response.json() as {accepted?:unknown;received?:unknown;total?:unknown};
    assertNotAborted(signal);
    if(end<total){
      if(acknowledgement.accepted!==false||acknowledgement.received!==end||acknowledgement.total!==total)throw new Error('Invalid partial surface upload acknowledgement');
    }else if(acknowledgement.accepted!==true
      ||acknowledgement.received!==undefined&&acknowledgement.received!==total||acknowledgement.total!==undefined&&acknowledgement.total!==total)throw new Error('Surface binary upload was not accepted as a complete packet');
  }
}
