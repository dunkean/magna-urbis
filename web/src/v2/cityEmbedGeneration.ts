import type { ExternalCityHints } from './externalCity/types';
import type { Rect4 } from '../render/view';
import { applyExternalCity } from './externalCity/apply';
import { defaultSettings } from './settings';
import { presetComposition } from '../render/composition';
import type { V2Settings } from './contracts';
import type { Vec2, World } from '../gen/types';
import { cityEmbedStartsWithBlocks, type CityPreviewMode } from './cityPreviewMap';
import { polygonArea } from '../gen/core/geom';

export function cityEmbedSettings(hints: ExternalCityHints, local: boolean, mode: CityPreviewMode = 'compact'): V2Settings {
  const settings = applyExternalCity(hints, defaultSettings());
  // The standalone importer leaves room for a region. An FMG preview shows one town and its near fringe.
  if (typeof settings.extent === 'number') settings.extent = Math.max(1000, Math.round(settings.extent * 0.6 / 100) * 100);
  const backend = local ? 'native' : 'rust';
  settings.generation = 'procedural';
  delete settings.decor;
  settings.local = {};
  settings.terrain = { ...settings.terrain, resolution: 96, relief: 'flat', erosion: 0, generationCompute: local ? undefined : 'cpu', forest: { ...settings.terrain?.forest, enabled: false } };
  if (hints.river === 'none') settings.terrain.hydrology = { ...settings.terrain.hydrology, enabled: false };
  settings.region = { ...settings.region, resolution: 96, autoBuildPopulation: 0 };
  const site = settings.region.placement?.list?.[0];
  if (site && hints.port && hints.coast && hints.coast !== 'none') site.siteType = 'harbor';
  settings.runtime = { backend, autoBackend: false, source: 'procedural', compute: 'cpu' };
  settings.urban = { backend, architecture: mode === 'houses' ? 'detailed' : 'silhouette', through: mode === 'compact' && cityEmbedStartsWithBlocks(hints.population) ? 'layout' : 'buildings' };
  settings.appearance = { style: 'parchment', composition: presetComposition('minimal') };
  return settings;
}

/** Fit the visible urban fabric. Country tracks and isolated lots may lie far from the built town. */
export function cityEmbedBounds(world: World): Rect4 {
  const place = world.settlements?.find(town => town.main || town.key === 'main');
  const urban = place?.urban ?? world.urban;
  const buildings = urban?.buildings ?? [];
  const enclosure = (urban?.walls ?? []).filter(wall => wall.closed && wall.path.length >= 3).reduce<Vec2[] | undefined>((best, wall) => (!best || Math.abs(polygonArea(wall.path)) > Math.abs(polygonArea(best)) ? wall.path : best), undefined);
  const points: Vec2[] = [];
  if (enclosure) points.push(...enclosure);
  else if (buildings.length) {
    for (const building of buildings) for (const point of building.poly) points.push(point);
  } else for (const block of urban?.blocks ?? []) for (const point of block) points.push(point);
  const x = points
    .map(p => p.x)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const y = points
    .map(p => p.y)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!x.length || !y.length) {
    const center = place?.core ?? place?.center ?? world.site?.center ?? { x: world.mapSize / 2, y: world.mapSize / 2 };
    const half = Math.min(world.mapSize, 1250) / 2;
    return { minX: center.x - half, minY: center.y - half, maxX: center.x + half, maxY: center.y + half };
  }
  // Trim sparse outliers before fitting. The margin still leaves room for town walls and the near fringe.
  const extent = (values: number[]) => {
    const trim = !enclosure && buildings.length >= 30 ? Math.floor(values.length * 0.025) : 0;
    const min = values[trim],
      max = values[values.length - 1 - trim];
    const margin = Math.max(18, (max - min) * 0.12);
    return [min - margin, max + margin] as const;
  };
  const [minX, maxX] = extent(x);
  const [minY, maxY] = extent(y);
  return { minX, minY, maxX, maxY };
}
