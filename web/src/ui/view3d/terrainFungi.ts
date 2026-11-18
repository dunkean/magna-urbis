/**
 * Underdark mushroom streaming and drawing, called by terrain frame hooks.
 * Reads/writes: Reads cavern, ground, occupation and camera; writes fungus stream keys/jobs, LOD counts and instance resources on the supplied context.
 */
import { buildFungi, buildFungiSteps, FUNGUS_3D_GLSL, FUNGUS_FAR, FUNGUS_LOD_VERTICES, FUNGUS_NEAR, FUNGUS_STRIDE, type FungusInputs, type FungusStream } from '../terrain3dFungi';
import { spline } from './terrainSampling';
import { program } from './webglProgram';
import { FrameGeometry } from './terrainTypes';
import type { Terrain3dContext } from './terrainContext';

/** Underdark mushrooms around the orbit target: rebuilt when it moves a third of the near radius, the abundance or
 * the cavern changes; nearest first, bounded (terrain3dFungi.ts). Nothing without the Underdark. */
export function prepareFungi(context: Terrain3dContext): void {
  const g = context.groundSettings,
    cavern = context.cavern,
    layer = context.layer,
    c = context.camera;
  const abundance = g?.underdark && cavern && layer && !context.useMapShader ? context.cavernSettings().fungi : 0;
  if (!abundance || !cavern || !layer) {
    context.fungusCount = 0;
    context.fungusKey = '';
    return;
  }
  const step = FUNGUS_NEAR / 3,
    key = [Math.round(c.x / step), Math.round(c.y / step), abundance, context.cavernRevision].join('|');
  if (key === context.fungusKey || (context.fungusJobs > 0 && !context.fullQualityCapture)) return;
  context.fungusKey = key;
  const inputs: FungusInputs = {
    seed: g!.seed >>> 0,
    cavern,
    abundance,
    towns: g!.townSites ?? g!.townGlow,
    farms: g!.farmBeds,
    occupation: context.occupation?.data,
    raw: (x, y) => spline(layer.data, layer.n, (x - layer.x) / layer.width, (y - layer.y) / layer.width),
    height: (x, y) => context.heightAt(x, y),
    water: (x, y) => context.waterAt(x, y),
  };
  const view = { x: c.x, y: c.y };
  const install = (stream: FungusStream): void => {
    context.fungusCount = stream.values.length / FUNGUS_STRIDE;
    context.fungusTiers = stream.counts;
    if (context.fungusCount) context.uploadFungi(stream.values);
  };
  if (context.fullQualityCapture) {
    install(buildFungi(inputs, view));
    return;
  }
  const epoch = context.epoch,
    current = (): boolean => !context.disposed && epoch === context.epoch && context.fungusKey === key;
  context.fungusJobs++;
  void context.preparation
    .run(buildFungiSteps(inputs, view), current, 1e15)
    .then(stream => {
      install(stream);
      context.request();
    })
    // A cancelled stream (patches cleared, e.g. a new height sampler) is rebuilt on the next frame, not when the focus next moves.
    .catch(error => {
      if (context.fungusKey === key) {
        context.fungusKey = '';
        context.request();
      }
      if (error?.name !== 'AbortError') console.warn('Underdark mushrooms:', error);
    })
    .finally(() => {
      context.fungusJobs--;
    });
}

export function uploadFungi(context: Terrain3dContext, values: Float32Array): void {
  const gl = context.gl;
  context.fungusProgram ??= program(gl, FUNGUS_3D_GLSL.vertex, FUNGUS_3D_GLSL.fragment);
  context.fungusVao ??= gl.createVertexArray()!;
  context.fungusBuffer ??= gl.createBuffer()!;
  gl.bindVertexArray(context.fungusVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, context.fungusBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 4, gl.FLOAT, false, FUNGUS_STRIDE * 4, i * 16);
    gl.vertexAttribDivisor(i, 1);
  }
  gl.bindVertexArray(null);
}

/** uFungusArea of the ground: where the modelled mushrooms stand (the painted caps give way to them), none without. */
export function fungusArea(context: Terrain3dContext): [number, number, number, number] {
  return context.fungusCount ? context.fungusFade() : [0, 0, 0, 0];
}

/** fungusFade of the mushroom shader: the stream's centre and its fade radii. */
export function fungusFade(context: Terrain3dContext): [number, number, number, number] {
  return [context.camera.x, context.camera.y, FUNGUS_FAR * 0.8, FUNGUS_FAR];
}

export function drawFungi(context: Terrain3dContext, frame: FrameGeometry): void {
  const gl = context.gl,
    p = context.fungusProgram,
    c = context.camera;
  if (!p || !context.fungusCount || !context.groundSettings?.underdark) return;
  gl.useProgram(p);
  gl.bindVertexArray(context.fungusVao!);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.uniformMatrix4fv(context.uniform('matrix', p), false, frame.matrix);
  gl.uniform3f(context.uniform('cameraOrigin', p), c.x, frame.targetHeight, c.y);
  gl.uniform1f(context.uniform('exaggeration', p), c.exaggeration);
  gl.uniform4fv(context.uniform('fungusFade', p), context.fungusFade());
  gl.uniform4fv(context.uniform('uReveal', p), context.roofShown() ? context.roofReveal() : [0, 0, 0, 1]);
  gl.uniform3fv(context.uniform('eye', p), frame.eye);
  gl.uniform4fv(context.uniform('uCavern', p), context.cavernParameters());
  const glow = context.townGlowUniform();
  gl.uniform4fv(context.uniform('uTownGlow[0]', p), glow.values);
  gl.uniform1i(context.uniform('uTownGlowCount', p), glow.count);
  // One draw per level of detail: the attributes start at the level's first instance (no base instance in WebGL2).
  let first = 0;
  for (let lod = 0; lod < 3; lod++) {
    const count = context.fungusTiers[lod];
    if (!count) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, context.fungusBuffer!);
    for (let i = 0; i < 3; i++) gl.vertexAttribPointer(i, 4, gl.FLOAT, false, FUNGUS_STRIDE * 4, first * FUNGUS_STRIDE * 4 + i * 16);
    gl.uniform1i(context.uniform('fungusLod', p), lod);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, FUNGUS_LOD_VERTICES[lod], count);
    first += count;
  }
  gl.bindVertexArray(null);
}
