import { hydrologyWaterColour } from '../../../rust/bridge/hydrologyRender';
import type { TerrainStyle } from '../../../rust/bridge/terrainRender';
import { landPath, landRings } from '../../../rust/bridge/urbanGeography';
import { lakeMaterialSvg } from '../render/terrainWater';
import { lakeField } from './lakeGeometry';
import type { Decor } from './decor';

const legacyMaterials = new WeakMap<Decor, string>();

/** Older exports contain the lake mask, but predate the retained water material. */
function legacyLakeMaterial(decor: Decor): string {
  let material = legacyMaterials.get(decor);
  if (material !== undefined) return material;
  const r = decor.raster, mask = Uint8Array.from(r.water, value => value === 2 ? 1 : 0);
  material = mask.some(Boolean)
    ? lakeMaterialSvg(lakeField(mask, r.n).values, r.n, r.width, landPath(landRings(Float32Array.from(mask, v => v ? 1 : -1), r.n, r.width)), 'retained-lake-material')
    : '';
  legacyMaterials.set(decor, material);
  return material;
}

/** Retained geometry uses the live renderer's palette and lake material at every stage. */
export function decorWaterSvg(decor: Decor, style: TerrainStyle, showLakes = true): string {
  const colour = hydrologyWaterColour(style), atlas = hydrologyWaterColour('atlas');
  const svg = decor.meta.waterSvg.replace(/\b(fill|stroke)="(#[a-fA-F0-9]{6})"/g,
    (attribute, name: string, value: string) => value.toLowerCase() === atlas.toLowerCase() || value.toLowerCase() === '#96bed2' ? `${name}="${colour}"` : attribute);
  const material = style === 'render' && showLakes ? decor.meta.waterMaterialSvg ?? legacyLakeMaterial(decor) : '';
  return (showLakes ? svg : svg.replace(/<path\b[^>]*class="water-lakes"[^>]*\/>/g, '')) + material;
}

/** Keep vector shores and material coordinates when cropping, including repeated crops. */
export function cropWaterSvg(svg: string, x: number, y: number, width: number): string {
  return svg ? `<svg width="${width}" height="${width}" viewBox="${x} ${y} ${width} ${width}" overflow="hidden">${svg}</svg>` : '';
}
