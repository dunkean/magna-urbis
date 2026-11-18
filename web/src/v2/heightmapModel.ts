import type { HeightmapFile } from '../ui/terrainHeightmap';
import { heightFromImage, type ImportedHeight } from '../gen/terrain/import';
import type { TerrainSketch } from '../../../rust/bridge/terrainSketch';
import type { V2Settings } from './contracts';

/** Provenance for the current import; recipes already retain the fitted metre raster. */
const imports = new WeakMap<TerrainSketch, HeightmapFile & { name: string }>();
export const heightmapImport = (sketch?: TerrainSketch) => sketch && imports.get(sketch);
export function rememberHeightmap(sketch: TerrainSketch, imported: HeightmapFile, name: string): void {
  imports.set(sketch, { ...imported, name });
}

export function imageHeightmap(image: ImportedHeight): HeightmapFile {
  const n = Math.min(image.w, image.h);
  const heights = image.elevations ? Array.from(image.elevations) : Array.from(heightFromImage(image.rgba, image.w, image.h, { mapSize: n, gridSize: n, minHeight: 0, maxHeight: 1200 }).data);
  return { terrain: { version: 1, resolution: n, heights, processing: 'surface' }, ...(!image.elevations ? { elevationRange: [0, 1200] as [number, number] } : {}) };
}

export function acceptHeightmap(settings: V2Settings, imported: HeightmapFile, name: string): void {
  settings.terrain ??= {};
  settings.terrain.sketch = imported.terrain;
  settings.terrain.heightmap = { name, width: imported.width, elevationRange: imported.elevationRange };
  delete settings.terrain.zones;
  delete settings.terrain.modification;
  delete settings.options.importedHeight;
  delete settings.options.heightScale;
  delete settings.options.importSea;
  delete settings.decor;
  if (imported.width !== undefined) settings.extent = imported.width;
  delete settings.terrain.sampleSpacing;
  rememberHeightmap(imported.terrain, imported, name);
}

/** Imported pixels are fixed: only their physical footprint is editable. */
export function heightmapPixels(settings: V2Settings): number | undefined {
  if (settings.terrain?.zones) return undefined;
  return settings.terrain?.sketch?.processing ? settings.terrain.sketch.resolution : settings.options.importedHeight ? Math.min(settings.options.importedHeight.w, settings.options.importedHeight.h) : undefined;
}
export function setHeightmapDefinition(settings: V2Settings, metresPerPixel: number): boolean {
  const pixels = heightmapPixels(settings);
  if (!pixels || !Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return false;
  settings.extent = metresPerPixel * pixels;
  // No new recipe field: the native spacing is always extent / pixels.
  return true;
}

export interface HeightmapFit {
  scale: number;
  datum: number;
  crop: number;
  black: number;
  white: number;
}
/** Crop actual pixels rather than inventing extra samples by enlarging the crop. */
export function fitHeightmap(source: TerrainSketch, fit: HeightmapFit, range?: [number, number]): TerrainSketch {
  const n = source.resolution,
    side = Math.max(8, Math.min(n, Math.round((n * fit.crop) / 100)));
  const offset = Math.floor((n - side) / 2),
    heights = new Array<number>(side * side);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      let h = source.heights[(y + offset) * n + x + offset];
      if (range) h = fit.black + (range[1] === range[0] ? 0 : (h - range[0]) / (range[1] - range[0])) * (fit.white - fit.black);
      heights[y * side + x] = Math.max(-12000, Math.min(12000, (h - fit.datum) * fit.scale));
    }
  return { ...source, resolution: side, heights };
}
