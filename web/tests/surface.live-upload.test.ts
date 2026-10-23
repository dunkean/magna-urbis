import { describe,expect,it } from 'vitest';
import { postSurfaceBinary,SURFACE_UPLOAD_CHUNK_BYTES } from '../src/ui/surfaceLiveUpload';

function packet(bytes=SURFACE_UPLOAD_CHUNK_BYTES*2+37){return Uint8Array.from({length:bytes},(_,i)=>(i*37+17)%256);}
describe('bounded exact live surface uploads',()=>{
  it('posts contiguous <=4MiB slices, exact decimal/session headers and byte-identical packet content',async()=>{
    const source=packet(),received=new Uint8Array(source.length),calls:RequestInit[]=[];let offset=0;
    const transport=(async(url,init)=>{
      expect(url).toBe('/surface-live/reply/job');calls.push(init!);const headers=new Headers(init!.headers),body=init!.body as Uint8Array;
      expect(init!.method).toBe('POST');expect(headers.get('X-Surface-Session')).toBe('session');expect(headers.get('X-Surface-Total')).toBe(String(source.length));
      expect(headers.get('X-Surface-Offset')).toBe(String(offset));expect(headers.get('Content-Type')).toBe('application/octet-stream');
      expect(body.byteLength).toBeLessThanOrEqual(4*1024*1024);expect(body.buffer).toBe(source.buffer);received.set(body,offset);offset+=body.length;
      return Response.json(offset===source.length?{accepted:true}:{accepted:false,received:offset,total:source.length});
    }) as typeof fetch;
    await postSurfaceBinary('/surface-live/reply/job',source.buffer,'session',undefined,transport);
    expect(calls).toHaveLength(3);expect(Buffer.from(received.buffer).equals(Buffer.from(source.buffer))).toBe(true);
  });
  it('uses the same bounded protocol for a small packet and verifies the final acknowledgement',async()=>{
    let calls=0;await postSurfaceBinary('/reply',packet(21).buffer,'session',undefined,(async(_url,init)=>{calls++;
      expect(new Headers(init!.headers).get('X-Surface-Offset')).toBe('0');return Response.json({accepted:true});}) as typeof fetch);
    expect(calls).toBe(1);
    await expect(postSurfaceBinary('/reply',packet(21).buffer,'session',undefined,(async()=>Response.json({accepted:false,received:21,total:21})) as typeof fetch)).rejects.toThrow(/complete packet/);
  });
  it('aborts before start, between acknowledgements and in an active fetch without sending another chunk',async()=>{
    const before=new AbortController();before.abort();let calls=0;
    await expect(postSurfaceBinary('/reply',packet(21).buffer,'session',before.signal,(async()=>{calls++;return Response.json({accepted:true});}) as typeof fetch)).rejects.toMatchObject({name:'AbortError'});expect(calls).toBe(0);
    const between=new AbortController();calls=0;
    await expect(postSurfaceBinary('/reply',packet().buffer,'session',between.signal,(async(_url,init)=>{calls++;expect(init!.signal).toBe(between.signal);between.abort();
      return Response.json({accepted:false,received:SURFACE_UPLOAD_CHUNK_BYTES,total:SURFACE_UPLOAD_CHUNK_BYTES*2+37});}) as typeof fetch)).rejects.toMatchObject({name:'AbortError'});expect(calls).toBe(1);
    const active=new AbortController();calls=0;
    const job=postSurfaceBinary('/reply',packet().buffer,'session',active.signal,((_url,init)=>{calls++;return new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));}) as typeof fetch);
    active.abort();await expect(job).rejects.toMatchObject({name:'AbortError'});expect(calls).toBe(1);
  });
  it('stops immediately on HTTP errors, gaps, changed totals or an incorrectly accepted partial packet',async()=>{
    for(const first of [()=>new Response('stale',{status:410}),()=>Response.json({accepted:false,received:3,total:SURFACE_UPLOAD_CHUNK_BYTES*2+37}),
      ()=>Response.json({accepted:false,received:SURFACE_UPLOAD_CHUNK_BYTES,total:17}),()=>Response.json({accepted:true})]){
      let calls=0;await expect(postSurfaceBinary('/reply',packet().buffer,'session',undefined,(async()=>{calls++;return first();}) as typeof fetch)).rejects.toThrow();expect(calls).toBe(1);
    }
  });
});
