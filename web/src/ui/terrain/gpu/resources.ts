/**
 * WebGPU objects of the 2D ground: sampled images (with explicit mip chains: box mipmaps keep the forest field's mean
 * cover, as WebGL's generateMipmap does), height layers with their pyramid, render targets, and the per-view set of
 * intermediate targets and caches (world tiles keep their own, as TerrainGl's GlViewTargets).
 */
import { rasterMips } from '../../boxMips';
import { heightPyramid } from '../../terrainSurface';
import { AuxPassKey } from '../redraw';
import { RetainedWaterRaster } from '../retainedWater';
import type { ForestField } from '../../../../../rust/bridge/terrainForest';
import type { StackedLayer } from '../layers';
import type { HeightLayer } from '../contract';

export interface GpuImage {
  texture: GPUTexture;
  view: GPUTextureView;
}
export interface Target extends GpuImage {
  width: number;
  height: number;
}
export interface GpuHeightLayer extends StackedLayer {
  texture: GPUTexture;
  view: GPUTextureView;
  cave?: GPUTexture;
  caveView?: GPUTextureView;
}
export interface ForestImages {
  field: ForestField;
  texture: GpuImage;
  bank?: GpuImage;
  beach?: GpuImage;
}
/** Where a frame ends: the display canvas, the world-tile canvas or the capture canvas (opaque or premultiplied). */
export interface Surface {
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  opaque: boolean;
}

export function gpuImage(device: GPUDevice, width: number, height: number, format: GPUTextureFormat, data: ArrayBufferView, bytesPerTexel: number, mips?: ArrayBufferView[]): GpuImage {
  const levels = mips ?? [data];
  const texture = device.createTexture({ size: [width, height], format, mipLevelCount: levels.length, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  levels.forEach((level, mip) => {
    const w = Math.max(1, width >> mip),
      h = Math.max(1, height >> mip);
    device.queue.writeTexture({ texture, mipLevel: mip }, level as BufferSource, { bytesPerRow: w * bytesPerTexel, rowsPerImage: h }, [w, h]);
  });
  return { texture, view: texture.createView() };
}
export function gpuArrayImage(device: GPUDevice, size: number, layers: number, levels: number, data: readonly Uint8Array[], format: 'rg8unorm' | 'rgba8unorm' = 'rg8unorm'): GpuImage {
  const texture = device.createTexture({ size: [size, size, layers], format, mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const bytes = format === 'rgba8unorm' ? 4 : 2;
  data.forEach((level, mip) => {
    const s = Math.max(1, size >> mip);
    device.queue.writeTexture({ texture, mipLevel: mip }, level as BufferSource, { bytesPerRow: s * bytes, rowsPerImage: s }, [s, s, layers]);
  });
  return { texture, view: texture.createView({ dimension: '2d-array' }) };
}
/** RGBA8 world raster; box mipmaps keep the field's mean cover at coarse footprints (gl/forest.ts forestTexture). */
export const rgbaImage = (device: GPUDevice, raster: { n: number; rgba: Uint8Array }, mipmaps: boolean): GpuImage => gpuImage(device, raster.n, raster.n, 'rgba8unorm', raster.rgba, 4, mipmaps ? rasterMips(raster.rgba, raster.n, raster.n, 4) : undefined);
export const releaseImage = (image: GpuImage | undefined): void => image?.texture.destroy();

export function gpuTarget(device: GPUDevice, width: number, height: number, format: GPUTextureFormat, previous?: Target): Target {
  if (previous?.width === width && previous.height === height) return previous;
  previous?.texture.destroy();
  const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  return { texture, view: texture.createView(), width, height };
}

export function uploadGpuLayer(device: GPUDevice, layer: HeightLayer, pyramid: boolean): GpuHeightLayer {
  const levels = pyramid ? heightPyramid(layer.data, layer.n) : [layer.data];
  const { texture, view } = gpuImage(device, layer.n, layer.n, 'r32float', layer.data, 4, levels);
  let cave: GpuImage | undefined;
  if (layer.cave?.length) {
    const mask = new Uint8Array(layer.cave.length);
    mask.set(layer.cave);
    cave = gpuImage(device, layer.n, layer.n, 'r8unorm', mask, 1);
  }
  return { layer, levels, texture, view, cave: cave?.texture, caveView: cave?.view, alpha: 1, fadeStart: 0 };
}
export function releaseGpuLayer(layer: GpuHeightLayer | undefined): void {
  if (!layer) return;
  layer.texture.destroy();
  layer.cave?.destroy();
}

/** Intermediate targets and caches of the draws of one view (the live view, or the world tiles). */
export class GpuViewTargets {
  map?: Target;
  river?: Target;
  water?: Target;
  aux?: Target;
  readonly auxKey = new AuxPassKey();
  retainedWater?: Target;
  readonly retained = new RetainedWaterRaster();
  /** Device lost: every object is gone (the retained canvas is kept). */
  forget(): void {
    this.map = this.river = this.water = this.aux = this.retainedWater = undefined;
    this.auxKey.invalidate();
    this.retained.invalidate();
  }
  dispose(): void {
    for (const target of [this.aux, this.map, this.river, this.water, this.retainedWater]) target?.texture.destroy();
  }
}
