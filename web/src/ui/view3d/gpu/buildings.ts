import { HOUSE_TILE_SIZE, HOUSE_TILE_LAYERS, houseSurfaceCount, houseSurfaceMips, releaseHouseSurfacePixels } from '../../../render/houseSurfaceTexture';
/**
 * The building pass of the WebGPU terrain view: UrbanBuildingPass with its upload and draw hooks recorded into the
 * terrain frame's pass and parameter pool.
 */
import { MATERIALS, type MaterialImages } from '../../../render/buildingMaterials';
import { SOFT_LAYER_FROM, caveUniform, UrbanBuildingPass, type Batch, type BuildingFrame, type Sector } from '../../urbanBuilding3d';
import * as WGSL from '../../terrain3dWgsl.generated';
import { Pool, Params } from './parameters';
import { Gpu3d } from './device';
import { mipCount } from './images';
import { T } from './layouts';

/** UrbanBuildingPass recording into the 3D view's render pass (UrbanBuildingPassGpu.target). */
export class UrbanBuildingPassGpu extends UrbanBuildingPass {
  target?: { pass: GPURenderPassEncoder; params: Pool; samples: number };
  private readonly params = new Params(WGSL.WGSL3D_PARAMS.building);
  private atlases?: { albedo: GPUTexture; normal: GPUTexture };
  private gpuHouseAtlas?: GPUTexture;
  private houseLayers = 0;
  private placeholder: GPUTexture;
  constructor(
    private gpu: Gpu3d,
    onTexturesReady?: () => void,
  ) {
    super(undefined, onTexturesReady);
    this.placeholder = gpu.device.createTexture({ label: 'no building material', size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
  }
  protected override upload(batch: Batch, values: Float32Array): void {
    const buffer = this.gpu.device.createBuffer({ label: 'building batch', size: values.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.gpu.device.queue.writeBuffer(buffer, 0, values.buffer, values.byteOffset, values.byteLength);
    batch.gpu = buffer;
  }
  protected override releaseBatch(batch: Batch): void {
    batch.gpu?.destroy();
    batch.gpu = undefined;
  }
  /** Material atlases as mipmapped 2D arrays (uploadMaterialArrays, display-space albedo). */
  protected override uploadTextures(images: MaterialImages): void {
    const tile = MATERIALS.tile,
      count = MATERIALS.layers.length,
      device = this.gpu.device;
    const make = (bitmap: ImageBitmap, label: string): GPUTexture => {
      const texture = device.createTexture({ label, size: [tile, tile, count], format: 'rgba8unorm', mipLevelCount: mipCount(tile, tile), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      for (let layer = 0; layer < count; layer++) device.queue.copyExternalImageToTexture({ source: bitmap, origin: { x: 0, y: layer * tile } }, { texture, origin: { x: 0, y: 0, z: layer } }, [tile, tile]);
      this.gpu.generateMipmaps(texture);
      return texture;
    };
    this.atlases?.albedo.destroy();
    this.atlases?.normal.destroy();
    this.atlases = { albedo: make(images.albedo, 'building albedo'), normal: make(images.normal, 'building normals') };
  }
  protected override prepareHouseAtlas(): boolean {
    if (this.houseLayers >= houseSurfaceCount()) return true;
    const device = this.gpu.device;
    this.gpuHouseAtlas ??= device.createTexture({
      label: 'detailed architecture',
      size: [HOUSE_TILE_SIZE, HOUSE_TILE_SIZE, HOUSE_TILE_LAYERS],
      format: 'rgba8unorm',
      mipLevelCount: mipCount(HOUSE_TILE_SIZE, HOUSE_TILE_SIZE),
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const slice = this.houseLayers;
    const mips = houseSurfaceMips(slice + 1, this);
    if (!mips.length) return false;
    mips.forEach((source, mipLevel) => {
      device.queue.copyExternalImageToTexture({ source }, { texture: this.gpuHouseAtlas!, mipLevel, origin: [0, 0, slice] }, [source.width, source.height]);
    });
    this.houseLayers++;
    return this.houseLayers >= houseSurfaceCount();
  }
  protected override render(frame: BuildingFrame, shown: readonly Sector[], textured: boolean): void {
    const target = this.target;
    if (!target || !shown.length) return;
    const pipeline = this.gpu.pipeline(textured ? 'buildingTex' : 'buildingColor', target.samples);
    const snowPipeline = shown.some(s => s.cached?.batches.some(b => b.snow)) ? this.gpu.pipeline(textured ? 'buildingTex.snow' : 'buildingColor.snow', target.samples) : undefined;
    if (!pipeline) return;
    const { pass, params } = target,
      p = this.params,
      device = this.gpu.device;
    const albedo = (this.atlases?.albedo ?? this.placeholder).createView({ dimension: '2d-array' }),
      normal = (this.atlases?.normal ?? this.placeholder).createView({ dimension: '2d-array' });
    const houseSurface = this.crafted && this.gpuHouseAtlas ? this.gpuHouseAtlas.createView({ dimension: '2d-array' }) : albedo;
    pass.setPipeline(pipeline);
    p.setArray('matrix', frame.matrix);
    p.set('exaggeration', frame.exaggeration);
    p.set('uRoofInkDpr', this.roofInkDpr(frame));
    p.set('uHouseSurfaceReady', this.crafted ? this.houseLayers : 0);
    p.set('useTex', this.atlases ? 2 : 0);
    p.set('softFrom', SOFT_LAYER_FROM);
    p.set('uNight', frame.cave || !this.night ? 0 : this.lightsOn ? 1 : 2);
    p.setArray('uCave', caveUniform(frame, this.lightsOn));
    p.setArray('uCaveEye', frame.cave?.eye ?? [0, 0, 0]);
    let group: GPUBindGroup | undefined, groupBuffer: GPUBuffer | undefined;
    for (const sector of shown) {
      p.set('offset', sector.origin[0] - frame.cameraX, -frame.targetHeight, sector.origin[1] - frame.cameraY);
      p.set('sectorOrigin', sector.origin[0], sector.origin[1]);
      for (const batch of sector.cached!.batches) {
        if (!batch.gpu) continue;
        pass.setPipeline(batch.snow && snowPipeline ? snowPipeline : pipeline);
        if (textured) {
          p.setArray('material', batch.color);
          p.setArray('tint', batch.tint);
          p.set('recolored', batch.recolored ? 1 : 0);
        }
        const slot = params.alloc(p.bytes);
        if (slot.buffer !== groupBuffer) {
          groupBuffer = slot.buffer;
          group = device.createBindGroup({
            layout: this.gpu.layouts.building,
            entries: [
              { binding: 0, resource: { buffer: slot.buffer, offset: 0, size: p.bytes.byteLength } },
              { binding: 4, resource: this.gpu.samplers.repeat },
              { binding: T.albedoTex, resource: albedo },
              { binding: T.normalTex, resource: normal },
              { binding: T.uHouseSurface, resource: houseSurface },
            ],
          });
        }
        pass.setBindGroup(0, group!, [slot.offset]);
        pass.setVertexBuffer(0, batch.gpu);
        pass.draw(batch.count);
      }
    }
  }
  protected override releaseHouseAtlas(): void {
    this.gpuHouseAtlas?.destroy();
    this.gpuHouseAtlas = undefined;
    this.houseLayers = 0;
    releaseHouseSurfacePixels(this);
  }
  protected override disposeBackend(): void {
    this.atlases?.albedo.destroy();
    this.atlases?.normal.destroy();
    this.atlases = undefined;
    this.placeholder.destroy();
    this.releaseHouseAtlas();
  }
}
