import { PALETTES, STYLE_LIST, isMapStyle, type MapStyle, type Palette } from './styles';
import { waterRamp, type WaterStyle } from './waterStyle';

export type TerrainStyle = MapStyle | 'render' | 'render3d' | 'fantasy-ink' | 'fantasy-color' | 'copernicus';
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
  ['fantasy-ink', definition('fantasy-ink', 'Fantasy · Encre N&B', ink, 'brush', waterRamp(ink.waterEdge, ink.seaFill))],
  ['fantasy-color', definition('fantasy-color', 'Fantasy · Aquarelle', color, 'brush', waterRamp(color.waterEdge, color.seaFill))],
  // Legacy URL/render adapter. Elevation is exposed as a diagnostic in the UI.
  ['copernicus', definition('copernicus', 'Altitude · DEM', PALETTES.parchment, 'diagnostic', waterRamp('#237daf', '#082860'))],
]);

export const TERRAIN_STYLE_LIST = [...definitions.values()].filter(style => style.kind !== 'diagnostic');
export const terrainStyle = (id: TerrainStyle): TerrainStyleDefinition => definitions.get(id)!;
export const isTerrainStyle = (id: string | null | undefined): id is TerrainStyle => !!id && (isMapStyle(id) || definitions.has(id as TerrainStyle));
export const waterShoreColor = (id: TerrainStyle): string => terrainStyle(id).water.stops[0][1];
