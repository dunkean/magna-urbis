import { clearCityGroundUnderCanopy } from './cityCanopy';
import { groundRoadLook } from './composition';
/** Canvas 2D `drawCity` options shared by the V2 (nativeCityMap) and City Bench (paintCity).
 * One function maps the resolved appearance to the options (V2 values), so both pages paint the same
 * parchment/ink/night frame. What is truly page-specific stays a parameter, never a fork:
 * the bench's diagnostic palettes and crop (`city`, `view`, `layers`), its comparison style,
 * its under-building pass (`beforeBuildings`), the V2's native house renderer, export switches. */
import type { CityComponent, ResolvedAppearance } from './appearanceRecipe';
import type { Box, CityDrawOptions, CityLayers, CityLod, CityView } from './cityCanvas';
import { cityCanvasLayers } from './cityGlView';
import type { CityGlFrame } from './cityGl';
import { terrainStyle } from './terrainStyle';
import { buildingColors, type UrbanBuildingAppearance } from './urbanBuildingStyle';
import { cityCanopy, drawCityCanopy } from './cityGrove';
import { drawUnderdarkOrnaments, underdarkOrnaments } from './underdarkOrnaments';
import { drawNightTown } from './cityNight';
import { settlementLightsOn } from './underdarkLighting';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { CityScene } from './cityCanvas';
import { roadInkOf } from './roadStyle';
import { townWaterColour } from './townWater';

const finite = (value: number | undefined, fallback: number, min: number, max: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);

/** Volume ownership is independent of roof ink: every roof mode keeps the same GPU house path. */
export function volumeTownBuildings(a: ResolvedAppearance | undefined): boolean {
  if (!a || !a.composition?.buildings?.visible || a.composition.buildings.meshes === 'none' || a.city.diagnostic !== 'none') return false;
  // In the separate 3D camera, city.view selects the ground diagram underneath the standing houses.
  if (a.target !== 'view3d' && a.city.view !== 'buildings') return false;
  const ground = a.composition.recipe.ground.look;
  return ground !== 'cadastre' && ground !== 'topographic' && ground !== 'minimal' && ground !== 'white';
}

/** Survey plans retain their ink; V1 alone outlines the pans of a volume roof. */
export function smoothTownBuildings(a: ResolvedAppearance | undefined): boolean {
  return volumeTownBuildings(a) && a!.composition.buildings.roof !== 'v1';
}

/** Building appearance of a frame: V2 colours (night tables included), style and diagnostic of the city component. */
export function cityBuildingAppearance(appearance: ResolvedAppearance, over: { style?: UrbanBuildingAppearance['style']; nightInk?: boolean } = {}): UrbanBuildingAppearance {
  // Underdark: no night ink; the culture colours stay and the cave light darkens them (caveRoof; the cave lighting in 3D).
  const ambience = appearance.underdark ? 'night' : appearance.composition.ambience,
    city = appearance.city;
  return {
    colors: buildingColors(appearance.palette.colors, appearance.underdark ? undefined : ambience),
    ambience,
    cave: !!appearance.underdark,
    lightsOn: settlementLightsOn(appearance.composition.ambience, appearance.underdark),
    style: over.style ?? city.buildingStyle,
    smoothRoofs: smoothTownBuildings(appearance),
    roof: appearance.composition.buildings.roof,
    diagnostic: city.diagnostic,
    nightInk: over.nightInk ?? city.palette === 'parchment',
  };
}

export interface CityDrawInput {
  appearance: ResolvedAppearance;
  /** Display component: `appearance.city` on the V2, the bench look (diagnostic palette, layers) on the bench. */
  city: Pick<CityComponent, 'view' | 'palette' | 'width' | 'groundBlend' | 'textured'>;
  /** Overrides `city.view` (bench comparisons). */
  view?: CityView;
  frame: { viewport: Box; mpp: number; dpr: number };
  lod: CityLod;
  /** Layers requested for the frame (the page composes its visibility switches); the GL overlay split is applied here. */
  layers: CityLayers;
  glFrame?: CityGlFrame;
  /** Page switch for names and glyphs (V2 export layer); the appearance still has to enable them. */
  labelsAllowed: boolean;
  buildingAppearance: UrbanBuildingAppearance;
  page: Pick<CityDrawOptions, 'buildings' | 'farBuildings' | 'buildingsVisible' | 'renderer' | 'refusedParcels' | 'beforeBuildings' | 'waterAbove' | 'selectedBuilding' | 'selectedParcel' | 'readableGardens' | 'onTexturesReady' | 'deferNightTown'>;
}

