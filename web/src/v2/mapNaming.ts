import { Rng } from '../gen/core/rng';
import { generateNames, settlementNames, setSettlementName } from '../gen/names';
import { cleanSettlementName } from '../gen/options';
import type { World, UrbanLayer } from '../gen/types';
import type { V2Settings } from './contracts';
import { cloneV2TerrainForStage } from './worldState';
import { applyLabelEdits } from './mapLabels';
import { presentName } from '../gen/names/displayNames';
import type { Language } from './languages';
import { appendNativeNames } from './nativeNames';
import { namingPolicy, namePolicyKey } from '../gen/names/policy';
import { generateToponymRecord } from '../gen/names/toponyms';
import { resolveToponymProfile } from '../gen/names/profiles';
import { vocabularyForProfile } from '../gen/names/culturalVocabulary';
import { VOCAB } from '../gen/names/grammar';
import type { NameEntry } from '../gen/names/types';
import { nativeCityRecords } from './nativeProducts';
import { featureNameKey } from '../gen/names/identity';
import { renameParts } from '../gen/names/rename';
import { sameContent } from './terrainIntern';

/** Detach only metadata that the names stage writes; physical geometry stays shared. */
function namingUrban(source: UrbanLayer | undefined): UrbanLayer | undefined {
  if (!source) return;
  return {
    ...source,
    streets: source.streets.map(street => ({ ...street })),
    quarters: source.quarters.map(quarter => ({ ...quarter })),
    sites: source.sites?.map(site => ({ ...site })),
    macro: source.macro ? { ...source.macro, nuclei: source.macro.nuclei.map(nucleus => ({ ...nucleus })) } : undefined,
  };
}

/** Rebuild only names. Retained geometry, heights and random streams are untouched. */
export function renameMap(source: World, settings: V2Settings, language: Language = 'en'): World {
  return nameMap(source, settings, language);
}

/** Use the full run's naming inputs and bank for the changed town, with the rest of the map retained. */
export function renameLocalTown(previous: World, source: World, settings: V2Settings, key: string): World {
  if (source.stats['osm.attribution'] && source.names?.entries.some(entry => entry.id.startsWith('osm:'))) return source;
  return nameMap(source, settings, 'en', { previous, key });
}

const urbanKinds = new Set<NameEntry['kind']>(['street', 'quarter', 'castle', 'church', 'gate', 'square']);

