import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';
export interface SurfaceLiveRegion { x: number; y: number; extent: number; resolution: number; knownContextId?: string }
interface Pending { client: string; response: ServerResponse; timer: ReturnType<typeof setTimeout> }
async function readBytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk); length += bytes.length;
    if (length > limit) throw new Error('Request body is too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
async function readJson(request: IncomingMessage, limit: number): Promise<any> { return JSON.parse((await readBytes(request, limit)).toString('utf8')); }
function reply(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
/** Optional local transport; the browser retains generation settings and source ownership. */
export function createSurfaceLiveBroker(timeoutMs = 120000) {
  const clients = new Map<string, ServerResponse>(), pending = new Map<string, Pending>();
  const event = (id: string, name: string, data: unknown) => clients.get(id)?.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  const cancel = (id: string, reason: string, status = 499) => {
    const item = pending.get(id); if (!item) return;
    pending.delete(id); clearTimeout(item.timer); event(item.client, 'cancel', { id });
    reply(item.response, status, { error: reason });
  };
  const handle = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/surface-live/')) { next(); return; }
    try {
      if (request.method === 'GET' && url.pathname === '/surface-live/sessions') {
        reply(response, 200, { schemaVersion: 1, sessions: [...clients.keys()] }); return;
      }
      if (request.method === 'GET' && url.pathname === '/surface-live/events') {
        const id = randomUUID();
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        clients.set(id, response); event(id, 'ready', { sessionId: id });
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
        response.on('close', () => {
          clearInterval(heartbeat); clients.delete(id);
          for (const [requestId, item] of pending) if (item.client === id) cancel(requestId, 'Generation browser disconnected', 503);
        }); return;
      }
      if (request.method === 'POST' && url.pathname === '/surface-live/terrain') {
        if (pending.size >= 4) { reply(response, 429, { error: 'Surface generation queue is full' }); return; }
        const body = await readJson(request, 65536), region = body.region as SurfaceLiveRegion;
        if (!region || ![region.x, region.y, region.extent, region.resolution].every(Number.isFinite)
          || region.extent <= 0 || !Number.isInteger(region.resolution) || region.resolution < 4 || region.resolution > 1024
          || (region.knownContextId !== undefined && (typeof region.knownContextId !== 'string' || region.knownContextId.length > 256))) {
          reply(response, 400, { error: 'Expected finite region x/y/extent and integer resolution 4..1024' }); return;
        }
        const client = body.sessionId ?? [...clients.keys()].at(-1);
        if (!clients.has(client)) { reply(response, 503, { error: 'Open Terrain Bench in this server to connect Infinite Generation' }); return; }
        const id = randomUUID(), timer = setTimeout(() => cancel(id, 'Surface generation timed out', 504), timeoutMs);
        pending.set(id, { client, response, timer });
        response.on('close', () => { if (!response.writableEnded) cancel(id, 'Viewer cancelled generation'); });
        event(client, 'terrain', { id, region }); return;
      }
      if (request.method === 'POST' && url.pathname.startsWith('/surface-live/reply/')) {
        const id = url.pathname.slice('/surface-live/reply/'.length), item = pending.get(id);
        if (!item) { reply(response, 410, { error: 'Request was cancelled or superseded' }); return; }
        if (request.headers['content-type']?.startsWith('application/octet-stream')) {
          if (request.headers['x-surface-session'] !== item.client) { reply(response, 409, { error: 'Wrong browser session' }); return; }
          const bytes = await readBytes(request, 256 * 1024 * 1024);
          if (bytes.length < 16 || bytes.subarray(0, 8).toString('ascii') !== 'MUFSURF1') { reply(response, 400, { error: 'Expected binary surface packet' }); return; }
          pending.delete(id); clearTimeout(item.timer);
          if (!item.response.destroyed && !item.response.writableEnded) {
            item.response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }); item.response.end(bytes);
          }
          reply(response, 200, { accepted: true }); return;
        }
        const body = await readJson(request, 256 * 1024 * 1024);
        if (body.sessionId !== item.client) { reply(response, 409, { error: 'Wrong browser session' }); return; }
        pending.delete(id); clearTimeout(item.timer);
        reply(item.response, body.error ? 422 : 200, body.error ? { error: body.error } : body.packet);
        reply(response, 200, { accepted: true }); return;
      }
      reply(response, 404, { error: 'Unknown surface live endpoint' });
    } catch (error) { reply(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
  };
  const close = () => {
    for (const id of pending.keys()) cancel(id, 'Surface server stopped', 503);
    for (const response of clients.values()) response.end();
    clients.clear();
  };
  return { handle, close };
}
export function surfaceLivePlugin(): Plugin {
  return { name: 'magna-surface-live', apply: 'serve', configureServer(server) {
    const broker = createSurfaceLiveBroker();
    server.middlewares.use((request, response, next) => { void broker.handle(request, response, next); });
    server.httpServer?.once('close', broker.close);
  } };
}
