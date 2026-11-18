/**
 * Raised illustration preparation and drawing, called by terrain material/frame hooks.
 * Reads/writes: Reads stamps, display quality and camera; writes billboard jobs, keys, counts, atlas/instance resources and retained texture state on the supplied context.
 */
import { displayQualityFor } from '../../render/displayQuality';
import { BILLBOARD_3D_GLSL, terrain3dRaisedBlend, type Terrain3dBillboard } from '../terrain3dBillboards';
import { Terrain3d } from './terrainView';
import { BILLBOARD_LIGHT_RADIUS } from './terrainPolicy';
import { program } from './webglProgram';
import { FrameGeometry } from './terrainTypes';
import type { Terrain3dContext } from './terrainContext';

/** Also accepted by setTexture so the renderer host mirrors this input during backend replacement. */
export function setBillboards(context: Terrain3dContext, stamps: readonly Terrain3dBillboard[] | undefined, atlas?: HTMLCanvasElement): void {
  if (context.billboardSource?.stamps === stamps && context.billboardSource?.atlas === atlas) return;
  context.billboardSource = stamps && atlas ? { stamps, atlas } : undefined;
  context.billboardDirty = true;
  context.request();
}

export function prepareBillboards(context: Terrain3dContext): void {
  const light = displayQualityFor(!context.fullQualityCapture && !context.captureMode) === 'light' && context.lookSettings.paperMap;
  const frame = context.frameGeometry(),
    x = context.camera.x + frame.eye[0],
    y = context.camera.y + frame.eye[2];
  const key = light ? `${Math.round(x / 80)}|${Math.round(y / 80)}|light` : 'full';
  if (!context.billboardDirty && key === context.billboardKey && (!context.fullQualityCapture || context.billboardReadyKey === key)) return;
  context.billboardDirty = false;
  context.billboardKey = key;
  const source = context.billboardSource;
  const work = (function* (view: Terrain3d): Generator<void, Float32Array> {
    const values: number[] = [];
    if (source)
      for (let i = 0; i < source.stamps.length; i++) {
        if (i % 64 === 0) yield;
        const stamp = source.stamps[i];
        if (light && Math.hypot(stamp.x - x, stamp.y - y) > BILLBOARD_LIGHT_RADIUS) continue;
        const [u, v, w, h] = stamp.rect,
          aw = source.atlas.width,
          ah = source.atlas.height;
        values.push(stamp.x, stamp.y, view.heightAt(stamp.x, stamp.y) ?? 0, stamp.width, (1 + u * aw) / (aw + 2), (1 + v * ah) / (ah + 2), (w * aw) / (aw + 2), (h * ah) / (ah + 2), stamp.height, stamp.flip ? -1 : 1, stamp.opacity, 0);
      }
    return new Float32Array(values);
  })(context as unknown as Terrain3d);
  const install = (values: Float32Array): void => {
    context.billboardCount = values.length / 12;
    context.billboardReadyKey = key;
    context.uploadBillboards(values, source?.atlas);
  };
  if (context.fullQualityCapture) {
    let step = work.next();
    while (!step.done) step = work.next();
    install(step.value);
    return;
  }
  const epoch = context.epoch;
  void context.preparation
    .run(work, () => !context.captureMode && !context.disposed && epoch === context.epoch && context.billboardKey === key && context.billboardSource === source, 1e14)
    .then(values => {
      install(values);
      context.request();
    })
    .catch(error => {
      if (error?.name !== 'AbortError') console.warn('Terrain billboard preparation:', error);
    });
}

export function uploadBillboards(context: Terrain3dContext, values: Float32Array, atlas?: HTMLCanvasElement): void {
  const gl = context.gl;
  if (!values.length) return;
  context.billboardProgram ??= program(gl, BILLBOARD_3D_GLSL.vertex, BILLBOARD_3D_GLSL.fragment);
  context.billboardVao ??= gl.createVertexArray()!;
  context.billboardBuffer ??= gl.createBuffer()!;
  gl.bindVertexArray(context.billboardVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, context.billboardBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 48, i * 16);
    gl.vertexAttribDivisor(i, 1);
  }
  gl.bindVertexArray(null);
  if (atlas && context.billboardAtlas?.source !== atlas) {
    if (context.billboardAtlas) gl.deleteTexture(context.billboardAtlas.texture);
    const texture = context.uploadTexture(atlas);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 4);
    if (context.textureAnisotropy) gl.texParameterf(gl.TEXTURE_2D, context.textureAnisotropy.parameter, 1);
    context.billboardAtlas = { source: atlas, texture };
  }
}

export function billboardsReady(context: Terrain3dContext): boolean {
  return !context.billboardCount || !!context.billboardProgram;
}

export function raisedBlend(context: Terrain3dContext, frame: FrameGeometry): number {
  return context.billboardCount && context.billboardsReady() ? terrain3dRaisedBlend(Math.max(0, -frame.forward[1])) : 0;
}

export function drawBillboards(context: Terrain3dContext, frame: FrameGeometry, blend: number): void {
  const gl = context.gl,
    p = context.billboardProgram,
    c = context.camera;
  if (!p || !context.billboardCount || !context.billboardAtlas || blend <= 0) return;
  gl.useProgram(p);
  gl.bindVertexArray(context.billboardVao!);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  gl.uniformMatrix4fv(context.uniform('matrix', p), false, frame.matrix);
  gl.uniform3f(context.uniform('cameraOrigin', p), c.x, frame.targetHeight, c.y);
  gl.uniform2f(context.uniform('cameraRight', p), Math.cos(c.yaw), -Math.sin(c.yaw));
  gl.uniform1f(context.uniform('exaggeration', p), c.exaggeration);
  gl.uniform1f(context.uniform('raisedBlend', p), blend);
  gl.uniform3fv(context.uniform('eye', p), frame.eye);
  gl.uniform1f(context.uniform('fogDistance', p), context.fogDistance());
  gl.uniform1i(context.uniform('uNight', p), +(context.lookSettings.ambience === 'night'));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, context.billboardAtlas.texture);
  gl.uniform1i(context.uniform('billboardAtlas', p), 0);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, context.billboardCount);
  gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  gl.bindVertexArray(null);
}
