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
  style: string;
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
  tiles.push({ kind, culture, material, style });
  layers.set(key, tiles.length);
  return tiles.length;
}

export const houseSurfaceCount = (): number => tiles.length;

// The four seamless swatches are graded around the atlas's neutral value (.82).
// An image is requested only when a visible detailed house actually needs one of them.
const samples: Record<string, [number, number, number]> = { rubble: [0, 0, 0.95], barkSheets: [1, 0, 0.89], bark: [1, 0, 0.82], lime: [0, 1, 0.86], whitewash: [0, 1, 0.9], timberInfill: [0, 1, 0.3], felt: [1, 1, 0.84] };
let materialSheet: HTMLImageElement | undefined;
function loadMaterialSheet(): HTMLImageElement {
  if (!materialSheet) {
    materialSheet = new Image();
    materialSheet.src = new URL('./houseMaterials.webp', import.meta.url).href;
  }
  return materialSheet;
}

/** Rasterize each drawing once, then box-filter each successive level. Context restoration reuses the same pixels. */
export function houseSurfaceMips(layer: number): readonly HTMLCanvasElement[] {
  const tile = tiles[layer - 1];
  if (!tile || typeof document === 'undefined') return [];
  if (tile.mips) return tile.mips;
  const sample = samples[tile.style];
  const sheet = sample && typeof Image !== 'undefined' ? loadMaterialSheet() : undefined;
  if (sheet && !sheet.complete) return [];
  const mips: HTMLCanvasElement[] = [];
  for (let size = HOUSE_TILE_SIZE; size >= 1; size /= 2) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    if (mips.length) ctx.drawImage(mips[mips.length - 1], 0, 0, size, size);
    else {
      (tile.kind === 'roof' ? paintHouseRoof : paintHouseWall)(ctx, size, tile.culture, tile.material);
      if (sheet && sample && sheet.naturalWidth) {
        const side = sheet.naturalWidth / 2;
        ctx.globalAlpha = sample[2];
        ctx.drawImage(sheet, sample[0] * side, sample[1] * side, side, side, 0, 0, size, size);
        ctx.globalAlpha = 1;
      }
    }
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
    if (!mips.length) return !materialSheet || materialSheet.complete;
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

/** The vertex payload of a crafted face is (metric u, metric v, exact sRGB8). */
export const HOUSE_SURFACE_VERTEX_GLSL = `
vec3 houseFaceColor(float value){
  uint c=uint(value<0.?-value-1.:value);
  return vec3(float(c>>16u),float((c>>8u)&255u),float(c&255u))/255.;
}`;

/** Surface relief from neighbouring texels in the continuous architectural UV chart. The slope
 * is transformed into scene axes using the actual face derivatives, so mirrored pans and wraps
 * keep the same sun direction. No camera-relative height derivatives or inter-face normal samples. */
export const HOUSE_SURFACE_GLSL = `
uniform highp sampler2DArray uHouseSurface;
uniform float uHouseSurfaceReady;
vec3 houseSurface(vec3 base, float layer, vec3 N, vec3 p, vec3 surfaceMetres){
  float variation=floor(max(0.,layer-1.)/${HOUSE_TILE_LAYERS}.);
  layer-=variation*${HOUSE_TILE_LAYERS}.;
  if(layer<.5||layer>uHouseSurfaceReady)return base;
  vec2 uv=surfaceMetres.xy/3.+vec2(variation*.237,0.);
  vec2 dx=dFdx(uv),dy=dFdy(uv);
  float footprint=max(length(dx),length(dy));
  float fade=1.-smoothstep(.055,.34,footprint);
  vec3 ink=textureGrad(uHouseSurface,vec3(uv,layer-1.),dx,dy).rgb;
  vec3 pigment=mix(vec3(1.),ink/.82,.9);
  // Slow changes of exposure across the whole building, independent of the repeating units.
  // Both block grids are multiples of 256 m; these phases remain fixed as the mesh changes level.
  float phi=variation*1.87;
  float warp=sin(dot(p,vec3(-.1963495,.29,.3926991))-phi);
  float weather=sin(dot(p,vec3(.0981748,.16,.1963495))+phi+1.2*warp);
  weather+=.34*sin(dot(p,vec3(.3926991,.37,-.0981748))+phi+.65*warp);
  pigment*=vec3(1.)+weather*vec3(.023,.019,.014)-variation*vec3(.006,.009,.012);
  // Z carries distance below a real overhanging eave, or a value beyond its reach.
  pigment*=mix(.85,1.,smoothstep(0.,.48,surfaceMetres.z));
  vec3 px=dFdx(p),py=dFdy(p);
  vec3 rx=cross(py,N),ry=cross(N,px);
  float determinant=dot(px,rx);
  if(footprint<.035&&abs(determinant)>1e-10){
    const float t=1./256.;
    const vec3 luma=vec3(.2126,.7152,.0722);
    vec3 plusU=textureGrad(uHouseSurface,vec3(uv+vec2(t,0.),layer-1.),dx,dy).rgb;
    vec3 plusV=textureGrad(uHouseSurface,vec3(uv+vec2(0.,t),layer-1.),dx,dy).rgb;
    // About two centimetres between the darkest recess and brightest raised unit.
    vec2 dh=vec2(dot(plusU-ink,luma),dot(plusV-ink,luma))*(.022/t);
    vec3 gradient=(dot(dh,dx)*rx+dot(dh,dy)*ry)/determinant;
    gradient/=max(1.,length(gradient)/.5);
    vec3 bumped=normalize(N-gradient);
    float relief=buildingLight(bumped)/buildingLight(N);
    pigment*=mix(1.,relief,1.-smoothstep(.008,.035,footprint));
  }
  return base*mix(vec3(1.),pigment,fade);
}`;
