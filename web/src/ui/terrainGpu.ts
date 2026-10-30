/**
 * WebGPU renderer of the 2D terrain map, with the public surface and the passes of TerrainGl
 * (terrainGl.ts). The shaders are TerrainGl's, translated to WGSL by web/scripts/wgsl_shaders.ts
 * (terrainWgsl.generated.ts); Chrome and Edge compile WGSL without ANGLE's FXC step.
 *
 * Differences from the WebGL2 path, by construction:
 * - the generated vertex shaders flip clip-space y, so every offscreen target holds GL rows and the GL
 *   shader arithmetic (gl_FragCoord, texelFetch of targets, texture v) is unchanged; the map is drawn into
 *   an offscreen RGBA8 target and flipped once onto the canvas;
 * - uniforms live in one storage block per program, written per draw into a frame buffer slot;
 * - look switches are pipeline overrides; pipelines are created with createRenderPipelineAsync, the last
 *   drawn (or the preview) pipeline stands in meanwhile. Captures that TerrainGl makes wait for the link
 *   create the missing pipeline synchronously instead (their readback then waits for it, as GL does);
 * - captures read a separate WebGPU canvas through drawImage, in the same task (no async readback).
 */
import { unzlibSync } from 'fflate';
import atlas from '../render/assets/fantasy/forest-brushes.json';
import { shoreRingFor } from '../../../rust/bridge/terrainForestBeach';
import type { ForestField, ForestOccupation } from '../../../rust/bridge/terrainForest';
import { createGroundDisplacementSampler } from '../../../rust/bridge/terrainGround';
import { renderV2Number, renderV2GlacierSources } from '../../../rust/bridge/terrainRenderV2';
import { renderV2ZoneUniform } from '../../../rust/bridge/terrainRenderV2Zones';
import { FRACTAL_ROTATIONS } from '../../../rust/bridge/terrainAdjust';
import { terrainLights } from '../render/terrainLighting';
import { lakeDistances, seaDistanceSurface, type WaterSurface } from '../render/terrainWater';
import { isRender3dStyle, terrainStyle } from '../render/terrainStyle';
import { waterUniforms } from '../render/waterStyle';
import { paintRetainedWater, retainedWaterPaths, type RetainedWaterPath } from '../render/retainedWaterGeometry';
import { renderWaterRings } from '../render/renderWaterShader';
import { CANVAS_MAP_STROKES, mapStrokeWidth } from '../render/strokes';
import type { View } from '../render/view';
import { createTerrainSurfaceSampler, heightPyramid } from './terrainSurface';
import { isNeuralRefinement } from './terrainRefinement';
import { PREVIEW_VARIANT, hex, lookMode, mapPasses, type HeightLayer, type OverlayLayer, type TerrainLook, type TerrainVariant, type WaterLayer } from './terrainGl';
import type { TerrainRenderer } from './terrainRenderer';
import * as WGSL from './terrainWgsl.generated';

type ParamsLayout = { size: number; fields: Record<string, { offset: number; type: string; count: number }> };
const COMPONENTS: Record<string, number> = { float: 1, int: 1, uint: 1, bool: 1, vec2: 2, ivec2: 2, uvec2: 2, vec3: 3, ivec3: 3, uvec3: 3, vec4: 4, ivec4: 4, uvec4: 4 };
const ARRAY_STRIDE: Record<string, number> = { float: 4, int: 4, uint: 4, bool: 4, vec2: 8, ivec2: 8, uvec2: 8, vec3: 16, ivec3: 16, uvec3: 16, vec4: 16, ivec4: 16, uvec4: 16 };

/** CPU image of a program's storage block; unknown names are ignored, as absent GL uniforms are. */
class Params {
  readonly bytes: Uint8Array;
  private f32: Float32Array; private i32: Int32Array; private u32: Uint32Array;
  constructor(private layout: ParamsLayout) {
    const buffer = new ArrayBuffer(layout.size);
    this.bytes = new Uint8Array(buffer); this.f32 = new Float32Array(buffer); this.i32 = new Int32Array(buffer); this.u32 = new Uint32Array(buffer);
  }
  /** Scalar or vector components, as uniform{1,2,3,4}{f,i,ui}. */
  set(name: string, ...values: number[]): void { this.write(name, values); }
  /** A whole array (or vector) from a flat list, as uniform*v. */
  setArray(name: string, values: ArrayLike<number>): void { this.write(name, values); }
  private write(name: string, values: ArrayLike<number>): void {
    const field = this.layout.fields[name.replace(/\[0\]$/, '')];
    if (!field) return;
    const components = COMPONENTS[field.type], stride = ARRAY_STRIDE[field.type] / 4, elements = Math.max(1, field.count);
    const view = /^(u|uvec)/.test(field.type) ? this.u32 : /^(int|ivec|bool)/.test(field.type) ? this.i32 : this.f32;
    for (let k = 0; k < values.length && k < elements * components; k++) {
      const element = Math.floor(k / components), component = k % components;
      view[field.offset / 4 + element * stride + component] = view === this.u32 ? values[k] >>> 0 : values[k];
    }
  }
}

/** Box-filtered mip chain of an 8-bit image (all layers), as glGenerateMipmap. */
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

const TERRAIN_TEXTURES = Object.keys(WGSL.WGSL_TEXTURES).filter(name => name !== 'uLayer');
/** Textures only read with texelFetch, in formats without filtering (R32F, RG32F). */
const UNFILTERABLE = new Set(['uField', 'uLake', 'uCoastDistance', 'uRefined', 'uPreviousRefined']);
const BLEND: Record<'none' | 'alpha' | 'max' | 'over', GPUBlendState | undefined> = {
  none: undefined,
  alpha: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' } },
  max: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' } },
  over: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } },
};
const PRESENT_WGSL = `
override opaque: bool = true;
@group(0) @binding(0) var source: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  return vec4<f32>(vec2<f32>(f32(i & 1u), f32(i >> 1u)) * 2.0 - 1.0, 0.0, 1.0);
}
// The map target holds GL rows (bottom first): flip them onto the canvas.
@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let size = textureDimensions(source);
  let c = textureLoad(source, vec2<u32>(u32(p.x), size.y - 1u - u32(p.y)), 0);
  return select(c, vec4<f32>(c.rgb, 1.0), opaque);
}`;
const MAP_FORMAT: GPUTextureFormat = 'rgba8unorm';

