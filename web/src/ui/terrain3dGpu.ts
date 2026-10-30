/**
 * WebGPU backend of the 3D terrain view: Terrain3d (terrain3d.ts) with its GPU hooks overridden, and the
 * building pass (urbanBuilding3d.ts) likewise. Quadtree, LOD morphs, tile loading, stitching, picking and
 * camera stay in Terrain3d; this file only uploads resources and records the frame. The shaders are
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
 * Textures and meshes travel through Terrain3d's WebGL-typed fields as this file's own objects (GpuImage,
 * GPUBuffer): those WebGL types are empty interfaces, opaque to Terrain3d.
 */
import { unzlibSync } from 'fflate';
import atlas from '../render/assets/fantasy/forest-brushes.json';
import { shoreRingFor } from '../../../rust/bridge/terrainForestBeach';
import type { ForestField, ForestOccupation } from '../../../rust/bridge/terrainForest';
import { renderV2GlacierSources } from '../../../rust/bridge/terrainRenderV2';
import { renderV2ZoneUniform } from '../../../rust/bridge/terrainRenderV2Zones';
import { terrainLights } from '../render/terrainLighting';
import { MATERIALS, type MaterialImages } from '../render/buildingMaterials';
import { Terrain3d, paddedMaterial, fullPatchIndices, patchClipKey, clippedPatchIndices,
  type FrameGeometry, type Patch, type PatchDraw, type Terrain3dOptions, type Terrain3dTile, type Terrain3dTileContent } from './terrain3d';
import { UrbanBuildingPass, type Batch, type BuildingFrame, type Sector } from './urbanBuilding3d';
import type { ForestTextures, HeightLayer } from './terrainGl';
import * as WGSL from './terrain3dWgsl.generated';

type ParamsLayout = { size: number; fields: Record<string, { offset: number; type: string; count: number }> };
const COMPONENTS: Record<string, number> = { float: 1, int: 1, uint: 1, bool: 1, vec2: 2, ivec2: 2, uvec2: 2, vec3: 3, ivec3: 3, uvec3: 3, vec4: 4, ivec4: 4, uvec4: 4, mat4: 16 };
const ARRAY_STRIDE: Record<string, number> = { float: 4, int: 4, uint: 4, bool: 4, vec2: 8, ivec2: 8, uvec2: 8, vec3: 16, ivec3: 16, uvec3: 16, vec4: 16, ivec4: 16, uvec4: 16, mat4: 64 };

/** CPU image of a program's storage block; unknown names are ignored, as absent GL uniforms are. */
class Params {
  readonly bytes: Uint8Array<ArrayBuffer>;
  private f32: Float32Array; private i32: Int32Array; private u32: Uint32Array;
  constructor(private layout: ParamsLayout) {
    const buffer = new ArrayBuffer(layout.size);
    this.bytes = new Uint8Array(buffer); this.f32 = new Float32Array(buffer); this.i32 = new Int32Array(buffer); this.u32 = new Uint32Array(buffer);
  }
  set(name: string, ...values: number[]): void { this.write(name, values); }
  setArray(name: string, values: ArrayLike<number>): void { this.write(name, values); }
  private write(name: string, values: ArrayLike<number>): void {
    const field = this.layout.fields[name];
    if (!field) return;
    const components = COMPONENTS[field.type], stride = ARRAY_STRIDE[field.type] / 4, elements = Math.max(1, field.count);
    const view = /^(u|uvec)/.test(field.type) ? this.u32 : /^(int|ivec|bool)/.test(field.type) ? this.i32 : this.f32;
    for (let k = 0; k < values.length && k < elements * components; k++) {
      const element = Math.floor(k / components), component = k % components;
      view[field.offset / 4 + element * stride + component] = view === this.u32 ? values[k] >>> 0 : values[k];
    }
  }
}

/** Per-frame upload pool: draws copy their data into chunked staging, written once before the submit. */
class Pool {
  private chunks: { buffer: GPUBuffer; staging: Uint8Array<ArrayBuffer>; used: number }[] = [];
  private at = 0;
  constructor(private device: GPUDevice, private usage: GPUBufferUsageFlags, private chunkSize: number, private align: number, private label: string) {}
  begin(): void { for (const chunk of this.chunks) chunk.used = 0; this.at = 0; }
  alloc(data: ArrayBufferView): { buffer: GPUBuffer; offset: number } {
    const size = data.byteLength, bytes = new Uint8Array(data.buffer, data.byteOffset, size);
    for (;;) {
      let chunk = this.chunks[this.at];
      if (!chunk) {
        const capacity = Math.max(this.chunkSize, Math.ceil(size / 4) * 4);
        chunk = { buffer: this.device.createBuffer({ label: this.label, size: capacity, usage: this.usage | GPUBufferUsage.COPY_DST }), staging: new Uint8Array(capacity), used: 0 };
        this.chunks.push(chunk);
      }
      const offset = Math.ceil(chunk.used / this.align) * this.align;
      if (offset + size <= chunk.staging.length) { chunk.staging.set(bytes, offset); chunk.used = offset + size; return { buffer: chunk.buffer, offset }; }
      this.at++;
    }
  }
  flush(): void {
    for (let i = 0; i <= this.at && i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      if (chunk.used) this.device.queue.writeBuffer(chunk.buffer, 0, chunk.staging, 0, Math.ceil(chunk.used / 4) * 4);
    }
  }
  destroy(): void { for (const chunk of this.chunks) chunk.buffer.destroy(); this.chunks = []; }
}

