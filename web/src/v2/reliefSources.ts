import type { V2Settings, V2TerrainSettings } from './contracts';
import type { ReliefSource } from './stageRegistry';

/** Three visible tabs; symbolic relief is a method inside Heightmap. */
export const RELIEF_TABS = ['procedural', 'neural', 'heightmap'] as const;
export type ReliefTab = typeof RELIEF_TABS[number];
export type HeightmapMethod = 'heightmap' | 'symbolic';
export const reliefTab = (source: ReliefSource): ReliefTab => source === 'symbolic' ? 'heightmap' : source;

/** Session-only alternatives: only the active input is written to the recipe. */
export function createReliefSources(get: () => V2Settings, coastMask: () => number) {
  let pending: HeightmapMethod | undefined, lastMethod: HeightmapMethod = 'heightmap';
  let zones: V2TerrainSettings['zones'];
  let heightmap: { sketch?: V2TerrainSettings['sketch']; image?: V2Settings['options']['importedHeight'] } | undefined;
  let neural: NonNullable<V2Settings['runtime']>['source'] = 'neural-wasm';
  const coasts = new Map<ReliefSource, number>();

  function current(): ReliefSource {
    const s = get();
    // Recipe inputs take precedence over an empty method selected in this session.
    if (s.terrain?.zones) {
      zones = s.terrain.zones;
      return lastMethod = 'symbolic';
    }
    if (s.terrain?.sketch?.processing || s.options.importedHeight) {
      heightmap = { sketch: s.terrain?.sketch?.processing ? s.terrain.sketch : undefined, image: s.options.importedHeight };
      return lastMethod = 'heightmap';
    }
    if (pending) return pending;
    const source = s.runtime?.source ?? (s.generation === 'neural' ? 'neural-wasm' : 'procedural');
    return source === 'procedural' || source === 'procedural-phasor' ? 'procedural' : 'neural';
  }
  function method(): HeightmapMethod {
    const source = current();
    return source === 'heightmap' || source === 'symbolic' ? source : lastMethod;
  }
  function select(mode: ReliefSource): boolean {
    const s = get(), from = current();
    if (mode === from) return false;
    s.terrain ??= {};
    coasts.set(from, coastMask());
    if (coasts.has(mode)) s.terrain.coastMask = coasts.get(mode)!;
    if (from === 'heightmap') {
      heightmap = { sketch: s.terrain.sketch?.processing ? s.terrain.sketch : undefined, image: s.options.importedHeight };
      if (s.terrain.sketch?.processing) delete s.terrain.sketch;
      delete s.options.importedHeight;
    }
    if (from === 'symbolic') { zones = s.terrain.zones; delete s.terrain.zones; }
    if (from === 'neural') neural = s.runtime?.source ?? 'neural-wasm';
    pending = undefined;
    if (mode === 'heightmap') {
      if (heightmap?.sketch) s.terrain.sketch = heightmap.sketch;
      if (heightmap?.image) s.options.importedHeight = heightmap.image;
      s.terrain.coastMask = coasts.get(mode) ?? 0;
      pending = lastMethod = mode;
    }
    if (mode === 'symbolic') {
      s.terrain.zones = zones ?? { version: 1, resolution: 128, weights: Array(128 * 128 * 5).fill(0) };
      pending = lastMethod = mode;
      if (coastMask() === 255) s.terrain.coastMask = 0;
    }
    delete s.terrain.modification;
    s.runtime ??= { backend: 'rust', compute: 'auto', source: 'procedural' };
    s.runtime.source = mode === 'neural' ? neural : 'procedural';
    return true;
  }
  function changed(detail: unknown): void {
    if (detail === 'symbolic') { zones = get().terrain?.zones; pending = lastMethod = 'symbolic'; }
    else if (detail === 'import') pending = lastMethod = 'heightmap';
    current();
  }
  return { current, method, select, changed };
}
