/**
 * WebGL texture and patch-buffer hooks called by terrain preparation and overridden by WebGPU.
 * Reads/writes: Reads the supplied GL context and upload inputs; creates/releases texture, mesh and clipped-index handles.
 */
import { deleteForestTextures, forestTexture, forestTextures, type ForestTextures, type HeightLayer } from '../terrainGl';
import { type ForestField, type ForestOccupation, type LandDetail } from '../../../../rust/bridge/terrainForest';
import { Terrain3dTile, Terrain3dTileContent, Patch } from './terrainTypes';
import { patchClipKey, clippedPatchIndices } from './patchIndices';
import { paddedMaterial } from './materialImages';
import type { Terrain3dContext } from './terrainContext';

export function uploadMacroField(context: Terrain3dContext, layer?: HeightLayer): WebGLTexture {
  const gl = context.gl,
    texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, layer?.n ?? 1, layer?.n ?? 1, 0, gl.RED, gl.FLOAT, layer?.data ?? new Float32Array(1));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export function rectangleIndices(context: Terrain3dContext, tile: Terrain3dTile, clip: Terrain3dTile): { buffer: WebGLBuffer; count: number } {
  const key = patchClipKey(tile, clip);
  if (!key) return { buffer: context.indices, count: context.indexCount };
  const cached = context.clippedIndices.get(key);
  if (cached) {
    context.clippedIndices.delete(key);
    context.clippedIndices.set(key, cached);
    return cached;
  }
  const indices = clippedPatchIndices(key);
  const gl = context.gl,
    buffer = gl.createBuffer()!;
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  const result = { buffer, count: indices.length };
  context.clippedIndices.set(key, result);
  if (context.clippedIndices.size > 64) {
    const oldest = context.clippedIndices.keys().next().value!;
    gl.deleteBuffer(context.clippedIndices.get(oldest)!.buffer);
    context.clippedIndices.delete(oldest);
  }
  return result;
}

export function uploadTexture(context: Terrain3dContext, source: TexImageSource | Uint8Array): WebGLTexture {
  const gl = context.gl,
    texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  if (source instanceof Uint8Array) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paddedMaterial(source));
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);
  // A capability query here synchronizes every tile upload with the preceding canopy draw.
  if (context.textureAnisotropy) gl.texParameterf(gl.TEXTURE_2D, context.textureAnisotropy.parameter, context.textureAnisotropy.value);
  return texture;
}

export function uploadForest(context: Terrain3dContext, field: ForestField): ForestTextures {
  return forestTextures(context.gl, field);
}

export function releaseForest(context: Terrain3dContext, textures: ForestTextures | undefined): void {
  deleteForestTextures(context.gl, textures);
}

export function uploadOccupation(context: Terrain3dContext, occupation: ForestOccupation): WebGLTexture {
  return forestTexture(context.gl, occupation, true);
}

export function uploadLandDetail(context: Terrain3dContext, detail: LandDetail): WebGLTexture {
  return forestTexture(context.gl, detail, true);
}

export function deleteTexture(context: Terrain3dContext, texture: WebGLTexture): void {
  context.gl.deleteTexture(texture);
}

export function uploadWaterMask(context: Terrain3dContext, water: NonNullable<Terrain3dTileContent['water']>): WebGLTexture {
  const gl = context.gl,
    mask = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, mask);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, water.n, water.n, 0, gl.RED, gl.UNSIGNED_BYTE, water.alpha);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return mask;
}

/** Patch vertex buffer (10 floats per vertex, see buildMesh); sets patch.vao and patch.vertices. */
export function uploadMesh(context: Terrain3dContext, patch: Patch, values: Float32Array): void {
  const gl = context.gl;
  patch.vao = gl.createVertexArray()!;
  patch.vertices = gl.createBuffer()!;
  gl.bindVertexArray(patch.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, patch.vertices);
  gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 40, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 40, 20);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 28);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 40, 32);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, context.indices);
  gl.bindVertexArray(null);
}

/** Deletes the GPU objects of a patch mesh (the caller resets the fields). */
export function releaseMesh(context: Terrain3dContext, patch: Patch): void {
  if (patch.vao) context.gl.deleteVertexArray(patch.vao);
  if (patch.vertices) context.gl.deleteBuffer(patch.vertices);
}

export function contextLost(context: Terrain3dContext): boolean {
  return context.gl.isContextLost();
}
