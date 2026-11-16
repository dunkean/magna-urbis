import type { V2Settings } from './contracts';
import { readGenerationSeed, writeGenerationSeed, seedSubset } from '../../../rust/bridge/generationSeed';
import { cultureEnvironment } from './environmentCultures';

export function regionalParentKey(settings: V2Settings): string {
  const d=settings.region?.demography,p=settings.region?.placement;
  return JSON.stringify([settings.extent,settings.options.mapSize,cultureEnvironment(settings),settings.options.culture,
    seedSubset(settings.options.seed,key=>!key.startsWith('city/')),d?.density,d?.population,d?.counts,p?.mode,p?.counts,p?.list]);
}

/** Upstream regional changes replace descendant recipes; restored complete projects are not edits. */
export function resetRegionalChildren(settings: V2Settings, mods: unknown[] = []): unknown[] {
  settings.local = {};
  if (settings.urban) {
    delete settings.urban.layout; delete settings.urban.parcels; delete settings.urban.houses;
    delete settings.urban.local; delete settings.urban.buildings; delete settings.urban.seed; delete settings.urban.seeds;
  }
  const seed = readGenerationSeed(settings.options.seed);
  for (const key of Object.keys(seed.variations)) if (key.startsWith('city/') && !key.startsWith('city/*/')) delete seed.variations[key];
  settings.options.seed = writeGenerationSeed(seed);
  if (settings.naming) {
    delete settings.naming.local; delete settings.naming.places; delete settings.naming.features;
    if (settings.naming.labels) for (const id of Object.keys(settings.naming.labels)) if (!id.startsWith('free:')) delete settings.naming.labels[id];
  }
  return mods.filter(m => !(m && typeof m === 'object' && (m as {type?: string}).type === 'building'));
}

/** Keep the current place's macro settings, clear the generation products below the edited stage. */
export function resetUrbanChildren(settings: V2Settings, scope: { kind: string; key?: string }, path: string): void {
  if (!['global','settlement'].includes(scope.kind)) return;
  const stage = path.startsWith('parcels.') ? 'parcels' : path.startsWith('houses.') ? 'houses' : path.startsWith('layout.') ? 'layout' : undefined;
  if (!stage) return;
  const u = settings.urban;if (!u) return;
  const records = scope.kind === 'global' ? [u,...Object.values(u.local ?? {})] : [u.local?.[scope.key!]].filter(Boolean);
  for (const record of records) {
    if (!record) continue;
    if (stage === 'layout') {
      if (path === 'layout.culture') delete record.layout;
      else if (record.layout?.overrides) delete record.layout.overrides.quarters;
      delete record.parcels;delete record.houses;
    } else if (stage === 'parcels') {
      if (record.parcels?.overrides) delete record.parcels.overrides.parcels;
      delete record.houses;
    } else {
      for (const q of Object.values(record.layout?.overrides?.quarters ?? {})) if (q) { delete q.houseConfig;delete q.buildingCulture; }
      for (const p of Object.values(record.parcels?.overrides?.parcels ?? {})) if (p) { delete p.houseConfig;delete p.culture; }
    }
  }
  if (u.buildings) for (const id of Object.keys(u.buildings)) if (scope.kind === 'global' || id.startsWith(`${scope.key}/`)) delete u.buildings[id];
}
