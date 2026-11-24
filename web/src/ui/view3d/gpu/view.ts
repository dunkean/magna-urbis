/**
 * WebGPU backend of the 3D terrain view: Terrain3d (terrainView.ts) with its backend hooks overridden, and the building
 * pass (gpu/buildings.ts) likewise. Quadtree, LOD morphs, tile loading, stitching, picking and camera stay in the parts;
 * this view only uploads resources and records the frame. The shaders are Terrain3d's and UrbanBuildingPass's,
 * translated to WGSL by web/scripts/wgsl_shaders_3d.ts (terrain3dWgsl.generated.ts). Created by gpu/preparation.ts.
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
 * Textures and meshes travel through the parts' WebGL-typed fields as this backend's own objects (GpuImage,
 * GPUBuffer): those WebGL types are empty interfaces, opaque to the parts.
 */
import { boxMips, rasterMips } from '../../boxMips';
import { unzlibSync } from 'fflate';
import atlas from '../../../render/assets/fantasy/forest-brushes.json';
import type { ForestField, ForestOccupation, LandDetail } from '../../../../../rust/bridge/terrainForest';
import { waterSeasonUniforms } from '../../../render/seasonPalette';
import { freshWater3d } from '../../../render/waterPalette';
import { shoreRingPixels } from '../../../../../rust/bridge/terrainForestBeach';
import { renderV2GlacierSources } from '../../../../../rust/bridge/terrainRenderV2';
import { renderV2ZoneUniform, setSeasonCalendarGpu } from '../../../../../rust/bridge/terrainRenderV2Zones';
import { terrainLights } from '../../../render/terrainLighting';
import { groundCoverActive } from '../../../render/materialLook';
import { Terrain3d } from '../terrainView';
import { paddedMaterial } from '../terrain/materialImages';
import { fullPatchIndices, patchClipKey, clippedPatchIndices } from '../terrain/patchIndices';
import type { FrameGeometry, Patch, PatchDraw, Terrain3dOptions, Terrain3dTile, Terrain3dTileContent } from '../terrain/contract';
import { buildingFrame } from '../gl/renderer';
import type { ForestTextures } from '../../terrain/gl/forest';
import type { HeightLayer } from '../../terrain/contract';
import * as WGSL from '../../terrain3dWgsl.generated';
import { halfFloats, type CavernField } from '../../../render/underdarkCavern';
import { Gpu3d, groundKey, PREVIEW_GROUND } from './device';
import { Pool, Params } from './parameters';
import { GpuImage, mipCount, image } from './images';
import { SAMPLES, DEPTH, TERRAIN_TEXTURES, T, type TerrainTexture } from './layouts';
import { UrbanBuildingPassGpu } from './buildings';
import { GpuInstances } from './instances';
import { captureGpuFrame } from './capture';

type Targets = { width: number; height: number; samples: number; color: GPUTexture; colorView: GPUTextureView; depth: GPUTexture; depthView: GPUTextureView };

