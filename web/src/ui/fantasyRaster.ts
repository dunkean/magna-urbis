/** Canvas painter of the Illustrated ground: painted washes, then depth-sorted atlas stamps.
 * Live views reuse progressively filled tiles; exact captures draw the stamps directly. */
import { brushFrame, isLandformBrush, isReliefBrush, stampHeight, type BrushLibrary, type Stamp } from '../../../rust/bridge/fantasyPainting';
import { fantasyFieldColour, fantasyFieldWash, fantasyGroundWash, type FantasyTerrainPainting } from '../../../rust/bridge/fantasyTerrain';
import type { LandUseLayer } from '../gen/types';
import type { Rect4 } from '../render/view';
import type { ForestWaterRaster } from '../../../rust/bridge/terrainMaterialRaster';
import { TileIndex } from '../render/tileindex';
import { LiveTileFill } from '../render/liveTileFill';

/** One holding or strip, drawn as a vector at draw time so field edges and furrows stay crisp at any zoom. */
interface FieldShape { path: Path2D; fill: string; angle: number; orchard: boolean; box: [number, number, number, number] }
/** Single trees and ground plants of one square of land, planned on demand (FantasyTerrainPainting.fine). */
interface FineTile { stamps: Stamp[]; heights: Float32Array }
export interface FantasyRaster { painting: FantasyTerrainPainting; images: Map<string, CanvasImageSource>; wash: HTMLCanvasElement;
  /** The holdings alone, opaque, painted over the massifs and downs so fields cut them cleanly (far views; near views add the vector strips). */
  fieldCover?: HTMLCanvasElement; heights: Float32Array; up: number; down: number; half: number; fields: FieldShape[];
  tiles: Map<string, FineTile>; /** Called when live raster tiles arrive, so the view repaints. */ onTiles?: () => void }
