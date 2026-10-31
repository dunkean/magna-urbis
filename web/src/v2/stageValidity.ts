import { proceduralSignatures, stableKey } from '../../../rust/bridge/terrainCheckpoints';
import { GENERATION_STAGE_ROWS } from './stageRegistry';
import { effectiveTerrainSettings } from './terrainSettings';
import { adaptedExtent } from './settings';
import type { V2Settings } from './contracts';
import { fingerprintBytes, fingerprintNumbers } from './terrainFingerprint';
import type { World } from '../gen/types';

export function settlementStageValidityKeys(settings: V2Settings, terrainKey?: string): Map<string, string> {
  const o = settings.options;
  const sites = stableKey([terrainKey, o.seed, settings.runtime?.backend, o.population, o.culture, o.siteType, o.sitePrefs, o.center,
    o.settlements, o.workflow, settings.settlementCount, settings.region?.placement, settings.region?.resolution,
    Object.entries(settings.local).map(([key, local]) => [key, local.center, local.siteType, local.sitePrefs])]);
  return new Map([['settle-sites', sites], ['settle-hierarchy', sites],
    ['settle-roads', stableKey([sites, o.roads, settings.region?.roads, settings.local.main?.roads])]]);
}

/** Conservative UI dependencies for a batch. A house edit preserves the
 * validity of its upstream layout and cadastre, including edits made via JSON. */
export function cityStageValidityKeys(settings: V2Settings, world: World | undefined, scope: string, terrainKey?: string): Map<string, string> {
  const [mode, selected] = JSON.parse(scope) as [string, string[]];
  const keys = mode === 'all' ? world?.settlements?.map(place => place.key) ?? [] : selected;
  const { importedHeight, style, contours, landuse, labels, ...options } = settings.options;
  const local = keys.map(key => [key, settings.local[key]]);
  const urban = settings.urban;
  const layout = stableKey([scope, terrainKey, world?.stats['v2.terrainKey'], world?.stats['v2.planKey'], settings.region, settings.settlementCount,
    options, local, urban?.backend ?? settings.runtime?.backend, urban?.layout,
    keys.map(key => urban?.local?.[key]?.layout)]);
  const parcels = stableKey([layout, urban?.parcels, keys.map(key => urban?.local?.[key]?.parcels)]);
  const houses = stableKey([parcels, urban?.houses, keys.map(key => urban?.local?.[key]?.houses),
    Object.entries(urban?.buildings ?? {}).filter(([key]) => !key.includes('/') || keys.some(place => key.startsWith(place + '/')))]);
  return new Map([
    ['city-composition', layout], ['city-roads', layout], ['city-quarters', layout], ['city-trim', layout],
    ['city-parcels', parcels], ['city-programme', parcels], ['city-buildings', houses], ['city-houses', houses],
  ]);
}

/** The same dependencies as the retained engine, including edits via JSON,
 * seed controls, presets and imports (not just DOM change events). */
export function terrainStageValidityKeys(settings: V2Settings): Map<string, string> {
  const terrain = effectiveTerrainSettings(settings, adaptedExtent(settings));
  const keys = new Map<string, string>(), backend = stableKey([settings.runtime?.backend, settings.runtime?.compute, settings.runtime?.localServer]);
  const signatures = proceduralSignatures(terrain);
  for (const [stage, key] of signatures) {
    const row = GENERATION_STAGE_ROWS[stage];
    if (row && !['sampling', 'retain', 'render'].includes(stage)) keys.set(row, `${backend}|${key}`);
  }
  const initial = `${backend}|${signatures.get('initialize')}`;
  keys.set('relief-source', initial);
  keys.set('relief-climate', stableKey([terrain.climate, terrain.climateZone, terrain.climateValues]));
  keys.set('relief-refine', `${backend}|${signatures.get('sampling')}`);
  keys.set('cover-climate', stableKey([backend, signatures.get('hydrology'), terrain.forest]));
  if (!terrain.procedural || settings.options.importedHeight || terrain.sketch || terrain.zones) {
    const { forest, hydrology, sketch, zones, ...relief } = terrain;
    const image=settings.options.importedHeight;
    const root = stableKey([backend, relief,
      sketch && [sketch.resolution,sketch.processing,fingerprintNumbers(sketch.heights)],
      zones && [zones.resolution,fingerprintNumbers(zones.weights)],
      image && [image.w,image.h,image.elevations?fingerprintBytes(new Uint8Array(image.elevations.buffer,image.elevations.byteOffset,image.elevations.byteLength)):fingerprintBytes(image.rgba),settings.options.heightScale,settings.options.importSea]]);
    for (const id of keys.keys()) if (id.startsWith('relief-')) keys.set(id, root);
    keys.set('water-hydrology', stableKey([root, hydrology]));
    keys.set('cover-climate', stableKey([root, hydrology, forest]));
  }
  return keys;
}

export type StageLed = 'disabled' | 'valid' | 'pending' | 'running';
export function stageLed(enabled: boolean, running: boolean, saved: string | undefined, current: string | undefined): StageLed {
  return !enabled ? 'disabled' : running ? 'running' : saved !== undefined && saved === current ? 'valid' : 'pending';
}