type Pipeline = { pipeline?: GPURenderPipeline; failed?: boolean };
/** Device-wide objects: shader modules, layouts, samplers, pipelines (shared by every renderer of the device). */
class GpuShared {
  readonly modules: Record<string, GPUShaderModule> = {};
  readonly layouts: Record<'terrain' | 'river' | 'composite' | 'water', GPUBindGroupLayout>;
  readonly pipelineLayouts: Record<'terrain' | 'river' | 'composite' | 'water', GPUPipelineLayout>;
  readonly nearest: GPUSampler; readonly linear: GPUSampler;
  readonly canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  readonly present: GPUShaderModule;
  private pipelines = new Map<string, Pipeline>();
  /** Redraw requests of the live renderers, called when a pipeline becomes ready. */
  readonly listeners = new Set<() => void>();
  lost = false;
  constructor(readonly device: GPUDevice) {
    for (const key of ['terrainVs', 'terrainFs', 'terrainAuxTextureFs', 'auxFs', 'riverVs', 'riverFs', 'compositeVs', 'compositeFs', 'waterFs'] as const)
      this.modules[key] = device.createShaderModule({ label: key, code: WGSL[key] });
    this.present = device.createShaderModule({ label: 'present', code: PRESENT_WGSL });
    this.nearest = device.createSampler({ label: 'nearest' });
    this.linear = device.createSampler({ label: 'linear', minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear' });
    const buffer = (visibility: number): GPUBindGroupLayoutEntry => ({ binding: 0, visibility, buffer: { type: 'read-only-storage' } });
    const texture = (name: string): GPUBindGroupLayoutEntry => ({ binding: WGSL.WGSL_TEXTURES[name], visibility: GPUShaderStage.FRAGMENT,
      texture: name === 'uAux' ? { sampleType: 'uint' } : name === 'uForestBrushAtlas' ? { sampleType: 'float', viewDimension: '2d-array' } : { sampleType: UNFILTERABLE.has(name) ? 'unfilterable-float' : 'float' } });
    const nearest: GPUBindGroupLayoutEntry = { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'non-filtering' } };
    const linear: GPUBindGroupLayoutEntry = { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } };
    const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.layouts = {
      terrain: device.createBindGroupLayout({ label: 'terrain', entries: [buffer(both), nearest, linear, ...TERRAIN_TEXTURES.map(texture)] }),
      river: device.createBindGroupLayout({ label: 'river', entries: [buffer(both), nearest, texture('uLake'), texture('uOverlay')] }),
      composite: device.createBindGroupLayout({ label: 'composite', entries: [linear, texture('uLayer')] }),
      water: device.createBindGroupLayout({ label: 'water', entries: [buffer(both), linear, texture('uLayer')] }),
    };
    this.pipelineLayouts = Object.fromEntries(Object.entries(this.layouts).map(([name, layout]) =>
      [name, device.createPipelineLayout({ label: name, bindGroupLayouts: [layout] })])) as GpuShared['pipelineLayouts'];
  }
  /** A pipeline once created; starts its asynchronous creation on first request. `wait` creates it
   * synchronously instead (captures), as TerrainGl waits for the link. */
  pipeline(key: string, descriptor: () => GPURenderPipelineDescriptor, wait = false): GPURenderPipeline | undefined {
    let entry = this.pipelines.get(key);
    if (!entry) {
      const created: Pipeline = entry = {};
      this.pipelines.set(key, created);
      this.device.createRenderPipelineAsync(descriptor()).then(pipeline => {
        created.pipeline = pipeline; for (const listener of this.listeners) listener();
      }, error => { if (!created.pipeline) { created.failed = true; console.error(`WebGPU pipeline ${key}:`, error); } });
    }
    if (entry.pipeline || entry.failed || !wait) return entry.pipeline;
    return entry.pipeline = this.device.createRenderPipeline(descriptor());
  }
  adopt(key: string, pipeline: GPURenderPipeline): void { this.pipelines.set(key, { pipeline }); }
  /** Resolves once a pipeline is created (or failed). */
  async settled(key: string): Promise<boolean> {
    for (;;) {
      const entry = this.pipelines.get(key);
      if (!entry || entry.failed || this.lost) return false;
      if (entry.pipeline) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  terrainKey(v: TerrainVariant, pass: 'map' | 'aux', blend: 'none' | 'alpha'): string { return `${pass}.${v.mode}.${v.v2}.${+v.forest}${+v.brushes}.${blend}`; }
  /** Map (or auxiliary) pipeline of a variant: the switches are overrides of the generated module. */
  terrainDescriptor(v: TerrainVariant, pass: 'map' | 'aux', blend: 'none' | 'alpha'): GPURenderPipelineDescriptor {
    const constants: Record<string, number> = { [WGSL.WGSL_OVERRIDES.uMode]: v.mode, [WGSL.WGSL_OVERRIDES.uRenderV2]: v.v2, [WGSL.WGSL_OVERRIDES.uForest]: +v.forest, [WGSL.WGSL_OVERRIDES.uForestBrushes]: +v.brushes };
    const module = pass === 'aux' ? this.modules.auxFs : mapPasses(v).includes('aux') ? this.modules.terrainAuxTextureFs : this.modules.terrainFs;
    return {
      label: this.terrainKey(v, pass, blend), layout: this.pipelineLayouts.terrain,
      vertex: { module: this.modules.terrainVs, entryPoint: 'main' },
      fragment: { module, entryPoint: 'main', constants, targets: [pass === 'aux' ? { format: 'rgba32uint' } : { format: MAP_FORMAT, blend: BLEND[blend] }] },
      primitive: { topology: 'triangle-strip' },
    };
  }
  simpleDescriptor(program: 'river' | 'composite' | 'water', blend: 'max' | 'over'): GPURenderPipelineDescriptor {
    const vertex: GPUVertexState = program === 'river'
      ? { module: this.modules.riverVs, entryPoint: 'main', buffers: [{ arrayStride: 36, stepMode: 'instance', attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x2' }, { shaderLocation: 2, offset: 24, format: 'float32x3' }] }] }
      : { module: this.modules.compositeVs, entryPoint: 'main' };
    const fs = program === 'river' ? this.modules.riverFs : program === 'water' ? this.modules.waterFs : this.modules.compositeFs;
    return { label: program, layout: this.pipelineLayouts[program], vertex,
      fragment: { module: fs, entryPoint: 'main', targets: [{ format: MAP_FORMAT, blend: BLEND[blend] }] }, primitive: { topology: 'triangle-strip' } };
  }
  presentDescriptor(opaque: boolean): GPURenderPipelineDescriptor {
    return { label: `present.${+opaque}`, layout: 'auto', vertex: { module: this.present, entryPoint: 'vs' },
      fragment: { module: this.present, entryPoint: 'fs', constants: { opaque: +opaque }, targets: [{ format: this.canvasFormat }] }, primitive: { topology: 'triangle-strip' } };
  }
}

let shared: Promise<GpuShared | undefined> | undefined;
/** The device and its shared objects, once per page; undefined without a usable (hardware) adapter
 * unless `forced`. The preview pipeline is created before anything is returned: a failure here keeps
 * the WebGL2 path available (no canvas context has been taken yet). */
function sharedGpu(forced: boolean): Promise<GpuShared | undefined> {
  return shared ??= (async () => {
    if (!navigator.gpu) return undefined;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter || (adapter.info?.isFallbackAdapter && !forced)) return undefined;
    const device = await adapter.requestDevice({ label: 'terrain map', requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D } });
    try { return await prepare(device); } catch (error) { device.destroy(); throw error; }
  })().catch(error => { shared = undefined; throw error; });
}
/** Shared objects of a new device; throws if a module or the preview pipeline is refused. */
async function prepare(device: GPUDevice): Promise<GpuShared> {
  const gpu = new GpuShared(device);
  device.lost.then(info => {
    gpu.lost = true;
    if (info.reason === 'destroyed') return;   // a refused probe
    shared = undefined; console.warn('WebGPU map device lost:', info.message);
    for (const listener of gpu.listeners) listener();
  });
  device.addEventListener('uncapturederror', event => console.error('WebGPU map:', (event as GPUUncapturedErrorEvent).error.message));
  for (const [key, module] of Object.entries(gpu.modules)) {
    const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(`WGSL ${key}: ${errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  }
  // Throws (GPUPipelineError) if the translated shaders or the layouts are refused.
  gpu.adopt(gpu.terrainKey(PREVIEW_VARIANT, 'map', 'none'), await device.createRenderPipelineAsync(gpu.terrainDescriptor(PREVIEW_VARIANT, 'map', 'none')));
  // The small programs are ready from the start, as TerrainGl compiles them in its constructor.
  const small: ['river' | 'composite' | 'water', 'max' | 'over'][] = [['river', 'max'], ['composite', 'over'], ['water', 'over']];
  await Promise.all([
    ...small.map(async ([program, blend]) => gpu.adopt(program, await device.createRenderPipelineAsync(gpu.simpleDescriptor(program, blend)))),
    ...[true, false].map(async opaque => gpu.adopt(`present.${+opaque}`, await device.createRenderPipelineAsync(gpu.presentDescriptor(opaque)))),
  ]);
  return gpu;
}

/** A WebGPU map renderer on `canvas`, or undefined when WebGPU is not usable (see sharedGpu). */
export async function createTerrainGpu(canvas: HTMLCanvasElement, forced: boolean): Promise<TerrainGpu | undefined> {
  const gpu = await sharedGpu(forced);
  return gpu && new TerrainGpu(canvas, gpu);
}

interface GpuLayer { layer: HeightLayer; levels: Float32Array[]; texture: GPUTexture; view: GPUTextureView; cave?: GPUTexture; caveView?: GPUTextureView; alpha: number; fadeStart: number }
interface Target { texture: GPUTexture; view: GPUTextureView; width: number; height: number }
interface GpuImage { texture: GPUTexture; view: GPUTextureView }
interface ForestImages { field: ForestField; texture: GpuImage; bank?: GpuImage; beach?: GpuImage }
/** Where a frame ends: the display canvas, or the capture canvas (opaque or premultiplied). */
interface Surface { canvas: HTMLCanvasElement; context: GPUCanvasContext; opaque: boolean }

export class TerrainGpu implements TerrainRenderer {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private capture?: { canvas: HTMLCanvasElement; context: GPUCanvasContext; opaque?: boolean };
  /** Last map variant drawn: it stands in while the look's own pipeline is created. */
  private lastVariant: TerrainVariant = PREVIEW_VARIANT;
  private auxTarget?: Target;
  private auxKey = '';
  private forestVersion = 0;
  private capturing = false;
  private mapTarget?: Target; private riverTarget?: Target; private waterTarget?: Target;
  private retainedWaterKey = '';
  private retainedWaterPaths: readonly RetainedWaterPath[] = [];
  private retainedWaterCanvas?: HTMLCanvasElement;
  private retainedWater?: GpuImage & { width: number; height: number };
  private retainedWaterViewKey = '';
  private base?: GpuLayer; private details: GpuLayer[] = [];
  private enhanced: GpuLayer[] = [];
  private look?: TerrainLook;
  private surfaceCache?: { base: HeightLayer; detail?: HeightLayer; key: string; sample: (x: number, y: number, metresPerPixel?: number) => number };
  private lake?: GpuImage; private lakeMode = 0; private lakeN = 0;
  private overlay?: GpuImage;
  private coastDistance?: GpuImage;
  private shoreRing?: { layer: object; image: GpuImage; x: number; y: number; width: number };
  private forest?: ForestImages;
  private occupation?: { data: ForestOccupation; image: GpuImage };
  private brushes: { image: GpuImage; full: boolean };
  private lakeInput?: Float32Array;
  private lakeWidth = 0;
  private seaSurface?: WaterSurface;
  private riverBuffer?: GPUBuffer; private riverCount = 0;
  private view?: { view: View; width: number; height: number };
  private frame = 0;
  private disposed = false;
  private readonly empty: GpuImage; private readonly emptyUint: GpuImage;
  private readonly terrainParams = new Params(WGSL.WGSL_PARAMS.terrain);
  private readonly riverParams = new Params(WGSL.WGSL_PARAMS.river);
  private readonly waterParams = new Params(WGSL.WGSL_PARAMS.water);
  /** Per-frame storage slots of the draws' parameters (written once before the frame's submit). */
  private slots: { buffer: GPUBuffer; staging: Uint8Array<ArrayBuffer>; used: number; align: number; slotSize: number };
  private readonly redraw = (): void => this.request();
  /** Last frame's GPU submission time, ms (CPU side). */
  drawMs = 0;

  constructor(readonly canvas: HTMLCanvasElement, private gpu: GpuShared) {
    this.device = gpu.device;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU indisponible sur ce canevas');
    this.context = context;
    context.configure({ device: this.device, format: gpu.canvasFormat, alphaMode: 'opaque' });
    gpu.listeners.add(this.redraw);
    this.empty = this.image(1, 1, 'r8unorm', new Uint8Array(1), 1);
    this.emptyUint = this.image(1, 1, 'rgba32uint', new Uint32Array(4), 16);
    this.brushes = { image: this.arrayImage(1, 1, 1, [new Uint8Array([255, 128])]), full: false };
    const align = this.device.limits.minStorageBufferOffsetAlignment;
    const slotSize = Math.ceil(Math.max(...Object.values(WGSL.WGSL_PARAMS).map(p => p.size)) / align) * align, count = 64;
    this.slots = { buffer: this.device.createBuffer({ label: 'map parameters', size: slotSize * count, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      staging: new Uint8Array(slotSize * count), used: 0, align, slotSize };
  }

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
  /** RGBA8 world raster; box mipmaps keep the field's mean cover at coarse footprints (forestTexture). */
  private rgbaImage(raster: { n: number; rgba: Uint8Array }, mipmaps: boolean): GpuImage {
    return this.image(raster.n, raster.n, 'rgba8unorm', raster.rgba, 4, mipmaps ? boxMips(raster.rgba, raster.n, raster.n, 4).map(l => l.data) : undefined);
  }
  private releaseImage(image: GpuImage | undefined): void { image?.texture.destroy(); }

  private renderTarget(width: number, height: number, format: GPUTextureFormat, previous?: Target): Target {
    if (previous?.width === width && previous.height === height) return previous;
    previous?.texture.destroy();
    const texture = this.device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    return { texture, view: texture.createView(), width, height };
  }

  private upload(layer: HeightLayer, pyramid: boolean): GpuLayer {
    const levels = pyramid ? heightPyramid(layer.data, layer.n) : [layer.data];
    const { texture, view } = this.image(layer.n, layer.n, 'r32float', layer.data, 4, levels);
    let cave: GpuImage | undefined;
    if (layer.cave?.length) {
      const mask = new Uint8Array(layer.cave.length);
      for (let i = 0; i < mask.length; i++) if (layer.cave[i]) mask[i] = 255;
      cave = this.image(layer.n, layer.n, 'r8unorm', mask, 1);
    }
    return { layer, levels, texture, view, cave: cave?.texture, caveView: cave?.view, alpha: 1, fadeStart: 0 };
  }
  private release(layer: GpuLayer | undefined): void {
    if (!layer) return;
    layer.texture.destroy(); layer.cave?.destroy();
  }

  /** The whole map's control grid; drops detail layers. */
  setBase(layer: HeightLayer): void {
    this.enhanced.forEach(d => this.release(d)); this.enhanced = [];
    this.release(this.base); this.details.forEach(d => this.release(d)); this.details = [];
    this.base = this.upload(layer, true);
    this.releaseImage(this.coastDistance);
    this.coastDistance = undefined;
    this.seaSurface = layer.waterSurface ?? seaDistanceSurface({ height: layer.data, resolution: layer.n, width: layer.width, x: layer.x, y: layer.y });
    if (!layer.cave?.length) {
      const surface = this.seaSurface;
      this.coastDistance = this.image(surface.n, surface.n, 'r32float', surface.distance, 4);
    }
    this.request();
  }

  /** A finer square region drawn over the base, cross-faded in; keeps at most two. */
  setDetail(layer: HeightLayer | undefined): void {
    if (!layer) { this.details.forEach(d => this.release(d)); this.details = []; this.request(); return; }
    const next = this.upload(layer, false);
    next.alpha = 0; next.fadeStart = performance.now();
    this.details.push(next);
    while (this.details.length > 2) this.release(this.details.shift());
    this.request();
  }

  setRenderV2Season(season: number): void { if (this.look) { this.look = { ...this.look, v2Season: season }; this.request(); } }
  setLook(look: TerrainLook): void { this.look = look; this.request(); }

  /** Explicit Render3D refinement only; ordinary 2D layers never consume it. */
  setEnhancedDetail(layer: HeightLayer | undefined): void {
    if (!layer) { this.enhanced.forEach(d => this.release(d)); this.enhanced = []; this.request(); return; }
    if (this.enhanced.at(-1)?.layer === layer) return;
    const next = this.upload(layer, false); next.fadeStart = performance.now();
    this.enhanced.push(next);
    while (this.enhanced.length > 2) this.release(this.enhanced.shift());
    this.request();
  }

  setRetainedWater(svg: string | undefined, width = 1): void {
    const key = svg ? `${width}:${svg}` : '';
    if (key === this.retainedWaterKey) return;
    this.retainedWaterKey = key;
    this.retainedWaterViewKey = '';
    this.retainedWaterPaths = svg ? retainedWaterPaths(svg, width) : [];
    this.request();
  }

  setWater(water: WaterLayer | undefined): void {
    const width = this.look?.mapWidth ?? this.base?.layer.width ?? 0;
    if (water?.lake !== this.lakeInput || (water?.lake && (this.lakeN !== water.n || this.lakeWidth !== width))) {
      this.releaseImage(this.lake);
      this.lake = undefined; this.lakeInput = water?.lake; this.lakeWidth = width;
      if (water?.lake) {
        const distances = lakeDistances(water.lake, water.n, width), values = new Float32Array(water.n * water.n * 2);
        for (let i = 0; i < water.lake.length; i++) { values[i * 2] = water.lake[i]; values[i * 2 + 1] = distances[i]; }
        this.lake = this.image(water.n, water.n, 'rg32float', values, 8);
        this.lakeN = water.n;
      }
    }
    this.lakeMode = water?.shore === 'exact' ? 2 : 1;
    const rivers = water?.rivers ?? new Float32Array();
    this.riverCount = rivers.length / 9;
    if (rivers.byteLength) {
      if (!this.riverBuffer || this.riverBuffer.size < rivers.byteLength) {
        this.riverBuffer?.destroy();
        this.riverBuffer = this.device.createBuffer({ label: 'rivers', size: Math.ceil(rivers.byteLength / 4) * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      }
      this.device.queue.writeBuffer(this.riverBuffer, 0, rivers as Float32Array<ArrayBuffer>);
    }
    this.request();
  }

  setOverlay(overlay: OverlayLayer | undefined): void {
    this.releaseImage(this.overlay);
    this.overlay = overlay ? this.image(overlay.n, overlay.n, 'rgba8unorm', overlay.rgba, 4) : undefined;
    this.request();
  }

  setView(view: View, width: number, height: number): void { this.view = { view, width, height }; this.request(); }

  /** Render3D forest: texture uploads only. `undefined` restores the legacy macro canopy exactly. */
  setForest(field: ForestField | undefined, occupation?: ForestOccupation): void {
    occupation = field ? occupation : undefined;
    if (field !== this.forest?.field) {
      this.releaseForest();
      this.forest = field && { field, texture: this.rgbaImage(field, true), bank: field.bank ? this.rgbaImage({ n: field.n, rgba: field.bank }, true) : undefined,
        beach: field.beach ? this.image(field.beach.n, field.beach.n, 'r8unorm', field.beach.data, 1) : undefined };
    }
    if (occupation !== this.occupation?.data) {
      this.releaseImage(this.occupation?.image);
      this.occupation = occupation && { data: occupation, image: this.rgbaImage(occupation, false) };
    }
    this.forestVersion++;
    this.request();
  }
  private releaseForest(): void {
    if (!this.forest) return;
    this.releaseImage(this.forest.texture); this.releaseImage(this.forest.bank); this.releaseImage(this.forest.beach);
    this.forest = undefined;
  }

  captureMap(size = 2048, groundOverlay = false): HTMLCanvasElement {
    if (!this.look) throw new Error('Le terrain est indisponible.');
    return this.captureRegion({ x: 0, y: 0, width: this.look.mapWidth }, size, false, true, undefined, groundOverlay);
  }
  redrawForCapture(): void {
    if (!this.base || !this.look || this.gpu.lost) throw new Error('Le terrain est indisponible.');
    this.capturing = true;
    try { this.draw(); } finally { this.capturing = false; }
  }

  /** The capture canvas (its own WebGPU context), configured for opaque or premultiplied output. */
  private captureSurface(opaque: boolean): Surface {
    if (!this.capture) {
      const canvas = document.createElement('canvas'), context = canvas.getContext('webgpu');
      if (!context) throw new Error('Impossible de préparer la capture WebGPU.');
      this.capture = { canvas, context };
    }
    if (this.capture.opaque !== opaque) {
      this.capture.context.configure({ device: this.device, format: this.gpu.canvasFormat, alphaMode: opaque ? 'opaque' : 'premultiplied' });
      this.capture.opaque = opaque;
    }
    return { canvas: this.capture.canvas, context: this.capture.context, opaque };
  }

  /** Render a world-space LOD tile with the same material and detail as the map. */
  captureRegion(region: { x: number; y: number; width: number }, size = 512, includeDetails = true, restoreDisplay = true, height?: HeightLayer, groundOverlay = false, alphaOnly?: Uint8Array): HTMLCanvasElement {
    if (!this.base || !this.look || this.gpu.lost) throw new Error('Le terrain est indisponible.');
    const previous = this.view, details = this.details, look = this.look, enhanced = this.enhanced;
    const capturedHeight = height ? this.upload(height, false) : undefined;
    const output = document.createElement('canvas'); output.width = output.height = size;
    const context = output.getContext('2d', alphaOnly ? { willReadFrequently: true } : undefined);
    if (!context) throw new Error('Impossible de préparer le style 3D.');
    try {
      this.details = !groundOverlay && includeDetails && details.length ? [{ ...details[details.length - 1], fadeStart: -Infinity }] : [];
      this.look = { ...look, frame: false, contours: groundOverlay ? false : look.contours, mesh3d: true, groundCapture: groundOverlay };
      this.enhanced = capturedHeight ? [{ ...capturedHeight, fadeStart: -Infinity }] : [];
      this.view = { view: { cx: region.x + region.width / 2, cy: region.y + region.width / 2, scale: size / region.width }, width: size, height: size };
      // The ground overlay keeps premultiplied coverage (TerrainGl reads it back from its own target, waiting
      // for the link); the colour capture is opaque, like the WebGL2 canvas it is copied from.
      const surface = this.captureSurface(!groundOverlay);
      this.draw(1, includeDetails ? Math.min(2, window.devicePixelRatio || 1) : 1, surface, groundOverlay);
      context.drawImage(surface.canvas, 0, 0);
      if (alphaOnly) {
        const rgba = context.getImageData(0, 0, size, size).data;
        for (let i = 0; i < size * size; i++) alphaOnly[i] = rgba[i * 4 + 3];
      }
    } finally {
      this.view = previous; this.details = details; this.look = look; this.enhanced = enhanced;
      this.release(capturedHeight);
      if (restoreDisplay) this.draw();
    }
    return output;
  }

  /** Canonical 1 m water samples with a caller-supplied world-space halo. */
  captureWaterMask(region: { x: number; y: number; width: number }): Uint8Array {
    const n = Math.round(region.width), alpha = new Uint8Array(n * n);
    const look = this.look; if (look?.style.startsWith('render-v2')) this.look = { ...look, layers: { ...look.layers, water: true } };
    try { this.captureRegion(region, n, false, false, undefined, true, alpha); } finally { this.look = look; }
    return alpha;
  }

  createSurfaceSampler(): ((x: number, y: number, metresPerPixel?: number) => number) | undefined {
    if (!this.base || !this.look) return undefined;
    const base = this.base.layer, detail = this.details[this.details.length - 1]?.layer, look = this.look;
    const refine = (look.refinement3d ?? 'noise') === 'noise';
    const ground = isRender3dStyle(look.style) && (look.refinement3d ?? 'noise') !== 'source';
    const key = JSON.stringify([refine, ground, look.climate, look.floor, look.sourceCell, look.seed, look.detail]);
    if (!this.surfaceCache || this.surfaceCache.base !== base || this.surfaceCache.detail !== detail || this.surfaceCache.key !== key) {
      const sample = createTerrainSurfaceSampler(base, { ...look, refine }, detail ? [detail] : [], true);
      const macroSampler = ground ? createTerrainSurfaceSampler(base, { ...look, refine: false }, [], false) : undefined;
      this.surfaceCache = { base, detail, key, sample: ground ? createGroundDisplacementSampler(sample, { seed: look.seed, sourceCell: look.sourceCell, macroSampler, climate: look.climate ? [look.climate.temperature, look.climate.precipitation] : undefined }) : sample };
    }
    return this.surfaceCache.sample;
  }

  /** Height (metres) the renderer shows at a world point, from the finest layer covering it. */
  heightAt(x: number, y: number): number | undefined {
    const layers = [...this.details].reverse().concat(this.base ? [this.base] : []);
    for (const l of layers) {
      const { layer } = l, cell = layer.width / layer.n;
      if (x < layer.x || y < layer.y || x > layer.x + layer.width || y > layer.y + layer.width) continue;
      const gx = (x - layer.x) / cell - 0.5, gy = (y - layer.y) / cell - 0.5, fx = Math.floor(gx), fy = Math.floor(gy);
      const w = (t: number): number[] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
      const wx = w(gx - fx), wy = w(gy - fy), n = layer.n;
      let h = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const cx = Math.max(0, Math.min(n - 1, fx + i - 1)), cy = Math.max(0, Math.min(n - 1, fy + j - 1));
        h += layer.data[cy * n + cx] * wx[i] * wy[j];
      }
      return Math.max(h, this.look?.floor ?? 0);
    }
    return undefined;
  }

  private lookVariant(look: TerrainLook): TerrainVariant {
    const mode = lookMode(look);
    return { mode, v2: renderV2Number(look.style), forest: mode === 3 && !!this.forest, brushes: look.style === 'render3d-brush' && mode === 3 };
  }
  private terrainPipeline(v: TerrainVariant, pass: 'map' | 'aux', blend: 'none' | 'alpha', wait: boolean): GPURenderPipeline | undefined {
    return this.gpu.pipeline(this.gpu.terrainKey(v, pass, blend), () => this.gpu.terrainDescriptor(v, pass, blend), wait);
  }
  /** The look's map variant once created; meanwhile the last drawn variant (or the preview) stands in. */
  private mapVariant(look: TerrainLook, wait: boolean): { variant: TerrainVariant; pipeline: GPURenderPipeline } | undefined {
    const target = this.lookVariant(look), pipeline = this.terrainPipeline(target, 'map', 'none', wait);
    if (pipeline) return { variant: this.lastVariant = target, pipeline };
    for (const v of [this.lastVariant, PREVIEW_VARIANT]) {
      const standIn = this.terrainPipeline(v, 'map', 'none', false);
      if (standIn) return { variant: v, pipeline: standIn };
    }
    return undefined;
  }
  /** Pipeline keys of a look (map, and auxiliary pass if any); starts creating them. */
  private lookKeys(look: TerrainLook): string[] {
    const v = this.lookVariant(look), passes: ('map' | 'aux')[] = mapPasses(v).includes('aux') ? ['map', 'aux'] : ['map'];
    return passes.map(pass => { this.terrainPipeline(v, pass, 'none', false); return this.gpu.terrainKey(v, pass, 'none'); });
  }
  /** Resolves once the current look's pipelines are created, without blocking: callers that can wait
   * (3D material tiles) capture after it. */
  async variantReady(): Promise<void> {
    for (;;) {
      if (!this.look || this.disposed || this.gpu.lost) return;
      const keys = this.lookKeys(this.look);
      const ready = await Promise.all(keys.map(key => this.gpu.settled(key)));
      if (!this.look || this.lookKeys(this.look).join() === keys.join()) {
        if (!ready.every(Boolean)) console.warn('WebGPU map: a pipeline of the look failed; the stand-in stays.');
        return;
      }
    }
  }

  private request(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  /** A storage slot holding `params` for one draw; its binding entry. */
  private slot(params: Params): GPUBufferBinding {
    const s = this.slots, offset = Math.ceil(s.used / s.align) * s.align;
    if (offset + s.slotSize > s.staging.length) throw new Error('WebGPU map: too many draws in one frame');
    s.staging.set(params.bytes, offset); s.used = offset + params.bytes.length;
    return { buffer: s.buffer, offset, size: params.bytes.length };
  }

  private draw(pixelRatio = Math.min(2, window.devicePixelRatio || 1), stylePixelRatio = pixelRatio, capture?: Surface, waitCapture = false): void {
    const look = this.look, state = this.view, device = this.device;
    if (this.disposed || !look || !state || !this.base || this.gpu.lost) return;
    const wait = this.capturing || waitCapture;
    const chosen = this.mapVariant(look, wait);
    if (!chosen) return;
    const started = performance.now();
    const dpr = pixelRatio;
    const width = Math.max(1, Math.round(state.width * dpr)), height = Math.max(1, Math.round(state.height * dpr));
    const surface: Surface = capture ?? { canvas: this.canvas, context: this.context, opaque: true };
    if (surface.canvas.width !== width || surface.canvas.height !== height) { surface.canvas.width = width; surface.canvas.height = height; }
    const { view } = state, px = 1 / (view.scale * dpr);
    const origin: [number, number] = [view.cx - state.width / (2 * view.scale), view.cy - state.height / (2 * view.scale)];
    const definition = terrainStyle(look.style, look.colors), pal = definition.palette, water = terrainStyle(look.waterStyle ?? look.style, look.colors).water;
    const p = this.terrainParams;
    this.slots.used = 0;
    const encoder = device.createCommandEncoder({ label: 'terrain map' });
    this.mapTarget = this.renderTarget(width, height, MAP_FORMAT, this.mapTarget);
    const mapTarget = this.mapTarget;
    /** Texture views of the terrain program by uniform name (TerrainGl's texture units). */
    let textures: Record<string, GPUTextureView> = {};
    const empty = this.empty.view;
    let enhancedAlpha = 1;
    // Every parameter of the look; replayed for the auxiliary pass (same names, same values).
    const setup = (): void => {
      textures = Object.fromEntries(TERRAIN_TEXTURES.map(name => [name, empty]));
      textures.uForestBrushAtlas = this.brushes.image.view; textures.uAux = this.emptyUint.view;
      p.set('uCanvas', width, height);
      p.set('uOrigin', origin[0], origin[1]);
      p.set('uPx', px); p.set('uDpr', stylePixelRatio);
      p.set('uGroundCapture', look.groundCapture ? 1 : 0);
      p.set('uMapW', look.mapWidth);
      p.set('uRelief', look.layers.relief ? 1 : 0); p.set('uWaterVisible', look.layers.water !== false ? 1 : 0);
      p.set('uMaterialSeed', look.seed >>> 0);
      p.set('uMaterialClimate', look.climate?.temperature ?? 18, look.climate?.precipitation ?? 1000);
      const mode = lookMode(look);
      this.bindForest(p, textures, mode === 3);
      if (mode >= 2 && this.base && this.shoreRing?.layer !== this.base.layer) {
        this.releaseImage(this.shoreRing?.image);
        const grid = shoreRingFor(this.base.layer), half = new Uint16Array(grid.data.length);
        for (let i = 0; i < half.length; i++) half[i] = toHalf(grid.data[i]);
        this.shoreRing = { layer: this.base.layer, image: this.image(grid.n, grid.n, 'rg16float', half, 4), x: grid.x, y: grid.y, width: grid.width };
      }
      textures.uShoreRing = this.shoreRing?.image.view ?? empty;
      p.set('uShoreRingRect', this.shoreRing?.x ?? 0, this.shoreRing?.y ?? 0, this.shoreRing?.width ?? 1);
      this.bindBrushes(textures, look.style === 'render3d-brush' && mode === 3);
      p.set('uV2WaterVisible', look.layers.water === false ? 0 : 1);
      if (this.base && look.climate) p.setArray('uV2GlacierSources', renderV2GlacierSources(this.base.layer, look.climate));
      p.set('uV2Season', look.v2Season ?? .5); p.set('uMaterialZone', renderV2ZoneUniform(look.climateZone));
      p.set('uEnhanced3d', look.mesh3d || isRender3dStyle(look.style) ? 1 : 0);
      p.set('uRefinementMode', look.refinement3d === 'source' ? 0 : isNeuralRefinement(look.refinement3d ?? 'noise') ? 2 : 1);
      const refined = this.enhanced.at(-1), previousRefined = this.enhanced.at(-2);
      for (const [layer, name] of [[refined, 'Refined'], [previousRefined, 'PreviousRefined']] as const) {
        textures[`u${name}`] = layer?.view ?? empty;
        p.set(`u${name}N`, layer?.layer.n ?? 0);
        p.set(`u${name}Rect`, layer?.layer.x ?? 0, layer?.layer.y ?? 0, layer?.layer.width ?? 1, 0);
      }
      enhancedAlpha = refined ? Math.min(1, (performance.now() - refined.fadeStart) / 240) : 1;
      p.set('uRefinedAlpha', enhancedAlpha);
      p.setArray('uPaper', hex(pal.paper)); p.setArray('uSea', hex(pal.seaFill));
      p.setArray('uShore', hex(water.stops[0][1])); p.set('uCoastalSea', this.coastDistance ? 1 : 0);
      const waterPalette = waterUniforms(water);
      p.setArray('uWaterStops', waterPalette.colors); p.setArray('uWaterStopT', waterPalette.positions);
      p.set('uWaterStopCount', water.stops.length);
      p.set('uSeaBand', (this.seaSurface?.referenceWidth ?? look.mapWidth) * water.bandFraction);
      p.set('uCoastOrigin', this.seaSurface?.x ?? 0, this.seaSurface?.y ?? 0); p.set('uCoastWidth', this.seaSurface?.width ?? look.mapWidth); p.set('uCoastN', this.seaSurface?.n ?? 1);
      p.setArray('uBackground', hex(look.background)); p.setArray('uFrameColor', hex(look.style === 'copernicus' ? '#333333' : pal.frame));
      p.setArray('uContourColor', hex(pal.contour));
      const stops = look.layers.hypsometry || look.style === 'copernicus' ? pal.hypso.slice(0, 8) : [[0, pal.paper], [1, pal.paper]] as [number, string][];
      p.setArray('uStops', Array.from({ length: 8 }, (_, i) => hex(stops[Math.min(i, stops.length - 1)][1])).flat());
      p.setArray('uStopT', Array.from({ length: 8 }, (_, i) => stops[Math.min(i, stops.length - 1)][0]));
      p.set('uStopCount', stops.length);
      const lights = terrainLights(look.lighting);
      p.setArray('uLight', lights.primary); p.setArray('uLight2', lights.secondary);
      p.set('uRockStrength', look.lighting.enabled ? look.lighting.strength : 0);
      p.set('uFlatLight', lights.flat); p.set('uExaggeration', look.lighting.exaggeration);
      p.set('uShade', pal.shade * (look.lighting.enabled ? look.lighting.strength : 0));
      const coastal = look.globalMin < 0;
      p.set('uMinH', Math.max(0, look.globalMin)); p.set('uMaxH', look.globalMax); p.set('uGlobalMin', look.globalMin);
      p.set('uFloor', look.floor);
      p.set('uCoastal', coastal ? 1 : 0); p.set('uFrame', look.frame ? 1 : 0);
      const thin = mapStrokeWidth(CANVAS_MAP_STROKES.contour, view.scale) * view.scale * dpr;
      const index = mapStrokeWidth(CANVAS_MAP_STROKES.contourIndex, view.scale, pal.contourIndexW / 1.6) * view.scale * dpr;
      p.set('uContours', look.contours && look.contourStep > 0 ? 1 : 0);
      p.set('uStep', Math.max(1e-3, look.contourStep)); p.set('uThinW', thin); p.set('uIndexW', index);
      p.set('uThinA', pal.contourOpacity * 0.5); p.set('uIndexA', pal.contourOpacity * 0.75);
      p.set('uFlatSlope', look.flatRelief ? 0.004 : 0.012);
      p.set('uRefine', look.refine ? 1 : 0); p.set('uSourceCell', look.sourceCell); p.set('uSeed', look.seed >>> 0);
      const d = look.detail;
      p.set('uDetailA', d.amplitude, d.hurst, Math.max(1.1, d.lacunarity), d.start);
      p.set('uDetailB', d.slope, d.flat, d.shore);
      p.set('uOctaves', Math.min(FRACTAL_ROTATIONS.length, Math.round(d.octaves)));
      textures.uCoastDistance = this.coastDistance?.view ?? empty;
      textures.uLake = this.lake?.view ?? empty;
      p.set('uHasLake', this.lake ? this.lakeMode : 0); p.set('uLakeN', this.lakeN);
      textures.uOverlay = this.overlay?.view ?? empty;
      p.set('uHasOverlay', this.overlay ? 1 : 0);
      p.set('uHasAux', 0);
    };
    setup();
    let animating = enhancedAlpha < 1;
    const now = performance.now();
    const terrainBindGroup = (): GPUBindGroup => device.createBindGroup({ layout: this.gpu.layouts.terrain, entries: [
      { binding: 0, resource: this.slot(p) }, { binding: 1, resource: this.gpu.nearest }, { binding: 2, resource: this.gpu.linear },
      ...TERRAIN_TEXTURES.map(name => ({ binding: WGSL.WGSL_TEXTURES[name], resource: textures[name] })),
    ] });
    const pass = (target: Target, clear: boolean, label: string): GPURenderPassEncoder => encoder.beginRenderPass({ label,
      colorAttachments: [{ view: target.view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    /** One height layer (TerrainGl.drawLayer); details need the variant's blending pipeline. */
    const drawLayer = (encoderPass: GPURenderPassEncoder, layer: GpuLayer, base: boolean, pipeline: GPURenderPipeline | undefined): void => {
      const l = layer.layer;
      textures.uField = layer.view; textures.uCave = layer.caveView ?? empty;
      p.set('uHasCave', layer.cave ? 1 : 0);
      p.set('uFieldN', l.n); p.set('uFieldOrigin', l.x, l.y); p.set('uFieldCell', l.width / l.n);
      p.set('uMaxLod', layer.levels.length - 1);
      p.set('uBase', base ? 1 : 0);
      if (base) {
        p.set('uAlpha', 1);
        p.set('uQuad', 0, 0, width, height);
      } else {
        const alpha = Math.min(1, (now - layer.fadeStart) / 240);
        animating ||= alpha < 1;
        p.set('uAlpha', 1 - (1 - alpha) ** 2);
        const inset = 2 * l.width / l.n;
        p.set('uQuad', (l.x + inset - origin[0]) / px, (l.y + inset - origin[1]) / px, (l.x + l.width - inset - origin[0]) / px, (l.y + l.width - inset - origin[1]) / px);
      }
      if (!pipeline) return;
      encoderPass.setPipeline(pipeline); encoderPass.setBindGroup(0, terrainBindGroup()); encoderPass.draw(4);
    };
    const paintedWater = look.style === 'render' && !look.groundCapture;
    const waterBand = (this.seaSurface?.referenceWidth ?? look.mapWidth) * water.bandFraction;
    /** Premultiplied layer `source` over `destination`: plain copy, or the render style's painted water. */
    const composite = (source: GPUTextureView, destination: Target, painted: boolean): void => {
      const program = painted ? 'water' : 'composite';
      const pipeline = this.gpu.pipeline(program, () => this.gpu.simpleDescriptor(program, 'over'), wait);
      if (!pipeline) return;
      let bindGroup: GPUBindGroup;
      if (painted) {
        const w = this.waterParams, palette = waterUniforms(water), rings = renderWaterRings(px, waterBand);
        w.set('uCanvas', width, height); w.set('uOrigin', origin[0], origin[1]);
        w.set('uPx', px); w.set('uDpr', stylePixelRatio); w.set('uBand', waterBand);
        w.set('uBankPx', Math.min(6 * stylePixelRatio, Math.max(1.5 * stylePixelRatio, 7 / px)));
        w.setArray('uRings', rings); w.set('uRingCount', rings.length);
        w.setArray('uWaterStops', palette.colors); w.setArray('uWaterStopT', palette.positions);
        w.set('uWaterStopCount', water.stops.length);
        bindGroup = device.createBindGroup({ layout: this.gpu.layouts.water, entries: [{ binding: 0, resource: this.slot(w) }, { binding: 2, resource: this.gpu.linear }, { binding: WGSL.WGSL_TEXTURES.uLayer, resource: source }] });
      } else bindGroup = device.createBindGroup({ layout: this.gpu.layouts.composite, entries: [{ binding: 2, resource: this.gpu.linear }, { binding: WGSL.WGSL_TEXTURES.uLayer, resource: source }] });
      const encoderPass = pass(destination, false, program);
      encoderPass.setPipeline(pipeline); encoderPass.setBindGroup(0, bindGroup); encoderPass.draw(4); encoderPass.end();
    };
    const renderRivers = (destination: Target): void => {
      if (!this.riverCount || !this.riverBuffer || (look.layers.water === false && !look.style.startsWith('render-v2'))) return;
      const pipeline = this.gpu.pipeline('river', () => this.gpu.simpleDescriptor('river', 'max'), wait);
      if (!pipeline) return;
      const target = this.riverTarget = this.renderTarget(width, height, MAP_FORMAT, this.riverTarget);
      const r = this.riverParams;
      r.set('uCanvas', width, height); r.set('uOrigin', origin[0], origin[1]);
      r.set('uPx', px); r.set('uDpr', stylePixelRatio); r.set('uPhysicalWidth', look.style.startsWith('render-v2') ? 1 : 0);
      r.set('uMapW', look.mapWidth); r.set('uHasOverlay', this.overlay ? 1 : 0);
      r.set('uHasLake', this.lake ? this.lakeMode : 0); r.set('uLakeN', this.lakeN);
      const bindGroup = device.createBindGroup({ layout: this.gpu.layouts.river, entries: [{ binding: 0, resource: this.slot(r) }, { binding: 1, resource: this.gpu.nearest },
        { binding: WGSL.WGSL_TEXTURES.uLake, resource: this.lake?.view ?? empty }, { binding: WGSL.WGSL_TEXTURES.uOverlay, resource: this.overlay?.view ?? empty }] });
      const encoderPass = pass(target, true, 'rivers');
      encoderPass.setPipeline(pipeline); encoderPass.setBindGroup(0, bindGroup); encoderPass.setVertexBuffer(0, this.riverBuffer);
      encoderPass.draw(4, this.riverCount); encoderPass.end();
      // Diagnostic colours (overlay) keep the plain composite.
      composite(target.view, destination, paintedWater && !this.overlay);
    };
    const renderRetainedWater = (destination: Target): void => {
      if (!this.retainedWaterPaths.length || (look.layers.water === false && !look.style.startsWith('render-v2'))) return;
      const canvas = this.retainedWaterCanvas ??= document.createElement('canvas');
      const key = `${origin[0]},${origin[1]},${px},${width},${height},${water.stops[0][1]}`;
      if (key !== this.retainedWaterViewKey || this.retainedWater?.width !== width || this.retainedWater.height !== height) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        paintRetainedWater(canvas.getContext('2d')!, this.retainedWaterPaths,
          { x: origin[0], y: origin[1], width: width * px, height: height * px }, { width, height }, water.stops[0][1]);
        if (this.retainedWater?.width !== width || this.retainedWater.height !== height) {
          this.retainedWater?.texture.destroy();
          const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
          this.retainedWater = { texture, view: texture.createView(), width, height };
        }
        // GL rows (flipped) and premultiplied, as TerrainGl's upload.
        device.queue.copyExternalImageToTexture({ source: canvas, flipY: true }, { texture: this.retainedWater.texture, premultipliedAlpha: true }, [width, height]);
        this.retainedWaterViewKey = key;
      }
      composite(this.retainedWater.view, destination, paintedWater);
    };
    const separateWater = isRender3dStyle(look.style) && look.layers.relief && look.layers.hypsometry && (look.layers.water !== false || look.style.startsWith('render-v2')) && !look.groundCapture;
    p.set('uUseWaterLayer', 0);
    if (separateWater) {
      const waterTarget = this.waterTarget = this.renderTarget(width, height, MAP_FORMAT, this.waterTarget);
      p.set('uGroundCapture', 1); p.set('uWaterVisible', 1); p.set('uContours', 0);
      p.set('uHasOverlay', 0); p.set('uFrame', 0);
      const waterPass = pass(waterTarget, true, 'water layer');
      drawLayer(waterPass, this.base, true, chosen.pipeline);
      waterPass.end();
      renderRivers(waterTarget);
      renderRetainedWater(waterTarget);
      p.set('uGroundCapture', 0); p.set('uWaterVisible', look.layers.water === false ? 0 : 1);
      p.set('uContours', look.contours && look.contourStep > 0 ? 1 : 0);
      p.set('uHasOverlay', this.overlay ? 1 : 0); p.set('uFrame', look.frame ? 1 : 0);
      textures.uWaterLayer = waterTarget.view;
      p.set('uUseWaterLayer', 1);
    }
    // Auxiliary pass (TerrainGl.renderAux): rendered only when its inputs changed.
    const v = this.lookVariant(look);
    if (mapPasses(v).includes('aux')) {
      const aux = this.terrainPipeline(v, 'aux', 'none', wait);
      const key = aux && JSON.stringify([width, height, origin, px, look.seed, look.climate, look.lighting, look.v2Season, look.layers, look.refinement3d,
        look.mesh3d, look.style, this.forestVersion, this.riverCount, this.retainedWaterKey, this.lakeN, separateWater, this.base.layer.width, this.base.layer.n,
        this.enhanced.at(-1)?.fadeStart, this.coastDistance ? 1 : 0]);
      if (this.auxTarget?.width !== width || this.auxTarget.height !== height) this.auxKey = '';
      if (aux && key !== this.auxKey) {
        this.auxTarget = this.renderTarget(width, height, 'rgba32uint', this.auxTarget);
        const saved = p.bytes.slice(), savedTextures = textures, waterLayer = textures.uWaterLayer;
        setup();
        textures.uWaterLayer = waterLayer; p.set('uUseWaterLayer', separateWater ? 1 : 0);
        const auxPass = pass(this.auxTarget, true, 'auxiliary');
        drawLayer(auxPass, this.base, true, aux);
        auxPass.end();
        p.bytes.set(saved); textures = savedTextures;
        this.auxKey = key!;
      }
      textures.uAux = aux && this.auxTarget ? this.auxTarget.view : this.emptyUint.view;
      p.set('uHasAux', aux ? 1 : 0);
    }
    const mapPass = pass(mapTarget, true, 'map');
    drawLayer(mapPass, this.base, true, chosen.pipeline);
    if (this.details.length) {
      const blended = this.terrainPipeline(chosen.variant, 'map', 'alpha', wait);
      for (const detail of this.details) drawLayer(mapPass, detail, false, blended);
    }
    mapPass.end();
    let opaque = -1;
    this.details.forEach((d, i) => { if (now - d.fadeStart >= 240) opaque = i; });
    if (opaque > 0) { this.details.slice(0, opaque).forEach(d => this.release(d)); this.details = this.details.slice(opaque); }
    if (!separateWater) { renderRivers(mapTarget); renderRetainedWater(mapTarget); }
    // Present: GL rows flipped onto the canvas.
    const present = this.gpu.pipeline(`present.${+surface.opaque}`, () => this.gpu.presentDescriptor(surface.opaque), true)!;
    const presentPass = encoder.beginRenderPass({ label: 'present', colorAttachments: [{ view: surface.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    presentPass.setPipeline(present);
    presentPass.setBindGroup(0, device.createBindGroup({ layout: present.getBindGroupLayout(0), entries: [{ binding: 0, resource: mapTarget.view }] }));
    presentPass.draw(4); presentPass.end();
    device.queue.writeBuffer(this.slots.buffer, 0, this.slots.staging, 0, Math.max(4, this.slots.used));
    device.queue.submit([encoder.finish()]);
    this.drawMs = performance.now() - started;
    if (animating) this.request();
  }

  /** Forest textures and parameters shared with TerrainGl's bindForest. */
  private bindForest(p: Params, textures: Record<string, GPUTextureView>, enabled: boolean): void {
    const field = enabled ? this.forest : undefined, applied = field ? this.occupation : undefined, empty = this.empty.view;
    textures.uForestField = field?.texture.view ?? empty;
    p.set('uForestRect', field?.field.x ?? 0, field?.field.y ?? 0, field?.field.width ?? 1);
    textures.uForestBank = field?.bank?.view ?? empty;
    p.set('uHasForestBank', field?.bank ? 1 : 0);
    p.set('uForestBankDensity', field?.field.bankDensity ?? 1);
    const beach = field?.field.beach;
    textures.uForestBeach = field?.beach?.view ?? empty;
    p.set('uHasForestBeach', field?.beach ? 1 : 0);
    p.set('uForestBeachRect', beach?.x ?? 0, beach?.y ?? 0, beach?.width ?? 1);
    textures.uOccupation = applied?.image.view ?? empty;
    p.set('uHasOccupation', applied ? 1 : 0);
    p.set('uOccupationRect', applied?.data.x ?? 0, applied?.data.y ?? 0, applied?.data.width ?? 1);
    p.set('uOccupationN', applied?.data.n ?? 1);
  }
  /** Brush atlas (bindForestBrushes): a 1×1 placeholder until a brush look first needs the full array. */
  private bindBrushes(textures: Record<string, GPUTextureView>, enabled: boolean): void {
    if (enabled && !this.brushes.full) {
      const pixels = unzlibSync(Uint8Array.from(atob(atlas.zlib), c => c.charCodeAt(0)));
      const layers = atlas.families.length * atlas.variants, levels = boxMips(pixels, atlas.size, atlas.size, 2, layers);
      this.releaseImage(this.brushes.image);
      this.brushes = { image: this.arrayImage(atlas.size, layers, levels.length, levels.map(l => l.data)), full: true };
    }
    textures.uForestBrushAtlas = this.brushes.image.view;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame); this.frame = 0;
    this.gpu.listeners.delete(this.redraw);
    for (const target of [this.auxTarget, this.mapTarget, this.riverTarget, this.waterTarget]) target?.texture.destroy();
    this.release(this.base); this.details.forEach(d => this.release(d)); this.enhanced.forEach(d => this.release(d));
    for (const image of [this.lake, this.overlay, this.coastDistance, this.shoreRing?.image, this.occupation?.image, this.retainedWater, this.brushes.image, this.empty, this.emptyUint]) this.releaseImage(image);
    this.releaseForest();
    this.riverBuffer?.destroy(); this.slots.buffer.destroy();
    this.context.unconfigure(); this.capture?.context.unconfigure();
  }
}
