import { PALETTES, STYLE_LIST, isMapStyle, type MapStyle, type Palette } from './styles';
import { waterRamp, type WaterStyle } from './waterStyle';
import { applyRenderColors, type RenderColors } from './customColors';
import { seasonalWaterPalette } from './seasonPalette';

export type TerrainStyle = MapStyle | 'parchment-render' | 'render' | 'render3d' | 'render3d-brush' | 'fantasy-ink' | 'fantasy-color' | 'render-v2' | 'render-v2-substrate' | 'render-v2-moisture' | 'render-v2-vegetation' | 'render-v2-snow' | 'copernicus';
/**
 * Declared rendering properties of a style. Single source of truth: call sites read these instead of testing style ids.
 * Read them once per look change, never per pixel / segment.
 */
export interface StyleTraits {
  /** UI grouping: cartographic palette, physical/neural terrain material, painted brush map, diagnostic scale. */
  family: 'map' | 'material' | 'brush' | 'diagnostic';
  /** Variant shown under a parent entry in the terrain bench style list (e.g. render-v2-* under render-v2). */
  variantOf?: TerrainStyle;
  /** Set on the parent entry of a variant group: its label in the grouped style list. */
  variantGroupLabel?: string;
  /** Shaded 3D ground (multiscale material) instead of a flat 2D map. */
  ground3d: boolean;
  /** Flat neural-earth material (2D 'render'): mode-2 ground and painted water. */
  neuralEarth: boolean;
  /** Satellite shader variant (0 = none). */
  satelliteVariant: number;
  /** Forest clearing profile used when painting forests over this ground. */
  forestClearingProfile?: 'progressive';
  /** Forest drawn with painted brushes. */
  forestBrushes: boolean;
  /** Water is drawn even when the water layer toggle is off. */
  waterAlwaysDrawn: boolean;
  /** River width follows the physical channel width. */
  physicalRiverWidth: boolean;
  /** The sea is part of the material: no separate sea svg and no land colour extension. */
  seaInMaterial: boolean;
  /** The user may customise shore / deep / river colours. */
  customWaterColors: boolean;
  /** Brush painting kind (fantasy maps), undefined otherwise. */
  fantasy?: 'ink' | 'color';
  /** The physical ground and forests of the satellite render, repainted as an ink and wash map. */
  paperMap?: boolean;
  /** Elevation diagnostic scale. */
  elevation: boolean;
  /** Contour lines (and their colour) are meaningful. */
  contours: boolean;
  /** Custom ground / forest / meadow colours apply. */
  customGroundColors: boolean;
  /** The cartographic overlay draws forest / meadow / marsh / commons landuse. */
  cartographicVegetation: boolean;
  /** City is painted (render background) by default. */
  paintedCityByDefault: boolean;
}
export interface TerrainStyleDefinition {
  id: TerrainStyle; label: string; palette: Palette; water: WaterStyle; traits: StyleTraits;
}
const MAP_TRAITS: StyleTraits = {
  family: 'map', ground3d: false, neuralEarth: false, satelliteVariant: 0, forestBrushes: false, waterAlwaysDrawn: false, physicalRiverWidth: false, seaInMaterial: false,
  customWaterColors: true, elevation: false, contours: true, customGroundColors: true, cartographicVegetation: true, paintedCityByDefault: false,
};
const MATERIAL_TRAITS: StyleTraits = { ...MAP_TRAITS, family: 'material', customGroundColors: false, cartographicVegetation: false, paintedCityByDefault: true };
const V2_TRAITS: StyleTraits = {
  ...MATERIAL_TRAITS, ground3d: true, forestClearingProfile: 'progressive', waterAlwaysDrawn: true, physicalRiverWidth: true, seaInMaterial: true, customWaterColors: false,
};
const BRUSH_TRAITS: StyleTraits = { ...MAP_TRAITS, family: 'brush', customGroundColors: false, contours: false, cartographicVegetation: false };
const DIAGNOSTIC_TRAITS: StyleTraits = { ...MAP_TRAITS, family: 'diagnostic', elevation: true, contours: false, customGroundColors: false, cartographicVegetation: false };
const definition = (id: TerrainStyle, label: string, palette: Palette, traits: StyleTraits = MAP_TRAITS, water = palette.water): TerrainStyleDefinition => ({ id, label, palette, traits, water });
const ink = { ...PALETTES.parchment, paper: '#faf9f4', seaFill: '#e5e7e6', waterEdge: '#666968' };
const color = { ...PALETTES.parchment, paper: '#eee6ce', seaFill: '#b9ccd0', waterEdge: '#648f99' };
const definitions = new Map<TerrainStyle, TerrainStyleDefinition>([
  ...STYLE_LIST.map(({ id, label }) => [id, definition(id, label, PALETTES[id])] as const),
  ['render', definition('render', 'Render · Neural Earth', PALETTES.parchment, { ...MATERIAL_TRAITS, neuralEarth: true }, { stops: [[0, '#1a4d5c'], [.4, '#0b2945'], [1, '#051126']], bandFraction: .016 })],
  ['render3d', definition('render3d', 'Render3D · Multiscale', PALETTES.parchment, { ...MATERIAL_TRAITS, ground3d: true }, { stops: [[0, '#1a4d5c'], [.4, '#0b2945'], [1, '#051126']], bandFraction: .016 })],
  ['render3d-brush', definition('render3d-brush', 'Render3DBrush', PALETTES.parchment, { ...MATERIAL_TRAITS, ground3d: true, forestBrushes: true }, { stops: [[0, '#1a4d5c'], [.4, '#0b2945'], [1, '#051126']], bandFraction: .016 })],
  ...(['render-v2', 'render-v2-substrate', 'render-v2-moisture', 'render-v2-vegetation', 'render-v2-snow'] as const).map((id, i) => [id, definition(id, ['Render v2 - Satellite', 'Render v2 - Substrate', 'Render v2 - Moisture', 'Render v2 - Vegetation', 'Render v2 - Snow / ice'][i], PALETTES.parchment, { ...V2_TRAITS, satelliteVariant: i + 1, variantOf: i ? 'render-v2' : undefined, variantGroupLabel: i ? undefined : 'Render v2' }, { stops: [[0, '#1a4d5c'], [1, '#051126']], bandFraction: .016 })] as const),
  ['parchment-render', definition('parchment-render', 'Satellite 2 · Painted', PALETTES.parchment, { ...V2_TRAITS, family: 'material', satelliteVariant: 1, paperMap: true, seaInMaterial: false, customWaterColors: true, physicalRiverWidth: false })],
  ['fantasy-ink', definition('fantasy-ink', 'Fantasy · Encre N&B', ink, { ...BRUSH_TRAITS, fantasy: 'ink' }, waterRamp(ink.waterEdge, ink.seaFill))],
  ['fantasy-color', definition('fantasy-color', 'Fantasy · Aquarelle', color, { ...BRUSH_TRAITS, fantasy: 'color' }, waterRamp(color.waterEdge, color.seaFill))],
  // Legacy URL/render adapter. Elevation is exposed as a diagnostic in the UI.
  ['copernicus', definition('copernicus', 'Altitude · DEM', PALETTES.parchment, DIAGNOSTIC_TRAITS, waterRamp('#237daf', '#082860'))],
]);

export const TERRAIN_STYLE_LIST = [...definitions.values()].filter(style => style.traits.family !== 'diagnostic');
const waterPalettes = new Map<TerrainStyle, Palette>();
export const terrainStyle = (id: TerrainStyle, colors?: RenderColors): TerrainStyleDefinition => {
  const base = definitions.get(id)!;
  let authored = waterPalettes.get(id);
  if (!authored) waterPalettes.set(id, authored = base.water === base.palette.water ? base.palette : { ...base.palette, water: base.water });
  const palette = seasonalWaterPalette(colors && Object.keys(colors).length ? applyRenderColors(authored, colors) : authored);
  if (palette === base.palette) return base;
  return { ...base, palette, water: palette.water };
};
export const isTerrainStyle = (id: string | null | undefined): id is TerrainStyle => !!id && (isMapStyle(id) || definitions.has(id as TerrainStyle));
export const waterShoreColor = (id: TerrainStyle): string => terrainStyle(id).water.stops[0][1];
/** Cheap trait lookup (no allocation). Unknown ids behave as plain cartographic palettes. */
export const styleTraits = (id: string): StyleTraits => definitions.get(id as TerrainStyle)?.traits ?? MAP_TRAITS;
