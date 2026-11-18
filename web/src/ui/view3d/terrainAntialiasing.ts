/**
 * Moving/rest resolution and WebGL multisample targets, called by terrain frame/capture code.
 * Reads/writes: Reads interaction timing and framebuffer limits; creates/releases MSAA attachments and records resolve support on the supplied context.
 */
import { terrain3dPixelRatio, TERRAIN_3D_SETTLE_MS } from '../terrain3dResolution';
import { TERRAIN_GROUND_MAX_SCALE, TERRAIN_3D_MAX_SCALE } from './terrainPolicy';
import { Terrain3d } from './terrainView';
import type { Terrain3dContext } from './terrainContext';

export function interacting(context: Terrain3dContext): boolean {
  return !context.fullQualityCapture && !context.captureMode && performance.now() - context.cameraMovedAt < TERRAIN_3D_SETTLE_MS;
}

export function dpr(context: Terrain3dContext): number {
  return terrain3dPixelRatio(context.width, context.height, window.devicePixelRatio || 1, context.maxFramebufferDimension, context.interacting());
}

export function maxScale(context: Terrain3dContext): number {
  return context.groundSettings ? TERRAIN_GROUND_MAX_SCALE : TERRAIN_3D_MAX_SCALE;
}

export function releaseMsaa(context: Terrain3dContext): void {
  if (!context.msaa) return;
  const gl = context.gl;
  gl.deleteFramebuffer(context.msaa.framebuffer);
  gl.deleteRenderbuffer(context.msaa.color);
  gl.deleteRenderbuffer(context.msaa.depth);
  context.msaa = undefined;
}

export function msaaTarget(context: Terrain3dContext, width: number, height: number): NonNullable<Terrain3d['msaa']> | undefined {
  if (context.msaa?.width === width && context.msaa.height === height) return context.msaa;
  context.releaseMsaa();
  if (context.msaaUnsupported) return undefined;
  const gl = context.gl;
  const colorSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES) as Int32Array;
  const depthSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES) as Int32Array;
  const samples = [...colorSamples].find(n => n <= 4 && n > 1 && depthSamples.includes(n));
  if (!samples) return undefined;
  const framebuffer = gl.createFramebuffer()!,
    color = gl.createRenderbuffer()!,
    depth = gl.createRenderbuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  for (const [buffer, format, attachment] of [
    [color, gl.RGBA8, gl.COLOR_ATTACHMENT0],
    [depth, gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT],
  ] as const) {
    gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, buffer);
  }
  context.msaa = { width, height, framebuffer, color, depth };
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    context.releaseMsaa();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return undefined;
  }
  return context.msaa;
}
