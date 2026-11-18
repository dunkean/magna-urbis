/**
 * WebGPU Terrain3d adapter state and resource-upload hooks, created by gpuPreparation.
 * Reads/writes: Owns device/canvas resources and per-frame pools; passes the same view explicitly to GPU recording/capture operations and retains inherited terrain dispatch.
 */

/**
 * WebGPU backend of the 3D terrain view: Terrain3d (terrain3d.ts) with its GPU hooks overridden, and the
 * building pass (urbanBuilding3d.ts) likewise. Quadtree, LOD morphs, tile loading, stitching, picking and
 * camera stay in Terrain3d; these modules only upload resources and record the frame. The shaders are
 * Terrain3d's and UrbanBuildingPass's, translated to WGSL by web/scripts/wgsl_shaders_3d.ts
 * (terrain3dWgsl.generated.ts).
 *
 * Differences from the WebGL2 path, by construction:
 * - the frame renders straight to the canvas (4× MSAA resolved into it), without the map's y flip; the
 *   generated shaders keep GL's window conventions instead (see wgsl_shaders_3d.ts) and GL's depth values;
 * - uniforms live in one storage block per program, copied per draw into frame-pooled slots; the seam
 *   corrections that GL streams into one attribute buffer per draw are pooled the same way;
 * - the ground switches are pipeline overrides, created with createRenderPipelineAsync: the last drawn (or
 *   the preview) pipeline stands in meanwhile, as the WebGL2 variants do while they link;
 * - mipmaps of the material tiles and building atlases are rendered (box filter by bilinear taps), those of
 *   the forest rasters computed on the CPU, as the map backend does;
 * - illustration depth is resolved from the multisampled depth buffer (sample 0) and read back
 *   asynchronously, at float precision instead of GL's 24-bit readback.
 * Textures and meshes travel through Terrain3d's WebGL-typed fields as the backend's own objects (GpuImage,
 * GPUBuffer): those WebGL types are empty interfaces, opaque to Terrain3d.
 */
import { boxMips, rasterMips } from '../boxMips';
import { unzlibSync } from 'fflate';
import atlas from '../../render/assets/fantasy/forest-brushes.json';
import type { ForestField, ForestOccupation, LandDetail } from '../../../../rust/bridge/terrainForest';
import { Terrain3d, paddedMaterial, fullPatchIndices, patchClipKey, clippedPatchIndices, type FrameGeometry, type Patch, type PatchDraw, type Terrain3dOptions, type Terrain3dTile, type Terrain3dTileContent } from '../terrain3d';
import type { ForestTextures, HeightLayer } from '../terrainGl';
import * as WGSL from '../terrain3dWgsl.generated';
import { halfFloats, type CavernField } from '../../render/underdarkCavern';
import { Gpu3d, groundKey, PREVIEW_GROUND } from './gpuDevice';
import { Pool, Params } from './gpuParameters';
import { GpuImage, mipCount, image } from './gpuImages';
import { SAMPLES, DEPTH } from './gpuLayouts';
import { UrbanBuildingPassGpu } from './gpuBuildings';
import type { TerrainGpuContext } from './terrainGpuContext';
import * as gpuVegetation from './gpuVegetation';
import * as gpuFrame from './gpuFrame';
import * as gpuCapture from './gpuCapture';

