/** The local-edit reply is relative to the exact base of the request. Kept ranges name that base's array objects
 * by index. The worker owns the comparison; the page only materialises changed records and splices references. */
import type { Settlement, World } from '../gen/types';
import type { RustTownSnapshot } from './rustUrban';
import type { Partition } from '../../../rust/bridge/urban';
import { packOf, partitionsFromPack } from '../../../rust/bridge/urbanParcelPack';
import { decodeCitySiteVisuals, siteVisualsPackOf } from '../render/cityDisplayBuffers';
import { siteVisualScene, siteVisualSceneSource } from '../ui/urbanSilhouettes';
import { nativeCityRecords } from './nativeProducts';
import { editedTownRegions, rememberLocalEditRegions, type EditRect } from './localEditRegion';

type Entries = [string, Patch][];
type Patch = { value: unknown } | { fields: Entries; removed: string[] } | { length: number; kept: number[]; items: [index: number, old: number, patch: Patch][]; siteRecords?: ArrayBuffer } | { partitions: ArrayBuffer } | { sites: ArrayBuffer };
type Products = Pick<World, 'names' | 'stats' | 'bridges'> & {
  settlement?: Settlement;
  /** A separate legacy projection, when the main settlement's layer is not world.urban. */
  urban?: World['urban'];
  townBridges?: World['bridges'];
  snapshot?: RustTownSnapshot;
};

export interface LocalEditDelta {
  key: string;
  products?: Patch;
  mainUrban: 'kept' | 'settlement' | 'separate';
  sceneFromSites: boolean;
  /** Undefined when the changed area requires full render products. */
  rects?: readonly EditRect[];
}

function products(world: World, key: string, mainUrban: LocalEditDelta['mainUrban'], sceneFromSites: boolean): Products {
  const snapshot = nativeCityRecords(world)?.[key];
  return {
    settlement: world.settlements?.find(place => place.key === key),
    urban: mainUrban === 'separate' ? world.urban : undefined,
    snapshot: snapshot && sceneFromSites ? { ...snapshot, scene: undefined } : snapshot,
    townBridges: (world.debug?.v2TownBridges as Record<string, World['bridges']> | undefined)?.[key],
    bridges: world.bridges,
    stats: world.stats,
    names: world.names,
  };
}

const plain = (value: unknown): value is Record<string, unknown> => !!value && Object.getPrototypeOf(value) === Object.prototype;
const idOf = (value: unknown): unknown => (plain(value) ? (value.id ?? value.nativeId ?? value.key) : undefined);
type Transfer = { buffers: ArrayBuffer[]; copies: Map<ArrayBuffer, ArrayBuffer> };
function copyPack(source: ArrayBuffer, transfer: Transfer): ArrayBuffer {
  let copy = transfer.copies.get(source);
  if (!copy) {
    copy = source.slice(0);
    transfer.copies.set(source, copy);
    transfer.buffers.push(copy);
  }
  return copy;
}

function difference(old: unknown, next: unknown, transfer: Transfer, field?: string): Patch | undefined {
  if (Object.is(old, next)) return;
  if (Array.isArray(next)) {
    if (field === 'sites') {
      const source = siteVisualsPackOf(next);
      if (source) return { sites: copyPack(source, transfer) };
    }
    const pack = packOf(next as Partition[]);
    if (pack) return { partitions: copyPack(pack, transfer) };
    if (Array.isArray(old) || field === 'sites') return arrayDifference(Array.isArray(old) ? old : [], next, transfer, field === 'sites');
  }
  if (plain(next) && (plain(old) || field === 'snapshot')) {
    const before = plain(old) ? old : {};
    const removed = Object.keys(before).filter(key => !Object.hasOwn(next, key));
    const fields: Entries = [];
    for (const [key, value] of Object.entries(next)) {
      const patch = Object.hasOwn(before, key) ? difference(before[key], value, transfer, key) : (difference(undefined, value, transfer, key) ?? { value });
      if (patch) fields.push([key, patch]);
    }
    if (fields.length || removed.length) return { fields, removed };
    return;
  }
  // Typed data and wholly new products travel as values. An unchanged typed buffer was handled by identity above.
  return { value: next };
}

