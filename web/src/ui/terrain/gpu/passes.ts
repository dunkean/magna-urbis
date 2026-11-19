/**
 * Water passes of a WebGPU ground redraw (the WebGL2 ones are gl/passes.ts): the river capsules (MAX-blended into
 * their own target), the retained water raster (copied flipped and premultiplied, GL rows as every target here), and
 * their composite over the destination as painted water or plain ink. Each pass is its own render pass of the frame's
 * command encoder; parameters go through the frame's storage slots.
 */
import { renderWaterRings } from '../../../render/renderWaterShader';
import { waterUniforms } from '../../../render/waterStyle';
import { styleTraits } from '../../../render/terrainStyle';
import { lightTerrainLook } from '../variant';
import { waterDrawn, type LookPalettes, type RedrawFrame } from '../redraw';
import { MAP_FORMAT, type GpuShared } from './device';
import { gpuTarget, type GpuImage, type GpuViewTargets, type Target } from './resources';
import type { Params } from './params';
import type { RetainedWaterSource } from '../retainedWater';
import type { TerrainLook } from '../contract';
import * as WGSL from '../../terrainWgsl.generated';

/** What the water passes of one redraw read; built once per draw. */
export interface GpuWaterPass {
  device: GPUDevice;
  gpu: GpuShared;
  encoder: GPUCommandEncoder;
  /** A storage slot of the frame holding `params` for one draw. */
  slot: (params: Params) => GPUBufferBinding;
  targets: GpuViewTargets;
  look: TerrainLook;
  frame: RedrawFrame;
  stylePixelRatio: number;
  water: LookPalettes['water'];
  /** The look paints its water (and is not the water-only capture). */
  painted: boolean;
  band: number;
  /** Captures create a missing pipeline synchronously. */
  wait: boolean;
  empty: GPUTextureView;
  lake?: GpuImage;
  lakeMode: number;
  lakeN: number;
  overlay?: GpuImage;
  riverParams: Params;
  waterParams: Params;
}