const FINE_TILE = 400, FINE_MIN_PX = 4, MAX_TILES = 400;
/** Planning is synchronous for captures; live callers yield between fine tiles in their cancellable fill. */
function planFineTile(raster: FantasyRaster, i: number, j: number): FineTile {
  const key = `${i},${j}`, x = i * FINE_TILE, y = j * FINE_TILE;
  const stamps = raster.painting.fine!({ x, y, width: FINE_TILE, height: FINE_TILE }).filter(s => s.x >= x && s.x < x + FINE_TILE && s.y >= y && s.y < y + FINE_TILE);
  const heights = Float32Array.from(stamps, stamp => stampHeight(stamp, brushFrame(raster.painting.library, stamp)));
  if (raster.tiles.size >= MAX_TILES) raster.tiles.delete(raster.tiles.keys().next().value!);
  const tile = { stamps, heights }; raster.tiles.set(key, tile); return tile;
}
function fineTileRange(raster: FantasyRaster, rect: Rect4): [number, number, number, number] {
  const pad = (raster.painting.treeWidth ?? 0) * 3;
  return [Math.floor((rect.minX - pad) / FINE_TILE), Math.floor((rect.maxX + pad) / FINE_TILE),
    Math.floor((rect.minY - pad) / FINE_TILE), Math.floor((rect.maxY + pad * 2) / FINE_TILE)];
}
const stampIndexes = new WeakMap<FantasyRaster, TileIndex>();
type Ring = readonly { x: number; y: number }[];
function fieldShapes(painting: FantasyTerrainPainting, landuse: LandUseLayer | undefined): FieldShape[] {
  const detail = painting.ground?.occupation?.detail, ink = painting.library.style === 'fantasy-ink', out: FieldShape[] = [];
  if (!landuse) return out;
  const toneAt = (ring: Ring): number => {
    let x = 0, y = 0; for (const p of ring) { x += p.x; y += p.y; } x /= ring.length; y /= ring.length;
    if (!detail) return .4;
    const i = Math.floor((x - detail.x) / detail.width * detail.n), j = Math.floor((y - detail.y) / detail.width * detail.n);
    return i >= 0 && j >= 0 && i < detail.n && j < detail.n ? detail.rgba[(j * detail.n + i) * 4] / 255 : .4;
  };
  const longest = (ring: Ring): number => {
    let best = 0, angle = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b.x - a.x, b.y - a.y); if (l > best) { best = l; angle = Math.atan2(b.y - a.y, b.x - a.x); } }
    return angle;
  };
  const add = (rings: Ring[], angle: number, kind: 'field' | 'garden' | 'orchard') => {
    const orchard = kind === 'orchard';
    const outer = rings[0]; if (!outer || outer.length < 3) return;
    const path = new Path2D(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of rings) { ring.forEach((p, i) => { if (i) path.lineTo(p.x, p.y); else path.moveTo(p.x, p.y); }); path.closePath(); }
    for (const p of outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    let [r, g, b] = fantasyFieldColour(toneAt(outer), kind);
    if (ink) { const grey = 255 - (255 - (.3 * r + .59 * g + .11 * b)) * .55; r = g = b = grey; }
    out.push({ path, fill: `rgb(${r | 0},${g | 0},${b | 0})`, angle, orchard, box: [x0, y0, x1, y1] });
  };
  for (const area of landuse.areas) {
    if (area.kind !== 'field' && area.kind !== 'garden' && area.kind !== 'orchard') continue;
    const angle = area.stripAngle ?? longest(area.poly);
    add([area.poly, ...area.holes ?? []], angle, area.kind);
    for (const strip of area.strips ?? []) add([strip], angle, area.kind);
  }
  return out;
}
/** Crisp holdings: flat crop colour, furrows along the strip direction and a darker balk, at screen resolution. */
function drawFields(ctx: CanvasRenderingContext2D, fields: readonly FieldShape[], rect: Rect4, pixelsPerMetre: number, opaque = false): void {
  if (pixelsPerMetre < .35) return;
  const furrows = pixelsPerMetre > .6, spacing = 7;
  ctx.lineCap = 'butt';
  for (const f of fields) {
    const [x0, y0, x1, y1] = f.box;
    if (x1 < rect.minX || x0 > rect.maxX || y1 < rect.minY || y0 > rect.maxY) continue;
    ctx.globalAlpha = opaque ? 1 : .94; ctx.fillStyle = f.fill; ctx.fill(f.path, 'evenodd');
    if (furrows && !f.orchard) {
      ctx.save(); ctx.clip(f.path, 'evenodd');
      const c = Math.cos(f.angle), s = Math.sin(f.angle), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.hypot(x1 - x0, y1 - y0) / 2;
      ctx.beginPath();
      for (let d = -r; d <= r; d += spacing) { const px = cx - s * d, py = cy + c * d; ctx.moveTo(px - c * r, py - s * r); ctx.lineTo(px + c * r, py + s * r); }
      ctx.globalAlpha = .1; ctx.strokeStyle = '#4a3214'; ctx.lineWidth = 2.2; ctx.stroke(); ctx.restore();
    }
    ctx.globalAlpha = .32; ctx.strokeStyle = '#6b5530'; ctx.lineWidth = Math.max(1.1, .9 / pixelsPerMetre); ctx.stroke(f.path);
  }
  ctx.globalAlpha = 1;
}
const decoded = new WeakMap<BrushLibrary, Promise<Map<string, CanvasImageSource>>>();
const rasters = new WeakMap<FantasyTerrainPainting, Promise<FantasyRaster>>();
function decodeLibrary(library: BrushLibrary): Promise<Map<string, CanvasImageSource>> {
  let pending = decoded.get(library);
  if (!pending) {
    pending = Promise.all(Object.entries(library.families).map(async ([family, atlas]) => {
      const image = new Image(); image.src = atlas.url; await image.decode(); return [family, image as CanvasImageSource] as const;
    })).then(entries => new Map(entries));
    decoded.set(library, pending); void pending.catch(() => decoded.delete(library));
  }
  return pending;
}
const canvasOf = (pixels: Uint8ClampedArray<ArrayBuffer>, n: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = n;
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, n, n), 0, 0); return canvas;
};
/** Ground wash at 1024 under field strips at 2048, on one 2048 canvas covering the terrain square; plus the strips alone, opaque. */
function washCanvas(painting: FantasyTerrainPainting): { wash: HTMLCanvasElement; fieldCover?: HTMLCanvasElement } {
  const ink = painting.library.style === 'fantasy-ink', out = document.createElement('canvas'); out.width = out.height = 2048;
  const ctx = out.getContext('2d')!; ctx.imageSmoothingQuality = 'high';
  if (!painting.sample || !painting.frame) return { wash: out };
  ctx.drawImage(canvasOf(fantasyGroundWash(painting, 1024, ink), 1024), 0, 0, 2048, 2048);
  const fields = fantasyFieldWash(painting, 2048, ink); if (!fields) return { wash: out };
  const fieldCover = canvasOf(fields, 2048);
  ctx.drawImage(fieldCover, 0, 0);
  for (let i = 3; i < fields.length; i += 4) if (fields[i]) fields[i] = 255;
  return { wash: out, fieldCover: canvasOf(fields, 2048) };
}
export function prepareFantasyRaster(painting: FantasyTerrainPainting, landuse?: LandUseLayer): Promise<FantasyRaster> {
  let pending = rasters.get(painting);
  if (!pending) {
    pending = decodeLibrary(painting.library).then(images => {
      const heights = new Float32Array(painting.stamps.length); let up = 0, down = 0, half = 0;
      painting.stamps.forEach((stamp, i) => {
        const h = heights[i] = stampHeight(stamp, brushFrame(painting.library, stamp));
        up = Math.max(up, h * .95); down = Math.max(down, h * .05); half = Math.max(half, stamp.width / 2);
      });
      const { wash, fieldCover } = washCanvas(painting);
      const raster: FantasyRaster = { painting, images, wash, fieldCover, heights, up, down, half, fields: fieldShapes(painting, landuse), tiles: new Map() };
      const frame = painting.frame;
      if (frame) {
        const boxes = new Float32Array(painting.stamps.length * 4);
        painting.stamps.forEach((s, i) => boxes.set([s.x - s.width / 2 - frame.x, s.y - heights[i] * .95 - frame.y,
          s.x + s.width / 2 - frame.x, s.y + heights[i] * .05 - frame.y], i * 4));
        stampIndexes.set(raster, new TileIndex(frame.width, Math.max(FINE_TILE, frame.width / 128), boxes));
      }
      return raster;
    });
    rasters.set(painting, pending); void pending.catch(() => rasters.delete(painting));
  }
  return pending;
}
type Visible = { s: Stamp; h: number };
const KEEP_ALL = (): boolean => true;
/** Wash/fields only: do not query stamps or plan fine vegetation. */
export const KEEP_NONE = (): boolean => false;
/** Stamps of one rectangle in draw order (ground stamps, then planned single trees when `fine`). */
function collectVisible(raster: FantasyRaster, rect: Rect4, pixelsPerMetre: number, keep: (stamp: Stamp) => boolean, fine: boolean): { visible: Visible[] } {
  const { painting, heights } = raster, stamps = painting.stamps;
  const minWidth = .9 / pixelsPerMetre, visible: Visible[] = [];
  const index = stampIndexes.get(raster), frame = painting.frame;
  let ids: number[];
  if (index && frame) {
    // Float32 bounds in the index are conservative after a small rounding pad; the order is the original depth order.
    const pad = Math.max(1, frame.width) * 1e-6;
    ids = index.query({ minX: rect.minX - frame.x - pad, minY: rect.minY - frame.y - pad,
      maxX: rect.maxX - frame.x + pad, maxY: rect.maxY - frame.y + pad });
  } else {
    let low = 0, high = stamps.length;
    while (low < high) { const mid = (low + high) >>> 1; if (stamps[mid].y < rect.minY - raster.down) low = mid + 1; else high = mid; }
    ids = [];
    for (let i = low; i < stamps.length && stamps[i].y <= rect.maxY + raster.up; i++) ids.push(i);
  }
  for (const i of ids) {
    const s = stamps[i];
    if (s.x + raster.half < rect.minX || s.x - raster.half > rect.maxX || !keep(s)) continue;
    if (s.width < minWidth && !isReliefBrush(s.brush)) continue;
    visible.push({ s, h: heights[i] });
  }
  // Single crowns and plants once they are a few pixels wide; below that the clumps and the wash carry the tone.
  if (fine) {
    const [i0, i1, j0, j1] = fineTileRange(raster, rect);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = `${i},${j}`, tile = raster.tiles.get(key) ?? planFineTile(raster, i, j);
      tile.stamps.forEach((s, k) => { if (s.width >= minWidth && keep(s) && s.x + s.width / 2 >= rect.minX && s.x - s.width / 2 <= rect.maxX && s.y + tile.heights[k] * .05 >= rect.minY && s.y - tile.heights[k] * .95 <= rect.maxY) visible.push({ s, h: tile.heights[k] }); });
    }
    visible.sort((a, b) => a.s.y - b.s.y || a.s.x - b.s.x);
  }
  return { visible };
}
function drawStampList(ctx: CanvasRenderingContext2D, raster: FantasyRaster, list: readonly Visible[]): void {
  const { painting, images } = raster;
  for (const { s, h } of list) {
    const frameOf = brushFrame(painting.library, s), image = images.get(frameOf.family); if (!image) continue;
    const [sx, sy, sw, sh] = frameOf.rect, w = s.width;
    ctx.globalAlpha = s.opacity;
    if (s.flip) { ctx.save(); ctx.translate(s.x, s.y); ctx.scale(-1, 1); ctx.drawImage(image, sx, sy, sw, sh, -w / 2, -h * .95, w, h); ctx.restore(); }
    else ctx.drawImage(image, sx, sy, sw, sh, s.x - w / 2, s.y - h * .95, w, h);
  }
}

