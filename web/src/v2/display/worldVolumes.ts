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
 * The town is the display scene of City Bench's 3D view, from the same parts (render/city3d/display.ts) and the same
 * appearance (the 3D resolution of the settings), on the relief of the tilted map and the ground the towns shape on it
 * (render/world/groundShape.ts: hillside lots levelled, moats dug), made first and hung on the relief: buildings of the
 * towns and of the activity sites, bridges, walls, quays, boardwalks, lot boundaries, groves, underdark ornaments, farms and stand-in
 * houses. It differs from that view where the page has no equivalent yet: no water level under bridges, quays and
 * stilt houses (they stand on the ground), no exact meshes swapped in by the detail service, canals without their own
 * water surface (the map drape shows it).
 *
 * The trees are the near trees of the satellite looks (worldTreesAvailable), shown when the appearance's `trees3d` is
 * on, at its `treeDistance`: the "3D trees" switch and the distance of the map toolbar while the view is tilted
 * (v2/page/view3d.ts).
 */
import type { World } from '../../gen/types';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import { city3dBuildingsSteps, city3dFarmBuildings, city3dStructures, city3dWithExtras } from '../../render/city3d/display';
import type { City3dDisplayScene } from '../../render/city3d/scene';
import type { City3dHeight } from '../../render/city3d/types';
import { city3dLotEnclosures } from '../../render/city3d/yards';
import { city3dStairs } from '../../render/city3dStairs';
import { stairStreetColor, type StairPaintOptions } from '../../render/city/streetLook';
import { roadGroundKey } from '../../render/roadStyle';
import { cityRegionalStreets } from '../../render/cityContract';
import { RIM_DEVICE_MPP, roofFrame, roofPansShown, type VolumeTownLook } from '../../render/city/buildingLook';
import { cityBuildingAppearance, city3dPlanOptions } from '../../render/cityDrawOptions';
import { toneStamp } from '../../render/groundTone';
import { roofSeasonKey } from '../../render/seasonPalette';
import { city3dCanopy, cityCanopy } from '../../render/cityGrove';
import { placeholderPlacedBuildings } from '../../render/farmRoofs';
import { city3dUnderdarkOrnaments, underdarkOrnaments } from '../../render/underdarkOrnaments';
import type { UrbanBuildingAppearance } from '../../render/urbanBuildingStyle';
import type { WorldBuildingsOptions } from '../../render/world/buildingsLayer';
import type { TerrainHeights } from '../../render/world/heights';
import { groundShapeSteps, type GroundShape } from '../../render/world/groundShape';
import { Terrain3dCollisions } from '../../render/world/terrain3dCollisions';
import type { WorldTreesOptions } from '../../render/world/treesLayer';
import type { WorldCave } from '../../render/world/cave';
import { UNDERDARK_CAVERN_DEFAULTS, type CavernField } from '../../render/underdarkCavern';
import { riverCover } from '../../render/world/treesWater';
import { PAINTED_TREES, SATELLITE_TREES, type TreePalette } from '../../render/world/treesShader';
import { treeInputsKey } from '../../render/world/treesBlocks';
import type { City3dGround } from '../../ui/city3d';
import { UrbanGroundCuts } from '../../ui/urbanGroundCuts';
import { groundShapeLots, type GroundShapeLot } from '../../ui/urbanGroundShape';
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
import { countWork } from '../../render/workCount';
import type { NativeCityMap } from '../nativeCityMap';

type TreeSource = Omit<TreeInputs, 'height'>;
/** The section cut of an Underdark map (render/underdarkCavern.ts) and its heights before the cut, in metres. */
export interface CaveSection {
  field: CavernField;
  raw: TerrainHeights;
}
const NO_LAMPS = new Float32Array(0);
/** Radius (m) of the pool of light around an isolated farm of the Underdark. */
const FARM_LIGHT = 55;
/** Composed town scenes kept per look (WorldVolumes.townMeshes). */
const LOOK_SCENES = 3;
/** Water codes of the planning raster (gen/types.ts). */
const WATER_SEA = 1,
  WATER_LAKE = 2,
  WATER_RIVER = 3;
