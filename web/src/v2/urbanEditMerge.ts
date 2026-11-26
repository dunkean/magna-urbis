/**
 * Local edit invariant: editing a house, lot, block or quarter changes only that element and the buildings on it.
 * Whatever the engine had to recompute for the edit, the town keeps the previous snapshot's objects outside the edit's
 * target (lots, allocations, sites, requests, buildings, open spaces, streets, blocks) and takes only the target from
 * the fresh result. The display and the page interning then see the same objects for everything else.
 */
import type { Layout, Partition, UrbanProgramme } from '../../../rust/bridge/urban';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { RustTownSnapshot } from './rustUrban';
import { addBlock, addQuarter, blockCount, siteParcel, type TownBlocks } from './urbanEditScope';

/** The local edits a town snapshot was generated with (fingerprints by id), and the fingerprint of every other input. */
export interface TownEditState {
  rest: string;
  quarters: Record<string, string>;
  /** Runtime block edits (`runtimeBlockEdits` keys). */
  blocks: Record<string, string>;
  parcels: Record<string, string>;
  /** Lots whose edit reshapes them (outline, split, deletion). */
  reshaped: string[];
  buildings: Record<string, string>;
}
export interface EditTarget {
  blocks: TownBlocks;
  parcels: Set<string>;
  reshaped: Set<string>;
}

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(key => [key, v[key]]),
        )
      : v,
  ) ?? '';
const prints = (entries: Record<string, unknown> | undefined): Record<string, string> => Object.fromEntries(Object.entries(entries ?? {}).map(([id, value]) => [id, stable(value)]));
const changed = (before: Record<string, string>, after: Record<string, string>): string[] => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => before[id] !== after[id]);

export function townEditState(rest: string, edits: { quarters?: Record<string, unknown>; blocks?: Record<string, unknown>; parcels?: Record<string, { shape?: unknown; parts?: unknown; deleted?: unknown }>; buildings?: Record<string, unknown> }): TownEditState {
  return { rest, quarters: prints(edits.quarters), blocks: prints(edits.blocks), parcels: prints(edits.parcels), reshaped: Object.entries(edits.parcels ?? {}).flatMap(([id, edit]) => (edit.shape || edit.parts || edit.deleted ? [id] : [])), buildings: prints(edits.buildings) };
}

/** Elements a local edit targets, from the edits of two runs; undefined when anything else changed (the whole result
 * then stands) or when an edit cannot be placed on the retained blocks. */
export function editTarget(before: TownEditState | undefined, after: TownEditState, layouts: readonly (readonly Layout[])[], sites: readonly (readonly { id: string; parcel_id: string }[] | undefined)[]): EditTarget | undefined {
  if (!before || before.rest !== after.rest) return;
  const target: EditTarget = { blocks: new Map(), parcels: new Set(), reshaped: new Set() };
  for (const id of changed(before.quarters, after.quarters)) for (const own of layouts) addQuarter(target.blocks, own, id);
  for (const id of changed(before.blocks, after.blocks)) {
    if (!/^\d+$/.test(id)) return;
    for (const own of layouts) if (own[0]) addBlock(target.blocks, own[0].key, Number(id));
  }
  for (const id of changed(before.parcels, after.parcels)) {
    target.parcels.add(id);
    if (before.reshaped.includes(id) || after.reshaped.includes(id)) target.reshaped.add(id);
  }
  for (const id of changed(before.buildings, after.buildings))
    target.parcels.add(
      siteParcel(
        sites.find(list => list?.some(site => site.id === id)),
        id,
      ),
    );
  return blockCount(target.blocks) || target.parcels.size ? target : undefined;
}

/** Deep equality, numbers within `eps` (1 mm for geometry checks, 0 for identity reuse). */
function near(a: unknown, b: unknown, eps = 1e-3): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    const x = a as unknown as ArrayLike<number>,
      y = b as unknown as ArrayLike<number>;
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > eps) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  const kx = Object.keys(x).filter(k => x[k] !== undefined),
    ky = Object.keys(y).filter(k => y[k] !== undefined);
  return kx.length === ky.length && kx.every(k => near(x[k], y[k], eps));
}
const exact = (a: unknown, b: unknown): boolean => near(a, b, 0);

