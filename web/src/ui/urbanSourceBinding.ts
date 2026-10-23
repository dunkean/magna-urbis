import type { Layout, Partition } from '../../../rust/bridge/urban';
import { validateUrbanSource, type UrbanSourceHandle } from '../../../rust/bridge/urbanSource';
import type { ExecutionRuntime } from './executionProfile';

const runtimeKey = (runtime: ExecutionRuntime): string => `${runtime.profile}:${runtime.server.replace(/\/+$/, '')}`;

/** Runtime-only provenance of one immutable native parcel response. Nothing in
 * this binding belongs in snapshots, decor files, MU1 or persisted UI settings. */
export function createUrbanSourceBinding() {
  let retained: { source: UrbanSourceHandle; layouts: Layout[]; partitions: Partition[]; terrain: object;
    runtime: string; nativeLayouts: Layout[]; nativePartitions: Partition[] } | undefined;
  return {
    clear(): void { retained = undefined; },
    bind(input: { source?: UrbanSourceHandle; layouts?: Layout[]; partitions?: Partition[]; terrain: object;
      nativeLayouts: Layout[]; nativePartitions: Partition[]; runtime: ExecutionRuntime }): void {
      retained = undefined;
      if (!input.source || !input.layouts || !input.partitions || input.runtime.profile !== 'local') return;
      validateUrbanSource(input.source);
      const keys = new Set(input.nativeLayouts.map(layout => layout.key));
      if (keys.size !== input.nativeLayouts.length || input.nativePartitions.length !== keys.size
        || new Set(input.nativePartitions.map(partition => partition.key)).size !== keys.size
        || input.nativeLayouts.some(layout => !input.layouts!.includes(layout))
        || input.nativePartitions.some(partition => !keys.has(partition.key) || !input.partitions!.includes(partition))) return;
      retained = { source: input.source, layouts: input.layouts, partitions: input.partitions, terrain: input.terrain,
        nativeLayouts: input.nativeLayouts, nativePartitions: input.nativePartitions, runtime: runtimeKey(input.runtime) };
    },
    select(input: { layouts?: Layout[]; partitions?: Partition[]; terrain: object; runtime: ExecutionRuntime; keys: string[] }): { source: UrbanSourceHandle; keys: string[] } | undefined {
      if (!retained || input.layouts !== retained.layouts || input.partitions !== retained.partitions || input.terrain !== retained.terrain
        || runtimeKey(input.runtime) !== retained.runtime || input.runtime.profile !== 'local') return undefined;
      const selected = new Set(input.keys);
      if (selected.size !== input.keys.length) return undefined;
      // Native filtering preserves original layout order; never sort keys or
      // borrow the UI's currently selected order for a multi-city subset.
      const keys = retained.nativeLayouts.filter(layout => selected.has(layout.key)).map(layout => layout.key);
      if (keys.length !== selected.size || retained.nativeLayouts.some(layout => !input.layouts!.includes(layout))
        || retained.nativePartitions.some(partition => !input.partitions!.includes(partition))) return undefined;
      return { source: retained.source, keys };
    },
  };
}
