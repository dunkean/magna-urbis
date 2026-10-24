/** The real City worker transports native byte strings, never a false Single
 * collection. Complete constraints stay in worker/current source pages only. */
import type { ArchitectureBatchProgress } from '../../../rust/bridge/architectureBatch';
import type { ParentSessionReceipt, BeginParentSessionReply, AckParentSessionReply } from '../../../rust/bridge/nativeParentSessionContract';
import type { NativeParentSessionSummary, NativeSessionBoundary } from '../../../rust/bridge/nativeParentSessionStream';
import type { UrbanSiteVisual } from './urbanSiteStore';
export interface UrbanParentWorkerBatch { batch_json: string; receipt: ParentSessionReceipt | null; sessionId: string;
  administrativeEmpty: boolean; progress: ArchitectureBatchProgress; boundary: NativeSessionBoundary; sites: UrbanSiteVisual[] }
export interface UrbanParentWorkerCompletion { summary: NativeParentSessionSummary;
  timing: { sites: number; placement: number; sitesPrepare?: number; sitesRead?: number; paged: boolean } }
export interface UrbanParentWorkerAck { id: number; sessionId: string; receipt: ParentSessionReceipt | null }
export type UrbanParentWorkerBegin = BeginParentSessionReply;

/** Always emitted AFTER producer finally (native drain/abort/release attempts),
 * even when its run is stale. Settled never claims a failed cleanup succeeded. */
export interface UrbanParentWorkerDrained { state: 'settled' | 'not_started' | 'worker_failed'; error?: string }

export interface UrbanParentAcknowledged { receipt: ParentSessionReceipt; reply: AckParentSessionReply }
