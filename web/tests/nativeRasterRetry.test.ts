import { expect, it, vi } from 'vitest';
import { nativeRasterClient } from '../../rust/bridge/nativeEngine';
import type { SettlementRaster } from '../../rust/bridge/settlements';

/** A fake engine: sessions hold terrains; `restart()` drops every session and shared raster. */
function fakeEngine() {
  const sessions = new Set<string>(), rasters = new Set<string>(), calls: string[] = [];
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/raster') {
      const bytes = await (init.body as Blob).arrayBuffer(), length = new DataView(bytes).getUint32(0, true);
      const header = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 4, length))) as { session: string; rasterId: string; shared?: boolean };
      calls.push(header.shared ? 'share' : 'upload');
      if (header.shared && !rasters.has(header.rasterId)) return reply(400, { error: '[raster_missing] Shared raster released; upload it again.' });
      sessions.add(header.session); rasters.add(header.rasterId);
      return reply(200, { ok: true });
    }
    const { session } = JSON.parse(String(init.body)) as { session: string };
    calls.push(path);
    return sessions.has(session) ? reply(200, { ok: true })
      : reply(400, { error: '[raster_missing] Generate the terrain before settlement sites and roads.' });
  });
  return { fetchMock, calls, restart: () => { sessions.clear(); rasters.clear(); } };
}

it('re-uploads the last raster and retries once when the engine lost the session terrain', async () => {
  const n = 16, size = n * n;
  const raster: SettlementRaster = { width: 500, n, height: new Float32Array(size), water: new Uint8Array(size),
    waterLevel: new Float32Array(size), riverWidth: new Float32Array(size), riverIds: new Int32Array(size).fill(-1) };
  const runtime = { profile: 'local' as const, server: 'http://localhost:8791' };
  const engine = fakeEngine();
  vi.stubGlobal('fetch', engine.fetchMock);
  try {
    const client = nativeRasterClient();
    await expect(client('/settlements', { runtime, raster, seed: 's' })).resolves.toEqual({ ok: true });
    engine.restart();
    engine.calls.length = 0;
    // The caller trusts its retained terrain and sends no raster.
    await expect(client('/settlements', { runtime, seed: 's' })).resolves.toEqual({ ok: true });
    expect(engine.calls).toEqual(['/settlements', 'upload', '/settlements']);
    // A client that never sent a raster has nothing to re-upload: the coded error reaches the caller.
    await expect(nativeRasterClient()('/settlements', { runtime, seed: 's' })).rejects.toThrow('[raster_missing]');
  } finally { vi.unstubAllGlobals(); }
});
