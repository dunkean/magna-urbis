/// <reference lib="webworker" />
/** The compact plan transfers drawing vectors. Detailed transfers the retained products for both studio looks. */
import { generateTerrain, generateTowns, namesRenamedAfterActions, planRegion, updateLocalTown } from './engine';
import { cityEmbedBounds, cityEmbedSettings } from './cityEmbedGeneration';
import { nativeCityRecords, nativeCitiesOf } from './nativeProducts';
import { retryNativeStage } from './runtimeChoices';
import { townPlanOf } from '../render/composition';
import { minimalFeatures } from './minimalFeatures';
import { cityEmbedShowsStreet } from './cityEmbedStreets';
import { cityEmbedRegionalRoads, cityEmbedStartsWithBlocks, packMinimalFeatures, type CityPreviewRequest, type CityPreviewResponse } from './cityPreviewMap';
import { packWorldPartitions, unpackWorldPartitions } from './urbanPack';
import { packWorldLanduse, unpackWorldLanduse } from './landusePack';
import { wasmThreadsInfo } from '../../../rust/bridge/wasmThreads';
import { readCityLayout, readCityWorld, saveCityLayout } from './cityEmbedCache';
import type { V2Settings, ProgressCallback } from './contracts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
// The iframe has no map labels. Skip the name pass that the studio applies after its generation.
namesRenamedAfterActions();
scope.onmessage = async ({ data: { hints, local, mode, base, layoutKey, studio } }: MessageEvent<CityPreviewRequest>) => {
  const send = (message: CityPreviewResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
  try {
    let settings = cityEmbedSettings(hints, local, mode);
    const detailed = mode !== 'compact';
    const sendWorld = (world: NonNullable<CityPreviewRequest['base']>['world'], recipe: V2Settings = settings) => {
      const cover = packWorldLanduse(world);
      const packed = packWorldPartitions(cover.world);
      send({ type: 'studio-city', world: packed.world, settings: recipe }, [...cover.transfer, ...packed.transfer]);
    };
    if (studio && layoutKey) {
      if (detailed) {
        const cached = await readCityWorld(layoutKey, mode);
        if (cached) return sendWorld(unpackWorldPartitions(unpackWorldLanduse(cached.world)), cached.settings);
      } else {
        const cached = await readCityLayout(layoutKey);
        if (cached) return sendWorld(unpackWorldPartitions(unpackWorldLanduse(cached)));
      }
    }
    if (detailed && !base && layoutKey) {
      const world = await readCityLayout(layoutKey);
      if (world) base = { world, compact: true };
    }
    const progress: ProgressCallback = value => {
      if (base && (value.stage === 'town' || (value.stage === 'urban-layout' && value.completed === 1))) return;
      send({ type: 'progress', progress: value });
    };
    const stage = <T>(run: (effective: V2Settings) => Promise<T>) =>
      retryNativeStage(
        settings,
        run,
        effective => {
          settings = effective;
        },
        'all',
      );
    const retained = base && unpackWorldPartitions(unpackWorldLanduse(base.world));
    let region = retained ?? await stage(async effective => {
      const terrain = await generateTerrain(effective, progress, undefined, undefined, undefined, { prepareDisplay: false, includeLandCover: false });
      return planRegion(terrain, effective, progress, true);
    });
    if (studio && detailed && !retained) {
      const through = cityEmbedStartsWithBlocks(hints.population) ? 'layout' : 'buildings';
      region = await stage(effective => generateTowns(region, { ...effective, urban: { ...effective.urban, through, architecture: 'silhouette' } }, progress, undefined, through, false, false));
    }
    const fromDetailed = mode === 'houses' && (base?.compact === false || studio?.fromDetailed === true);
    if (studio && fromDetailed && base?.compact !== false) {
      region = await stage(effective => generateTowns(region, { ...effective, urban: { ...effective.urban, architecture: 'silhouette', through: 'buildings' } }, progress, undefined, 'buildings', false, true));
    }
    const world = fromDetailed
      ? await stage(effective => updateLocalTown(region, effective, 'main', progress))
      : await stage(effective => generateTowns(region, effective, progress, undefined, effective.urban?.through, false, detailed));
    if (studio) return sendWorld(world);
    const cities = nativeCitiesOf(world),
      cityByKey = nativeCityRecords(world) ?? {};
    if (retained) world.stats['fmg.keptLayout'] = Number(!!cityByKey.main && cityByKey.main.layouts === nativeCityRecords(retained)?.main?.layouts);
    const buildings = cities.reduce((sum, city) => sum + (city.scene?.buildings.length ?? 0), 0);
    const layouts = cities.flatMap(city => city.layouts);
    if (!layouts.length) throw new Error('The city map could not be drawn.');
    const runtime = world.stats['v2.urbanBackend'] === 'rust-native-cpu' ? 'native' : 'wasm';
    const common = { type: 'city-preview', runtime, wasm: runtime === 'wasm' ? wasmThreadsInfo() : undefined, town: { buildings, layouts: layouts.length, streets: layouts.reduce((sum, layout) => sum + layout.streets.length, 0) } } as const;
    const bounds = cityEmbedBounds(world);
    if (detailed) {
      const cover = packWorldLanduse(world);
      const packed = packWorldPartitions(cover.world);
      send({ ...common, mode, world: packed.world, bounds, settings, fromDetailed }, [...cover.transfer, ...packed.transfer]);
      return;
    }
    const recipe = settings.appearance!.composition!;
    const plan = townPlanOf(recipe);
    const geometry = packMinimalFeatures([...minimalFeatures({ ...world, landuse: undefined }, { cities, cityByKey }, plan.parcels, cityEmbedShowsStreet)]);
    send({ ...common, mode: 'compact', map: { bounds, size: world.mapSize, recipe, plan, geometry, regionalRoads: cityEmbedRegionalRoads(world) } }, [geometry.rings.buffer, geometry.coords.buffer]);
    // The first paint only waits for drawing vectors. Persist the resumable layout from this worker.
    const packed = packWorldPartitions(world);
    if (layoutKey && await saveCityLayout(layoutKey, packed.world)) send({ type: 'layout-ready' });
    else send({ type: 'layout-ready', world: packed.world }, packed.transfer);
  } catch (error) {
    send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