export class Terrain3dGpu extends Terrain3d {
  private gpu!: Gpu3d;
  private device!: GPUDevice;
  private canvasContext!: GPUCanvasContext;
  private params!: Pool;
  private seamPool!: Pool;
  private instances!: GpuInstances;
  private readonly terrainParams = new Params(WGSL.WGSL3D_PARAMS.terrain);
  private readonly skyParams = new Params(WGSL.WGSL3D_PARAMS.sky);
  private fullIndices!: { buffer: GPUBuffer; count: number };
  private patchIndexCache = new Map<string, { buffer: GPUBuffer; count: number }>();
  /** Buffers released while a frame is being recorded, destroyed after its submit. */
  private garbage: GPUBuffer[] = [];
  private targets?: Targets;
  private blank!: GpuImage;
  private emptyUnfilterable!: GpuImage;
  private brushes!: { image: GpuImage; full: boolean };
  private ring?: { layer: object; revision: number; image: GpuImage; x: number; y: number; width: number };
  private lastGroundPipelines = new Map<number, GPURenderPipeline>();
  /** One sample while moving, once the single-sample ground exists: the multisampled one (the one shown at rest)
   * is compiled first, and until the other is ready the moving frames keep it rather than a stand-in material. */
  private get samples(): number {
    if (!(this.context.frameInteracting || this.context.frameQuality > 0)) return SAMPLES;
    if (this.context.useMapShader) return 1;
    const key = this.groundKeyNow();
    if (this.gpu.ready(key, 1)) return 1;
    this.gpu.pipeline(key, 1);
    return SAMPLES;
  }
  private groundKeyNow(): string {
    const settings = this.context.ground;
    return groundKey(+!!settings, settings?.renderV2 ?? 0, +(!!this.parts.forest.textures && !settings?.underdark), +!!settings?.forestBrushes, +!!settings?.underdark);
  }
  private pipeline(key: string): GPURenderPipeline | undefined {
    return this.gpu.pipeline(key, this.samples);
  }
  private readonly redraw = (): void => this.context.request();
  private onDeviceLost?: () => void;
  private readonly deviceLost = (): void => {
    const callback = this.onDeviceLost;
    this.onDeviceLost = undefined;
    if (!this.context.disposed) callback?.();
  };

  constructor(canvas: HTMLCanvasElement, gpu: Gpu3d, onChange: () => void, onRender?: () => void, options: Terrain3dOptions = {}, onDeviceLost?: () => void) {
    super(canvas, onChange, onRender, options);
    this.onDeviceLost = onDeviceLost;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU indisponible sur ce canevas.');
    const { tiles, surface, cavern, buildings } = this.parts;
    this.gpu = gpu;
    this.device = gpu.device;
    this.canvasContext = context;
    this.context.maxFramebufferDimension = this.device.limits.maxTextureDimension2D;
    context.configure({ device: this.device, format: gpu.format, alphaMode: 'opaque' });
    gpu.listeners.add(this.redraw);
    gpu.lostListeners.add(this.deviceLost);
    this.params = new Pool(this.device, GPUBufferUsage.STORAGE, 256 * 1024, this.device.limits.minStorageBufferOffsetAlignment, '3d parameters');
    this.seamPool = new Pool(this.device, GPUBufferUsage.VERTEX, 4 * 1024 * 1024, 4, '3d seams');
    this.instances = new GpuInstances(gpu, this.context, this.parts, key => this.pipeline(key), this.garbage);
    this.fullIndices = this.indexBuffer(fullPatchIndices());
    this.blank = this.image(1, 1, 'r8unorm', new Uint8Array(4), 1);
    this.emptyUnfilterable = this.image(1, 1, 'r32float', new Float32Array(1), 4);
    this.brushes = { image: this.arrayImage(1, 1, 1, [new Uint8Array([255, 128])]), full: false };
    tiles.material = this.uploadTexture(new Uint8Array([203, 211, 182, 255]));
    surface.macroTexture = this.uploadMacroField(surface.layer);
    cavern.refresh(surface.layer, true);
    buildings.pass = new UrbanBuildingPassGpu(gpu, () => this.context.request());
    buildings.pass.setScene(buildings.shown(), buildings.appearance);
    this.selectTerrainProgram(false);
    this.parts.status.mark('renderer', 'webgpu');
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
  /** Premultiplied RGBA8 with a one-texel border and rendered mipmaps (as the WebGL2 upload). */
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
    this.instances.uploadBillboards(
      values,
      atlas,
      source => this.uploadTexture(source),
      texture => this.deleteTexture(texture),
    );
  }
  protected override uploadTrees(values: Float32Array): void {
    this.instances.uploadTrees(values);
  }
  protected override uploadFungi(values: Float32Array): void {
    this.instances.uploadFungi(values);
  }
  protected override uploadRoof(mesh: { vertices: Float32Array; indices: Uint32Array } | undefined): void {
    this.instances.uploadRoof(mesh);
  }
  protected override billboardsReady(): boolean {
    return !this.parts.billboards.count || !!this.pipeline('billboard');
  }

