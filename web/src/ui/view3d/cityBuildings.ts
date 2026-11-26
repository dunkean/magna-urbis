/**
 * City building/structure/farm/canopy/ornament assembly, called by citySync and controls.
 * Reads/writes: Reads source scenes, layouts and ground samplers; writes display batches, derivation caches and structure statistics on the supplied context, then updates Terrain3d.
 */
import { updateYardEnclosures } from '../../render/cityLotEnclosures';
import { city3dLotEnclosures } from '../../render/city3dMeshes';
import { city3dBuildings, city3dFarmBuildings, city3dFarmSources, city3dPadSteps, city3dStructures, city3dWithExtras } from '../../render/city3d/display';
import { UrbanGroundCuts } from '../urbanGroundCuts';
import { UrbanGroundShape, blockOutlines, groundShapeLots } from '../urbanGroundShape';
import { RoadSqueeze } from '../../render/steepRoads';
import { city3dStairs } from '../../render/city3dStairs';
import { stairStreetColor, type StairPaintOptions } from '../../render/cityCanvas';
import { roadGroundKey } from '../../render/roadStyle';
import { city3dCanopy, cityCanopy } from '../../render/cityGrove';
import { city3dUnderdarkOrnaments, underdarkOrnaments } from '../../render/underdarkOrnaments';

