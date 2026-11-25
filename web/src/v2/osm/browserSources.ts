import { OVERPASS_ENDPOINTS, OVERPASS_IMPORT_TIMEOUT_SECONDS, type OsmFetchers, type OverpassReply } from './osmSources';

type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: { name: string; city?: string; county?: string; state?: string; country?: string; extent?: [number, number, number, number] } };

const FIRST_RESPONSE_WAIT_MS = 25_000;
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX_BYTES = 32 * 1024 * 1024;
let preferredOverpass: string | undefined;
let lastOverpass: { query: string; result: OverpassReply; expires: number } | undefined;

export class OverpassUnavailable extends Error {}

export async function findOsmPlaces(query: string, language: string, signal: AbortSignal): Promise<PhotonFeature[]> {
  const params = new URLSearchParams({ q: query, limit: '6' });
  // The public Photon index has a fixed set of supported translation languages.
  if (['en', 'fr', 'de'].includes(language)) params.set('lang', language);
  for (const layer of ['city', 'district', 'locality', 'county', 'state']) params.append('layer', layer);
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);
  const { features } = (await response.json()) as { features: PhotonFeature[] };
  return features.filter(feature => feature.properties.name && feature.geometry.coordinates.every(Number.isFinite));
}

export function browserOsmFetchers(signal: AbortSignal, progress: { onFallback?: () => void; onBytes?: (bytes: number) => void } = {}): OsmFetchers {
  return {
    async overpass(query): Promise<OverpassReply> {
      signal.throwIfAborted();
      if (lastOverpass?.query === query && lastOverpass.expires > Date.now()) return lastOverpass.result;
      if (lastOverpass && lastOverpass.expires <= Date.now()) lastOverpass = undefined;
      const failures: string[] = [];
      const endpoints = preferredOverpass ? [preferredOverpass, ...OVERPASS_ENDPOINTS.filter(endpoint => endpoint !== preferredOverpass)] : OVERPASS_ENDPOINTS;
      for (const [attempt, endpoint] of endpoints.entries()) {
        signal.throwIfAborted();
        if (attempt) progress.onFallback?.();
        const firstResponse = new AbortController();
        // Give a proven server or the last available server the full request budget.
        const waiting = endpoint !== preferredOverpass && attempt < endpoints.length - 1 ? setTimeout(() => firstResponse.abort(new DOMException(`No response after ${FIRST_RESPONSE_WAIT_MS / 1000} seconds`, 'TimeoutError')), FIRST_RESPONSE_WAIT_MS) : undefined;
        try {
          const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.any([signal, firstResponse.signal, AbortSignal.timeout((OVERPASS_IMPORT_TIMEOUT_SECONDS + 10) * 1000)]) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          let received = 0;
          const result = await overpassReply(response, bytes => {
            if (!received) clearTimeout(waiting);
            received = bytes;
            progress.onBytes?.(bytes);
          });
          if (result.remark || !Array.isArray(result.elements)) throw new Error(result.remark || 'Invalid Overpass reply');
          preferredOverpass = endpoint;
          if (received && received <= CACHE_MAX_BYTES) lastOverpass = { query, result, expires: Date.now() + CACHE_TTL_MS };
          return result;
        } catch (error) {
          signal.throwIfAborted();
          failures.push(`${new URL(endpoint).host}: ${error instanceof Error ? error.message : String(error)}`);
          if (preferredOverpass === endpoint) preferredOverpass = undefined;
        } finally {
          clearTimeout(waiting);
        }
      }
      throw new OverpassUnavailable(failures.join('\n'));
    },

    async tile(_zoom, _x, _y, url) {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
      if (!response.ok) throw new Error(`AWS Terrain Tiles HTTP ${response.status}`);
      // Terrarium RGB values encode metres. Preserve the raw channels when decoding the PNG.
      const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      try {
        if (bitmap.width !== 256 || bitmap.height !== 256) throw new Error('Invalid AWS Terrain Tiles image');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas 2D unavailable');
        context.drawImage(bitmap, 0, 0);
        return { w: 256, h: 256, channels: 4, data: context.getImageData(0, 0, 256, 256).data };
      } finally {
        bitmap.close();
      }
    },
  };
}

async function overpassReply(response: Response, onBytes: (bytes: number) => void): Promise<OverpassReply> {
  if (!response.body) return response.json();
  let bytes = 0;
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        onBytes(bytes);
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(stream).json();
}
