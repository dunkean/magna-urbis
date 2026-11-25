import type { ProgressCallback } from '../contracts';
import { generateRustTown, type RustTownSnapshot } from '../rustUrban';
import { recordGenerationValidity } from '../stageValidity';
import type { OsmImport } from './osmImport';
import { osmStreetLayout } from './osmStreetLayout';

/** Keep the surveyed town's roads and names and take the cadastre and buildings from the native city generator. */
export async function generateOsmBuildings(result: OsmImport, onProgress: ProgressCallback): Promise<void> {
  const { world, settings, summary } = result;
  const towns = world.debug!.v2RustCities as Record<string, RustTownSnapshot>;
  const imported = towns.main;
  const layout = osmStreetLayout(world, imported.layouts[0], result.buildingArea);
  delete result.buildingArea;
  world.stats['osm.buildings'] = 'generated';
  towns.main = { ...imported, stage: 'layout', importedLayout: layout };
  if (!layout.blocks.length) return;

  const population = layout.programme!.population;
  const place = world.settlements![0];
  summary.population = place.population = settings.options.population = world.options.population = population;
  settings.region!.placement!.list![0].population = population;
  const generated = await generateRustTown(world, settings, place.key, onProgress, 'buildings');
  const surveyed = world.urban!;
  const { urban, snapshot, stats } = generated;
  if (imported.partitions?.[0] && snapshot.partitions?.[0]) snapshot.partitions[0] = { ...imported.partitions[0], ...snapshot.partitions[0] };
  world.urban = place.urban = { ...urban, walls: surveyed.walls, squares: surveyed.squares, landmarks: surveyed.landmarks, streets: surveyed.streets };
  towns.main = snapshot;
  Object.assign(world.stats, stats);
  summary.buildings = urban.buildings.length;
  recordGenerationValidity(world, settings, 'region');
  recordGenerationValidity(world, settings, 'town', place.key, 'buildings');
}
