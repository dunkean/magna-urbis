/**
 * Instanced passes of the WebGL2 terrain view drawn after the ground: near trees, the Underdark roof and mushrooms, and
 * the raised illustration stamps. Each owns its program, vertex array and buffer, filled from the stream its part built.
 */
import { BILLBOARD_3D_GLSL } from '../../terrain3dBillboards';
import { TREE_3D_GLSL, TREE_STRIDE, TREE_VERTICES } from '../../terrain3dTrees';
import { FUNGUS_3D_GLSL, FUNGUS_LOD_VERTICES, FUNGUS_STRIDE } from '../../terrain3dFungi';
import { CAVERN_ROOF_GLSL } from '../../../render/underdarkCavern';
import { program } from './program';
import type { GlGroundPrograms } from './programs';
import type { TerrainViewContext } from '../terrain/context';
import type { FrameGeometry } from '../terrain/contract';
import type { TerrainParts } from '../terrain/parts';

export class GlInstances {
  private treeProgram?: WebGLProgram;
  private treeVao?: WebGLVertexArrayObject;
  private treeBuffer?: WebGLBuffer;
  private fungusProgram?: WebGLProgram;
  private fungusVao?: WebGLVertexArrayObject;
  private fungusBuffer?: WebGLBuffer;
  private roofProgram?: WebGLProgram;
  private roofVao?: WebGLVertexArrayObject;
  private roofBuffers?: [WebGLBuffer, WebGLBuffer];
  private billboardProgram?: WebGLProgram;
  private billboardVao?: WebGLVertexArrayObject;
  private billboardBuffer?: WebGLBuffer;
  private billboardAtlas?: { source: HTMLCanvasElement; texture: WebGLTexture };

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly context: TerrainViewContext,
    private readonly parts: TerrainParts,
    private readonly programs: GlGroundPrograms,
  ) {}

  uploadTrees(values: Float32Array): void {
    const gl = this.gl;
    this.treeProgram ??= program(gl, TREE_3D_GLSL.vertex, TREE_3D_GLSL.fragment);
    this.treeVao ??= gl.createVertexArray()!;
    this.treeBuffer ??= gl.createBuffer()!;
    gl.bindVertexArray(this.treeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.treeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, TREE_STRIDE * 4, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
  }

  drawTrees(frame: FrameGeometry): void {
    const gl = this.gl,
      p = this.treeProgram,
      { trees, rig } = this.parts,
      c = rig.camera,
      u = (name: string): WebGLUniformLocation | null => this.programs.uniform(name, p);
    if (!p || !trees.shown() || this.context.ground?.underdark) return;
    gl.useProgram(p);
    gl.bindVertexArray(this.treeVao!);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(u('matrix'), false, frame.matrix);
    gl.uniform3f(u('cameraOrigin'), c.x, frame.targetHeight, c.y);
    gl.uniform1f(u('exaggeration'), c.exaggeration);
    gl.uniform4fv(u('treeFade'), trees.forestTreesUniform(frame));
    gl.uniform3fv(u('eye'), frame.eye);
    gl.uniform3fv(u('treeLight'), trees.light());
    gl.uniform1f(u('fogDistance'), rig.fogDistance());
    gl.uniform1i(u('uNight'), +(this.context.look.ambience === 'night'));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, TREE_VERTICES, trees.count);
    gl.bindVertexArray(null);
  }

  uploadFungi(values: Float32Array): void {
    const gl = this.gl;
    this.fungusProgram ??= program(gl, FUNGUS_3D_GLSL.vertex, FUNGUS_3D_GLSL.fragment);
    this.fungusVao ??= gl.createVertexArray()!;
    this.fungusBuffer ??= gl.createBuffer()!;
    gl.bindVertexArray(this.fungusVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fungusBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, FUNGUS_STRIDE * 4, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
  }

  drawFungi(frame: FrameGeometry): void {
    const gl = this.gl,
      p = this.fungusProgram,
      { fungi, cavern, rig } = this.parts,
      c = rig.camera,
      u = (name: string): WebGLUniformLocation | null => this.programs.uniform(name, p);
    if (!p || !fungi.count || !this.context.ground?.underdark) return;
    gl.useProgram(p);
    gl.bindVertexArray(this.fungusVao!);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(u('matrix'), false, frame.matrix);
    gl.uniform3f(u('cameraOrigin'), c.x, frame.targetHeight, c.y);
    gl.uniform1f(u('exaggeration'), c.exaggeration);
    gl.uniform4fv(u('fungusFade'), fungi.fade());
    gl.uniform4fv(u('uReveal'), cavern.roofShown() ? cavern.roofReveal() : [0, 0, 0, 1]);
    gl.uniform3fv(u('eye'), frame.eye);
    gl.uniform4fv(u('uCavern'), cavern.parameters());
    const glow = cavern.townGlowUniform();
    gl.uniform4fv(u('uTownGlow[0]'), glow.values);
    gl.uniform1i(u('uTownGlowCount'), glow.count);
    // One draw per level of detail: the attributes start at the level's first instance (no base instance in WebGL2).
    let first = 0;
    for (let lod = 0; lod < 3; lod++) {
      const count = fungi.tiers[lod];
      if (!count) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fungusBuffer!);
      for (let i = 0; i < 3; i++) gl.vertexAttribPointer(i, 4, gl.FLOAT, false, FUNGUS_STRIDE * 4, first * FUNGUS_STRIDE * 4 + i * 16);
      gl.uniform1i(u('fungusLod'), lod);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, FUNGUS_LOD_VERTICES[lod], count);
      first += count;
    }
    gl.bindVertexArray(null);
  }

  uploadRoof(mesh: { vertices: Float32Array; indices: Uint32Array } | undefined): void {
    const gl = this.gl;
    if (!mesh) return;
    this.roofProgram ??= program(gl, CAVERN_ROOF_GLSL.vertex, CAVERN_ROOF_GLSL.fragment);
    this.roofVao ??= gl.createVertexArray()!;
    this.roofBuffers ??= [gl.createBuffer()!, gl.createBuffer()!];
    gl.bindVertexArray(this.roofVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.roofBuffers[0]);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.vertexAttribDivisor(1, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.roofBuffers[1]);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  drawRoof(frame: FrameGeometry): void {
    const gl = this.gl,
      p = this.roofProgram,
      { cavern, rig } = this.parts,
      c = rig.camera,
      u = (name: string): WebGLUniformLocation | null => this.programs.uniform(name, p);
    if (!p || !cavern.roofShown()) return;
    gl.useProgram(p);
    gl.bindVertexArray(this.roofVao!);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(u('matrix'), false, frame.matrix);
    gl.uniform3f(u('cameraOrigin'), c.x, frame.targetHeight, c.y);
    gl.uniform1f(u('exaggeration'), c.exaggeration);
    gl.uniform3fv(u('eye'), frame.eye);
    gl.uniform4fv(u('uCavern'), cavern.parameters());
    gl.uniform4fv(u('uReveal'), cavern.roofReveal());
    const glow = cavern.townGlowUniform();
    gl.uniform4fv(u('uTownGlow[0]'), glow.values);
    gl.uniform1i(u('uTownGlowCount'), glow.count);
    gl.drawElements(gl.TRIANGLES, cavern.roofCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /** A restored context: the stamps are uploaded again (their objects went with the old context). */
  resetBillboards(): void {
    this.billboardProgram = undefined;
    this.billboardVao = undefined;
    this.billboardBuffer = undefined;
    this.billboardAtlas = undefined;
  }

  uploadBillboards(values: Float32Array, atlas: HTMLCanvasElement | undefined, uploadTexture: (source: TexImageSource) => WebGLTexture, anisotropy: { parameter: number } | undefined): void {
    const gl = this.gl;
    if (!values.length) return;
    this.billboardProgram ??= program(gl, BILLBOARD_3D_GLSL.vertex, BILLBOARD_3D_GLSL.fragment);
    this.billboardVao ??= gl.createVertexArray()!;
    this.billboardBuffer ??= gl.createBuffer()!;
    gl.bindVertexArray(this.billboardVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.billboardBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 48, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
    if (atlas && this.billboardAtlas?.source !== atlas) {
      if (this.billboardAtlas) gl.deleteTexture(this.billboardAtlas.texture);
      const texture = uploadTexture(atlas);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 4);
      if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.parameter, 1);
      this.billboardAtlas = { source: atlas, texture };
    }
  }

  billboardsReady(): boolean {
    return !this.parts.billboards.count || !!this.billboardProgram;
  }

  drawBillboards(frame: FrameGeometry, blend: number): void {
    const gl = this.gl,
      p = this.billboardProgram,
      { billboards, rig } = this.parts,
      c = rig.camera,
      u = (name: string): WebGLUniformLocation | null => this.programs.uniform(name, p);
    if (!p || !billboards.count || !this.billboardAtlas || blend <= 0) return;
    gl.useProgram(p);
    gl.bindVertexArray(this.billboardVao!);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.uniformMatrix4fv(u('matrix'), false, frame.matrix);
    gl.uniform3f(u('cameraOrigin'), c.x, frame.targetHeight, c.y);
    gl.uniform2f(u('cameraRight'), Math.cos(c.yaw), -Math.sin(c.yaw));
    gl.uniform1f(u('exaggeration'), c.exaggeration);
    gl.uniform1f(u('raisedBlend'), blend);
    gl.uniform3fv(u('eye'), frame.eye);
    gl.uniform1f(u('fogDistance'), rig.fogDistance());
    gl.uniform1i(u('uNight'), +(this.context.look.ambience === 'night'));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.billboardAtlas.texture);
    gl.uniform1i(u('billboardAtlas'), 0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, billboards.count);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.bindVertexArray(null);
  }

  /** The stamps' objects (the other passes keep theirs for the context's lifetime). */
  dispose(): void {
    const gl = this.gl;
    if (this.billboardProgram) gl.deleteProgram(this.billboardProgram);
    if (this.billboardVao) gl.deleteVertexArray(this.billboardVao);
    if (this.billboardBuffer) gl.deleteBuffer(this.billboardBuffer);
    if (this.billboardAtlas) gl.deleteTexture(this.billboardAtlas.texture);
  }
}