/** Live stamps are filled centre first in cancellable slices. Parent tiles carry the previous detail meanwhile.
 * Both parts share one cache entry, preserving landforms / field cover / vegetation ordering. */
const STAMP_TILE_PX = 512, STAMP_LIVE_TILE_PX = 256, STAMP_TILE_GUTTER = 2, STAMP_TILE_MAX_DENSITY = 32, STAMP_TILE_BYTES = 128 * 1024 * 1024;
type StampTile = CanvasImageSource | null;
type StampTilePair = { images: [StampTile, StampTile]; x: number; y: number; density: number };
type StampTileCache = { entries: Map<string, StampTilePair>; bytes: number; failed: boolean; fill: LiveTileFill };
const stampTiles = new WeakMap<FantasyRaster, StampTileCache>();
const releaseTile = (image: StampTile): void => {
  if (!image) return;
  if ('close' in image && typeof image.close === 'function') image.close();
  else if ('width' in image && 'height' in image && (image instanceof HTMLCanvasElement || typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas)) { image.width = 0; image.height = 0; }
};
/** Navigation/capture/style changes discard all queued work, including fine vegetation planning. */
export function suspendFantasyRaster(raster: FantasyRaster): void { stampTiles.get(raster)?.fill.suspend(); }

function drawStampTiles(ctx: CanvasRenderingContext2D, raster: FantasyRaster, rect: Rect4, fine: boolean, live: boolean): boolean {
  let cache = stampTiles.get(raster);
  if (!cache) { cache = { entries: new Map(), bytes: 0, failed: false, fill: new LiveTileFill() }; stampTiles.set(raster, cache); }
  if (cache.failed) return false;
  const t = ctx.getTransform();
  if (t.b || t.c || !(t.a > 0) || Math.abs(t.d - t.a) > t.a * 1e-6) return false;
  const density = 2 ** Math.ceil(Math.log2(t.a));
  if (density > STAMP_TILE_MAX_DENSITY) return false;
  const tilePx = live ? STAMP_LIVE_TILE_PX : STAMP_TILE_PX;
  const span = tilePx / density, g = STAMP_TILE_GUTTER, side = tilePx + 2 * g, tileBytes = side * side * 4, frame = raster.painting.frame;
  const x0 = Math.floor(rect.minX / span), x1 = Math.floor(rect.maxX / span), y0 = Math.floor(rect.minY / span), y1 = Math.floor(rect.maxY / span);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) * 2 * tileBytes > STAMP_TILE_BYTES * .75) return false;
  const store = cache;
  const keyOf = (x: number, y: number, d = density, f = fine): string => `${tilePx}|${f}|${d}|${x},${y}`;
  const get = (key: string): StampTilePair | undefined => {
    const hit = store.entries.get(key);
    if (hit) { store.entries.delete(key); store.entries.set(key, hit); }
    return hit;
  };
  const fail = (): void => {
    store.failed = true;
    for (const tile of store.entries.values()) tile.images.forEach(releaseTile);
    store.entries.clear(); store.bytes = 0;
  };
  function* build(x: number, y: number): Generator<boolean, void> {
    const area = { minX: x * span - g / density, minY: y * span - g / density, maxX: (x + 1) * span + g / density, maxY: (y + 1) * span + g / density };
    const pair: StampTilePair = { images: [null, null], x, y, density };
    let target: OffscreenCanvas | HTMLCanvasElement | undefined, stored = false;
    try {
      if (!frame || !(area.maxX < frame.x || area.minX > frame.x + frame.width || area.maxY < frame.y || area.minY > frame.y + frame.width)) {
        if (fine) {
          const [i0, i1, j0, j1] = fineTileRange(raster, area);
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!raster.tiles.has(`${i},${j}`)) {
            planFineTile(raster, i, j); yield false;
          }
        }
        const visible = collectVisible(raster, area, density, KEEP_ALL, fine).visible;
        const lists = [visible.filter(v => isLandformBrush(v.s.brush)), visible.filter(v => !isLandformBrush(v.s.brush))];
        for (let part = 0; part < 2; part++) {
          const list = lists[part]; if (!list.length) continue;
          target = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(side, side) : Object.assign(document.createElement('canvas'), { width: side, height: side });
          const tx = target.getContext('2d') as CanvasRenderingContext2D | null;
          if (!tx) throw new Error('Illustration tile allocation failed');
          tx.imageSmoothingQuality = 'high';
          tx.setTransform(density, 0, 0, density, -area.minX * density, -area.minY * density);
          if (frame) { tx.beginPath(); tx.rect(frame.x, frame.y, frame.width, frame.width); tx.clip(); }
          for (let start = 0; start < list.length; start += 128) {
            drawStampList(tx, raster, list.slice(start, start + 128));
            yield false;
          }
          // Live canvases can be blitted directly: avoid forcing a bitmap transfer for every small tile.
          pair.images[part] = !live && 'transferToImageBitmap' in target ? target.transferToImageBitmap() : target;
          if (pair.images[part] !== target) { target.width = 0; target.height = 0; }
          target = undefined;
        }
      }
      store.entries.set(keyOf(x, y), pair);
      store.bytes += pair.images.filter(Boolean).length * tileBytes;
      stored = true;
      while ((store.bytes > STAMP_TILE_BYTES || store.entries.size > 4096) && store.entries.size > 1) {
        const [key, tile] = store.entries.entries().next().value!;
        store.entries.delete(key); store.bytes -= tile.images.filter(Boolean).length * tileBytes; tile.images.forEach(releaseTile);
      }
    } finally {
      if (target) { target.width = 0; target.height = 0; }
      if (!stored) pair.images.forEach(releaseTile);
    }
    yield true;
  }
  const requests: { x: number; y: number }[] = [], tiles: { tile: StampTilePair; x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let tile = get(keyOf(x, y));
    if (!tile && !live) {
      try { for (const _ of build(x, y)) { /* Exact callers finish synchronously. */ } }
      catch { fail(); return false; }
      tile = get(keyOf(x, y));
    }
    if (!tile && live) {
      requests.push({ x, y });
      // A coarse-mode parent is also useful while fine vegetation first arrives.
      for (let level = 1; level <= 24 && !tile; level++) {
        const divisor = 2 ** level, px = Math.floor(x / divisor), py = Math.floor(y / divisor), d = density / divisor;
        tile = get(keyOf(px, py, d)) ?? (fine ? get(keyOf(px, py, d, false)) : undefined);
      }
    }
    if (tile) tiles.push({ tile, x, y });
  }
  if (live && requests.length) {
    const jobKey = `${fine}|${density}|${x0},${y0},${x1},${y1}`;
    store.fill.start(jobKey, function* () {
      const cx = (rect.minX + rect.maxX) / (2 * span) - .5, cy = (rect.minY + rect.maxY) / (2 * span) - .5;
      requests.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - (b.x - cx) ** 2 - (b.y - cy) ** 2);
      for (const { x, y } of requests) if (!get(keyOf(x, y))) yield* build(x, y);
    }, () => raster.onTiles?.(), fail);
  } else store.fill.suspend();
  const blit = (part: number): void => {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    for (const { tile, x, y } of tiles) {
      const image = tile.images[part]; if (!image) continue;
      const sx = t.a * x * span + t.e, sy = t.d * y * span + t.f;
      const left = Math.round(sx), top = Math.round(sy), right = Math.round(sx + t.a * span), bottom = Math.round(sy + t.d * span);
      const sourceSpan = tilePx / tile.density, k = t.a / tile.density;
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
      ctx.drawImage(image, t.a * tile.x * sourceSpan + t.e - g * k, t.d * tile.y * sourceSpan + t.f - g * k, side * k, side * k); ctx.restore();
    }
    ctx.restore();
  };
  blit(0);
  if (frame && tiles.some(({ tile }) => tile.images[0]) && collectVisible(raster, rect, t.a, KEEP_ALL, false).visible.some(v => isLandformBrush(v.s.brush))) {
    ctx.globalAlpha = 1;
    if (raster.fieldCover) ctx.drawImage(raster.fieldCover, frame.x, frame.y, frame.width, frame.width);
    drawFields(ctx, raster.fields, rect, t.a, true);
  }
  blit(1);
  return true;
}

