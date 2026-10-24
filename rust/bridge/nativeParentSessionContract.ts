/** Native retained city-generation protocol. The source identity is frozen
 * administrative evidence, not a cross-engine historical/physical certificate. */
import type { PlacementBatchSettings, PlacementRequest } from './urbanArchitecture';
import type { Surface } from './housesContract';
import type { NativeParentBatch } from './nativeParentContract';
export const NATIVE_PARENT_SESSION_CAPABILITY = 'houses.native-parent-session-1';
export const NATIVE_PARENT_SESSION_SCHEMA = 'native-parent-session-1';
export const NATIVE_PARENT_SESSION_PARTITION = 'prefix64-input24MiB-std-v1';
export interface ParentSessionSource { fingerprint: string; revision: string; coordinate_space: 'world-metres' }
export interface BeginParentSessionRequest { schema_version: typeof NATIVE_PARENT_SESSION_SCHEMA; run_id: string;
  source: ParentSessionSource; total_requests: number; settings: PlacementBatchSettings | null }
export interface ParentSessionLimits { max_parents_per_batch: number; max_input_bytes: number; max_raw_bytes: number;
  max_std_rewritten_bytes: number; max_std_float_slots: number; max_output_bytes: number; max_hit_parts: number;
  max_hit_vertices: number; max_runs: number; max_total_requests: number; max_retained_vertices: number;
  max_index_references: number; max_retained_index_bytes: number; max_identity_bytes: number; ack_history_entries: number; idle_timeout_ms: number }
export interface BeginParentSessionReply { schema_version: typeof NATIVE_PARENT_SESSION_SCHEMA; session_id: string; source: ParentSessionSource;
  generator_version: string; batch_schema_version: 'native-parent-batch-1'; partition: typeof NATIVE_PARENT_SESSION_PARTITION;
  offset: 0; total_requests: number; state: 'ready' | 'complete'; limits: ParentSessionLimits }
export interface PlanParentSessionRequest { schema_version: typeof NATIVE_PARENT_SESSION_SCHEMA; session_id: string;
  source_fingerprint: string; revision: string; expected_offset: number; key: string; requests: PlacementRequest[]; footprints: Record<string, Surface> }
export interface ParentSessionReceipt { session_id: string; source_fingerprint: string; revision: string; key: string;
  offset: number; completed: number; total: number; request_sha256: string; batch_sha256: string }
export interface ParentIndexQueryReport { queries: number; land_queries: number; roof_queries: number; leaf_hits: number; union_calls: number;
  max_query_parts: number; max_query_vertices: number }
export interface PlanParentSessionReply { receipt: ParentSessionReceipt; batch_json: string; context_report: ParentIndexQueryReport }
export interface ParentPrefixCounts { parents: number; members: number; leaves: number; vertices: number; index_references: number; retained_index_bytes: number }
export interface AckParentSessionReply { session_id: string; source_fingerprint: string; revision: string;
  completed: number; total: number; state: 'ready' | 'complete' | 'already_acked'; prefix: ParentPrefixCounts }
export interface CloseParentSessionRequest { schema_version: typeof NATIVE_PARENT_SESSION_SCHEMA; session_id: string; source_fingerprint: string; revision: string }
export interface CloseParentSessionReply { session_id: string; state: 'released' | 'draining' | 'already_released' }
export interface NativeParentEngineStatus { profile: 'local' | 'web'; service: string | null; capabilities: string[] }
export interface NativeParentSessionApi {
  qualification?(): NativeParentEngineStatus | null;
  /** Fresh once per run before begin; pinned nonce prevents reconnection downgrade. */
  require(): Promise<void>;
  begin(input: BeginParentSessionRequest): Promise<BeginParentSessionReply>;
  plan(input: PlanParentSessionRequest): Promise<PlanParentSessionReply>;
  ack(receipt: ParentSessionReceipt): Promise<AckParentSessionReply>;
  abort(input: CloseParentSessionRequest): Promise<CloseParentSessionReply>;
  release(input: CloseParentSessionRequest): Promise<CloseParentSessionReply>;
}
export interface NativeParentSessionEvidence { engine?: NativeParentEngineStatus | null; begin: BeginParentSessionReply; settings: PlacementBatchSettings | null;
  /** Evidence only; exported closed handles are NEVER resumed. */
  final_prefix: ParentPrefixCounts | null; query_report?: ParentIndexQueryReport; status: 'completed-and-released'; empty_administrative_scene: boolean }
export interface ValidatedParentSessionBatch { receipt: ParentSessionReceipt; batch: NativeParentBatch; context_report: ParentIndexQueryReport }
export const sameParentSessionReceipt = (a: ParentSessionReceipt, b: ParentSessionReceipt): boolean =>
  a.session_id === b.session_id && a.source_fingerprint === b.source_fingerprint && a.revision === b.revision && a.key === b.key
  && a.offset === b.offset && a.completed === b.completed && a.total === b.total && a.request_sha256 === b.request_sha256 && a.batch_sha256 === b.batch_sha256;
