/**
 * The appearance passes: `set()` turns a world, its settings and a resolved appearance into the products of the
 * display (v2/display/*Products.ts), running only the passes whose key moved (v2/passes/pass.ts).
 *
 *   terrainData, terrainLook, forest : groundProducts.ts
 *   water, frame                     : waterProducts.ts
 *   cartography, overlays, semantic  : cartographyProducts.ts
 *   city                             : townProducts.ts
 *
 * Called by BenchRenderer.set for the page's map and for each export renderer. It is the one caller of the pass
 * methods, which is why it holds the product objects themselves and not their read-only contract. The view on screen
 * is told when the passes begin and end (it keeps the previous picture meanwhile) and which of them ran.
 */
import { retainTerrainDisplayPreparation } from '../displayPrep';
import { RenderReadiness } from '../../render/renderReadiness';
import { getLanguage } from '../i18n';
import { getDistanceUnit } from '../units';
import type { World } from '../../gen/types';
import type { V2Settings } from '../contracts';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import type { ExportLayers } from '../../render/exportLayers';
import { mapRoadTones, setRoadGround } from '../../render/roadStyle';
import { setMapClimateZone, setMapSeason, setMapSnowRelief, snowReliefOf } from '../../render/seasonPalette';
import { terrainStyle } from '../../render/terrainStyle';
import { displayBiomeName, displayTerrainSettings } from '../displayBiome';
import { effectiveTerrainSettings } from '../terrainSettings';
import { terrainRendererBackend } from '../../ui/terrainRenderer';
import { renderScene } from '../renderScene';
import { passKeys } from '../passes/pass';
import { moatEnvelopeKey } from '../../render/moatEnvelope';
import { nativeCitiesOf } from '../nativeProducts';
import { setDisplayAppearanceQuality } from '../../render/displayQuality';
import type { CartographyProducts } from './cartographyProducts';
import type { AppearanceListener } from './contract';
import type { GroundProducts } from './groundProducts';
import type { MapState } from './mapState';
import type { TownProducts } from './townProducts';
import type { WaterProducts } from './waterProducts';

export class AppearancePasses {
  constructor(
    private readonly map: MapState,
    private readonly products: { ground: GroundProducts; water: WaterProducts; cartography: CartographyProducts; town: TownProducts },
  ) {}

