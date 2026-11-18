/** Roof grain texture owned by buildingsLayer. Uploads one material family per work slice and releases its GPU resource. */
import { COVER_GRAINS, COVER_GRAIN_LEVELS, COVER_GRAIN_TILE, coverGrainTiles } from '../buildingMaterials';

/** The top view's roof grain tiles as one texture (COVER_GRAIN_GLSL): a layer per family of COVER_GRAINS, their halved
 * copies as its mips, premultiplied. Filled one family per work slice (a few milliseconds each the first time the
 * tiles are drawn); an unfilled layer is transparent, so a roof shows no marks until its family is there. */
export class CoverGrainTexture {
  texture?: WebGLTexture;
  private filled = 0;
  constructor(private readonly gl: WebGL2RenderingContext) {}
  /** Fills the next family; true once every family is in. */
  step(): boolean {
    const gl = this.gl;
    if (this.filled >= COVER_GRAINS.length) return true;
    if (!this.texture) {
      this.texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, COVER_GRAIN_LEVELS, gl.RGBA8, COVER_GRAIN_TILE, COVER_GRAIN_TILE, COVER_GRAINS.length);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    } else gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    const tiles = coverGrainTiles(COVER_GRAINS[this.filled]);
    if (tiles) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      for (let level = 0; level < Math.min(tiles.length, COVER_GRAIN_LEVELS); level++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, this.filled, tiles[level].width, tiles[level].height, 1, gl.RGBA, gl.UNSIGNED_BYTE, tiles[level]);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.filled++;
    return this.filled >= COVER_GRAINS.length;
  }
  /** The context was lost: the handle is dead. */
  lost(): void {
    this.texture = undefined;
    this.filled = 0;
  }
  dispose(): void {
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.lost();
  }
}
