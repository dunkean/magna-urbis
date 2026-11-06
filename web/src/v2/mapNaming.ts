import { Rng } from '../gen/core/rng';
import { generateNames, settlementNames } from '../gen/names';
import { cleanSettlementName } from '../gen/options';
import type { World, UrbanLayer } from '../gen/types';
import type { V2Settings } from './contracts';
import { cloneV2TerrainForStage } from './worldState';

/** Detach only metadata that the names stage writes; physical geometry stays shared. */
function namingUrban(source: UrbanLayer | undefined): UrbanLayer | undefined {
  if (!source) return;
  return { ...source,
    sites: source.sites?.map(site => ({ ...site })),
    macro: source.macro ? { ...source.macro, nuclei: source.macro.nuclei.map(nucleus => ({ ...nucleus })) } : undefined,
  };
}

/** Rebuild only names. Retained geometry, heights and random streams are untouched. */
export function renameMap(source: World, settings: V2Settings): World {
  const manual = new Map<string, string>();
  const specs = source.options.settlements;
  if (source.options.workflow === 'list' && specs && typeof specs === 'object' && 'list' in specs) {
    specs.list.forEach((spec, index) => { const name = cleanSettlementName(spec.name); if (name) manual.set(index === 0 ? 'main' : spec.key ?? String(index), name); });
  }
  const placement = settings.region?.placement;
  if (placement?.main?.name) manual.set('main', placement.main.name);
  for (const spec of placement?.list ?? []) if (spec.name) manual.set(spec.key, spec.name);
  for (const [key, name] of Object.entries(settings.naming?.places ?? {})) {
    const cleaned = cleanSettlementName(name);
    if (cleaned) manual.set(key, cleaned);
  }
  const settlements = source.settlements?.map(place => ({ ...place,
    culture: settings.local[place.key]?.culture ?? (place.main ? settings.options.culture : place.culture),
    options: { ...place.options, ...settings.local[place.key] },
  }));
  // List names are an input to generation, so all derived references see the corrected destination.
  const main = settlements?.find(place => place.main);
  const ordered = main ? [main, ...settlements!.filter(place => !place.main)] : settlements;
  const world: World = { ...source,
    options: { ...source.options, language: settings.options.language, culture: settings.options.culture },
    terrain: cloneV2TerrainForStage(source.terrain), urban: namingUrban(source.urban), settlements,
  };
  // The synthetic list belongs only to this naming view, never to the retained generation recipe.
  const namingView: World = { ...world, options: { ...world.options,
    ...(ordered?.length ? { workflow: 'list' as const, settlements: { list: ordered.map(place => ({
      key: place.key, population: place.population, culture: place.culture, options: place.options, name: manual.get(place.main ? 'main' : place.key),
    })) } } : {}),
  } };
  const root = new Rng('magna-urbis:' + source.seed);
  world.names = generateNames({ ...namingView, options: { ...namingView.options, ...settings.local.main,
    culture: settings.local.main?.culture ?? main?.culture ?? settings.options.culture } }, root,
    { mode: settings.naming?.mode ?? 'cultural', language: settings.naming?.displayLanguage ?? 'en' });
  namingView.names = world.names;
  settlementNames(namingView, root);
  if (settings.naming?.title?.trim()) world.names.town = settings.naming.title.trim();
  return world;
}
