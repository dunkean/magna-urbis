import { Rng } from '../gen/core/rng';
import { generateNames, settlementNames } from '../gen/names';
import { applyNameOverrides } from '../gen/pipeline';
import type { World } from '../gen/types';
import type { V2Settings } from './contracts';

/** Rebuild only names. Retained geometry, heights and random streams are untouched. */
export function renameMap(source: World, settings: V2Settings): World {
  const world: World = { ...source, options: { ...source.options, language: settings.options.language },
    settlements: source.settlements?.map(place => ({ ...place })) };
  const root = new Rng('magna-urbis:' + source.seed);
  world.names = generateNames({ ...world, options: { ...world.options, ...settings.local.main } }, root);
  settlementNames(world, root);
  applyNameOverrides(world);
  // Native/manual placement names take precedence over generated defaults.
  const placement = settings.region?.placement;
  if (placement?.main?.name) setPlaceName(world, 'main', placement.main.name);
  for (const spec of placement?.list ?? []) {
    if (spec.name) setPlaceName(world, spec.key, spec.name);
  }
  for (const [key, name] of Object.entries(settings.naming?.places ?? {})) setPlaceName(world, key, name);
  if (settings.naming?.title?.trim()) world.names.town = settings.naming.title.trim();
  return world;
}

function setPlaceName(world: World, key: string, value: string): void {
  const place = world.settlements?.find(place => place.key === key), name = value.trim();
  if (!place || !name || !world.names) return;
  if (place.main) {
    const previous = world.names.town;
    for (const entry of world.names.entries) if (previous && entry.text.includes(previous)) entry.text = entry.text.split(previous).join(name);
    world.names.town = name;
  } else {
    for (const entry of world.names.entries) if (entry.sub === 'settlement:' + key) entry.text = name;
  }
  place.name = name;
}
