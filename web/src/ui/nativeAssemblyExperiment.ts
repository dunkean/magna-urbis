/** Selected-parent experiment. Never replaces/injects into the applied city.
 * All saved authority comes from the native archive, not adjacent response DTOs. */
import type { NativeAssemblyApi, AssemblePairRequest, AssemblyAttemptReport, RetainedNativeAssembly } from '../../../rust/bridge/nativeAssemblyContract';
import { ASSEMBLY_ARTIFACT_VERSION, assemblyInputFingerprint, stageNativeAssembly,
  type NativeAssemblyArtifact, type NativeAssemblyArtifactBackend } from './nativeAssemblyStore';
export type AssemblyExperimentState = 'ready' | 'loading-site' | 'assembling' | 'retained' | 'proposed' | 'error' | 'stale';
/** The actual producer publication tail, also exercised without inventing
 * missing native selected-site inputs in consumer-only archive tests. */
export async function publishSelectedAssemblyProposal(stage: Awaited<ReturnType<typeof stageNativeAssembly>>, options: {
  current(): boolean; state?(state: AssemblyExperimentState): void; signal?: AbortSignal;
}) {
  const receipt = await stage.commit();
  options.signal?.throwIfAborted();
  if (receipt.source_status !== 'current_at_return' || !options.current()) throw new DOMException(
    'Source native remplacée. Une archive historique NON APPLIQUÉE peut avoir été conservée avec ses empreintes d’origine ; elle ne devient pas une proposition courante.', 'AbortError');
  options.state?.('proposed');
  return { artifact: stage.artifact, native: stage.native, receipt };
}
export async function attemptSelectedNativeAssembly(options: {
  parentId: string; api: NativeAssemblyApi; backend: NativeAssemblyArtifactBackend;
  current(): boolean; load(): Promise<AssemblePairRequest>; state?(state: AssemblyExperimentState): void; signal?: AbortSignal;
}): Promise<{ state: 'retained'; report: AssemblyAttemptReport } | {
  state: 'proposed'; report: AssemblyAttemptReport; artifact: NativeAssemblyArtifact; native: RetainedNativeAssembly;
}> {
  const check = () => { options.signal?.throwIfAborted(); if (!options.current()) throw new DOMException('Proposition remplacée : origine native périmée.', 'AbortError'); };
  check(); await options.api.require(); check(); // Before site/native archive reads.
  options.state?.('loading-site'); const request = await options.load(); check();
  if (request.site.id !== options.parentId || request.incumbent.id !== options.parentId
    || request.site.parcel_id !== request.incumbent.parcel_id) throw new Error('Selected native parent/site identity mismatch.');
  const input_sha256 = await assemblyInputFingerprint(request); check();
  options.state?.('assembling'); const decision = await options.api.assemble(request); check();
  if (decision.outcome === 'retained') {
    if (decision.building.id !== options.parentId || decision.building.parcel_id !== request.site.parcel_id) throw new Error('Retained native parent identity changed.');
    options.state?.('retained'); return { state: 'retained', report: decision.report };
  }
  if (decision.outcome !== 'assembled') throw new Error('Unsupported native assembly response.');
  // decision.assembly is an adjacent decimal transport view, not a saved source.
  const artifact: NativeAssemblyArtifact = { version: ASSEMBLY_ARTIFACT_VERSION, application: 'proposal_not_applied',
    parent_id: options.parentId, parcel_id: request.site.parcel_id, input_sha256, archive: decision.archive };
  const stage = await stageNativeAssembly(options.backend, artifact, options.api, { current: options.current, signal: options.signal });
  check(); const published = await publishSelectedAssemblyProposal(stage, options);
  return { state: 'proposed', report: decision.report, artifact: published.artifact, native: published.native };
}