import { type Building3dVisual } from '../../render/urbanBuildingGeometry';
import type { Point } from '../../../../rust/bridge/housesContract';
import type { PlacementBatch } from '../../../../rust/bridge/urbanArchitecture';
import type { City3dContext } from './cityContext';
/** The options of the ground pass that paints the town's streets in this 3D ground (satellite or plan ink, as tiles draw them). */
function stairPaintOptions(cityContext: City3dContext): StairPaintOptions {
  const plan = cityContext.options.getPlanOptions?.(),
    satellite = cityContext.proceduralGround && cityContext.options.getGroundSettings?.(cityContext.ground)?.renderV2 === 1;
  return satellite && plan?.roadLook !== 'ink'
    ? { palette: 'terrain', roadLook: 'natural', groundBlend: true, materialGround: true, roadEmphasis: plan?.roadEmphasis }
    : { palette: plan?.palette ?? 'terrain', roadLook: plan?.roadLook, roadEmphasis: plan?.roadEmphasis, streetPalette: plan?.streetPalette, colors: plan?.colors, groundBlend: plan?.groundBlend ?? false, night: plan?.night, appearance: plan?.appearance };
}
/** How far from a steep road the vertices of the terrain still hold the vector to it (m): the cells of a far tile. */
const SQUEEZE_PAD_M = 64;
// ------------------------------------------------------------ buildings
export function syncBuildings(cityContext: City3dContext, force = false): void {
  const t = cityContext.terrain;
  if (!t) return;
  // Lot fences, hedges and walls stand with the buildings (composition), not with the parcel diagram: off, they are neither drawn nor cleared from the forest.
  const planOptions = cityContext.options.getPlanOptions?.(),
    flat = planOptions?.appearance?.style === 'silhouette';
  const yardLayers = planOptions?.layers,
    yardsShown = !flat && yardLayers?.lotEnclosures !== false;
  const nextYards = [cityContext.options.getLotEnclosures?.(), cityContext.options.getPartitions?.(), yardsShown, flat];
  if (nextYards.some((input, i) => input !== cityContext.yardInputs[i])) {
    cityContext.yardInputs = nextYards;
    force = true;
    t.invalidateTiles();
  }
  const scene = cityContext.options.getProjection?.() ?? cityContext.options.getScene(),
    layouts = cityContext.options.getLayouts?.(),
    regional = cityContext.options.getRegionalStreets?.();
  const farmsteads = cityContext.options.getSemantic?.()?.landuse?.farmsteads;
  const placeholders = cityContext.options.getPlaceholderBuildings?.();
  // The floors are set on the natural ground and the 3D ground is shaped to them: buildings sunk into the slope, hillside
  // lots levelled (Advanced, urbanGroundShape.ts), once per lots, buildings, relief and choice. Everything below seats on
  // that ground: a new shaping gives it new samplers, which rebuild it. Projections of accepted plans keep their recorded
  // heights, and the caves their floors: nothing is shaped to them.
  const cut = !cityContext.options.getGroundSettings?.(cityContext.ground)?.underdark,
    shaped = !flat && cut && !(scene && 'projection' in scene),
    partitions = shaped ? cityContext.options.getPartitions?.() : undefined,
    nextShape = [
      partitions,
      shaped && scene,
      shaped && farmsteads,
      shaped && placeholders,
      shaped && cityContext.groundShaping,
      layouts,
      shaped && cityContext.surfaceDecor,
      shaped && cityContext.options.getSurface?.()?.height.data,
      t,
      !flat && regional,
      !flat && cityContext.options.getSurface?.()?.height.data,
    ];
  if (nextShape.some((input, i) => input !== cityContext.groundShapeInputs[i])) {
    cityContext.groundShapeInputs = nextShape;
    const started = performance.now(),
      ground = { at: (x: number, y: number): number => t.naturalGroundAt(x, y) ?? NaN, cut, blockAt: blockOutlines(layouts ?? []) };
    cityContext.seatGround = ground;
    const steps = city3dPadSteps(shaped ? [...((scene as PlacementBatch | undefined)?.buildings ?? []), ...city3dFarmSources(farmsteads, placeholders, ground.at)] : [], ground, cityContext.stiltWaterAt);
    let pads = steps.next();
    while (!pads.done) pads = steps.next();
    const shape = new UrbanGroundShape(groundShapeLots(partitions ?? [], pads.value, cityContext.groundShaping), ground.at, shaped && cityContext.groundShaping ? (layouts ?? []).flatMap(l => l.streets) : []);
    t.setGroundShape(shape.empty ? undefined : shape);
    // The regional roads keep their width where they cross steep slopes, as on the tilted map (v2/display/worldVolumes.ts):
    // the terrain reads its pictures squeezed across them. The vertices hold the field, far ones included.
    const steep = flat ? [] : (regional ?? []).filter(road => road.role === 'regional'),
      squeeze = steep.length ? new RoadSqueeze(steep, ground.at, undefined, SQUEEZE_PAD_M) : undefined;
    t.setRoadSqueeze(squeeze?.empty ? undefined : squeeze);
    cityContext.groundShapeStats = { lots: shape.size, ms: Math.round(performance.now() - started) };
    if (cityContext.surfaceDecor) cityContext.seatSamplers(cityContext.surfaceDecor);
    force = true;
  }
  const ground = cityContext.heightAt && cityContext.seatGround;
  if (farmsteads !== cityContext.farmInputs[0] || cityContext.heightAt !== cityContext.farmInputs[1] || placeholders !== cityContext.farmInputs[2]) {
    cityContext.farmInputs = [farmsteads, cityContext.heightAt, placeholders];
    cityContext.farmBuildings = undefined;
    force = true;
  }
  if (layouts !== cityContext.bridgesOf[0] || regional !== cityContext.bridgesOf[1]) {
    cityContext.bridgesOf = [layouts, regional];
    force = true;
  }
  // Moats dug into the 3D ground, once per set of circuits (a flat plan digs nothing).
  const cutsOf = flat ? undefined : layouts;
  if (cutsOf !== cityContext.groundCutsOf || t !== cityContext.groundCutsOn) {
    cityContext.groundCutsOf = cutsOf;
    cityContext.groundCutsOn = t;
    t.setGroundCuts(new UrbanGroundCuts((cutsOf ?? []).flatMap(l => l.enclosures ?? [])));
  }
  if (scene !== cityContext.sceneOf) {
    cityContext.byId = new Map(scene?.buildings.map(b => [b.id, b]));
    // Reconcile before city3dScene: a detail without its exact base plan goes.
    for (const id of [...cityContext.details.keys()]) {
      const base = cityContext.detailBases.get(id);
      if (!base || !cityContext.samePlan(cityContext.byId.get(id), base)) {
        cityContext.details.delete(id);
        cityContext.detailBases.delete(id);
      }
    }
    force = true;
    cityContext.sceneOf = scene;
    cityContext.sourceEpoch++;
  }
  const waterColor = planOptions?.waterColor,
    canalMaterial = cityContext.materialCanals();
  const nextStructureInputs = [layouts, regional, cityContext.heightAt, cityContext.bridgeWaterAt, waterColor, canalMaterial, cityContext.options.getHeightSampler?.(), cityContext.options.getSurface?.()?.height.data];
  if (!flat && nextStructureInputs.some((input, i) => input !== cityContext.structureInputs[i])) force = true;
  if (force && flat) {
    clearTimeout(cityContext.detailTimer);
    cityContext.pendingSwaps.clear();
    cityContext.display = undefined;
    cityContext.displayMs = 0;
    cityContext.bridgeStats = { count: 0 };
    cityContext.wallStats = { count: 0, pieces: 0, triangles: 0, ms: 0 };
    cityContext.quayCount = 0;
    cityContext.stairStats = { count: 0, triangles: 0, ms: 0 };
    cityContext.stairInputs = [];
    cityContext.stairBuildings = [];
    cityContext.structureInputs = [];
    cityContext.canopyInputs = [];
    cityContext.ornamentInputs = [];
  } else if (force) {
    // Swaps queued for the previous display must not be reinjected by id.
    clearTimeout(cityContext.detailTimer);
    cityContext.pendingSwaps.clear();
    const started = performance.now();
    cityContext.display = city3dBuildings(scene, { heightAt: cityContext.heightAt, ground, waterAt: cityContext.stiltWaterAt, details: cityContext.details, terraces: cityContext.builtTerraces });
    if (nextStructureInputs.some((input, i) => input !== cityContext.structureInputs[i])) {
      cityContext.structureInputs = nextStructureInputs;
      // Architecture edits/colours do not change bridges, walls or quays.
      // Retain these exact meshes until their actual terrain/network changes.
      // heightAt is the undug ground (Terrain3d.groundAt): moat water and gate bridges are not dug a second time.
      const wallStarted = performance.now(),
        { bridges, walls, quays, boardwalks } = city3dStructures(layouts ?? [], regional ?? [], { height: cityContext.heightAt, bridgeWater: cityContext.bridgeWaterAt, quayHeight: cityContext.quayHeightAt, quayWater: cityContext.quayWaterAt }, waterColor, !canalMaterial);
      cityContext.bridgeStats = { count: bridges.length, first: bridges[0] && cityContext.center(bridges[0]) };
      const enclosures = new Set(walls.map(w => w.id.split(':').slice(1, 3).join(':'))),
        gate = walls.find(w => w.id.includes(':gate:') && !w.variant_id.endsWith(':water'));
      cityContext.wallStats = {
        count: enclosures.size,
        pieces: walls.length,
        ms: Math.round(performance.now() - wallStarted),
        triangles: walls.reduce((n, w) => n + w.volumes.reduce((m, v) => m + v.roof_mesh.faces.reduce((k, f) => k + f.vertices.length - 2, 0), 0), 0),
        first: walls[0] && cityContext.center(walls[0]),
        gate: gate && cityContext.center(gate),
      };
      cityContext.quayCount = quays.length + boardwalks.length;
      cityContext.structureBuildings = [...bridges, ...walls, ...quays, ...boardwalks];
    }
    // Stepped streets as flights of steps on the displayed relief (city3dStairs.ts), coloured like their street in the
    // current 3D ground (`stairStreetColor`); rebuilt alone when the network, relief or that paint changes.
    const stairPaint = stairPaintOptions(cityContext),
      nextStairInputs = [layouts, cityContext.heightAt, JSON.stringify(stairPaint), roadGroundKey()];
    if (nextStairInputs.some((input, i) => input !== cityContext.stairInputs[i])) {
      cityContext.stairInputs = nextStairInputs;
      const stairStarted = performance.now();
      cityContext.stairBuildings = city3dStairs(layouts ?? [], cityContext.heightAt, street => stairStreetColor(street, stairPaint));
      cityContext.stairStats = {
        count: cityContext.stairBuildings.length,
        ms: Math.round(performance.now() - stairStarted),
        triangles: cityContext.stairBuildings.reduce((n, s) => n + s.volumes.reduce((m, v) => m + v.roof_mesh.faces.reduce((k, f) => k + f.vertices.length - 2, 0), 0), 0),
      };
    }
    const yardPlan = yardsShown ? cityContext.cityPlan() : undefined;
    const sharedYards = cityContext.options.getLotEnclosures?.();
    if (yardPlan && sharedYards) yardPlan.lotEnclosures = sharedYards as import('../../../../rust/bridge/urban').LotEnclosure[];
    else if (yardPlan && scene) updateYardEnclosures(yardPlan, scene.buildings, () => scene.buildings);
    const yardMeshes = yardPlan ? city3dLotEnclosures(yardPlan.lotEnclosures ?? [], cityContext.heightAt, cityContext.options.getPlanOptions?.()?.palette) : [];
    // Town grove, tree platforms and their walkways (cityCanopy.ts): the same derivation as the 2D plan.
    const canopySource = scene && !('projection' in scene) ? scene.buildings : undefined,
      nextCanopyInputs = [layouts, canopySource, cityContext.heightAt];
    if (nextCanopyInputs.some((input, i) => input !== cityContext.canopyInputs[i])) {
      cityContext.canopyInputs = nextCanopyInputs;
      cityContext.canopyBuildings = city3dCanopy(cityCanopy(layouts, canopySource), cityContext.heightAt);
    }
    // Underdark ornaments (underdarkOrnaments.ts): the same derivation as the 2D plan, on the shown buildings' heights.
    const nextOrnamentInputs = [layouts, scene, cityContext.heightAt, cityContext.display];
    if (nextOrnamentInputs.some((input, i) => input !== cityContext.ornamentInputs[i])) {
      cityContext.ornamentInputs = nextOrnamentInputs;
      cityContext.ornamentBuildings = city3dUnderdarkOrnaments(underdarkOrnaments(layouts, scene?.buildings), cityContext.heightAt, cityContext.display?.buildings);
    }
    // Farm buildings and the stand-in houses of places still waiting for their plan stand as meshes like every
    // other building: the massing-to-mesh code, materials, classes, tint and snow of the towns, each on the terrain
    // under its own footprint.
    cityContext.farmBuildings ??= city3dFarmBuildings(city3dFarmSources(farmsteads, placeholders, ground?.at ?? cityContext.heightAt), { heightAt: cityContext.heightAt, ground });
    cityContext.display = city3dWithExtras(cityContext.display, [...cityContext.structureBuildings, ...cityContext.stairBuildings, ...yardMeshes, ...cityContext.canopyBuildings, ...cityContext.ornamentBuildings, ...cityContext.farmBuildings]);
    cityContext.displayMs = performance.now() - started;
  }
  const appearance = cityContext.options.getBuildingAppearance?.(),
    diagnostic = cityContext.colors === 'uses' ? 'uses' : appearance?.diagnostic === 'uses' ? 'none' : (appearance?.diagnostic ?? 'none');
  const snowGround = cityContext.options.getGroundSettings?.(cityContext.ground);
  const roofSnow = snowGround?.renderV2 === 1 ? { season: snowGround.v2Season ?? 0.5, climateZone: snowGround.climateZone, climate: snowGround.climate, calendar: snowGround.v2Calendar } : undefined;
  // A cadastral drape includes the real footprints and ground boundary ink only.
  // Suppress the entire volume batch, including walls, quays and canopy platforms.
  t.setBuildings(
    cityContext.display,
    { ambience: appearance?.ambience, lightsOn: appearance?.lightsOn, colors: appearance?.colors, style: appearance?.style ?? 'cartographic', diagnostic, roof: appearance?.roof, roofSnow, textured: cityContext.textured() && diagnostic !== 'uses' && diagnostic !== 'height' },
    !flat && (cityContext.options.getBuildingsVisible?.() ?? true),
  );
  (cityContext.$('[data-detail]') as HTMLButtonElement).disabled = !cityContext.display?.kinds.compact || (!!scene && 'projection' in scene && (!cityContext.options.details || scene.projection === 'native-parent-window-3d-1'));
  if (!flat && cityContext.options.details) {
    cityContext.applyServiceDetails();
    cityContext.driveDetails();
  }
  cityContext.placeMarker();
  cityContext.updateInfo();
}

export function center(cityContext: City3dContext, b: Building3dVisual): Point {
  let x = 0,
    y = 0,
    n = 0;
  for (const s of b.footprint)
    for (const p of s.outer) {
      x += p.x;
      y += p.y;
      n++;
    }
  return n ? { x: x / n, y: y / n } : (b.entrance ?? { x: 0, y: 0 });
}
