import type { Point } from '../../../rust/bridge/housesContract';
import type { ParentSceneManifest } from './urbanParentChunkStore';
import type { NativeParentSessionEvidence } from '../../../rust/bridge/nativeParentSessionContract';
import type { UrbanParentSceneResult } from './urbanParentScene';
export interface UrbanParentBuildingState {
  store: UrbanParentSceneResult['store']; counts: UrbanParentSceneResult['counts'];
  generation?: NativeParentSessionEvidence; offset?: Point; cityKey?: string; binding?: 'generated' | 'imported' | 'snapshot';
}
export function parentStateFromManifest(m: ParentSceneManifest, options: { offset?: Point; cityKey?: string } = {}): UrbanParentBuildingState {
  return { store: { format: m.format, sceneId: m.sceneId, fingerprint: m.fingerprint, sourceFingerprint: m.sourceFingerprint },
    counts: { ...m.counts, schema_version: m.schema_version, generator_version: m.generator_version },
    ...(m.generation ? { generation: m.generation } : {}), ...options };
}
export function copyParentBuildingState(s: UrbanParentBuildingState): UrbanParentBuildingState {
  const c = s?.counts;
  if (s?.store?.format !== 'urban-native-parent-chunks-1' || !s.store.sceneId || !/^[a-f0-9]{64}$/.test(s.store.fingerprint)
    || !/^[a-f0-9]{64}$/.test(s.store.sourceFingerprint) || c?.schema_version !== 'native-parent-batch-1'
    || typeof c.generator_version !== 'string' || !c.generator_version
    || ![c.requests, c.admitted_parents, c.single_parents, c.assembly_parents, c.physical_members, c.refusals, c.open_spaces].every(n => Number.isSafeInteger(n) && n >= 0)
    || c.requests !== c.admitted_parents + c.refusals + c.open_spaces || c.admitted_parents !== c.single_parents + c.assembly_parents
    || c.physical_members !== c.single_parents + 2 * c.assembly_parents) throw new Error('Invalid retained parent city reference/counts.');
  if (s.offset && ![s.offset.x, s.offset.y].every(Number.isFinite) || s.cityKey !== undefined && (typeof s.cityKey !== 'string' || !s.cityKey)) throw new Error('Invalid parent city display frame.');
  return structuredClone(s); // scalar/config metadata only, NEVER source graphs.
}
export function sameParentBuildingState(a?: UrbanParentBuildingState, b?: UrbanParentBuildingState): boolean {
  return a === b || !!a && !!b && a.store.sceneId === b.store.sceneId && a.store.fingerprint === b.store.fingerprint
    && a.store.sourceFingerprint === b.store.sourceFingerprint && a.store.format === b.store.format
    && a.cityKey === b.cityKey && a.binding === b.binding && (a.offset?.x ?? 0) === (b.offset?.x ?? 0) && (a.offset?.y ?? 0) === (b.offset?.y ?? 0)
    && a.generation?.begin.session_id === b.generation?.begin.session_id && a.generation?.begin.source.revision === b.generation?.begin.source.revision
    && Object.keys(a.counts).every(key => a.counts[key as keyof typeof a.counts] === b.counts[key as keyof typeof b.counts]);
}