/** `old` with the items of the target groups taken from `next`, in place (first position of their group), new target
 * groups appended; items outside the target keep their `old` objects, and a target item equal to its predecessor
 * keeps it too (`same`). Returns `old` itself when nothing changed. */
export function spliceByGroup<T>(old: readonly T[], next: readonly T[], group: (item: T) => string, inTarget: (group: string) => boolean, same?: (a: T, b: T) => boolean): T[] {
  const fresh = new Map<string, T[]>(),
    previous = new Map<string, T[]>();
  for (const item of next) {
    const g = group(item);
    if (inTarget(g)) fresh.set(g, [...(fresh.get(g) ?? []), item]);
  }
  for (const item of old) {
    const g = group(item);
    if (inTarget(g)) previous.set(g, [...(previous.get(g) ?? []), item]);
  }
  const placed = new Set<string>(),
    out: T[] = [];
  const put = (g: string): void => {
    placed.add(g);
    const was = previous.get(g) ?? [];
    (fresh.get(g) ?? []).forEach((item, k) => out.push(same && was[k] !== undefined && same(was[k], item) ? was[k] : item));
  };
  for (const item of old) {
    const g = group(item);
    if (!inTarget(g)) out.push(item);
    else if (!placed.has(g)) put(g);
  }
  for (const g of fresh.keys()) if (!placed.has(g)) put(g);
  return out.length === old.length && out.every((item, i) => item === old[i]) ? (old as T[]) : out;
}

const blockGeometry = (block: Layout['blocks'][number] | undefined) => block && [block.shape, block.kind, block.quarter];
/** Retained layouts with the fresh target blocks and quarters, or why they cannot be kept (geometry changed outside). */
function mergeLayouts(previous: Layout[], fresh: Layout[], blocks: TownBlocks): Layout[] | string {
  if (previous === fresh) return previous;
  if (previous.length !== fresh.length) return 'the plan has another number of layouts';
  const out: Layout[] = [];
  for (let n = 0; n < fresh.length; n++) {
    const old = previous[n],
      now = fresh[n];
    if (old === now) {
      out.push(old);
      continue;
    }
    if (old.key !== now.key || old.blocks.length !== now.blocks.length || old.quarters.length !== now.quarters.length) return 'the blocks or quarters were recomposed';
    const own = blocks.get(old.key) ?? new Set<number>(),
      quarters = new Set([...own].flatMap(b => [old.blocks[b]?.quarter, now.blocks[b]?.quarter]));
    const streetGeometry = (streets: Layout['streets']) => streets.map(street => [street.path, street.widths, street.rank, street.role]);
    if (old.streets !== now.streets && !near(streetGeometry(old.streets), streetGeometry(now.streets))) return 'streets changed outside the edit';
    for (let b = 0; b < old.blocks.length; b++) if (!own.has(b) && !near(blockGeometry(old.blocks[b]), blockGeometry(now.blocks[b]))) return `block ${b} changed outside the edit`;
    for (let q = 0; q < old.quarters.length; q++) if (!quarters.has(q) && !near(old.quarters[q].shape, now.quarters[q].shape)) return `quarter ${q} changed outside the edit`;
    const merged: Layout = {
      ...now,
      streets: old.streets,
      blocks: now.blocks.map((block, b) => (!own.has(b) || exact(old.blocks[b], block) ? old.blocks[b] : block)),
      quarters: now.quarters.map((quarter, q) => (!quarters.has(q) || exact(old.quarters[q], quarter) ? old.quarters[q] : quarter)),
    };
    out.push(exact(old, merged) ? old : merged);
  }
  return out.every((layout, i) => layout === previous[i]) ? previous : out;
}

