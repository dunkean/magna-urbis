import type { Layout, Partition } from '../../../rust/bridge/urban';
import type { LayoutConfig, QuarterOverride, UrbanEdits } from '../../../rust/bridge/urbanConfig';
import type { PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';
import type { UrbanSiteVisual } from '../ui/urbanSiteStore';
import { quarterEditKey } from '../../../rust/bridge/urbanQuarterEdits';
import { BLOCK_POSITION_KEY, blockEditId, blockPositions, inputBlocks } from '../../../rust/bridge/urbanBlockEdits';
import { isMassingEdit, type HouseEditConfig } from '../../../rust/bridge/urbanHouseEdits';
import type { V2Settings } from './contracts';

/** Blocks of a town by layout key (`Partition.key`), as `parcels[].block` indexes them. */
export type TownBlocks = Map<string, Set<number>>;

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(key => [key, v[key]]),
        )
      : v,
  );
const changedKeys = (before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): string[] => [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(id => stable(before?.[id]) !== stable(after?.[id]));
const add = (blocks: TownBlocks, layout: string, block: number): void => {
  let set = blocks.get(layout);
  if (!set) blocks.set(layout, (set = new Set()));
  set.add(block);
};
export const blockCount = (blocks: TownBlocks): number => [...blocks.values()].reduce((n, set) => n + set.size, 0);

/** Owner block of every cadastral parcel id. */
function parcelOwners(partitions: readonly Partition[]): Map<string, [string, number]> {
  const owners = new Map<string, [string, number]>();
  for (const partition of partitions) for (const parcel of partition.parcels) if (parcel.id) owners.set(parcel.id, [partition.key, parcel.block]);
  return owners;
}
/** A split part `<id>/part-<k>` belongs to the block of its source lot. */
const ownerOf = (owners: Map<string, [string, number]>, id: string): [string, number] | undefined => owners.get(id) ?? owners.get(id.replace(/\/part-\d+$/, ''));

/** Quarter edit fields the plan never reads (Rust `edits::plan_fields`): they reach the quarter's lots (zone), building
 * sites and houses on the retained streets and blocks. */
const QUARTER_LATE_FIELDS = ['buildingCulture', 'houseConfig', 'zone'] as const;
export type QuarterLate = Record<string, Pick<QuarterOverride, (typeof QUARTER_LATE_FIELDS)[number]>>;
const pick = <T extends object>(entries: Record<string, T> | undefined, keep: (field: string) => boolean): Record<string, Partial<T>> =>
  Object.fromEntries(Object.entries(entries ?? {}).flatMap(([id, edit]) => {
    const kept = Object.fromEntries(Object.entries(edit).filter(([field, value]) => keep(field) && value !== undefined));
    return Object.keys(kept).length ? [[id, kept as Partial<T>]] : [];
  }));
const late = (field: string): boolean => (QUARTER_LATE_FIELDS as readonly string[]).includes(field);
/** The layout config the plan reads (its key), and the quarter fields it does not. A split quarter keeps every field in
 * the plan (its parts inherit them there): `late` is then undefined. */
export function splitQuarterEdits(layout: LayoutConfig): { plan: LayoutConfig; late?: QuarterLate } {
  const quarters = layout.overrides?.quarters;
  if (!quarters || Object.entries(quarters).some(([id, edit]) => id.includes('/') || edit.parts)) return { plan: layout };
  const plan = pick(quarters, field => !late(field));
  return { plan: { ...layout, overrides: { ...layout.overrides, quarters: plan } }, late: pick(quarters, late) as QuarterLate };
}
/** Retained layouts with the late quarter fields of the current edits in their config (the stages after the plan read
 * them there); a layout already up to date is returned as is. */
export function withQuarterLate(layouts: Layout[], fields: QuarterLate): Layout[] {
  return layouts.map(layout => {
    if (!layout.config) return layout;
    const own = layout.config.overrides?.quarters,
      plan = pick(own, field => !late(field)) as Record<string, QuarterOverride>;
    const quarters = Object.fromEntries([...new Set([...Object.keys(plan), ...Object.keys(fields)])].map(id => [id, { ...plan[id], ...fields[id] }]));
    return stable(quarters) === stable(own ?? {}) ? layout : { ...layout, config: { ...layout.config, overrides: { ...layout.config.overrides, quarters } } };
  });
}
/** One late field of every edited quarter. */
export const quarterField = <F extends keyof QuarterLate[string]>(fields: QuarterLate | undefined, field: F): Record<string, QuarterLate[string][F]> | undefined =>
  fields && Object.fromEntries(Object.entries(fields).flatMap(([id, edit]) => (edit[field] === undefined ? [] : [[id, edit[field]]])));
/** Blocks of the quarters (edit keys) whose value changed between two maps; undefined when one side is unknown. */
export function quarterEditBlocks(layouts: readonly Layout[], before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): TownBlocks | undefined {
  if (!before || !after) return stable(before) === stable(after) ? new Map() : undefined;
  const blocks: TownBlocks = new Map();
  for (const id of changedKeys(before, after)) addQuarter(blocks, layouts, id);
  return blocks;
}
/** Adds the blocks of quarter `id` (its edit key) of these layouts. */
export const addQuarter = (blocks: TownBlocks, layouts: readonly Layout[], id: string): void => {
  for (const layout of layouts) {
    const quarters = new Set(layout.quarters.flatMap((_, index) => (quarterEditKey(layout, index) === id ? [index] : [])));
    layout.blocks.forEach((block, index) => quarters.has(block.quarter) && add(blocks, layout.key, index));
  }
};
export { add as addBlock };
/** Union of block sets (undefined when one is). */
export function unionBlocks(...sets: (TownBlocks | undefined)[]): TownBlocks | undefined {
  const blocks: TownBlocks = new Map();
  for (const set of sets) {
    if (!set) return;
    for (const [layout, own] of set) own.forEach(block => add(blocks, layout, block));
  }
  return blocks;
}

/** Blocks whose lots depend on the parcel/block overrides that changed between two runtime configurations
 * (`runtimeBlockEdits` keys). Undefined when an edit reshapes the block list (shape, parts, deletion of a block)
 * or names a lot the retained cadastre does not hold: the whole cadastre is then recut. Fence kinds are drawn
 * on the retained yards and never reach the engine. */
export function parcelEditBlocks(layouts: readonly Layout[], partitions: readonly Partition[], before: UrbanEdits | undefined, after: UrbanEdits | undefined): TownBlocks | undefined {
  const blocks: TownBlocks = new Map(),
    layout = layouts[0];
  for (const id of changedKeys(before?.blocks, after?.blocks)) {
    const edits = [before?.blocks?.[id], after?.blocks?.[id]];
    if (!layout || !/^\d+$/.test(id) || edits.some(edit => edit && (edit.shape || edit.parts || edit.deleted !== undefined || edit.deletedParts?.length))) return;
    add(blocks, layout.key, Number(id));
  }
  const unfenced = (edits: UrbanEdits['parcels']): Record<string, unknown> | undefined => edits && Object.fromEntries(Object.entries(edits).map(([id, { enclosure: _enclosure, ...edit }]) => [id, edit]));
  const owners = parcelOwners(partitions);
  for (const id of changedKeys(unfenced(before?.parcels), unfenced(after?.parcels))) {
    const owner = ownerOf(owners, id);
    if (!owner) return;
    add(blocks, ...owner);
  }
  return blocks;
}

/** Blocks whose building sites read an architecture scope that changed between two profiles (quarter, block, lot,
 * building cultures and massing edits). Undefined when anything else in the profile changed: every site reads it. */
export function profileEditBlocks(layouts: readonly Layout[], partitions: readonly Partition[], sites: readonly UrbanSiteVisual[], before: PlacementBatchSettings | undefined, after: PlacementBatchSettings): TownBlocks | undefined {
  return profileEditScope(layouts, partitions, sites, before, after)?.blocks;
}
/** Lots of the given blocks. */
export function blockLots(partitions: readonly Partition[], blocks: TownBlocks): Set<string> {
  const lots = new Set<string>();
  for (const partition of partitions) {
    const own = blocks.get(partition.key);
    if (own) for (const parcel of partition.parcels) if (parcel.id && own.has(parcel.block)) lots.add(parcel.id);
  }
  return lots;
}
/** A style edit's scope: the blocks whose sites the stage must run on, and the lots whose sites it replaces. */
export type SiteScope = { blocks: TownBlocks; lots: Set<string> };
/** `profileEditBlocks` with the lots it reaches: a quarter or block scope takes every lot of its blocks, a lot or
 * building scope (culture, massing) that lot alone, so the other sites of its block keep their retained objects. */
export function profileEditScope(layouts: readonly Layout[], partitions: readonly Partition[], sites: readonly UrbanSiteVisual[], before: PlacementBatchSettings | undefined, after: PlacementBatchSettings): SiteScope | undefined {
  if (!before) return;
  const scopes = ['quarters', 'blocks', 'parcels', 'buildings', 'massing'] as const;
  const general = (settings: PlacementBatchSettings) => ({ ...settings, houses: settings.houses && Object.fromEntries(Object.entries(settings.houses).filter(([name]) => !(scopes as readonly string[]).includes(name))) });
  if (stable(general(before)) !== stable(general(after))) return;
  const blocks: TownBlocks = new Map(),
    whole: TownBlocks = new Map(),
    lots = new Set<string>(),
    owners = parcelOwners(partitions),
    siteParcels = new Map(sites.map(site => [site.id, site.parcel_id]));
  const quarter = (id: string): boolean => {
    addQuarter(whole, layouts, id);
    return true;
  };
  const block = (id: string): boolean => {
    const layout = layouts[0];
    if (!layout) return false;
    const origins = (layout.config?.blockEdits?.origins ?? []).filter(origin => `${origin.source}${origin.part ? `/${origin.part}` : ''}` === id);
    if (origins.length) origins.forEach(origin => add(whole, layout.key, origin.block));
    else if (/^\d+$/.test(id)) add(whole, layout.key, Number(id));
    else return false;
    return true;
  };
  const parcel = (id: string): boolean => {
    const owner = ownerOf(owners, id);
    if (owner) {
      add(blocks, ...owner);
      lots.add(id);
    }
    return !!owner;
  };
  const building = (id: string): boolean => {
    const lot = siteParcels.get(id);
    return lot !== undefined && parcel(lot);
  };
  const resolve: Record<(typeof scopes)[number], (id: string) => boolean> = {
    quarters: quarter,
    blocks: block,
    parcels: parcel,
    buildings: building,
    // `q:`, `block:`, `p:`, `b:` keys of `localArchitectureSettings`.
    massing: id => {
      const colon = id.indexOf(':'),
        scope = id.slice(0, colon),
        rest = id.slice(colon + 1);
      return scope === 'q' ? quarter(rest) : scope === 'block' ? block(rest) : scope === 'p' ? parcel(rest) : scope === 'b' && building(rest);
    },
  };
  for (const scope of scopes) for (const id of changedKeys(before.houses?.[scope] as Record<string, unknown> | undefined, after.houses?.[scope] as Record<string, unknown> | undefined)) if (!resolve[scope](id)) return;
  blockLots(partitions, whole).forEach(lot => lots.add(lot));
  return { blocks: unionBlocks(blocks, whole)!, lots };
}
/** Scope of a site style edit: architecture profile, quarter house settings and city-volume seeds (`siteSeeds`). */
export function styleEditScope(
  layouts: readonly Layout[],
  partitions: readonly Partition[],
  sites: readonly UrbanSiteVisual[],
  before: { profile?: PlacementBatchSettings; quarterHouses?: Record<string, unknown>; seeds?: Record<string, string> },
  after: { profile: PlacementBatchSettings; quarterHouses?: Record<string, unknown>; seeds: Record<string, string> },
): SiteScope | undefined {
  const profile = profileEditScope(layouts, partitions, sites, before.profile, after.profile),
    quarters = quarterEditBlocks(layouts, before.quarterHouses, after.quarterHouses);
  if (!profile || !quarters) return;
  const owners = parcelOwners(partitions),
    lots = new Set([...profile.lots, ...blockLots(partitions, quarters)]),
    blocks = unionBlocks(profile.blocks, quarters)!;
  for (const id of changedKeys(before.seeds, after.seeds)) {
    const lot = siteParcel(sites, id),
      owner = ownerOf(owners, lot);
    if (!owner) return;
    add(blocks, ...owner);
    lots.add(lot);
  }
  return { blocks, lots };
}
/** Lot of a building site: its retained site, else its id (`<lot>/building`). */
export const siteParcel = (sites: readonly Pick<UrbanSiteVisual, 'id' | 'parcel_id'>[] | undefined, id: string): string => sites?.find(site => site.id === id)?.parcel_id ?? id.replace(/\/[^/]*$/, '');

/** House reroll of the city volumes: the building seeds of the edits that the volumes can take (a seed with at most a
 * culture and a roof/storey edit), by site id. */
export function siteSeedsOf(edits: Record<string, HouseEditConfig>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(edits).flatMap(([id, edit]) => {
      if (edit.seed === undefined || edit.seed === null || edit.seed === '') return [];
      const { seed, culture: _culture, ...shape } = edit;
      return !Object.keys(shape).length || isMassingEdit(shape) ? [[id, String(seed)]] : [];
    }),
  );
}
/** 32-bit lot salt (> 0) of a building seed, mixed with the lot's own salt. */
function seedSalt(seed: string, own: number | undefined): number {
  const text = `${own ?? 0}/${seed}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return (h % 0xffffffff) + 1;
}
/** Partitions of a building-sites request with the city-volume seeds applied: the stage reseeds a lot's site from its
 * salt (`edits::building_seed`), which the request alone carries (never saved, never read by the programme). Returns
 * the same array when no lot of these partitions is reseeded. */
export function withSiteSeeds(partitions: Partition[], seeds: Record<string, string>, sites: readonly Pick<UrbanSiteVisual, 'id' | 'parcel_id'>[] | undefined, fallback: Partition['config']): Partition[] {
  const ids = Object.keys(seeds);
  if (!ids.length) return partitions;
  const byLot = new Map(ids.map(id => [siteParcel(sites, id), seeds[id]]));
  let changed = false;
  const out = partitions.map(partition => {
    const own = partition.parcels.filter(parcel => parcel.id && byLot.has(parcel.id));
    const config = partition.config ?? fallback;
    if (!own.length || !config) return partition;
    changed = true;
    const parcels = { ...config.overrides?.parcels };
    for (const { id } of own) parcels[id!] = { ...parcels[id!], salt: seedSalt(byLot.get(id!)!, parcels[id!]?.salt) };
    return { ...partition, config: { ...config, overrides: { ...config.overrides, parcels } } };
  });
  return changed ? out : partitions;
}

/** Partitions restricted to the lots of the given blocks, with their allocations and party-wall adjacency: the building
 * sites of these blocks, generated alone, read the same lot, tissue and neighbours as in the whole town. */
export function blockPartitions(partitions: readonly Partition[], blocks: TownBlocks): Partition[] {
  return partitions.map(partition => {
    const own = blocks.get(partition.key),
      parcels = own ? partition.parcels.filter(parcel => own.has(parcel.block)) : [],
      ids = new Set(parcels.map(parcel => parcel.id));
    const programme = partition.programme && { ...partition.programme, allocations: partition.programme.allocations.filter(a => ids.has(a.parcelId)), adjacency: partition.programme.adjacency.filter(a => ids.has(a.a) && ids.has(a.b)) };
    return { ...partition, parcels, programme, diagnostics: undefined };
  });
}
/** Blocks of the given sites (their lots' owners). */
export function siteBlocks(partitions: readonly Partition[], sites: readonly Pick<UrbanSiteVisual, 'parcel_id'>[]): TownBlocks {
  const owners = parcelOwners(partitions),
    blocks: TownBlocks = new Map();
  for (const site of sites) {
    const owner = ownerOf(owners, site.parcel_id);
    if (owner) add(blocks, ...owner);
  }
  return blocks;
}
/** Retained site list with the regenerated sites of some lots in place (same order and offsets); a site the lots no
 * longer carry is dropped, a new one is appended. */
export function mergeSites<T extends { id: string; parcel_id: string }>(old: readonly T[], fresh: readonly T[], parcels: ReadonlySet<string>, place: (site: T, previous: T | undefined, index: number) => T = site => site): T[] {
  const byId = new Map(fresh.map(site => [site.id, site])),
    kept = new Set<string>();
  const merged = old.flatMap((site, index) => {
    const next = byId.get(site.id);
    if (next) kept.add(site.id);
    return next ? [place(next, site, index)] : parcels.has(site.parcel_id) ? [] : [site];
  });
  for (const site of fresh) if (!kept.has(site.id)) merged.push(place(site, undefined, merged.length));
  return merged;
}

/** Settings of a scoped block regeneration: the town's lot edits restricted to the lots of these blocks (the others
 * are not in the sub-layout), and block edits saved by position (`block:<quarter>.<rank>`) named by geometry, since
 * ranks change in the sub-layout. */
export function scopedBlockSettings(settings: V2Settings, key: string, partitions: readonly Partition[], blocks: TownBlocks, layouts: readonly Layout[]): V2Settings {
  const local = settings.urban?.local?.[key],
    overrides = local?.parcels?.overrides;
  if (!settings.urban || !local || !overrides) return settings;
  const owners = parcelOwners(partitions),
    layout = layouts[0];
  const owned = (id: string): boolean => {
    const owner = ownerOf(owners, id);
    return !!owner && !!blocks.get(owner[0])?.has(owner[1]);
  };
  const positions = layout ? blockPositions(layout) : [];
  const named = (id: string): string => {
    const match = BLOCK_POSITION_KEY.exec(id),
      index = match ? positions.findIndex(([quarter, rank]) => quarter === Number(match[1]) && rank === Number(match[2])) : -1;
    return index < 0 || !layout ? id : blockEditId(layout, inputBlocks(layout)[index].shape);
  };
  const parcels = overrides.parcels && Object.fromEntries(Object.entries(overrides.parcels).filter(([id]) => owned(id)));
  const blockEdits = overrides.blocks && Object.fromEntries(Object.entries(overrides.blocks).map(([id, edit]) => [named(id), edit]));
  return { ...settings, urban: { ...settings.urban, local: { ...settings.urban.local, [key]: { ...local, parcels: { ...local.parcels, overrides: { ...overrides, ...(parcels ? { parcels } : {}), ...(blockEdits ? { blocks: blockEdits } : {}) } } } } } };
}
