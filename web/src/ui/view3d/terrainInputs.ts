/**
 * Retained terrain, appearance, building, forest and whole-map texture inputs, called by the Terrain3d facade.
 * Reads/writes: Updates input fields, occupation-merge work and material resources on the supplied context; invalidates affected geometry and requests frames in the existing order.
 */
import { terrain3dRaisedTexture, type Terrain3dBillboards } from '../terrain3dBillboards';

import { type HeightLayer } from '../terrainGl';
import { type ForestField, type ForestOccupation } from '../../../../rust/bridge/terrainForest';
import { DEFAULT_TERRAIN_LIGHTING } from '../../render/terrainLighting';
import type { UrbanBuildingAppearance } from '../../render/urbanBuildingStyle';
import type { Building3dVisual, Building3dScene } from '../../render/urbanBuildingGeometry';
import { occupationMergeSlot, withBuildingOccupation } from '../forestOccupation';
import { UrbanBuildingGround } from '../urbanBuildingGround';
import { UrbanGroundCuts } from '../urbanGroundCuts';
import { Terrain3dForestSettings, WaterSurface, Terrain3dGroundSettings, Terrain3dLookSettings } from './terrainTypes';
import { clamp } from './terrainPolicy';
import type { Terrain3dContext } from './terrainContext';

export function setSurface(context: Terrain3dContext, layer: HeightLayer, water: WaterSurface | undefined, waterVisible: boolean): void {
  if (
    context.layer?.data === layer.data &&
    context.layer.n === layer.n &&
    context.layer.width === layer.width &&
    context.layer.x === layer.x &&
    context.layer.y === layer.y &&
    context.water?.mask === water?.mask &&
    context.water?.levels === water?.levels &&
    context.water?.n === water?.n &&
    context.waterVisible === waterVisible
  )
    return;
  context.layer = layer;
  context.water = water;
  context.waterVisible = waterVisible;
  context.billboardDirty = true;
  context.deleteTexture(context.macroTexture);
  context.macroTexture = context.uploadMacroField(layer);
  context.refreshCavern();
  let low = Infinity,
    high = -Infinity,
    slope = 0;
  const cell = layer.width / layer.n;
  for (let i = 0; i < layer.data.length; i++) {
    const value = layer.data[i];
    low = Math.min(low, value);
    high = Math.max(high, value);
    if ((i % layer.n) + 1 < layer.n) slope = Math.max(slope, Math.abs(layer.data[i + 1] - value) / cell);
    if (i + layer.n < layer.data.length) slope = Math.max(slope, Math.abs(layer.data[i + layer.n] - value) / cell);
  }
  context.maxSlope = slope * Math.SQRT2;
  context.heightRange = Math.max(0, high - low);
  context.clearPatches();
  context.limitCamera();
  context.request();
}

export function setHeightSampler(context: Terrain3dContext, sample: ((x: number, y: number, metresPerPixel: number) => number) | undefined): void {
  if (sample === context.heightSampler) return;
  context.heightSampler = sample;
  context.clearPatches();
  context.request();
  context.billboardDirty = true;
}

export function setGroundMaterial(context: Terrain3dContext, settings: Terrain3dGroundSettings | undefined): void {
  const previous = context.groundSettings;
  if (settings && (settings.ambience !== undefined || settings.waterLook !== undefined)) context.setLook(settings);
  // Compile before committing the switch: a failed optional material keeps
  // the current renderer and retained geometry usable.
  context.selectTerrainProgram(!!settings || !!context.forest);
  context.groundSettings = settings;
  context.refreshCavern();
  const framed = context.townFrame,
    sites = settings?.townSites ?? settings?.townGlow;
  if (framed && sites && sites.length >= 3) {
    const c = context.camera;
    if (Math.abs(c.x - framed.x) < 1 && Math.abs(c.y - framed.y) < 1 && Math.abs(c.distance - framed.distance) < 1) {
      const near = clamp(sites[2] * 1.6, 320, 700);
      context.camera = { ...c, x: sites[0], y: sites[1], distance: near, pitch: context.framingPitch(sites[0], sites[1], near) };
      context.limitCamera();
      context.request();
    }
    context.townFrame = undefined;
  }
  if (settings?.renderV2 && !previous?.renderV2 && !context.textureSource) {
    context.deleteTexture(context.material);
    context.material = context.uploadTexture(new Uint8Array([0, 0, 0, 0]));
  }
  if (
    !!previous?.displacement !== !!settings?.displacement ||
    (settings?.displacement && (previous?.seed !== settings.seed || previous?.sourceCell !== settings.sourceCell || previous?.climate.temperature !== settings.climate.temperature || previous?.climate.precipitation !== settings.climate.precipitation))
  )
    context.clearPatches();
  context.limitCamera();
  context.request();
}

export function setRenderV2Season(context: Terrain3dContext, season: number): void {
  if (context.groundSettings?.renderV2) {
    context.groundSettings = { ...context.groundSettings, v2Season: season };
    context.request();
  }
}

