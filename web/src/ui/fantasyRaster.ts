/** Canvas painter of the Illustrated ground: the painted washes, then the depth-sorted stamps drawn as atlas cells.
 * The SVG never carries the stamps here (FantasyOptions.svgStamps false): one drawImage per visible stamp per frame
 * is far cheaper than tens of thousands of SVG uses, and it keeps the stamps sharp at any zoom. */
import { brushFrame, isLandformBrush, isReliefBrush, stampHeight, type BrushLibrary, type Stamp } from '../../../rust/bridge/fantasyPainting';
import { fantasyFieldColour, fantasyFieldWash, fantasyGroundWash, type FantasyTerrainPainting } from '../../../rust/bridge/fantasyTerrain';
import type { LandUseLayer } from '../gen/types';
import type { Rect4 } from '../render/view';
import type { ForestWaterRaster } from '../../../rust/bridge/terrainMaterialRaster';

/** One holding or strip, drawn as a vector at draw time so field edges and furrows stay crisp at any zoom. */
interface FieldShape { path: Path2D; fill: string; angle: number; orchard: boolean; box: [number, number, number, number] }
/** Single trees and ground plants of one square of land, planned on demand (FantasyTerrainPainting.fine). */
interface FineTile { stamps: Stamp[]; heights: Float32Array }
export interface FantasyRaster { painting: FantasyTerrainPainting; images: Map<string, CanvasImageSource>; wash: HTMLCanvasElement;
  /** The holdings alone, opaque, painted over the massifs and downs so fields cut them cleanly (far views; near views add the vector strips). */
  fieldCover?: HTMLCanvasElement; heights: Float32Array; up: number; down: number; half: number; fields: FieldShape[];
  tiles: Map<string, FineTile>; queue: Set<string>; /** Called when planned tiles arrive, so the view repaints. */ onTiles?: () => void }
