/**
 * Tree symbols of the paper map, painted by the ground shader into its world tiles, like the satellite crowns: the
 * woods appear with the ground, at every zoom, with no recording per view. The overlay no longer draws the forest
 * class of a paper map whose ground carries them (CartographyDeps.groundTrees).
 *
 * - Placement (TREE_SYMBOLS_GLSL): a jittered world lattice hashed like the satellite crowns (groundHash, the map
 *   seed), kept where the applied occupation raster has forest land, outside strict woody clearings, orchards, gardens,
 *   lanes, construction and road corridors, thinned by the satellite stand mosaic (forestPatchThreshold) and thinner
 *   along the wood edge. Painter order is the lattice's row order, so every pixel composites the same symbols the same way.
 * - Symbols: the engraved crowns of the overlay (canopy.ts paintSymbol) in their summer foliage, leafless broadleaves
 *   and palms, painted once per biome palette into a premultiplied RGBA8 array with box mipmaps (TREE_SYMBOL_LAYERS
 *   layers), bound on the brush-atlas unit (the paper map has no painted brushes or crown clumps).
 * - Season: uniforms (`treeSymbolSeason`, `treeSymbolSpecies`); a new date uploads nothing.
 * - The woods' wash under them (stepped edge levels, the shade fringe on the open land around): terms of the same
 *   shader, from the occupation's signed distance to forest land.
 * - Light quality: a sparser lattice, the atlas one mip coarser, a flat wash and no fringe.
 */
import { boxMips } from '../ui/boxMips';
import { CanvasCanopy, TREE_SPECIES } from './canopy';
import { forestLandPaint } from './landuseForestTone';
import type { TreeMix } from './treeSpecies';
import type { CanvasLike } from './canvas';
import type { Palette } from './styles';

import { TREE_SYMBOL_KINDS, TREE_SYMBOL_LAYERS, TREE_SYMBOL_SIZE } from './treeSymbolsGlsl';

const makeCanvas = (width: number, height: number): CanvasLike | null => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height) as unknown as CanvasLike;
  if (typeof document === 'undefined') return null;
  return Object.assign(document.createElement('canvas'), { width, height });
};

/** What the ground needs to draw the woods of a paper map: the overlay's palette (biome and season) and the species. */
export interface TreeSymbolLook extends TreeMix {
  palette: Palette;
}
/** The palette with its trees in summer. */
const summerTrees = (pal: Palette): Palette => (pal.season ? { ...pal, treeFill: pal.season.fill, treeInk: pal.season.ink, season: undefined } : pal);
/** Palette colours the symbols are painted with (the atlas key). */
const symbolKey = (pal: Palette): string => [pal.name, pal.season?.ink ?? pal.treeInk, pal.season?.fill ?? pal.treeFill, pal.ink, pal.paper].join('|');
/** `uTreeSeason` and `uTreeSpecies` (treeSymbolsGlsl.ts). */
export const treeSymbolSeason = (pal: Palette): [number, number, number, number] => (pal.season ? [pal.season.leaf, pal.season.autumn, pal.season.snow, pal.season.spring] : [1, 0, 0, 0]);
export const treeSymbolSpecies = (look: TreeSymbolLook): [number, number, number, number] => [look.conifer, look.palm, look.larch, 0];
let cached: { key: string; levels: readonly Uint8Array[] } | undefined;
/** Mip chain of the symbol atlas (layer-major, premultiplied RGBA8), painted once per biome palette. */
export function treeSymbolLevels(pal: Palette): readonly Uint8Array[] {
  const key = symbolKey(pal);
  if (cached?.key === key) return cached.levels;
  const n = TREE_SYMBOL_SIZE,
    data = new Uint8Array(n * n * 4 * TREE_SYMBOL_LAYERS),
    canvas = makeCanvas(n, n),
    cx = canvas?.getContext('2d', { willReadFrequently: true });
  if (cx) {
    const canopy = new CanvasCanopy('', summerTrees(pal), makeCanvas);
    for (let layer = 0; layer < TREE_SYMBOL_LAYERS; layer++) {
      const species = TREE_SPECIES[Math.floor(layer / TREE_SYMBOL_KINDS)],
        variant = layer % TREE_SYMBOL_KINDS;
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.clearRect(0, 0, n, n);
      // The 20-unit glyph cell over the whole layer.
      cx.setTransform(n / 20, 0, 0, n / 20, n / 2, n / 2);
      canopy.paintSymbol(cx, species, variant, (variant * (species === 'conifer' ? 5 : 7)) % 12);
      const pixels = cx.getImageData(0, 0, n, n).data,
        base = layer * n * n * 4;
      for (let i = 0; i < n * n * 4; i += 4) {
        const a = pixels[i + 3] / 255;
        data[base + i] = Math.round(pixels[i] * a);
        data[base + i + 1] = Math.round(pixels[i + 1] * a);
        data[base + i + 2] = Math.round(pixels[i + 2] * a);
        data[base + i + 3] = pixels[i + 3];
      }
    }
    canopy.dispose();
  }
  const levels = boxMips(data, n, n, 4, TREE_SYMBOL_LAYERS).map(level => level.data);
  cached = { key, levels };
  return levels;
}

