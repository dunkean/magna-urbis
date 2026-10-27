/** Map treatment of the shared final sRGB colours; no independent lot jitter. */
import { buildingTint, type PaletteRgb } from './buildingPalette';
import type { CityBuilding, CityPalette, CityRoofs } from './cityCanvas';

const hex = (c: PaletteRgb): string => `#${c.map(v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('')}`;
const tints = new WeakMap<CityBuilding, Map<string, { wall: string; roof: string }>>();
function mapTint(c: PaletteRgb, palette: CityPalette): string {
  const paper: PaletteRgb = [0.81, 0.72, 0.55], ink: PaletteRgb = [0.29, 0.22, 0.15];
  if (palette === 'parchment' || palette === 'ink') {
    const grey = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    // Keep the warm paper/ink cast, but preserve most lot value differences.
    // The old parchment slope (.432) flattened neighbouring roofs into one wash.
    const strength = palette === 'parchment' ? 0.86 : 0.38, paperMix = palette === 'parchment' ? 0.12 : 0.28;
    return hex(c.map((v, i) => (grey * (1 - paperMix) + paper[i] * paperMix) * strength + ink[i] * (1 - strength) + (v - grey) * 0.34) as PaletteRgb);
  }
  const wash = palette === 'atlas' ? 0.12 : palette === 'growth' ? 0.06 : 0;
  return hex(c.map((v, i) => v * (1 - wash) + [0.95, 0.92, 0.85][i] * wash) as PaletteRgb);
}
export function planBuildingColors(b: CityBuilding, palette: CityPalette, cover = b.material?.cover ?? '', wall = b.material?.wall ?? '', tone = b.material?.tone ?? 0.5): { wall: string; roof: string } {
  const role = `${b.role ?? ''} ${b.family}${b.landmark || wall === 'stone' ? ' monument' : ''}`;
  const key = `${palette}|${cover}|${wall}|${tone}|${role}`;
  let cache = tints.get(b); if (!cache) tints.set(b, cache = new Map());
  const cached = cache.get(key); if (cached) return cached;
  const colors = buildingTint(b.material?.culture ?? b.building.culture?.culture ?? '', wall, cover, tone, role);
  const mapped = { wall: mapTint(colors.wall, palette), roof: mapTint(colors.roof, palette) }; cache.set(key, mapped); return mapped;
}
export function planShade(color: string, k: number): string {
  const v = parseInt(color.slice(1), 16), c = (s: number): number => Math.max(0, Math.min(255, Math.round(((v >> s) & 255) * (1 + k))));
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
}
export const roofRelief = (palette: CityPalette): number => palette === 'parchment' ? 0.55 : palette === 'ink' ? 0.35 : 1;
export function planRoofColor(b: CityBuilding, roofs: CityRoofs, k: number, palette: CityPalette): string {
  return planShade(planBuildingColors(b, palette, roofs.cover[k], roofs.wall?.[k], roofs.tone[k]).roof, roofs.light[k] * roofRelief(palette));
}