export class Terrain3dGpu extends Terrain3d {
  private gpu!: Gpu3d;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private params!: Pool;
  private seamPool!: Pool;
  private readonly terrainParams = new Params(WGSL.WGSL3D_PARAMS.terrain);
  private readonly skyParams = new Params(WGSL.WGSL3D_PARAMS.sky);
  private readonly billboardParams = new Params(WGSL.WGSL3D_PARAMS.billboard);
  private gpuBillboardBuffer?: GPUBuffer;
  private readonly treeParams = new Params(WGSL.WGSL3D_PARAMS.tree);
  private gpuTreeBuffer?: GPUBuffer;
  private fungusParams?: Params;
  private roofParams?: Params;
  private gpuRoof?: { vertices: GPUBuffer; indices: GPUBuffer };
  private gpuFungusBuffer?: GPUBuffer;
  private gpuBillboardAtlas?: { source: HTMLCanvasElement; texture: WebGLTexture };
  private fullIndices!: { buffer: GPUBuffer; count: number };
  private patchIndexCache = new Map<string, { buffer: GPUBuffer; count: number }>();
  /** Buffers released while a frame is being recorded, destroyed after its submit. */
  private garbage: GPUBuffer[] = [];
  private targets?: { width: number; height: number; samples: number; color: GPUTexture; colorView: GPUTextureView; depth: GPUTexture; depthView: GPUTextureView };
  private blank!: GpuImage;
  private emptyUnfilterable!: GpuImage;
  private brushes!: { image: GpuImage; full: boolean };
  private ring?: { layer: object; revision: number; image: GpuImage; x: number; y: number; width: number };
  private lastGroundPipelines = new Map<number, GPURenderPipeline>();
  /** One sample while moving, once the single-sample ground exists: the multisampled one (the one shown at rest)
   * is compiled first, and until the other is ready the moving frames keep it rather than a stand-in material. */
  private get samples(): number {
    if (!(this.frameInteracting || this.frameQuality > 0)) return SAMPLES;
    if (this.useMapShader) return 1;
    const key = this.groundKeyNow();
    if (this.gpu.ready(key, 1)) return 1;
    this.gpu.pipeline(key, 1);
    return SAMPLES;
  }
  private groundKeyNow(): string {
    const settings = this.groundSettings;
    return groundKey(+!!settings, settings?.renderV2 ?? 0, +(!!this.forest && !settings?.underdark), +!!settings?.forestBrushes, +!!settings?.underdark);
  }
  private pipeline(key: string): GPURenderPipeline | undefined {
    return this.gpu.pipeline(key, this.samples);
  }
  private readonly redraw = (): void => this.request();
  private onDeviceLost?: () => void;
  private readonly deviceLost = (): void => {
    const callback = this.onDeviceLost;
    this.onDeviceLost = undefined;
    if (!this.disposed) callback?.();
  };

  constructor(canvas: HTMLCanvasElement, gpu: Gpu3d, onChange: () => void, onRender?: () => void, options: Terrain3dOptions = {}, onDeviceLost?: () => void) {
    super(canvas, onChange, onRender, options);
    this.onDeviceLost = onDeviceLost;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU indisponible sur ce canevas.');
    this.gpu = gpu;
    this.device = gpu.device;
    this.context = context;
    this.maxFramebufferDimension = this.device.limits.maxTextureDimension2D;
    context.configure({ device: this.device, format: gpu.format, alphaMode: 'opaque' });
    gpu.listeners.add(this.redraw);
    gpu.lostListeners.add(this.deviceLost);
    this.params = new Pool(this.device, GPUBufferUsage.STORAGE, 256 * 1024, this.device.limits.minStorageBufferOffsetAlignment, '3d parameters');
    this.seamPool = new Pool(this.device, GPUBufferUsage.VERTEX, 4 * 1024 * 1024, 4, '3d seams');
    this.fullIndices = this.indexBuffer(fullPatchIndices());
    this.blank = this.image(1, 1, 'r8unorm', new Uint8Array(4), 1);
    this.emptyUnfilterable = this.image(1, 1, 'r32float', new Float32Array(1), 4);
    this.brushes = { image: this.arrayImage(1, 1, 1, [new Uint8Array([255, 128])]), full: false };
    this.material = this.uploadTexture(new Uint8Array([203, 211, 182, 255]));
    this.macroTexture = this.uploadMacroField(this.layer);
    this.refreshCavern(true);
    this.buildings = new UrbanBuildingPassGpu(gpu, () => this.request());
    this.buildings.setScene(this.buildingsVisible ? this.buildingScene : undefined, this.buildingAppearance);
    this.selectTerrainProgram(false);
    this.mark('renderer', 'webgpu');
  }
  /** The context is taken by the constructor, once the subclass fields exist. */
  protected override attach(): void {}
  protected override prepareMapShader(): void {}
  protected override contextLost(): boolean {
    return !!this.gpu?.lost;
  }

