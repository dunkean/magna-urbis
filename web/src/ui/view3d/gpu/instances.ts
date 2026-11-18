/**
 * Instanced passes of the WebGPU terrain view recorded after the ground: near trees, the Underdark roof and mushrooms,
 * and the raised illustration stamps. Each owns its instance buffer and parameter block, filled from the stream its
 * part built; the shaders are the WebGL2 ones translated to WGSL.
 */
import * as WGSL from '../../terrain3dWgsl.generated';
import { TREE_VERTICES } from '../../terrain3dTrees';
import { FUNGUS_LOD_VERTICES } from '../../terrain3dFungi';
import { Params, type Pool } from './parameters';
import { T } from './layouts';
import { image } from './images';
import type { Gpu3d } from './device';
import type { TerrainViewContext } from '../terrain/context';
import type { FrameGeometry } from '../terrain/contract';
import type { TerrainParts } from '../terrain/parts';

export class GpuInstances {
  private readonly treeParams = new Params(WGSL.WGSL3D_PARAMS.tree);
  private readonly billboardParams = new Params(WGSL.WGSL3D_PARAMS.billboard);
  private fungusParams?: Params;
  private roofParams?: Params;
  private treeBuffer?: GPUBuffer;
  private fungusBuffer?: GPUBuffer;
  private roof?: { vertices: GPUBuffer; indices: GPUBuffer };
  private billboardBuffer?: GPUBuffer;
  private billboardAtlas?: { source: HTMLCanvasElement; texture: WebGLTexture };

  constructor(
    private readonly gpu: Gpu3d,
    private readonly context: TerrainViewContext,
    private readonly parts: TerrainParts,
    /** The pipeline of a program at the frame's sample count (created on first request). */
    private readonly pipeline: (key: string) => GPURenderPipeline | undefined,
    /** Buffers released while a frame is being recorded, destroyed after its submit. */
    private readonly garbage: GPUBuffer[],
  ) {}