export function cityDrawOptions(i: CityDrawInput): CityDrawOptions {
  const a = i.appearance,
    c = a.composition,
    colors = a.palette.colors;
  return {
    colors: i.buildingAppearance.colors,
    roadEmphasis: c.networks.roads.emphasis,
    night: a.underdark || c.ambience === 'night',
    waterColor: townWaterColour(a),
    viewport: i.frame.viewport,
    mpp: i.frame.mpp,
    dpr: i.frame.dpr,
    lod: i.lod,
    view: i.view ?? i.city.view,
    palette: i.city.palette,
    layers: cityCanvasLayers(i.layers, i.glFrame),
    width: finite(i.city.width, 0.6, 0, 5),
    labels: i.labelsAllowed && a.cartography.labels,
    text: c.text,
    textPalette: terrainStyle(c.variant, colors).palette,
    appearance: i.buildingAppearance,
    textured: i.city.textured,
    roadLook: c.networks.roads.look,
    groundBlend: i.city.groundBlend === 'blended',
    deferNightTown: true,
    farTown: !!a.traits?.satelliteVariant,
    ...i.page,
    beforeBuildings: ctx => {
      if (c.vegetation.procedural) clearCityGroundUnderCanopy(ctx, i.frame.viewport, i.frame.mpp);
      i.page.beforeBuildings?.(ctx);
    },
  };
}

/** Crowns sit above roofs; town lighting sits above crowns in both 2D hosts. */
export function finishCityFrame(
  ctx: CanvasRenderingContext2D,
  scene: CityScene,
  buildings: readonly PlacedBuilding[] | undefined,
  o: { viewport: Box; mpp: number; view: CityView; palette: CityDrawOptions['palette']; visible: boolean; diagnostic: UrbanBuildingAppearance['diagnostic']; night: boolean; streets: boolean; compare?: boolean },
): void {
  if (o.visible && o.view === 'buildings' && o.diagnostic === 'none' && !o.compare) drawCityCanopy(ctx, cityCanopy(scene.layouts, buildings), o);
  if (o.night && o.diagnostic === 'none') drawNightTown(ctx, scene, o.viewport, o.mpp, o.palette === 'parchment', o.streets);
  // Underdark ornaments (webs, forges, spikes, guard towers) above the lights: the embers glow with the town's lamps.
  if (o.visible && o.view === 'buildings' && o.diagnostic === 'none' && !o.compare) drawUnderdarkOrnaments(ctx, underdarkOrnaments(scene.layouts, buildings), { viewport: o.viewport, mpp: o.mpp, palette: o.palette, lit: o.night });
}

/** Ground-plan options consumed by the shared 3D host, including ink roads at night. */
export function city3dPlanOptions(r: ResolvedAppearance, labelsAllowed = true) {
  const c = r.composition,
    city = r.city;
  const building = cityBuildingAppearance(r);
  return {
    colors: building.colors,
    view: city.view,
    palette: city.palette,
    width: city.width,
    opacity: city.opacity,
    labels: labelsAllowed && r.cartography.labels,
    layers: { ...city.layers, ...(c.buildings.meshes === 'none' ? { lotEnclosureMeshes: false } : {}), streets: city.layers.streets && c.networks.roads.visible, waterways: c.networks.water.visible && city.layers.waterways !== false },
    roadLook: c.networks.roads.look,
    roadEmphasis: c.networks.roads.emphasis,
    streetPalette: city.palette === 'terrain' ? ('parchment' as const) : city.palette,
    waterColor: townWaterColour(r),
    roadInk: roadInkOf(terrainStyle(r.palette.mapStyle, r.palette.colors).palette, building.colors),
    groundBlend: groundRoadLook(c.networks.roads.look),
    night: r.underdark || c.ambience === 'night',
    buildingsVisible: c.buildings.visible && c.buildings.meshes === 'none',
    appearance: { ...building, colors: r.palette.colors },
  };
}