/** Box-filtered mip chain of an 8-bit image, as glGenerateMipmap (forest rasters, brush atlas). */
function boxMips(data: Uint8Array, width: number, height: number, channels: number, layers = 1): { data: Uint8Array; width: number; height: number }[] {
  const levels = [{ data, width, height }];
  while (width > 1 || height > 1) {
    const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), previous = levels[levels.length - 1].data, next = new Uint8Array(w * h * channels * layers);
    for (let l = 0; l < layers; l++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < channels; c++) {
      const x0 = Math.min(width - 1, 2 * x), x1 = Math.min(width - 1, 2 * x + 1), y0 = Math.min(height - 1, 2 * y), y1 = Math.min(height - 1, 2 * y + 1);
      const at = (px: number, py: number): number => previous[((l * height + py) * width + px) * channels + c];
      next[((l * h + y) * w + x) * channels + c] = (at(x0, y0) + at(x1, y0) + at(x0, y1) + at(x1, y1) + 2) >> 2;
    }
    levels.push({ data: next, width: w, height: h }); width = w; height = h;
  }
  return levels;
}
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
/** IEEE half of a float (round toward zero), for the RG16F shore ring. */
function toHalf(v: number): number {
  f32[0] = v; const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return e < -10 ? s : s | ((m | 0x800000) >> (14 - e));
  return e >= 31 ? s | 0x7bff : s | (e << 10) | (m >> 13);
}
const mipCount = (width: number, height: number): number => Math.floor(Math.log2(Math.max(width, height, 1))) + 1;

const SAMPLES = 4, DEPTH: GPUTextureFormat = 'depth32float';
const T = WGSL.WGSL3D_TEXTURES;
const TERRAIN_TEXTURES = ['material', 'previousMaterial', 'macroField', 'uShoreRing', 'canopyWater', 'previousCanopyWater',
  'uForestField', 'uForestBank', 'uOccupation', 'uForestBeach', 'uForestBrushAtlas'] as const;