type Ground = ReturnType<typeof v2Terrain3dGround>;
/** Satellite looks share their forest, including the fast preset, whose simplification concerns the buildings. No tree
 * grows in the Underdark. */
const treesInLook = (ground: Ground, resolved: ResolvedAppearance): ground is NonNullable<Ground> => !!ground && !ground.underdark && (ground.renderV2 ?? 0) > 0 && !ground.forestBrushes && !resolved.traits.fantasy;
/** Whether the look of the map has modelled trees: the page offers the "3D trees" switch only then. */
export function worldTreesAvailable(world: World | undefined, settings: V2Settings | undefined): boolean {
  if (!world || !settings) return false;
  const resolved = resolveSettingsAppearance(settings, world, 'view2d');
  return treesInLook(v2Terrain3dGround(world, settings, resolved.traits.ground3d ? (resolved.styleId as City3dGround) : 'map'), resolved);
}
/** The lots of each town whose houses stand, to be levelled. */
function* levelledLots(cities: readonly RustTownSnapshot[]): Generator<readonly GroundShapeLot[]> {
  for (const city of cities)
    if (city.partitions?.length && city.scene?.buildings.length)
      yield groundShapeLots(
        city.partitions,
        city.scene.buildings.map(building => building.footprint),
      );
}
/** Time a composition slice may take (ms), and how long an idle callback may wait before it runs anyway. */
const SLICE_MS = 4,
  IDLE_TIMEOUT_MS = 300;

export class WorldVolumes {
  /** What the buildings layer and the trees layer read: the products of the last `refresh`. */
  readonly buildings: WorldBuildingsOptions;
  readonly trees: WorldTreesOptions;
  /** The Underdark of the map on display (render/world/cave.ts), for the ground, the town and the cave layer: the
   * same object while the map, the appearance and the relief do not change; undefined outside the Underdark and on
   * paper looks. */
  readonly cave = (): WorldCave | undefined => {
    this.refresh();
    return this.caveOf;
  };
  private caveOf?: WorldCave;

