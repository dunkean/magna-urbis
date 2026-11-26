/**
 * Trees as sprites: tree marks per index tile, the canopy sprite batches of a GPU recording, the sprite layer tiles
 * (woods and parchment symbols pre-composited per density and tile), and the woods of the 3D drape tiles.
 * Reads: scene, world, palette, canopy, brushes, stepwise, layerTilesFit, recordingNow. Writes: treeMarks,
 * treeSprites, layerTiles, layerTilesFailed, recordedTiles, drapeTemps, canopyScratch.
 */
import { canopyMarks } from '../canopy';
import { bboxOf, orientPos } from '../../gen/geo/poly';
import { TextureLayer, pointInRenderPoly, type Mark } from '../scene';
import { Rect4 } from '../view';
import { RecordingContext } from '../gpu/recorder';
import { existingGpuRasterizer } from '../vectorEngine';
import { CanvasLike } from './contract';
import type { CartographyContext } from './context';
import { growRect, vhash, clumpNoise, addRing } from './geometry';
import { forestClip, forestWeight, roomOf, coniferOf } from './forest';

/** Sprite layers (woods, parchment symbols) are pre-composited in tiles of this many pixels, one tile set per
 * power-of-two pixel density up to LAYER_TILE_MAX_DENSITY px/m; closer views stamp their few sprites directly. */
const LAYER_TILE_PX = 512,
  LAYER_TILE_MAX_DENSITY = 4;
/** Texels around a layer tile (filtering at the seams), and the byte budget of the layer tiles (context.ts). */
export const LAYER_TILE_GUTTER = 2,
  LAYER_TILE_BYTES = 128 * 1024 * 1024;
/** Farthest reach of a sprite from its mark (m): the largest canopy crown is 10 x 1.59 m from its centre. */
export const LAYER_TILE_REACH = 16;
/** GPU engine: most woods sprites one cached batch may hold (one instanced draw; a far view of a wooded map). */
const GPU_SPRITE_BATCH_MAX = 400_000;
/** GPU engine: sprite marks in view under which a layer stamps them directly on the recording (instanced) instead of pre-compositing layer tiles. */
export const GPU_SPRITE_BUDGET = 60_000;
/** Tree centres of a wood or orchard layer within `area`, in draw order (cached per index tile). */
export function treeMarksIn(c: CartographyContext, tl: TextureLayer, area: Rect4): Mark[] {
  const marks: Mark[] = [];
  for (const tile of tl.index.tilesInRect(area)) {
    for (const m of tileTreeMarks(c, tl, tile)) if (m.x >= area.minX && m.x <= area.maxX && m.y >= area.minY && m.y <= area.maxY) marks.push(m);
  }
  return marks.sort((a, b) => a.y - b.y || a.x - b.x);
}
/** Tree marks of one index tile (all of them, cached for the whole map). */
function tileTreeMarks(c: CartographyContext, tl: TextureLayer, tile: number): Mark[] {
  const { pal, canopy, brushes, treeMarks, polyL } = c;
  let entries = treeMarks.get(tl);
  if (!entries) {
    entries = new Map();
    treeMarks.set(tl, entries);
  }
  const exclusion = tl.kind === 'forest' ? polyL('u-forest-clearings') : undefined;
  const room = tl.kind === 'forest' ? roomOf(c) : undefined;
  {
    let points = entries.get(tile);
    if (!points) {
      points = canopyMarks(tl, tile, c.world.seed).filter(
        m =>
          (tl.kind !== 'forest' || m.k < (canopy ? 0.5 + 0.5 * forestWeight(c, m.x, m.y) : forestWeight(c, m.x, m.y))) &&
          (!room || room.keeps(m.x, m.y, (m.k * 37.17) % 1, (canopy ? 6.1 : brushes ? 4.75 : 0) * m.r)) &&
          // Parchment woods grow in clumps: small glades let the dark shaded floor show between them.
          (tl.kind !== 'forest' || !canopy || pal.name !== 'parchment' || clumpNoise(m.x, m.y, 26, 5) > 0.27) &&
          (!exclusion || !exclusion.index.query({ minX: m.x, minY: m.y, maxX: m.x, maxY: m.y }).some(i => pointInRenderPoly(exclusion.polys[i], m.x, m.y) && !(exclusion.holes?.[i] ?? []).some(h => pointInRenderPoly(h, m.x, m.y)))),
      );
      // Marks are small and zoom-independent: keep a whole map of them, or every zoom step recomputes them.
      if (entries.size >= 8192) entries.delete(entries.keys().next().value!);
      entries.set(tile, points);
    }
    return points;
  }
}
/** Warming of the tree marks (`warmTreeMarks`): per wood or orchard layer, its index tiles and the next one to compute. */
const WARMING = new WeakMap<TextureLayer, { tiles: number[]; next: number }>();
/** Index tiles a layer may warm: the mark cache keeps 8192 per layer, a larger layer would evict what it warms. */
const WARM_TILES = 8192;
/** Computes the tree marks of the woods and orchards, index tile by index tile, until `deadline`: the clearings and
 * room tests of a tile cost milliseconds, and a band or a drape tile meeting tens of cold tiles at once was one
 * block of 220 ms (parchment, 40 km). The marks are zoom-independent and cached for the whole map, so they are made
 * once per content in the idle slices of the live overlay. True when every tile is warm. */
