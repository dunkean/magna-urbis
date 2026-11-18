/**
 * What stands on the terrain of the tilted map, as the page gives it to the volume layers of the compositor
 * (render/world/buildingsLayer.ts, treesLayer.ts): the town in volume and the inputs of the modelled trees.
 *
 * Owned by the composed view (composedView.ts), which makes the two layers with `buildings` and `trees` and calls
 * `refresh` when a tilted view comes to rest. The layers ask too, from the compositor's work slices, which run in the
 * top view as well: the volumes are prepared in the background as soon as a map is shown, so the first tilt finds
 * them. `refresh` never composes: it starts a composition that runs in idle slices of a few milliseconds (a few
 * buildings per step, city3dBuildingsSteps); the layers read what the last finished one left, the same objects while
 * the map does not change.
 *
 * The town is the display scene of the separate 3D view, from the same parts (render/city3d/display.ts) and the same
 * appearance (the 3D resolution of the settings), on the relief of the tilted map: buildings of the towns and of the
 * activity sites, bridges, walls, quays, boardwalks, lot boundaries, groves, underdark ornaments, farms and stand-in
 * houses. It differs from that view where the page has no equivalent yet: no water level under bridges, quays and
 * stilt houses (they stand on the ground), no exact meshes swapped in by the detail service, canals without their own
 * water surface (the map drape shows it).
 *
 * The trees are the near trees of the satellite looks (worldTreesAvailable), shown when the appearance's `trees3d` is
 * on, at its `treeDistance`: the "3D trees" switch and the distance of the map toolbar while the view is tilted
 * (v2/page/view3d.ts), the same settings the separate 3D view's toolbar wrote.
 */
import type { World } from '../../gen/types';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import { city3dBuildingsSteps, city3dFarmBuildings, city3dStructures, city3dWithExtras } from '../../render/city3d/display';
import type { City3dDisplayScene } from '../../render/city3d/scene';
import type { City3dHeight } from '../../render/city3d/types';
import { city3dLotEnclosures } from '../../render/city3d/yards';
import { cityRegionalStreets } from '../../render/cityContract';
import { city3dPlanOptions } from '../../render/cityDrawOptions';
import { city3dCanopy, cityCanopy } from '../../render/cityGrove';
import { placeholderPlacedBuildings } from '../../render/farmRoofs';
import { city3dUnderdarkOrnaments, underdarkOrnaments } from '../../render/underdarkOrnaments';
import type { UrbanBuildingAppearance } from '../../render/urbanBuildingStyle';
import type { WorldBuildingsOptions } from '../../render/world/buildingsLayer';
import type { TerrainHeights } from '../../render/world/heights';
import type { WorldTreesOptions } from '../../render/world/treesLayer';
import type { City3dGround } from '../../ui/city3d';
import { clampTreeDistance, TREE_DISTANCE_DEFAULT, type TreeInputs } from '../../ui/terrain3dTrees';
import { renderV2ZoneUniform } from '../../../../rust/bridge/terrainRenderV2Zones';
import { activityScene } from '../activitySites';
import { resolveSettingsAppearance } from '../appearance';
import type { V2Settings } from '../contracts';
import { v2DisplayForest, v2ForestOccupation } from '../displayForest';
import { rustSettlementRaster, townRoadStreets, type RustTownSnapshot } from '../rustUrban';
import { combineV2NativeScenes, sameV2NativeInputs, v2NativeCities, v2Resolved3d, v2Terrain3dGround, withV2ActivityScene } from '../urban3d';
import type { DisplayParts } from './contract';
import type { MapState } from './mapState';

type TreeSource = Omit<TreeInputs, 'height'>;
type Ground = ReturnType<typeof v2Terrain3dGround>;
/** The satellite looks model their near trees; the others paint or draw their forest. */
const treesInLook = (ground: Ground, resolved: ResolvedAppearance): ground is NonNullable<Ground> => !!ground && (ground.renderV2 ?? 0) > 0 && !ground.forestBrushes && !resolved.traits.fantasy;
/** Whether the look of the map has modelled trees: the page offers the "3D trees" switch only then. */
export function worldTreesAvailable(world: World | undefined, settings: V2Settings | undefined): boolean {
  if (!world || !settings) return false;
  const resolved = resolveSettingsAppearance(settings, world, 'view2d');
  return treesInLook(v2Terrain3dGround(world, settings, resolved.traits.ground3d ? (resolved.styleId as City3dGround) : 'map'), resolved);
}
/** Time a composition slice may take (ms), and how long an idle callback may wait before it runs anyway. */
const SLICE_MS = 4,
  IDLE_TIMEOUT_MS = 300;

