import type { V2Settings, V2UrbanControls } from './contracts';
import { readGenerationSeed, writeGenerationSeed, seedSubset } from '../../../rust/bridge/generationSeed';
import { cultureEnvironment } from './environmentCultures';

/** An explicit city culture replaces inherited cultural templates, while keeping
 * geographic controls and the independently selected representation/renderer. */
export function urbanParentControls(base: V2UrbanControls | undefined, local: V2UrbanControls | undefined): V2UrbanControls | undefined {
  if (!local?.layout?.culture || !base) return base;
  const { culture: _culture, preset: _preset, recipe: _recipe, params: _params, tissue: _tissue, styleSheet: _sheet, mixCulture: _mix, phaseOverrides: _phases, ...layout } = base.layout ?? {};
  const { culture: _plotsCulture, preset: _plotsPreset, recipe: _plotsRecipe, params: _plotsParams, operator: _operator, zoneOperators: _operators, ...parcels } = base.parcels ?? {};
  return { ...base, layout, parcels, houses: undefined };
}

const regionalSeed = (settings: V2Settings): string => seedSubset(settings.options.seed, key => !key.startsWith('city/'));
export function regionalParentKey(settings: V2Settings): string {
  const d = settings.region?.demography,
    p = settings.region?.placement;
  return JSON.stringify([settings.extent, settings.options.mapSize, cultureEnvironment(settings), settings.options.culture, regionalSeed(settings), d?.density, d?.population, d?.counts, p?.mode, p?.counts, p?.list]);
}
/** Keys of the automatic plan's slots (regionalPopulation): a list made only of them is a frozen copy of one draw
 * (moved towns, "use the current places"), not a list of places the user added. */
const AUTOMATIC_PLACE = /^(main|(city|town|village|hamlet|farmstead)-\d+)$/;

/** Upstream regional changes replace descendant recipes; restored complete projects are not edits.
 * `previousParentKey`: the regionalParentKey before the change. A new region seed also drops a list frozen from
 * the previous draw (its positions and sizes), so the next placement and its planned sizes follow the new seed.
 * Explicit counts, population and density the user typed are kept. */
export function resetRegionalChildren(settings: V2Settings, mods: unknown[] = [], previousParentKey?: string): unknown[] {
  const placement = settings.region?.placement;
  if (previousParentKey !== undefined && placement?.list?.length && placement.list.every(place => AUTOMATIC_PLACE.test(place.key)) && (JSON.parse(previousParentKey) as unknown[])[4] !== regionalSeed(settings)) {
    delete placement.list;
    placement.mode = 'auto';
  }
  settings.local = {};
  if (settings.urban) {
    delete settings.urban.layout;
    delete settings.urban.parcels;
    delete settings.urban.houses;
    delete settings.urban.local;
    delete settings.urban.buildings;
    delete settings.urban.seed;
    delete settings.urban.seeds;
  }
  const seed = readGenerationSeed(settings.options.seed);
  for (const key of Object.keys(seed.variations)) if (key.startsWith('city/') && !key.startsWith('city/*/')) delete seed.variations[key];
  settings.options.seed = writeGenerationSeed(seed);
  if (settings.naming) {
    delete settings.naming.local;
    delete settings.naming.places;
    delete settings.naming.features;
    if (settings.naming.labels) for (const id of Object.keys(settings.naming.labels)) if (!id.startsWith('free:')) delete settings.naming.labels[id];
  }
  return mods.filter(m => !(m && typeof m === 'object' && (m as { type?: string }).type === 'building'));
}

/** Keep the current place's macro settings, clear the generation products below the edited stage. */
export function resetUrbanChildren(settings: V2Settings, scope: { kind: string; key?: string }, path: string): void {
  if (!['global', 'settlement'].includes(scope.kind)) return;
  const stage = path.startsWith('parcels.') ? 'parcels' : path.startsWith('houses.') ? 'houses' : path.startsWith('layout.') ? 'layout' : undefined;
  if (!stage) return;
  const u = settings.urban;
  if (!u) return;
  const records = scope.kind === 'global' ? [u, ...Object.values(u.local ?? {})] : [u.local?.[scope.key!]].filter(Boolean);
  for (const record of records) {
    if (!record) continue;
    if (stage === 'layout') {
      if (path === 'layout.culture') delete record.layout;
      else if (record.layout?.overrides) delete record.layout.overrides.quarters;
      delete record.parcels;
      delete record.houses;
    } else if (stage === 'parcels') {
      if (record.parcels?.overrides) {
        delete record.parcels.overrides.blocks;
        delete record.parcels.overrides.parcels;
      }
      delete record.houses;
    } else {
      for (const q of Object.values(record.layout?.overrides?.quarters ?? {}))
        if (q) {
          delete q.houseConfig;
          delete q.buildingCulture;
        }
      for (const p of Object.values(record.parcels?.overrides?.parcels ?? {}))
        if (p) {
          delete p.houseConfig;
          delete p.culture;
        }
      for (const b of Object.values(record.parcels?.overrides?.blocks ?? {})) if (b) delete b.houseConfig;
    }
  }
  if (u.buildings) for (const id of Object.keys(u.buildings)) if (scope.kind === 'global' || id.startsWith(`${scope.key}/`)) delete u.buildings[id];
}