export function warmTreeMarks(c: CartographyContext, deadline: number): boolean {
  const size = c.world.mapSize;
  for (const tl of c.scene.textures) {
    if (tl.kind !== 'forest' && tl.kind !== 'orchard') continue;
    // The ground paints the woods (render/treeSymbols.ts): no forest marks to make.
    if (tl.kind === 'forest' && c.deps.groundTrees?.()) continue;
    let state = WARMING.get(tl);
    if (!state) {
      const tiles = tl.index.tilesInRect({ minX: 0, minY: 0, maxX: size, maxY: size });
      WARMING.set(tl, (state = { tiles: tiles.length <= WARM_TILES ? tiles : [], next: 0 }));
    }
    while (state.next < state.tiles.length) {
      if (performance.now() >= deadline) return false;
      tileTreeMarks(c, tl, state.tiles[state.next++]);
    }
  }
  return true;
}
/** False when the canopy draws vector glyphs at this scale (no atlas): the caller paints the trees itself. */
export function recordTreeSprites(c: CartographyContext, ctx: RecordingContext, tl: TextureLayer, area: Rect4, pxPerMetre: number): boolean {
  const steps = recordTreeSpriteSteps(c, ctx, tl, area, pxPerMetre);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
export function* recordTreeSpriteSteps(c: CartographyContext, ctx: RecordingContext, tl: TextureLayer, area: Rect4, pxPerMetre: number): Generator<void, boolean> {
  const { canopy, brushes, treeSprites } = c;
  if (!canopy || brushes) return false;
  const kind = tl.kind === 'orchard' ? 'orchard' : 'forest',
    resolution = canopy.resolutionFor(pxPerMetre, 1);
  const image = canopy.spriteImage(kind, resolution, kind === 'forest');
  if (!image) return false;
  let cache = treeSprites.get(tl);
  if (!cache) {
    cache = new Map();
    treeSprites.set(tl, cache);
  }
  const parts: { data: Float32Array; marks: Mark[] }[] = [];
  for (const tile of tl.index.tilesInRect(area)) {
    const key = `${tile}|${resolution}`;
    let entry = cache.get(key);
    if (entry === undefined) {
      const marks = tileTreeMarks(c, tl, tile);
      entry = { marks, data: canopy.spriteGeometry(marks, resolution, kind === 'forest' ? (m: Mark) => coniferOf(c, m) : undefined) };
      if (cache.size >= 16384) cache.delete(cache.keys().next().value!);
      cache.set(key, entry);
    }
    if (entry.marks.length) parts.push(entry);
    yield;
  }
  if (!parts.length) return true;
  // Gather the marks inside the area, painted from back to front like the Canvas canopy (sorted by y, then x).
  let n = 0;
  for (const p of parts) n += p.marks.length;
  const data = new Float32Array(n * 8),
    xs = new Float64Array(n),
    ys = new Float64Array(n);
  let count = 0;
  for (const p of parts) {
    for (let i = 0; i < p.marks.length; i++) {
      const m = p.marks[i];
      if (m.x < area.minX || m.x > area.maxX || m.y < area.minY || m.y > area.maxY) continue;
      data.set(p.data.subarray(i * 8, i * 8 + 8), count * 8);
      xs[count] = m.x;
      ys[count] = m.y;
      count++;
    }
    yield;
  }
  if (count > GPU_SPRITE_BATCH_MAX) return false;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => ys[a] - ys[b] || xs[a] - xs[b]);
  ctx.globalAlpha = 1;
  ctx.drawImageBatch(image, data, order);
  return true;
}
/** Whole trees at their marks: painted brushes, or the canopy sprites (engraved on parchment). */
export function paintTrees(c: CartographyContext, ctx: CanvasRenderingContext2D, tl: TextureLayer, marks: Mark[], pxPerMetre: number): void {
  const { canopy, brushes } = c;
  if (brushes)
    for (const m of marks) {
      ctx.globalAlpha = 0.88 + 0.12 * m.k;
      brushes.tree(ctx, m.x, m.y, (tl.kind === 'orchard' ? 3.5 : 4.75) * m.r, tl.kind === 'orchard');
    }
  else canopy!.draw(ctx, marks, tl.kind === 'orchard' ? 'orchard' : 'forest', pxPerMetre, 1, tl.kind === 'forest' ? (m: Mark) => coniferOf(c, m) : undefined);
  ctx.globalAlpha = 1;
}
/** Whether every non-empty sprite-layer tile of a view fits the tile cache at once (`pxPerMetre`: device pixels). */
export function layerTilesFitView(c: CartographyContext, rect: Rect4, pxPerMetre: number): boolean {
  const { layerTiles } = c;
  if (!(pxPerMetre > 0)) return false;
  const density = 2 ** Math.ceil(Math.log2(pxPerMetre));
  if (density > LAYER_TILE_MAX_DENSITY) return true;
  const span = LAYER_TILE_PX / density,
    side = LAYER_TILE_PX + 2 * LAYER_TILE_GUTTER,
    limit = layerTiles.maxBytes * 0.75;
  const x0 = Math.floor(rect.minX / span),
    x1 = Math.floor(rect.maxX / span),
    y0 = Math.floor(rect.minY / span),
    y1 = Math.floor(rect.maxY / span);
  let bytes = 0;
  for (const tl of c.scene.textures)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!tl.index.query(growRect({ minX: x * span, minY: y * span, maxX: (x + 1) * span, maxY: (y + 1) * span }, LAYER_TILE_REACH + LAYER_TILE_GUTTER)).length) continue;
        if ((bytes += side * side * 4) > limit) return false;
      }
  return true;
}
/**
 * Sprite layers (woods, parchment symbols) pre-composited per (layer, power-of-two pixel density, 512 px tile).
 * A tile holds every mark whose sprite reaches it, in the global draw order, so neighbouring tiles join exactly and
 * the result is the one of stamping the marks one by one. A frame then draws a few bitmaps instead of thousands of
 * sprites, and zooming within a density octave or panning back redraws nothing. False: draw directly.
 */
