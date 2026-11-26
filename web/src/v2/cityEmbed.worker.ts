/// <reference lib="webworker" />
/** The compact plan transfers drawing vectors. Detailed transfers the retained products for both studio looks. */
import { generateTerrain, generateTowns, namesRenamedAfterActions, planRegion } from './engine';
import { cityEmbedBounds, cityEmbedSettings } from './cityEmbedGeneration';
import { nativeCityRecords, nativeCitiesOf } from './nativeProducts';
import { retryNativeStage } from './runtimeChoices';
import { townPlanOf } from '../render/composition';
import { minimalFeatures } from './minimalFeatures';
import { packMinimalFeatures, type CityPreviewRequest, type CityPreviewResponse } from './cityPreviewMap';
import { packWorldPartitions } from './urbanPack';
import { packWorldLanduse } from './landusePack';
import { wasmThreadsInfo } from '../../../rust/bridge/wasmThreads';
import type { V2Settings, ProgressCallback } from './contracts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
// The iframe has no map labels. Skip the name pass that the studio applies after its generation.
namesRenamedAfterActions();
scope.onmessage = async ({ data: { hints, local, mode } }: MessageEvent<CityPreviewRequest>) => {
  const send = (message: CityPreviewResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
  try {
    let settings = cityEmbedSettings(hints, local, mode);
    const detailed = mode !== 'compact';
    const progress: ProgressCallback = value => send({ type: 'progress', progress: value });
    const stage = <T>(run: (effective: V2Settings) => Promise<T>) =>
      retryNativeStage(
        settings,
        run,
        effective => {
          settings = effective;
        },
        'all',
      );
    const terrain = await stage(effective => generateTerrain(effective, progress, undefined, undefined, undefined, { prepareDisplay: false, includeLandCover: detailed }));
    const region = await stage(effective => planRegion(terrain, effective, progress, true));
    const world = await stage(effective => generateTowns(region, effective, progress, undefined, effective.urban?.through, false, detailed));
    const cities = nativeCitiesOf(world),
      cityByKey = nativeCityRecords(world) ?? {};
    const buildings = cities.reduce((sum, city) => sum + (city.scene?.buildings.length ?? 0), 0);
    const layouts = cities.flatMap(city => city.layouts);
    if (!layouts.length) throw new Error('The city map could not be drawn.');
    const runtime = world.stats['v2.urbanBackend'] === 'rust-native-cpu' ? 'native' : 'wasm';
    const common = { type: 'city-preview', runtime, wasm: runtime === 'wasm' ? wasmThreadsInfo() : undefined, town: { buildings, layouts: layouts.length, streets: layouts.reduce((sum, layout) => sum + layout.streets.length, 0) } } as const;
    const bounds = cityEmbedBounds(world);
    if (detailed) {
      const cover = packWorldLanduse(world);
      const packed = packWorldPartitions(cover.world);
      send({ ...common, mode, world: packed.world, bounds, settings }, [...cover.transfer, ...packed.transfer]);
      return;
    }
    const recipe = settings.appearance!.composition!;
    const plan = townPlanOf(recipe);
    const geometry = packMinimalFeatures([...minimalFeatures({ ...world, landuse: undefined }, { cities, cityByKey }, plan.parcels)]);
    send({ ...common, mode: 'compact', map: { bounds, size: world.mapSize, recipe, plan, geometry } }, [geometry.rings.buffer, geometry.coords.buffer]);
  } catch (error) {
    send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
