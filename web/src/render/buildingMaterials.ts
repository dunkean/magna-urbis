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
    case 'pier': case 'boardwalk': case 'walkway': return MATERIALS.road.bridge_timber;
    case 'quay': return MATERIALS.road.quay; case 'port-stairs': case 'stairs': return MATERIALS.road.stairs; case 'market': return MATERIALS.road.market;
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

// ---------------------------------------------------------------- procedural roof covers (2D plans)
/** Roof covers as an aerial photograph shows them at 5 to 40 cm per pixel: no outlines, only the cover's own fine
 * structure (the tone of each tile, slab, board or bundle, course shadows, ribs, seams, fibres). One small tile per
 * family, drawn once: a zero-mean field of darker and lighter marks stored as translucent black / white pixels, so a
 * single `source-over` fill over the flat roof colour shifts its lightness only (a glazed green tile stays green, a
 * slate stays blue-grey) and leaves its mean. Tile +y runs down the slope. Halved copies (box-filtered, like mip
 * levels) serve the coarser zooms: the units a level no longer resolves average out of it, and what is left is
 * the weathering of the cover (GRAIN_WEATHER), as fine as the pixel at every scale, so every cover keeps a grain of
 * its own until the roofs themselves are a few pixels wide. */
export const COVER_GRAINS = ['tile', 'pantile', 'glazed', 'slate', 'slab', 'paving', 'thatch', 'reed', 'palm', 'turf', 'shingle', 'bark', 'bamboo', 'earth', 'lime', 'metal', 'felt', 'hide'] as const;
export type CoverGrain = typeof COVER_GRAINS[number];
/** Tone variation (rms, in the units of grainValue) each family keeps once its own units are no longer resolved:
 * the weathering of groups of tiles, slabs, bundles or boards. Even covers (glazed tiles, slate, reed, plaster,
 * metal, felt) keep little; fired clay, stone, straw, turf, timber and hides keep more. Its shape comes from the
 * family's own field: speckle for tiles and slabs, streaks down the slope for straw, reed and shingles, stains for
 * earth and lime. */
const GRAIN_WEATHER: Record<CoverGrain, number> = { tile: .3, pantile: .32, glazed: .1, slate: .16, slab: .34, paving: .26, thatch: .3, reed: .16, palm: .3, turf: .3,
  shingle: .28, bark: .25, bamboo: .14, earth: .25, lime: .14, metal: .12, felt: .1, hide: .26 };
/** Metres per device pixel where the roof grain starts to fade, and where it is gone (a house is then a few pixels). */
const GRAIN_FADE = .45, GRAIN_GONE = 1.1;
/** Cultures whose clay tiles are half-round and interlocking (imbrex and tegula, canal, mission and pot tiles): they
 * read as ribs running down the slope. */
const RIBBED_TILES = new Set(['roman-core', 'byzantine-greek', 'venetian-lagoon', 'italian-comune', 'al-andalus', 'bastide', 'ottoman', 'medina', 'levantine-tell', 'persian',
  'indian-temple', 'dravidian-temple', 'rajput-fort', 'khmer', 'swahili-stone-town']);
/** East Asian glazed tiles: the same ribs, regular, with an even tone. */
const GLAZED_TILES = new Set(['chinese', 'korean', 'japanese-jokamachi', 'vietnamese-citadel']);
/** Grain family of a roof pan, from its massing cover, whether the pan is flat (no slope: nothing directional) and
 * the culture of its building. Undefined keeps the flat colour: snow huts (blocks below any map scale, white on
 * white), ruins (broken wall tops, not a cover) and unknown covers.
 *  - tile: ribs (pantile, glazed) or plain courses by culture; a tiled, slated or stone terrace is paved;
 *  - stone: slab courses on a pitch, a dome, a vault or a spire; slate: thin staggered slates;
 *  - thatch (straw, combed), reed (fine and smooth), palm (coarse overlapping fronds), turf (living grass, no direction);
 *  - shingle, bark (large sheets), bamboo (split canes down the slope); their flat decks only keep soft stains;
 *  - earth (terraces: stains, repairs, cracks), plaster and fungal caps (lime: soft stains only);
 *  - metal and lead (standing seams; flat sheets only keep soft stains, their seam direction is unknown);
 *  - felt (strips and girth ropes), hide (stitched skins); the flat crown of a tent keeps soft stains. */