/** Draw into a context already in world metres. `pixelsPerMetre` drops sub-pixel ground stamps, never relief.
 * With the default `keep`, stamps come from per-density tile bitmaps when the transform allows it.
 * Only explicit `live` calls fill progressively; `tiled` false draws exact stamps synchronously for exports. */
export function drawFantasyRaster(ctx: CanvasRenderingContext2D, raster: FantasyRaster, rect: Rect4, pixelsPerMetre: number, keep: (stamp: Stamp) => boolean = KEEP_ALL, wash = true, fineTiles = true, tiled = true, live = false): void {
  const { painting } = raster, frame = painting.frame;
  ctx.save(); ctx.imageSmoothingQuality = 'high';
  // Stamps never overhang the map frame.
  if (frame) { ctx.beginPath(); ctx.rect(frame.x, frame.y, frame.width, frame.width); ctx.clip(); }
  if (wash && frame) { ctx.drawImage(raster.wash, frame.x, frame.y, frame.width, frame.width); drawFields(ctx, raster.fields, rect, pixelsPerMetre); }
  if (keep === KEEP_NONE) { ctx.restore(); return; }
  if (!live) suspendFantasyRaster(raster);
  const fine = !!(fineTiles && painting.fine && (painting.treeWidth ?? 0) * pixelsPerMetre >= FINE_MIN_PX);
  if (tiled && keep === KEEP_ALL && Math.abs(ctx.getTransform().a - pixelsPerMetre) <= pixelsPerMetre * 1e-6 && drawStampTiles(ctx, raster, rect, fine, live && !!raster.onTiles && typeof requestAnimationFrame === 'function')) { ctx.restore(); return; }
  suspendFantasyRaster(raster);
  const visible = collectVisible(raster, rect, pixelsPerMetre, keep, fine).visible;
  // Layers: massifs and downs, then the holdings painted over them (a field cuts the landform with its own clean edge,
  // never a whole mountain dropped), then the vegetation, trees standing on the painted slopes.
  const landforms = visible.filter(v => isLandformBrush(v.s.brush));
  drawStampList(ctx, raster, landforms);
  if (landforms.length && frame) {
    ctx.globalAlpha = 1;
    if (raster.fieldCover) ctx.drawImage(raster.fieldCover, frame.x, frame.y, frame.width, frame.width);
    drawFields(ctx, raster.fields, rect, pixelsPerMetre, true);
  }
  drawStampList(ctx, raster, landforms.length ? visible.filter(v => !isLandformBrush(v.s.brush)) : visible);
  ctx.restore();
}
/** The 3D ground, draped like 2D: the wash (under the water) and all the stamps (over it). PNG data URLs. */
export function fantasyRasterImages(raster: FantasyRaster, size = 2048): { wash: string; stamps: string } {
  const frame = raster.painting.frame!, rect = { minX: frame.x, minY: frame.y, maxX: frame.x + frame.width, maxY: frame.y + frame.width };
  const draw = (wash: boolean, keep: (stamp: Stamp) => boolean) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!; ctx.scale(size / frame.width, size / frame.width); ctx.translate(-frame.x, -frame.y);
    drawFantasyRaster(ctx, raster, rect, size / frame.width, keep, wash, false, false); return canvas.toDataURL('image/png');
  };
  return { wash: draw(true, KEEP_NONE), stamps: draw(false, KEEP_ALL) };
}