export function setLook(context: Terrain3dContext, look: Terrain3dLookSettings): void {
  if (context.lookSettings.paperMap === look.paperMap && context.lookSettings.ambience === look.ambience && context.lookSettings.waterLook === look.waterLook && context.lookSettings.waterVisible === look.waterVisible && context.lookSettings.groundCover === look.groundCover)
    return;
  context.lookSettings = { ...look };
  context.request();
}

export function setTileBoundaries(context: Terrain3dContext, visible: boolean): void {
  context.tileBounds = visible;
  context.request();
}

/** Ground cuts (town moats): built once per set of circuits; a new set reshapes the patches. */
export function setGroundCuts(context: Terrain3dContext, cuts: UrbanGroundCuts): void {
  if (cuts === context.groundCuts) return;
  context.groundCuts = cuts;
  context.clearPatches();
  context.request();
}

/** Presentation consumes the same immutable native scene as the map. */
export function setBuildings(context: Terrain3dContext, scene: Building3dScene | undefined, appearance: UrbanBuildingAppearance, visible: boolean): void {
  const changed = context.buildingScene !== scene || context.buildingsVisible !== visible;
  context.buildingScene = scene;
  context.buildingAppearance = appearance;
  context.buildingsVisible = visible;
  // Footprints painted on a map have no foundation to clear. Carving their
  // hidden meshes into the terrain creates false, grid-shaped terraces.
  if (changed) {
    context.buildingGround = new UrbanBuildingGround(visible ? scene : undefined);
    context.billboardDirty = true;
    context.clearPatches();
    context.setForest(context.forestField, context.forestOccupation);
  }
  context.buildings.setScene(visible ? scene : undefined, appearance);
  context.request();
}

/** Swap a few buildings of the current scene (native exteriors in or out):
 * only their sectors rebuild; relief, patches and forest stay untouched. */
export function replaceBuildings(context: Terrain3dContext, changes: readonly Building3dVisual[]): string[] {
  if (!context.buildingsVisible || !changes.length) return [];
  const missing = context.buildings.replaceBuildings(changes);
  context.request();
  return missing;
}

/** Render3D forest: texture uploads only, no mesh or material tile rebuild. */
export function setForest(context: Terrain3dContext, field: ForestField | undefined, occupation: ForestOccupation | undefined, settings: Terrain3dForestSettings | undefined): void {
  context.forestSettings = settings ?? { seed: 0, climate: { temperature: 18, precipitation: 1000 }, lighting: DEFAULT_TERRAIN_LIGHTING };
  context.forestField = field;
  context.forestOccupation = occupation;
  if (context.mergedOccupationSource !== occupation || context.mergedOccupationScene !== context.buildingScene) {
    const source = occupation,
      scene = context.buildingScene,
      merge = context.options.mergeOccupation;
    context.mergedOccupationSource = source;
    context.mergedOccupationScene = scene;
    const buildings = scene?.occupationBuildings ?? scene?.buildings;
    if (!merge || !source || !scene || !buildings?.length || occupationMergeSlot(source, scene).value) context.mergedOccupation = withBuildingOccupation(source, scene);
    else {
      // The merge of a whole town took ~0.5 s on the page at opening (an average machine: seconds): off-thread now.
      context.mergedOccupation = source;
      context.occupationMerges++;
      const current = (): boolean => !context.disposed && context.mergedOccupationSource === source && context.mergedOccupationScene === scene;
      void merge(source, scene)
        .catch(() => (current() ? withBuildingOccupation(source, scene) : undefined))
        .then(result => {
          if (current() && result) {
            context.mergedOccupation = result;
            context.setForest(context.forestField, context.forestOccupation);
          }
        })
        .finally(() => {
          context.occupationMerges--;
          context.request();
        });
    }
  }
  occupation = context.mergedOccupation;
  if (field !== context.forest?.field) {
    const hadForest = !!context.forest;
    context.releaseForest(context.forest);
    context.forest = field && context.uploadForest(field);
    if (hadForest !== !!field) context.selectTerrainProgram(!!context.groundSettings || !!field);
  }
  if (occupation !== context.occupation?.data) {
    if (context.occupation) context.deleteTexture(context.occupation.texture);
    context.occupation = occupation && { data: occupation, texture: context.uploadOccupation(occupation) };
  }
  if (occupation?.detail !== context.landDetail?.data) {
    if (context.landDetail) context.deleteTexture(context.landDetail.texture);
    context.landDetail = occupation?.detail && { data: occupation.detail, texture: context.uploadLandDetail(occupation.detail) };
  }
  context.request();
}

export function setTexture(context: Terrain3dContext, source: TexImageSource, billboards?: Terrain3dBillboards): void {
  context.textureSource = source;
  context.setBillboards(billboards?.stamps, billboards?.atlas);
  const dimensions = source as { width?: number; naturalWidth?: number; videoWidth?: number };
  context.fallbackPixels = dimensions.videoWidth || dimensions.naturalWidth || dimensions.width || 1;
  if (context.contextLost()) return;
  context.releaseMaterial(context.material);
  context.material = context.uploadTexture(source);
  const raised = terrain3dRaisedTexture(source);
  if (raised) context.raisedMaterials.set(context.material, context.uploadTexture(raised));
  context.request();
}