  private display?: City3dDisplayScene;
  /** Made once when a new town scene is published; appearance/tree-only refreshes retain it. */
  walkCollisions?: Terrain3dCollisions;
  private appearance: UrbanBuildingAppearance = { style: 'cartographic', diagnostic: 'none' };
  private treeSource?: TreeSource;
  private distance = TREE_DISTANCE_DEFAULT;
  private treesOn = false;
  private night = false;
  private yardMeshes = false;
  /** The trees' colours in the look on screen, as its painted crowns take theirs. */
  private palette: TreePalette = SATELLITE_TREES;
  /** What the products were made for: the map (`content`: MapState.townContent, bumped by every set()), the relief. */
  private madeFor: { world?: World; content: number; resolved?: ResolvedAppearance; heights?: TerrainHeights; city?: NativeCityMap } = { content: -1 };
  /** What the town was composed from, besides the world and the relief. */
  private townOf: { cities: readonly RustTownSnapshot[]; world?: World; heights?: TerrainHeights; city?: NativeCityMap; key: string } = { cities: [], key: '' };
  /** The towns' meshes (city3dBuildingsSteps), which no look changes, and the scenes composed from them per look (a few,
   * most recent last): a switch between looks of the same town publishes the scene it made before, whose blocks the
   * buildings layer keeps. Dropped with the town or the relief. */
  private townMeshes?: {
    cities: readonly RustTownSnapshot[];
    world: World;
    heights: TerrainHeights;
    terraces: boolean;
    levelled: boolean;
    city?: NativeCityMap;
    /** The ground shaped for the towns, which their meshes stand on. */
    shape: GroundShape | undefined;
    display: City3dDisplayScene | undefined;
    scenes: Map<string, { display?: City3dDisplayScene; collisions?: Terrain3dCollisions }>;
  };
  /** Displayed water cover of the map the trees keep off, one function per world (the trees compare it by identity). */
  private waterOf?: { world: World; rivers?: Float32Array; at: (x: number, y: number) => number };
  /** The top view's town look the volumes take, and what it was made for (the town map, the look on screen, the
   * ground tones and the season its colours read, the roof frame input). */
  private lookOf?: { stamp: string; key: string; city: unknown; resolved?: ResolvedAppearance; look?: VolumeTownLook };
  /** The composition in progress, and its idle callback. */
  private job?: Generator<void, void>;
  private idle?: number;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly map: MapState,
    private readonly parts: Pick<DisplayParts, 'town' | 'water'>,
    private readonly relief: () => TerrainHeights | undefined,
    topView: () => boolean = () => false,
    private readonly section: () => CaveSection | undefined = () => undefined,
  ) {
    this.buildings = {
      scene: () => {
        this.refresh();
        return this.display;
      },
      appearance: () => this.appearance,
      look: () => this.townLook(),
      terrain: relief,
      cave: this.cave,
      topView,
      // The fast looks draw the town as boxes.
      boxed: () => map.resolved?.quality === 'light',
      invalidate: map.compose,
    };
    this.trees = {
      inputs: () => {
        this.refresh();
        return this.treeSource;
      },
      terrain: relief,
      terrainSource: () => map.world?.terrain,
      // The town's footprints: no modelled tree stands on a building.
      buildings: () => this.display,
      distance: () => this.distance,
      shown: () => {
        this.refresh();
        return this.treesOn;
      },
      night: () => this.night,
      palette: () => this.palette,
      invalidate: map.compose,
    };
  }

  yardsShown(): boolean {
    this.refresh();
    return this.yardMeshes;
  }

  /** The town and the trees of the map on display are made again, in the background, when the map, the appearance or
   * the relief changed. Cheap when nothing did: called by the layers in every work slice. */
  refresh(): void {
    const map = this.map,
      world = map.world,
      settings = map.settings,
      resolved = map.resolved,
      heights = this.relief(),
      city = this.parts.town.city,
      made = this.madeFor;
    if (world === made.world && map.townContent === made.content && resolved === made.resolved && heights === made.heights && city === made.city) return;
    this.madeFor = { world, content: map.townContent, resolved, heights, city };
    if (world !== made.world || heights !== made.heights || (world && map.townContent !== made.content && !sameV2NativeInputs(this.townOf.cities, v2NativeCities(world), 'scene'))) {
      this.display = undefined;
      this.walkCollisions = undefined;
    }
    if (world?.terrain !== made.world?.terrain) this.treeSource = undefined;
    if (!world || !settings || !resolved || !heights) {
      this.display = this.treeSource = undefined;
      this.caveOf = undefined;
      this.walkCollisions = undefined;
      this.townOf = { cities: [], key: '' };
      this.yardMeshes = false;
      return;
    }
    // The appearance of the volumes is the 3D resolution of the settings; the ground they stand on is the look on screen.
    const r = v2Resolved3d(settings, world),
      ground = v2Terrain3dGround(world, settings, resolved.traits.ground3d ? (resolved.styleId as City3dGround) : 'map'),
      buildingsOnly = ['atlas', 'cadastre', 'topographic', 'white'].includes(r.composition.recipe.ground.look),
      shown = r.city.buildingStyle !== 'silhouette' && r.composition.buildings.visible && r.composition.buildings.meshes !== 'none';
    this.yardMeshes = !!city && shown && !buildingsOnly && r.city.layers.lotEnclosures !== false;
    this.treesOn = r.city.trees3d;
    this.night = r.composition.ambience === 'night';
    this.palette = ground?.paperMap ? PAINTED_TREES : SATELLITE_TREES;
    const section = ground?.underdark && !ground.paperMap ? this.section() : undefined;
    this.caveOf = section && {
      field: section.field,
      settings: ground!.cavern ?? UNDERDARK_CAVERN_DEFAULTS,
      lamps: ground!.townSites ?? ground!.townGlow ?? NO_LAMPS,
      sparks: Float32Array.from((world.landuse?.farmsteads ?? []).flatMap(farm => [farm.pos.x, farm.pos.y, FARM_LIGHT])),
      lightsOn: !!ground!.townGlow,
      farms: ground!.farmBeds,
      craftedBeds: ground!.craftedBeds,
      // Read when a mushroom stream starts, in a tilted view only: the ways and lots no wild mushroom grows on.
      get occupation() {
        return v2ForestOccupation(world);
      },
      seed: ground!.seed >>> 0,
      raw: (x, y) => section.raw.heightAt(x, y),
      water: this.waterAt(world),
    };
    this.job = this.compose(world, r, resolved, heights, ground, shown, buildingsOnly);
    this.schedule();
  }

  pending(): boolean {
    return !!this.job;
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

  /** The look of the town as the top view paints it (render/city/buildingLook.ts): its palette, colours and ambience,
   * no rims (the parapets stand in volume); undefined where that view draws no roof pans. Called in every work slice
   * of the buildings layer: the same object while nothing it reads changes. */
  private townLook(): VolumeTownLook | undefined {
    const city = this.parts.town.city,
      resolved = this.map.resolved,
      stamp = `${toneStamp()}|${roofSeasonKey()}`,
      of = this.lookOf;
    if (of && of.city === city && of.resolved === resolved && of.stamp === stamp) return of.look;
    let input: Parameters<typeof roofFrame>[0] | undefined;
    if (city && resolved) {
      const a = cityBuildingAppearance(resolved),
        view = resolved.city.view;
      if (a.style !== 'silhouette' && roofPansShown({ view, footprint: false, diagnostic: a.diagnostic ?? 'none' }))
        input = { palette: resolved.city.palette, mpp: 2 * RIM_DEVICE_MPP, dpr: 1, night: !!resolved.underdark || resolved.composition.ambience === 'night', cave: !!resolved.underdark, diagnostic: a.diagnostic ?? 'none', colors: a.colors, textured: resolved.city.textured };
    }
    // Another style with the same roof frame keeps the look object: the buildings layer keeps its meshes.
    const key = JSON.stringify(input ?? null);
    const look = of && of.city === city && of.stamp === stamp && of.key === key ? of.look : input && city ? { frame: roofFrame(input), item: (id: string) => city.building(id) } : undefined;
    this.lookOf = { stamp, key, city, resolved, look };
    return look;
  }

  private *compose(world: World, r: ResolvedAppearance, resolved: ResolvedAppearance, heights: TerrainHeights, ground: Ground | undefined, shown: boolean, buildingsOnly: boolean): Generator<void, void> {
    this.refreshTrees(world, r, resolved, ground);
    yield* this.composeTown(world, r, heights, ground, shown, buildingsOnly);
  }

  private *composeTown(world: World, r: ResolvedAppearance, heights: TerrainHeights, ground: Ground | undefined, shown: boolean, buildingsOnly: boolean): Generator<void, void> {
    const plan = city3dPlanOptions(r),
      look = plan.appearance,
      yards = this.yardMeshes;
    // Published with the scene it paints, so the buildings layer does not start again for the old one.
    const appearance: UrbanBuildingAppearance = {
      roof: look?.roof,
      ambience: look?.ambience,
      lightsOn: look?.lightsOn,
      colors: look?.colors,
      style: look?.style ?? 'cartographic',
      diagnostic: look?.diagnostic === 'uses' ? 'none' : (look?.diagnostic ?? 'none'),
      roofSnow: ground?.renderV2 === 1 ? { season: ground.v2Season ?? 0.5, climateZone: ground.climateZone, climate: ground.climate, calendar: ground.v2Calendar } : undefined,
    };
    const cities = v2NativeCities(world),
      city = this.parts.town.city,
      of = this.townOf,
      // Flights of steps take the colour their street has on the map under them (`stairStreetColor`).
      stairPaint: StairPaintOptions = { palette: plan.palette, roadLook: plan.roadLook, roadEmphasis: plan.roadEmphasis, streetPalette: plan.streetPalette, colors: plan.colors, groundBlend: plan.groundBlend, night: plan.night, appearance: look },
      // What the scene reads of the look (the extras below; the buildings' colours are the layer's appearance): another
      // style with the same inputs keeps the scene object, whose blocks the buildings and trees layers keep.
      key = JSON.stringify([shown, yards, buildingsOnly, r.underdark, r.city.terraces, r.city.groundShaping, r.composition.networks.roads.visible, plan.waterColor, plan.palette, stairPaint, roadGroundKey()]);
    // The same town on the same relief keeps its scene object: the buildings layer starts again for a new one.
    if (world === of.world && heights === of.heights && city === of.city && key === of.key && sameV2NativeInputs(of.cities, cities, 'scene') && sameV2NativeInputs(of.cities, cities, 'layouts')) {
      this.appearance = appearance;
      // A composition given up in between may have left the ground of another town.
      heights.shape = shown && this.townMeshes?.heights === heights ? this.townMeshes.shape : undefined;
      return;
    }
    if (!shown) {
      this.townOf = { cities, world, heights, city, key };
      this.appearance = appearance;
      this.display = undefined;
      this.walkCollisions = undefined;
      heights.shape = undefined;
      return;
    }
    let meshes = this.townMeshes;
    // The caves keep their own floors.
    const levelled = r.city.groundShaping && !r.underdark;
    const sameTown =
      !!meshes &&
      meshes.world === world &&
      meshes.heights === heights &&
      meshes.terraces === r.city.terraces &&
      meshes.levelled === levelled &&
      sameV2NativeInputs(meshes.cities, cities, 'scene') &&
      sameV2NativeInputs(meshes.cities, cities, 'layouts') &&
      (!levelled || sameV2NativeInputs(meshes.cities, cities, 'partitions'));
    if (sameTown) heights.shape = meshes!.shape;
    if (sameTown && meshes!.city !== city) {
      meshes!.city = city;
      meshes!.scenes.clear();
    }
    const kept = sameTown ? meshes!.scenes.get(key) : undefined;
    if (kept) {
      meshes!.scenes.delete(key);
      meshes!.scenes.set(key, kept);
      this.townOf = { cities, world, heights, city, key };
      this.appearance = appearance;
      this.display = kept.display;
      this.walkCollisions = kept.collisions;
      return;
    }
    // The scene holds real heights; the layer seats it on the relief as drawn.
    const unit = heights.exaggeration > 0 ? 1 / heights.exaggeration : 1,
      naturalAt = (x: number, y: number): number => heights.naturalAt(x, y) * unit,
      heightAt: City3dHeight = (x, y) => heights.groundAt(x, y) * unit;
    const layouts = cities.flatMap(city => city.layouts),
      source = withV2ActivityScene(combineV2NativeScenes(cities), activityScene(world));
    if (!sameTown) {
      countWork('volumes.compose');
      const shape = r.underdark ? undefined : yield* groundShapeSteps(heights.width, levelled ? levelledLots(cities) : [], new UrbanGroundCuts(layouts.flatMap(l => l.enclosures ?? [])), naturalAt);
      // Everything below stands on this ground, the terrain mesh included.
      heights.shape = shape;
      meshes = this.townMeshes = { cities, world, heights, terraces: r.city.terraces, levelled, city, shape, display: yield* city3dBuildingsSteps(source, { heightAt, terraces: r.city.terraces }), scenes: new Map() };
    }
    const display = meshes!.display;
    yield;
    const structures = buildingsOnly ? undefined : city3dStructures(layouts, cityRegionalStreets(r, townRoadStreets(world)), { height: heightAt, quayHeight: heightAt }, plan.waterColor, false);
    yield;
    // Stepped streets stand as flights of steps on the relief (city3dStairs.ts).
    const stairs = buildingsOnly ? [] : city3dStairs(layouts, heightAt, street => stairStreetColor(street, stairPaint));
    yield;
    const enclosures = yards && city ? city3dLotEnclosures(yield* city.lotEnclosureSteps(), heightAt, plan.palette) : [];
    yield;
    const groves = buildingsOnly ? [] : city3dCanopy(cityCanopy(layouts, source?.buildings), heightAt);
    yield;
    const ornaments = buildingsOnly ? [] : city3dUnderdarkOrnaments(underdarkOrnaments(layouts, source?.buildings), heightAt, display?.buildings);
    yield;
    const farms = city3dFarmBuildings(world.landuse?.farmsteads, placeholderPlacedBuildings(world), heightAt);
    // Published whole, once made: the buildings layer starts its blocks again for a new scene object.
    this.townOf = { cities, world, heights, city, key };
    this.appearance = appearance;
    this.display = city3dWithExtras(display, [...(structures ? [...structures.bridges, ...structures.walls, ...structures.quays, ...structures.boardwalks] : []), ...stairs, ...enclosures, ...groves, ...ornaments, ...farms]);
    this.walkCollisions = this.display ? new Terrain3dCollisions(this.display, heights, heights.exaggeration) : undefined;
    meshes!.scenes.set(key, { display: this.display, collisions: this.walkCollisions });
    if (meshes!.scenes.size > LOOK_SCENES) meshes!.scenes.delete(meshes!.scenes.keys().next().value!);
  }

  private refreshTrees(world: World, r: ResolvedAppearance, resolved: ResolvedAppearance, ground: ReturnType<typeof v2Terrain3dGround>): void {
    this.treesOn = r.city.trees3d;
    this.distance = clampTreeDistance(r.city.treeDistance);
    const field = treesInLook(ground, resolved) ? v2DisplayForest(world, this.map.settings!, resolved, this.forestReady) : undefined;
    if (!ground || !field || !(Number.isInteger(field.n) && field.n > 0 && Number.isFinite(field.width) && field.width > 0 && field.rgba instanceof Uint8Array && field.rgba.length === field.n ** 2 * 4)) {
      this.treeSource = undefined;
      return;
    }
    const next: TreeSource = {
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
    // Another style with the same trees keeps the inputs object: the trees layer keeps its blocks without checking them.
    const held = this.treeSource;
    if (!held || held.field !== next.field || held.occupation !== next.occupation || held.water !== next.water || treeInputsKey(held) !== treeInputsKey(next)) this.treeSource = next;
  }
  /** The forest field of the look arrived: the trees are made at the next tilted frame at rest. */
  private forestReady = (): void => {
    this.madeFor.content = -1;
    this.map.compose();
  };
  /** The water the trees keep off, as the painted crowns see it (render/world/treesWater.ts): sea and lakes from the
   * planning raster (cave rock is not water), rivers from the segments the ground draws; the raster's river cells only
   * when the ground draws no river segments. 1 on water. */
  private waterAt(world: World): (x: number, y: number) => number {
    const rivers = this.parts.water.cityWater;
    if (this.waterOf?.world === world && this.waterOf.rivers === rivers) return this.waterOf.at;
    const raster = rustSettlementRaster(world),
      n = raster.n,
      cells = n / raster.width,
      river = rivers && riverCover(rivers),
      at = (x: number, y: number): number => {
        const i = Math.max(0, Math.min(n - 1, Math.floor(y * cells))) * n + Math.max(0, Math.min(n - 1, Math.floor(x * cells))),
          code = raster.rock?.[i] ? 0 : raster.water[i];
        if (code === WATER_SEA || code === WATER_LAKE) return 1;
        return (river ? river(x, y) : code === WATER_RIVER) ? 1 : 0;
      };
    this.waterOf = { world, rivers, at };
    return at;
  }
}
