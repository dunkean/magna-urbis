/**
 * Sequential City 3D assembly, called through mountCity3d.
 * Terrain3d owns relief, tiles, navigation and the native building pass; this adapter supplies city inputs and exact 2D drapes.
 * Reads/writes: Creates the per-mount context, stable delegates and caches; invokes DOM, selection, controls and API assembly in their original order.
 */
import { SeatedMeshes } from '../../render/city3d/seatedMeshes';
import { DrapeTiles } from '../../render/drapeTiles';
import { TileWaterMask } from '../tileWaterMask';
import { WaterCellPainter } from '../waterCells';
import { mountTextOverlay3d } from '../textOverlay3d';
import { mountLegendOverlay3d } from '../legendOverlay3d';
import { type Building3dVisual } from '../../render/urbanBuildingGeometry';
import { buildCityBuildings, buildCityScene } from '../../render/cityCanvas';
import { CITY_DISPLAY_DEFAULTS } from '../../render/cityContract';
import type { PlacementBatch, PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import { City3dOptions, City3d } from './cityTypes';

import type { City3dContext } from './cityContext';
import { mountCityDom } from './cityDom';
import { connectCitySelection } from './citySelection';
import { connectCityControls } from './cityControls';
import { createCityApi } from './cityApi';
import * as cityWater from './cityWater';
import * as cityGround from './cityGround';
import * as cityDetails from './cityDetails';
import * as cityText from './cityText';
import * as cityTerrain from './cityTerrain';
import * as cityDrape from './cityDrape';
import * as cityBuildings from './cityBuildings';
import * as citySelection from './citySelection';
import * as cityControls from './cityControls';
import * as citySync from './citySync';
import * as cityCapture from './cityCapture';
export function mountCity3d(options: City3dOptions): City3d {
  const cityContext = {} as City3dContext;
  cityContext.options = options;
  cityContext.fillCanals = (...args) => cityWater.fillCanals(cityContext, ...args);
  cityContext.fillRetainedWater = (...args) => cityWater.fillRetainedWater(cityContext, ...args);
  cityContext.groundForest = (...args) => cityGround.groundForest(cityContext, ...args);
  cityContext.driveDetails = (...args) => cityDetails.driveDetails(cityContext, ...args);
  cityContext.applyServiceDetails = (...args) => cityDetails.applyServiceDetails(cityContext, ...args);
  cityContext.syncText = (...args) => cityText.syncText(cityContext, ...args);
  cityContext.ensureTerrain = (...args) => cityTerrain.ensureTerrain(cityContext, ...args);
  cityContext.backgroundUrl = (...args) => cityGround.backgroundUrl(cityContext, ...args);
  cityContext.hillshade = (...args) => cityGround.hillshade(cityContext, ...args);
  cityContext.water = (...args) => cityWater.water(cityContext, ...args);
  cityContext.waterPath = (...args) => cityWater.waterPath(cityContext, ...args);
  cityContext.loadImage = (...args) => cityGround.loadImage(cityContext, ...args);
  cityContext.setSurface = (...args) => cityGround.setSurface(cityContext, ...args);
  cityContext.seatSamplers = (...args) => cityGround.seatSamplers(cityContext, ...args);
  cityContext.syncImage = (...args) => cityGround.syncImage(cityContext, ...args);
  cityContext.applyGround = (...args) => cityGround.applyGround(cityContext, ...args);
  cityContext.materialCover = (...args) => cityWater.materialCover(cityContext, ...args);
  cityContext.noteWaterMaterial = (...args) => cityGround.noteWaterMaterial(cityContext, ...args);
  cityContext.groundResourceKey = (...args) => cityGround.groundResourceKey(cityContext, ...args);
  cityContext.currentWaterDisplay = (...args) => cityWater.currentWaterDisplay(cityContext, ...args);
  cityContext.waterTile = (...args) => cityWater.waterTile(cityContext, ...args);
  cityContext.semanticLayer = (...args) => cityDrape.semanticLayer(cityContext, ...args);
  cityContext.physicalLayer = (...args) => cityDrape.physicalLayer(cityContext, ...args);
  cityContext.clearSemanticWater = (...args) => cityWater.clearSemanticWater(cityContext, ...args);
  cityContext.loadTile = (...args) => cityDrape.loadTile(cityContext, ...args);
  cityContext.groundRegionalStreets = (...args) => cityDrape.groundRegionalStreets(cityContext, ...args);
  cityContext.cityPlan = (...args) => cityDrape.cityPlan(cityContext, ...args);
  cityContext.syncBuildings = (...args) => cityBuildings.syncBuildings(cityContext, ...args);
  cityContext.slotOf = (...args) => cityDetails.slotOf(cityContext, ...args);
  cityContext.queueSwap = (...args) => cityDetails.queueSwap(cityContext, ...args);
  cityContext.swapDetail = (...args) => cityDetails.swapDetail(cityContext, ...args);
  cityContext.restoreCompact = (...args) => cityDetails.restoreCompact(cityContext, ...args);
  cityContext.realize = (...args) => cityDetails.realize(cityContext, ...args);
  cityContext.detailAround = (...args) => cityDetails.detailAround(cityContext, ...args);
  cityContext.placeMarker = (...args) => citySelection.placeMarker(cityContext, ...args);
  cityContext.updateInfo = (...args) => citySelection.updateInfo(cityContext, ...args);
  cityContext.changedView = (...args) => cityControls.changedView(cityContext, ...args);
  cityContext.syncReliefControl = (...args) => cityControls.syncReliefControl(cityContext, ...args);
  cityContext.syncView = (...args) => cityControls.syncView(cityContext, ...args);
  cityContext.sync = (...args) => citySync.sync(cityContext, ...args);
  mountCityDom(cityContext);

  cityContext.terrain = undefined;
  cityContext.active = false;
  cityContext.disposed = false;
  cityContext.error = '';

  cityContext.tileRoadsOf = undefined;

  cityContext.ground = 'map';
  cityContext.colors = 'materials';
  cityContext.planOverlay = true;
  cityContext.refinement = 'noise';
  /** Modelled near trees: off by default, the view opens on the painted canopy and builds them on the first switch-on. */
  cityContext.nearTrees = false;
  cityContext.treeDistance = 600;
  cityContext.groundShaping = CITY_DISPLAY_DEFAULTS.groundShaping;
  cityContext.builtTerraces = CITY_DISPLAY_DEFAULTS.terraces;

  cityContext.groundKey = '';
  cityContext.planKey = '';
  cityContext.proceduralGround = false;
  cityContext.softwareMaterial = false;

  cityContext.waterDisplay = undefined;
  cityContext.retainedWater = undefined;
  /** Rivers come from the vector banks: the raster keeps only the sea and lakes (its river cells are 30 m blocks). */
  cityContext.vectorRivers = (): boolean => !!cityContext.retainedWater?.paths.length || !!cityContext.waterDisplay?.riverPaths;

  cityContext.materialCanals = (): boolean => cityContext.proceduralGround && cityContext.options.getLook?.()?.waterLook === 'natural';

  cityContext.openWater = undefined;
  cityContext.semanticKey = '';
  cityContext.semanticLanduse = undefined;
  cityContext.physicalKey = '';

  cityContext.occupationLanduse = undefined;
  cityContext.occupationGround = undefined;

  cityContext.backgroundKey = undefined;

  cityContext.surfaceDecor = undefined;
  cityContext.imageUrl = undefined;
  cityContext.heightAt = undefined;
  cityContext.stiltWaterAt = undefined;
  cityContext.image = undefined;
  cityContext.mapFallback = undefined;
  cityContext.waterMask = undefined;
  cityContext.waterPaths = undefined;
  cityContext.waterMaskVisible = '';

  cityContext.imageBillboards = undefined;

  cityContext.bridgeWaterAt = undefined;

  cityContext.quayHeightAt = undefined;
  cityContext.quayWaterAt = undefined;

  cityContext.textured = (): boolean => cityContext.options.getTextured?.() ?? false;

  cityContext.texturedSeen = false;

  cityContext.plan = undefined;
  cityContext.planOf = undefined;

  cityContext.sceneOf = undefined;
  cityContext.display = undefined;
  cityContext.displayMs = 0;
  cityContext.focused = false;
  cityContext.sourceEpoch = 0;

  cityContext.details = new Map<string, PlacedBuilding>();
  cityContext.detailBases = new Map<string, Building3dVisual>();
  cityContext.converting = new Set<string>();

  cityContext.groundCutsOf = undefined;
  cityContext.groundCutsOn = undefined;
  cityContext.groundShapeInputs = [];
  cityContext.seatGround = undefined;
  cityContext.groundShapeStats = { lots: 0, ms: 0 };

  cityContext.byId = new Map<string, Building3dVisual>();
  cityContext.bridgesOf = [undefined, undefined];
  cityContext.bridgeStats = { count: 0 };

  cityContext.quayCount = 0;
  cityContext.stairStats = { count: 0, triangles: 0, ms: 0 };
  cityContext.stairInputs = [];
  cityContext.stairBuildings = [];

  cityContext.wallStats = { count: 0, pieces: 0, triangles: 0, ms: 0 };

  cityContext.yardReuse = new SeatedMeshes();
  cityContext.wallReuse = new SeatedMeshes();
  cityContext.structureInputs = [];
  cityContext.structureBuildings = [];

  cityContext.canopyInputs = [];

  cityContext.ornamentInputs = [];
  cityContext.ornamentBuildings = [];

  cityContext.yardInputs = [];
  // Countryside farm buildings of the land use (farmRoofs.ts), raised like the town silhouettes; rebuilt only for a
  // new farmstead list or a new terrain.
  cityContext.farmInputs = [];
  cityContext.farmBuildings = undefined;

  cityContext.realized = new WeakSet<Building3dVisual>();

  cityContext.displayIndex = new Map<string, number>();
  cityContext.indexOf = undefined;

  cityContext.pendingSwaps = new Map<string, Building3dVisual>();
  // Strict identity of the source plan: an edit with the same recipe and pose
  // (e.g. new dimensions) must not keep the old exterior.
  cityContext.samePlan = (a: Building3dVisual | undefined, b: Building3dVisual): boolean => !!a && a === b;

  cityContext.detailTimer = undefined;
  cityContext.textureTicket = 0;

  cityContext.unsubscribeDetails = undefined;
  cityContext.detailFrame = 0;

  cityContext.textOverlay = mountTextOverlay3d(cityContext.root, () => cityContext.terrain);

  mountLegendOverlay3d(cityContext.root, cityContext.options, cityContext.textOverlay);
  // legend + cartouche: screen-space, wraps textOverlay.composite/dispose so captures include them
  cityContext.textInputs = undefined;

  /** Whole-map material of a material ground: shown at level 0 and under every patch until its own tile lands. The
   * cell raster (`mask`, also every tile's source) leaves the vector courses out, so the rivers appeared only tile by
   * tile, seconds after the relief. They are drawn here as `loadTile` draws a tile's cover (closed water paths, courses,
   * the regime's dry and frozen beds erased, retained banks), the courses with the two-texel minimum width `waterTile`
   * gives them, so a coarse stand-in shows them; the tiles that replace it keep their own drawing. */
  cityContext.coverOf = undefined;

  /** `mu:water-3d-shown`: the first rendered frame after a material holding this ground's water was installed. */
  cityContext.waterMaterialOf = undefined;
  cityContext.waterShownDue = false;

  cityContext.tileWaterMask = new TileWaterMask();
  cityContext.waterCells = new WaterCellPainter();

  cityContext.drawWaterCells = (target: CanvasRenderingContext2D, source: CanvasImageSource & { width: number }, sx: number, sy: number, sw: number, size: number): Promise<void> => cityContext.waterCells.draw(target, source, sx, sy, sw, size);

  cityContext.fallbackWater = undefined;

  cityContext.drapeTiles = new DrapeTiles();

  /** One material tile: the map image (or water) cropped, then the city plan when close. Semantics are painted
   * into a map tile (rural under the roads, urban over the plan); on a material ground they travel beside the
   * water-only tile, with full-resolution roads and plan over half-resolution rural semantics. */
  cityContext.footprintPlans = new WeakMap<PlacementBatch, ReturnType<typeof buildCityBuildings>>();

  cityContext.emptyFootprintPlan = buildCityScene([], []);

  cityContext.groundRoadSource = undefined;
  cityContext.groundRoadLayouts = undefined;
  cityContext.groundRoads = [];

  cityContext.center = (...args) => cityBuildings.center(cityContext, ...args);

  cityContext.timings = {};

  cityContext.modules = undefined;

  cityContext.detailModules = (): NonNullable<City3dContext['modules']> => (cityContext.modules ??= Promise.all([import('../../../../rust/bridge/architecture'), import('../../render/urbanBuildingDetails')]));

  connectCitySelection(cityContext);
  connectCityControls(cityContext);

  cityContext.programsReady = (): boolean => !!cityContext.terrain && (cityContext.terrain.getShaderProfile() === 'map' || cityContext.terrain.getStatus('groundVariant') === 'ready');

  cityContext.captureReady = (...args) => cityCapture.captureReady(cityContext, ...args);

  cityContext.api = createCityApi(cityContext);
  // The initial status reads display/scene state declared above; initialise it
  // after those bindings exist (also when mounted lazily from the V2 app).
  cityContext.localizeControls();

  return cityContext.api;
}
