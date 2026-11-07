import { waterSampler } from './waterStyle';
import { hexToRgb, type MapStyle, type Palette } from './styles';

// Width in world metres, shared by all camera regions and both renderers.
export const SEA_BAND_WIDTH = 0.016;
/** Compatibility adapter; every palette now supports the same coastal material. */
export const hasCoastalSea = (_style: MapStyle | 'copernicus' | 'render' | 'fantasy-ink' | 'fantasy-color'): boolean => true;
export function coastalSeaColors(pal: Palette): { shore: number[]; offshore: number[]; sample: (position: number) => number[] } {
  return { shore: hexToRgb(pal.water.stops[0][1]), offshore: hexToRgb(pal.water.stops[pal.water.stops.length - 1][1]), sample: waterSampler(pal.water) };
}
export function coastalSeaColor(distance: number, bandWidth: number, _shadeFactor: number, colors: ReturnType<typeof coastalSeaColors>): number[] {
  return colors.sample(Math.max(0, distance) / Math.max(1e-6, bandWidth));
}

/** Signed Euclidean distance to the sub-cell zero contour, capped at the coastal band (Rust, render_geometry::coast). */
export { coastDistances } from '../../../rust/bridge/renderGeometry';
