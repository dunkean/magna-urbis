import { terrainCapability } from '../../../../rust/bridge/terrainDefinition';
import type { V2Settings } from '../contracts';
import { acceptHeightmap } from '../heightmapModel';
import { regionSpec } from '../regionSettings';
import { defaultSettings } from '../settings';
import { fitFmgCrop, fmgBurgsInCrop, type FmgCrop, type FmgMap } from './fmgMap';

const RESOLUTION = 256;
const IMPORT_CAPABILITY = terrainCapability({ sketch: { version: 1, resolution: RESOLUTION, processing: 'surface', heights: [] } });
export const FMG_CROP_TOO_MANY_BURGS = 'Choose a smaller area. A region supports up to 1,000 burgs.';
export const FMG_CROP_LIMIT = 1000;

export function fmgCropExtent(map: Pick<FmgMap, 'metresPerPixel'>, crop: FmgCrop, customWidth?: number) {
  const original = map.metresPerPixel === undefined ? undefined : crop.side * map.metresPerPixel;
  const requested = original ?? (customWidth !== undefined && Number.isFinite(customWidth) ? customWidth : 6000);
  const width = Math.round(Math.max(IMPORT_CAPABILITY.minWidth, Math.min(IMPORT_CAPABILITY.maxWidth, requested)));
  return { width, original, resized: original !== undefined && (original < IMPORT_CAPABILITY.minWidth || original > IMPORT_CAPABILITY.maxWidth) };
}

export function fmgCropSettings(map: FmgMap, crop: FmgCrop, filename: string, customWidth?: number): V2Settings {
  crop = fitFmgCrop(map, crop);
  const { width } = fmgCropExtent(map, crop, customWidth);
  const { x, y, side } = crop;
  const burgs = fmgBurgsInCrop(map, crop).sort((a, b) => b.population - a.population || a.id - b.id);
  if (burgs.length > FMG_CROP_LIMIT) throw new Error(FMG_CROP_TOO_MANY_BURGS);
  const heights = Array.from({ length: RESOLUTION ** 2 }, (_, index) => map.elevationAt(x + (((index % RESOLUTION) + 0.5) * side) / RESOLUTION, y + ((Math.floor(index / RESOLUTION) + 0.5) * side) / RESOLUTION));
  // FMG places coastal burgs on its packed graph; the coarser height grid can put
  // those exact positions in water. Keep the immediate settlement samples dry.
  for (const burg of burgs) {
    const tx = Math.floor(((burg.x - x) * RESOLUTION) / side);
    const ty = Math.floor(((burg.y - y) * RESOLUTION) / side);
    for (let yy = Math.max(0, ty - 1); yy <= Math.min(RESOLUTION - 1, ty + 1); yy++) {
      for (let xx = Math.max(0, tx - 1); xx <= Math.min(RESOLUTION - 1, tx + 1); xx++) {
        const i = yy * RESOLUTION + xx;
        if (heights[i] <= 0) heights[i] = 5;
      }
    }
  }

  const settings = defaultSettings();
  const main = burgs[0];
  const name = filename.slice(0, 1000);
  const culture = main?.culture ?? settings.options.culture;
  settings.options.seed = `fmg-${map.seed}-${x.toFixed(5)}-${y.toFixed(5)}-${side.toFixed(5)}`;
  settings.options.population = main?.population ?? 0;
  settings.options.culture = culture;
  settings.naming = { title: map.name ?? name.replace(/\.map$/i, '').slice(0, 240), mode: 'cultural', script: 'source' };
  acceptHeightmap(settings, { terrain: { version: 1, processing: 'surface', resolution: RESOLUTION, heights }, width }, name);
  settings.region = {
    autoBuildPopulation: 0,
    resolution: RESOLUTION,
    placement: { mode: 'list', list: burgs.map((burg, index) => ({ ...regionSpec(index ? `fmg:${burg.id}` : 'main', burg.population), name: burg.name, culture: burg.culture ?? culture, position: { x: ((burg.x - x) * width) / side, y: ((burg.y - y) * width) / side } })) },
  };
  return settings;
}
