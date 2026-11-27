import CityWorker from './cityEmbed.worker?worker';
import { compactPreviewKey } from './cityEmbedCache';
import { cityEmbedHints } from './cityEmbedInput';
import { presetComposition } from '../render/composition';
import { unpackWorldLanduse } from './landusePack';
import { unpackWorldPartitions } from './urbanPack';
import type { CityPreviewRequest, CityPreviewResponse } from './cityPreviewMap';
import type { ProgressCallback, V2Settings } from './contracts';
import type { World } from '../gen/types';

/** Accept only the bounded FMG payload and view options the iframe publishes. */
export async function openCityPreview(source: string, link: URLSearchParams, progress?: ProgressCallback): Promise<{ settings: V2Settings; world: World; mods: [] }> {
  const mode = link.get('previewMode');
  if (!['compact', 'detailed', 'houses'].includes(mode ?? '') || source.length > 65536) throw new Error('Invalid city preview link.');
  const hints = cityEmbedHints(source), local = link.get('previewLocal') === '1' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const threaded = !local && link.get('previewThreads') === '1';
  const style = link.get('previewStyle');
  const layoutKey = await compactPreviewKey(hints, threaded, local).catch(() => undefined);
  const worker = new CityWorker({ name: `magna-city-studio profile=${local ? 'local' : 'web'} threads=${threaded ? 'auto' : 'off'}` });
  try {
    return await new Promise((resolve, reject) => {
      const stopped = () => reject(new Error('The city generator stopped.'));
      worker.onerror = worker.onmessageerror = stopped;
      worker.onmessage = ({ data }: MessageEvent<CityPreviewResponse>) => {
        if (data.type === 'error') reject(new Error(data.error));
        if (data.type === 'progress') progress?.(data.progress);
        if (data.type === 'studio-city') {
          try {
            const settings = data.settings;
            if (style === 'satellite-light' || style === 'satellite-2') settings.appearance!.composition = presetComposition(style);
            resolve({ settings, world: unpackWorldPartitions(unpackWorldLanduse(data.world)), mods: [] });
          } catch (error) {
            reject(error);
          }
        }
      };
      worker.postMessage({ hints, local, mode: mode as CityPreviewRequest['mode'], layoutKey, studio: { fromDetailed: link.get('previewFromDetailed') === '1' } } satisfies CityPreviewRequest);
    });
  } finally {
    worker.terminate();
  }
}