type TerrainTexture = typeof TERRAIN_TEXTURES[number];
const PATCH_BUFFERS: GPUVertexBufferLayout[] = [
  { arrayStride: 40, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' },
    { shaderLocation: 2, offset: 20, format: 'float32x2' }, { shaderLocation: 3, offset: 28, format: 'float32' }, { shaderLocation: 4, offset: 32, format: 'float32x2' }] },
  { arrayStride: 12, attributes: [{ shaderLocation: 5, offset: 0, format: 'float32x3' }] },
];
const BUILDING_BUFFERS: Record<'color' | 'tex', GPUVertexBufferLayout[]> = {
  color: [{ arrayStride: 36, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x3' }] }],
  tex: [{ arrayStride: 36, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32' }] }],
};
/** Mipmaps: each level is drawn from the previous one with bilinear taps at the 2×2 block centres. */
const MIP_WGSL = `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
struct Varying { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Varying {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return Varying(vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0), vec2<f32>(p.x, 1.0 - p.y));
}
@fragment fn fs(v: Varying) -> @location(0) vec4<f32> { return textureSampleLevel(source, linearSampler, v.uv, 0.0); }`;
/** Illustration depth: sample 0 of the multisampled depth buffer, as a float target that can be read back. */
const DEPTH_WGSL = `
@group(0) @binding(0) var depth: texture_depth_multisampled_2d;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> { return vec4<f32>(textureLoad(depth, vec2<i32>(p.xy), 0), 0.0, 0.0, 1.0); }`;

export interface GpuImage { texture: GPUTexture; view: GPUTextureView }
const image = (texture: WebGLTexture): GpuImage => texture as GpuImage;
type Entry = { pipeline?: GPURenderPipeline; failed?: boolean };
const groundKey = (ground: number, v2: number, forest: number, brushes: number): string => `ground.${ground}.${v2}.${forest}.${brushes}`;
const PREVIEW_GROUND = groundKey(0, 0, 0, 0);

/** Device-wide objects of the 3D view: modules, layouts, samplers, pipelines. */
class Gpu3d {
  readonly format = navigator.gpu.getPreferredCanvasFormat();
  readonly modules: Record<string, GPUShaderModule> = {};
  readonly layouts: Record<'terrain' | 'sky' | 'building', GPUBindGroupLayout>;
  readonly pipelineLayouts: Record<'terrain' | 'sky' | 'building', GPUPipelineLayout>;
  readonly samplers: { nearest: GPUSampler; linear: GPUSampler; aniso: GPUSampler; repeat: GPUSampler };
  readonly mip: GPUShaderModule; readonly depth: GPUShaderModule;
  private pipelines = new Map<string, Entry>();
  readonly listeners = new Set<() => void>();
  lost = false;
  constructor(readonly device: GPUDevice) {
    for (const key of ['terrainVs', 'groundFs', 'mapFs', 'skyVs', 'skyFs', 'buildingColorVs', 'buildingColorFs', 'buildingTexVs', 'buildingTexFs'] as const)
      this.modules[key] = device.createShaderModule({ label: key, code: WGSL[key] });
    this.mip = device.createShaderModule({ label: 'mipmaps', code: MIP_WGSL });
    this.depth = device.createShaderModule({ label: 'depth readback', code: DEPTH_WGSL });
    const linear = { minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear' } as const;
    this.samplers = {
      nearest: device.createSampler({ label: 'nearest' }),
      linear: device.createSampler({ label: 'linear', ...linear }),
      aniso: device.createSampler({ label: 'material', ...linear, maxAnisotropy: 8 }),
      repeat: device.createSampler({ label: 'building materials', ...linear, maxAnisotropy: 4, addressModeU: 'repeat', addressModeV: 'repeat' }),
    };
    const F = GPUShaderStage.FRAGMENT, both = GPUShaderStage.VERTEX | F;
    const texture = (name: string): GPUBindGroupLayoutEntry => ({ binding: T[name], visibility: F,
      texture: name === 'macroField' ? { sampleType: 'unfilterable-float' } : name === 'uForestBrushAtlas' || name === 'albedoTex' || name === 'normalTex' ? { sampleType: 'float', viewDimension: '2d-array' } : { sampleType: 'float' } });
    const sampler = (binding: number, type: GPUSamplerBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility: F, sampler: { type } });
    this.layouts = {
      terrain: device.createBindGroupLayout({ label: 'terrain 3d', entries: [{ binding: 0, visibility: both, buffer: { type: 'read-only-storage' } },
        sampler(1, 'non-filtering'), sampler(2, 'filtering'), sampler(3, 'filtering'), ...TERRAIN_TEXTURES.map(texture)] }),
      sky: device.createBindGroupLayout({ label: 'sky', entries: [{ binding: 0, visibility: both, buffer: { type: 'read-only-storage' } }] }),
      building: device.createBindGroupLayout({ label: 'buildings 3d', entries: [{ binding: 0, visibility: both, buffer: { type: 'read-only-storage', hasDynamicOffset: true } },
        sampler(4, 'filtering'), texture('albedoTex'), texture('normalTex')] }),
    };
    this.pipelineLayouts = Object.fromEntries(Object.entries(this.layouts).map(([name, layout]) =>
      [name, device.createPipelineLayout({ label: name, bindGroupLayouts: [layout] })])) as Gpu3d['pipelineLayouts'];
  }
  /** A pipeline once created; its asynchronous creation starts on first request. */
  pipeline(key: string): GPURenderPipeline | undefined {
    let entry = this.pipelines.get(key);
    if (!entry) {
      const created: Entry = entry = {}, started = performance.now();
      this.pipelines.set(key, created);
      this.device.createRenderPipelineAsync(this.descriptor(key)).then(pipeline => {
        console.debug(`WebGPU 3D pipeline ${key}: ${Math.round(performance.now() - started)} ms`);
        created.pipeline = pipeline; for (const listener of this.listeners) listener();
      }, error => { created.failed = true; console.error(`WebGPU 3D pipeline ${key}:`, error); });
    }
    return entry.pipeline;
  }
  async adopt(key: string): Promise<void> { this.pipelines.set(key, { pipeline: await this.device.createRenderPipelineAsync(this.descriptor(key)) }); }
  private descriptor(key: string): GPURenderPipelineDescriptor {
    const multisample = { count: SAMPLES }, target = [{ format: this.format }];
    const depthStencil = (write: boolean): GPUDepthStencilState => ({ format: DEPTH, depthWriteEnabled: write, depthCompare: write ? 'less-equal' : 'always' });
    if (key === 'sky') return { label: key, layout: this.pipelineLayouts.sky, vertex: { module: this.modules.skyVs, entryPoint: 'main' },
      fragment: { module: this.modules.skyFs, entryPoint: 'main', targets: target }, depthStencil: depthStencil(false), multisample };
    if (key === 'buildingColor' || key === 'buildingTex') {
      const kind = key === 'buildingTex' ? 'tex' : 'color', vs = key === 'buildingTex' ? 'buildingTexVs' : 'buildingColorVs', fs = key === 'buildingTex' ? 'buildingTexFs' : 'buildingColorFs';
      return { label: key, layout: this.pipelineLayouts.building, vertex: { module: this.modules[vs], entryPoint: 'main', buffers: BUILDING_BUFFERS[kind] },
        fragment: { module: this.modules[fs], entryPoint: 'main', targets: target }, depthStencil: depthStencil(true), multisample };
    }
    const vertex: GPUVertexState = { module: this.modules.terrainVs, entryPoint: 'main', buffers: PATCH_BUFFERS };
    if (key === 'map') return { label: key, layout: this.pipelineLayouts.terrain, vertex,
      fragment: { module: this.modules.mapFs, entryPoint: 'main', targets: target }, depthStencil: depthStencil(true), multisample };
    const [ground, v2, forest, brushes] = key.split('.').slice(1).map(Number), o = WGSL.WGSL3D_OVERRIDES;
    return { label: key, layout: this.pipelineLayouts.terrain, vertex, depthStencil: depthStencil(true), multisample,
      fragment: { module: this.modules.groundFs, entryPoint: 'main', targets: target,
        constants: { [o.groundEnabled]: ground, [o.uRenderV2]: v2, [o.uForest]: forest, [o.uForestBrushes]: brushes } } };
  }
  private mipPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  /** Fills mip levels 1.. of every layer of a 2D (array) texture from level 0. */
  generateMipmaps(texture: GPUTexture): void {
    if (texture.mipLevelCount < 2) return;
    let pipeline = this.mipPipelines.get(texture.format);
    if (!pipeline) this.mipPipelines.set(texture.format, pipeline = this.device.createRenderPipeline({ label: `mipmaps ${texture.format}`, layout: 'auto',
      vertex: { module: this.mip, entryPoint: 'vs' }, fragment: { module: this.mip, entryPoint: 'fs', targets: [{ format: texture.format }] } }));
    const encoder = this.device.createCommandEncoder({ label: 'mipmaps' });
    for (let layer = 0; layer < texture.depthOrArrayLayers; layer++) for (let level = 1; level < texture.mipLevelCount; level++) {
      const view = (mip: number): GPUTextureView => texture.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: view(level), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: view(level - 1) }, { binding: 1, resource: this.samplers.linear }] }));
      pass.draw(3); pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
  }
  private depthPipeline?: GPURenderPipeline;
  depthReadback(): GPURenderPipeline {
    return this.depthPipeline ??= this.device.createRenderPipeline({ label: 'depth readback', layout: 'auto',
      vertex: { module: this.depth, entryPoint: 'vs' }, fragment: { module: this.depth, entryPoint: 'fs', targets: [{ format: 'r32float' }] } });
  }
}

