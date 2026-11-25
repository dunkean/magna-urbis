import { OVERPASS_ENDPOINTS, type OsmFetchers, type OverpassReply } from './osmSources';

type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: { name: string; city?: string; county?: string; state?: string; country?: string; extent?: [number, number, number, number] } };

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

export function browserOsmFetchers(signal: AbortSignal): OsmFetchers {
  return {
    async overpass(query): Promise<OverpassReply> {
      const failures: string[] = [];
      for (const endpoint of OVERPASS_ENDPOINTS) {
        signal.throwIfAborted();
        try {
          const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.any([signal, AbortSignal.timeout(195000)]) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const result = (await response.json()) as OverpassReply;
          if (result.remark || !Array.isArray(result.elements)) throw new Error(result.remark || 'Invalid Overpass reply');
          return result;
        } catch (error) {
          signal.throwIfAborted();
          failures.push(`${new URL(endpoint).host}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      throw new Error(failures.join('\n'));
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
