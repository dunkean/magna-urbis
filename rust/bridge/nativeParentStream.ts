import type { ParentSessionReceipt, NativeParentSessionEvidence } from './nativeParentSessionContract';
import { fillCanonicalParentPrefix } from './nativeParentSourceBuffer';
/** Shared worker AND main-thread fallback parent pipeline. Canonical boundaries
 * depend on native inputs/context, never on transport pages or response timing. */
import type { ArchitectureBatchHeader, ArchitectureRequestSource, ArchitectureBatchProgress } from './architectureBatch';
import { NATIVE_PARENT_SCHEMA, validateParentBatch, type NativeParentApi, type NativeParentBatch, type NativeParentCounts, type NativeParentRequest } from './nativeParentContract';
import { parentInputBudget, PARENT_LIMITS } from './nativeParentBudget';
import { NativeParentOccupationIndex, type ParentOccupationLeaf } from './nativeParentOccupation';
import type { PlacementRequest } from './urbanArchitecture';
export interface ParentBatchBoundary { start: number; completed: number; inputBytes: number; floatSlots: number; rewrittenBytes: number; inputSha256: string; sessionReceipt?: ParentSessionReceipt; emptySessionId?: string }
export interface NativeParentStreamSummary { schema_version: typeof NATIVE_PARENT_SCHEMA; generator_version: string; counts: NativeParentCounts; boundaries: ParentBatchBoundary[]; session?: NativeParentSessionEvidence }
export interface NativeParentStreamOptions {
  cancelled?(): boolean;
  /** Await durable parent source+all member indexes/fragments here before ACK. */
  onBatch(batch: NativeParentBatch, progress: ArchitectureBatchProgress, boundary: ParentBatchBoundary,
    requests: readonly PlacementRequest[]): Promise<void>;
}
export async function parentDigest(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function streamNativeParents(header: ArchitectureBatchHeader, source: ArchitectureRequestSource,
  api: NativeParentApi, options: NativeParentStreamOptions): Promise<NativeParentStreamSummary> {
  await api.require(); // capability BEFORE any source read, including a zero-request source.
  const total = source.total;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid native parent source count.');
  const cancelled = () => { if (options.cancelled?.()) throw new DOMException('Parent stream replaced', 'AbortError'); };
  const context = new NativeParentOccupationIndex(), seen = new Set<string>();
  const pending: PlacementRequest[] = [], boundaries: ParentBatchBoundary[] = [];
  let completed = 0, version = '';
  const counts: NativeParentCounts = { requests: 0, admitted_parents: 0, single_parents: 0, assembly_parents: 0, physical_members: 0, refusals: 0, open_spaces: 0 };
  do {
    cancelled();
    // Exact cumulative source preflight. The native context can further reduce
    // this prefix, but fetched small pages never accumulate64*24MiB of sites.
    await fillCanonicalParentPrefix(source, completed, pending, seen, requests => parentInputBudget({
      schema_version: NATIVE_PARENT_SCHEMA, batch: { ...header, requests,
        ...(header.footprints ? { footprints: Object.fromEntries(requests.filter(r => header.footprints![r.id]).map(r => [r.id, header.footprints![r.id]])) } : {}) },
      prior_occupation: { land_parts: [], roof_parts: [] },
    }), cancelled);
    let selected: NativeParentRequest | undefined, selectedWire: ReturnType<typeof parentInputBudget> | undefined;
    const requests: PlacementRequest[] = [], leaves = new Set<ParentOccupationLeaf>();
    // No maximal grand AABB: only each site's complete rights/access envelope.
    for (const request of pending) {
      const candidateLeaves = new Set(leaves); context.query(request).forEach(e => candidateLeaves.add(e));
      const ordered = context.ordered(candidateLeaves);
      const footprints = header.footprints && Object.fromEntries([...requests, request].filter(r => header.footprints![r.id]).map(r => [r.id, header.footprints![r.id]]));
      const candidate: NativeParentRequest = { schema_version: NATIVE_PARENT_SCHEMA, batch: { ...header,
        ...(footprints ? { footprints } : {}), requests: [...requests, request] },
        prior_occupation: { land_parts: ordered.filter(e => e.kind === 'land').map(e => e.surface), roof_parts: ordered.filter(e => e.kind === 'roof').map(e => e.surface) } };
      const measured = parentInputBudget(candidate);
      if (!measured.fits) { if (!selected) throw new Error(`Native parent request ${request.id} cannot fit complete context: ${measured.reason}.`); break; }
      requests.push(request); candidateLeaves.forEach(e => leaves.add(e)); selected = candidate; selectedWire = measured;
    }
    if (!selected) { selected = { schema_version: NATIVE_PARENT_SCHEMA, batch: { ...header, requests: [] }, prior_occupation: { land_parts: [], roof_parts: [] } };
      selectedWire = parentInputBudget(selected); if (!selectedWire.fits) throw new Error('Empty parent header exceeds native input budget.'); }
    cancelled();
    const boundary: ParentBatchBoundary = { start: completed, completed: completed + requests.length, inputBytes: selectedWire!.wire.bytes,
      floatSlots: selectedWire!.wire.floatSlots, rewrittenBytes: selectedWire!.wire.rewrittenBytes, inputSha256: await parentDigest(selectedWire!.wire.json) };
    // Exactly ONE invocation, no response-budget splitting/replanning retry.
    const batch = await api.plan(selected); cancelled(); validateParentBatch(batch, requests);
    if (version && version !== batch.generator_version) throw new Error('Native parent generator changed during stream.'); version = batch.generator_version;
    context.append(batch.parents.map(p => p.plan));
    await options.onBatch(batch, { start: completed, completed: boundary.completed, total }, boundary, requests);
    cancelled(); // a stale consumer cannot authorize another native page.
    for (const key of Object.keys(counts) as (keyof NativeParentCounts)[]) counts[key] += batch.counts[key];
    boundaries.push(boundary); completed = boundary.completed; pending.splice(0, requests.length);
  } while (completed < total);
  return { schema_version: NATIVE_PARENT_SCHEMA, generator_version: version, counts, boundaries };
}
