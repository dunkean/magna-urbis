import { buildForestField, type ForestField } from '../../../rust/bridge/terrainForest';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import type { V2TerrainLayer } from './terrainProjection';
import { effectiveTerrainSettings } from './terrainSettings';

const cache = new WeakMap<World, Map<string, ForestField>>();
/** Repaint the forest over retained heights. Never call terrain or settlement generation. */
export function v2DisplayForest(world: World, settings: V2Settings): ForestField | undefined {
  const configuration = effectiveTerrainSettings(settings, world.mapSize), overrides = settings.appearance?.forest;
  const forest = { ...configuration.forest, ...overrides };
  if (!forest.enabled) return;
  if (!overrides || !Object.keys(overrides).length) return (world.terrain as V2TerrainLayer).v2ForestField;
  const climate = configuration.climateValues!, style = settings.appearance?.terrainStyle ?? settings.appearance?.style ?? settings.options.style;
  const key = JSON.stringify([forest, climate, world.seed, style.startsWith('render-v2')]);
  let fields = cache.get(world); if (!fields) { fields = new Map(); cache.set(world, fields); }
  let field = fields.get(key);
  if (!field) {
    field = buildForestField({ seed: seedHash(world.seed), climate: [climate.temperature, climate.precipitation],
      height: { x: 0, y: 0, width: world.mapSize, n: world.terrain.height.w, data: world.terrain.height.data },
      water: world.terrain.water, clearingProfile: style.startsWith('render-v2') ? 'progressive' : undefined }, forest);
    fields.set(key, field); if (fields.size > 3) fields.delete(fields.keys().next().value!);
  }
  return field;
}
