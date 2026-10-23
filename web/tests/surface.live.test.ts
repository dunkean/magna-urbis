import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createSurfaceLiveBroker } from '../scripts/surface_live_plugin';

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
});
