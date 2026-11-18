/**
 * WebGPU cavern roof, mushroom, tree and billboard recording, called by gpuFrame.
 * Reads/writes: Reads view instance streams, camera and lighting; writes parameter slots and render-pass commands through the supplied context.
 */
import { type FrameGeometry } from '../terrain3d';
import * as WGSL from '../terrain3dWgsl.generated';
import { TREE_VERTICES } from '../terrain3dTrees';
import { FUNGUS_LOD_VERTICES } from '../terrain3dFungi';
import { Params } from './gpuParameters';
import { T } from './gpuLayouts';
import { image } from './gpuImages';
import type { TerrainGpuContext } from './terrainGpuContext';

export function recordRoof(context: TerrainGpuContext, pass: GPURenderPassEncoder, frame: FrameGeometry): void {
  if (!context.roofShown() || !context.gpuRoof) return;
  const pipeline = context.pipeline('roof');
  if (!pipeline) return;
  const p = (context.roofParams ??= new Params(WGSL.WGSL3D_PARAMS.roof)),
    c = context.camera,
    glow = context.townGlowUniform();
  p.setArray('matrix', frame.matrix);
  p.set('cameraOrigin', c.x, frame.targetHeight, c.y);
  p.set('exaggeration', c.exaggeration);
  p.setArray('eye', frame.eye);
  p.setArray('uCavern', context.cavernParameters());
  p.setArray('uReveal', context.roofReveal());
  p.setArray('uTownGlow', glow.values);
  p.set('uTownGlowCount', glow.count);
  const slot = context.params.alloc(p.bytes);
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, context.device.createBindGroup({ layout: context.gpu.layouts.tree, entries: [{ binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } }] }));
  pass.setVertexBuffer(0, context.gpuRoof.vertices);
  pass.setIndexBuffer(context.gpuRoof.indices, 'uint32');
  pass.drawIndexed(context.roofCount);
}

export function recordFungi(context: TerrainGpuContext, pass: GPURenderPassEncoder, frame: FrameGeometry): void {
  if (!context.fungusCount || !context.gpuFungusBuffer || !context.groundSettings?.underdark) return;
  const pipeline = context.pipeline('fungus');
  if (!pipeline) return;
  const p = (context.fungusParams ??= new Params(WGSL.WGSL3D_PARAMS.fungus)),
    c = context.camera,
    glow = context.townGlowUniform();
  p.setArray('matrix', frame.matrix);
  p.set('cameraOrigin', c.x, frame.targetHeight, c.y);
  p.set('exaggeration', c.exaggeration);
  p.setArray('fungusFade', context.fungusFade());
  p.setArray('uReveal', context.roofShown() ? context.roofReveal() : [0, 0, 0, 1]);
  p.setArray('eye', frame.eye);
  p.setArray('uCavern', context.cavernParameters());
  p.setArray('uTownGlow', glow.values);
  p.set('uTownGlowCount', glow.count);
  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, context.gpuFungusBuffer);
  let first = 0;
  for (let lod = 0; lod < 3; lod++) {
    const count = context.fungusTiers[lod];
    if (!count) continue;
    p.set('fungusLod', lod);
    const slot = context.params.alloc(p.bytes);
    pass.setBindGroup(0, context.device.createBindGroup({ layout: context.gpu.layouts.tree, entries: [{ binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } }] }));
    pass.draw(FUNGUS_LOD_VERTICES[lod], count, 0, first);
    first += count;
  }
}

export function recordTrees(context: TerrainGpuContext, pass: GPURenderPassEncoder, frame: FrameGeometry): void {
  if (!context.treesShown() || !context.gpuTreeBuffer || context.groundSettings?.underdark) return;
  const pipeline = context.pipeline('tree');
  if (!pipeline) return;
  const p = context.treeParams,
    c = context.camera;
  p.setArray('matrix', frame.matrix);
  p.set('cameraOrigin', c.x, frame.targetHeight, c.y);
  p.set('exaggeration', c.exaggeration);
  p.setArray('treeFade', context.forestTreesUniform(frame));
  p.setArray('eye', frame.eye);
  p.setArray('treeLight', context.treeLight());
  p.set('fogDistance', context.fogDistance());
  p.set('uNight', context.lookSettings.ambience === 'night' ? 1 : 0);
  const slot = context.params.alloc(p.bytes);
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, context.device.createBindGroup({ layout: context.gpu.layouts.tree, entries: [{ binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } }] }));
  pass.setVertexBuffer(0, context.gpuTreeBuffer);
  pass.draw(TREE_VERTICES, context.treeCount);
}

export function recordBillboards(context: TerrainGpuContext, pass: GPURenderPassEncoder, frame: FrameGeometry, blend: number): boolean {
  if (!context.billboardCount || !context.gpuBillboardBuffer || !context.gpuBillboardAtlas || blend <= 0) return false;
  const pipeline = context.pipeline('billboard');
  if (!pipeline) return true;
  const p = context.billboardParams,
    c = context.camera;
  p.setArray('matrix', frame.matrix);
  p.set('cameraOrigin', c.x, frame.targetHeight, c.y);
  p.set('cameraRight', Math.cos(c.yaw), -Math.sin(c.yaw));
  p.set('exaggeration', c.exaggeration);
  p.set('raisedBlend', blend);
  p.setArray('eye', frame.eye);
  p.set('fogDistance', context.fogDistance());
  p.set('uNight', context.lookSettings.ambience === 'night' ? 1 : 0);
  const slot = context.params.alloc(p.bytes);
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    context.device.createBindGroup({
      layout: context.gpu.layouts.billboard,
      entries: [
        { binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } },
        { binding: 2, resource: context.gpu.billboardSampler },
        { binding: T.billboardAtlas, resource: image(context.gpuBillboardAtlas.texture).view },
      ],
    }),
  );
  pass.setVertexBuffer(0, context.gpuBillboardBuffer);
  pass.draw(6, context.billboardCount);
  return false;
}