let shared: Promise<Gpu3d | undefined> | undefined;
let ready: Gpu3d | undefined;
/** Prepares the device, the modules and the stand-in pipelines once per page; resolves whether the WebGPU
 * 3D view is usable (no context is taken: a failure keeps the WebGL2 path available). */
export function prepareTerrain3dGpu(forced: boolean): Promise<boolean> {
  shared ??= (async () => {
    if (!navigator.gpu) return undefined;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter || (adapter.info?.isFallbackAdapter && !forced)) return undefined;
    const device = await adapter.requestDevice({ label: 'terrain 3d', requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D } });
    try {
      const gpu = new Gpu3d(device);
      device.lost.then(info => {
        gpu.lost = true; if (ready === gpu) ready = undefined;
        if (info.reason === 'destroyed') return;
        shared = undefined; console.warn('WebGPU 3D device lost:', info.message);
        for (const listener of gpu.listeners) listener();
      });
      device.addEventListener('uncapturederror', event => console.error('WebGPU 3D:', (event as GPUUncapturedErrorEvent).error.message));
      for (const [key, module] of Object.entries(gpu.modules)) {
        const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
        if (errors.length) throw new Error(`WGSL ${key}: ${errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
      }
      // Throws (GPUPipelineError) if the translated shaders or the layouts are refused.
      await Promise.all(['sky', 'map', PREVIEW_GROUND, 'buildingColor', 'buildingTex'].map(key => gpu.adopt(key)));
      return ready = gpu;
    } catch (error) { device.destroy(); throw error; }
  })().catch(error => { shared = undefined; throw error; });
  return shared.then(gpu => !!gpu);
}

/** The WebGPU 3D view on `canvas`, or undefined while (or when) prepareTerrain3dGpu has no device. */
export function createTerrain3dGpu(canvas: HTMLCanvasElement, onChange: () => void, onRender?: () => void, options: Terrain3dOptions = {}): Terrain3d | undefined {
  return ready && !ready.lost ? new Terrain3dGpu(canvas, ready, onChange, onRender, options) : undefined;
}

class Terrain3dGpu extends Terrain3d {
  private gpu!: Gpu3d;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private params!: Pool;
  private seamPool!: Pool;
  private readonly terrainParams = new Params(WGSL.WGSL3D_PARAMS.terrain);
  private readonly skyParams = new Params(WGSL.WGSL3D_PARAMS.sky);
  private fullIndices!: { buffer: GPUBuffer; count: number };
  private patchIndexCache = new Map<string, { buffer: GPUBuffer; count: number }>();
  /** Buffers released while a frame is being recorded, destroyed after its submit. */
  private garbage: GPUBuffer[] = [];
  private targets?: { width: number; height: number; color: GPUTexture; colorView: GPUTextureView; depth: GPUTexture; depthView: GPUTextureView };
  private blank!: GpuImage; private emptyUnfilterable!: GpuImage;
  private brushes!: { image: GpuImage; full: boolean };
  private ring?: { layer: object; image: GpuImage; x: number; y: number; width: number };
  private lastGroundPipeline?: GPURenderPipeline;
  private readonly redraw = (): void => this.request();

  constructor(canvas: HTMLCanvasElement, gpu: Gpu3d, onChange: () => void, onRender?: () => void, options: Terrain3dOptions = {}) {
    super(canvas, onChange, onRender, options);
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU indisponible sur ce canevas.');
    this.gpu = gpu; this.device = gpu.device; this.context = context;
    context.configure({ device: this.device, format: gpu.format, alphaMode: 'opaque' });
    gpu.listeners.add(this.redraw);
    this.params = new Pool(this.device, GPUBufferUsage.STORAGE, 256 * 1024, this.device.limits.minStorageBufferOffsetAlignment, '3d parameters');
    this.seamPool = new Pool(this.device, GPUBufferUsage.VERTEX, 4 * 1024 * 1024, 4, '3d seams');
    this.fullIndices = this.indexBuffer(fullPatchIndices());
    this.blank = this.image(1, 1, 'r8unorm', new Uint8Array(4), 1);
    this.emptyUnfilterable = this.image(1, 1, 'r32float', new Float32Array(1), 4);
    this.brushes = { image: this.arrayImage(1, 1, 1, [new Uint8Array([255, 128])]), full: false };
    this.material = this.uploadTexture(new Uint8Array([203, 211, 182, 255]));
    this.macroTexture = this.uploadMacroField(this.layer);
    this.buildings = new UrbanBuildingPassGpu(gpu, () => this.request());
    this.buildings.setScene(this.buildingsVisible ? this.buildingScene : undefined, this.buildingAppearance);
    this.selectTerrainProgram(false);
    canvas.dataset.renderer = 'webgpu';
  }
  /** The context is taken by the constructor, once the subclass fields exist. */
  protected override attach(): void {}
  protected override prepareMapShader(): void {}
  protected override contextLost(): boolean { return !!this.gpu?.lost; }

  private image(width: number, height: number, format: GPUTextureFormat, data: ArrayBufferView, bytesPerTexel: number, mips?: ArrayBufferView[]): GpuImage {
    const levels = mips ?? [data];
    const texture = this.device.createTexture({ size: [width, height], format, mipLevelCount: levels.length, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    levels.forEach((level, mip) => {
      const w = Math.max(1, width >> mip), h = Math.max(1, height >> mip);
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
    return this.image(raster.n, raster.n, 'rgba8unorm', raster.rgba, 4, mipmaps ? boxMips(raster.rgba, raster.n, raster.n, 4).map(l => l.data) : undefined);
  }
  private indexBuffer(indices: Uint16Array): { buffer: GPUBuffer; count: number } {
    const buffer = this.device.createBuffer({ label: 'patch indices', size: Math.ceil(indices.byteLength / 4) * 4, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
    new Uint16Array(buffer.getMappedRange()).set(indices); buffer.unmap();
    return { buffer, count: indices.length };
  }
  private patchIndices(tile: Terrain3dTile, clip: Terrain3dTile): { buffer: GPUBuffer; count: number } {
    const key = patchClipKey(tile, clip);
    if (!key) return this.fullIndices;
    let cached = this.patchIndexCache.get(key);
    if (cached) { this.patchIndexCache.delete(key); this.patchIndexCache.set(key, cached); return cached; }
    this.patchIndexCache.set(key, cached = this.indexBuffer(clippedPatchIndices(key)));
    if (this.patchIndexCache.size > 64) {
      const oldest = this.patchIndexCache.keys().next().value!;
      this.garbage.push(this.patchIndexCache.get(oldest)!.buffer); this.patchIndexCache.delete(oldest);
    }
    return cached;
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
    const padded = paddedMaterial(source), width = padded.width, height = padded.height;
    const texture = this.device.createTexture({ label: 'material', size: [width, height], format: 'rgba8unorm', mipLevelCount: mipCount(width, height),
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.device.queue.copyExternalImageToTexture({ source: padded }, { texture, premultipliedAlpha: true }, [width, height]);
    this.gpu.generateMipmaps(texture);
    return { texture, view: texture.createView() } satisfies GpuImage;
  }
  protected override deleteTexture(texture: WebGLTexture): void { image(texture).texture.destroy(); }
  protected override uploadWaterMask(water: NonNullable<Terrain3dTileContent['water']>): WebGLTexture {
    return this.image(water.n, water.n, 'r8unorm', water.alpha, 1);
  }
  protected override uploadForest(field: ForestField): ForestTextures {
    return { field, texture: this.rgbaImage(field, true), bank: field.bank ? this.rgbaImage({ n: field.n, rgba: field.bank }, true) : undefined,
      beach: field.beach ? this.image(field.beach.n, field.beach.n, 'r8unorm', field.beach.data, 1) : undefined };
  }
  protected override releaseForest(textures: ForestTextures | undefined): void {
    if (!textures) return;
    this.deleteTexture(textures.texture); if (textures.bank) this.deleteTexture(textures.bank); if (textures.beach) this.deleteTexture(textures.beach);
  }
  protected override uploadOccupation(occupation: ForestOccupation): WebGLTexture { return this.rgbaImage(occupation, false); }
  protected override uploadMesh(patch: Patch, values: Float32Array): void {
    const buffer = this.device.createBuffer({ label: `patch ${patch.tile.key}`, size: values.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, values.buffer, values.byteOffset, values.byteLength);
    patch.vao = buffer; patch.vertices = undefined;
  }
  protected override releaseMesh(patch: Patch): void { (patch.vao as GPUBuffer | undefined)?.destroy(); }

  private ensureTargets(width: number, height: number): NonNullable<Terrain3dGpu['targets']> {
    if (this.targets?.width === width && this.targets.height === height) return this.targets;
    this.targets?.color.destroy(); this.targets?.depth.destroy();
    const color = this.device.createTexture({ label: '3d colour', size: [width, height], format: this.gpu.format, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const depth = this.device.createTexture({ label: '3d depth', size: [width, height], format: DEPTH, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    return this.targets = { width, height, color, colorView: color.createView(), depth, depthView: depth.createView() };
  }
  /** The ground variant once created; meanwhile the last drawn one, or the preview, stands in. */
  private terrainPipeline(): GPURenderPipeline | undefined {
    if (this.useMapShader) return this.gpu.pipeline('map');
    const settings = this.groundSettings, forest = !!settings && !!this.forest;
    const target = this.gpu.pipeline(groundKey(+!!settings, settings?.renderV2 ?? 0, +forest, +!!settings?.forestBrushes));
    this.canvas.dataset.groundVariant = target ? 'ready' : 'pending';
    if (target) return this.lastGroundPipeline = target;
    return this.lastGroundPipeline ?? this.gpu.pipeline(PREVIEW_GROUND);
  }
  /** Brush atlas (bindForestBrushes): a 1×1 placeholder until a brush look first needs the full array. */
  private brushAtlas(enabled: boolean): GPUTextureView {
    if (enabled && !this.brushes.full) {
      const pixels = unzlibSync(Uint8Array.from(atob(atlas.zlib), c => c.charCodeAt(0)));
      const layers = atlas.families.length * atlas.variants, levels = boxMips(pixels, atlas.size, atlas.size, 2, layers);
      this.brushes.image.texture.destroy();
      this.brushes = { image: this.arrayImage(atlas.size, layers, levels.length, levels.map(l => l.data)), full: true };
    }
    return this.brushes.image.view;
  }

  protected override renderFrame(frame: FrameGeometry, w: number, h: number, draws: PatchDraw[]): boolean {
    const device = this.device, gpu = this.gpu, layer = this.layer!, c = this.camera, settings = this.groundSettings;
    const targets = this.ensureTargets(w, h);
    this.params.begin(); this.seamPool.begin();
    const encoder = device.createCommandEncoder({ label: 'terrain 3d' });
    const pass = encoder.beginRenderPass({ label: 'terrain 3d',
      colorAttachments: [{ view: targets.colorView, resolveTarget: this.context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: targets.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    const sky = gpu.pipeline('sky');
    if (sky) {
      this.skyParams.set('height', h);
      const slot = this.params.alloc(this.skyParams.bytes);
      pass.setPipeline(sky);
      pass.setBindGroup(0, device.createBindGroup({ layout: gpu.layouts.sky, entries: [{ binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: this.skyParams.bytes.byteLength } }] }));
      pass.draw(3);
    }
    const pipeline = this.terrainPipeline(), p = this.terrainParams, empty = this.blank.view;
    const textures: Partial<Record<TerrainTexture, GPUTextureView>> = { macroField: image(this.macroTexture).view };
    p.setArray('matrix', frame.matrix); p.set('exaggeration', c.exaggeration); p.setArray('eye', frame.eye);
    p.set('fogDistance', Math.max(c.distance * 2, 100)); p.set('showTileBounds', this.tileBounds ? 1 : 0);
    if (settings) {
      const lights = terrainLights(settings.lighting), v2 = settings.renderV2 ?? 0;
      p.set('uV2WaterVisible', settings.waterVisible === false ? 0 : 1); p.setArray('uV2GlacierSources', renderV2GlacierSources(layer, settings.climate));
      p.set('uV2Season', settings.v2Season ?? .5); p.set('uMaterialZone', renderV2ZoneUniform(settings.climateZone));
      p.set('uMaterialSeed', settings.seed >>> 0); p.set('uMaterialClimate', settings.climate.temperature, settings.climate.precipitation);
      p.set('groundEye', c.x + frame.eye[0], (frame.targetHeight + frame.eye[1]) / c.exaggeration, c.y + frame.eye[2]);
      p.set('groundLight', lights.primary[0], lights.primary[2], lights.primary[1]);
      p.set('groundLight2', lights.secondary[0], lights.secondary[2], lights.secondary[1]);
      p.set('groundStrength', settings.lighting.enabled ? settings.lighting.strength : 0);
      p.set('macroRect', layer.x, layer.y, layer.width); p.set('macroN', layer.n);
      if (v2 > 0 && this.ring?.layer !== layer) {
        if (this.ring) this.deleteTexture(this.ring.image);
        const grid = shoreRingFor(layer), half = new Uint16Array(grid.data.length);
        for (let i = 0; i < half.length; i++) half[i] = toHalf(grid.data[i]);
        this.ring = { layer, image: this.image(grid.n, grid.n, 'rg16float', half, 4), x: grid.x, y: grid.y, width: grid.width };
      }
      const ring = v2 > 0 ? shoreRingFor(layer) : undefined;
      p.set('uShoreRingRect', ring?.x ?? 0, ring?.y ?? 0, ring?.width ?? 1);
      const contours = settings.contours;
      p.set('groundContours', contours ? 1 : 0); p.set('groundContourStep', contours?.step ?? 1); p.set('groundContourOpacity', contours?.opacity ?? 0);
      p.set('groundFlatSlope', contours?.flat ? .004 : .012);
      if (contours) { const value = contours.color.replace('#', ''); p.set('groundContourColor', parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255); }
    }
    textures.uShoreRing = this.ring?.image.view ?? empty;
    // Forest (bindForest): enabled with the ground material.
    const field = settings ? this.forest : undefined, applied = field ? this.occupation : undefined, beach = field?.field.beach;
    textures.uForestField = field ? image(field.texture).view : empty;
    p.set('uForestRect', field?.field.x ?? 0, field?.field.y ?? 0, field?.field.width ?? 1);
    textures.uForestBank = field?.bank ? image(field.bank).view : empty;
    p.set('uHasForestBank', field?.bank ? 1 : 0); p.set('uForestBankDensity', field?.field.bankDensity ?? 1);
    textures.uForestBeach = field?.beach ? image(field.beach).view : empty;
    p.set('uHasForestBeach', field?.beach ? 1 : 0); p.set('uForestBeachRect', beach?.x ?? 0, beach?.y ?? 0, beach?.width ?? 1);
    textures.uOccupation = applied ? image(applied.texture).view : empty;
    p.set('uHasOccupation', applied ? 1 : 0); p.set('uOccupationRect', applied?.data.x ?? 0, applied?.data.y ?? 0, applied?.data.width ?? 1);
    p.set('uOccupationN', applied?.data.n ?? 1);
    textures.uForestBrushAtlas = this.brushAtlas(!!settings?.forestBrushes);
    if (pipeline) {
      pass.setPipeline(pipeline);
      for (const draw of draws) {
        const { patch, material } = draw, tile = patch.tile;
        p.set('patchOffset', tile.x - c.x, patch.heightOrigin * c.exaggeration - frame.targetHeight, tile.y - c.y);
        p.set('physicalOrigin', tile.x, patch.heightOrigin, tile.y); p.set('patchRect', tile.x, tile.y, tile.width);
        p.set('morph', draw.morph); p.setArray('textureRect', draw.textureRect); p.setArray('previousRect', draw.previousRect); p.set('textureBlend', material.blend);
        textures.material = image(material.to.texture).view; textures.previousMaterial = image(material.from.texture).view;
        for (const [ref, name] of [[material.to, 'canopyWater'], [material.from, 'previousCanopyWater']] as const) {
          const mask = this.waterMasks.get(ref.texture);
          textures[name] = mask ? image(mask.texture).view : empty;
          p.set(name === 'canopyWater' ? 'hasCanopyWater' : 'hasPreviousCanopyWater', mask ? 1 : 0);
          p.set(`${name}Rect`, mask?.rect[0] ?? 0, mask?.rect[1] ?? 0, mask?.rect[2] ?? 1);
        }
        const slot = this.params.alloc(p.bytes), seams = this.seamPool.alloc(draw.correction), indices = this.patchIndices(tile, draw.clip);
        pass.setBindGroup(0, device.createBindGroup({ layout: gpu.layouts.terrain, entries: [
          { binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } },
          { binding: 1, resource: gpu.samplers.nearest }, { binding: 2, resource: gpu.samplers.linear }, { binding: 3, resource: gpu.samplers.aniso },
          ...TERRAIN_TEXTURES.map(name => ({ binding: T[name], resource: name === 'macroField' ? textures.macroField ?? this.emptyUnfilterable.view : textures[name] ?? empty })),
        ] }));
        pass.setVertexBuffer(0, patch.vao as GPUBuffer); pass.setVertexBuffer(1, seams.buffer, seams.offset, draw.correction.byteLength);
        pass.setIndexBuffer(indices.buffer, 'uint16'); pass.drawIndexed(indices.count);
      }
    }
    const buildings = this.buildings as UrbanBuildingPassGpu;
    buildings.target = { pass, params: this.params };
    let pending: boolean;
    try { pending = buildings.draw(this.buildingFrame(frame)); } finally { buildings.target = undefined; }
    pass.end();
    this.params.flush(); this.seamPool.flush();
    device.queue.submit([encoder.finish()]);
    for (const buffer of this.garbage.splice(0)) buffer.destroy();
    return pending || !pipeline;
  }

  /** Colour from the canvas (same task as the draw), depth resolved from sample 0 and read back. */
  protected override async captureFrame(near: number, far: number): Promise<{ color: HTMLCanvasElement; depth: HTMLCanvasElement }> {
    const width = this.canvas.width, height = this.canvas.height, targets = this.targets;
    if (!targets || targets.width !== width || targets.height !== height) throw new Error('Capture 3D indisponible.');
    const color = document.createElement('canvas'); color.width = width; color.height = height;
    color.getContext('2d')!.drawImage(this.canvas, 0, 0);
    const device = this.device, pipeline = this.gpu.depthReadback();
    const resolved = device.createTexture({ label: 'depth readback', size: [width, height], format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    const readback = device.createBuffer({ label: 'depth readback', size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = device.createCommandEncoder({ label: 'depth readback' });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: resolved.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [1, 0, 0, 1] }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: targets.depth.createView({ aspect: 'depth-only' }) }] }));
      pass.draw(3); pass.end();
      encoder.copyTextureToBuffer({ texture: resolved }, { buffer: readback, bytesPerRow, rowsPerImage: height }, [width, height]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const rows = new Float32Array(readback.getMappedRange()), inverse = new Float32Array(width * height), stride = bytesPerRow / 4;
      // As captureWebGlFrame: inverse distance from GL window depth, normalized over the rendered geometry.
      let low = Infinity, high = -Infinity;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const d = rows[y * stride + x], i = y * width + x;
        if (!(d < 1)) continue;   // Sky, outside the rendered geometry.
        inverse[i] = (far + near - (2 * d - 1) * (far - near)) / (2 * near * far);
        low = Math.min(low, inverse[i]); high = Math.max(high, inverse[i]);
      }
      readback.unmap();
      const depth = document.createElement('canvas'); depth.width = width; depth.height = height;
      const context = depth.getContext('2d')!, data = context.createImageData(width, height);
      for (let i = 0; i < inverse.length; i++) {
        const value = inverse[i] ? (high > low ? 1 + Math.round(254 * (inverse[i] - low) / (high - low)) : 255) : 0;
        data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = value; data.data[i * 4 + 3] = 255;
      }
      context.putImageData(data, 0, 0);
      return { color, depth };
    } finally { resolved.destroy(); readback.destroy(); }
  }

  protected override disposeBackend(): void {
    this.gpu.listeners.delete(this.redraw);
    this.releaseForest(this.forest);
    if (this.occupation) this.deleteTexture(this.occupation.texture);
    for (const texture of [this.material, this.macroTexture, this.blank, this.emptyUnfilterable, this.brushes.image, this.ring?.image]) if (texture) this.deleteTexture(texture);
    this.fullIndices.buffer.destroy();
    for (const indices of this.patchIndexCache.values()) indices.buffer.destroy();
    this.patchIndexCache.clear();
    this.targets?.color.destroy(); this.targets?.depth.destroy(); this.targets = undefined;
    this.params.destroy(); this.seamPool.destroy();
    this.context.unconfigure();
  }
}

/** UrbanBuildingPass recording into the 3D view's render pass (UrbanBuildingPassGpu.target). */
class UrbanBuildingPassGpu extends UrbanBuildingPass {
  target?: { pass: GPURenderPassEncoder; params: Pool };
  private readonly params = new Params(WGSL.WGSL3D_PARAMS.building);
  private atlases?: { albedo: GPUTexture; normal: GPUTexture };
  private placeholder: GPUTexture;
  constructor(private gpu: Gpu3d, onTexturesReady?: () => void) {
    super(undefined, onTexturesReady);
    this.placeholder = gpu.device.createTexture({ label: 'no building material', size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
  }
  protected override upload(batch: Batch, values: Float32Array): void {
    const buffer = this.gpu.device.createBuffer({ label: 'building batch', size: values.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.gpu.device.queue.writeBuffer(buffer, 0, values.buffer, values.byteOffset, values.byteLength);
    batch.gpu = buffer;
  }
  protected override releaseBatch(batch: Batch): void { batch.gpu?.destroy(); batch.gpu = undefined; }
  /** Material atlases as mipmapped 2D arrays (uploadMaterialArrays, display-space albedo). */
  protected override uploadTextures(images: MaterialImages): void {
    const tile = MATERIALS.tile, count = MATERIALS.layers.length, device = this.gpu.device;
    const make = (bitmap: ImageBitmap, label: string): GPUTexture => {
      const texture = device.createTexture({ label, size: [tile, tile, count], format: 'rgba8unorm', mipLevelCount: mipCount(tile, tile),
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      for (let layer = 0; layer < count; layer++)
        device.queue.copyExternalImageToTexture({ source: bitmap, origin: { x: 0, y: layer * tile } }, { texture, origin: { x: 0, y: 0, z: layer } }, [tile, tile]);
      this.gpu.generateMipmaps(texture);
      return texture;
    };
    this.atlases?.albedo.destroy(); this.atlases?.normal.destroy();
    this.atlases = { albedo: make(images.albedo, 'building albedo'), normal: make(images.normal, 'building normals') };
  }
  protected override render(frame: BuildingFrame, shown: readonly Sector[], textured: boolean): void {
    const target = this.target;
    if (!target || !shown.length) return;
    const pipeline = this.gpu.pipeline(textured ? 'buildingTex' : 'buildingColor');
    if (!pipeline) return;
    const { pass, params } = target, p = this.params, device = this.gpu.device;
    const albedo = (this.atlases?.albedo ?? this.placeholder).createView({ dimension: '2d-array' }), normal = (this.atlases?.normal ?? this.placeholder).createView({ dimension: '2d-array' });
    pass.setPipeline(pipeline);
    p.setArray('matrix', frame.matrix); p.set('exaggeration', frame.exaggeration); p.set('useTex', this.atlases ? 1 : 0);
    let group: GPUBindGroup | undefined, groupBuffer: GPUBuffer | undefined;
    for (const sector of shown) {
      p.set('offset', sector.origin[0] - frame.cameraX, -frame.targetHeight, sector.origin[1] - frame.cameraY);
      for (const batch of sector.cached!.batches) {
        if (!batch.gpu) continue;
        if (textured) { p.setArray('material', batch.color); p.setArray('tint', batch.tint); p.set('recolored', batch.recolored ? 1 : 0); }
        const slot = params.alloc(p.bytes);
        if (slot.buffer !== groupBuffer) {
          groupBuffer = slot.buffer;
          group = device.createBindGroup({ layout: this.gpu.layouts.building, entries: [{ binding: 0, resource: { buffer: slot.buffer, offset: 0, size: p.bytes.byteLength } },
            { binding: 4, resource: this.gpu.samplers.repeat }, { binding: T.albedoTex, resource: albedo }, { binding: T.normalTex, resource: normal }] });
        }
        pass.setBindGroup(0, group!, [slot.offset]);
        pass.setVertexBuffer(0, batch.gpu); pass.draw(batch.count);
      }
    }
  }
  protected override disposeBackend(): void { this.atlases?.albedo.destroy(); this.atlases?.normal.destroy(); this.atlases = undefined; this.placeholder.destroy(); }
}