  private image(width: number, height: number, format: GPUTextureFormat, data: ArrayBufferView, bytesPerTexel: number, mips?: ArrayBufferView[]): GpuImage {
    const levels = mips ?? [data];
    const texture = this.device.createTexture({ size: [width, height], format, mipLevelCount: levels.length, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    levels.forEach((level, mip) => {
      const w = Math.max(1, width >> mip),
        h = Math.max(1, height >> mip);
      this.device.queue.writeTexture({ texture, mipLevel: mip }, level as BufferSource, { bytesPerRow: w * bytesPerTexel, rowsPerImage: h }, [w, h]);
    });
    return { texture, view: texture.createView() };
  }
  private arrayImage(size: number, layers: number, levels: number, data: Uint8Array[]): GpuImage {
    const texture = this.device.createTexture({ size: [size, size, layers], format: 'rg8unorm', mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    data.forEach((level, mip) => {
      const s = Math.max(1, size >> mip);
      this.device.queue.writeTexture({ texture, mipLevel: mip }, level as BufferSource, { bytesPerRow: s * 2, rowsPerImage: s }, [s, s, layers]);
    });
    return { texture, view: texture.createView({ dimension: '2d-array' }) };
  }
  private rgbaImage(raster: { n: number; rgba: Uint8Array }, mipmaps: boolean): GpuImage {
    return this.image(raster.n, raster.n, 'rgba8unorm', raster.rgba, 4, mipmaps ? rasterMips(raster.rgba, raster.n, raster.n, 4) : undefined);
  }
  private indexBuffer(indices: Uint16Array): { buffer: GPUBuffer; count: number } {
    const buffer = this.device.createBuffer({ label: 'patch indices', size: Math.ceil(indices.byteLength / 4) * 4, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
    new Uint16Array(buffer.getMappedRange()).set(indices);
    buffer.unmap();
    return { buffer, count: indices.length };
  }
  private patchIndices(tile: Terrain3dTile, clip: Terrain3dTile): { buffer: GPUBuffer; count: number } {
    const key = patchClipKey(tile, clip);
    if (!key) return this.fullIndices;
    let cached = this.patchIndexCache.get(key);
    if (cached) {
      this.patchIndexCache.delete(key);
      this.patchIndexCache.set(key, cached);
      return cached;
    }
    this.patchIndexCache.set(key, (cached = this.indexBuffer(clippedPatchIndices(key))));
    if (this.patchIndexCache.size > 64) {
      const oldest = this.patchIndexCache.keys().next().value!;
      this.garbage.push(this.patchIndexCache.get(oldest)!.buffer);
      this.patchIndexCache.delete(oldest);
    }
    return cached;
  }

  protected override uploadCavern(field: CavernField): WebGLTexture {
    return this.image(field.n, field.n, 'rgba16float', halfFloats(field.texels), 8);
  }
  protected override uploadMacroField(layer?: HeightLayer): WebGLTexture {
    const n = layer?.n ?? 1;
    return this.image(n, n, 'r32float', layer?.data ?? new Float32Array(1), 4);
  }
  /** Premultiplied RGBA8 with a one-texel border and rendered mipmaps (Terrain3d.uploadTexture). */
  protected override uploadTexture(source: TexImageSource | Uint8Array): WebGLTexture {
    if (source instanceof Uint8Array) {
      const a = source[3] / 255;
      return this.image(1, 1, 'rgba8unorm', new Uint8Array([Math.round(source[0] * a), Math.round(source[1] * a), Math.round(source[2] * a), source[3]]), 4);
    }
    const padded = paddedMaterial(source),
      width = padded.width,
      height = padded.height;
    const texture = this.device.createTexture({ label: 'material', size: [width, height], format: 'rgba8unorm', mipLevelCount: mipCount(width, height), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.device.queue.copyExternalImageToTexture({ source: padded }, { texture, premultipliedAlpha: true }, [width, height]);
    this.gpu.generateMipmaps(texture);
    return { texture, view: texture.createView() } satisfies GpuImage;
  }
  protected override deleteTexture(texture: WebGLTexture): void {
    image(texture).texture.destroy();
  }
  protected override uploadWaterMask(water: NonNullable<Terrain3dTileContent['water']>): WebGLTexture {
    return this.image(water.n, water.n, 'r8unorm', water.alpha, 1);
  }
  protected override uploadForest(field: ForestField): ForestTextures {
    return { field, texture: this.rgbaImage(field, true), bank: field.bank ? this.rgbaImage({ n: field.n, rgba: field.bank }, true) : undefined, beach: field.beach ? this.image(field.beach.n, field.beach.n, 'r8unorm', field.beach.data, 1) : undefined };
  }
  protected override releaseForest(textures: ForestTextures | undefined): void {
    if (!textures) return;
    this.deleteTexture(textures.texture);
    if (textures.bank) this.deleteTexture(textures.bank);
    if (textures.beach) this.deleteTexture(textures.beach);
  }
  protected override uploadOccupation(occupation: ForestOccupation): WebGLTexture {
    return this.rgbaImage(occupation, true);
  }
  protected override uploadLandDetail(detail: LandDetail): WebGLTexture {
    return this.rgbaImage(detail, true);
  }
  protected override uploadMesh(patch: Patch, values: Float32Array): void {
    const buffer = this.device.createBuffer({ label: `patch ${patch.tile.key}`, size: values.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, values.buffer, values.byteOffset, values.byteLength);
    patch.vao = buffer;
    patch.vertices = undefined;
  }
  protected override releaseMesh(patch: Patch): void {
    (patch.vao as GPUBuffer | undefined)?.destroy();
  }
  protected override uploadBillboards(values: Float32Array, atlas?: HTMLCanvasElement): void {
    this.gpuBillboardBuffer?.destroy();
    this.gpuBillboardBuffer = undefined;
    if (!values.length) return;
    this.gpuBillboardBuffer = this.device.createBuffer({ label: 'relief instances', size: values.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.gpuBillboardBuffer, 0, values.buffer, values.byteOffset, values.byteLength);
    if (atlas && this.gpuBillboardAtlas?.source !== atlas) {
      if (this.gpuBillboardAtlas) this.deleteTexture(this.gpuBillboardAtlas.texture);
      this.gpuBillboardAtlas = { source: atlas, texture: this.uploadTexture(atlas) };
    }
    this.pipeline('billboard');
  }
  protected override uploadTrees(values: Float32Array): void {
    this.gpuTreeBuffer?.destroy();
    this.gpuTreeBuffer = undefined;
    if (!values.length) return;
    this.gpuTreeBuffer = this.device.createBuffer({ label: 'near trees', size: values.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.gpuTreeBuffer, 0, values.buffer, values.byteOffset, values.byteLength);
    this.pipeline('tree');
  }
  protected override uploadFungi(values: Float32Array): void {
    this.gpuFungusBuffer?.destroy();
    this.gpuFungusBuffer = undefined;
    if (!values.length) return;
    this.gpuFungusBuffer = this.device.createBuffer({ label: 'underdark mushrooms', size: values.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.gpuFungusBuffer, 0, values.buffer, values.byteOffset, values.byteLength);
    this.pipeline('fungus');
  }
  protected override uploadRoof(mesh: { vertices: Float32Array; indices: Uint32Array } | undefined): void {
    if (this.gpuRoof) {
      this.garbage.push(this.gpuRoof.vertices, this.gpuRoof.indices);
      this.gpuRoof = undefined;
    }
    this.roofCount = mesh?.indices.length ?? 0;
    if (!mesh) return;
    const make = (data: Float32Array | Uint32Array, usage: number, label: string): GPUBuffer => {
      const buffer = this.device.createBuffer({ label, size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
      return buffer;
    };
    this.gpuRoof = { vertices: make(mesh.vertices, GPUBufferUsage.VERTEX, 'cave roof'), indices: make(mesh.indices, GPUBufferUsage.INDEX, 'cave roof indices') };
    this.pipeline('roof');
  }
  private recordRoof(pass: GPURenderPassEncoder, frame: FrameGeometry): void {
    return gpuVegetation.recordRoof(this as unknown as TerrainGpuContext, pass, frame);
  }
  private recordFungi(pass: GPURenderPassEncoder, frame: FrameGeometry): void {
    return gpuVegetation.recordFungi(this as unknown as TerrainGpuContext, pass, frame);
  }
  private recordTrees(pass: GPURenderPassEncoder, frame: FrameGeometry): void {
    return gpuVegetation.recordTrees(this as unknown as TerrainGpuContext, pass, frame);
  }
  protected override billboardsReady(): boolean {
    return !this.billboardCount || !!this.pipeline('billboard');
  }
  private recordBillboards(pass: GPURenderPassEncoder, frame: FrameGeometry, blend: number): boolean {
    return gpuVegetation.recordBillboards(this as unknown as TerrainGpuContext, pass, frame, blend);
  }

  private ensureTargets(width: number, height: number): NonNullable<Terrain3dGpu['targets']> {
    const samples = this.samples;
    if (this.targets?.width === width && this.targets.height === height && this.targets.samples === samples) return this.targets;
    this.targets?.color.destroy();
    this.targets?.depth.destroy();
    const color = this.device.createTexture({ label: '3d colour', size: [width, height], format: this.gpu.format, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const depth = this.device.createTexture({ label: '3d depth', size: [width, height], format: DEPTH, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    return (this.targets = { width, height, samples, color, colorView: color.createView(), depth, depthView: depth.createView() });
  }
  /** The ground variant once created; meanwhile the last drawn one, or the preview, stands in. */
  private terrainPipeline(): GPURenderPipeline | undefined {
    if (this.useMapShader) return this.pipeline('map');
    const settings = this.groundSettings,
      forest = !!this.forest && !settings?.underdark;
    const target = this.pipeline(groundKey(+!!settings, settings?.renderV2 ?? 0, +forest, +!!settings?.forestBrushes, +!!settings?.underdark));
    this.mark('groundVariant', target ? 'ready' : 'pending');
    if (target) {
      this.lastGroundPipelines.set(this.samples, target);
      return target;
    }
    return settings ? this.pipeline(PREVIEW_GROUND) : (this.lastGroundPipelines.get(this.samples) ?? this.pipeline(PREVIEW_GROUND));
  }
  /** Unlike the live preview, a newly opened view must have its actual material available. */
  async prepareVariant(): Promise<void> {
    const settings = this.groundSettings;
    const key = this.useMapShader ? 'map' : this.groundKeyNow();
    // The view opens on the multisampled ground (frames at rest); the single-sample one follows in the background.
    await this.gpu.settled(key, SAMPLES);
    this.gpu.pipeline(key, 1);
  }
  /** Brush atlas (bindForestBrushes): a 1×1 placeholder until a brush look first needs the full array. */
  private brushAtlas(enabled: boolean): GPUTextureView {
    if (enabled && !this.brushes.full) {
      const pixels = unzlibSync(Uint8Array.from(atob(atlas.zlib), c => c.charCodeAt(0)));
      const layers = atlas.families.length * atlas.variants,
        levels = boxMips(pixels, atlas.size, atlas.size, 2, layers);
      this.brushes.image.texture.destroy();
      this.brushes = {
        image: this.arrayImage(
          atlas.size,
          layers,
          levels.length,
          levels.map(l => l.data),
        ),
        full: true,
      };
    }
    return this.brushes.image.view;
  }
  protected override renderFrame(frame: FrameGeometry, w: number, h: number, draws: PatchDraw[]): boolean {
    return gpuFrame.renderFrame(this as unknown as TerrainGpuContext, frame, w, h, draws);
  }
  protected override captureFrame(near: number, far: number): Promise<{ color: HTMLCanvasElement; depth: HTMLCanvasElement }> {
    return gpuCapture.captureFrame(this as unknown as TerrainGpuContext, near, far);
  }

  protected override disposeBackend(): void {
    this.gpu.listeners.delete(this.redraw);
    this.gpu.lostListeners.delete(this.deviceLost);
    this.releaseForest(this.forest);
    if (this.occupation) this.deleteTexture(this.occupation.texture);
    if (this.landDetail) this.deleteTexture(this.landDetail.texture);
    this.gpuFungusBuffer?.destroy();
    this.gpuRoof?.vertices.destroy();
    this.gpuRoof?.indices.destroy();
    this.gpuBillboardBuffer?.destroy();
    if (this.gpuBillboardAtlas) this.deleteTexture(this.gpuBillboardAtlas.texture);
    for (const texture of this.raisedMaterials.values()) this.deleteTexture(texture);
    this.raisedMaterials.clear();
    for (const texture of [this.material, this.macroTexture, this.caveTexture, this.blank, this.emptyUnfilterable, this.brushes.image, this.ring?.image]) if (texture) this.deleteTexture(texture);
    this.fullIndices.buffer.destroy();
    for (const indices of this.patchIndexCache.values()) indices.buffer.destroy();
    this.patchIndexCache.clear();
    this.targets?.color.destroy();
    this.targets?.depth.destroy();
    this.targets = undefined;
    this.params.destroy();
    this.seamPool.destroy();
    this.context.unconfigure();
  }
}
