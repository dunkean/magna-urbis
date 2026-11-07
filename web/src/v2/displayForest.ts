import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { nativeTerrainLayer } from './nativeProducts';
import { buildForestField, type ForestField, type ForestOccupation } from '../../../rust/bridge/terrainForest';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import type { LandUseLayer, World } from '../gen/types';
import type { V2Settings } from './contracts';
import { effectiveTerrainSettings } from './terrainSettings';
import { forestOccupation } from '../ui/forestOccupation';
import { withLandDetail } from '../ui/landDetail';

const cache = new WeakMap<World, Map<string, ForestField>>();
const occupations = new WeakMap<LandUseLayer, ForestOccupation | undefined>();
/** Product identity is the land-use revision; neither appearance nor visibility is an input. */
export function v2ForestOccupation(world: World): ForestOccupation | undefined {
  const landuse = world.landuse; if (!landuse) return;
  if (!occupations.has(landuse)) occupations.set(landuse, withLandDetail(forestOccupation(landuse), landuse));
  return occupations.get(landuse);
}
/** Repaint the forest over retained heights. Never call terrain or settlement generation. */
export function v2DisplayForest(world: World, settings: V2Settings, resolved: ResolvedAppearance): ForestField | undefined {
  if (!resolved.composition.vegetation.procedural) return;
  const configuration = effectiveTerrainSettings(settings, world.mapSize), overrides = resolved.vegetation.forest;
  const { enabled: _enabled, ...parameters } = overrides, forest = { ...configuration.forest, ...parameters, enabled: true };
  if (!Object.keys(parameters).length) return nativeTerrainLayer(world)?.v2ForestField;
  const climate = configuration.climateValues!, clearingProfile = resolved.traits.forestClearingProfile;
  const key = JSON.stringify([forest, climate, world.seed, clearingProfile]);
  let fields = cache.get(world); if (!fields) { fields = new Map(); cache.set(world, fields); }
  let field = fields.get(key);
  if (!field) {
    field = buildForestField({ seed: seedHash(world.seed), climate: [climate.temperature, climate.precipitation],
      height: { x: 0, y: 0, width: world.mapSize, n: world.terrain.height.w, data: world.terrain.height.data },
      water: world.terrain.water, clearingProfile }, forest);
    fields.set(key, field); if (fields.size > 3) fields.delete(fields.keys().next().value!);
  }
  return field;
}
