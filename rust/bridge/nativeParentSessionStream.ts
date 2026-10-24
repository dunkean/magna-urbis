/** Real city session stream. Prefix occupation lives exclusively in native 2D
 * leaves; this adapter NEVER builds the stateless JS city occupation index. */
import type { ArchitectureBatchHeader, ArchitectureBatchProgress, ArchitectureRequestSource } from './architectureBatch';
import { NATIVE_PARENT_SCHEMA, type NativeParentBatch, type NativeParentCounts, type NativeParentRequest } from './nativeParentContract';
import { NATIVE_PARENT_SESSION_SCHEMA, type NativeParentSessionApi, type BeginParentSessionRequest, type BeginParentSessionReply,
  type ParentSessionSource, type PlanParentSessionRequest, type ParentSessionReceipt, type NativeParentSessionEvidence,
  type ParentPrefixCounts, type CloseParentSessionRequest, type AckParentSessionReply, type ParentIndexQueryReport } from './nativeParentSessionContract';
import { parentWire, parentInputBudget, PARENT_LIMITS } from './nativeParentBudget';
import { fillCanonicalParentPrefix } from './nativeParentSourceBuffer';
import { parentDigest, type ParentBatchBoundary, type NativeParentStreamSummary } from './nativeParentStream';
import { validateParentSessionBegin, validateParentSessionPlan, parentSessionAssert, parentSessionInteger } from './nativeParentSessionValidation';
import type { PlacementRequest } from './urbanArchitecture';
export interface NativeSessionBoundary extends ParentBatchBoundary { sessionReceipt?: ParentSessionReceipt; emptySessionId?: string }
export interface NativeParentSessionSummary extends NativeParentStreamSummary { session: NativeParentSessionEvidence }
export interface NativeParentSessionOptions {
  cancelled?(): boolean;
  onBegin?(begin: BeginParentSessionReply): void | Promise<void>;
  onAcknowledged?(receipt: ParentSessionReceipt, reply: AckParentSessionReply): void | Promise<void>;
  /** The callback sends worker ACK ONLY after all source/index fragments durable.
   * This stream then ACKs native, and only then reads/plans another prefix. */
  onBatch(batch: NativeParentBatch, progress: ArchitectureBatchProgress, boundary: NativeSessionBoundary,
    requests: readonly PlacementRequest[], receipt: ParentSessionReceipt | null, sessionId: string, nativeBatchJson?: string): Promise<void>;
}
const zeros = (): NativeParentCounts => ({ requests: 0, admitted_parents: 0, single_parents: 0, assembly_parents: 0, physical_members: 0, refusals: 0, open_spaces: 0 });
export async function streamNativeParentSession(header: ArchitectureBatchHeader, source: ArchitectureRequestSource,
  identity: ParentSessionSource, api: NativeParentSessionApi, options: NativeParentSessionOptions): Promise<NativeParentSessionSummary> {
  const cancelled = () => { if (options.cancelled?.()) throw new DOMException('Parent city generation replaced', 'AbortError'); };
  parentSessionAssert(Number.isSafeInteger(source.total) && source.total >= 0 && /^[a-f0-9]{64}$/.test(identity.fingerprint)
    && typeof identity.revision === 'string' && identity.revision.length > 0 && identity.coordinate_space === 'world-metres', 'Invalid native city session source.');
  await api.require(); cancelled();
  const settings = header.settings ? structuredClone(header.settings) : null;
  const beginInput: BeginParentSessionRequest = { schema_version: NATIVE_PARENT_SESSION_SCHEMA, run_id: crypto.randomUUID(), source: { ...identity }, total_requests: source.total, settings };
  let begin: BeginParentSessionReply | undefined, result: NativeParentSessionSummary | undefined, primary: unknown;
  let failed = false;
  let close: CloseParentSessionRequest | undefined, prefix: ParentPrefixCounts | null = null;
  const queryReport: ParentIndexQueryReport = { queries: 0, land_queries: 0, roof_queries: 0, leaf_hits: 0, union_calls: 0, max_query_parts: 0, max_query_vertices: 0 };
  const counts = zeros(), boundaries: NativeSessionBoundary[] = [], pending: PlacementRequest[] = [], seen = new Set<string>();
  let completed = 0, generator = '';
  try {
    begin = await api.begin(beginInput);
    // Capture the actual handle immediately so even validation/store begin errors
    // attempt independent native cleanup. A completely lost begin response has
    // no handle: native idle cleanup is then the only guarantee, never claimed released.
    if (typeof begin?.session_id === 'string' && begin.session_id) close = { schema_version: NATIVE_PARENT_SESSION_SCHEMA,
      session_id: begin.session_id, source_fingerprint: beginInput.source.fingerprint, revision: beginInput.source.revision };
    validateParentSessionBegin(begin, beginInput); cancelled(); await options.onBegin?.(begin); cancelled();
    if (source.total === 0) {
      // Administrative empty source from begin metadata, no fictitious native
      // plan, request, archive, pending receipt or forbidden plan([]) invocation.
      const wire = parentWire(beginInput);
      const boundary: NativeSessionBoundary = { start: 0, completed: 0, inputBytes: wire.bytes, floatSlots: wire.floatSlots,
        rewrittenBytes: wire.rewrittenBytes, inputSha256: await parentDigest(wire.json), emptySessionId: begin.session_id };
      generator = begin.generator_version;
      await options.onBatch({ schema_version: NATIVE_PARENT_SCHEMA, generator_version: generator, parents: [], refusals: [], open_spaces: [], materials: [], counts: zeros() },
        { start: 0, completed: 0, total: 0 }, boundary, [], null, begin.session_id); cancelled(); boundaries.push(boundary);
    }
    while (completed < source.total) {
      const session = begin, key = `${beginInput.run_id}:${completed}`;
      const planInput = (requests: PlacementRequest[]): PlanParentSessionRequest => ({ schema_version: NATIVE_PARENT_SESSION_SCHEMA,
        session_id: session.session_id, source_fingerprint: identity.fingerprint, revision: identity.revision, expected_offset: completed, key,
        requests, footprints: Object.fromEntries(requests.filter(r => header.footprints?.[r.id]).map(r => [r.id, header.footprints![r.id]])) });
      const measure = (requests: PlacementRequest[]) => {
        // Frozen settings still cost native inner batch bytes even though absent
        // from the session page wire. BOTH known budgets precede source reads/call.
        const input = planInput(requests), wire = parentWire(input);
        const virtual: NativeParentRequest = { schema_version: NATIVE_PARENT_SCHEMA,
          batch: { schema_version: '1', ...(settings ? { settings } : {}), requests, footprints: input.footprints },
          prior_occupation: { land_parts: [], roof_parts: [] } };
        const inner = parentInputBudget(virtual);
        return { fits: inner.fits && wire.bytes <= session.limits.max_input_bytes && wire.floatSlots <= session.limits.max_std_float_slots
          && wire.rewrittenBytes <= session.limits.max_std_rewritten_bytes, reason: inner.reason ?? 'session wire budget', wire };
      };
      await fillCanonicalParentPrefix(source, completed, pending, seen, measure, cancelled); cancelled();
      let selected: PlacementRequest[] = [], measured = measure(selected);
      for (const r of pending) { const next = [...selected, r], candidate = measure(next);
        if (!candidate.fits) { if (!selected.length) throw new Error(`Whole native city request cannot fit: ${candidate.reason}.`); break; }
        selected = next; measured = candidate;
      }
      parentSessionAssert(selected.length > 0, 'Native session source made no progress.');
      const input = planInput(selected), reply = await api.plan(input); cancelled();
      const validated = await validateParentSessionPlan(reply, session, input); cancelled();
      for (const key of Object.keys(queryReport) as (keyof ParentIndexQueryReport)[]) queryReport[key] = key.startsWith('max_')
        ? Math.max(queryReport[key], validated.context_report[key]) : queryReport[key] + validated.context_report[key];
      const batch = validated.batch, batchCounts = { ...validated.batch.counts }, receipt = Object.freeze({ ...validated.receipt });
      parentSessionAssert(!generator || generator === batch.generator_version, 'Native parent generator changed inside session.'); generator = batch.generator_version;
      const boundary: NativeSessionBoundary = { start: completed, completed: receipt.completed, inputBytes: measured.wire.bytes,
        floatSlots: measured.wire.floatSlots, rewrittenBytes: measured.wire.rewrittenBytes, inputSha256: await parentDigest(measured.wire.json), sessionReceipt: receipt };
      await options.onBatch(batch, { start: completed, completed: receipt.completed, total: source.total }, boundary, selected, receipt, session.session_id, reply.batch_json);
      cancelled();
      // Only storage ACK authorizes insertion of pending native leaves. No next
      // source page/native solve happens before this native ACK settles.
      const ack = await api.ack(receipt); cancelled();
      const expected = { ...counts }; for (const key of Object.keys(expected) as (keyof NativeParentCounts)[]) expected[key] += batchCounts[key];
      parentSessionAssert(ack.session_id === session.session_id && ack.source_fingerprint === identity.fingerprint && ack.revision === identity.revision
        && ack.completed === receipt.completed && ack.total === source.total
        && ['ready', 'complete', 'already_acked'].includes(ack.state) && ack.prefix && Object.values(ack.prefix).every(parentSessionInteger)
        && ack.prefix.parents === expected.admitted_parents && ack.prefix.members === expected.physical_members, 'Native durable ACK/prefix accounting mismatch.');
      prefix = ack.prefix; Object.assign(counts, expected); boundaries.push(boundary); completed = receipt.completed;
      await options.onAcknowledged?.(receipt, ack); cancelled();
      pending.splice(0, selected.length); seen.clear(); pending.forEach(r => seen.add(r.id)); // global IDs are native-owned, not a second JS city index.
    }
    result = { schema_version: NATIVE_PARENT_SCHEMA, generator_version: generator, counts, boundaries,
      session: { begin, engine: api.qualification?.() ?? null, settings, final_prefix: prefix, query_report: queryReport, status: 'completed-and-released', empty_administrative_scene: source.total === 0 } };
  } catch (e) { primary = e; failed = true; }
  // Close is independent from UI AbortSignal and from any main-thread stage
  // cleanup. No hidden restart/rebegin/replan after a lost native incarnation.
  const cleanup: unknown[] = [];
  if (close) {
    if (failed) { try { const aborted = await api.abort(close); parentSessionAssert(aborted.session_id === close.session_id, 'Native abort identity mismatch.'); } catch (e) { cleanup.push(e); } }
    try { const released = await api.release(close); parentSessionAssert(released.session_id === close.session_id && ['released', 'already_released'].includes(released.state),
      'Native session is still draining; no released result claimed.'); } catch (e) { cleanup.push(e); }
  }
  if (failed || cleanup.length) throw cleanup.length ? new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native city run/cleanup failed; previous scene remains authoritative.') : primary;
  parentSessionAssert(result, 'Native city session produced no completion.'); return result;
}
