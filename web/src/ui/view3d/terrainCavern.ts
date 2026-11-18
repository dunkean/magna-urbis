/**
 * Cavern field, roof and illumination resources, called by terrain input/frame hooks.
 * Reads/writes: Reads layer, ground settings and camera; writes cavern/roof fields, textures, revisions and GPU handles on the supplied context.
 */
import { CAVERN_ROOF_GLSL, cavernReveal, cavernRoofMesh, UNDERDARK_CAVERN_DEFAULTS, cavernField, cavernUniform, type CavernField, type UnderdarkCavern3d } from '../../render/underdarkCavern';
import { program } from './webglProgram';
import { FrameGeometry } from './terrainTypes';
import type { Terrain3dContext } from './terrainContext';

/** Underdark cavern texels (RGBA16F, linear: soft rock 0-1, roof above the base, openness, clearance; see
 * render/underdarkCavern.ts): the shader's rim, occlusion and section cut read them. */
export function uploadCavern(context: Terrain3dContext, field: CavernField): WebGLTexture {
  const gl = context.gl,
    texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, field.n, field.n, 0, gl.RGBA, gl.FLOAT, field.texels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** Underdark: the section cut (roof field) and its texels, rebuilt when the layer or the roof clearance changes.
 * The roof clamps the mesh height (surface()), so every rock mass stops at the roof of its chamber. */
export function refreshCavern(context: Terrain3dContext, force: boolean): void {
  const layer = context.layer,
    settings = context.groundSettings;
  const clearance = settings?.underdark && layer?.cave ? (settings.cavern ?? UNDERDARK_CAVERN_DEFAULTS).roof : undefined;
  if (!force && layer === context.cavernLayer && clearance === context.cavernClearance) return;
  const had = !!context.cavern;
  context.cavernLayer = layer;
  context.cavernClearance = clearance;
  context.cavern = layer && clearance !== undefined ? cavernField(layer, clearance) : undefined;
  if (context.caveTexture) context.deleteTexture(context.caveTexture);
  context.caveTexture = context.cavern ? context.uploadCavern(context.cavern) : undefined;
  context.cavernRevision++;
  context.uploadRoof(context.cavern ? cavernRoofMesh(context.cavern) : undefined);
  if (had || context.cavern) {
    context.clearPatches();
    context.request();
  }
}

/** Underdark display parameters, defaulted. */
export function cavernSettings(context: Terrain3dContext): UnderdarkCavern3d {
  return context.groundSettings?.cavern ?? UNDERDARK_CAVERN_DEFAULTS;
}

/** `uCavern` of the ground shader: roof base, darkness, cave fog start and end (render/underdarkCavern.ts). */
export function cavernParameters(context: Terrain3dContext): [number, number, number, number] {
  return cavernUniform(context.cavern, context.cavernSettings(), context.camera.distance, context.camera.exaggeration);
}

/** uTownGlow (vec4 × 16) and its count, as the ground shader reads them. */
export function townGlowUniform(context: Terrain3dContext): { values: Float32Array; count: number } {
  const g = context.groundSettings?.townSites ?? context.groundSettings?.townGlow ?? new Float32Array(0),
    values = new Float32Array(64),
    count = Math.min(16, (g.length / 3) | 0);
  for (let k = 0; k < count; k++) values.set(g.subarray(k * 3, k * 3 + 3), k * 4);
  return { values, count };
}

export function uploadRoof(context: Terrain3dContext, mesh: { vertices: Float32Array; indices: Uint32Array } | undefined): void {
  const gl = context.gl;
  context.roofCount = mesh?.indices.length ?? 0;
  if (!mesh) return;
  context.roofProgram ??= program(gl, CAVERN_ROOF_GLSL.vertex, CAVERN_ROOF_GLSL.fragment);
  context.roofVao ??= gl.createVertexArray()!;
  context.roofBuffers ??= [gl.createBuffer()!, gl.createBuffer()!];
  gl.bindVertexArray(context.roofVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, context.roofBuffers[0]);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.vertexAttribDivisor(0, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
  gl.vertexAttribDivisor(1, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, context.roofBuffers[1]);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
}

/** uReveal: the cutaway around the orbit target; none while walking or flying (the vault stays overhead). */
export function roofReveal(context: Terrain3dContext): [number, number, number, number] {
  const c = context.camera;
  return c.navigation === 'walk' || c.navigation === 'fly' ? [c.x, c.y, 0, 1] : cavernReveal(c.x, c.y, c.distance, c.exaggeration);
}

/** Whether the cave roof is drawn this frame. */
export function roofShown(context: Terrain3dContext): boolean {
  return !!context.roofCount && !!context.cavern && !!context.groundSettings?.underdark && !context.groundSettings.paperMap && !context.useMapShader;
}

export function drawRoof(context: Terrain3dContext, frame: FrameGeometry): void {
  const gl = context.gl,
    p = context.roofProgram,
    c = context.camera;
  if (!p || !context.roofShown()) return;
  gl.useProgram(p);
  gl.bindVertexArray(context.roofVao!);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.uniformMatrix4fv(context.uniform('matrix', p), false, frame.matrix);
  gl.uniform3f(context.uniform('cameraOrigin', p), c.x, frame.targetHeight, c.y);
  gl.uniform1f(context.uniform('exaggeration', p), c.exaggeration);
  gl.uniform3fv(context.uniform('eye', p), frame.eye);
  gl.uniform4fv(context.uniform('uCavern', p), context.cavernParameters());
  gl.uniform4fv(context.uniform('uReveal', p), context.roofReveal());
  const glow = context.townGlowUniform();
  gl.uniform4fv(context.uniform('uTownGlow[0]', p), glow.values);
  gl.uniform1i(context.uniform('uTownGlowCount', p), glow.count);
  gl.drawElements(gl.TRIANGLES, context.roofCount, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);
}
