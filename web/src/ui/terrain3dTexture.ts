import { terrain3dRaisedTexture, terrain3dSetRaisedTexture } from './terrain3dBillboards';
import type { TerrainData, TerrainSettings } from '../../../rust/bridge/terrain';
import { isFantasyStyle, prepareFantasyTerrain, fantasyLod, type FantasyOptions, type FantasyTerrainPainting } from '../../../rust/bridge/fantasyTerrain';
import { brushFrame, paintingCanvas, stampHeight, type BrushLibrary, type Stamp } from '../../../rust/bridge/fantasyPainting';
import type { TerrainStyle } from '../render/terrainStyle';
import type { UrbanPaintingContext } from '../../../rust/bridge/urbanPaintingMask';
import type { Terrain3dBillboards } from './terrain3dBillboards';

const decodedLibraries = new WeakMap<BrushLibrary, Promise<Map<string, HTMLImageElement>>>();
interface PaintBounds { bounds: Float64Array; up: number; down: number }
const paintingBounds = new WeakMap<FantasyTerrainPainting, PaintBounds>();
const raisedPaintings = new WeakMap<FantasyTerrainPainting, Promise<Terrain3dBillboards | undefined>>();
const reliefAtlases = new WeakMap<BrushLibrary, Promise<{ canvas: HTMLCanvasElement; rects: Map<string, [number, number, number, number]> }>>();
export interface Terrain3dIllustration { texture: HTMLCanvasElement; billboards?: Terrain3dBillboards }
export { terrain3dRaisedTexture, terrain3dSetRaisedTexture };
/** Keep annotations identical in the two immutable material variants. */
export function terrain3dTextureOverlay(base: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D) => void): void {
  draw(base.getContext('2d')!); const draped = terrain3dRaisedTexture(base); if (draped) draw(draped.getContext('2d')!);
}
/** Illustrated relief is draped on the ground like the 2D painting: no stamp stands up as a billboard. */
const isRaised = (_stamp: Pick<Stamp, 'brush' | 'width'>, _painting: Pick<FantasyTerrainPainting, 'width' | 'lod'>): boolean => false;
const paintingOptions = (options: FantasyOptions, width: number): FantasyOptions => ({ ...options, lod: options.lod && options.lod !== 'auto' ? options.lod : fantasyLod(width) });

function visibleStamps(painting: FantasyTerrainPainting, region: { x: number; y: number; width: number }, pixels: number, skipRaised = false): Stamp[] {
  let cached = paintingBounds.get(painting);
  if (!cached) {
    cached = { bounds: new Float64Array(painting.stamps.length * 4), up: 0, down: 0 };
    painting.stamps.forEach((stamp, i) => {
      const height = stampHeight(stamp, brushFrame(painting.library, stamp)), up = height * .95, down = height * .05;
      cached!.bounds.set([stamp.x - stamp.width / 2, stamp.y - up, stamp.x + stamp.width / 2, stamp.y + down], i * 4);
      cached!.up = Math.max(cached!.up, up); cached!.down = Math.max(cached!.down, down);
    });
    paintingBounds.set(painting, cached);
  }
  // Include one texel of filtering support. Bounds use actual brush-frame height,
  // so tall trees and oversized summit icons anchored outside the tile survive.
  const pad = region.width / Math.max(1, pixels), left = region.x - pad, top = region.y - pad;
  const right = region.x + region.width + pad, bottom = region.y + region.width + pad;
  const stamps = painting.stamps;
  let low = 0, high = stamps.length;
  while (low < high) { const mid = (low + high) >>> 1; if (stamps[mid].y < top - cached.down) low = mid + 1; else high = mid; }
  const visible: Stamp[] = [];
  for (let i = low; i < stamps.length && stamps[i].y <= bottom + cached.up; i++) {
    if (skipRaised && isRaised(stamps[i], painting)) continue;
    const at = i * 4, bounds = cached.bounds;
    if (bounds[at] <= right && bounds[at + 2] >= left && bounds[at + 1] <= bottom && bounds[at + 3] >= top) visible.push(stamps[i]);
  }
  return visible;
}

/** Only the three relief families enter this atlas; both Illustrated looks keep their original colours. */
function reliefAtlas(library: BrushLibrary): Promise<{ canvas: HTMLCanvasElement; rects: Map<string, [number, number, number, number]> }> {
  let pending = reliefAtlases.get(library);
  if (!pending) {
    pending = decodeLibrary(library).then(images => {
      const frames = [...new Map(library.frames.filter(frame => ['hills', 'foothills', 'mountains', 'snow-mountains', 'peaks'].includes(frame.family)).map(frame => [frame.token, frame])).values()];
      const cell = 256, pad = 16, columns = Math.min(8, frames.length), canvas = document.createElement('canvas');
      canvas.width = columns * cell; canvas.height = Math.ceil(frames.length / columns) * cell;
      const ctx = canvas.getContext('2d')!, rects = new Map<string, [number, number, number, number]>(); ctx.imageSmoothingQuality = 'high';
      frames.forEach((frame, i) => {
        const x = i % columns * cell + pad, y = Math.floor(i / columns) * cell + pad, size = cell - 2 * pad;
        ctx.drawImage(images.get(frame.family)!, ...frame.rect, x, y, size, size);
        rects.set(frame.token, [x / canvas.width, y / canvas.height, size / canvas.width, size / canvas.height]);
      });
      return { canvas, rects };
    });
    reliefAtlases.set(library, pending); void pending.catch(() => reliefAtlases.delete(library));
  }
  return pending;
}