export function roofGrain(cover: string | undefined, flat: boolean, culture = ''): CoverGrain | undefined {
  switch (cover) {
    case 'tile': return flat ? 'paving' : GLAZED_TILES.has(culture) ? 'glazed' : RIBBED_TILES.has(culture) ? 'pantile' : 'tile';
    case 'slate': return flat ? 'paving' : 'slate';
    case 'stone': return flat ? 'paving' : 'slab';
    case 'thatch': return 'thatch'; case 'reed': return 'reed'; case 'palm': return 'palm'; case 'turf': return 'turf';
    case 'shingle': return flat ? 'lime' : 'shingle';
    case 'bark': return flat ? 'lime' : 'bark';
    case 'bamboo': return flat ? 'lime' : 'bamboo';
    case 'earth': return 'earth';
    case 'plaster': case 'fungal': return 'lime';
    case 'metal': case 'lead': return flat ? 'lime' : 'metal';
    case 'felt': return flat ? 'lime' : 'felt';
    case 'hide': return flat ? 'lime' : 'hide';
    default: return undefined;
  }
}
/** Tile side in pixels, metres per pixel of the finest level, and the number of halved levels. */
const GRAIN_TILE = 256, GRAIN_PX_M = .05, GRAIN_LEVELS = 8;
/** Opacity of the strongest grain mark: the grain stays a faint texture under the roof's own light and shade. */
const GRAIN_STRENGTH = .26;
const grainHash = (x: number, y: number, seed: number): number => {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(seed, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};
/** Smooth value noise in -1..1 that wraps at the tile edge; the cell sizes (pixels) divide the tile side. */
function grainNoise(x: number, y: number, cellX: number, cellY: number, seed: number): number {
  const nx = GRAIN_TILE / cellX, ny = GRAIN_TILE / cellY, fx = x / cellX, fy = y / cellY, ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const at = (i: number, j: number): number => grainHash(i % nx, j % ny, seed);
  const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
}
/** Deviation of one pixel from the cover's mean tone (about -1..1), x along the ridge, y down the slope. */
function grainValue(kind: CoverGrain, x: number, y: number): number {
  const row = y >> 3, unit = (cx: number, cy: number, seed: number): number => grainHash(cx, cy, seed) - .5;
  switch (kind) {
    case 'tile': {
      // Plain flat tiles of northern Europe: courses across the slope, each tile fired a little differently, a
      // shadow under each course.
      const u = x + (row & 1) * 2;
      return .9 * unit((u >> 2) % 64, row, 11) + ((y & 7) === 7 ? -.6 : (y & 7) === 0 ? .15 : 0) + .05 * grainNoise(x, y, 16, 128, 2);
    }
    case 'pantile': {
      // Half-round tiles: a dark channel and a lit crown every 20 cm down the slope, tiles of many firings, the
      // end of each tile barely marked.
      const rib = (x & 3) === 0 ? -.5 : (x & 3) === 2 ? .3 : .1;
      return rib + 1.1 * unit(x >> 2, row, 14) + ((y & 7) === 7 ? -.25 : 0);
    }
    case 'glazed': {
      // Glazed East Asian tiles: the same ribs, regular and even.
      const rib = (x & 3) === 0 ? -.55 : (x & 3) === 2 ? .3 : .12;
      return rib + .3 * unit(x >> 2, row, 15) + ((y & 7) === 7 ? -.1 : 0);
    }
    case 'slate': {
      // Thin staggered slates: fine joints, little tone variation, a cool even surface.
      const r = y >> 2, u = x + (r & 1) * 2;
      return .55 * unit((u >> 2) % 64, r, 12) + ((y & 3) === 3 ? -.4 : 0) + ((u & 3) === 0 ? -.2 : 0);
    }
    case 'slab': {
      // Stone slabs (lauzes) and the dressed courses of domes, vaults and spires: slabs of uneven width, deep joints.
      const u = x + Math.floor(grainHash(row, 0, 16) * 16), wide = grainHash(u >> 4, row, 17) < .5, slab = wide ? u >> 4 : u >> 3;
      return 1.2 * unit(slab % 32, row + (wide ? 64 : 0), 18) + ((y & 7) === 7 ? -.6 : 0) + ((u & (wide ? 15 : 7)) === 0 ? -.55 : 0);
    }
    case 'paving': {
      // Flagged or tiled terrace: square slabs in broken bond, no direction.
      const r = y >> 4, u = x + (r & 1) * 8;
      return .9 * unit((u >> 4) % 16, r, 19) + ((y & 15) === 0 ? -.55 : 0) + ((u & 15) === 0 ? -.55 : 0);
    }
    case 'thatch':
      // Straw combed down the slope in narrow strands, a soft ledge where the bundles overlap.
      return .65 * grainNoise(x, y, 2, 64, 1) + .4 * grainNoise(x, y, 4, 128, 2) + ((y & 31) < 2 ? -.25 : 0);
    case 'reed':
      // Reed: finer and smoother than straw, no ledges.
      return .4 * grainNoise(x, y, 2, 128, 1) + .2 * grainNoise(x, y, 4, 128, 2);
    case 'palm': {
      // Palm and broad-leaf thatch: rows of fronds overlapping every 80 cm with a ragged edge, coarse leaflets.
      const yy = y + Math.round(3 * grainNoise(x, y, 8, 256, 6)), r = (yy >> 4) & 15, edge = (yy & 15) > 12 ? -.7 : (yy & 15) < 2 ? .2 : 0;
      return edge + .55 * grainNoise(x, y, 2, 16, 1) + .6 * unit(x >> 3, r, 20);
    }
    case 'turf':
      // Living sod: soft clumps of grass, no stems and no direction.
      return .45 * grainNoise(x, y, 32, 32, 7) + .5 * grainNoise(x, y, 8, 8, 1) + .4 * grainNoise(x, y, 4, 4, 2) + .2 * grainNoise(x, y, 2, 2, 5);
    case 'shingle': {
      // Narrow split boards, silvered unevenly.
      const u = x + (row & 1) * 2;
      return .9 * unit((u >> 2) % 64, row, 13) + ((y & 7) === 7 ? -.5 : 0) + .2 * grainNoise(x, y, 2, 32, 1);
    }
    case 'bark': {
      // Sheets of bark 1.6 m wide laid in overlapping rows, their grain running across the sheet.
      const r = y >> 4, u = x + (r & 1) * 16;
      return .8 * unit((u >> 5) % 8, r, 21) + ((y & 15) === 15 ? -.55 : 0) + ((u & 31) === 0 ? -.45 : 0) + .25 * grainNoise(x, y, 16, 2, 3);
    }
    case 'bamboo': {
      // Split canes down the slope: one cane every 10 cm, its nodes every 40 cm.
      const cane = x >> 1, node = ((y + Math.floor(grainHash(cane, 0, 22) * 8)) & 7) === 0;
      return ((x & 1) ? .25 : -.35) + .5 * unit(cane, 0, 23) + (node ? -.4 : 0);
    }
    case 'earth': {
      // Rammed earth on a terrace: stains of standing water, squares of fresh repair, a few shrinkage cracks.
      const crack = Math.abs(grainNoise(x, y, 32, 32, 4)) < .03 ? -.6 : 0, repair = grainHash(x >> 5, y >> 5, 24) < .14 ? .3 : 0;
      return .5 * grainNoise(x, y, 16, 16, 2) + .3 * grainNoise(x, y, 4, 4, 5) + crack + repair;
    }
    case 'lime':
      // Lime plaster, domes and other smooth skins: faint stains only.
      return .3 * grainNoise(x, y, 16, 16, 2) + .2 * grainNoise(x, y, 4, 4, 5);
    case 'metal': {
      // Lead or copper sheets: standing seams down the slope (dark side, lit side), lap joints across, sheets of
      // slightly different patina.
      const seam = (x & 15) === 0 ? -.7 : (x & 15) === 1 ? .5 : 0;
      return seam + ((y & 63) === 0 ? -.4 : 0) + .35 * unit(x >> 4, y >> 6, 25) + .1 * grainNoise(x, y, 8, 128, 2);
    }
    case 'felt':
      // Felt strips sewn down the slope (radial on a round tent) and the girth ropes across them.
      return ((x & 31) === 0 ? -.45 : 0) + ((y & 15) === 0 ? -.5 : 0) + .2 * grainNoise(x, y, 8, 8, 1);
    default: {
      // Hides stitched together: large pieces in broken bond, each tanned and smoked differently.
      const r = y >> 5, u = x + (r & 1) * 16;
      return .9 * unit((u >> 5) % 8, r, 26) + ((y & 31) === 0 ? -.55 : 0) + ((u & 31) === 0 ? -.55 : 0);
    }
  }
}
type GrainCanvas = OffscreenCanvas | HTMLCanvasElement;
const grainCanvas = (size: number): GrainCanvas | undefined => typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size)
  : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: size, height: size }) : undefined;
