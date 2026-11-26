/**
 * Forest field, applied occupation and holdings on WebGL2: uploads and uniform bindings shared by the 2D ground
 * (TerrainGl) and the perspective ground (terrain3d.ts). Texture units are owned by each caller.
 */
import { capRgbaRaster } from '../../glContextRecovery';
import { forestBeachTexture, type ForestField, type ForestOccupation, type LandDetail, type TexelRect } from '../../../../../rust/bridge/terrainForest';
import type { Rect4 } from '../../../render/view';

/** Holdings take a 17th texture unit. ANGLE on D3D11 stops at 16: there the shader leaves them out and fields keep their plain material. */
export const glLandDetailUnit = (gl: WebGL2RenderingContext): number | undefined => (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) > 16 ? 16 : undefined);

/** RGBA8 world raster, clamped to its edges. Box mipmaps keep the field's mean cover at coarse footprints. */
export function forestTexture(gl: WebGL2RenderingContext, raster: { n: number; rgba: Uint8Array }, mipmaps: boolean): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, raster.n, raster.n, 0, gl.RGBA, gl.UNSIGNED_BYTE, raster.rgba);
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** A forestTexture of a raster of the same size whose texels changed only inside `rects`: those uploaded alone, the
 * mipmaps generated again on the GPU. */
export function patchForestTexture(gl: WebGL2RenderingContext, texture: WebGLTexture, raster: { n: number; rgba: Uint8Array }, rects: readonly TexelRect[]): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, raster.n);
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.width, r.height, gl.RGBA, gl.UNSIGNED_BYTE, raster.rgba);
  }
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.generateMipmap(gl.TEXTURE_2D);
}
/** The texel rectangles by which `next` differs from `held` (ForestOccupation.dirty) when it was made from it on the
 * same grid; undefined: `next` must be uploaded whole. The same pixels (one product spread again): no rectangle. */
type OccupationRaster = Pick<ForestOccupation, 'x' | 'y' | 'n' | 'width' | 'rgba'> & Partial<Pick<ForestOccupation, 'key' | 'dirty'>>;
export function occupationPatch(held: OccupationRaster | undefined, next: OccupationRaster): readonly TexelRect[] | undefined {
  if (!held || held.n !== next.n || held.x !== next.x || held.y !== next.y || held.width !== next.width) return undefined;
  if (held.rgba === next.rgba) return [];
  return next.dirty && next.dirty.base === held.key ? next.dirty.rects : undefined;
}
/** Occupation texels around a changed one whose ground pixels may change: bilinear reads, a distance read a little off
 * the fragment (soft edges, symbols). Coarse tiles add their own reach (render/live/groundLayer.ts). */
export const OCCUPATION_PAD = 4;
/** The world boxes (metres) of texel rectangles of an occupation, grown by `pad` texels (bilinear reads, mipmaps). */
export function occupationWorldRects(occupation: OccupationRaster, rects: readonly TexelRect[], pad: number): Rect4[] {
  const cell = occupation.width / occupation.n;
  return rects.map(r => ({ minX: occupation.x + (r.x - pad) * cell, minY: occupation.y + (r.y - pad) * cell, maxX: occupation.x + (r.x + r.width + pad) * cell, maxY: occupation.y + (r.y + r.height + pad) * cell }));
}

/** Canonical forest field and its riparian bank envelope (same grid), uploaded and released together. */
export interface ForestTextures {
  field: ForestField;
  texture: WebGLTexture;
  bank?: WebGLTexture;
  beach?: WebGLTexture;
}
export function forestTextures(gl: WebGL2RenderingContext, field: ForestField): ForestTextures {
  return { field, texture: forestTexture(gl, field, true), bank: field.bank && forestTexture(gl, { n: field.n, rgba: field.bank }, true), beach: field.beach && forestBeachTexture(gl, field.beach) };
}
/** The forest field and its same-grid bank box-halved to at most `cap` texels a side (mean cover kept). */
export function cappedForest(field: ForestField, cap: number): ForestField {
  const {
    raster,
    companions: [bank],
  } = capRgbaRaster(field, cap, [field.bank]);
  return raster === field ? field : { ...raster, bank };
}
export function deleteForestTextures(gl: WebGL2RenderingContext, textures: ForestTextures | undefined): void {
  if (!textures) return;
  gl.deleteTexture(textures.texture);
  if (textures.bank) gl.deleteTexture(textures.bank);
  if (textures.beach) gl.deleteTexture(textures.beach);
}

/** Holdings uniforms of the map and perspective programs. */
export function bindLandDetail(gl: WebGL2RenderingContext, u: (name: string) => WebGLUniformLocation | null, detail: { data: LandDetail; texture: WebGLTexture } | undefined, empty: WebGLTexture): void {
  const unit = glLandDetailUnit(gl);
  if (unit === undefined) return;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, detail?.texture ?? empty);
  gl.uniform1i(u('uLandDetail'), unit);
  gl.uniform1i(u('uHasLandDetail'), detail ? 1 : 0);
  gl.uniform3f(u('uLandDetailRect'), detail?.data.x ?? 0, detail?.data.y ?? 0, detail?.data.width ?? 1);
  gl.uniform1f(u('uLandDetailN'), detail?.data.n ?? 1);
}

/** Forest uniforms shared by the map and perspective programs; units are owned by each caller. */
export function bindForest(
  gl: WebGL2RenderingContext,
  u: (name: string) => WebGLUniformLocation | null,
  forest: ForestTextures | undefined,
  occupation: { data: ForestOccupation; texture: WebGLTexture } | undefined,
  empty: WebGLTexture,
  enabled: boolean,
  fieldUnit: number,
  occupationUnit: number,
  bankUnit: number,
  beachUnit: number,
): void {
  const field = enabled ? forest : undefined,
    applied = occupation;
  gl.uniform1i(u('uForest'), field ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0 + fieldUnit);
  gl.bindTexture(gl.TEXTURE_2D, field?.texture ?? empty);
  gl.uniform1i(u('uForestField'), fieldUnit);
  gl.uniform3f(u('uForestRect'), field?.field.x ?? 0, field?.field.y ?? 0, field?.field.width ?? 1);
  gl.activeTexture(gl.TEXTURE0 + bankUnit);
  gl.bindTexture(gl.TEXTURE_2D, field?.bank ?? empty);
  gl.uniform1i(u('uForestBank'), bankUnit);
  gl.uniform1i(u('uHasForestBank'), field?.bank ? 1 : 0);
  gl.uniform1f(u('uForestBankDensity'), field?.field.bankDensity ?? 1);
  const beach = field?.field.beach;
  gl.activeTexture(gl.TEXTURE0 + beachUnit);
  gl.bindTexture(gl.TEXTURE_2D, field?.beach ?? empty);
  gl.uniform1i(u('uForestBeach'), beachUnit);
  gl.uniform1i(u('uHasForestBeach'), field?.beach ? 1 : 0);
  gl.uniform3f(u('uForestBeachRect'), beach?.x ?? 0, beach?.y ?? 0, beach?.width ?? 1);
  gl.activeTexture(gl.TEXTURE0 + occupationUnit);
  gl.bindTexture(gl.TEXTURE_2D, applied?.texture ?? empty);
  gl.uniform1i(u('uOccupation'), occupationUnit);
  gl.uniform1i(u('uHasOccupation'), applied ? 1 : 0);
  gl.uniform3f(u('uOccupationRect'), applied?.data.x ?? 0, applied?.data.y ?? 0, applied?.data.width ?? 1);
  gl.uniform1f(u('uOccupationN'), applied?.data.n ?? 1);
}
