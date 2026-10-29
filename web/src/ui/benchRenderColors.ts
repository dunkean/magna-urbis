import { COLOR_KEYS, isRenderColor, type RenderColors } from '../render/customColors';

export function readRenderColorsQuery(query: URLSearchParams): RenderColors {
  const colors: RenderColors = {};
  for (const key of COLOR_KEYS) { const value = query.get(`color_${key}`); if (isRenderColor(value)) colors[key] = value; }
  return colors;
}
export function writeRenderColorsQuery(query: URLSearchParams, colors: RenderColors): void {
  for (const key of COLOR_KEYS) { if (colors[key]) query.set(`color_${key}`, colors[key]!); else query.delete(`color_${key}`); }
}
let colors = readRenderColorsQuery(new URLSearchParams(typeof location === 'undefined' ? '' : location.search));
export const getBenchRenderColors = (): RenderColors => colors;
export function setBenchRenderColors(next: RenderColors): void {
  colors = { ...next };
  window.dispatchEvent(new Event('bench-render-colors-change'));
}
