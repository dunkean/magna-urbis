/// <reference lib="webworker" />
/** One complete procedural V2 generation, publishing only the vectors the iframe can draw. */
import { generateTerrain, generateTowns, namesRenamedAfterActions, planRegion } from './engine';
import { cityEmbedBounds, cityEmbedSettings } from './cityEmbedGeneration';
import { nativeCityRecords, nativeCitiesOf, nativeTerrainOf } from './nativeProducts';
import { retryNativeStage } from './runtimeChoices';
import { townPlanOf } from '../render/composition';
import { minimalFeatures } from './minimalFeatures';
import { packMinimalFeatures, type CityPreviewRequest, type CityPreviewResponse } from './cityPreviewMap';
import { wasmThreadsInfo } from '../../../rust/bridge/wasmThreads';
import type { V2Settings, ProgressCallback } from './contracts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
// The iframe has no map labels. Skip the name pass that the studio applies after its generation.
namesRenamedAfterActions();
scope.onmessage = async ({ data: { hints, local, mode } }: MessageEvent<CityPreviewRequest>) => {
  const send = (message: CityPreviewResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
  try {
    let settings = cityEmbedSettings(hints, local);
    const detailed = mode === 'detailed';
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
    const world = await stage(effective => generateTowns(region, effective, progress, undefined, undefined, false, detailed));
    const cities = nativeCitiesOf(world),
      cityByKey = nativeCityRecords(world) ?? {};
    const buildings = cities.reduce((sum, city) => sum + (city.scene?.buildings.length ?? 0), 0);
    const layouts = cities.flatMap(city => city.layouts);
    if (!layouts.length) throw new Error('The city map could not be drawn.');
    const recipe = settings.appearance!.composition!;
    if (detailed) {
      recipe.landuse.rural = 'subtle';
      recipe.buildings.parcels = recipe.buildings.districts = true;
      recipe.effects.relief = true;
    }
    const plan = townPlanOf(recipe);
    // Natural terrain cover may already exist before rural generation; the compact view draws neither.
    const shown = detailed ? world : { ...world, landuse: undefined };
    const geometry = packMinimalFeatures([...minimalFeatures(shown, { cities, cityByKey }, plan.parcels)]);
    const native = detailed ? nativeTerrainOf(world) : undefined;
    const height = native && { data: native.height, n: native.resolution, width: native.width, maxHeight: native.maxHeight };
    const transfer: Transferable[] = [geometry.rings.buffer, geometry.coords.buffer];
    if (height && height.data.buffer instanceof ArrayBuffer) transfer.push(height.data.buffer);
    const runtime = world.stats['v2.urbanBackend'] === 'rust-native-cpu' ? 'native' : 'wasm';
    send(
      {
        type: 'city-preview',
        mode,
        runtime,
        wasm: runtime === 'wasm' ? wasmThreadsInfo() : undefined,
        town: { buildings, layouts: layouts.length, streets: layouts.reduce((sum, layout) => sum + layout.streets.length, 0) },
        map: { bounds: cityEmbedBounds(world), size: world.mapSize, recipe, plan, geometry, height },
      },
      transfer,
    );
  } catch (error) {
    send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