  private ensureTargets(width: number, height: number): Targets {
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
    if (this.context.useMapShader) return this.pipeline('map');
    const settings = this.context.ground,
      forest = !!this.parts.forest.textures && !settings?.underdark;
    const target = this.pipeline(groundKey(+!!settings, settings?.renderV2 ?? 0, +forest, +!!settings?.forestBrushes, +!!settings?.underdark));
    this.parts.status.mark('groundVariant', target ? 'ready' : 'pending');
    if (target) {
      this.lastGroundPipelines.set(this.samples, target);
      return target;
    }
    return settings ? this.pipeline(PREVIEW_GROUND) : (this.lastGroundPipelines.get(this.samples) ?? this.pipeline(PREVIEW_GROUND));
  }
  /** Unlike the live preview, a newly opened view must have its actual material available. */
  async prepareVariant(): Promise<void> {
    const key = this.context.useMapShader ? 'map' : this.groundKeyNow();
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

  /** Sky, ground patches, buildings and instances of one frame in one pass; returns whether something is still preparing. */
  protected override renderFrame(frame: FrameGeometry, w: number, h: number, draws: PatchDraw[]): boolean {
    const context = this.context,
      device = this.device,
      gpu = this.gpu,
      { surface, rig, forest, cavern, tiles, trees, fungi, billboards, buildings } = this.parts,
      layer = surface.layer!,
      c = rig.camera,
      settings = context.ground;
    billboards.prepare();
    trees.prepare(frame);
    fungi.prepare();
    const raisedBlend = billboards.raisedBlend(frame);
    const targets = this.ensureTargets(w, h);
    this.params.begin();
    this.seamPool.begin();
    const encoder = device.createCommandEncoder({ label: 'terrain 3d' });
    const pass = encoder.beginRenderPass({
      label: 'terrain 3d',
      colorAttachments: [
        {
          view: targets.samples > 1 ? targets.colorView : this.canvasContext.getCurrentTexture().createView(),
          resolveTarget: targets.samples > 1 ? this.canvasContext.getCurrentTexture().createView() : undefined,
          clearValue: [0, 0, 0, 1],
          loadOp: 'clear',
          storeOp: targets.samples > 1 ? 'discard' : 'store',
        },
      ],
      depthStencilAttachment: { view: targets.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    const sky = this.pipeline('sky');
    if (sky) {
      this.skyParams.set('height', h);
      this.skyParams.set('uNight', settings?.underdark ? 2 : context.look.ambience === 'night' ? 1 : 0);
      const slot = this.params.alloc(this.skyParams.bytes);
      pass.setPipeline(sky);
      pass.setBindGroup(0, device.createBindGroup({ layout: gpu.layouts.sky, entries: [{ binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: this.skyParams.bytes.byteLength } }] }));
      pass.draw(3);
    }
    const pipeline = this.terrainPipeline(),
      p = this.terrainParams,
      empty = this.blank.view;
    p.set('proceduralPreview', settings ? 1 : 0);
    const textures: Partial<Record<TerrainTexture, GPUTextureView>> = { macroField: image(surface.macroTexture).view };
    p.set('uQuality', context.frameQuality);
    p.setArray('matrix', frame.matrix);
    p.set('exaggeration', c.exaggeration);
    p.setArray('eye', frame.eye);
    p.set('raisedBlend', raisedBlend);
    p.set('fogDistance', rig.fogDistance());
    p.set('showTileBounds', context.tileBounds ? 1 : 0);
    p.set('uNight', context.look.ambience === 'night' ? 1 : 0);
    p.set('uNaturalWater', context.look.waterLook === 'natural' ? 1 : 0);
    p.set('displayWaterVisible', context.look.waterVisible === false ? 0 : 1);
    p.set('displayWaterBand', layer.width * 0.016);
    p.setArray('uWaterSeason', waterSeasonUniforms(settings?.v2Season, settings?.climateZone, settings?.v2Calendar));
    p.setArray('uFreshWater', freshWater3d(settings));
    const canopy = settings ?? forest.settings;
    if (canopy) {
      const lights = terrainLights(canopy.lighting);
      p.set('uMaterialSeed', canopy.seed >>> 0);
      p.set('uMaterialClimate', canopy.climate.temperature, canopy.climate.precipitation);
      p.setArray('uForestTrees', trees.forestTreesUniform(frame));
      p.set('groundEye', c.x + frame.eye[0], (frame.targetHeight + frame.eye[1]) / c.exaggeration, c.y + frame.eye[2]);
      p.set('groundLight', lights.primary[0], lights.primary[2], lights.primary[1]);
      p.set('uGroundCover', lights.primary[0], lights.primary[2], lights.primary[1], groundCoverActive(settings?.renderV2 ?? 0, !!settings?.forestBrushes, !!settings && !!forest.textures, context.look.groundCover));
      p.set('groundLight2', lights.secondary[0], lights.secondary[2], lights.secondary[1]);
      p.set('groundStrength', canopy.lighting.enabled ? canopy.lighting.strength : 0);
      p.set('macroRect', layer.x, layer.y, layer.width);
      p.set('macroN', layer.n);
    }
    if (settings) {
      const v2 = settings.renderV2 ?? 0;
      p.set('uV2WaterVisible', settings.waterVisible === false ? 0 : 1);
      p.setArray('uV2GlacierSources', renderV2GlacierSources(layer, settings.climate));
      p.set('uV2Season', settings.v2Season ?? 0.5);
      setSeasonCalendarGpu(p, settings.climateZone, settings.v2Calendar);
      p.set('uMaterialZone', renderV2ZoneUniform(settings.climateZone));
      // Shore ring and relief light (rgba16float: shore distance, openness, sky occlusion, horizon tangent toward
      // the light); a new light azimuth re-bakes the last channel off the frame path and bumps the revision.
      const pixels = v2 > 0 ? shoreRingPixels(layer, settings.lighting.azimuth, this.redraw) : undefined;
      if (pixels && (this.ring?.layer !== layer || this.ring.revision !== pixels.revision)) {
        if (this.ring) this.deleteTexture(this.ring.image);
        const grid = pixels.grid;
        this.ring = { layer, revision: pixels.revision, image: this.image(grid.n, grid.n, 'rgba16float', pixels.half, 8), x: grid.x, y: grid.y, width: grid.width };
      }
      const ring = pixels?.grid;
      p.set('uShoreRingRect', ring?.x ?? 0, ring?.y ?? 0, ring?.width ?? 1);
      const contours = settings.contours;
      p.set('groundContours', contours ? 1 : 0);
      p.set('groundContourStep', contours?.step ?? 1);
      p.set('groundContourOpacity', contours?.opacity ?? 0);
      p.set('groundFlatSlope', contours?.flat ? 0.004 : 0.012);
      if (contours) {
        const value = contours.color.replace('#', '');
        p.set('groundContourColor', parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
      }
    }
    textures.uShoreRing = this.ring?.image.view ?? empty;
    const field = forest.textures,
      applied = forest.occupation,
      beach = field?.field.beach;
    textures.uForestField = field ? image(field.texture).view : empty;
    p.set('uForestRect', field?.field.x ?? 0, field?.field.y ?? 0, field?.field.width ?? 1);
    textures.uForestBank = field?.bank ? image(field.bank).view : empty;
    p.set('uHasForestBank', field?.bank ? 1 : 0);
    p.set('uForestBankDensity', field?.field.bankDensity ?? 1);
    textures.uForestBeach = field?.beach ? image(field.beach).view : empty;
    p.set('uHasForestBeach', field?.beach ? 1 : 0);
    p.set('uForestBeachRect', beach?.x ?? 0, beach?.y ?? 0, beach?.width ?? 1);
    textures.uOccupation = applied ? image(applied.texture).view : empty;
    p.set('uHasOccupation', applied ? 1 : 0);
    p.set('uOccupationRect', applied?.data.x ?? 0, applied?.data.y ?? 0, applied?.data.width ?? 1);
    p.set('uOccupationN', applied?.data.n ?? 1);
    p.set('uPaperMap', settings?.paperMap ? 1 : 0);
    // Underdark: the cave mask in the forest beach slot (as the WebGL2 frame), forest off.
    p.set('uHasCave', settings?.underdark && cavern.texture ? 1 : 0);
    p.setArray('uCavern', cavern.parameters());
    p.setArray('uFungusArea', fungi.area());
    {
      const lamps = cavern.townGlowUniform();
      p.setArray('uCaveLamps', lamps.values);
      p.set('uCaveLampCount', lamps.count);
    }
    {
      const g = settings?.townGlow ?? new Float32Array(0),
        a = new Float32Array(64);
      for (let k = 0; k < Math.min(16, (g.length / 3) | 0); k++) a.set(g.subarray(k * 3, k * 3 + 3), k * 4);
      p.setArray('uTownGlow', a);
      p.set('uTownGlowCount', Math.min(16, (g.length / 3) | 0));
    }
    {
      const f = settings?.farmBeds ?? new Float32Array(128);
      p.setArray('uFarmBeds', f);
      let n = 0;
      for (let k = 0; k < 32; k++) if (f[k * 4 + 2] > 0) n = k + 1;
      p.set('uFarmBedCount', n);
    }
    if (settings?.underdark) {
      textures.uForestBeach = cavern.texture ? image(cavern.texture).view : empty;
      p.set('uHasForestBeach', 0);
      p.set('uForestBeachRect', layer.x, layer.y, layer.width);
    }
    const detail = forest.landDetail;
    textures.uLandDetail = detail ? image(detail.texture).view : empty;
    p.set('uHasLandDetail', detail ? 1 : 0);
    p.set('uLandDetailRect', detail?.data.x ?? 0, detail?.data.y ?? 0, detail?.data.width ?? 1);
    p.set('uLandDetailN', detail?.data.n ?? 1);
    textures.uForestBrushAtlas = this.brushAtlas(!!settings?.forestBrushes);
    if (pipeline) {
      pass.setPipeline(pipeline);
      for (const draw of draws) {
        const { patch, material } = draw,
          tile = patch.tile;
        p.set('patchOffset', tile.x - c.x, patch.heightOrigin * c.exaggeration - frame.targetHeight, tile.y - c.y);
        p.set('physicalOrigin', tile.x, patch.heightOrigin, tile.y);
        p.set('patchRect', tile.x, tile.y, tile.width);
        p.set('morph', draw.morph);
        p.setArray('textureRect', draw.textureRect);
        p.setArray('previousRect', draw.previousRect);
        p.set('textureBlend', material.blend);
        textures.material = image(material.to.texture).view;
        textures.previousMaterial = image(material.from.texture).view;
        for (const [ref, name, flag] of [
          [material.to, 'drapedMaterial', 'hasRaisedMaterial'],
          [material.from, 'previousDrapedMaterial', 'hasPreviousRaisedMaterial'],
        ] as const) {
          const raised = tiles.raised.get(ref.texture);
          textures[name] = raised ? image(raised).view : empty;
          p.set(flag, raised ? 1 : 0);
        }
        for (const [ref, name] of [
          [material.to, 'canopyWater'],
          [material.from, 'previousCanopyWater'],
        ] as const) {
          const mask = tiles.waterMasks.get(ref.texture);
          textures[name] = mask ? image(mask.texture).view : empty;
          p.set(name === 'canopyWater' ? 'hasCanopyWater' : 'hasPreviousCanopyWater', mask ? 1 : 0);
          p.set(`${name}Rect`, mask?.rect[0] ?? 0, mask?.rect[1] ?? 0, mask?.rect[2] ?? 1);
        }
        for (const [ref, name, flag] of [
          [material.to, 'semanticTile', 'hasSemanticTile'],
          [material.from, 'previousSemanticTile', 'hasPreviousSemanticTile'],
        ] as const) {
          const overlay = tiles.semantic.get(ref.texture);
          textures[name] = overlay ? image(overlay.texture).view : empty;
          p.set(flag, overlay?.semantic ? 1 : 0);
          p.setArray(name === 'semanticTile' ? 'semanticRect' : 'previousSemanticRect', tiles.overlayRect(ref, tile));
          p.set(name === 'semanticTile' ? 'hasGroundTile' : 'hasPreviousGroundTile', overlay?.atlas ? 1 : 0);
          p.setArray(name === 'semanticTile' ? 'groundRect' : 'previousGroundRect', tiles.overlayRect(ref, tile, true));
        }
        const slot = this.params.alloc(p.bytes),
          seams = this.seamPool.alloc(draw.correction),
          indices = this.patchIndices(tile, draw.clip);
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout: gpu.layouts.terrain,
            entries: [
              { binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } },
              { binding: 1, resource: gpu.samplers.nearest },
              { binding: 2, resource: gpu.samplers.linear },
              { binding: 3, resource: gpu.samplers.aniso },
              ...TERRAIN_TEXTURES.map(name => ({ binding: T[name], resource: name === 'macroField' ? (textures.macroField ?? this.emptyUnfilterable.view) : (textures[name] ?? empty) })),
            ],
          }),
        );
        pass.setVertexBuffer(0, patch.vao as GPUBuffer);
        pass.setVertexBuffer(1, seams.buffer, seams.offset, draw.correction.byteLength);
        pass.setIndexBuffer(indices.buffer, 'uint16');
        pass.drawIndexed(indices.count);
      }
    }
    const buildingPass = buildings.pass as UrbanBuildingPassGpu;
    buildingPass.target = { pass, params: this.params, samples: this.samples };
    let pending: boolean;
    try {
      pending = buildingPass.draw(buildingFrame(this.parts, settings, frame));
    } finally {
      buildingPass.target = undefined;
    }
    this.instances.recordTrees(pass, this.params, frame);
    this.instances.recordRoof(pass, this.params, frame);
    this.instances.recordFungi(pass, this.params, frame);
    pending = this.instances.recordBillboards(pass, this.params, frame, raisedBlend) || pending;
    pass.end();
    this.params.flush();
    this.seamPool.flush();
    device.queue.submit([encoder.finish()]);
    for (const buffer of this.garbage.splice(0)) buffer.destroy();
    return pending || !pipeline;
  }

