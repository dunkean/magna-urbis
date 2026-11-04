import type { World } from '../gen/types';
import { projectRustTown, type RustTownSnapshot } from './rustUrban';

export function nativeCityStageView(snapshot: RustTownSnapshot, stage: string): RustTownSnapshot {
  if (stage === 'city-composition') return { ...snapshot, stage: 'layout',
    layouts: (snapshot.compositionLayouts ?? snapshot.layouts).map(layout => ({ ...layout, blocks: [], streets: layout.streets.filter(street => street.rank <= 1) })),
    partitions: undefined, scene: undefined };
  if (stage === 'city-roads') return { ...snapshot, stage: 'layout', layouts: snapshot.layouts.map(layout => ({ ...layout, blocks: [] })), partitions: undefined, scene: undefined };
  if (stage === 'city-quarters' || stage === 'city-trim') return { ...snapshot, stage: 'layout', partitions: undefined, scene: undefined };
  if (stage === 'city-parcels') return { ...snapshot, stage: 'parcels', partitions: snapshot.cadastralPartitions ?? snapshot.partitions, scene: undefined };
  if (stage === 'city-programme') return { ...snapshot, stage: 'programme', partitions: snapshot.programmePartitions ?? snapshot.partitions, scene: undefined };
  return { ...snapshot };
}

/** Stage inspection changes the projected layers, while native products remain retained. */
export function showCityStageOutput(source: World, stage: string, keys?: readonly string[]): World {
  const selected = new Set(keys ?? source.settlements?.map(place => place.key));
  const snapshots = source.debug?.v2RustCities as Record<string, RustTownSnapshot> | undefined;
  const world = { ...source, stats: { ...source.stats, 'v2.cityOutput': stage, 'v2.cityOutputKeys': JSON.stringify([...selected]) }, settlements: source.settlements?.map(place => {
    const snapshot = snapshots?.[place.key]; if (!snapshot || !selected.has(place.key)) return place;
    const view = nativeCityStageView(snapshot, stage);
    const urban = projectRustTown(view, place.population, place.culture);
    return { ...place, urban };
  }) };
  const main = world.settlements?.find(place => place.main || place.key === 'main');
  if (main?.urban) world.urban = main.urban;
  return world;
}