function arrayDifference(old: unknown[], next: unknown[], transfer: Transfer, sites: boolean): Patch | undefined {
  const kept: number[] = [];
  const items: [number, number, Patch][] = [];
  const siteRecords: unknown[] = [];
  let identities: Map<unknown, number> | undefined;
  let ids: Map<unknown, number> | undefined;
  const find = (value: unknown, i: number): number => {
    if (i < old.length && Object.is(old[i], value)) return i;
    const id = idOf(value);
    if (id === undefined && (typeof value !== 'object' || value === null)) return i < old.length ? i : -1;
    if (i < old.length && idOf(old[i]) === id && (!id || old.length === next.length)) return i;
    identities ??= new Map(old.map((entry, at) => [entry, at]));
    const same = identities.get(value);
    if (same !== undefined) return same;
    if (id === undefined) return i < old.length ? i : -1;
    if (!ids) {
      ids = new Map();
      old.forEach((entry, at) => {
        const key = idOf(entry);
        // Some projections have more than one component with the same building ID.
        ids!.set(key, ids!.has(key) ? -1 : at);
      });
    }
    return ids.get(id) ?? -1;
  };
  for (let i = 0; i < next.length; i++) {
    const value = next[i],
      from = find(value, i);
    const patch = from < 0 ? { value } : difference(old[from], value, transfer);
    if (patch) {
      if (sites && from < 0) {
        // Visuals from merged site arrays have no original whole-array buffer. Send just the new records as bytes.
        siteRecords.push(value);
        items.push([i, -1, { value: undefined }]);
      } else items.push([i, from, patch]);
    } else {
      const at = kept.length - 3;
      if (at >= 0 && kept[at] + kept[at + 2] === i && kept[at + 1] + kept[at + 2] === from) kept[at + 2]++;
      else kept.push(i, from, 1);
    }
  }
  if (!items.length && old.length === next.length && (!next.length || (kept.length === 3 && kept[1] === 0))) return;
  const bytes = siteRecords.length ? (new TextEncoder().encode(JSON.stringify(siteRecords)).buffer as ArrayBuffer) : undefined;
  if (bytes) transfer.buffers.push(bytes);
  return { length: next.length, kept, items, ...(bytes ? { siteRecords: bytes } : {}) };
}

function materialise(old: unknown, patch: Patch): unknown {
  if ('value' in patch) return patch.value;
  if ('partitions' in patch) return partitionsFromPack(patch.partitions);
  if ('sites' in patch) return decodeCitySiteVisuals(patch.sites);
  if ('fields' in patch) {
    const result = { ...(old as object | undefined) } as Record<string, unknown>;
    for (const key of patch.removed) delete result[key];
    for (const [key, child] of patch.fields) Object.defineProperty(result, key, { value: materialise(result[key], child), writable: true, enumerable: true, configurable: true });
    return result;
  }
  const before = Array.isArray(old) ? old : [],
    result = new Array<unknown>(patch.length);
  for (let r = 0; r < patch.kept.length; r += 3) {
    const [at, from, count] = [patch.kept[r], patch.kept[r + 1], patch.kept[r + 2]];
    for (let i = 0; i < count; i++) result[at + i] = before[from + i];
  }
  const sites = patch.siteRecords ? (JSON.parse(new TextDecoder().decode(patch.siteRecords)) as unknown[]) : undefined;
  let site = 0;
  for (const [at, from, child] of patch.items) result[at] = sites && from < 0 ? sites[site++] : materialise(before[from], child);
  return result;
}

/** Package only the edited town and its changed metadata. The worker retains the unpacked result. */
export function packLocalEdit(previous: World, next: World, key: string): { delta: LocalEditDelta; transfer: ArrayBuffer[] } {
  const place = next.settlements?.find(place => place.key === key);
  const mainUrban = next.urban === previous.urban ? 'kept' : next.urban === place?.urban ? 'settlement' : 'separate';
  const snapshot = nativeCityRecords(next)?.[key],
    sites = snapshot?.sites;
  const sceneFromSites = !!(snapshot?.scene && sites && sites !== nativeCityRecords(previous)?.[key]?.sites && siteVisualsPackOf(sites) && siteVisualSceneSource(snapshot.scene) === sites);
  const transfer: Transfer = { buffers: [], copies: new Map() };
  const patch = difference(products(previous, key, mainUrban, sceneFromSites), products(next, key, mainUrban, sceneFromSites), transfer);
  const rects = editedTownRegions(previous, next, key);
  return { delta: { key, products: patch, mainUrban, sceneFromSites, rects }, transfer: transfer.buffers };
}

export function internLocalEdit(previous: World, delta: LocalEditDelta): World {
  const base = products(previous, delta.key, delta.mainUrban, delta.sceneFromSites);
  const changed = delta.products ? (materialise(base, delta.products) as Products) : base;
  const { key } = delta;
  if (delta.sceneFromSites && changed.snapshot?.sites) changed.snapshot.scene = siteVisualScene(changed.snapshot.sites);
  let debug = previous.debug;
  if (changed.snapshot !== nativeCityRecords(previous)?.[key]) {
    const cities = { ...nativeCityRecords(previous) };
    if (changed.snapshot) cities[key] = changed.snapshot;
    else delete cities[key];
    debug = { ...debug, v2RustCities: cities };
  }
  if (changed.townBridges !== base.townBridges) {
    const townBridges = { ...(debug?.v2TownBridges as Record<string, World['bridges']> | undefined) };
    if (changed.townBridges) townBridges[key] = changed.townBridges;
    else delete townBridges[key];
    debug = { ...debug, v2TownBridges: townBridges };
  }
  const world: World = {
    ...previous,
    debug,
    names: changed.names,
    stats: changed.stats,
    bridges: changed.bridges,
    settlements: changed.settlement !== base.settlement ? previous.settlements?.map(place => (place.key === key ? changed.settlement! : place)) : previous.settlements,
    urban: delta.mainUrban === 'kept' ? previous.urban : delta.mainUrban === 'settlement' ? changed.settlement?.urban : changed.urban,
  };
  rememberLocalEditRegions(previous, world, delta.rects);
  return world;
}
