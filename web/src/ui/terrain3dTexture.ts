import type { TerrainData, TerrainSettings } from '../../../rust/bridge/terrain';
import { isFantasyStyle, prepareFantasyTerrain, type FantasyOptions, type FantasyTerrainPainting } from '../../../rust/bridge/fantasyTerrain';
import { brushFrame, paintingCanvas, stampHeight, type BrushLibrary, type Stamp } from '../../../rust/bridge/fantasyPainting';
import type { TerrainStyle } from '../render/terrainStyle';
import type { UrbanPaintingContext } from '../../../rust/bridge/urbanPaintingMask';

const decodedLibraries = new WeakMap<BrushLibrary, Promise<Map<string, HTMLImageElement>>>();
interface PaintBounds { bounds: Float64Array; up: number; down: number }
const paintingBounds = new WeakMap<FantasyTerrainPainting, PaintBounds>();

function visibleStamps(painting: FantasyTerrainPainting, region: { x: number; y: number; width: number }, pixels: number): Stamp[] {
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
    const at = i * 4, bounds = cached.bounds;
    if (bounds[at] <= right && bounds[at + 2] >= left && bounds[at + 1] <= bottom && bounds[at + 3] >= top) visible.push(stamps[i]);
  }
  return visible;
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
    const painting = prepareFantasyTerrain(terrain, style, settings, options, urban);
    if (painting?.stamps.length) {
      const stamps = visibleStamps(painting, region, base.width);
      if (!stamps.length) return base;
      const images = await decodeLibrary(painting.library);
      paintingCanvas(context, stamps, images, painting.library, { x: region.x, y: region.y, scale: base.width / region.width });
    }
  }
  return base;
}