export function drawLayerTiles(c: CartographyContext, ctx: CanvasRenderingContext2D, tl: TextureLayer, part: string, rect: Rect4, paint: (target: CanvasRenderingContext2D, area: Rect4, pxPerMetre: number) => void): boolean {
  const { makeCanvas, layerTiles, recordedTiles, brushIdOf } = c;
  if (c.layerTilesFailed || !c.layerTilesFit) return false;
  const t = ctx.getTransform();
  if (t.b || t.c || !(t.a > 0) || Math.abs(t.d - t.a) > t.a * 1e-6) return false;
  const density = 2 ** Math.ceil(Math.log2(t.a));
  if (density > LAYER_TILE_MAX_DENSITY) return false;
  // A cold sprite tile must not expand one small stepwise map tile into a 512 px raster job.
  const tilePx = c.stepwise ? 256 : LAYER_TILE_PX;
  const span = tilePx / density,
    g = LAYER_TILE_GUTTER,
    side = tilePx + 2 * g;
  const x0 = Math.floor(rect.minX / span),
    x1 = Math.floor(rect.maxX / span),
    y0 = Math.floor(rect.minY / span),
    y1 = Math.floor(rect.maxY / span);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) * side * side * 4 > layerTiles.maxBytes * 0.75) return false;
  const id = brushIdOf(tl);
  // Resolve every tile before painting the target, so an allocation refusal still leaves the direct path.
  const tiles: { image: CanvasImageSource; x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const key = `${id}|${part}|${density}|${tilePx}|${x},${y}`;
      let image = layerTiles.get(key);
      if (image === undefined) {
        const area = { minX: x * span - g / density, minY: y * span - g / density, maxX: (x + 1) * span + g / density, maxY: (y + 1) * span + g / density };
        const bounds = growRect(area, LAYER_TILE_REACH);
        if (!tl.index.query(bounds).length) {
          image = null;
          layerTiles.put(key, { value: null, bytes: 0, bounds, release: () => {} });
        } else {
          const target = makeCanvas(side, side),
            tx = target?.getContext('2d');
          if (!target || !tx) {
            c.layerTilesFailed = true;
            layerTiles.clear();
            return false;
          }
          tx.setTransform(density, 0, 0, density, -area.minX * density, -area.minY * density);
          paint(tx, area, density);
          // The canvas is the tile (no transferToImageBitmap: it would wait for the GPU raster on the main thread).
          const value = target as unknown as CanvasImageSource;
          image = value;
          // The GPU engine may hold a texture of this canvas: drop it with the tile.
          // A retained GPU list may still replay this canvas after its eviction: such a canvas is only dropped (the
          // garbage collector frees it with the list), never emptied, or the replay would draw from a blank source.
          layerTiles.put(key, {
            value,
            bytes: side * side * 4,
            bounds,
            release: () => {
              existingGpuRasterizer()?.invalidateImage(value);
              if (!recordedTiles.has(value)) {
                target.width = 0;
                target.height = 0;
              }
            },
          });
        }
      }
      if (image) tiles.push({ image, x, y });
    }
  // Each device pixel belongs to one tile (integer partition); the gutters only feed the filtering at the seams.
  const k = t.a / density;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  for (const tile of tiles) {
    const sx = t.a * tile.x * span + t.e,
      sy = t.d * tile.y * span + t.f;
    const left = Math.round(sx),
      top = Math.round(sy),
      right = Math.round(sx + t.a * span),
      bottom = Math.round(sy + t.d * span);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    if (ctx instanceof RecordingContext) recordedTiles.add(tile.image);
    ctx.drawImage(tile.image, sx - g * k, sy - g * k, side * k, side * k);
    ctx.restore();
  }
  ctx.restore();
  return true;
}
export function releaseDrapeTemps(c: CartographyContext): void {
  const { drapeTemps } = c;
  const gpu = existingGpuRasterizer();
  for (const c of drapeTemps.splice(0)) {
    gpu?.invalidateImage(c as unknown as CanvasImageSource);
    c.width = 0;
    c.height = 0;
  }
}
export function drawDrapeCanopy(c: CartographyContext, ctx: CanvasRenderingContext2D, tl: TextureLayer, rect: Rect4, pxPerMetre: number): number {
  const { pal, P, makeCanvas, canopy, drapeTemps, cached, brushIdOf } = c;
  const ids = tl.index.query(rect);
  if (!ids.length || !canopy) return 0;
  const target = ctx.canvas as unknown as CanvasLike,
    w = target.width,
    h = target.height;
  let scratch = c.canopyScratch;
  if (ctx instanceof RecordingContext) {
    // A recorded drawImage keeps its source until the tile is rasterised: a scratch of its own per call, released after.
    scratch = makeCanvas(w, h) ?? undefined;
    if (scratch) drapeTemps.push(scratch);
  } else {
    if (!scratch || scratch.width !== w || scratch.height !== h) c.canopyScratch = scratch = makeCanvas(w, h) ?? undefined;
  }
  const sx = scratch?.getContext('2d');
  if (!scratch || !sx) return 0;
  const f = 2 ** Math.max(0, Math.ceil(Math.log2(0.5 / Math.max(1e-6, pxPerMetre)))),
    sp = 6 * f;
  const boxes = ids.map(i => bboxOf(tl.areas[i].poly)).map(b => ({ minX: Math.max(rect.minX, b.x0) - 14 * f, minY: Math.max(rect.minY, b.y0) - 14 * f, maxX: Math.min(rect.maxX, b.x1) + 14 * f, maxY: Math.min(rect.maxY, b.y1) + 14 * f }));
  const marks: Mark[] = [],
    i0 = Math.floor((rect.minX - 14 * f) / sp),
    i1 = Math.ceil((rect.maxX + 14 * f) / sp),
    j0 = Math.floor((rect.minY - 14 * f) / sp),
    j1 = Math.ceil((rect.maxY + 14 * f) / sp);
  // The same room as the 2D woods: farmsteads, roads and rivers stay clear of trunks.
  const room = roomOf(c);
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const hh = (salt: number): number => vhash(i, j, salt + f),
        x = (i + 0.1 + 0.8 * hh(1)) * sp,
        y = (j + 0.1 + 0.8 * hh(2)) * sp;
      if (!boxes.some(b => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY)) continue;
      if (clumpNoise(x, y, 26 * f, 5) <= 0.27 || !room.keeps(x, y, hh(5))) continue;
      const size01 = hh(3);
      marks.push({ x, y, r: (size01 > 0.94 ? 1.35 + (size01 - 0.94) * 4 : 0.72 + 0.55 * size01 * size01) * f, k: hh(4) });
    }
  marks.sort((a, b) => a.y - b.y || a.x - b.x);
  sx.setTransform(1, 0, 0, 1, 0, 0);
  sx.clearRect(0, 0, w, h);
  sx.setTransform(ctx.getTransform());
  canopy.draw(sx, marks, 'forest', ctx.getTransform().a, 1, m => coniferOf(c, m));
  // Seen whole from a distance the crowns are let down toward the dark olive of the 2D woods.
  sx.setTransform(1, 0, 0, 1, 0, 0);
  sx.globalCompositeOperation = 'source-atop';
  sx.globalAlpha = 0.28;
  sx.fillStyle = pal.treeInk;
  sx.fillRect(0, 0, w, h);
  sx.globalCompositeOperation = 'source-over';
  sx.globalAlpha = 1;
  // Masked by the wood (and its clearings), partly transparent: the shaded wash and the map's hill shading read through.
  const id = brushIdOf(tl);
  const wood = new P();
  for (const i of ids) {
    const path = cached(`brush-clip:${id}:${i}`, () => {
      const a = tl.areas[i],
        p = new P();
      addRing(p, orientPos(a.poly));
      for (const hole of a.holes ?? []) addRing(p, orientPos(hole).slice().reverse());
      return p;
    });
    if (path) wood.addPath(path);
  }
  ctx.save();
  const clip = forestClip(c, rect);
  if (clip) ctx.clip(clip, 'nonzero');
  ctx.clip(wood, 'nonzero');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.8;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(scratch as unknown as CanvasImageSource, 0, 0);
  ctx.restore();
  return ids.length;
}