/** Stable whole-map stamps: the camera never replans peaks or uploads their instances. */
export function terrain3dBillboards(terrain: TerrainData, style: TerrainStyle, settings: TerrainSettings, options: FantasyOptions, enabled: boolean, urban?: UrbanPaintingContext): Promise<Terrain3dBillboards | undefined> {
  const painting = enabled && isFantasyStyle(style) ? prepareFantasyTerrain(terrain, style, settings, paintingOptions(options, settings.width), urban) : undefined;
  if (!painting) return Promise.resolve(undefined);
  let pending = raisedPaintings.get(painting);
  if (!pending) {
    const stamps = painting.stamps.filter(stamp => isRaised(stamp, painting));
    pending = stamps.length ? reliefAtlas(painting.library).then(({ canvas, rects }) => ({ atlas: canvas, stamps: stamps.map(stamp => {
      const frame = brushFrame(painting.library, stamp);
      return { x: stamp.x, y: stamp.y, width: stamp.width, height: stampHeight(stamp, frame), rect: rects.get(frame.token)!, flip: stamp.flip, opacity: stamp.opacity };
    }) })) : Promise.resolve(undefined);
    raisedPaintings.set(painting, pending); void pending.catch(() => raisedPaintings.delete(painting));
  }
  return pending;
}

/** V2 already retains the exact SVG background. Remove only the lifted uses, preserving water and grading. */
export async function terrain3dIllustratedSvg(url: string, terrain: TerrainData, style: TerrainStyle, settings: TerrainSettings, options: FantasyOptions): Promise<Terrain3dIllustration> {
  const comma = url.indexOf(','), head = url.slice(0, comma), svg = head.includes(';base64') ? atob(url.slice(comma + 1)) : decodeURIComponent(url.slice(comma + 1));
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid Illustrated background SVG.');
  const painting = isFantasyStyle(style) ? prepareFantasyTerrain(terrain, style, settings, paintingOptions(options, settings.width)) : undefined;
  if (painting) for (const use of Array.from(doc.querySelectorAll('.fantasy-brushes > use[data-brush]'))) {
    const family = use.getAttribute('data-brush'), brush = family === 'mountains' ? 5 : family === 'snow-mountains' ? 6 : family === 'peaks' ? 16 : family === 'hills' ? 4 : family === 'foothills' ? 18 : -1;
    if (isRaised({ brush, width: Number(use.getAttribute('width')) }, painting)) use.remove();
  }
  const cleanUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const clean = new Image(), draped = new Image(); clean.src = cleanUrl; draped.src = url;
    const [, , billboards] = await Promise.all([clean.decode(), draped.decode(), terrain3dBillboards(terrain, style, settings, options, true)]);
    const texture = document.createElement('canvas'), full = document.createElement('canvas'); texture.width = texture.height = full.width = full.height = 2048;
    texture.getContext('2d')!.drawImage(clean, 0, 0, texture.width, texture.height); full.getContext('2d')!.drawImage(draped, 0, 0, full.width, full.height);
    if (billboards?.stamps.length) terrain3dSetRaisedTexture(texture, full);
    return { texture, billboards };
  } finally { URL.revokeObjectURL(cleanUrl); }
}

function decodeLibrary(library: BrushLibrary): Promise<Map<string, HTMLImageElement>> {
  let decoded = decodedLibraries.get(library);
  if (!decoded) {
    decoded = Promise.all(Object.entries(library.families).map(async ([family, atlas]) => {
      const image = new Image(); image.src = atlas.url; await image.decode();
      return [family, image] as const;
    })).then(entries => new Map(entries));
    decodedLibraries.set(library, decoded);
    void decoded.catch(() => decodedLibraries.delete(library));
  }
  return decoded;
}

/** Complete the whole-map material with the same water and brush layers as 2D. */
export async function terrain3dTexture(base: HTMLCanvasElement, terrain: TerrainData, style: TerrainStyle, settings: TerrainSettings, options: FantasyOptions, drawBrushes: boolean, overlaySvg: string, region = { x: 0, y: 0, width: terrain.width }, urban?: UrbanPaintingContext, ground?: (ctx: CanvasRenderingContext2D) => void): Promise<HTMLCanvasElement> {
  const context = base.getContext('2d');
  if (!context) throw new Error('Impossible de préparer le style 3D.');
  context.imageSmoothingQuality = 'high';
  if (overlaySvg.trim()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${base.width}" height="${base.height}" viewBox="${region.x} ${region.y} ${region.width} ${region.width}">${overlaySvg}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image(); image.src = url; await image.decode();
      context.drawImage(image, 0, 0, base.width, base.height);
    } finally { URL.revokeObjectURL(url); }
  }
  // Ground painted per tile (the city plan), above the overlay and under the brushes.
  ground?.(context);
  if (drawBrushes && isFantasyStyle(style)) {
    const painting = prepareFantasyTerrain(terrain, style, settings, paintingOptions(options, settings.width), urban);
    if (painting?.stamps.length) {
      const all = visibleStamps(painting, region, base.width);
      const stamps = visibleStamps(painting, region, base.width, true);
      if (!all.length) return base;
      const images = await decodeLibrary(painting.library);
      if (all.length !== stamps.length) {
        const draped = document.createElement('canvas'); draped.width = base.width; draped.height = base.height;
        const ctx = draped.getContext('2d')!; ctx.drawImage(base, 0, 0);
        paintingCanvas(ctx, all, images, painting.library, { x: region.x, y: region.y, scale: base.width / region.width });
        terrain3dSetRaisedTexture(base, draped);
      }
      paintingCanvas(context, stamps, images, painting.library, { x: region.x, y: region.y, scale: base.width / region.width });
    }
  }
  return base;
}
