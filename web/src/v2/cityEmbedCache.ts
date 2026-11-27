import { digestValue, readUrbanCache, writeUrbanCache, tryWriteUrbanCache } from '../../../rust/bridge/urbanResultCache';
import type { ExternalCityHints } from './externalCity/types';
import type { Rect4, View } from '../render/view';
import type { World } from '../gen/types';
import type { CityDetailStyle, DetailedCityResult, CityPreviewResult } from './cityPreviewMap';

const build = import.meta.env.VITE_BUILD_COMMIT + ':' + import.meta.env.VITE_BUILD_DATE;
const MAX_MAP_BYTES = 2 * 1024 * 1024;

export async function compactPreviewKey(hints: ExternalCityHints, threaded: boolean, local = false): Promise<string | undefined> {
  // The built artifact identifies its renderer, generator and geometry format.
  if (!globalThis.crypto?.subtle) return undefined;
  let engine = 'web';
  if (local) {
    const response = await fetch('http://127.0.0.1:8791/status', { cache: 'no-store', signal: AbortSignal.timeout(1200) });
    const status = await response.json();
    if (!response.ok || typeof status.build !== 'string') return undefined;
    engine = 'native:' + status.build;
  }
  return 'fmg-preview:' + (await digestValue([build, engine, threaded, hints]));
}

export async function readCompactPreview(key: string): Promise<CityPreviewResult | undefined> {
  // Third-party storage can be unavailable or slow. Do not hold up a cold generation.
  let timeout: number | undefined;
  try {
    return await Promise.race([
      readUrbanCache<CityPreviewResult>(key),
      new Promise<undefined>(resolve => {
        timeout = window.setTimeout(resolve, 80);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function saveCompactPreview(key: string, view: CityPreviewResult): void {
  const geometry = view.map.geometry;
  const bytes = geometry.coords.byteLength + geometry.rings.byteLength + 2048;
  if (bytes <= MAX_MAP_BYTES) void writeUrbanCache(key, view, bytes);
}
export const readCityLayout = (key: string) => readUrbanCache<World>(key + ':layout');
export const saveCityLayout = (key: string, world: World) => tryWriteUrbanCache(key + ':layout', world);

export interface SavedCityView {
  image: Blob;
  tier: DetailedCityResult['mode'];
  style: CityDetailStyle;
  bounds: Rect4;
  camera: View;
  view: View;
  width: number;
  height: number;
  fromDetailed?: boolean;
}

export const readCityView = (key: string) => readUrbanCache<SavedCityView>(key + ':view');
export const readCityWorld = (key: string, tier: DetailedCityResult['mode']) => readUrbanCache<DetailedCityResult>(key + ':' + tier);
export const saveCityWorld = (key: string, data: DetailedCityResult) => writeUrbanCache(key + ':' + data.mode, data);

export async function saveCityView(key: string, value: SavedCityView): Promise<boolean> {
  return tryWriteUrbanCache(key + ':view', value, value.image.size + 512);
}