/** Wash of the woods under the symbols: the overlay's forest paint (display RGB, alpha). */
export function treeSymbolWash(pal: Palette): [number, number, number, number] {
  const paint = forestLandPaint(pal),
    v = parseInt(paint.color.slice(1, 7), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, paint.alpha];
}

const textures = new WeakMap<WebGL2RenderingContext, { texture: WebGLTexture; key: string }>();
/** TerrainGl: the symbol atlas of `pal` on `unit` (the brush-atlas unit), uploaded when the palette changes. */
export function bindTreeSymbols(gl: WebGL2RenderingContext, uniform: (name: string) => WebGLUniformLocation | null, pal: Palette, unit: number): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  const key = symbolKey(pal);
  let entry = textures.get(gl);
  if (entry?.key !== key) {
    if (entry) gl.deleteTexture(entry.texture);
    const chain = treeSymbolLevels(pal),
      n = TREE_SYMBOL_SIZE;
    entry = { texture: gl.createTexture()!, key };
    textures.set(gl, entry);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, entry.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, chain.length, gl.RGBA8, n, n, TREE_SYMBOL_LAYERS);
    chain.forEach((level, mip) => {
      const s = Math.max(1, n >> mip);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, mip, 0, 0, 0, s, s, TREE_SYMBOL_LAYERS, gl.RGBA, gl.UNSIGNED_BYTE, level);
    });
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  } else gl.bindTexture(gl.TEXTURE_2D_ARRAY, entry.texture);
  gl.uniform1i(uniform('uForestBrushAtlas'), unit);
}
/** TerrainGl: the lit land of the paper map (unpremultiplied RGBA8, transparent on the water) with mipmaps: the
 * ground draws it under the woods, where the overlay leaves its own copy out (`punchWoods`). */
export function landBackdropTexture(gl: WebGL2RenderingContext, image: TexImageSource): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}
/** The overlay's copy of the lit land with the woods left out (the ground draws them over its own copy). Cached per
 * backdrop and land use. */
const punched = new WeakMap<HTMLCanvasElement, { areas: unknown; canvas: HTMLCanvasElement }>();
export function punchWoods(backdrop: HTMLCanvasElement, areas: readonly { kind: string; poly: readonly { x: number; y: number }[]; holes?: readonly (readonly { x: number; y: number }[])[] }[], mapSize: number): HTMLCanvasElement {
  const found = punched.get(backdrop);
  if (found?.areas === areas) return found.canvas;
  const canvas = Object.assign(document.createElement('canvas'), { width: backdrop.width, height: backdrop.height }),
    ctx = canvas.getContext('2d')!,
    k = backdrop.width / mapSize;
  ctx.drawImage(backdrop, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  for (const wood of areas) {
    if (wood.kind !== 'forest') continue;
    const path = new Path2D();
    for (const ring of [wood.poly, ...(wood.holes ?? [])]) {
      ring.forEach((p, i) => (i ? path.lineTo(p.x * k, p.y * k) : path.moveTo(p.x * k, p.y * k)));
      path.closePath();
    }
    ctx.fill(path, 'evenodd');
  }
  punched.set(backdrop, { areas, canvas });
  return canvas;
}
/** `release` false: only forget the texture (a restored context, whose old objects are already gone). */
export function disposeTreeSymbols(gl: WebGL2RenderingContext, release = true): void {
  const entry = textures.get(gl);
  if (entry && release) gl.deleteTexture(entry.texture);
  textures.delete(gl);
}