type Point = { x: number; y: number };
interface ClearanceInput {
  mapSize: number; seed: string;
  /** Drawn banks supplement centreline corridors, including cropped retained rivers. */
  water?: ForestWaterRaster;
  roads?: readonly { path: readonly Point[]; width: number }[];
  rivers?: readonly { path: readonly Point[]; width: readonly number[] }[];
  farmsteads?: readonly { yard: readonly Point[]; buildings: readonly (readonly Point[])[] }[];
  settlements?: readonly { center: Point; radius: number }[];
}
/** Stamp anchors stay out of road and river corridors and off farms and hamlets, as they do off towns. The corridor is
 * narrower than a crown, so trees may still overhang a road or hide part of a river; the line stays readable. */
const clearances = new WeakMap<object, { key: string; test(x: number, y: number): boolean }>();
export function fantasyClearance(input: ClearanceInput, owner: object = input): { key: string; test(x: number, y: number): boolean } {
  const cached = clearances.get(owner); if (cached) return cached;
  const n = 2048, cell = input.mapSize / n, canvas = document.createElement('canvas'); canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(1 / cell, 1 / cell); ctx.strokeStyle = ctx.fillStyle = '#000'; ctx.lineCap = ctx.lineJoin = 'round';
  const line = (path: readonly Point[], width: number) => {
    if (path.length < 2) return; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y); ctx.stroke();
  };
  const ring = (points: readonly Point[], pad: number) => {
    if (points.length < 3) return; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y); ctx.closePath(); ctx.fill(); ctx.lineWidth = 2 * pad; ctx.stroke();
  };
  for (const road of input.roads ?? []) line(road.path, road.width + 8);
  for (const river of input.rivers ?? []) line(river.path, Math.max(...river.width, 2) + 6);
  for (const farm of input.farmsteads ?? []) { ring(farm.yard, 6); for (const building of farm.buildings) ring(building, 5); }
  // The main settlement has its own reserve; the others (villages, hamlets) are cleared over their built radius.
  for (const settlement of (input.settlements ?? []).slice(1)) { ctx.beginPath(); ctx.arc(settlement.center.x, settlement.center.y, settlement.radius, 0, Math.PI * 2); ctx.fill(); }
  const alpha = ctx.getImageData(0, 0, n, n).data, mask = new Uint8Array(n * n);
  let hash = 0x811c9dc5;
  for (let i = 0; i < mask.length; i++) if (alpha[i * 4 + 3] > 96) { mask[i] = 1; hash = Math.imul(hash ^ i, 0x01000193); }
  const water = input.water;
  const result = { key: `clear:${input.seed}:${input.mapSize}:${(hash >>> 0).toString(36)}:${water?.key ?? ''}`, test: (x: number, y: number) => {
    if (water) {
      const wi = Math.floor((x - water.x) / water.width * water.n), wj = Math.floor((y - water.y) / water.width * water.n);
      if (wi >= 0 && wj >= 0 && wi < water.n && wj < water.n && water.alpha[wj * water.n + wi] > 96) return true;
    }
    const i = Math.floor(x / cell), j = Math.floor(y / cell);
    return i >= 0 && j >= 0 && i < n && j < n && mask[j * n + i] === 1;
  } };
  clearances.set(owner, result); return result;
}
