import { afterEach, expect, it, vi } from 'vitest';
import { OVERPASS_ENDPOINTS } from '../../src/v2/osm/osmSources';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('leaves a stalled first server, reuses the successful reply, then prefers the working server', async () => {
  vi.useFakeTimers();
  const { browserOsmFetchers } = await import('../../src/v2/osm/browserSources');
  const [first, fallback] = OVERPASS_ENDPOINTS;
  const signal = new AbortController().signal;
  const fetch = vi.fn((url: string, options: RequestInit): Promise<Response> => {
    if (url === fallback) return Promise.resolve(Response.json({ elements: [] }));
    return new Promise((_, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }));
  });
  vi.stubGlobal('fetch', fetch);
  const onFallback = vi.fn();
  const reply = browserOsmFetchers(signal, { onFallback }).overpass('first area', 'query');
  await vi.advanceTimersByTimeAsync(24_999);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([first]);
  await vi.advanceTimersByTimeAsync(1);
  expect(await reply).toEqual({ elements: [] });
  expect(onFallback).toHaveBeenCalledOnce();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([first, fallback]);
  await browserOsmFetchers(signal).overpass('first area', 'query');
  expect(fetch).toHaveBeenCalledTimes(2);
  await browserOsmFetchers(signal).overpass('new area', 'query');
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([first, fallback, fallback]);
});

it('reports both server failures when a timeout is followed by a 502', async () => {
  vi.useFakeTimers();
  const { browserOsmFetchers, OverpassUnavailable } = await import('../../src/v2/osm/browserSources');
  const [first] = OVERPASS_ENDPOINTS;
  vi.stubGlobal('fetch', (url: string, options: RequestInit): Promise<Response> => {
    if (url !== first) return Promise.resolve(new Response(null, { status: 502 }));
    return new Promise((_, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }));
  });
  const result = browserOsmFetchers(new AbortController().signal)
    .overpass('area', 'query')
    .catch(error => error);
  await vi.advanceTimersByTimeAsync(25_000);
  const error = await result;
  expect(error).toBeInstanceOf(OverpassUnavailable);
  expect(error.message).toContain('No response after 25 seconds');
  expect(error.message).toContain('HTTP 502');
});

it('allows a download that has already started to run past the first-response deadline', async () => {
  vi.useFakeTimers();
  const { browserOsmFetchers } = await import('../../src/v2/osm/browserSources');
  const bytes = new TextEncoder();
  const fetch = vi.fn((_url: string, options: RequestInit) => {
    const response = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(bytes.encode('{"elements":'));
        const finish = setTimeout(() => {
          stream.enqueue(bytes.encode('[]}'));
          stream.close();
        }, 30_000);
        options.signal!.addEventListener('abort', () => {
          clearTimeout(finish);
          stream.error(options.signal!.reason);
        }, { once: true });
      },
    });
    return Promise.resolve(new Response(response));
  });
  vi.stubGlobal('fetch', fetch);
  const reply = browserOsmFetchers(new AbortController().signal).overpass('area', 'query');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await reply).toEqual({ elements: [] });
  expect(fetch).toHaveBeenCalledOnce();
});
