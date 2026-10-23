import type { Decor } from '../../ui/decor';

export interface SurfaceFrameOptions {
  /** Common coordinate-frame translation, including geology anchors; not a physical relocation. */
  originX?: number; originZ?: number;
  /** Physical full-source crop corner before the common frame translation. */
  terrainOriginX?: number; terrainOriginZ?: number;
}
export interface SurfaceCropFrame {
  x: number; y: number; width: number; sourceWidth: number;
  coordinateFrame?: 'crop-local' | 'source-global' | 'retained-input';
  /** Cumulative physical corner, even after repeated crop-local transfers. */
  sourceOriginX?: number; sourceOriginZ?: number;
  /** Offset from retained vector coordinates to the original physical frame. */
  geometryOriginX?: number; geometryOriginZ?: number;
}
export function resolveSurfaceFrame(decor: Decor, options: SurfaceFrameOptions = {}) {
  const crop = decor.meta.pipeline?.crop as SurfaceCropFrame | undefined;
  if (crop && (![crop.x,crop.y,crop.width,crop.sourceWidth].every(Number.isFinite) || crop.x<0 || crop.y<0 || crop.width<=0 || crop.sourceWidth<=0
    || crop.coordinateFrame !== undefined && !['crop-local','source-global','retained-input'].includes(crop.coordinateFrame))) throw new Error('Invalid retained surface crop frame');
  const chain = decor.meta.regeneration?.crops;
  const chainX = crop && chain?.length ? chain.reduce((sum,c) => sum+c.x,0) : crop?.x ?? 0;
  const chainZ = crop && chain?.length ? chain.reduce((sum,c) => sum+c.y,0) : crop?.y ?? 0;
  const terrainX = options.terrainOriginX ?? crop?.sourceOriginX ?? chainX;
  const terrainZ = options.terrainOriginZ ?? crop?.sourceOriginZ ?? chainZ;
  if (crop?.coordinateFrame==='retained-input' && ![crop.geometryOriginX,crop.geometryOriginZ].every(Number.isFinite)) throw new Error('Retained-input crop needs explicit vector origin');
  const geometryX = crop?.geometryOriginX ?? (crop && (!crop.coordinateFrame || crop.coordinateFrame==='crop-local') ? terrainX : 0);
  const geometryZ = crop?.geometryOriginZ ?? (crop && (!crop.coordinateFrame || crop.coordinateFrame==='crop-local') ? terrainZ : 0);
  const dx = options.originX ?? 0, dz = options.originZ ?? 0;
  if (![terrainX,terrainZ,geometryX,geometryZ,dx,dz].every(Number.isFinite)) throw new Error('Surface frame offsets must be finite');
  const sourceWidth = crop?.sourceWidth ?? decor.raster.width;
  if (crop && (Math.abs(crop.width-decor.raster.width)>Math.max(0.001,decor.raster.width*1e-9) || terrainX<0 || terrainZ<0 || terrainX+decor.raster.width>sourceWidth+0.001 || terrainZ+decor.raster.width>sourceWidth+0.001)) throw new Error('Crop extent is inconsistent with the retained full-source frame');
  return { format:'magna-surface-frame' as const, version:1 as const, coordinateSystem:'metric-xz' as const,
    terrainSourceOrigin:{x:terrainX,z:terrainZ}, geometrySourceOrigin:{x:geometryX,z:geometryZ},
    frameTranslation:{x:dx,z:dz}, terrainWorldCorner:{x:terrainX+dx,z:terrainZ+dz},
    geometryToWorldTranslation:{x:geometryX+dx,z:geometryZ+dz},
    sourceCrop:crop ? {x:terrainX,z:terrainZ,widthM:decor.raster.width,coordinates:crop.coordinateFrame ?? 'crop-local'} : null,
    fullSource:{id:decor.meta.pipeline?.parent ?? decor.meta.id,widthM:sourceWidth,queryReference:'source.meta.query'},
    liveCompatible:!crop && terrainX===0 && terrainZ===0 && geometryX===0 && geometryZ===0 && dx===0 && dz===0 };
}

/** Live refinement currently registers a full unshifted square. Refuse a crop
 * explicitly rather than returning heights from another place in that square. */
export function assertSurfaceLiveFrame(decor: Decor): void {
  if (!resolveSurfaceFrame(decor).liveCompatible) throw new Error('Surface live requires the full un-cropped, untranslated source world. Export this portion offline or reopen the complete source before connecting live refinement.');
}