const FINE_TILE = 400, FINE_MIN_PX = 4, MAX_TILES = 400;
/** Plan queued tiles one per task: navigation stays responsive and each arrival repaints. */
function planTiles(raster: FantasyRaster): void {
  const next = raster.queue.values().next(); if (next.done || !raster.painting.fine) return;
  const key = next.value; raster.queue.delete(key);
  const [i, j] = key.split(',').map(Number), x = i * FINE_TILE, y = j * FINE_TILE;
  const stamps = raster.painting.fine({ x, y, width: FINE_TILE, height: FINE_TILE }).filter(s => s.x >= x && s.x < x + FINE_TILE && s.y >= y && s.y < y + FINE_TILE);
  const heights = Float32Array.from(stamps, stamp => stampHeight(stamp, brushFrame(raster.painting.library, stamp)));
  if (raster.tiles.size >= MAX_TILES) raster.tiles.delete(raster.tiles.keys().next().value!);
  raster.tiles.set(key, { stamps, heights });
  raster.onTiles?.();
  if (raster.queue.size) setTimeout(() => planTiles(raster), 0);
}
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
      return { painting, images, wash, fieldCover, heights, up, down, half, fields: fieldShapes(painting, landuse), tiles: new Map(), queue: new Set() };
    });
    rasters.set(painting, pending); void pending.catch(() => rasters.delete(painting));
  }
  return pending;
}
/** Draw into a context already in world metres. `pixelsPerMetre` drops sub-pixel ground stamps, never relief. */
export function drawFantasyRaster(ctx: CanvasRenderingContext2D, raster: FantasyRaster, rect: Rect4, pixelsPerMetre: number, keep: (stamp: Stamp) => boolean = () => true, wash = true, fineTiles = true): void {
  const { painting, images, heights } = raster, stamps = painting.stamps, frame = painting.frame;
  ctx.save(); ctx.imageSmoothingQuality = 'high';
  // Stamps never overhang the map frame.
  if (frame) { ctx.beginPath(); ctx.rect(frame.x, frame.y, frame.width, frame.width); ctx.clip(); }
  if (wash && frame) { ctx.drawImage(raster.wash, frame.x, frame.y, frame.width, frame.width); drawFields(ctx, raster.fields, rect, pixelsPerMetre); }
  let low = 0, high = stamps.length;
  while (low < high) { const mid = (low + high) >>> 1; if (stamps[mid].y < rect.minY - raster.down) low = mid + 1; else high = mid; }
  const minWidth = .9 / pixelsPerMetre, visible: { s: Stamp; h: number }[] = [];
  for (let i = low; i < stamps.length && stamps[i].y <= rect.maxY + raster.up; i++) {
    const s = stamps[i];
    if (s.x + raster.half < rect.minX || s.x - raster.half > rect.maxX || !keep(s)) continue;
    if (s.width < minWidth && !isReliefBrush(s.brush)) continue;
    visible.push({ s, h: heights[i] });
  }
  // Single crowns and plants once they are a few pixels wide; below that the clumps and the wash carry the tone.
  const tree = painting.treeWidth ?? 0;
  if (fineTiles && painting.fine && tree * pixelsPerMetre >= FINE_MIN_PX) {
    const pad = tree * 3, i0 = Math.floor((rect.minX - pad) / FINE_TILE), i1 = Math.floor((rect.maxX + pad) / FINE_TILE);
    const j0 = Math.floor((rect.minY - pad) / FINE_TILE), j1 = Math.floor((rect.maxY + pad * 2) / FINE_TILE);
    let queued = false;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = `${i},${j}`, tile = raster.tiles.get(key);
      if (!tile) { if (!raster.queue.has(key)) { raster.queue.add(key); queued = true; } continue; }
      tile.stamps.forEach((s, k) => { if (s.width >= minWidth && keep(s) && s.x + s.width / 2 >= rect.minX && s.x - s.width / 2 <= rect.maxX && s.y + tile.heights[k] * .05 >= rect.minY && s.y - tile.heights[k] * .95 <= rect.maxY) visible.push({ s, h: tile.heights[k] }); });
    }
    if (queued && raster.queue.size) setTimeout(() => planTiles(raster), 0);
    visible.sort((a, b) => a.s.y - b.s.y || a.s.x - b.s.x);
  }
  const draw = (list: readonly { s: Stamp; h: number }[]) => {
    for (const { s, h } of list) {
      const frameOf = brushFrame(painting.library, s), image = images.get(frameOf.family); if (!image) continue;
      const [sx, sy, sw, sh] = frameOf.rect, w = s.width;
      ctx.globalAlpha = s.opacity;
      if (s.flip) { ctx.save(); ctx.translate(s.x, s.y); ctx.scale(-1, 1); ctx.drawImage(image, sx, sy, sw, sh, -w / 2, -h * .95, w, h); ctx.restore(); }
      else ctx.drawImage(image, sx, sy, sw, sh, s.x - w / 2, s.y - h * .95, w, h);
    }
  };
  // Layers: massifs and downs, then the holdings painted over them (a field cuts the landform with its own clean edge,
  // never a whole mountain dropped), then the vegetation, trees standing on the painted slopes.
  const landforms = visible.filter(v => isLandformBrush(v.s.brush));
  draw(landforms);
  if (landforms.length && frame) {
    ctx.globalAlpha = 1;
    if (raster.fieldCover) ctx.drawImage(raster.fieldCover, frame.x, frame.y, frame.width, frame.width);
    drawFields(ctx, raster.fields, rect, pixelsPerMetre, true);
  }
  draw(landforms.length ? visible.filter(v => !isLandformBrush(v.s.brush)) : visible);
  ctx.restore();
}
/** The 3D ground, draped like 2D: the wash (under the water) and all the stamps (over it). PNG data URLs. */
export function fantasyRasterImages(raster: FantasyRaster, size = 2048): { wash: string; stamps: string } {
  const frame = raster.painting.frame!, rect = { minX: frame.x, minY: frame.y, maxX: frame.x + frame.width, maxY: frame.y + frame.width };
  const draw = (wash: boolean, keep: (stamp: Stamp) => boolean) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!; ctx.scale(size / frame.width, size / frame.width); ctx.translate(-frame.x, -frame.y);
    drawFantasyRaster(ctx, raster, rect, size / frame.width, keep, wash, false); return canvas.toDataURL('image/png');
  };
  return { wash: draw(true, () => false), stamps: draw(false, () => true) };
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
