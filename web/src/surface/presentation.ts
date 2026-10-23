import { PALETTES, isMapStyle, type MapStyle, type Palette } from '../render/styles';

/** Presentation belongs to the mapper, independently of terrain/environment/population.
 * The existing SVG/Canvas palette is the source of truth. A native preview may
 * implement only some tokens and must identify that coverage explicitly.
 */
export interface SurfacePresentation {
  format: 'magna-surface-presentation'; version: 1;
  defaultView: 'aerial' | 'cartographic'; mapStyle: MapStyle;
  palette: Palette; paletteSource: 'magna-urbis/render/styles.ts';
  colorSpace: 'srgb-css'; sourceQuery?: string; sourceQueryReference: 'source.meta.query';
  sourceStyleExplicit: boolean;
  policy: { geometry: 'unchanged'; materialAssignments: 'preserved'; labelsAndLayout: 'existing-map-renderers' };
}
export function magnaSurfacePresentation(query = '', defaultView: SurfacePresentation['defaultView'] = 'aerial'): SurfacePresentation {
  const requested = new URLSearchParams(query).get('style'), mapStyle = isMapStyle(requested) ? requested : 'parchment';
  return { format: 'magna-surface-presentation', version: 1, defaultView, mapStyle,
    palette: structuredClone(PALETTES[mapStyle]), paletteSource: 'magna-urbis/render/styles.ts', colorSpace: 'srgb-css', sourceQuery: query.length <= 8192 ? query : undefined, sourceQueryReference: 'source.meta.query',
    sourceStyleExplicit: isMapStyle(requested), policy: { geometry: 'unchanged', materialAssignments: 'preserved', labelsAndLayout: 'existing-map-renderers' } };
}
