/** Loaded on the first Detailed click. Both looks render the same retained V2 world and camera. */
import { loadRenderGeometry } from '../../../rust/bridge/renderGeometry';
import { presetComposition } from '../render/composition';
import { resolveSettingsAppearance } from './appearance';
import { BenchRenderer } from './benchRenderer';
import { packWorldLanduse, unpackWorldLanduse } from './landusePack';
import { packWorldPartitions, unpackWorldPartitions } from './urbanPack';
import type { World } from '../gen/types';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { nativeCityRecords } from './nativeProducts';
import type { CityDetailStyle, DetailedCityResult } from './cityPreviewMap';
import { isFirefox } from '../ui/firefox';

export function detailedCityMap(data: DetailedCityResult, invalidate: () => void, previous?: { renderer: BenchRenderer; world: World }) {
  const world = unpackWorldPartitions(unpackWorldLanduse(data.world));
  if (previous) {
    // A worker hop clones these immutable products. Preserve their render revisions on a house upgrade.
    world.terrain = previous.world.terrain;
    world.roads = previous.world.roads;
    world.names = previous.world.names;
    world.landuse = previous.world.landuse;
    world.site = previous.world.site;
    if (world.debug) world.debug.v2RustRegion = previous.world.debug?.v2RustRegion;
    const oldCity = nativeCityRecords(previous.world)?.main;
    const city = nativeCityRecords(world)?.main;
    if (oldCity && city && oldCity.layoutKey === city.layoutKey) {
      // The trees and street painters cache occupation by the original layout identity.
      if (city.compositionLayouts === city.layouts) city.compositionLayouts = oldCity.layouts;
      city.layouts = oldCity.layouts;
    }
  }
  const renderer = previous?.renderer ?? new BenchRenderer(invalidate);
  if (isFirefox()) renderer.useCanvasFastSatellite();
  let satelliteTown: ResolvedAppearance | undefined;
  const setStyle = async (style: CityDetailStyle) => {
    await loadRenderGeometry();
    // A live embed hides map text in its recipe. An explicit export layer mask would
    // also rasterize the full world's SVG overlay before the first town-sized frame.
    const composition = presetComposition(style);
    if (style !== 'minimal') composition.buildings = presetComposition('satellite-2').buildings;
    // The natural satellite ground uses the light 2D shader. Render v2 needs a second
    // material pass that takes several seconds to compile in a cold FMG iframe.
    if (style === 'satellite-light') composition.ground.variant = 'render3d';
    composition.text.visible = false;
    const settings = { ...data.settings, appearance: { style: data.settings.options.style, ...data.settings.appearance, composition } };
    const appearance = resolveSettingsAppearance(settings, world, 'view2d');
    if (style === 'minimal') await renderer.set(world, settings, appearance);
    else {
      // Both satellite buttons switch the background behind exactly the same town ink and roofs.
      satelliteTown ??= style === 'satellite-2' ? appearance : resolveSettingsAppearance({ ...settings, appearance: { ...settings.appearance, composition: presetComposition('satellite-2') } }, world, 'view2d');
      await renderer.set(world, settings, { ...appearance, city: satelliteTown.city, keys: { ...appearance.keys, city: satelliteTown.keys.city } });
    }
  };
  const packForUpgrade = () => {
    const cover = packWorldLanduse(world);
    const city = packWorldPartitions(cover.world);
    return { world: city.world, transfer: [...cover.transfer, ...city.transfer] };
  };
  return { renderer, setStyle, world, packForUpgrade };
}
