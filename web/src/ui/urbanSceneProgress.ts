import type { ArchitectureBatchProgress } from '../../../rust/bridge/architectureBatch';
import type { PlacementBatch, PlacementRequest } from '../../../rust/bridge/urbanArchitecture';
import { registerPlanArchives } from '../../../rust/bridge/compactPlanArchive';

export interface UrbanSceneBatch {
  delta: PlacementBatch; progress: ArchitectureBatchProgress;
  /** Original, unedited sites for exactly this input interval. Transferring them
   * with the acknowledged chunk avoids a whole-city clone at final commit. */
  requests: PlacementRequest[];
  /** Capability-gated projection path: requests is empty, no original constraints cross to main. */
  sites?: import('./urbanSiteStore').UrbanSiteVisual[];
}
/** A streamed worker completes without transferring its full scene a second time. */
export interface UrbanSceneCompletion {
  schema_version: PlacementBatch['schema_version'];
  generator_version: string;
  buildings: number;
  refusals: number;
  open_spaces: number;
}
/** The accumulated scene keeps the same identity through completion. Its arrays
 * grow after each awaited callback; consumers must treat it and the delta as
 * read-only. Neither callback argument is a copy of the growing scene. */
export type UrbanSceneBatchCallback = (delta: PlacementBatch, progress: ArchitectureBatchProgress,
  accumulatedScene: PlacementBatch) => void | Promise<void>;

export const urbanSceneCompletion = (scene: PlacementBatch): UrbanSceneCompletion => ({
  schema_version: scene.schema_version, generator_version: scene.generator_version,
  buildings: scene.buildings.length, refusals: scene.refusals.length, open_spaces: scene.open_spaces.length,
});

/** One per run. Work is proportional to the received chunk, never to its prefix. */
export function createUrbanSceneAccumulator() {
  let scene: PlacementBatch | undefined, completed = 0, total: number | undefined;
  const materialIndices = new Map<string, number>();
  return {
    append(delta: PlacementBatch, progress: ArchitectureBatchProgress): PlacementBatch {
      if (![progress.start, progress.completed, progress.total].every(Number.isSafeInteger)
        || progress.start !== completed || progress.completed < progress.start || progress.total < progress.completed
        || (total !== undefined && total !== progress.total)
        || (scene && progress.completed === progress.start)) throw new Error('Invalid or repeated architecture chunk.');
      if (scene && (scene.schema_version !== delta.schema_version || scene.generator_version !== delta.generator_version))
        throw new Error('Architecture engine changed during streaming.');
      // Register only this chunk. Re-registering the growing scene would be quadratic.
      registerPlanArchives(delta);
      scene ??= { schema_version: delta.schema_version, generator_version: delta.generator_version,
        buildings: [], refusals: [], open_spaces: [] };
      for (const material of delta.materials ?? []) {
        scene.materials ??= [];
        const index = materialIndices.get(material.id);
        if (index === undefined) { materialIndices.set(material.id, scene.materials.length); scene.materials.push(material); }
        else scene.materials[index] = material;
      }
      if (delta.plan_archives) Object.assign(scene.plan_archives ??= {}, delta.plan_archives);
      scene.buildings.push(...delta.buildings); scene.refusals.push(...delta.refusals); scene.open_spaces.push(...delta.open_spaces);
      completed = progress.completed; total = progress.total;
      return scene;
    },
    complete(metadata: UrbanSceneCompletion): PlacementBatch {
      if (!scene || completed !== total || metadata.schema_version !== scene.schema_version
        || metadata.generator_version !== scene.generator_version || metadata.buildings !== scene.buildings.length
        || metadata.refusals !== scene.refusals.length || metadata.open_spaces !== scene.open_spaces.length)
        throw new Error('Incomplete architecture stream.');
      return scene;
    },
    get scene(): PlacementBatch | undefined { return scene; },
  };
}
