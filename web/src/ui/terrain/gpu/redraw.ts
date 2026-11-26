/**
 * One WebGPU ground redraw (passes listed in terrain/redraw.ts) for a request: the live view, a world tile or a
 * capture each pass their own look, view, layers, targets and surface. One command encoder per redraw; every draw's
 * parameters go into a slot of the frame's storage buffer, written once before the submit. Owns the device-side
 * objects of the passes: the parameter block images (Params), the texture records of the map and auxiliary passes,
 * the bind group entries, the slots, the live view's targets, the empty auxiliary image and the brush atlas. Built by
 * TerrainGpu for each device.
 */
import { displayQualityUniform } from '../../../render/displayQuality';
import { setSeasonCalendarGpu } from '../../../../../rust/bridge/terrainRenderV2Zones';
import { dropHiddenDetails } from '../layers';
import { hasAuxPass, terrainDrawQuality } from '../variant';
import { detailQuad, fadeProgress, lookPalettes, paintedWaterLook, redrawFrame, separateWaterLayer, waterBand, type RedrawFrame, type ViewState } from '../redraw';
import { writeFieldParams, writeLookParams, writeMapParamsAfterWaterLayer, writeWaterLayerParams, type LookBindings, type LookParamsState, type LookTexture } from '../lookParams';
import { MAP_FORMAT, TERRAIN_TEXTURES, type GpuShared } from './device';
import { Params } from './params';
import { GpuBrushAtlas } from './brushes';
import { GpuViewTargets, gpuImage, gpuTarget, releaseGpuLayer, releaseImage, type GpuHeightLayer, type GpuImage, type Surface } from './resources';
import { beginPass, renderRetainedWater, renderRivers, type GpuWaterPass } from './passes';
import type { GpuInputs } from './inputs';
import type { GpuPipelines } from './pipelines';
import type { TerrainLook } from '../contract';
import * as WGSL from '../../terrainWgsl.generated';

/** What one draw draws, and where. */
export interface GpuDrawRequest {
  look: TerrainLook;
  view: ViewState;
  details: GpuHeightLayer[];
  enhanced: GpuHeightLayer[];
  /** Framebuffer pixel ratio, and the ratio of the CSS-pixel strokes (uDpr). */
  pixelRatio: number;
  stylePixelRatio: number;
  /** Where the frame ends: the display canvas, the world-tile canvas or the capture canvas. */
  surface: Surface;
  /** Not the display canvas: captures force full quality, live world tiles retain display quality. */
  offscreen: boolean;
  targets: GpuViewTargets;
  /** The look's own pipelines, created synchronously when missing (redrawForCapture, captures). */
  wait: boolean;
  /** redrawForCapture: no idle preparation starts from it. */
  capturing: boolean;
  /** A world tile: the display canvas and its fallback presentation stay as they are. */
  tile: boolean;
}

export interface GpuRedrawHooks {
  /** A draw on the display canvas: the fallback presentation of the previous frame is stale. */
  displayDrawn(): void;
  alive(): boolean;
  /** A layer is still fading in: draw again next frame. */
  animate(): void;
  /** A cast-shadow bake for a new light azimuth has landed in the shore ring (one function, registered once). */
  shoreRingBaked: () => void;
}

const PRESENT_KEYS = ['present.0', 'present.1'];

