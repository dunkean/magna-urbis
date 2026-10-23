import { afterEach, expect, it, vi } from 'vitest';
import { readUrbanDisplayBuffers } from '../../rust/bridge/urbanDisplay';

afterEach(() => vi.unstubAllGlobals());

it('reads binary display data from the owning source without geometry upload or stale-source fallback', async () => {
  const source = { version: 1 as const, session: 'urban-owner', terrainRevision: 'terrain-1', layoutsRevision: 'layouts-2', partitionsRevision: 'parcels-3' };
  const runtime = { profile: 'local' as const, server: 'http://127.0.0.1:8811/' };
  const bytes = new Uint8Array([4, 0, 0, 0, 123, 125, 32, 32]);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: '[urban_source_stale]' }), { status: 400 }));
  vi.stubGlobal('fetch', fetch);
  expect(new Uint8Array(await readUrbanDisplayBuffers({ source, keys: ['city'], ids: true }, runtime))).toEqual(bytes);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, request] = fetch.mock.calls[0];
  expect(url).toBe('http://127.0.0.1:8811/urban');
  expect(JSON.parse(request!.body as string)).toEqual({ kind: 'displayBuffers', source, keys: ['city'], ids: true });
  await expect(readUrbanDisplayBuffers({ source }, runtime)).rejects.toThrow('[urban_source_stale]');
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(readUrbanDisplayBuffers({ source }, { ...runtime, profile: 'web' })).rejects.toThrow('local runtime');
  await expect(readUrbanDisplayBuffers({ source, keys: ['city', 'city'] }, runtime)).rejects.toThrow('keys');
  expect(fetch).toHaveBeenCalledTimes(2);
});