function mergeProgramme(old: UrbanProgramme | undefined, now: UrbanProgramme | undefined, lots: Set<string>, blocks: Set<number> | undefined): UrbanProgramme | undefined {
  if (!old || !now || old === now) return now;
  // A programme without allocations (an engine reply that only carries demands) has nothing to merge.
  if (!old.allocations || !now.allocations) return now;
  const allocations = spliceByGroup(
    old.allocations,
    now.allocations,
    a => a.parcelId,
    id => lots.has(id),
    exact,
  );
  const own = (block: number): boolean => !!blocks?.has(block);
  const adjacency = [...old.adjacency.filter(a => !lots.has(a.a) && !lots.has(a.b)), ...now.adjacency.filter(a => lots.has(a.a) || lots.has(a.b))];
  // The engine reads the environment by block index.
  const environment = now.environment.map((entry, i) => (own(entry.block) || old.environment[i]?.block !== entry.block ? entry : old.environment[i]));
  const reservations = [...old.reservations.filter(r => !own(r.block)), ...now.reservations.filter(r => own(r.block))];
  // Demand totals follow the merged allocations; no other allocation changes.
  const capacity = (list: UrbanProgramme['allocations'], id: string): number => list.reduce((n, a) => (a.demandId === id ? n + a.capacity : n), 0);
  const known = new Set(now.demands.map(d => d.id));
  const demands = [
    ...now.demands.map(d => {
      const delta = capacity(allocations, d.id) - capacity(now.allocations, d.id);
      if (Math.abs(delta) < 1e-9) return d;
      const parcelCapacity = Math.max(0, d.parcelCapacity + delta);
      return { ...d, parcelCapacity, deficit: Math.max(0, d.requested - parcelCapacity) };
    }),
    ...old.demands.filter(d => !known.has(d.id) && allocations.some(a => a.demandId === d.id)),
  ];
  return { ...now, allocations, adjacency, environment, reservations, demands };
}

function mergePartitions(previous: Partition[] | undefined, fresh: Partition[] | undefined, lots: Set<string>, blocks: TownBlocks): Partition[] | undefined {
  // Engine-held markers (empty) and differently keyed lists are not merged.
  if (!previous || !fresh || previous === fresh || previous.length !== fresh.length || !fresh.length) return fresh;
  return fresh.map(now => {
    const old = previous.find(partition => partition.key === now.key);
    if (!old || old === now) return now;
    const parcels = spliceByGroup(
      old.parcels,
      now.parcels,
      parcel => parcel.id ?? '',
      id => lots.has(id),
      exact,
    );
    return { ...now, parcels, programme: mergeProgramme(old.programme, now.programme, lots, blocks.get(now.key)) };
  });
}

function mergeScene(old: PlacementBatch | undefined, now: PlacementBatch | undefined, lots: Set<string>): PlacementBatch | undefined {
  if (!old || !now || old === now) return now;
  const inTarget = (id: string): boolean => lots.has(id);
  const materials = new Map((old.materials ?? []).map(material => [material.id, material]));
  for (const material of now.materials ?? []) if (!materials.has(material.id)) materials.set(material.id, material);
  const archives = old.plan_archives || now.plan_archives ? { ...old.plan_archives, ...now.plan_archives } : undefined;
  return {
    ...now,
    buildings: spliceByGroup(old.buildings, now.buildings, b => b.parcel_id, inTarget),
    refusals: spliceByGroup(old.refusals, now.refusals, r => r.parcel_id, inTarget),
    open_spaces: spliceByGroup(old.open_spaces, now.open_spaces, s => s.parcel_id, inTarget),
    materials: [...materials.values()],
    ...(archives ? { plan_archives: archives } : {}),
  };
}

/** Lots a target covers on both sides: its lots and their split parts, every lot of its blocks, and for a reshaped
 * lot the lots of its block whose outline changed (the neighbours that gave up or took back ground). */