  protected override captureFrame(near: number, far: number): Promise<{ color: HTMLCanvasElement; depth: HTMLCanvasElement }> {
    return captureGpuFrame(this.canvas, this.gpu, this.targets, near, far);
  }

  protected override disposeBackend(): void {
    const { forest, tiles, surface, cavern } = this.parts;
    this.gpu.listeners.delete(this.redraw);
    this.gpu.lostListeners.delete(this.deviceLost);
    this.releaseForest(forest.textures);
    if (forest.occupation) this.deleteTexture(forest.occupation.texture);
    if (forest.landDetail) this.deleteTexture(forest.landDetail.texture);
    this.instances.dispose(texture => this.deleteTexture(texture));
    for (const texture of tiles.raised.values()) this.deleteTexture(texture);
    tiles.raised.clear();
    for (const texture of [tiles.material, surface.macroTexture, cavern.texture, this.blank, this.emptyUnfilterable, this.brushes.image, this.ring?.image]) if (texture) this.deleteTexture(texture);
    this.fullIndices.buffer.destroy();
    for (const indices of this.patchIndexCache.values()) indices.buffer.destroy();
    this.patchIndexCache.clear();
    this.targets?.color.destroy();
    this.targets?.depth.destroy();
    this.targets = undefined;
    this.params.destroy();
    this.seamPool.destroy();
    this.canvasContext.unconfigure();
  }
}
