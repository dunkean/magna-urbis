import type { MapStyle, Palette } from '../render/styles';
import { isTerrainStyle, terrainStyle, type TerrainStyle, type TerrainStyleDefinition } from '../render/terrainStyle';
import type { WaterStyle } from '../render/waterStyle';

/** Presentation belongs to the mapper, independently of terrain/environment/population.
 * The existing SVG/Canvas palette is the source of truth. A native preview may
 * implement only some tokens and must identify that coverage explicitly.
 */
export interface SurfacePresentation {
  format: 'magna-surface-presentation'; version: 1;
  defaultView: 'aerial' | 'cartographic'; mapStyle: MapStyle;
  terrainStyleId: TerrainStyle; terrainStyleKind: TerrainStyleDefinition['kind']; water: WaterStyle;
  palette: Palette; paletteSource: 'magna-urbis/render/styles.ts';
  colorSpace: 'srgb-css'; sourceQuery?: string; sourceQueryReference: 'source.meta.query';
  sourceStyleExplicit: boolean;
  policy: { geometry: 'unchanged'; materialAssignments: 'preserved'; labelsAndLayout: 'existing-map-renderers' };
}
export function magnaSurfacePresentation(query = '', defaultView: SurfacePresentation['defaultView'] = 'aerial'): SurfacePresentation {
  const requested = new URLSearchParams(query).get('style'), definition = terrainStyle(isTerrainStyle(requested) ? requested : 'parchment'), mapStyle = definition.palette.name;
  return { format: 'magna-surface-presentation', version: 1, defaultView, mapStyle,
    terrainStyleId: definition.id, terrainStyleKind: definition.kind, water: structuredClone(definition.water),
    palette: structuredClone(definition.palette), paletteSource: 'magna-urbis/render/styles.ts', colorSpace: 'srgb-css', sourceQuery: query.length <= 8192 ? query : undefined, sourceQueryReference: 'source.meta.query',
    sourceStyleExplicit: isTerrainStyle(requested), policy: { geometry: 'unchanged', materialAssignments: 'preserved', labelsAndLayout: 'existing-map-renderers' } };
}
