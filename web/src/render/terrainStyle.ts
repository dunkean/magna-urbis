import { PALETTES, STYLE_LIST, isMapStyle, type MapStyle, type Palette } from './styles';
import { waterRamp, type WaterStyle } from './waterStyle';
import { applyRenderColors, type RenderColors } from './customColors';

export type TerrainStyle = MapStyle | 'render' | 'render3d' | 'render3d-brush' | 'fantasy-ink' | 'fantasy-color' | 'render-v2' | 'render-v2-substrate' | 'render-v2-moisture' | 'render-v2-vegetation' | 'render-v2-snow' | 'copernicus';
export const isRender3dStyle = (style: TerrainStyle): boolean => style === 'render3d' || style === 'render3d-brush' || style.startsWith('render-v2');
export interface TerrainStyleDefinition {
  id: TerrainStyle; label: string; palette: Palette; water: WaterStyle;
  kind: 'palette' | 'material' | 'brush' | 'diagnostic';
}
const definition = (id: TerrainStyle, label: string, palette: Palette, kind: TerrainStyleDefinition['kind'] = 'palette', water = palette.water): TerrainStyleDefinition => ({ id, label, palette, kind, water });
const ink = { ...PALETTES.parchment, paper: '#faf9f4', seaFill: '#e5e7e6', waterEdge: '#666968' };
const color = { ...PALETTES.parchment, paper: '#eee6ce', seaFill: '#b9ccd0', waterEdge: '#648f99' };
const definitions = new Map<TerrainStyle, TerrainStyleDefinition>([
  ...STYLE_LIST.map(({ id, label }) => [id, definition(id, label, PALETTES[id])] as const),
  ['render', definition('render', 'Render · Neural Earth', PALETTES.parchment, 'material', { stops: [[0, '#1a4d5c'], [.4, '#0b2945'], [1, '#051126']], bandFraction: .016 })],
  ['render3d', definition('render3d', 'Render3D · Multiscale', PALETTES.parchment, 'material', { stops: [[0, '#1a4d5c'], [.4, '#0b2945'], [1, '#051126']], bandFraction: .016 })],
  ['render3d-brush', definition('render3d-brush', 'Render3DBrush', PALETTES.parchment, 'material', { stops: [[0, '#1a4d5c'], [.4, '#0b2945'], [1, '#051126']], bandFraction: .016 })],
  ...(['render-v2', 'render-v2-substrate', 'render-v2-moisture', 'render-v2-vegetation', 'render-v2-snow'] as const).map((id, i) => [id, definition(id, ['Render v2 - Satellite', 'Render v2 - Substrate', 'Render v2 - Moisture', 'Render v2 - Vegetation', 'Render v2 - Snow / ice'][i], PALETTES.parchment, 'material', { stops: [[0, '#1a4d5c'], [1, '#051126']], bandFraction: .016 })] as const),
  ['fantasy-ink', definition('fantasy-ink', 'Fantasy · Encre N&B', ink, 'brush', waterRamp(ink.waterEdge, ink.seaFill))],
  ['fantasy-color', definition('fantasy-color', 'Fantasy · Aquarelle', color, 'brush', waterRamp(color.waterEdge, color.seaFill))],
  // Legacy URL/render adapter. Elevation is exposed as a diagnostic in the UI.
  ['copernicus', definition('copernicus', 'Altitude · DEM', PALETTES.parchment, 'diagnostic', waterRamp('#237daf', '#082860'))],
]);

export const TERRAIN_STYLE_LIST = [...definitions.values()].filter(style => style.kind !== 'diagnostic');
export const terrainStyle = (id: TerrainStyle, colors?: RenderColors): TerrainStyleDefinition => {
  const base = definitions.get(id)!;
  if (!colors || !Object.keys(colors).length) return base;
  const palette = applyRenderColors({ ...base.palette, water: base.water }, colors);
  return { ...base, palette, water: palette.water };
};
export const isTerrainStyle = (id: string | null | undefined): id is TerrainStyle => !!id && (isMapStyle(id) || definitions.has(id as TerrainStyle));
export const waterShoreColor = (id: TerrainStyle): string => terrainStyle(id).water.stops[0][1];
