import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { nativeTerrainLayer } from './nativeProducts';
import { buildForestField, type ForestField } from '../../../rust/bridge/terrainForest';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import { effectiveTerrainSettings } from './terrainSettings';

const cache = new WeakMap<World, Map<string, ForestField>>();
/** Repaint the forest over retained heights. Never call terrain or settlement generation. */
export function v2DisplayForest(world: World, settings: V2Settings, resolved: ResolvedAppearance): ForestField | undefined {
  const configuration = effectiveTerrainSettings(settings, world.mapSize), overrides = resolved.vegetation.forest;
  const forest = { ...configuration.forest, ...overrides };
  if (!forest.enabled) return;
  if (!Object.keys(overrides).length) return nativeTerrainLayer(world)?.v2ForestField;
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
