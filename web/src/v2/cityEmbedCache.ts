import { digestValue, readUrbanCache, writeUrbanCache } from '../../../rust/bridge/urbanResultCache';
import type { ExternalCityHints } from './externalCity/types';
import type { CityPreviewResult } from './cityPreviewMap';

const build = import.meta.env.VITE_BUILD_COMMIT + ':' + import.meta.env.VITE_BUILD_DATE;
const MAX_MAP_BYTES = 2 * 1024 * 1024;

export async function compactPreviewKey(hints: ExternalCityHints, threaded: boolean): Promise<string | undefined> {
  // The built artifact identifies its renderer, generator and geometry format.
  if (import.meta.env.DEV || !globalThis.crypto?.subtle) return undefined;
  return 'fmg-preview:' + (await digestValue([build, threaded, hints]));
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
