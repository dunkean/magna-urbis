import { unzlibSync } from 'fflate';
import atlas from './assets/fantasy/forest-brushes.json';

// Texture arrays isolate each brush's mip chain: no neighbouring-sprite bleed.
const textures = new WeakMap<WebGL2RenderingContext, { texture: WebGLTexture; full: boolean }>();
let pixels: Uint8Array | undefined;
export function bindForestBrushes(gl: WebGL2RenderingContext, uniform: (name: string) => WebGLUniformLocation | null, enabled: boolean, unit: number): void {
  let cached = textures.get(gl);
  gl.activeTexture(gl.TEXTURE0 + unit);
  if (!cached) {
    cached = { texture: gl.createTexture()!, full: false }; textures.set(gl, cached);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, cached.texture);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG8, 1, 1, 1, 0, gl.RG, gl.UNSIGNED_BYTE, new Uint8Array([255, 128]));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  } else gl.bindTexture(gl.TEXTURE_2D_ARRAY, cached.texture);
  if (enabled && !cached.full) {
    pixels ??= unzlibSync(Uint8Array.from(atob(atlas.zlib), c => c.charCodeAt(0)));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG8, atlas.size, atlas.size, atlas.families.length * atlas.variants, 0, gl.RG, gl.UNSIGNED_BYTE, pixels);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    cached.full = true;
  }
  gl.uniform1i(uniform('uForestBrushes'), enabled ? 1 : 0);
  gl.uniform1i(uniform('uForestBrushAtlas'), unit);
}

export function disposeForestBrushes(gl: WebGL2RenderingContext): void {
  const cached = textures.get(gl); if (cached) gl.deleteTexture(cached.texture);
  textures.delete(gl);
}