function targetLots(previous: RustTownSnapshot, fresh: RustTownSnapshot, target: EditTarget): Set<string> {
  const lots = new Set(target.parcels),
    source = (id: string): string => id.replace(/\/part-\d+$/, '');
  const lists = [previous.partitions, fresh.partitions, previous.cadastralPartitions, fresh.cadastralPartitions, previous.programmePartitions, fresh.programmePartitions];
  for (const list of lists) for (const partition of list ?? []) for (const parcel of partition.parcels) if (parcel.id && (target.blocks.get(partition.key)?.has(parcel.block) || target.parcels.has(source(parcel.id)))) lots.add(parcel.id);
  if (target.reshaped.size) {
    type Lot = { block: string; shape: unknown };
    const index = (list: Partition[] | undefined): Map<string, Lot> => new Map((list ?? []).flatMap(partition => partition.parcels.flatMap(parcel => (parcel.id ? [[parcel.id, { block: `${partition.key}:${parcel.block}`, shape: parcel.shape }] as const] : []))));
    const before = index(previous.cadastralPartitions ?? previous.partitions),
      after = index(fresh.cadastralPartitions ?? fresh.partitions);
    const blocks = new Set([...lots].flatMap(id => (target.reshaped.has(source(id)) ? [before.get(id)?.block, after.get(id)?.block] : [])));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(id),
        b = after.get(id);
      if ((blocks.has(a?.block) || blocks.has(b?.block)) && (!a || !b || !near(a.shape, b.shape))) lots.add(id);
    }
  }
  return lots;
}

/** Resolve block identity before scoping any later work. Reuse this decision when installing the delta. */
export function retainedEditLayouts(previous: RustTownSnapshot, fresh: RustTownSnapshot, target: EditTarget): Layout[] | string {
  const structural = (s: RustTownSnapshot): boolean => s.layouts.some(layout => layout.config?.blockEdits) || [s.partitions, s.cadastralPartitions, s.programmePartitions].some(list => list?.some(partition => partition.prepared));
  if (structural(previous) || structural(fresh)) return 'structural block edits re-index the blocks';
  return mergeLayouts(previous.layouts, fresh.layouts, target.blocks);
}

/** Keep the previous objects outside the target, or the full result when the plan changed outside it. */
export function mergeEditTarget(previous: RustTownSnapshot, fresh: RustTownSnapshot, target: EditTarget, layouts = retainedEditLayouts(previous, fresh, target)): { snapshot: RustTownSnapshot; lots?: Set<string>; reason?: string } {
  if (typeof layouts === 'string') return { snapshot: fresh, reason: layouts };
  const lots = targetLots(previous, fresh, target);
  const sites =
    previous.sites && fresh.sites
      ? spliceByGroup(
          previous.sites,
          fresh.sites,
          site => site.parcel_id,
          id => lots.has(id),
          exact,
        )
      : fresh.sites;
  const baseline =
    previous.houseBaseline && fresh.houseBaseline
      ? {
          key: fresh.houseBaseline.key,
          originals: { ...Object.fromEntries(Object.entries(previous.houseBaseline.originals).filter(([, original]) => !lots.has(original.parcelId))), ...Object.fromEntries(Object.entries(fresh.houseBaseline.originals).filter(([, original]) => lots.has(original.parcelId))) },
        }
      : fresh.houseBaseline;
  const snapshot: RustTownSnapshot = {
    ...fresh,
    layouts,
    compositionLayouts: fresh.compositionLayouts === fresh.layouts ? layouts : fresh.compositionLayouts,
    roadSources: previous.roadSources && fresh.roadSources && near(previous.roadSources, fresh.roadSources, 0) ? previous.roadSources : fresh.roadSources,
    partitions: mergePartitions(previous.partitions, fresh.partitions, lots, target.blocks),
    cadastralPartitions: mergePartitions(previous.cadastralPartitions, fresh.cadastralPartitions, lots, target.blocks),
    programmePartitions: mergePartitions(previous.programmePartitions, fresh.programmePartitions, lots, target.blocks),
    sites,
    // Site offsets belong to the engine run that produced them. A merged list keeps its display objects and has no native query.
    siteQuery: sites === fresh.sites ? fresh.siteQuery : undefined,
    requests:
      previous.requests && fresh.requests
        ? spliceByGroup(
            previous.requests,
            fresh.requests,
            request => request.parcel_id,
            id => lots.has(id),
          )
        : fresh.requests,
    scene: mergeScene(previous.scene, fresh.scene, lots),
    houseBaseline: baseline,
  };
  return { snapshot, lots };
}
