import { clearCityGroundUnderCanopy } from './cityCanopy';
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
import { drawNightTown } from './cityNight';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { CityScene } from './cityCanvas';
import { roadInkOf } from './roadStyle';
import { hydrologyWaterColour } from '../../../rust/bridge/hydrologyRender';

const finite = (value: number | undefined, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Building appearance of a frame: V2 colours (night tables included), style and diagnostic of the city component. */
export function cityBuildingAppearance(appearance: ResolvedAppearance, over: { style?: UrbanBuildingAppearance['style']; nightInk?: boolean } = {}): UrbanBuildingAppearance {
  const ambience = appearance.composition.ambience, city = appearance.city;
  return { colors: buildingColors(appearance.palette.colors, ambience), ambience, style: over.style ?? city.buildingStyle, diagnostic: city.diagnostic,
    nightInk: over.nightInk ?? city.palette === 'parchment' };
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
  page: Pick<CityDrawOptions, 'buildings' | 'buildingsVisible' | 'renderer' | 'refusedParcels' | 'beforeBuildings' | 'selectedBuilding' | 'selectedParcel' | 'readableGardens' | 'onTexturesReady' | 'deferNightTown'>;
}

export function cityDrawOptions(i: CityDrawInput): CityDrawOptions {
  const a = i.appearance, c = a.composition, colors = a.palette.colors;
  return {
    colors: i.buildingAppearance.colors, roadEmphasis: c.networks.roads.emphasis, night: c.ambience === 'night',
    waterColor: hydrologyWaterColour(c.networks.water.look === 'ink' ? a.palette.mapStyle : 'render3d', colors),
    viewport: i.frame.viewport, mpp: i.frame.mpp, dpr: i.frame.dpr, lod: i.lod, view: i.view ?? i.city.view, palette: i.city.palette,
    layers: cityCanvasLayers(i.layers, i.glFrame), width: finite(i.city.width, .6, 0, 5),
    labels: i.labelsAllowed && a.cartography.labels, text: c.text, textPalette: terrainStyle(c.variant, colors).palette,
    appearance: i.buildingAppearance, textured: i.city.textured, roadLook: c.networks.roads.look, groundBlend: i.city.groundBlend === 'blended',
    deferNightTown: true, ...i.page,
    beforeBuildings: ctx => {
      if (c.vegetation.procedural) clearCityGroundUnderCanopy(ctx, i.frame.viewport, i.frame.mpp);
      i.page.beforeBuildings?.(ctx);
    },
  };
}

/** Crowns sit above roofs; town lighting sits above crowns in both 2D hosts. */
export function finishCityFrame(ctx: CanvasRenderingContext2D, scene: CityScene, buildings: readonly PlacedBuilding[] | undefined,
  o: { viewport: Box; mpp: number; view: CityView; palette: CityDrawOptions['palette']; visible: boolean; diagnostic: UrbanBuildingAppearance['diagnostic']; night: boolean; streets: boolean; compare?: boolean }): void {
  if (o.visible && o.view === 'buildings' && o.diagnostic === 'none' && !o.compare)
    drawCityCanopy(ctx, cityCanopy(scene.layouts, buildings), o);
  if (o.night && o.diagnostic === 'none') drawNightTown(ctx, scene, o.viewport, o.mpp, o.palette === 'parchment', o.streets);
}

/** Ground-plan options consumed by the shared 3D host, including ink roads at night. */
export function city3dPlanOptions(r: ResolvedAppearance, labelsAllowed = true) {
  const c = r.composition, city = r.city;
  return { colors: buildingColors(r.palette.colors, c.ambience), view: city.view, palette: city.palette, width: city.width, opacity: city.opacity,
    labels: labelsAllowed && r.cartography.labels,
    layers: { ...city.layers, ...(c.buildings.meshes === 'none' ? { lotEnclosureMeshes: false } : {}), streets: city.layers.streets && c.networks.roads.visible, waterways: c.networks.water.visible && city.layers.waterways !== false },
    roadLook: c.networks.roads.look, roadEmphasis: c.networks.roads.emphasis, streetPalette: city.palette === 'terrain' ? 'parchment' as const : city.palette,
    waterColor: hydrologyWaterColour(c.networks.water.look === 'ink' ? r.palette.mapStyle : 'render3d', r.palette.colors),
    roadInk: roadInkOf(terrainStyle(r.palette.mapStyle, r.palette.colors).palette, buildingColors(r.palette.colors, c.ambience)),
    groundBlend: c.networks.roads.look === 'natural', night: c.ambience === 'night',
    buildingsVisible: c.buildings.visible && c.buildings.meshes === 'none',
    appearance: { colors: r.palette.colors, style: city.buildingStyle, diagnostic: city.diagnostic, ambience: c.ambience } };
}
