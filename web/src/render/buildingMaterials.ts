/** Textured materials view — shared layer of the 2D (cityGl / cityCanvas) and 3D (urbanBuilding3d) renderers.
 * Maps massing covers / walls and road roles to layers of the packed PBR atlases
 * (scripts/pack_building_textures.py → assets/materials). The manifest is a static import (sync lookups);
 * the two atlases are fetched lazily, once, when a renderer first asks for them. */
import manifestJson from './assets/materials/materials.json';

export interface MaterialLayer { id: string; source: string; extent_m: number; mean_rgb: [number, number, number] }
export interface MaterialManifest { tile: number; layers: MaterialLayer[]; cover: Record<string, number>; wall: Record<string, number>; road: Record<string, number> }
export const MATERIALS = manifestJson as unknown as MaterialManifest;

/** Layer of a roof cover / wall material (-1: unknown, caller keeps its flat colour). */
export const coverLayer = (cover: string | undefined): number => MATERIALS.cover[cover ?? ''] ?? -1;
export const wallLayer = (wall: string | undefined): number => MATERIALS.wall[wall ?? ''] ?? -1;
/** Road surface layer by street role and rank (rank <= 1: main street). */
export function streetLayer(role: string, rank = 2): number {
  switch (role) {
    case 'bridge': return MATERIALS.road.bridge; case 'causeway': return MATERIALS.road.causeway; case 'ford': return MATERIALS.road.ford;
    case 'quay': return MATERIALS.road.quay; case 'stairs': return MATERIALS.road.stairs; case 'market': return MATERIALS.road.market;
    case 'collective': case 'private': return MATERIALS.road.street_lane;
    default: return rank <= 1 ? MATERIALS.road.street_main : rank === 2 ? MATERIALS.road.street_main : MATERIALS.road.street_lane;
  }
}
export const placeLayer = (): number => MATERIALS.road.place;
export const wallStoneLayer = (palisade: boolean): number => palisade ? MATERIALS.cover.bark : MATERIALS.road.wall;
export const layerExtent = (layer: number): number => MATERIALS.layers[layer]?.extent_m ?? 2;

export interface MaterialImages { albedo: ImageBitmap; normal: ImageBitmap }
let pending: Promise<MaterialImages> | undefined;
async function bitmap(url: string): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}
/** Fetch and decode both atlases once (cached; a failure is retried on the next call). */
export function loadMaterialImages(): Promise<MaterialImages> {
  pending ??= (async () => {
    const [a, n] = await Promise.all([import('./assets/materials/albedo.webp?url'), import('./assets/materials/normal.webp?url')]);
    const [albedo, normal] = await Promise.all([bitmap(a.default), bitmap(n.default)]);
    return { albedo, normal };
  })().catch(e => { pending = undefined; throw e; });
  return pending;
}

function layerPixels(image: ImageBitmap, tile: number, layer: number, scratch: CanvasRenderingContext2D): Uint8Array {
  scratch.clearRect(0, 0, tile, tile);
  scratch.drawImage(image, 0, layer * tile, tile, tile, 0, 0, tile, tile);
  return new Uint8Array(scratch.getImageData(0, 0, tile, tile).data.buffer);
}
/** Upload the atlases as TEXTURE_2D_ARRAYs (mipmapped, repeating): albedo in sRGB (or plain RGBA8 for display-space shaders), normal (OpenGL +Y) linear. */
export function uploadMaterialArrays(gl: WebGL2RenderingContext, images: MaterialImages, srgbAlbedo = true): { albedo: WebGLTexture; normal: WebGLTexture } {
  const tile = MATERIALS.tile, count = MATERIALS.layers.length, levels = Math.floor(Math.log2(tile)) + 1;
  const scratch = Object.assign(document.createElement('canvas'), { width: tile, height: tile }).getContext('2d', { willReadFrequently: true })!;
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const make = (image: ImageBitmap, format: number): WebGLTexture => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, format, tile, tile, count);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let i = 0; i < count; i++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, tile, tile, 1, gl.RGBA, gl.UNSIGNED_BYTE, layerPixels(image, tile, i, scratch));
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    return tex;
  };
  const out = { albedo: make(images.albedo, srgbAlbedo ? gl.SRGB8_ALPHA8 : gl.RGBA8), normal: make(images.normal, gl.RGBA8) };
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return out;
}

const patternCache = new WeakMap<ImageBitmap, HTMLCanvasElement[]>();
/** One repeating tile canvas per layer (lazily drawn) for CanvasPattern use. */
function layerCanvas(images: MaterialImages, layer: number): HTMLCanvasElement {
  let list = patternCache.get(images.albedo); if (!list) patternCache.set(images.albedo, list = []);
  if (!list[layer]) {
    const t = MATERIALS.tile, c = Object.assign(document.createElement('canvas'), { width: t, height: t });
    c.getContext('2d')!.drawImage(images.albedo, 0, layer * t, t, t, 0, 0, t, t);
    list[layer] = c;
  }
  return list[layer];
}
const patterns = new WeakMap<ImageBitmap, Map<number, CanvasPattern>>();
/** Repeating pattern of a layer for a context drawing in world metres: pattern space is the user space at fill
 * time, so scaling by extent / tile anchors the texture to the world; `angle` (radians) rotates it (roof slope).
 * The pattern is shared: set `fillStyle` and fill right away, before asking for another angle. */
export function layerPattern(ctx: CanvasRenderingContext2D, images: MaterialImages, layer: number, angle = 0): CanvasPattern | null {
  if (layer < 0) return null;
  let byLayer = patterns.get(images.albedo); if (!byLayer) patterns.set(images.albedo, byLayer = new Map());
  let pattern = byLayer.get(layer);
  if (!pattern) { pattern = ctx.createPattern(layerCanvas(images, layer), 'repeat') ?? undefined; if (!pattern) return null; byLayer.set(layer, pattern); }
  const s = layerExtent(layer) / MATERIALS.tile; // tile pixel to metres
  pattern.setTransform(new DOMMatrix().rotate(angle * 180 / Math.PI).scale(s, s));
  return pattern;
}
let loaded: MaterialImages | undefined, requested = false;
const waiting = new Set<() => void>();
/** The decoded atlases when already loaded; otherwise starts the load once and calls every `onReady` when done (Canvas 2D paths). */
export function materialImagesNow(onReady?: () => void): MaterialImages | undefined {
  if (loaded) return loaded;
  if (onReady) waiting.add(onReady);
  if (!requested) {
    requested = true;
    loadMaterialImages().then(i => { loaded = i; const calls = [...waiting]; waiting.clear(); for (const call of calls) call(); },
      e => { requested = false; waiting.clear(); console.warn('Matières texturées indisponibles', e); });
  }
  return undefined;
}
