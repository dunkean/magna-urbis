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
    // A live embed hides map text in its recipe. An explicit export layer mask would
    // also rasterize the full world's SVG overlay before the first town-sized frame.
    const composition = presetComposition(style);
    // The natural satellite ground uses the light 2D shader. Render v2 needs a second
    // material pass that takes several seconds to compile in a cold FMG iframe.
    if (style === 'satellite-light') composition.ground.variant = 'render3d';
    composition.text.visible = false;
    const settings = { ...data.settings, appearance: { style: data.settings.options.style, ...data.settings.appearance, composition } };
    const appearance = resolveSettingsAppearance(settings, world, 'view2d');
    await renderer.set(world, settings, appearance);
  };
  return { renderer, setStyle };
}