export const beginPass = (encoder: GPUCommandEncoder, target: GpuImage, clear: boolean, label: string): GPURenderPassEncoder =>
  encoder.beginRenderPass({ label, colorAttachments: [{ view: target.view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });

/** Premultiplied layer `source` over `destination`: plain copy, or the render style's painted water. */
export function composite(c: GpuWaterPass, source: GPUTextureView, destination: Target, painted: boolean, regime: boolean | number = false): void {
  const { device, gpu, frame } = c;
  const program = painted ? 'water' : 'composite';
  const pipeline = gpu.pipeline(program, () => gpu.simpleDescriptor(program, 'over'), c.wait);
  if (!pipeline) return;
  let bindGroup: GPUBindGroup;
  if (painted) {
    const w = c.waterParams,
      dpr = c.stylePixelRatio,
      palette = waterUniforms(c.water),
      rings = renderWaterRings(frame.px, c.band);
    w.vec2('uCanvas', frame.width, frame.height);
    w.vec2('uOrigin', frame.origin[0], frame.origin[1]);
    w.float('uPx', frame.px);
    w.float('uDpr', dpr);
    w.float('uBand', c.band);
    w.float('uBankPx', Math.min(6 * dpr, Math.max(1.5 * dpr, 7 / frame.px)));
    w.setArray('uRings', rings);
    w.int('uRingCount', rings.length);
    w.setArray('uWaterStops', palette.colors);
    w.setArray('uWaterStopT', palette.positions);
    w.int('uWaterStopCount', c.water.stops.length);
    w.int('uRegime', Number(regime));
    bindGroup = device.createBindGroup({
      layout: gpu.layouts.water,
      entries: [
        { binding: 0, resource: c.slot(w) },
        { binding: 2, resource: gpu.linear },
        { binding: WGSL.WGSL_TEXTURES.uLayer, resource: source },
      ],
    });
  } else
    bindGroup = device.createBindGroup({
      layout: gpu.layouts.composite,
      entries: [
        { binding: 2, resource: gpu.linear },
        { binding: WGSL.WGSL_TEXTURES.uLayer, resource: source },
      ],
    });
  const encoderPass = beginPass(c.encoder, destination, false, program);
  encoderPass.setPipeline(pipeline);
  encoderPass.setBindGroup(0, bindGroup);
  encoderPass.draw(4);
  encoderPass.end();
}

/** River capsules, MAX-blended so overlapping capsules cover like one stroke, then composited over `destination`.
 * Diagnostic colours (overlay) keep the plain composite. */
export function renderRivers(c: GpuWaterPass, rivers: { buffer?: GPUBuffer; count: number; regime: boolean }, destination: Target): void {
  if (!rivers.count || !rivers.buffer || !waterDrawn(c.look)) return;
  const { device, gpu, frame, look } = c;
  const pipeline = gpu.pipeline('river', () => gpu.simpleDescriptor('river', 'max'), c.wait);
  if (!pipeline) return;
  const target = (c.targets.river = gpuTarget(device, frame.width, frame.height, MAP_FORMAT, c.targets.river));
  const r = c.riverParams;
  r.vec2('uCanvas', frame.width, frame.height);
  r.vec2('uOrigin', frame.origin[0], frame.origin[1]);
  r.float('uPx', frame.px);
  r.float('uDpr', c.stylePixelRatio);
  r.int('uPhysicalWidth', styleTraits(look.style).physicalRiverWidth ? 1 : 0);
  r.float('uMapW', look.mapWidth);
  const flat = rivers.regime && !c.overlay && lightTerrainLook(look),
    color = waterUniforms(c.water).colors;
  r.vec4('uFlatWater', color[0], color[1], color[2], flat ? 1 : 0);
  r.int('uHasOverlay', c.overlay ? 1 : 0);
  r.int('uHasLake', c.lake ? c.lakeMode : 0);
  r.float('uLakeN', c.lakeN);
  const bindGroup = device.createBindGroup({
    layout: gpu.layouts.river,
    entries: [
      { binding: 0, resource: c.slot(r) },
      { binding: 1, resource: gpu.nearest },
      { binding: WGSL.WGSL_TEXTURES.uLake, resource: c.lake?.view ?? c.empty },
      { binding: WGSL.WGSL_TEXTURES.uOverlay, resource: c.overlay?.view ?? c.empty },
    ],
  });
  const encoderPass = beginPass(c.encoder, target, true, 'rivers');
  encoderPass.setPipeline(pipeline);
  encoderPass.setBindGroup(0, bindGroup);
  encoderPass.setVertexBuffer(0, rivers.buffer);
  encoderPass.draw(4, rivers.count);
  encoderPass.end();
  composite(c, target.view, destination, c.painted && !c.overlay, rivers.regime);
}

/** The retained water's viewport raster (repainted on Canvas 2D when the view changed), composited over `destination`. */
export function renderRetainedWater(c: GpuWaterPass, source: RetainedWaterSource, destination: Target): void {
  if (!source.paths.length || !waterDrawn(c.look)) return;
  const { device, frame, look, targets } = c,
    { width, height } = frame;
  const resized = targets.retainedWater?.width !== width || targets.retainedWater.height !== height;
  if (targets.retained.paint(source, frame.origin, frame.px, width, height, c.water.stops[0][1], c.painted, look.waterStyle ?? look.style, resized)) {
    if (resized) {
      targets.retainedWater?.texture.destroy();
      const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      targets.retainedWater = { texture, view: texture.createView(), width, height };
    }
    // GL rows (flipped) and premultiplied, as TerrainGl's upload.
    device.queue.copyExternalImageToTexture({ source: targets.retained.canvas!, flipY: true }, { texture: targets.retainedWater!.texture, premultipliedAlpha: true }, [width, height]);
  }
  composite(c, targets.retainedWater!.view, destination, c.painted, targets.retained.coded);
}
