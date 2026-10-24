import type { UrbanSourceHandle } from '../../../rust/bridge/urbanSource';
import type { PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';
import { parentDigest } from '../../../rust/bridge/nativeParentStream';
import { parentWire } from '../../../rust/bridge/nativeParentBudget';
import type { ParentSessionSource } from '../../../rust/bridge/nativeParentSessionContract';
/** Exact descriptor DIGEST, not a raw JSON token or a cross-engine certificate.
 * All three actual revisions freeze; settings are wishes for this generation. */
export async function parentGenerationIdentity(input: { source?: UrbanSourceHandle; residentFingerprint?: string; keys: string[];
  seed: string; settings: PlacementBatchSettings; buildingOverrides?: unknown; runtime: { profile: string; server: string } }): Promise<ParentSessionSource> {
  if (!input.source && !/^[a-f0-9]{64}$/.test(input.residentFingerprint ?? '')) throw new Error('Missing parent generation source identity.');
  const revisions = input.source ? { terrain: input.source.terrainRevision, layouts: input.source.layoutsRevision, partitions: input.source.partitionsRevision }
    : { resident: input.residentFingerprint };
  const revision = await parentDigest(parentWire(revisions).json);
  const fingerprint = await parentDigest(parentWire({ format: 'native-city-input-1', source: input.source,
    residentFingerprint: input.residentFingerprint, revision, keys: input.keys, seed: input.seed, settings: input.settings,
    buildingOverrides: input.buildingOverrides, runtime: input.runtime, coordinate_space: 'world-metres' }).json);
  return { fingerprint, revision, coordinate_space: 'world-metres' };
}
