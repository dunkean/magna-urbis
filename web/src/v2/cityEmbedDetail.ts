/** Loaded on the first Detailed click. Both looks render the same retained V2 world and camera. */
import { loadRenderGeometry } from '../../../rust/bridge/renderGeometry';
import { presetComposition } from '../render/composition';
import { resolveSettingsAppearance } from './appearance';
import { BenchRenderer } from './benchRenderer';
import { unpackWorldLanduse } from './landusePack';
import { unpackWorldPartitions } from './urbanPack';
import type { CityDetailStyle, DetailedCityResult } from './cityPreviewMap';

export function detailedCityMap(data: DetailedCityResult, invalidate: () => void) {
  const world = unpackWorldPartitions(unpackWorldLanduse(data.world));
  const renderer = new BenchRenderer(invalidate);
  const setStyle = async (style: CityDetailStyle) => {
    await loadRenderGeometry();
    const settings = { ...data.settings, appearance: { style: data.settings.options.style, ...data.settings.appearance, composition: presetComposition(style) } };
    const appearance = resolveSettingsAppearance(settings, world, 'view2d');
    await renderer.set(world, settings, appearance, { labels: false });
  };
  return { renderer, setStyle };
}
