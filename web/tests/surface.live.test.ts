import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createSurfaceLiveBroker } from '../scripts/surface_live_plugin';
import { encodeSurfaceBinary, decodeSurfaceBinary } from '../src/surface/binary';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
async function start(timeout = 5000) {
  const broker = createSurfaceLiveBroker(timeout);
  const server: Server = createServer((req, res) => { void broker.handle(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => { broker.close(); server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const region = { x: 4000, y: 2000, extent: 1000, resolution: 64 };
const post = (url: string, value: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
async function connect(base: string) {
  const controller = new AbortController(); cleanup.push(() => controller.abort());
  const response = await fetch(`${base}/surface-live/events`, { signal: controller.signal });
  const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
  async function event() {
    while (!buffer.includes('\n\n')) { const data = await reader.read(); if (data.done) throw new Error('Unexpected event stream end'); buffer += decoder.decode(data.value, { stream: true }); }
    const at = buffer.indexOf('\n\n'), raw = buffer.slice(0, at); buffer = buffer.slice(at + 2);
    return { name: raw.match(/^event: (.+)$/m)?.[1], data: JSON.parse(raw.match(/^data: (.+)$/m)![1]) };
  }
  return { event, session: (await event()).data.sessionId as string };
}
describe('Surface live transport', () => {
  it('rejects foreign browser origins and simple cross-origin POSTs', async () => {
    const base = await start();
    expect((await fetch(`${base}/surface-live/terrain`, { method: 'POST', headers: { Origin: 'https://elsewhere.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ region }) })).status).toBe(403);
    expect((await fetch(`${base}/surface-live/terrain`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ region }) })).status).toBe(415);
  });
  it('reports supersession as cancellation rather than a generation failure', async () => {
    const base = await start(), browser = await connect(base);
    const pending = post(`${base}/surface-live/terrain`, { region });
    const request = await browser.event();
    await post(`${base}/surface-live/reply/${request.data.id}`, { sessionId: browser.session, cancelled: true, error: 'superseded' });
    const response = await pending; expect(response.status).toBe(409); expect(await response.json()).toEqual({ cancelled: true, reason: 'superseded' });
  });
  it('requires a generation browser and validates requests before queueing', async () => {
    const base = await start();
    expect((await post(`${base}/surface-live/terrain`, { region })).status).toBe(503);
    expect((await post(`${base}/surface-live/terrain`, { region: { ...region, resolution: 3 } })).status).toBe(400);
    expect((await fetch(`${base}/surface-live/sessions`).then(r => r.json())).sessions).toEqual([]);
  });
  it('routes source payload unchanged to the requesting viewer and rejects other sessions', async () => {
    const base = await start(), browser = await connect(base);
    const response = post(`${base}/surface-live/terrain`, { region, sessionId: browser.session });
    const request = await browser.event(); expect(request.name).toBe('terrain'); expect(request.data.region).toEqual(region);
    const route = `${base}/surface-live/reply/${request.data.id}`;
    expect((await post(route, { sessionId: 'another-browser', packet: {} })).status).toBe(409);
    const packet = { format: 'magna-surface-packet', version: 1, world: { terrain: { source: { id: 'infinite', sourceLOD: -2, nativeSpacingM: .375 } } } };
    expect((await post(route, { sessionId: browser.session, packet })).status).toBe(200);
    expect(await (await response).json()).toEqual(packet);
    expect((await post(route, { sessionId: browser.session, packet })).status).toBe(410);
  });
  it('expires pending work and explicitly cancels browser generation', async () => {
    const base = await start(100), browser = await connect(base);
    const response = post(`${base}/surface-live/terrain`, { region });
    const request = await browser.event();
    expect((await response).status).toBe(504);
    const cancellation = await browser.event(); expect(cancellation).toEqual({ name: 'cancel', data: { id: request.data.id } });
    expect((await post(`${base}/surface-live/reply/${request.data.id}`, { sessionId: browser.session, packet: {} })).status).toBe(410);
  });
  it('forwards binary typed fields without a JSON conversion', async () => {
    const base = await start(), browser = await connect(base);
    const response = post(`${base}/surface-live/terrain`, { region });
    const request = await browser.event(), samples = new Float32Array([.1, 42, NaN]);
    const binary = encodeSurfaceBinary({ world: { samples } });
    expect((await fetch(`${base}/surface-live/reply/${request.data.id}`, { method: 'POST', headers: {
      'Content-Type': 'application/octet-stream', 'X-Surface-Session': browser.session }, body: binary.buffer as ArrayBuffer })).status).toBe(200);
    const result = await response;
    expect(result.headers.get('content-type')).toBe('application/octet-stream');
    expect(Number(result.headers.get('content-length'))).toBe(binary.byteLength);
    expect(result.headers.get('transfer-encoding')).toBeNull();
    const copy = decodeSurfaceBinary<{ world: { samples: Float32Array } }>(new Uint8Array(await result.arrayBuffer()));
    expect(copy.world.samples).toEqual(samples);
  });
  it('assembles only contiguous session-owned chunks and sends one fixed-length native response',async()=>{
    const base=await start(),browser=await connect(base),pending=post(`${base}/surface-live/terrain`,{region});
    const request=await browser.event(),url=`${base}/surface-live/reply/${request.data.id}`;
    const binary=encodeSurfaceBinary({samples:new Float32Array(5*1024*1024).fill(1.25)});
    const part=(offset:number,total:number,data:Uint8Array,session=browser.session)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Surface-Session':session,'X-Surface-Offset':String(offset),'X-Surface-Total':String(total)},body:data as Uint8Array<ArrayBuffer>});
    expect((await part(4,binary.length,binary.subarray(0,4))).status).toBe(409);
    expect((await part(0,binary.length,binary.subarray(0,16),'foreign')).status).toBe(409);
    const chunk=4*1024*1024;
    expect(await (await part(0,binary.length,binary.subarray(0,chunk))).json()).toEqual({accepted:false,received:chunk,total:binary.length});
    expect((await part(0,binary.length,binary.subarray(0,16))).status).toBe(409);
    expect((await part(chunk,binary.length+1,binary.subarray(chunk,chunk+16))).status).toBe(409);
    for(let at=chunk;at<binary.length;at+=chunk){const end=Math.min(at+chunk,binary.length);const ack=await(await part(at,binary.length,binary.subarray(at,end))).json();expect(ack.accepted).toBe(end===binary.length);}
    const result=await pending;expect(result.headers.get('content-length')).toBe(String(binary.length));expect(result.headers.get('transfer-encoding')).toBeNull();
    const output=new Uint8Array(await result.arrayBuffer());expect(Buffer.from(output.buffer,output.byteOffset,output.byteLength).equals(Buffer.from(binary.buffer,binary.byteOffset,binary.byteLength))).toBe(true);
    expect((await part(0,binary.length,binary.subarray(0,16))).status).toBe(410);
  });
  it('releases a partial upload when its native viewer cancels',async()=>{
    const base=await start(),browser=await connect(base),controller=new AbortController();
    const pending=fetch(`${base}/surface-live/terrain`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({region}),signal:controller.signal});
    const aborted=expect(pending).rejects.toThrow(/abort/i),request=await browser.event();
    const url=`${base}/surface-live/reply/${request.data.id}`,binary=encodeSurfaceBinary({height:new Float32Array(20)});
    const chunk=(offset:number)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Surface-Session':browser.session,'X-Surface-Offset':String(offset),'X-Surface-Total':String(binary.length)},body:binary.subarray(offset,offset+16) as Uint8Array<ArrayBuffer>});
    expect((await chunk(0)).status).toBe(200);controller.abort();await aborted;
    expect((await browser.event()).name).toBe('cancel');expect((await chunk(16)).status).toBe(410);
  });
});