function nameMap(source: World, settings: V2Settings, language: Language, local?: { previous: World; key: string }): World {
  const presentation = { mode: settings.naming?.mode ?? ('localized' as const), language: settings.naming?.mapLanguage && settings.naming.mapLanguage !== 'ui' ? settings.naming.mapLanguage : language, script: settings.naming?.script };
  if (source.stats['osm.attribution'] && source.names?.entries.some(entry => entry.id.startsWith('osm:'))) {
    const world = { ...source, settlements: source.settlements?.map(place => ({ ...place })), names: { ...source.names, presentation, entries: source.names.entries.map(entry => ({ ...entry })) } };
    const name = settings.naming?.places?.main ?? settings.region?.placement?.list?.find(place => place.key === 'main')?.name;
    if (name) setSettlementName(world, 'main', name);
    if (settings.naming?.title?.trim()) world.names.town = settings.naming.title.trim();
    applyLabelEdits(world, settings.naming?.labels);
    return world;
  }
  const manual = new Map<string, string>();
  const specs = source.options.settlements;
  if (source.options.workflow === 'list' && specs && typeof specs === 'object' && 'list' in specs) {
    specs.list.forEach((spec, index) => {
      const name = cleanSettlementName(spec.name);
      if (name) manual.set(index === 0 ? 'main' : (spec.key ?? String(index)), name);
    });
  }
  const placement = settings.region?.placement;
  if (placement?.main?.name) manual.set('main', placement.main.name);
  for (const spec of placement?.list ?? []) if (spec.name) manual.set(spec.key, spec.name);
  for (const [key, name] of Object.entries(settings.naming?.places ?? {})) {
    const cleaned = cleanSettlementName(name);
    if (cleaned) manual.set(key, cleaned);
  }
  const oldPlace = local?.previous.settlements?.find(place => place.key === local.key);
  const namingInputs = (urban: UrbanLayer | undefined): unknown[] => [urban?.footprint, urban?.streets, urban?.quarters.map(({ nameScope, nameSource, nameProfile, ...quarter }) => quarter), urban?.sites, urban?.macro, urban?.landmarks, urban?.walls, urban?.squares];
  const edited = local && source.settlements?.find(place => place.key === local.key);
  const mainEdit = !!edited?.main;
  const oldUrban = mainEdit ? local?.previous.urban : oldPlace?.urban;
  const editedUrban = mainEdit ? source.urban : edited?.urban;
  const reuseUrbanNames = !!(local && source.names && oldPlace && edited && edited.culture === oldPlace.culture && sameContent(source.bridges, local.previous.bridges) && sameContent(namingInputs(editedUrban), namingInputs(oldUrban)));
  const refreshPlaceLabel = !!(local && !mainEdit && edited && (!oldPlace || edited.population !== oldPlace.population || edited.detail !== oldPlace.detail || edited.culture !== oldPlace.culture || !sameContent(oldPlace.core ?? oldPlace.center, edited.core ?? edited.center)));
  const namedUrban = (urban: UrbanLayer | undefined): UrbanLayer | undefined => (reuseUrbanNames && urban && oldUrban ? { ...urban, streets: oldUrban.streets, quarters: oldUrban.quarters, sites: oldUrban.sites, macro: oldUrban.macro } : namingUrban(urban));
  const settlements = source.settlements?.map(place => {
    if (local && place.key !== local.key) return place;
    const policy = namingPolicy(settings.naming, place.key);
    const spec = source.options.workflow === 'list' && specs && typeof specs === 'object' && 'list' in specs ? specs.list.find((s, index) => (index === 0 ? 'main' : (s.key ?? String(index))) === place.key)?.options : undefined;
    return {
      ...place,
      culture: settings.local[place.key]?.culture ?? (place.main ? settings.options.culture : place.culture),
      urban: namedUrban(place.urban),
      options: {
        ...place.options,
        ...settings.local[place.key],
        language: policy.profile ?? settings.local[place.key]?.language ?? spec?.language ?? settings.options.language ?? 'auto',
        nameSource: policy.source ?? settings.local[place.key]?.nameSource ?? spec?.nameSource ?? settings.options.nameSource,
      },
    };
  });
  // List names are an input to generation, so all derived references see the corrected destination.
  const main = settlements?.find(place => place.main);
  const ordered = main ? [main, ...settlements!.filter(place => !place.main)] : settlements;
  const world: World = {
    ...source,
    options: {
      ...source.options,
      language: (settings.naming?.toponymCulture ? resolveToponymProfile(settings.naming.toponymCulture).id : settings.naming?.profile) ?? settings.options.language ?? 'auto',
      nameSource: settings.naming?.source ?? settings.options.nameSource,
      culture: settings.options.culture,
    },
    terrain: local ? source.terrain : cloneV2TerrainForStage(source.terrain),
    urban: local ? (mainEdit ? namedUrban(source.urban) : source.urban) : namingUrban(source.urban),
    settlements,
    roads: local || source.roads?.every(road => (road as { nameKey?: string }).nameKey) ? source.roads : source.roads?.map(road => ({ ...road })),
    landuse: local ? source.landuse : source.landuse ? { ...source.landuse, areas: source.landuse.areas.map(area => ({ ...area })), farmsteads: source.landuse.farmsteads.map(farm => ({ ...farm })) } : undefined,
  };
  for (const city of [{ key: 'main', urban: world.urban }, ...(settlements ?? []).filter(s => !s.main)]) {
    if (local && (reuseUrbanNames || city.key !== (mainEdit ? 'main' : local.key))) continue;
    const layout = nativeCityRecords(world)?.[city.key]?.layouts[0];
    for (const [index, q] of (city.urban?.quarters ?? []).entries()) {
      const id = layout ? `urban:${encodeURIComponent(city.key)}:quarter:${encodeURIComponent(layout.key)}:${q.nativeId ?? index}` : featureNameKey(q, 'quarter', JSON.stringify(q.poly.outer));
      const policy = namingPolicy(settings.naming, city.key, id);
      q.nameProfile = policy.profile;
      q.nameSource = policy.source;
      q.nameScope = id;
    }
  }
  // The synthetic list belongs only to this naming view, never to the retained generation recipe.
  const variation = Object.entries(settings.naming?.variations ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const namingView: World = {
    ...world,
    seed: variation.length ? `${source.seed}:names:${JSON.stringify(variation)}` : source.seed,
    options: {
      ...world.options,
      ...(ordered?.length ? { workflow: 'list' as const, settlements: { list: ordered.map(place => ({ key: place.key, population: place.population, culture: place.culture, options: place.options, name: manual.get(place.main ? 'main' : place.key) })) } } : {}),
    },
  };
  const root = new Rng('magna-urbis:' + namingView.seed);
  const mainPolicy = namingPolicy(settings.naming, 'main');
  const ownLabel = (entry: NameEntry): boolean =>
    !!local && (entry.cityKey === local.key || ownsNativeLabel(entry.id) || (refreshPlaceLabel && entry.id === `settlement:${local.key}`) || (mainEdit && !entry.cityKey && entry.sub !== 'free' && (urbanKinds.has(entry.kind) || entry.id === 'settlement:main')));
  const ownsNativeLabel = (id: string): boolean => !!local && (id.startsWith(`urban:${encodeURIComponent(local.key)}:`) || (id.startsWith(mainEdit ? 'classic:' : `classic:${encodeURIComponent(local.key)}:`) && (!mainEdit || /^classic:(quarter|parcel|building):/.test(id))));
  const retainedEntries = new Map(local ? source.names?.entries.filter(ownLabel).map(entry => [entry.id, entry]) : undefined);
  const retainedUrban = local && [...retainedEntries.values()].filter(entry => !ownsNativeLabel(entry.id) && !(refreshPlaceLabel && entry.id === `settlement:${local.key}`));
  world.names =
    local && source.names && (!mainEdit || reuseUrbanNames)
      ? { ...source.names, entries: reuseUrbanNames ? retainedUrban || [] : [] }
      : generateNames(
          {
            ...namingView,
            options: {
              ...namingView.options,
              ...settings.local.main,
              culture: settings.local.main?.culture ?? main?.culture ?? settings.options.culture,
              language: mainPolicy.profile ?? main?.options?.language ?? world.options.language,
              nameSource: mainPolicy.source ?? main?.options?.nameSource ?? world.options.nameSource,
            },
          },
          root,
          presentation,
          { ...namingPolicy(settings.naming), profile: namingPolicy(settings.naming).profile ?? settings.options.language ?? 'auto' },
          !!local,
        );
  namingView.names = world.names;
  if (!local) settlementNames(namingView, root);
  else if (refreshPlaceLabel) {
    const place = settlements?.find(place => place.key === local.key);
    if (place) {
      const one = { ...namingView, settlements: [place], names: { ...world.names, entries: [] as NameEntry[] } };
      settlementNames(one, root);
      world.names.entries.push(...one.names.entries);
    }
  }
  for (const place of settlements ?? []) {
    if (place.main || !place.urban || (local && (local.key !== place.key || reuseUrbanNames))) continue;
    // Only the town's own names are kept below: its view carries no lake, forest or farm, whose label anchors
    // (pole of inaccessibility of every polygon) were otherwise recomputed once per built place.
    const localView: World = {
      ...namingView,
      site: { ...namingView.site!, center: place.center },
      urban: place.urban,
      terrain: { ...namingView.terrain, lakes: [] },
      landuse: undefined,
      settlements: [{ ...place, main: true }],
      options: { ...namingView.options, ...place.options, culture: place.culture, workflow: 'list', settlements: { list: [{ key: place.key, population: place.population, name: manual.get(place.key) }] } },
    };
    const names = generateNames(localView, root.fork(place.key), presentation, undefined, !!local);
    for (const entry of names.entries.filter(e => urbanKinds.has(e.kind))) {
      entry.id = `city:${place.key}:${entry.id}`;
      entry.entityKey = entry.id;
      entry.cityKey = place.key;
      if (entry.reference?.key === 'main') entry.reference.key = place.key;
      world.names.entries.push(entry);
    }
  }
  appendNativeNames(world, settings.naming, namingView.seed, local && { key: local.key, entries: retainedEntries });
  const kept = (entry: NameEntry): boolean => !!local && retainedEntries.get(entry.id) === entry;
  // Apply per-object overrides using the same profile vocabulary as the rest of the map.
  for (const entry of world.names.entries) {
    if (kept(entry)) continue;
    const override = settings.naming?.features?.[entry.id] ?? (settings.naming?.variations?.[`feature:${entry.id}`] ? {} : undefined);
    if (!override || entry.id.startsWith('urban:') || entry.manual || (entry.reference?.form === 'name' && manual.has(entry.reference.key))) continue;
    const city = entry.cityKey ?? 'main';
    const place = settlements?.find(s => s.key === city),
      natural = ['river', 'lake', 'sea', 'forest', 'hill', 'farm'].includes(entry.kind),
      policy = namingPolicy(settings.naming, natural ? undefined : city, entry.id, entry.parentKey);
    const culture = place?.culture ?? world.options.culture,
      profile = resolveToponymProfile(culture, policy.profile ?? (natural ? settings.options.language : place?.options?.language) ?? world.options.language, world.seed);
    const kind = natural ? (entry.kind as import('../gen/names/toponyms').ToponymKind) : 'place';
    const record = generateToponymRecord({ seed: namingView.seed, key: entry.id, kind, culture, language: profile.id, source: policy.source ?? place?.options?.nameSource ?? world.options.nameSource });
    entry.parts = natural
      ? { ...entry.parts, proper: record.proper, cultural: record.cultural, kind: entry.kind, opaque: record.opaque, profile: profile.id, sourceMode: record.sourceMode, meaning: undefined }
      : renameParts({ ...entry.parts!, profile: profile.id, sourceMode: record.sourceMode }, record.proper);
  }
  const previous = source.names?.bank ?? {};
  const bank = { ...previous };
  const citySources = new Map(settlements?.map(s => [s.key, s.options?.nameSource]));
  const migrating = source.names?.algorithmVersion === '2' && !source.names.bank && !settings.naming?.toponymCulture && !settings.naming?.profile && !settings.naming?.source && !settings.naming?.region && !settings.naming?.local && !settings.naming?.features;
  for (const entry of world.names.entries) {
    if (kept(entry)) continue;
    const city = entry.cityKey ?? (entry.sub?.startsWith('settlement:') ? entry.sub.slice(11) : 'main');
    const natural = ['river', 'lake', 'sea', 'forest', 'hill', 'farm'].includes(entry.kind) && !entry.id.startsWith('settlement:');
    const key = namePolicyKey(settings.naming, entry, city, (natural ? settings.options.nameSource : citySources.get(city)) ?? world.options.nameSource ?? 'auto'),
      retained = previous[entry.id];
    const explicit = entry.reference?.form === 'name' && manual.has(entry.reference.key);
    if (retained?.policyKey === key && !explicit) entry.parts = { ...retained.parts };
    else if (migrating && !explicit && entry.parts) {
      const old = source.names?.entries.find(e => e.id === entry.id || (e.kind === entry.kind && Math.hypot(e.anchor.x - entry.anchor.x, e.anchor.y - entry.anchor.y) < 0.01));
      const namedPlace = entry.kind === 'town' || entry.kind === 'village';
      if (old?.parts && (!old.parts.opaque || namedPlace)) entry.parts = renameParts(entry.parts, old.parts.proper);
      else if (old?.parts?.opaque && ['river', 'lake', 'sea', 'forest', 'hill'].includes(entry.kind)) entry.parts = { ...entry.parts, proper: old.parts.proper, cultural: old.parts.cultural, opaque: true };
    }
    entry.policyKey = key;
    if (entry.parts) {
      entry.canonicalText = entry.parts.cultural;
      entry.text = presentName(entry.parts, presentation);
      if (!explicit) bank[entry.id] = { parts: { ...entry.parts }, policyKey: key };
    }
  }
  world.names.bank = bank;
  if (!local && world.names.regionParts) {
    const regional = { id: 'region', kind: 'farm' as const, parts: world.names.regionParts };
    const key = namePolicyKey(settings.naming, regional as import('../gen/names/types').NameEntry, undefined, settings.options.nameSource ?? world.options.nameSource ?? 'auto');
    world.names.regionParts = previous.region?.policyKey === key ? { ...previous.region.parts } : world.names.regionParts;
    if (migrating && source.names?.regionParts)
      world.names.regionParts = source.names.regionParts.opaque ? { ...world.names.regionParts, proper: source.names.regionParts.proper, cultural: source.names.regionParts.cultural, opaque: true } : renameParts(world.names.regionParts, source.names.regionParts.proper);
    bank.region = { parts: { ...world.names.regionParts }, policyKey: key };
  }
  // References are composed after restoring frozen settlement identities.
  if (local) {
    // Only fresh labels are mutable here. Resolve their references against the same retained place identities.
    const fresh = { ...world, urban: mainEdit ? world.urban : undefined, settlements: settlements?.filter(place => place.key === local.key), names: { ...world.names, entries: world.names.entries.filter(entry => !kept(entry)) } };
    const destinationNames = new Map(settlements?.map(place => [place.main ? 'main' : place.key, place.name]));
    for (const label of fresh.names.entries) if (label.reference?.form === 'name') destinationNames.set(label.reference.key, manual.get(label.reference.key) ?? label.parts?.proper ?? label.text);
    for (const key of new Set(fresh.names.entries.flatMap(entry => (entry.reference ? [entry.reference.key] : [])))) {
      const name = destinationNames.get(key);
      if (name) setSettlementName(fresh, key, name);
    }
    const freshIds = new Set(fresh.names.entries.map(entry => entry.id));
    const labels = Object.fromEntries(Object.entries(settings.naming?.labels ?? {}).filter(([id]) => freshIds.has(id) || (ownsNativeLabel(id) && !world.names!.entries.some(entry => entry.id === id))));
    applyLabelEdits(fresh, labels, local.key);
    const changed = new Map([...world.names.entries, ...fresh.names.entries].map(entry => [entry.id, entry]));
    const merged: NameEntry[] = [];
    for (const entry of source.names?.entries ?? []) {
      const next = changed.get(entry.id);
      if (next && retainedEntries.has(entry.id)) {
        // Ordinal aliases are import metadata. A local run does not assign map-wide ordinals.
        if (next !== entry && entry.legacyId !== undefined) next.legacyId = entry.legacyId;
        merged.push(next === entry || (sameContent(entry, next) && sameContent(next, entry)) ? entry : next);
        changed.delete(entry.id);
      } else if (!retainedEntries.has(entry.id)) {
        merged.push(entry);
        changed.delete(entry.id);
      }
    }
    world.names = { ...(source.names ?? world.names), nativeManaged: world.names.nativeManaged, entries: [...merged, ...changed.values()], bank };
    if (edited && mainEdit && world.urban) {
      const main = settlements?.find(place => place.key === local.key);
      if (main && source.urban === edited.urban) main.urban = world.urban;
    }
    return { ...world, options: source.options };
  }
  for (const entry of world.names.entries) if (entry.reference?.form === 'name') setSettlementName(world, entry.reference.key, manual.get(entry.reference.key) ?? entry.parts?.proper ?? entry.text);
  world.names.region = world.names.regionParts ? presentName(world.names.regionParts, presentation) : world.names.region;
  if (settings.naming?.title?.trim()) world.names.town = settings.naming.title.trim();
  // Migrate ordinal label edits against the old retained feature's type and anchor, never its new ordinal.
  const edits = settings.naming?.labels;
  for (const [id, edit] of Object.entries(edits ?? {}))
    if (/^n\d+$/.test(id)) {
      const old = source.names?.entries.find(e => e.id === id);
      const next = old ? world.names.entries.find(e => e.kind === old.kind && Math.hypot(e.anchor.x - old.anchor.x, e.anchor.y - old.anchor.y) < 0.01) : undefined;
      if (next && edits) {
        edits[next.id] ??= edit;
        delete edits[id];
      }
    }
  applyLabelEdits(world, settings.naming?.labels);
  return world;
}

/** A view of the retained names: never regenerate proper names when switching the UI. */
export function presentMapNames(source: World, language: Language, mode: 'cultural' | 'localized' = 'localized', script?: 'source' | 'latin'): World {
  if (!source.names) return source;
  const presentation = { mode, language, script };
  return {
    ...source,
    names: {
      ...source.names,
      presentation,
      region: source.names.regionParts ? presentName(source.names.regionParts, presentation) : source.names.region,
      entries: source.names.entries.map(entry => (entry.parts && (!entry.manual || entry.generated) ? { ...entry, text: presentName(entry.parts, presentation) } : entry)),
    },
  };
}