export class GpuRedraw {
  /** Intermediate targets of the live view (world tiles keep theirs, GpuWorldTiles). */
  readonly liveTargets = new GpuViewTargets();
  /** Last frame's GPU submission time, ms (CPU side). */
  drawMs = 0;
  private readonly device: GPUDevice;
  private ownerTexture?: GpuImage;
  private ownerImage?: TerrainLook['treeOwners'];
  private readonly emptyUint: GpuImage;
  private readonly brushAtlas: GpuBrushAtlas;
  private readonly terrainParams = new Params(WGSL.WGSL_PARAMS.terrain);
  private readonly riverParams = new Params(WGSL.WGSL_PARAMS.river);
  private readonly waterParams = new Params(WGSL.WGSL_PARAMS.water);
  /** The terrain parameters while the auxiliary pass writes its own (restored after it). */
  private readonly savedParams = new Uint8Array(this.terrainParams.bytes.length);
  /** Texture views of the map program by uniform name (TerrainGl's texture units): the map pass's, the auxiliary
   * pass's, and the one the look bindings write into. */
  private readonly mapTextures: Record<string, GPUTextureView> = {};
  private readonly auxTextures: Record<string, GPUTextureView> = {};
  private textures = this.mapTextures;
  /** Bind group entries of the map program, refilled for each draw. */
  private readonly terrainEntries: GPUBindGroupEntry[];
  private readonly params: LookBindings;
  /** Per-frame storage slots of the draws' parameters (written once before the frame's submit). */
  private readonly slots: { buffer: GPUBuffer; staging: Uint8Array<ArrayBuffer>; used: number; align: number; slotSize: number };
  private readonly slot = (params: Params): GPUBufferBinding => {
    const s = this.slots,
      offset = Math.ceil(s.used / s.align) * s.align;
    if (offset + s.slotSize > s.staging.length) throw new Error('WebGPU map: too many draws in one frame');
    s.staging.set(params.bytes, offset);
    s.used = offset + params.bytes.length;
    return { buffer: s.buffer, offset, size: params.bytes.length };
  };
  /** The request being drawn (the look bindings read its refinements and look). */
  private request?: GpuDrawRequest;
  private readonly quad = [0, 0, 0, 0];

