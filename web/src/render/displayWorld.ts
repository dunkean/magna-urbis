import type { World, UrbanLayer } from '../gen/types';
import type { ExportLayers } from './exportLayers';

/** Apply display visibility to a shallow view. Retained world data is never changed. */
export function displayWorld(world: World, layers?: Partial<ExportLayers>, buildings = true): World {
  if (layers?.roads !== false && layers?.city !== false && buildings) return world;
  const urban = (value: UrbanLayer | undefined): UrbanLayer | undefined => layers?.city === false ? undefined : !buildings && value ? { ...value, buildings: [], masses: [], landmarks: [] } : value;
  return { ...world, roads: layers?.roads === false ? undefined : world.roads,
    urban: urban(world.urban),
    megaDetail: world.megaDetail && Object.fromEntries(Object.entries(world.megaDetail).flatMap(([key, value]) => { const shown = urban(value); return shown ? [[key, shown]] : []; })),
    settlements: world.settlements?.map(place => ({ ...place, urban: urban(place.urban) })) };
}