/** Snow lying on a roof face, as a pattern of the snow's own colour whose opacity is the cover of the mantle: whole
 * with a few thin places ('snow'), or broken into patches that let the cover show ('snowPatchy'), each sunlit or in
 * shade (a little bluer). Thin places and patches are drawn out down the slope, where the snow slips. */
export type SnowCover = 'snow' | 'snowShade' | 'snowPatchy' | 'snowPatchyShade';
type RoofPattern = CoverGrain | SnowCover;
/** Opacity (0..1) of the mantle at one pixel of the snow tile. */
function snowValue(x: number, y: number, patchy: boolean): number {
  const n = .55 * grainNoise(x, y, 16, 64, 31) + .3 * grainNoise(x, y, 8, 16, 32) + .15 * grainNoise(x, y, 4, 4, 33);
  const t = Math.max(0, Math.min(1, patchy ? (n + .1) / .4 : (n + .6) / .45));
  return t * t * (3 - 2 * t) * (patchy ? 1 : .9 + .1 * grainNoise(x, y, 2, 2, 34));
}
const grainTiles = new Map<RoofPattern, GrainCanvas[] | null>();
/** The tile of a family and its halved copies; null where the host has no canvas (the roofs keep their flat colour). */
function grainLevels(kind: RoofPattern): GrainCanvas[] | null {
  let levels = grainTiles.get(kind);
  if (levels !== undefined) return levels;
  levels = null;
  try {
    const n = GRAIN_TILE, base = grainCanvas(n), c = base?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (base && c) {
      const snow = kind === 'snow' || kind === 'snowShade' || kind === 'snowPatchy' || kind === 'snowPatchyShade';
      const built: GrainCanvas[] = [base];
      if (snow) {
        const image = c.createImageData(n, n), data = image.data;
        const patchy = kind === 'snowPatchy' || kind === 'snowPatchyShade', tone = kind === 'snowShade' || kind === 'snowPatchyShade' ? [226, 232, 241] : [245, 246, 247];
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const o = (y * n + x) * 4;
          data[o] = tone[0]; data[o + 1] = tone[1]; data[o + 2] = tone[2]; data[o + 3] = Math.round(255 * Math.max(0, Math.min(1, snowValue(x, y, patchy))));
        }
        c.putImageData(image, 0, 0);
        for (let l = 1; l < GRAIN_LEVELS; l++) {
          const half = grainCanvas(n >> l), h = half?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
          if (!half || !h) break;
          h.imageSmoothingEnabled = true; h.drawImage(built[l - 1], 0, 0, n >> l, n >> l); built.push(half);
        }
      } else {
        // Neutral marks: black and white change the lightness of the cover and keep its hue. A light mark moves a
        // mid-tone roof further than a dark mark of the same opacity: .7 balances the two.
        const paint = (target: CanvasRenderingContext2D, field: Float32Array, size: number): void => {
          const image = target.createImageData(size, size), data = image.data;
          for (let i = 0; i < size * size; i++) {
            const d = Math.max(-1, Math.min(1, field[i])), o = i * 4;
            if (d < 0) data[o + 3] = Math.round(-d * GRAIN_STRENGTH * 255);
            else { data[o] = data[o + 1] = data[o + 2] = 255; data[o + 3] = Math.round(d * GRAIN_STRENGTH * .7 * 255); }
          }
          target.putImageData(image, 0, 0);
        };
        let field = new Float32Array(n * n), mean = 0;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) mean += field[y * n + x] = grainValue(kind as CoverGrain, x, y);
        mean /= n * n;
        for (let i = 0; i < n * n; i++) field[i] -= mean;
        paint(c, field, n);
        // Coarser levels from the field itself: a box filter removes the units the level no longer resolves, then
        // the level is lifted (at most the factor white noise loses per level) back to the cover's weathering.
        const weather = GRAIN_WEATHER[kind as CoverGrain];
        for (let l = 1, size = n >> 1; l < GRAIN_LEVELS; l++, size >>= 1) {
          const half = grainCanvas(size), h = half?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
          if (!half || !h) break;
          const next = new Float32Array(size * size), wide = size * 2; let sum = 0, square = 0;
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const o = 2 * y * wide + 2 * x, v = (field[o] + field[o + 1] + field[o + wide] + field[o + wide + 1]) / 4;
            next[y * size + x] = v; sum += v; square += v * v;
          }
          const centre = sum / (size * size), rms = Math.sqrt(Math.max(0, square / (size * size) - centre * centre));
          const lift = rms > 1e-6 ? Math.max(1, Math.min(2, weather / rms)) : 1;
          for (let i = 0; i < size * size; i++) next[i] = (next[i] - centre) * lift;
          paint(h, next, size); built.push(half); field = next;
        }
      }
      levels = built;
    }
  } catch { levels = null; }
  grainTiles.set(kind, levels);
  return levels;
}
/** Level of a roof pattern whose pixels are at least as large as the screen's, from the metres one device pixel
 * covers: never minified, so it cannot alias; the last levels are the tile's mean. */
