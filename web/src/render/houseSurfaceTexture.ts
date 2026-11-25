import { houseWallStyle, paintHouseWall } from './houseWallArt';
import { houseRoofStyle, paintHouseRoof } from './houseRoofArt';

/** Each repeating square covers three metres. IDs live as long as the mesh caches and are shared by both 3D views. */
export const HOUSE_TILE_SIZE = 256;
export const HOUSE_TILE_LAYERS = 128;
const levels = 1 + Math.log2(HOUSE_TILE_SIZE);
type Kind = 'roof' | 'wall';
interface Tile {
  kind: Kind;
  culture: string;
  material: string;
  mips?: HTMLCanvasElement[];
}
const tiles: Tile[] = [];
const layers = new Map<string, number>();

/** Only distinct drawings get a layer. Zero denotes a surface without a drawing. */
export function houseSurfaceLayer(kind: Kind, culture: string, material: string): number {
  const style = kind === 'roof' ? houseRoofStyle(culture, material) : houseWallStyle(culture, material);
  const key = kind + '/' + style;
  const known = layers.get(key);
  if (known !== undefined) return known;
  if (tiles.length === HOUSE_TILE_LAYERS) return 0;
  tiles.push({ kind, culture, material });
  layers.set(key, tiles.length);
  return tiles.length;
}

export const houseSurfaceCount = (): number => tiles.length;

/** Rasterize each drawing once, then box-filter each successive level. Context restoration reuses the same pixels. */
export function houseSurfaceMips(layer: number): readonly HTMLCanvasElement[] {
  const tile = tiles[layer - 1];
  if (!tile || typeof document === 'undefined') return [];
  if (tile.mips) return tile.mips;
  const mips: HTMLCanvasElement[] = [];
  for (let size = HOUSE_TILE_SIZE; size >= 1; size /= 2) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    if (mips.length) ctx.drawImage(mips[mips.length - 1], 0, 0, size, size);
    else (tile.kind === 'roof' ? paintHouseRoof : paintHouseWall)(ctx, size, tile.culture, tile.material);
    mips.push(canvas);
  }
  tile.mips = mips;
  return mips;
}

/** Per-context array. Publish a layer only after every mip has been uploaded to keep transitions clean. */
export class HouseSurfaceTexture {
  texture?: WebGLTexture;
  ready = 0;
  constructor(private readonly gl: WebGL2RenderingContext) {}

  step(): boolean {
    if (this.ready >= tiles.length) return true;
    const mips = houseSurfaceMips(this.ready + 1);
    if (!mips.length) return true;
    const gl = this.gl;
    if (!this.texture) {
      this.texture = gl.createTexture() ?? undefined;
      if (!this.texture) return true;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, HOUSE_TILE_SIZE, HOUSE_TILE_SIZE, HOUSE_TILE_LAYERS);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    for (const [level, mip] of mips.entries()) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, this.ready, mip.width, mip.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, mip);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.ready++;
    return this.ready >= tiles.length;
  }

  lost(): void {
    this.texture = undefined;
    this.ready = 0;
  }
  dispose(): void {
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.lost();
  }
}

/** Face-local metric axes. V runs down from each ridge, or down a façade from its ground-aligned storeys.
 * Mip filtering resolves the drawing at close range and the town's own palette takes over at map scales. */
export const HOUSE_SURFACE_GLSL = `
uniform highp sampler2DArray uHouseSurface;
uniform float uHouseSurfaceReady;
vec3 houseSurface(vec3 base, float layer, vec3 N, vec3 p){
  float variation=floor(max(0.,layer-1.)/${HOUSE_TILE_LAYERS}.);
  layer-=variation*${HOUSE_TILE_LAYERS}.;
  if(layer<.5||layer>uHouseSurfaceReady)return base;
  vec2 q=p.xz;
  float h=length(N.xz);
  if(h>.02){
    vec2 d=N.xz/h;
    q.x=dot(p.xz,vec2(-d.y,d.x));
    q.y=dot(p.xz,d)*N.y-p.y*h;
  }
  vec2 uv=q/3.+vec2(variation*.237,0.);
  vec2 dx=dFdx(uv),dy=dFdy(uv);
  float fade=1.-smoothstep(.10,.45,max(length(dx),length(dy)));
  vec3 ink=textureGrad(uHouseSurface,vec3(uv,layer-1.),dx,dy).rgb;
  // A little bleaching or darkening of each lot's finish. Preserve the palette at map scale.
  float wear=variation*0.04;
  vec3 pigment=(ink/.82)*vec3(1.-wear*.4,1.-wear*.7,1.-wear);
  return base*mix(vec3(1.),pigment,fade);
}`;