  async apply(world: World, settings: V2Settings, r: ResolvedAppearance, layers: Partial<ExportLayers>, request: RenderReadiness, view: AppearanceListener): Promise<void> {
    const map = this.map,
      { ground, water, cartography, town } = this.products;
    // A forest update in flight stays wanted: this set() skips the forest pass unless its key moved (forestPass).
    map.request = request;
    ground.beginAppearance();
    map.townContent++;
    // Worker-prepared terrain products (shore ring, distances, mips) before the passes that would build them on the page.
    retainTerrainDisplayPreparation(world);
    if (r.target !== 'export') setDisplayAppearanceQuality(r.quality);
    view.beginAppearanceChange();
    const previous = { world: map.world, scene: map.scene, settings: map.settings, resolved: map.resolved, exportLayers: map.exportLayers, native: map.native },
      gpuWasActive = ground.gpuActive;
    try {
      map.settings = settings;
      map.resolved = r;
      layers = { ...(r.cartography.roads ? {} : { roads: false }), ...layers };
      map.exportLayers = layers;
      const scene = renderScene(world, settings);
      map.world = world;
      map.scene = scene;
      map.native = scene.terrain;
      if (previous.native !== map.native) performance.mark('mu:terrain-data');
      const effective = displayTerrainSettings(settings, world.mapSize);
      setMapSeason(r.ground.season, effective.climateZone, r.ground.calendar);
      setMapClimateZone(effective.climateZone, effective.climateValues);
      // Streets, roads and squares take the snow of the land they cross (seasonPalette mapLandSnow).
      setMapSnowRelief(snowReliefOf(scene.terrain));
      setRoadGround(
        world.landuse,
        world.mapSize,
        // The ground of the roads keeps its summer tones: their own snow follows the date (roadStyle.ts roadTone).
        mapRoadTones(r, displayBiomeName(settings, world), effective.climateZone),
        r.composition.ambience === 'night',
        r.composition.networks.roads.look === 'rendered' ? world.terrain : undefined,
      );
      const effectiveKey = JSON.stringify([effective.relief, effective.refine, effective.detailNoise, effective.climate, effective.climateValues, effective.climateZone, effective.hydrology?.riverMode]);
      // The forest field grows from the generation climate (displayForest.ts): a display biome only repaints it.
      const forestKey = JSON.stringify([effective.forest, effectiveTerrainSettings(settings, world.mapSize).climateValues]);
      const worldSig = JSON.stringify([world.mapSize, world.seed, world.options.biome, getLanguage(), getDistanceUnit(), settings.naming?.mode, settings.naming?.mapLanguage, settings.naming?.script]);
      // The moats of the towns cut the streams they take in (waterProducts.ts): the water pass follows their runs only.
      const moats = nativeCitiesOf(world).map(city => moatEnvelopeKey(city.layouts)).join('|');
      map.input = () => ({ r, revisions: scene.revisions, layers, mode: ground.mode(), effective: effectiveKey, climateZone: effective.climateZone, forestEffective: forestKey, worldSig, moats });
      map.paper = terrainStyle(r.styleId, r.palette.colors).palette.paper;
      // What the ground shader itself lays under and around the map (setLook `background`): the live ground tiles' paper.
      map.groundPaper = terrainStyle(r.ground.style, r.palette.colors).palette.paper;
      // The vector water raster (the whole river network decoded as one SVG) depends on the water and frame passes only:
      // it starts before the first later pass, so its decode overlaps them instead of following the town and the
      // cartography, and is awaited below.
      let vectors: Promise<void> | undefined;
      const startVectors = (): void => {
        const refresh = water.refreshStaleVectors();
        if (refresh) {
          vectors = refresh;
          void refresh.catch(() => {});
        }
      };
      const after = (run: () => void | Promise<void>) => (): Promise<void> => {
        startVectors();
        return step(run);
      };
      const ran = await map.passes.run(() => passKeys(map.input()), {
        terrainData: () => step(() => ground.terrainDataPass()),
        terrainLook: () =>
          step(async () => {
            await ground.terrainLookPass();
            water.invalidateVectors();
          }),
        forest: () => step(() => ground.forestPass()),
        water: () => step(() => water.waterPass()),
        frame: () => step(() => water.framePass()),
        cartography: after(() => cartography.cartographyPass()),
        overlays: after(() => cartography.overlaysPass()),
        semantic: after(() => cartography.semanticPass()),
        city: after(() => town.cityPass()),
      });
      request.mark('fields-ready');
      const programs = ground.preparePrograms();
      // The view on screen shows the ground it has while the programs compile. Exact consumers explicitly await them.
      if (r.target !== 'view2d') await programs;
      startVectors();
      await vectors;
      map.stats.passes = ran;
      view.contentChanged(ran, previous);
    } catch (error) {
      // Restore the previous renderer state; every pass re-runs next time (a partial update must not look current).
      Object.assign(map, previous);
      map.passes.reset();
      ground.rollback(gpuWasActive);
      water.rollback();
      throw error;
    } finally {
      view.endAppearanceChange();
    }
    map.stats.style = r.ground.style;
    map.stats.renderer = ground.gpuActive ? 'TerrainGl + CityBench' : 'RustBench raster + CityBench';
    map.stats.terrainBackend = ground.gpuActive ? terrainRendererBackend(ground.gpu!) : 'cpu';
  }
}

/** One pass, after a turn of the event loop: promise continuations alone do not let input handlers or the progress card paint. */
async function step(run: () => void | Promise<void>): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await run();
}
