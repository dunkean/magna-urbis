import type { RenderColors } from '../render/customColors';
import { hydrologyWaterColour } from '../../../rust/bridge/hydrologyRender';
import type { TerrainStyle } from '../../../rust/bridge/terrainRender';
import { lakeMaterialSvg, decodeWaterField } from '../render/terrainWater';
import type { Decor } from './decor';
import { taperSpringBank } from '../render/riverHeadwaters';

export interface RetainedWaterMaterial {
  field: string;
  sea?: { distance: string; n: number };
  n: number; width: number; referenceWidth: number; path: string;
  /** Accumulated crop origin in the original material coordinates. */
  x?: number; y?: number; extent?: number;
}
const fields = new WeakMap<RetainedWaterMaterial, Float32Array>();
const tapered = new WeakMap<Decor, string>();
/** Water material is produced by the water chain and retained during capture. */
export function retainedWaterMaterial(decor: Decor): RetainedWaterMaterial {
  const material = decor.meta.waterMaterial;
  if (!material) throw new Error('Decor has no retained water material; recapture it from Terrain Bench.');
  return material;
}

/** Retained geometry uses the live style at every stage, including nested crops. */
export function decorWaterSvg(decor: Decor, style: TerrainStyle, showLakes = true, colors?: RenderColors): string {
  let geometry = tapered.get(decor);
  if (geometry === undefined) {
    const material = decor.meta.waterMaterial, springs = (decor.raster.geometry?.springs ?? []).map(p => ({ x: p.x + (material?.x ?? 0), y: p.y + (material?.y ?? 0) }));
    geometry = decor.meta.waterSvg.replace(/(<path\b[^>]*\bd=")([^"]*)(")/g, (_, before, d, after) => before + taperSpringBank(d, springs) + after);
    tapered.set(decor, geometry);
  }
  return waterAppearanceSvg(geometry, showLakes ? retainedWaterMaterial(decor) : undefined, style, showLakes, colors);
}

export function waterAppearanceSvg(geometry: string, source: RetainedWaterMaterial | undefined, style: TerrainStyle, showLakes = true, colors?: RenderColors): string {
  const colour = hydrologyWaterColour(style, colors);
  // Water geometry is an appearance-neutral group. Explicit fills from older
  // exporters are normalized too, including non-atlas source colors.
  let svg = geometry.replace(/\b(fill|stroke)="#[a-fA-F0-9]{3,8}"/g, '$1="' + colour + '"');
  // Pre-material exports contain paths only; new captures deliberately omit images.
  svg = svg.replace(/<image\b[^>]*\/>/g, '');
  if (!showLakes) return svg.replace(/<path\b[^>]*class="water-lakes"[^>]*\/>/g, '');
  if (!source?.path) return svg;
  let field = fields.get(source);
  if (!field) { field = decodeWaterField(source.field); fields.set(source, field); }
  const material = source.path ? lakeMaterialSvg(field, source.n, source.width, source.path, 'retained-lake-material', style, source.referenceWidth, colors) : '';
  return svg + (source.extent ? cropWaterSvg(material, source.x ?? 0, source.y ?? 0, source.extent) : material);
}

/** Keep vector shores and material coordinates when cropping, including repeated crops. */
export function cropWaterSvg(svg: string, x: number, y: number, width: number): string {
  return svg ? `<svg width="${width}" height="${width}" viewBox="${x} ${y} ${width} ${width}" overflow="hidden">${svg}</svg>` : '';
}