  constructor(
    private readonly gpu: GpuShared,
    private readonly pipelines: GpuPipelines,
    private readonly inputs: GpuInputs,
    private readonly hooks: GpuRedrawHooks,
  ) {
    const device = (this.device = gpu.device);
    this.emptyUint = gpuImage(device, 1, 1, 'rgba32uint', new Uint32Array(4), 16);
    this.brushAtlas = new GpuBrushAtlas(device);
    this.terrainEntries = [{ binding: 0, resource: { buffer: undefined! } }, { binding: 1, resource: gpu.nearest }, { binding: 2, resource: gpu.linear }, ...TERRAIN_TEXTURES.map(name => ({ binding: WGSL.WGSL_TEXTURES[name], resource: undefined! as GPUTextureView }))];
    const align = device.limits.minStorageBufferOffsetAlignment;
    const slotSize = Math.ceil(Math.max(...Object.values(WGSL.WGSL_PARAMS).map(p => p.size)) / align) * align,
      count = 64;
    this.slots = { buffer: device.createBuffer({ label: 'map parameters', size: slotSize * count, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), staging: new Uint8Array(slotSize * count), used: 0, align, slotSize };
    this.params = this.paramBindings();
  }

  /** The look block (lookParams.ts) into terrainParams and the current texture record. */
  private paramBindings(): LookBindings {
    const p = this.terrainParams,
      inputs = this.inputs;
    const viewOf = (texture: LookTexture): GPUTextureView => {
      const empty = inputs.empty.view;
      switch (texture) {
        case 'refined':
          return this.request!.enhanced.at(-1)?.view ?? empty;
        case 'previousRefined':
          return this.request!.enhanced.at(-2)?.view ?? empty;
        case 'coast':
          return inputs.coastDistance?.view ?? empty;
        case 'lake':
          return inputs.lake?.view ?? empty;
        case 'overlay':
          return inputs.overlay?.view ?? empty;
        case 'emptyAux':
          return this.emptyUint.view;
      }
    };
    return {
      int: (name, v) => p.int(name, v),
      uint: (name, v) => p.uint(name, v),
      float: (name, v) => p.float(name, v),
      vec2: (name, x, y) => p.vec2(name, x, y),
      vec3: (name, x, y, z) => p.vec3(name, x, y, z),
      vec4: (name, x, y, z, w) => p.vec4(name, x, y, z, w),
      floats: (name, size, values) => p.floats(name, size, values),
      texture: (name, _unit, texture) => {
        this.textures[name] = viewOf(texture);
      },
      sampler: () => {},
      forest: enabled => {
        const field = enabled ? inputs.forest : undefined,
          applied = inputs.occupation,
          empty = inputs.empty.view,
          textures = this.textures;
        textures.uForestField = field?.texture.view ?? empty;
        p.vec3('uForestRect', field?.field.x ?? 0, field?.field.y ?? 0, field?.field.width ?? 1);
        textures.uForestBank = field?.bank?.view ?? empty;
        p.int('uHasForestBank', field?.bank ? 1 : 0);
        p.float('uForestBankDensity', field?.field.bankDensity ?? 1);
        const beach = field?.field.beach;
        textures.uForestBeach = field?.beach?.view ?? empty;
        p.int('uHasForestBeach', field?.beach ? 1 : 0);
        p.vec3('uForestBeachRect', beach?.x ?? 0, beach?.y ?? 0, beach?.width ?? 1);
        textures.uOccupation = applied?.image.view ?? empty;
        p.int('uHasOccupation', applied ? 1 : 0);
        p.vec3('uOccupationRect', applied?.data.x ?? 0, applied?.data.y ?? 0, applied?.data.width ?? 1);
        p.float('uOccupationN', applied?.data.n ?? 1);
      },
      landDetail: () => {
        const detail = inputs.landDetail;
        this.textures.uLandDetail = detail?.image.view ?? inputs.empty.view;
        p.int('uHasLandDetail', detail ? 1 : 0);
        p.vec3('uLandDetailRect', detail?.data.x ?? 0, detail?.data.y ?? 0, detail?.data.width ?? 1);
        p.float('uLandDetailN', detail?.data.n ?? 1);
      },
      shoreRing: mode => {
        if (mode >= 2) inputs.updateShoreRing(this.request!.look.lighting.azimuth, this.hooks.shoreRingBaked);
        const ring = inputs.shoreRing;
        this.textures.uShoreRing = ring?.image.view ?? inputs.empty.view;
        p.vec3('uShoreRingRect', ring?.x ?? 0, ring?.y ?? 0, ring?.width ?? 1);
      },
      landBackdrop: on => {
        const backdrop = on ? inputs.landBackdrop : undefined;
        p.int('uHasLandBackdrop', backdrop ? 1 : 0);
        if (backdrop) this.textures.uShoreRing = backdrop.view;
      },
      brushes: (enabled, crownDetail, treeSymbols) => {
        this.textures.uForestBrushAtlas = this.brushAtlas.bind(enabled, crownDetail, treeSymbols);
        p.int('uCrownClumps', this.brushAtlas.crownClumps);
      },
      seasonCalendar: (zone, calendar) => setSeasonCalendarGpu(p, zone, calendar),
    };
  }
  /** The look block into `record` (every texture reset to its empty binding first). Returns uRefinedAlpha. */
  private writeLook(record: Record<string, GPUTextureView>, state: LookParamsState): number {
    const empty = this.inputs.empty.view;
    for (const name of TERRAIN_TEXTURES) record[name] = empty;
    record.uForestBrushAtlas = this.brushAtlas.placeholder;
    record.uAux = this.emptyUint.view;
    this.textures = record;
    return writeLookParams(this.params, state);
  }
  private terrainBindGroup(): GPUBindGroup {
    const entries = this.terrainEntries,
      textures = this.textures;
    entries[0].resource = this.slot(this.terrainParams);
    for (let i = 0; i < TERRAIN_TEXTURES.length; i++) entries[3 + i].resource = textures[TERRAIN_TEXTURES[i]];
    return this.device.createBindGroup({ layout: this.gpu.layouts.terrain, entries });
  }
  /** One height layer (as GlRedraw.drawLayer); details need the variant's blending pipeline. Returns true while it fades. */
  private drawLayer(encoderPass: GPURenderPassEncoder, layer: GpuHeightLayer, base: boolean, pipeline: GPURenderPipeline | undefined, frame: RedrawFrame, now: number): boolean {
    const p = this.terrainParams;
    this.textures.uField = layer.view;
    this.textures.uCave = layer.caveView ?? this.inputs.empty.view;
    writeFieldParams(p, layer, base);
    let fading = false;
    if (base) {
      p.float('uAlpha', 1);
      p.vec4('uQuad', 0, 0, frame.width, frame.height);
    } else {
      const alpha = fadeProgress(now, layer.fadeStart);
      fading = alpha < 1;
      p.float('uAlpha', 1 - (1 - alpha) ** 2);
      const q = detailQuad(layer.layer, frame, this.quad);
      p.vec4('uQuad', q[0], q[1], q[2], q[3]);
    }
    if (!pipeline) return fading;
    encoderPass.setPipeline(pipeline);
    encoderPass.setBindGroup(0, this.terrainBindGroup());
    encoderPass.draw(4);
    return fading;
  }

  /** Draws `req`; false when nothing could be drawn (no base, lost device, no pipeline yet). */
  draw(req: GpuDrawRequest): boolean {
    if (req.capturing) req = { ...req, look: { ...req.look, displayLight: false } };
    // A world tile leaves the display canvas as it is: its CSS-transformed picture stays valid.
    if (!req.tile) this.hooks.displayDrawn();
    if (!this.hooks.alive() || !this.inputs.base || this.gpu.lost) return false;
    const look = req.look;
    const quality = terrainDrawQuality(look, displayQualityUniform(!(req.capturing || (req.offscreen && !req.tile) || req.wait || look.mesh3d === true)));
    const chosen = this.pipelines.map(look, req.wait, req.capturing);
    if (!chosen) return false;
    this.request = req;
    try {
      this.drawWith(req, chosen, quality, this.inputs.base);
    } finally {
      this.request = undefined;
    }
    return true;
  }
  private drawWith(req: GpuDrawRequest, chosen: NonNullable<ReturnType<GpuPipelines['map']>>, quality: number, base: GpuHeightLayer): void {
    const { look, surface, targets, wait } = req,
      device = this.device,
      inputs = this.inputs;
    const started = performance.now();
    const dpr = req.pixelRatio,
      frame = redrawFrame(req.view, dpr),
      { width, height } = frame;
    if (surface.canvas.width !== width || surface.canvas.height !== height) {
      surface.canvas.width = width;
      surface.canvas.height = height;
    }
    const palettes = lookPalettes(look),
      v = this.pipelines.lookVariant(look),
      p = this.terrainParams;
    this.slots.used = 0;
    const encoder = device.createCommandEncoder({ label: 'terrain map' });
    const mapTarget = (targets.map = gpuTarget(device, width, height, MAP_FORMAT, targets.map));
    const state: LookParamsState = {
      look,
      quality,
      frame,
      stylePixelRatio: req.stylePixelRatio,
      dpr,
      scale: req.view.view.scale,
      palettes,
      mode: v.mode,
      forest: v.forest,
      base: base.layer,
      refined: req.enhanced.at(-1),
      previousRefined: req.enhanced.at(-2),
      coastal: !!inputs.coastDistance,
      sea: inputs.seaSurface,
      lake: inputs.lake ? inputs.lakeMode : 0,
      lakeN: inputs.lakeN,
      overlay: !!inputs.overlay,
      city: inputs.retainedWater.city,
    };
    let animating = this.writeLook(this.mapTextures, state) < 1;
    const now = performance.now();
    const water: GpuWaterPass = {
      device,
      gpu: this.gpu,
      encoder,
      slot: this.slot,
      targets,
      look,
      frame,
      stylePixelRatio: req.stylePixelRatio,
      water: palettes.water,
      painted: quality === 0 && paintedWaterLook(look) && !look.groundCapture,
      band: waterBand(look, inputs.seaSurface, palettes.water),
      wait,
      empty: inputs.empty.view,
      lake: inputs.lake,
      lakeMode: inputs.lakeMode,
      lakeN: inputs.lakeN,
      overlay: inputs.overlay,
      riverParams: this.riverParams,
      waterParams: this.waterParams,
    };
    const rivers = { buffer: inputs.riverBuffer, count: inputs.riverCount, regime: inputs.riverRegime };
    const separateWater = quality === 0 && separateWaterLayer(look, v.forest);
    p.int('uUseWaterLayer', 0);
    if (separateWater) {
      const waterTarget = (targets.water = gpuTarget(device, width, height, MAP_FORMAT, targets.water));
      writeWaterLayerParams(p);
      const waterPass = beginPass(encoder, waterTarget, true, 'water layer');
      this.drawLayer(waterPass, base, true, chosen.pipeline, frame, now);
      waterPass.end();
      renderRivers(water, rivers, waterTarget);
      renderRetainedWater(water, inputs.retainedWater, waterTarget);
      writeMapParamsAfterWaterLayer(p, look, !!inputs.overlay);
      this.mapTextures.uWaterLayer = waterTarget.view;
      p.int('uUseWaterLayer', 1);
    }
    // Auxiliary pass (as GlRedraw.renderAux): rendered only when its inputs changed.
    if (hasAuxPass(v)) {
      const aux = this.pipelines.terrain(v, 'aux', 'none', wait);
      if (targets.aux?.width !== width || targets.aux.height !== height) targets.auxKey.invalidate();
      if (aux) {
        const key = targets.auxKey.scratch();
        key.length = 0;
        key.push(quality, width, height, frame.origin, frame.px, look.seed, look.climate, look.lighting, look.v2Season, look.v2Calendar, look.layers, look.refinement3d, look.mesh3d, look.style, look.waterLook);
        key.push(inputs.forestVersion, inputs.riverCount, inputs.retainedWater.key, inputs.lakeN, separateWater, base.layer.width, base.layer.n, req.enhanced.at(-1)?.fadeStart, inputs.coastDistance ? 1 : 0);
        if (targets.auxKey.changed()) {
          targets.aux = gpuTarget(device, width, height, 'rgba32uint', targets.aux);
          this.savedParams.set(p.bytes);
          this.writeLook(this.auxTextures, state);
          const owners = look.treeOwners;
          if (owners && owners !== 'stands') {
            if (this.ownerImage !== owners) {
              releaseImage(this.ownerTexture);
              this.ownerTexture = gpuImage(device, owners.width, owners.height, 'rg32uint', owners.data, 8);
              this.ownerImage = owners;
            }
            this.auxTextures.uAux = this.ownerTexture!.view;
          }
          this.auxTextures.uWaterLayer = this.mapTextures.uWaterLayer;
          p.int('uUseWaterLayer', separateWater ? 1 : 0);
          const auxPass = beginPass(encoder, targets.aux, true, 'auxiliary');
          this.drawLayer(auxPass, base, true, aux, frame, now);
          auxPass.end();
          p.bytes.set(this.savedParams);
          this.textures = this.mapTextures;
          targets.auxKey.store();
        }
      }
      this.mapTextures.uAux = aux && targets.aux ? targets.aux.view : this.emptyUint.view;
      p.int('uHasAux', aux ? 1 : 0);
    }
    const mapPass = beginPass(encoder, mapTarget, true, 'map');
    this.drawLayer(mapPass, base, true, chosen.pipeline, frame, now);
    if (req.details.length) {
      const blended = this.pipelines.terrain(chosen.variant, 'map', 'alpha', wait);
      for (const detail of req.details) animating = this.drawLayer(mapPass, detail, false, blended, frame, now) || animating;
    }
    mapPass.end();
    // The live view's details: a detail fully faded in hides (and releases) the older ones.
    if (req.details === inputs.details) inputs.details = dropHiddenDetails(inputs.details, now, releaseGpuLayer);
    if (!separateWater) {
      renderRivers(water, rivers, mapTarget);
      renderRetainedWater(water, inputs.retainedWater, mapTarget);
    }
    // Present: GL rows flipped onto the canvas.
    const present = this.gpu.pipeline(PRESENT_KEYS[+surface.opaque], () => this.gpu.presentDescriptor(surface.opaque), true)!;
    const presentPass = encoder.beginRenderPass({ label: 'present', colorAttachments: [{ view: surface.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    presentPass.setPipeline(present);
    presentPass.setBindGroup(0, device.createBindGroup({ layout: present.getBindGroupLayout(0), entries: [{ binding: 0, resource: mapTarget.view }] }));
    presentPass.draw(4);
    presentPass.end();
    device.queue.writeBuffer(this.slots.buffer, 0, this.slots.staging, 0, Math.max(4, this.slots.used));
    device.queue.submit([encoder.finish()]);
    this.drawMs = performance.now() - started;
    if (animating) this.hooks.animate();
  }

  dispose(): void {
    this.liveTargets.dispose();
    releaseImage(this.ownerTexture);
    releaseImage(this.emptyUint);
    this.brushAtlas.dispose();
    this.slots.buffer.destroy();
  }
}
