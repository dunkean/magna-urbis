import type { Block, Layout, Partition, Shape } from './urban';
import type { ParcelConfig } from './urbanConfig';

const identities = new WeakMap<Shape, Map<string, string>>();
/** Editor identity belongs to the retained geometry, never its movable array position. */
export function blockEditId(layout: Pick<Layout, 'key'>, shape: Shape): string {
  let keys = identities.get(shape);
  if (!keys) identities.set(shape, (keys = new Map()));
  const cached = keys.get(layout.key);
  if (cached) return cached;
  const canonical = (ring: Shape['outer']) => {
    const points = ring.map(p => `${Math.round(p.x * 10000)},${Math.round(p.y * 10000)}`);
    if (points.length > 1 && points[0] === points.at(-1)) points.pop();
    if (!points.length) return '';
    const first = [...points].sort()[0],
      candidates: string[] = [];
    for (let i = 0; i < points.length; i++)
      if (points[i] === first) {
        candidates.push([...points.slice(i), ...points.slice(0, i)].join(';'));
        candidates.push(Array.from({ length: points.length }, (_, j) => points[(i + points.length - j) % points.length]).join(';'));
      }
    return candidates.sort()[0];
  };
  let hash = 0xcbf29ce484222325n;
  const value = JSON.stringify([layout.key, canonical(shape.outer), shape.holes.map(canonical).sort()]);
  for (const byte of new TextEncoder().encode(value)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  const id = `block:${hash.toString(16).padStart(16, '0')}`;
  keys.set(layout.key, id);
  return id;
}
/** Blocks of the layout before any structural block edit (a prepared layout restored, as the parcel stage does). */
export function inputBlocks(layout: Layout): Block[] {
  const edits = layout.config?.blockEdits;
  if (!edits) return layout.blocks;
  const blocks = layout.blocks.slice(0, edits.count);
  for (const original of edits.originals) blocks[original.index] = original.block;
  return blocks;
}
/** Saved key of block `index` of a layout (prepared or not): `block:<hash>` of its input geometry, `/<k>` for part k ≥ 1
 * of a split block. An edit in `saved` under the block's position (opened share code) keeps that key. */
export function blockEditKey(layout: Layout, index: number, saved?: Readonly<Record<string, unknown>>): string | undefined {
  const blocks = inputBlocks(layout);
  const origin = layout.config?.blockEdits?.origins.find(o => o.block === index);
  const source = origin ? origin.source : index;
  if (!blocks[source]) return undefined;
  const position = blockPositionKey(...blockPositions(layout)[source]),
    id = saved?.[position] ? position : blockEditId(layout, blocks[source].shape);
  return origin?.part ? `${id}/${origin.part}` : id;
}
/** The layout every stage after the parcels reads: the partition's prepared blocks, when it has any. */
export function partitionLayout(layout: Layout, partition: Pick<Partition, 'prepared'>): Layout {
  const prepared = partition.prepared;
  if (!prepared) return layout;
  const config = layout.config && { ...layout.config };
  if (config) {
    if (prepared.edits) config.blockEdits = prepared.edits;
    else delete config.blockEdits;
  }
  return { ...layout, blocks: prepared.blocks, ...(config ? { config } : {}) };
}
/** Saved key of a block named by its position (share codes): quarter, then rank among the quarter's blocks. */
export const BLOCK_POSITION_KEY = /^block:(\d+)\.(\d+)$/;
export const blockPositionKey = (quarter: number, rank: number): string => `block:${quarter}.${rank}`;
const positions = new WeakMap<Layout, [number, number][]>();
/** [quarter, rank in the quarter] of every block of a layout before structural block edits. */
export function blockPositions(layout: Layout): readonly [number, number][] {
  let list = positions.get(layout);
  if (!list) {
    const ranks = new Map<number, number>();
    list = inputBlocks(layout).map(block => {
      const rank = ranks.get(block.quarter) ?? 0;
      ranks.set(block.quarter, rank + 1);
      return [block.quarter, rank];
    });
    positions.set(layout, list);
  }
  return list;
}
/** Position of the block a saved key names by its geometry; undefined for a part of a split block or another plan. */
export function blockAddress(layout: Layout, saved: string): [number, number] | undefined {
  const index = inputBlocks(layout).findIndex(block => blockEditId(layout, block.shape) === saved);
  return index < 0 ? undefined : blockPositions(layout)[index];
}
/** The native contract uses indices only within one request. Resolve saved IDs after laying out the town:
 * `block:<hash>` or `block:<quarter>.<rank>` → `"<i>"`, `block:<hash>/<k>` → `"<i>/<k>"` (part k of split block i). */
export function runtimeBlockEdits(config: ParcelConfig, layouts: readonly Layout[]): ParcelConfig {
  if (!config.overrides?.blocks || !Object.keys(config.overrides.blocks).length) return config;
  const layout = layouts[0];
  const index = new Map((layout ? inputBlocks(layout) : []).map((block, i) => [blockEditId(layout, block.shape), i]));
  if (layout) blockPositions(layout).forEach(([quarter, rank], i) => index.set(blockPositionKey(quarter, rank), i));
  const blocks = Object.fromEntries(
    Object.entries(config.overrides.blocks).flatMap(([key, edit]) => {
      const slash = key.indexOf('/', 'block:'.length);
      const source = index.get(slash < 0 ? key : key.slice(0, slash));
      if (source === undefined) return [];
      return [[slash < 0 ? String(source) : `${source}${key.slice(slash)}`, edit]];
    }),
  );
  return { ...config, overrides: { ...config.overrides, blocks } };
}