export class WorldVolumes {
  /** What the buildings layer and the trees layer read: the products of the last `refresh`. */
  readonly buildings: WorldBuildingsOptions;
  readonly trees: WorldTreesOptions;

  private display?: City3dDisplayScene;
  private appearance: UrbanBuildingAppearance = { style: 'cartographic', diagnostic: 'none' };
  private treeSource?: TreeSource;
  private distance = TREE_DISTANCE_DEFAULT;
  private treesOn = false;
  private night = false;
  /** What the products were made for: the map (`content`: MapState.townContent, bumped by every set()), the relief. */
  private madeFor: { world?: World; content: number; resolved?: ResolvedAppearance; heights?: TerrainHeights } = { content: -1 };
  /** What the town was composed from, besides the world and the relief. */
  private townOf: { cities: readonly RustTownSnapshot[]; world?: World; heights?: TerrainHeights; key: string } = { cities: [], key: '' };
  /** Displayed water cover of the map the trees keep off, one function per world (the trees compare it by identity). */
  private waterOf?: { world: World; at: (x: number, y: number) => number };
  /** The composition in progress, and its idle callback. */
  private job?: Generator<void, void>;
  private idle?: number;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly map: MapState,
    private readonly parts: Pick<DisplayParts, 'town'>,
    private readonly relief: () => TerrainHeights | undefined,
  ) {
    this.buildings = {
      scene: () => {
        this.refresh();
        return this.display;
      },
      appearance: () => this.appearance,
      terrain: relief,
      invalidate: map.compose,
    };
    this.trees = {
      inputs: () => {
        this.refresh();
        return this.treeSource;
      },
      terrain: relief,
      distance: () => this.distance,
      shown: () => this.treesOn,
      night: () => this.night,
      invalidate: map.compose,
    };
  }

  /** The town and the trees of the map on display are made again, in the background, when the map, the appearance or
   * the relief changed. Cheap when nothing did: called by the layers in every work slice. */
  refresh(): void {
    const map = this.map,
      world = map.world,
      settings = map.settings,
      resolved = map.resolved,
      heights = this.relief(),
      made = this.madeFor;
    if (world === made.world && map.townContent === made.content && resolved === made.resolved && heights === made.heights) return;
    this.madeFor = { world, content: map.townContent, resolved, heights };
    if (!world || !settings || !resolved || !heights) {
      this.display = this.treeSource = undefined;
      this.townOf = { cities: [], key: '' };
      return;
    }
    // The appearance of the volumes is the separate 3D view's; the ground they stand on is the look on screen.
    const r = v2Resolved3d(settings, world),
      ground = v2Terrain3dGround(world, settings, resolved.traits.ground3d ? (resolved.styleId as City3dGround) : 'map');
    this.night = r.composition.ambience === 'night';
    this.job = this.compose(world, r, resolved, heights, ground);
    this.schedule();
  }

  /** Runs the composition in idle slices; a newer one replaces it. The layers are told when it is done. */
  private schedule(): void {
    if (this.idle !== undefined || this.timer !== undefined) return;
    const run = (): void => {
      this.idle = this.timer = undefined;
      const job = this.job;
      if (!job) return;
      const started = performance.now();
      while (performance.now() - started < SLICE_MS)
        if (job.next().done) {
          if (this.job === job) this.job = undefined;
          this.map.compose();
          return;
        }
      this.schedule();
    };
    if (typeof requestIdleCallback === 'function') this.idle = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else this.timer = setTimeout(run, 16);
  }

  private *compose(world: World, r: ResolvedAppearance, resolved: ResolvedAppearance, heights: TerrainHeights, ground: ReturnType<typeof v2Terrain3dGround>): Generator<void, void> {
    yield* this.composeTown(world, r, heights, ground);
    this.refreshTrees(world, r, resolved, ground);
  }

  private *composeTown(world: World, r: ResolvedAppearance, heights: TerrainHeights, ground: ReturnType<typeof v2Terrain3dGround>): Generator<void, void> {
    const plan = city3dPlanOptions(r),
      look = plan.appearance,
      flat = look?.style === 'silhouette',
      shown = !flat && r.composition.buildings.visible && r.composition.buildings.meshes !== 'none',
      yards = plan.layers?.lotEnclosures !== false;
    // Published with the scene it paints, so the buildings layer does not start again for the old one.
    const appearance: UrbanBuildingAppearance = {
      ambience: look?.ambience,
      lightsOn: look?.lightsOn,
      colors: look?.colors,
      style: look?.style ?? 'cartographic',
      diagnostic: look?.diagnostic === 'uses' ? 'none' : (look?.diagnostic ?? 'none'),
      roofSnow: ground?.renderV2 === 1 ? { season: ground.v2Season ?? 0.5, climateZone: ground.climateZone, climate: ground.climate, calendar: ground.v2Calendar } : undefined,
    };
    const cities = v2NativeCities(world),
      lots = shown && yards ? (this.parts.town.city?.scenes() ?? []).flatMap(scene => scene.lotEnclosures ?? []) : [],
      of = this.townOf,
      // The city key of the appearance (keys.city) without the trees' switch and distance: they change no building.
      town = { ...r.city, trees3d: undefined, treeDistance: undefined },
      key = JSON.stringify([shown, yards, lots.length, plan.waterColor, plan.palette, r.underdark, town, r.palette.colors, r.composition.ambience]);
    // The same town on the same relief keeps its scene object: the buildings layer starts again for a new one.
    if (world === of.world && heights === of.heights && key === of.key && sameV2NativeInputs(of.cities, cities, 'scene') && sameV2NativeInputs(of.cities, cities, 'layouts')) {
      this.appearance = appearance;
      return;
    }
    if (!shown) {
      this.townOf = { cities, world, heights, key };
      this.appearance = appearance;
      this.display = undefined;
      return;
    }
    // The scene holds real heights; the layer seats it on the relief as drawn.
    const unit = heights.exaggeration > 0 ? 1 / heights.exaggeration : 1,
      heightAt: City3dHeight = (x, y) => heights.heightAt(x, y) * unit;
    const layouts = cities.flatMap(city => city.layouts),
      source = withV2ActivityScene(combineV2NativeScenes(cities), activityScene(world)),
      display = yield* city3dBuildingsSteps(source, { heightAt });
    yield;
    const structures = city3dStructures(layouts, cityRegionalStreets(r, townRoadStreets(world)), { height: heightAt, quayHeight: heightAt }, plan.waterColor, false);
    yield;
    const enclosures = city3dLotEnclosures(lots, heightAt, plan.palette);
    yield;
    const groves = city3dCanopy(cityCanopy(layouts, source?.buildings), heightAt);
    yield;
    const ornaments = city3dUnderdarkOrnaments(underdarkOrnaments(layouts, source?.buildings), heightAt, display?.buildings);
    yield;
    const farms = city3dFarmBuildings(world.landuse?.farmsteads, placeholderPlacedBuildings(world), heightAt);
    // Published whole, once made: the buildings layer starts its blocks again for a new scene object.
    this.townOf = { cities, world, heights, key };
    this.appearance = appearance;
    this.display = city3dWithExtras(display, [...structures.bridges, ...structures.walls, ...structures.quays, ...structures.boardwalks, ...enclosures, ...groves, ...ornaments, ...farms]);
  }

  private refreshTrees(world: World, r: ResolvedAppearance, resolved: ResolvedAppearance, ground: ReturnType<typeof v2Terrain3dGround>): void {
    this.treesOn = r.city.trees3d;
    this.distance = clampTreeDistance(r.city.treeDistance);
    const field = treesInLook(ground, resolved) ? v2DisplayForest(world, this.map.settings!, resolved, this.forestReady) : undefined;
    if (!ground || !field || !(Number.isInteger(field.n) && field.n > 0 && Number.isFinite(field.width) && field.width > 0 && field.rgba instanceof Uint8Array && field.rgba.length === field.n ** 2 * 4)) {
      this.treeSource = undefined;
      return;
    }
    this.treeSource = {
      field,
      occupation: v2ForestOccupation(world),
      seed: ground.seed >>> 0,
      climate: ground.climate,
      renderV2: ground.renderV2 ?? 0,
      zone: renderV2ZoneUniform(ground.climateZone),
      season: ground.v2Season ?? 0.5,
      crownSnow: ground.v2Calendar?.crownSnow,
      climateZone: ground.climateZone,
      calendar: ground.v2Calendar,
      water: this.waterAt(world),
    };
  }
  /** The forest field of the look arrived: the trees are made at the next tilted frame at rest. */
  private forestReady = (): void => {
    this.madeFor.content = -1;
    this.map.compose();
  };
  /** Water of the planning raster (rivers, lakes, sea; cave rock is not water): 1 on a wet cell. */
  private waterAt(world: World): (x: number, y: number) => number {
    if (this.waterOf?.world === world) return this.waterOf.at;
    const raster = rustSettlementRaster(world),
      n = raster.n,
      cells = n / raster.width,
      at = (x: number, y: number): number => {
        const i = Math.max(0, Math.min(n - 1, Math.floor(y * cells))) * n + Math.max(0, Math.min(n - 1, Math.floor(x * cells)));
        return raster.water[i] && !raster.rock?.[i] ? 1 : 0;
      };
    this.waterOf = { world, at };
    return at;
  }
}