export const roofPatternLevel = (deviceMetresPerPixel: number): number =>
  Math.max(0, Math.min(GRAIN_LEVELS - 1, Math.ceil(Math.log2(Math.max(deviceMetresPerPixel, 1e-6) / GRAIN_PX_M))));
export interface CoverGrainFrame { level: number; /** Strength of each family, indexed like COVER_GRAINS. */ alpha: Float32Array }
let grainFrame: { mpp: number; frame: CoverGrainFrame } | undefined;
/** Level and strengths of the roof grain for a frame, from the metres one device pixel covers: the level whose
 * pixels are at least as large as the screen's (never minified, so it cannot alias), and a strength that fades with
 * the size of the roofs on screen, the same for every family: each one keeps its units near and its weathering
 * further out. Undefined: roofs are too small, the frame draws no grain. */
export function coverGrainFrame(deviceMetresPerPixel: number): CoverGrainFrame | undefined {
  if (!(deviceMetresPerPixel > 0) || deviceMetresPerPixel >= GRAIN_GONE) return undefined;
  if (grainFrame?.mpp === deviceMetresPerPixel) return grainFrame.frame;
  const level = roofPatternLevel(deviceMetresPerPixel);
  const t = Math.max(0, Math.min(1, (deviceMetresPerPixel - GRAIN_FADE) / (GRAIN_GONE - GRAIN_FADE))), strength = 1 - t * t * (3 - 2 * t);
  const alpha = Float32Array.from(COVER_GRAINS, () => strength);
  grainFrame = { mpp: deviceMetresPerPixel, frame: { level, alpha } };
  return grainFrame.frame;
}
/** Patterns belong to the kind of context that made them (a recording context makes its own). */
const grainPatterns = new WeakMap<object, Map<string, CanvasPattern | null>>();
const grainMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
/** Repeating grain of a cover family, or snow cover, for a context drawing in world metres, turned so that its courses lie across the
 * slope (`dir`: downslope direction in plan, radians) and shifted by (`shiftX`, `shiftY`) metres so two roofs never
 * show the same piece of it. The pattern is shared: set `fillStyle` and fill right away. */
export function coverGrainPattern(ctx: CanvasRenderingContext2D, kind: CoverGrain | SnowCover, level: number, dir: number, shiftX = 0, shiftY = 0): CanvasPattern | undefined {
  const owner = Object.getPrototypeOf(ctx) as object;
  let made = grainPatterns.get(owner); if (!made) grainPatterns.set(owner, made = new Map());
  const key = `${kind}/${level}`;
  let pattern = made.get(key);
  if (pattern === undefined) {
    const tile = grainLevels(kind)?.[level];
    pattern = tile ? ctx.createPattern(tile, 'repeat') : null;
    made.set(key, pattern);
  }
  if (!pattern) return undefined;
  // Rotation by dir - 90°: the tile's +y axis lands on the downslope direction.
  const s = GRAIN_PX_M * 2 ** level, cos = Math.sin(dir) * s, sin = -Math.cos(dir) * s;
  grainMatrix.a = cos; grainMatrix.b = sin; grainMatrix.c = -sin; grainMatrix.d = cos; grainMatrix.e = shiftX; grainMatrix.f = shiftY;
  pattern.setTransform(grainMatrix);
  return pattern;
}
