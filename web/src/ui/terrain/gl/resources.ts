/**
 * WebGL2 objects of the 2D ground: plain textures, height layers with their box pyramid, render targets (RGBA8 for
 * the water layer, the rivers and captures; RGBA32UI for the auxiliary pass), and the per-view set of intermediate
 * targets and caches. World tiles (renderWorldTile) keep their own GlViewTargets: the live view's auxiliary pass and
 * retained-water raster stay cached, and tiles of one size never reallocate a target.
 */
import { heightPyramid } from '../../terrainSurface';
import { AuxPassKey } from '../redraw';
import { RetainedWaterRaster } from '../retainedWater';
import type { StackedLayer } from '../layers';
import type { HeightLayer } from '../contract';

export type GlTarget = { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
/** A height layer on the GPU: R32F with its pyramid, and the cavern mask. */
export interface GlHeightLayer extends StackedLayer {
  texture: WebGLTexture;
  cave?: WebGLTexture;
}

export function glTexture(gl: WebGL2RenderingContext, w: number, h: number, internal: number, format: number, type: number, data: ArrayBufferView, filter: number): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export function uploadHeightLayer(gl: WebGL2RenderingContext, layer: HeightLayer, pyramid: boolean): GlHeightLayer {
  const levels = pyramid ? heightPyramid(layer.data, layer.n) : [layer.data];
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texStorage2D(gl.TEXTURE_2D, levels.length, gl.R32F, layer.n, layer.n);
  levels.forEach((values, lod) => gl.texSubImage2D(gl.TEXTURE_2D, lod, 0, 0, layer.n >> lod, layer.n >> lod, gl.RED, gl.FLOAT, values));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  let cave: WebGLTexture | undefined;
  if (layer.cave?.length) {
    const mask = new Uint8Array(layer.cave.length);
    mask.set(layer.cave);
    cave = glTexture(gl, layer.n, layer.n, gl.R8, gl.RED, gl.UNSIGNED_BYTE, mask, gl.LINEAR);
  }
  return { layer, levels, texture, cave, alpha: 1, fadeStart: 0 };
}
export function releaseHeightLayer(gl: WebGL2RenderingContext, layer: GlHeightLayer | undefined): void {
  if (!layer) return;
  gl.deleteTexture(layer.texture);
  if (layer.cave) gl.deleteTexture(layer.cave);
}

/** An RGBA8 (or `internal`) render target of that size, reusing `previous` when it already has it. */
function target(gl: WebGL2RenderingContext, width: number, height: number, internal: number, unit: number | undefined, previous?: GlTarget): GlTarget {
  if (previous?.width === width && previous.height === height) return previous;
  deleteTarget(gl, previous);
  const texture = gl.createTexture()!;
  if (unit !== undefined) gl.activeTexture(unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, texture, width, height };
}
export const rgbaTarget = (gl: WebGL2RenderingContext, width: number, height: number, previous?: GlTarget): GlTarget => target(gl, width, height, gl.RGBA8, undefined, previous);
/** RGBA32UI target of the auxiliary pass, created on its own unit (15): never another sampler's. */
export const uintTarget = (gl: WebGL2RenderingContext, width: number, height: number, previous?: GlTarget): GlTarget => target(gl, width, height, gl.RGBA32UI, gl.TEXTURE15, previous);
export function deleteTarget(gl: WebGL2RenderingContext, t: GlTarget | undefined): void {
  if (!t) return;
  gl.deleteFramebuffer(t.framebuffer);
  gl.deleteTexture(t.texture);
}
/** 1×1 RGBA32UI zero texture: the auxiliary sampler while the pass is absent or still linking. */
export function emptyUintTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE15);
  gl.bindTexture(gl.TEXTURE_2D, texture); // the auxiliary unit: never another sampler's
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, 1, 1, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, new Uint32Array(4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

/** Intermediate targets and caches of the draws of one view (the live view, or the world tiles). */
export class GlViewTargets {
  aux?: GlTarget;
  readonly auxKey = new AuxPassKey();
  river?: GlTarget;
  water?: GlTarget;
  retainedTexture?: WebGLTexture;
  readonly retained = new RetainedWaterRaster();
  /** Context lost: every object is gone (the retained canvas is kept). */
  forget(): void {
    this.aux = this.river = this.water = undefined;
    this.retainedTexture = undefined;
    this.auxKey.invalidate();
    this.retained.invalidate();
  }
  dispose(gl: WebGL2RenderingContext): void {
    for (const t of [this.aux, this.river, this.water]) deleteTarget(gl, t);
    if (this.retainedTexture) gl.deleteTexture(this.retainedTexture);
  }
}
