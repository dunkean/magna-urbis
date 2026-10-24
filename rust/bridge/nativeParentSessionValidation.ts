import { PARENT_LIMITS } from './nativeParentBudget';
import { NATIVE_PARENT_SCHEMA, validateParentBatch } from './nativeParentContract';
import { parentDigest } from './nativeParentStream';
import { NATIVE_PARENT_SESSION_SCHEMA, NATIVE_PARENT_SESSION_PARTITION, type BeginParentSessionReply,
  type BeginParentSessionRequest, type PlanParentSessionRequest, type PlanParentSessionReply,
  type ValidatedParentSessionBatch, type ParentSessionReceipt } from './nativeParentSessionContract';
export function parentSessionAssert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export const parentSessionInteger = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const hash = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export function validateParentSessionBegin(reply: BeginParentSessionReply, input: BeginParentSessionRequest): void {
  parentSessionAssert(reply?.schema_version === NATIVE_PARENT_SESSION_SCHEMA && reply.batch_schema_version === NATIVE_PARENT_SCHEMA
    && reply.partition === NATIVE_PARENT_SESSION_PARTITION && typeof reply.session_id === 'string' && reply.session_id.length > 0
    && typeof reply.generator_version === 'string' && reply.generator_version.length > 0
    && reply.source?.fingerprint === input.source.fingerprint && reply.source.revision === input.source.revision
    && reply.source.coordinate_space === 'world-metres' && reply.offset === 0 && reply.total_requests === input.total_requests
    && reply.state === (input.total_requests === 0 ? 'complete' : 'ready'), 'Native parent session begin identity mismatch.');
  const l = reply.limits;
  parentSessionAssert(l && Object.values(l).every(parentSessionInteger) && l.max_parents_per_batch === PARENT_LIMITS.parents
    && l.max_input_bytes === PARENT_LIMITS.bytes && l.max_raw_bytes === 32 * 1024 * 1024
    && l.max_std_rewritten_bytes === PARENT_LIMITS.rewrittenBytes && l.max_std_float_slots === PARENT_LIMITS.floatSlots
    && l.max_output_bytes === 64 * 1024 * 1024 && l.max_hit_parts > 0 && l.max_hit_vertices > 0
    && l.max_total_requests >= input.total_requests && l.ack_history_entries > 0, 'Unsupported native parent session limits/partition.');
}
export function validateParentSessionReceipt(receipt: ParentSessionReceipt, begin: BeginParentSessionReply,
  input: PlanParentSessionRequest): void {
  parentSessionAssert(receipt && receipt.session_id === begin.session_id && receipt.source_fingerprint === begin.source.fingerprint
    && receipt.revision === begin.source.revision && receipt.key === input.key && receipt.offset === input.expected_offset
    && receipt.completed === input.expected_offset + input.requests.length && receipt.total === begin.total_requests
    && parentSessionInteger(receipt.completed) && receipt.completed <= receipt.total
    && hash(receipt.request_sha256) && hash(receipt.batch_sha256), 'Native parent pending receipt/source mismatch.');
}
/** Authenticate ORIGINAL UTF8 bytes BEFORE parse; never stringify a decimal view
 * to manufacture an equivalent native receipt/hash. */
export async function validateParentSessionPlan(reply: PlanParentSessionReply, begin: BeginParentSessionReply,
  input: PlanParentSessionRequest): Promise<ValidatedParentSessionBatch> {
  validateParentSessionReceipt(reply?.receipt, begin, input);
  const batch = await parseNativeParentBatchJson(reply.batch_json, reply.receipt, input.requests, begin.limits.max_output_bytes);
  parentSessionAssert(reply.context_report && Object.values(reply.context_report).every(parentSessionInteger), 'Invalid native prefix query report.');
  return { receipt: reply.receipt, batch, context_report: reply.context_report };
}

export async function parseNativeParentBatchJson(json: string, receipt: ParentSessionReceipt,
  identities: readonly { id: string; parcel_id: string }[], maxBytes = 64 * 1024 * 1024) {
  parentSessionAssert(typeof json === 'string' && new TextEncoder().encode(json).byteLength <= maxBytes
    && await parentDigest(json) === receipt.batch_sha256, 'Native parent batch_json SHA256 mismatch.');
  const batch = JSON.parse(json); validateParentBatch(batch, identities); return batch;
}
