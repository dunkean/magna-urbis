import { hydrologyWaterColour } from '../../../rust/bridge/hydrologyRender';
import type { TerrainStyle } from '../../../rust/bridge/terrainRender';
import { landPath, landRings } from '../../../rust/bridge/urbanGeography';
import { lakeMaterialSvg, encodeWaterField, decodeWaterField } from '../render/terrainWater';
import { lakeField } from './lakeGeometry';
import type { Decor } from './decor';

export interface RetainedWaterMaterial {
  field: string;
  sea?: { distance: string; n: number };
  n: number; width: number; referenceWidth: number; path: string;
  /** Accumulated crop origin in the original material coordinates. */
  x?: number; y?: number; extent?: number;
}
const fields = new WeakMap<RetainedWaterMaterial, Float32Array>();
const legacyMaterials = new WeakMap<Decor, RetainedWaterMaterial>();

/** Old files retain their masks. Rebuild neutral input instead of reusing a colored PNG. */
export function retainedWaterMaterial(decor: Decor): RetainedWaterMaterial {
  if (decor.meta.waterMaterial) return decor.meta.waterMaterial;
  let material = legacyMaterials.get(decor);
  if (!material) {
    const r = decor.raster, mask = Uint8Array.from(r.water, value => value === 2 ? 1 : 0);
    material = { field: encodeWaterField(lakeField(mask, r.n).values), n: r.n, width: r.width,
      referenceWidth: decor.meta.terrainDisplay?.referenceWidth ?? r.width,
      path: landPath(landRings(Float32Array.from(mask, v => v ? 1 : -1), r.n, r.width)) };
    legacyMaterials.set(decor, material);
  }
  return material;
}

/** Retained geometry uses the live style at every stage, including nested crops. */
export function decorWaterSvg(decor: Decor, style: TerrainStyle, showLakes = true): string {
  return waterAppearanceSvg(decor.meta.waterSvg, showLakes ? retainedWaterMaterial(decor) : undefined, style, showLakes);
}

export function waterAppearanceSvg(geometry: string, source: RetainedWaterMaterial | undefined, style: TerrainStyle, showLakes = true): string {
  const colour = hydrologyWaterColour(style);
  // Water geometry is an appearance-neutral group. Explicit fills from older
  // exporters are normalized too, including non-atlas source colors.
  let svg = geometry.replace(/\b(fill|stroke)="#[a-fA-F0-9]{3,8}"/g, '$1="' + colour + '"');
  // Pre-material exports contain paths only; new captures deliberately omit images.
  svg = svg.replace(/<image\b[^>]*\/>/g, '');
  if (!showLakes) return svg.replace(/<path\b[^>]*class="water-lakes"[^>]*\/>/g, '');
  if (!source?.path) return svg;
  let field = fields.get(source);
  if (!field) { field = decodeWaterField(source.field); fields.set(source, field); }
  const material = source.path ? lakeMaterialSvg(field, source.n, source.width, source.path, 'retained-lake-material', style, source.referenceWidth) : '';
  return svg + (source.extent ? cropWaterSvg(material, source.x ?? 0, source.y ?? 0, source.extent) : material);
}

/** Keep vector shores and material coordinates when cropping, including repeated crops. */
export function cropWaterSvg(svg: string, x: number, y: number, width: number): string {
  return svg ? `<svg width="${width}" height="${width}" viewBox="${x} ${y} ${width} ${width}" overflow="hidden">${svg}</svg>` : '';
}
