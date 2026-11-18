/**
 * The page's WebGPU device for the 2D ground, shared by every TerrainGpu: shader modules (WGSL generated from the
 * GLSL of terrain/gl/shaders.ts by web/scripts/wgsl_shaders.ts), bind group and pipeline layouts, samplers, and the
 * pipelines keyed by variant. Pipelines are created with createRenderPipelineAsync on first request (the last drawn
 * one stands in meanwhile); captures create a missing one synchronously. Only requested looks are compiled: eagerly
 * compiling every heavy look competes with the selected one in Tint/DXC and retains unused pipelines.
 * The device is prepared once per page (again after a loss), ahead of the first map when possible.
 */
import { PREVIEW_VARIANT, hasAuxPass, variantKey, type TerrainVariant } from '../variant';
import * as WGSL from '../../terrainWgsl.generated';

/** Texture bindings of the map program, by uniform name. */
export const TERRAIN_TEXTURES = Object.keys(WGSL.WGSL_TEXTURES).filter(name => name !== 'uLayer');
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
export const MAP_FORMAT: GPUTextureFormat = 'rgba8unorm';

type Pipeline = { pipeline?: GPURenderPipeline; failed?: boolean };
/** Device-wide objects: shader modules, layouts, samplers, pipelines (shared by every renderer of the device). */
export class GpuShared {
  readonly modules: Record<string, GPUShaderModule> = {};
  readonly layouts: Record<'terrain' | 'river' | 'composite' | 'water', GPUBindGroupLayout>;
  readonly pipelineLayouts: Record<'terrain' | 'river' | 'composite' | 'water', GPUPipelineLayout>;
  readonly nearest: GPUSampler;
  readonly linear: GPUSampler;
  readonly canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  readonly present: GPUShaderModule;
  private pipelines = new Map<string, Pipeline>();
  /** Redraw requests of the live renderers, called when a pipeline becomes ready. */
  readonly listeners = new Set<() => void>();
  /** Recovery of the live renderers, called when the device is lost (not destroyed by this module). */
  readonly lostListeners = new Set<() => void>();
  lost = false;
  constructor(readonly device: GPUDevice) {
    for (const key of ['terrainVs', 'terrainFs', 'terrainAuxTextureFs', 'auxFs', 'riverVs', 'riverFs', 'compositeVs', 'compositeFs', 'waterFs'] as const) this.modules[key] = device.createShaderModule({ label: key, code: WGSL[key] });
    this.present = device.createShaderModule({ label: 'present', code: PRESENT_WGSL });
    this.nearest = device.createSampler({ label: 'nearest' });
    this.linear = device.createSampler({ label: 'linear', minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear' });
    const buffer = (visibility: number): GPUBindGroupLayoutEntry => ({ binding: 0, visibility, buffer: { type: 'read-only-storage' } });
    const texture = (name: string): GPUBindGroupLayoutEntry => ({
      binding: WGSL.WGSL_TEXTURES[name],
      visibility: GPUShaderStage.FRAGMENT,
      texture: name === 'uAux' ? { sampleType: 'uint' } : name === 'uForestBrushAtlas' ? { sampleType: 'float', viewDimension: '2d-array' } : { sampleType: UNFILTERABLE.has(name) ? 'unfilterable-float' : 'float' },
    });
    const nearest: GPUBindGroupLayoutEntry = { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'non-filtering' } };
    const linear: GPUBindGroupLayoutEntry = { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } };
    const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.layouts = {
      terrain: device.createBindGroupLayout({ label: 'terrain', entries: [buffer(both), nearest, linear, ...TERRAIN_TEXTURES.map(texture)] }),
      river: device.createBindGroupLayout({ label: 'river', entries: [buffer(both), nearest, texture('uLake'), texture('uOverlay')] }),
      composite: device.createBindGroupLayout({ label: 'composite', entries: [linear, texture('uLayer')] }),
      water: device.createBindGroupLayout({ label: 'water', entries: [buffer(both), linear, texture('uLayer')] }),
    };
    this.pipelineLayouts = Object.fromEntries(Object.entries(this.layouts).map(([name, layout]) => [name, device.createPipelineLayout({ label: name, bindGroupLayouts: [layout] })])) as GpuShared['pipelineLayouts'];
  }
  /** A pipeline once created; starts its asynchronous creation on first request. `wait` creates it
   * synchronously instead (captures), as TerrainGl waits for the link. */
  pipeline(key: string, descriptor: () => GPURenderPipelineDescriptor, wait = false): GPURenderPipeline | undefined {
    let entry = this.pipelines.get(key);
    if (!entry) {
      const created: Pipeline = (entry = {}),
        started = performance.now();
      this.pipelines.set(key, created);
      this.device.createRenderPipelineAsync(descriptor()).then(
        pipeline => {
          console.debug(`WebGPU map pipeline ${key}: ${Math.round(performance.now() - started)} ms (async)`);
          created.pipeline = pipeline;
          for (const listener of this.listeners) listener();
        },
        error => {
          if (!created.pipeline) {
            created.failed = true;
            console.error(`WebGPU pipeline ${key}:`, error);
          }
        },
      );
    }
    if (entry.pipeline || entry.failed || !wait) return entry.pipeline;
    const started = performance.now();
    entry.pipeline = this.device.createRenderPipeline(descriptor());
    console.debug(`WebGPU map pipeline ${key}: ${Math.round(performance.now() - started)} ms (sync capture)`);
    return entry.pipeline;
  }
  adopt(key: string, pipeline: GPURenderPipeline): void {
    this.pipelines.set(key, { pipeline });
  }
  /** Resolves once a pipeline is created (or failed). */
  async settled(key: string): Promise<boolean> {
    for (;;) {
      const entry = this.pipelines.get(key);
      if (!entry || entry.failed || this.lost) return false;
      if (entry.pipeline) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  terrainKey(v: TerrainVariant, pass: 'map' | 'aux', blend: 'none' | 'alpha'): string {
    return `${pass}.${variantKey(v)}.${blend}`;
  }
  /** Map (or auxiliary) pipeline of a variant: the switches are overrides of the generated module. */
  terrainDescriptor(v: TerrainVariant, pass: 'map' | 'aux', blend: 'none' | 'alpha'): GPURenderPipelineDescriptor {
    const constants: Record<string, number> = { [WGSL.WGSL_OVERRIDES.uMode]: v.mode, [WGSL.WGSL_OVERRIDES.uRenderV2]: v.v2, [WGSL.WGSL_OVERRIDES.uForest]: +v.forest, [WGSL.WGSL_OVERRIDES.uForestBrushes]: +v.brushes };
    const module = pass === 'aux' ? this.modules.auxFs : hasAuxPass(v) ? this.modules.terrainAuxTextureFs : this.modules.terrainFs;
    return {
      label: this.terrainKey(v, pass, blend),
      layout: this.pipelineLayouts.terrain,
      vertex: { module: this.modules.terrainVs, entryPoint: 'main' },
      fragment: { module, entryPoint: 'main', constants, targets: [pass === 'aux' ? { format: 'rgba32uint' } : { format: MAP_FORMAT, blend: BLEND[blend] }] },
      primitive: { topology: 'triangle-strip' },
    };
  }
  simpleDescriptor(program: 'river' | 'composite' | 'water', blend: 'max' | 'over'): GPURenderPipelineDescriptor {
    const vertex: GPUVertexState =
      program === 'river'
        ? {
            module: this.modules.riverVs,
            entryPoint: 'main',
            buffers: [
              {
                arrayStride: 36,
                stepMode: 'instance',
                attributes: [
                  { shaderLocation: 0, offset: 0, format: 'float32x4' },
                  { shaderLocation: 1, offset: 16, format: 'float32x2' },
                  { shaderLocation: 2, offset: 24, format: 'float32x3' },
                ],
              },
            ],
          }
        : { module: this.modules.compositeVs, entryPoint: 'main' };
    const fs = program === 'river' ? this.modules.riverFs : program === 'water' ? this.modules.waterFs : this.modules.compositeFs;
    return { label: program, layout: this.pipelineLayouts[program], vertex, fragment: { module: fs, entryPoint: 'main', targets: [{ format: MAP_FORMAT, blend: BLEND[blend] }] }, primitive: { topology: 'triangle-strip' } };
  }
  presentDescriptor(opaque: boolean): GPURenderPipelineDescriptor {
    return {
      label: `present.${+opaque}`,
      layout: 'auto',
      vertex: { module: this.present, entryPoint: 'vs' },
      fragment: { module: this.present, entryPoint: 'fs', constants: { opaque: +opaque }, targets: [{ format: this.canvasFormat }] },
      primitive: { topology: 'triangle-strip' },
    };
  }
}

let shared: Promise<GpuShared | undefined> | undefined;
/** The device of `shared` once prepared: a later loss of an older device does not reset `shared`. */
let current: GpuShared | undefined;
/** Devices this module destroyed itself (a refused probe): their loss is expected. */
const destroyedHere = new WeakSet<GPUDevice>();
/** Prepares the page's WebGPU device, modules and start-up pipelines ahead of the first map (no canvas is
 * touched): they depend on no map, and the first display otherwise waits for them (seconds on D3D12). */
export function prepareTerrainGpu(): Promise<unknown> {
  return sharedGpu(false).catch(() => undefined);
}
/** The device and its shared objects, once per page (again after a device loss); undefined without a
 * usable (hardware) adapter unless `forced`. The preview pipeline is created before anything is returned:
 * a failure here keeps the WebGL2 path available (no canvas context has been taken yet). */
export function sharedGpu(forced: boolean): Promise<GpuShared | undefined> {
  return (shared ??= (async () => {
    if (!navigator.gpu) return undefined;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter || (adapter.info?.isFallbackAdapter && !forced)) return undefined;
    const device = await adapter.requestDevice({ label: 'terrain map', requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D } });
    let gpu: GpuShared;
    try {
      gpu = await prepare(device);
    } catch (error) {
      destroyedHere.add(device);
      device.destroy();
      throw error;
    }
    if (gpu.lost) throw new Error('WebGPU : appareil perdu pendant la préparation de la carte.');
    current = gpu;
    return gpu;
  })().catch(error => {
    shared = undefined;
    throw error;
  }));
}
/** Shared objects of a new device; throws if a module or the preview pipeline is refused. */
async function prepare(device: GPUDevice): Promise<GpuShared> {
  const gpu = new GpuShared(device);
  device.lost.then(info => {
    gpu.lost = true;
    if (destroyedHere.has(device)) return; // a refused probe
    if (current === gpu) {
      shared = undefined;
      current = undefined;
    }
    console.warn(`WebGPU map device lost (${info.reason}): ${info.message}`);
    for (const listener of [...gpu.lostListeners]) listener();
  });
  device.addEventListener('uncapturederror', event => console.error('WebGPU map:', (event as GPUUncapturedErrorEvent).error.message));
  for (const [key, module] of Object.entries(gpu.modules)) {
    const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(`WGSL ${key}: ${errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  }
  // Throws (GPUPipelineError) if the translated shaders or the layouts are refused.
  gpu.adopt(gpu.terrainKey(PREVIEW_VARIANT, 'map', 'none'), await device.createRenderPipelineAsync(gpu.terrainDescriptor(PREVIEW_VARIANT, 'map', 'none')));
  // The small programs are ready from the start, as TerrainGl compiles them in its constructor.
  const small: ['river' | 'composite' | 'water', 'max' | 'over'][] = [
    ['river', 'max'],
    ['composite', 'over'],
    ['water', 'over'],
  ];
  await Promise.all([
    ...small.map(async ([program, blend]) => gpu.adopt(program, await device.createRenderPipelineAsync(gpu.simpleDescriptor(program, blend)))),
    ...[true, false].map(async opaque => gpu.adopt(`present.${+opaque}`, await device.createRenderPipelineAsync(gpu.presentDescriptor(opaque)))),
  ]);
  return gpu;
}