  private buffer(label: string, data: Float32Array | Uint32Array, usage: number): GPUBuffer {
    const device = this.gpu.device,
      buffer = device.createBuffer({ label, size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return buffer;
  }

  uploadTrees(values: Float32Array): void {
    this.treeBuffer?.destroy();
    this.treeBuffer = undefined;
    if (!values.length) return;
    this.treeBuffer = this.buffer('near trees', values, GPUBufferUsage.VERTEX);
    this.pipeline('tree');
  }

  uploadFungi(values: Float32Array): void {
    this.fungusBuffer?.destroy();
    this.fungusBuffer = undefined;
    if (!values.length) return;
    this.fungusBuffer = this.buffer('underdark mushrooms', values, GPUBufferUsage.VERTEX);
    this.pipeline('fungus');
  }

  uploadRoof(mesh: { vertices: Float32Array; indices: Uint32Array } | undefined): void {
    if (this.roof) {
      this.garbage.push(this.roof.vertices, this.roof.indices);
      this.roof = undefined;
    }
    if (!mesh) return;
    this.roof = { vertices: this.buffer('cave roof', mesh.vertices, GPUBufferUsage.VERTEX), indices: this.buffer('cave roof indices', mesh.indices, GPUBufferUsage.INDEX) };
    this.pipeline('roof');
  }

  uploadBillboards(values: Float32Array, atlas: HTMLCanvasElement | undefined, uploadTexture: (source: TexImageSource) => WebGLTexture, deleteTexture: (texture: WebGLTexture) => void): void {
    this.billboardBuffer?.destroy();
    this.billboardBuffer = undefined;
    if (!values.length) return;
    this.billboardBuffer = this.buffer('relief instances', values, GPUBufferUsage.VERTEX);
    if (atlas && this.billboardAtlas?.source !== atlas) {
      if (this.billboardAtlas) deleteTexture(this.billboardAtlas.texture);
      this.billboardAtlas = { source: atlas, texture: uploadTexture(atlas) };
    }
    this.pipeline('billboard');
  }

  private bind(pass: GPURenderPassEncoder, params: Pool, p: Params, layout: GPUBindGroupLayout): void {
    const slot = params.alloc(p.bytes);
    pass.setBindGroup(0, this.gpu.device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } }] }));
  }

  recordRoof(pass: GPURenderPassEncoder, params: Pool, frame: FrameGeometry): void {
    const { cavern, rig } = this.parts;
    if (!cavern.roofShown() || !this.roof) return;
    const pipeline = this.pipeline('roof');
    if (!pipeline) return;
    const p = (this.roofParams ??= new Params(WGSL.WGSL3D_PARAMS.roof)),
      c = rig.camera,
      glow = cavern.townGlowUniform();
    p.setArray('matrix', frame.matrix);
    p.set('cameraOrigin', c.x, frame.targetHeight, c.y);
    p.set('exaggeration', c.exaggeration);
    p.setArray('eye', frame.eye);
    p.setArray('uCavern', cavern.parameters());
    p.setArray('uReveal', cavern.roofReveal());
    p.setArray('uTownGlow', glow.values);
    p.set('uTownGlowCount', glow.count);
    const slot = params.alloc(p.bytes);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.gpu.device.createBindGroup({ layout: this.gpu.layouts.tree, entries: [{ binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } }] }));
    pass.setVertexBuffer(0, this.roof.vertices);
    pass.setIndexBuffer(this.roof.indices, 'uint32');
    pass.drawIndexed(cavern.roofCount);
  }

  recordFungi(pass: GPURenderPassEncoder, params: Pool, frame: FrameGeometry): void {
    const { fungi, cavern, rig } = this.parts;
    if (!fungi.count || !this.fungusBuffer || !this.context.ground?.underdark) return;
    const pipeline = this.pipeline('fungus');
    if (!pipeline) return;
    const p = (this.fungusParams ??= new Params(WGSL.WGSL3D_PARAMS.fungus)),
      c = rig.camera,
      glow = cavern.townGlowUniform();
    p.setArray('matrix', frame.matrix);
    p.set('cameraOrigin', c.x, frame.targetHeight, c.y);
    p.set('exaggeration', c.exaggeration);
    p.setArray('fungusFade', fungi.fade());
    p.setArray('uReveal', cavern.roofShown() ? cavern.roofReveal() : [0, 0, 0, 1]);
    p.setArray('eye', frame.eye);
    p.setArray('uCavern', cavern.parameters());
    p.setArray('uTownGlow', glow.values);
    p.set('uTownGlowCount', glow.count);
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, this.fungusBuffer);
    let first = 0;
    for (let lod = 0; lod < 3; lod++) {
      const count = fungi.tiers[lod];
      if (!count) continue;
      p.set('fungusLod', lod);
      this.bind(pass, params, p, this.gpu.layouts.tree);
      pass.draw(FUNGUS_LOD_VERTICES[lod], count, 0, first);
      first += count;
    }
  }

  recordTrees(pass: GPURenderPassEncoder, params: Pool, frame: FrameGeometry): void {
    const { trees, rig } = this.parts;
    if (!trees.shown() || !this.treeBuffer || this.context.ground?.underdark) return;
    const pipeline = this.pipeline('tree');
    if (!pipeline) return;
    const p = this.treeParams,
      c = rig.camera;
    p.setArray('matrix', frame.matrix);
    p.set('cameraOrigin', c.x, frame.targetHeight, c.y);
    p.set('exaggeration', c.exaggeration);
    p.setArray('treeFade', trees.forestTreesUniform(frame));
    p.setArray('eye', frame.eye);
    p.setArray('treeLight', trees.light());
    p.set('fogDistance', rig.fogDistance());
    p.set('uNight', this.context.look.ambience === 'night' ? 1 : 0);
    const slot = params.alloc(p.bytes);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.gpu.device.createBindGroup({ layout: this.gpu.layouts.tree, entries: [{ binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } }] }));
    pass.setVertexBuffer(0, this.treeBuffer);
    pass.draw(TREE_VERTICES, trees.count);
  }

  /** Records the raised stamps; returns whether they wait for their pipeline (the frame is then not complete). */
  recordBillboards(pass: GPURenderPassEncoder, params: Pool, frame: FrameGeometry, blend: number): boolean {
    const { billboards, rig } = this.parts;
    if (!billboards.count || !this.billboardBuffer || !this.billboardAtlas || blend <= 0) return false;
    const pipeline = this.pipeline('billboard');
    if (!pipeline) return true;
    const p = this.billboardParams,
      c = rig.camera,
      gpu = this.gpu;
    p.setArray('matrix', frame.matrix);
    p.set('cameraOrigin', c.x, frame.targetHeight, c.y);
    p.set('cameraRight', Math.cos(c.yaw), -Math.sin(c.yaw));
    p.set('exaggeration', c.exaggeration);
    p.set('raisedBlend', blend);
    p.setArray('eye', frame.eye);
    p.set('fogDistance', rig.fogDistance());
    p.set('uNight', this.context.look.ambience === 'night' ? 1 : 0);
    const slot = params.alloc(p.bytes);
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      gpu.device.createBindGroup({
        layout: gpu.layouts.billboard,
        entries: [
          { binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } },
          { binding: 2, resource: gpu.billboardSampler },
          { binding: T.billboardAtlas, resource: image(this.billboardAtlas.texture).view },
        ],
      }),
    );
    pass.setVertexBuffer(0, this.billboardBuffer);
    pass.draw(6, billboards.count);
    return false;
  }

  dispose(deleteTexture: (texture: WebGLTexture) => void): void {
    this.fungusBuffer?.destroy();
    this.roof?.vertices.destroy();
    this.roof?.indices.destroy();
    this.billboardBuffer?.destroy();
    if (this.billboardAtlas) deleteTexture(this.billboardAtlas.texture);
  }
}
