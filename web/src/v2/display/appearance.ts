/**
 * The appearance passes: `set()` turns a world, its settings and a resolved appearance into the products of the
 * display (v2/display/*Products.ts), running only the passes whose key moved (v2/passes/pass.ts).
 *
 *   terrainData, terrainLook, forest : groundProducts.ts
 *   water, frame                     : waterProducts.ts
 *   cartography, overlays, semantic  : cartographyProducts.ts
 *   city                             : townProducts.ts
 *
 * Called by BenchRenderer.set for the page's map and for each export renderer. The view on screen is told when the
 * passes begin and end (it keeps the previous picture meanwhile) and which of them ran.
 */
import { retainTerrainDisplayPreparation } from '../displayPrep';
import { RenderReadiness } from '../../render/renderReadiness';
import { getLanguage } from '../i18n';
import { getDistanceUnit } from '../units';
import type { World } from '../../gen/types';
import type { V2Settings } from '../contracts';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import type { ExportLayers } from '../../render/exportLayers';
import { roadSoilOf, roadGroundTones, setRoadGround } from '../../render/roadStyle';
import { setMapClimateZone, setMapSeason } from '../../render/seasonPalette';
import { biomePalette } from '../../render/biomes';
import { terrainStyle } from '../../render/terrainStyle';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import { effectiveTerrainSettings } from '../terrainSettings';
import { terrainRendererBackend } from '../../ui/terrainRenderer';
import { renderScene } from '../renderScene';
import { passKeys } from '../passes/pass';
import { setDisplayAppearanceQuality } from '../../render/displayQuality';
import type { MapState } from './mapState';
import type { DisplayParts } from './parts';

/** What the passes changed, for the view on screen. */
export interface AppearanceListener {
  /** The passes are about to change the products: the picture on screen is kept as it is until they end. */
  beginAppearanceChange(): void;
  endAppearanceChange(): void;
  /** The passes that ran, and the appearance and terrain they replaced. */
  contentChanged(ran: readonly string[], before: { resolved?: ResolvedAppearance; native?: TerrainData }): void;
}

export class AppearancePasses {
  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
  ) {}

  async apply(world: World, settings: V2Settings, r: ResolvedAppearance, layers: Partial<ExportLayers>, request: RenderReadiness, view: AppearanceListener): Promise<void> {
    const map = this.map,
      { ground, water, cartography, town } = this.parts;
    // A live forest update in flight stays wanted: this set() skips the forest pass unless its key moved (forestPass).
    map.request = request;
    ground.programError = undefined;
    ground.programWork = undefined;
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
      const effective = effectiveTerrainSettings(settings, world.mapSize);
      setMapSeason(r.ground.season, effective.climateZone, r.ground.calendar);
      setMapClimateZone(effective.climateZone, effective.climateValues);
      setRoadGround(world.landuse, world.mapSize, roadGroundTones(r.ground.traits.family === 'material', biomePalette(r.palette.mapStyle, world.options.biome), roadSoilOf(effective.climateZone, world.options.biome)), r.composition.ambience === 'night');
      const effectiveKey = JSON.stringify([effective.relief, effective.refine, effective.detailNoise, effective.climate, effective.climateValues, effective.climateZone, effective.hydrology?.riverMode]);
      const forestKey = JSON.stringify([effective.forest, effective.climateValues]);
      const worldSig = JSON.stringify([world.mapSize, world.seed, world.options.biome, getLanguage(), getDistanceUnit(), settings.naming?.mode, settings.naming?.mapLanguage, settings.naming?.script]);
      map.input = () => ({ r, revisions: scene.revisions, layers, mode: ground.mode(), effective: effectiveKey, forestEffective: forestKey, worldSig });
      map.paper = terrainStyle(r.styleId, r.palette.colors).palette.paper;
      // What the ground shader itself lays under and around the map (setLook `background`): the live ground tiles' paper.
      map.groundPaper = terrainStyle(r.ground.style, r.palette.colors).palette.paper;
      // The vector water raster (the whole river network decoded as one SVG) depends on the water and frame passes only:
      // it starts before the first later pass, so its decode overlaps them instead of following the town and the
      // cartography, and is awaited below as before.
      let vectors: Promise<void> | undefined;
      const startVectors = (): void => {
        if (water.vectorsDirty) {
          vectors = water.refreshVectors();
          void vectors.catch(() => {});
        }
      };
      const after = (run: () => void | Promise<void>) => (): Promise<void> => {
        startVectors();
        return step(run);
      };
      const ran = await map.passes.run(() => passKeys(map.input()), {
        terrainData: () => step(() => ground.terrainDataPass()),
        terrainLook: () => step(() => ground.terrainLookPass()),
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
      ground.gpuActive = gpuWasActive && !!ground.gpu;
      map.passes.reset();
      water.vectorsDirty = false;
      ground.forestUpdate.cancel();
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
