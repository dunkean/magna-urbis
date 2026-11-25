/**
 * The WebGPU device shared by every 3D view of the page: pipelines by program and sample count (created
 * asynchronously, with stand-ins), layouts, samplers, mipmap rendering, depth readback, readiness and loss listeners.
 */
import * as WGSL from '../../terrain3dWgsl.generated';
import { MIP_WGSL, DEPTH_WGSL, T, TERRAIN_TEXTURES, SAMPLES, DEPTH, ROOF_BUFFERS, TREE_BUFFERS, BILLBOARD_BUFFERS, BUILDING_BUFFERS, PATCH_BUFFERS } from './layouts';

type Entry = { pipeline?: GPURenderPipeline; failed?: boolean };

// Natural water is a runtime parameter (uNaturalWater), not a pipeline: Satellite and Satellite-2 share one ground.
// The Underdark ground is its own pipeline (override uUnderdark): ordinary maps compile none of it.
export const groundKey = (ground: number, v2: number, forest: number, brushes: number, underdark = 0): string => `ground.${ground}.${v2}.${forest}.${brushes}.${underdark}`;

export const PREVIEW_GROUND = groundKey(0, 0, 0, 0);

/** Device-wide objects of the 3D view: modules, layouts, samplers, pipelines. */
export class Gpu3d {
  readonly format = navigator.gpu.getPreferredCanvasFormat();
  readonly modules: Record<string, GPUShaderModule> = {};
  readonly layouts: Record<'terrain' | 'sky' | 'building' | 'billboard' | 'tree', GPUBindGroupLayout>;
  readonly pipelineLayouts: Record<'terrain' | 'sky' | 'building' | 'billboard' | 'tree', GPUPipelineLayout>;
  readonly billboardSampler: GPUSampler;
  readonly samplers: { nearest: GPUSampler; linear: GPUSampler; aniso: GPUSampler; repeat: GPUSampler };
  readonly mip: GPUShaderModule;
  readonly depth: GPUShaderModule;
  private pipelines = new Map<string, Entry>();
  readonly listeners = new Set<() => void>();
  /** Views to recover when the device is lost (not destroyed by this module). */
  readonly lostListeners = new Set<() => void>();
  lost = false;
  constructor(readonly device: GPUDevice) {
    for (const key of ['terrainVs', 'groundFs', 'mapFs', 'skyVs', 'skyFs', 'buildingColorVs', 'buildingColorFs', 'buildingTexVs', 'buildingTexFs', 'billboardVs', 'billboardFs', 'treeVs', 'treeFs'] as const)
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
    this.billboardSampler = device.createSampler({ label: 'relief brushes', ...linear, lodMaxClamp: 4 });
    const F = GPUShaderStage.FRAGMENT,
      both = GPUShaderStage.VERTEX | F;
    const texture = (name: string): GPUBindGroupLayoutEntry => ({
      binding: T[name],
      visibility: F,
      texture: name === 'macroField' ? { sampleType: 'unfilterable-float' } : name === 'uForestBrushAtlas' || name === 'uHouseSurface' || name === 'albedoTex' || name === 'normalTex' ? { sampleType: 'float', viewDimension: '2d-array' } : { sampleType: 'float' },
    });
    const sampler = (binding: number, type: GPUSamplerBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility: F, sampler: { type } });
    this.layouts = {
      terrain: device.createBindGroupLayout({ label: 'terrain 3d', entries: [{ binding: 0, visibility: both, buffer: { type: 'read-only-storage' } }, sampler(1, 'non-filtering'), sampler(2, 'filtering'), sampler(3, 'filtering'), ...TERRAIN_TEXTURES.map(texture)] }),
      sky: device.createBindGroupLayout({ label: 'sky', entries: [{ binding: 0, visibility: both, buffer: { type: 'read-only-storage' } }] }),
      building: device.createBindGroupLayout({ label: 'buildings 3d', entries: [{ binding: 0, visibility: both, buffer: { type: 'read-only-storage', hasDynamicOffset: true } }, sampler(4, 'filtering'), texture('albedoTex'), texture('normalTex'), texture('uHouseSurface')] }),
      tree: device.createBindGroupLayout({ label: 'near trees', entries: [{ binding: 0, visibility: both, buffer: { type: 'read-only-storage' } }] }),
      billboard: device.createBindGroupLayout({ label: 'relief brushes', entries: [{ binding: 0, visibility: both, buffer: { type: 'read-only-storage' } }, sampler(2, 'filtering'), texture('billboardAtlas')] }),
    };
    this.pipelineLayouts = Object.fromEntries(Object.entries(this.layouts).map(([name, layout]) => [name, device.createPipelineLayout({ label: name, bindGroupLayouts: [layout] })])) as Gpu3d['pipelineLayouts'];
  }
  /** A pipeline once created; its asynchronous creation starts on first request. */
  pipeline(key: string, samples = SAMPLES): GPURenderPipeline | undefined {
    const cacheKey = `${samples}:${key}`;
    let entry = this.pipelines.get(cacheKey);
    if (!entry) {
      const created: Entry = (entry = {}),
        started = performance.now();
      this.pipelines.set(cacheKey, created);
      this.device.createRenderPipelineAsync(this.descriptor(key, samples)).then(
        pipeline => {
          console.debug(`WebGPU 3D pipeline ${key}: ${Math.round(performance.now() - started)} ms`);
          created.pipeline = pipeline;
          for (const listener of this.listeners) listener();
        },
        error => {
          created.failed = true;
          if (!this.lost) console.error(`WebGPU 3D pipeline ${key}:`, error);
        },
      );
    }
    return entry.pipeline;
  }
  async adopt(key: string, samples = SAMPLES): Promise<void> {
    const started = performance.now();
    this.pipelines.set(`${samples}:${key}`, { pipeline: await this.device.createRenderPipelineAsync(this.descriptor(key, samples)) });
    console.debug(`WebGPU 3D pipeline ${key}: ${Math.round(performance.now() - started)} ms (prepare)`);
  }
  ready(key: string, samples: number): boolean {
    return !!this.pipelines.get(`${samples}:${key}`)?.pipeline;
  }
  /** Complete a requested look before it is captured or first shown. */
  async settled(key: string, samples = SAMPLES): Promise<void> {
    for (;;) {
      if (this.lost) throw new Error('WebGPU 3D device lost while preparing the ground.');
      if (this.pipeline(key, samples)) return;
      if (this.pipelines.get(`${samples}:${key}`)?.failed) throw new Error(`WebGPU 3D pipeline ${key} failed.`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  private descriptor(key: string, samples: number): GPURenderPipelineDescriptor {
    const multisample = { count: samples },
      target = [{ format: this.format }];
    const depthStencil = (write: boolean): GPUDepthStencilState => ({ format: DEPTH, depthWriteEnabled: write, depthCompare: write ? 'less-equal' : 'always' });
    if (key === 'sky') return { label: key, layout: this.pipelineLayouts.sky, vertex: { module: this.modules.skyVs, entryPoint: 'main' }, fragment: { module: this.modules.skyFs, entryPoint: 'main', targets: target }, depthStencil: depthStencil(false), multisample };
    // Underdark mushrooms: their modules are created with their first pipeline, so ordinary maps compile none of it.
    // The cave roof (Underdark): one mesh, created with its first pipeline.
    if (key === 'roof') {
      this.modules.roofVs ??= this.device.createShaderModule({ label: 'roofVs', code: WGSL.roofVs });
      this.modules.roofFs ??= this.device.createShaderModule({ label: 'roofFs', code: WGSL.roofFs });
      return { label: key, layout: this.pipelineLayouts.tree, vertex: { module: this.modules.roofVs, entryPoint: 'main', buffers: ROOF_BUFFERS }, fragment: { module: this.modules.roofFs, entryPoint: 'main', targets: target }, depthStencil: depthStencil(true), multisample };
    }
    if (key === 'fungus') {
      this.modules.fungusVs ??= this.device.createShaderModule({ label: 'fungusVs', code: WGSL.fungusVs });
      this.modules.fungusFs ??= this.device.createShaderModule({ label: 'fungusFs', code: WGSL.fungusFs });
      return { label: key, layout: this.pipelineLayouts.tree, vertex: { module: this.modules.fungusVs, entryPoint: 'main', buffers: TREE_BUFFERS }, fragment: { module: this.modules.fungusFs, entryPoint: 'main', targets: target }, depthStencil: depthStencil(true), multisample };
    }
    if (key === 'tree')
      return { label: key, layout: this.pipelineLayouts.tree, vertex: { module: this.modules.treeVs, entryPoint: 'main', buffers: TREE_BUFFERS }, fragment: { module: this.modules.treeFs, entryPoint: 'main', targets: target }, depthStencil: depthStencil(true), multisample };
    if (key === 'billboard')
      return {
        label: key,
        layout: this.pipelineLayouts.billboard,
        vertex: { module: this.modules.billboardVs, entryPoint: 'main', buffers: BILLBOARD_BUFFERS },
        fragment: { module: this.modules.billboardFs, entryPoint: 'main', targets: target },
        depthStencil: depthStencil(true),
        multisample: { count: samples, alphaToCoverageEnabled: samples > 1 },
      };
    if (key.startsWith('buildingColor') || key.startsWith('buildingTex')) {
      const kind = key.startsWith('buildingTex') ? 'tex' : 'color',
        vs = kind === 'tex' ? 'buildingTexVs' : 'buildingColorVs',
        fs = kind === 'tex' ? 'buildingTexFs' : 'buildingColorFs';
      return {
        label: key,
        layout: this.pipelineLayouts.building,
        vertex: { module: this.modules[vs], entryPoint: 'main', buffers: BUILDING_BUFFERS[kind] },
        fragment: { module: this.modules[fs], entryPoint: 'main', targets: target },
        depthStencil: { ...depthStencil(true), ...(key.endsWith('.snow') ? { depthBias: -2, depthBiasSlopeScale: -1 } : {}) },
        multisample,
      };
    }
    const vertex: GPUVertexState = { module: this.modules.terrainVs, entryPoint: 'main', buffers: PATCH_BUFFERS };
    if (key === 'map') return { label: key, layout: this.pipelineLayouts.terrain, vertex, fragment: { module: this.modules.mapFs, entryPoint: 'main', targets: target }, depthStencil: depthStencil(true), multisample };
    const [ground, v2, forest, brushes, underdark] = key.split('.').slice(1).map(Number),
      o = WGSL.WGSL3D_OVERRIDES;
    return {
      label: key,
      layout: this.pipelineLayouts.terrain,
      vertex,
      depthStencil: depthStencil(true),
      multisample,
      fragment: { module: this.modules.groundFs, entryPoint: 'main', targets: target, constants: { [o.groundEnabled]: ground, [o.uRenderV2]: v2, [o.uForest]: forest, [o.uForestBrushes]: brushes, [o.uUnderdark]: underdark } },
    };
  }
  private mipPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  /** Fills mip levels 1.. of every layer of a 2D (array) texture from level 0. */
  generateMipmaps(texture: GPUTexture): void {
    if (texture.mipLevelCount < 2) return;
    let pipeline = this.mipPipelines.get(texture.format);
    if (!pipeline)
      this.mipPipelines.set(
        texture.format,
        (pipeline = this.device.createRenderPipeline({ label: `mipmaps ${texture.format}`, layout: 'auto', vertex: { module: this.mip, entryPoint: 'vs' }, fragment: { module: this.mip, entryPoint: 'fs', targets: [{ format: texture.format }] } })),
      );
    const encoder = this.device.createCommandEncoder({ label: 'mipmaps' });
    for (let layer = 0; layer < texture.depthOrArrayLayers; layer++)
      for (let level = 1; level < texture.mipLevelCount; level++) {
        const view = (mip: number): GPUTextureView => texture.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: view(level), loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(
          0,
          this.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: view(level - 1) },
              { binding: 1, resource: this.samplers.linear },
            ],
          }),
        );
        pass.draw(3);
        pass.end();
      }
    this.device.queue.submit([encoder.finish()]);
  }
  private depthPipeline?: GPURenderPipeline;
  depthReadback(): GPURenderPipeline {
    return (this.depthPipeline ??= this.device.createRenderPipeline({ label: 'depth readback', layout: 'auto', vertex: { module: this.depth, entryPoint: 'vs' }, fragment: { module: this.depth, entryPoint: 'fs', targets: [{ format: 'r32float' }] } }));
  }
}
