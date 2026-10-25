import type { ParentSessionSource } from '../../../rust/bridge/nativeParentSessionContract';
import type { UrbanParentWorkerBegin, UrbanParentWorkerBatch, UrbanParentWorkerCompletion, UrbanParentWorkerAck, UrbanParentWorkerDrained, UrbanParentAcknowledged } from './urbanParentSceneProtocol';
import type { Layout, Partition, UrbanRequest } from '../../../rust/bridge/urban';
import { validateUrbanSource, type UrbanSourceHandle } from '../../../rust/bridge/urbanSource';
import type { SettlementRaster } from '../../../rust/bridge/settlements';
import { architectureProfile, type PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { ExecutionRuntime } from './executionProfile';
import type { UrbanSceneBatch, UrbanSceneCompletion } from './urbanSceneProgress';

/** Messages between the City scene client and its worker. Kept apart from the
 * client so the inline worker does not import the module that bundles it. */
/** City Bench architecture: lot silhouettes, compact native plans or detailed houses. */
export type UrbanSceneMode = 'silhouette' | 'compact' | 'detailed';
export interface UrbanSceneRequest { id: number;
  /** Versioned applied-city generation path, never a standalone proposal. */
  parentSession?: ParentSessionSource; layouts?: Layout[]; partitions?: Partition[];
  /** Runtime-only native snapshot, with city keys in its original layout order. */
  source?: UrbanSourceHandle; keys?: string[];
  /** Omitted when the worker already retains the same raster. */
  raster?: SettlementRaster; seed: string; settings?: import('../../../rust/bridge/urbanArchitecture').PlacementBatchSettings; runtime?: ExecutionRuntime;
  /** Flat silhouettes from the lot requests, without the house generator (City Bench). */
  silhouettes?: boolean;
  /** Explicit architecture; overrides `silhouettes`. */
  mode?: UrbanSceneMode;
  /** Internal transport flag: await an ACK after each bounded scene chunk. */
  progressive?: boolean;
  /** Internal cold receiver guard: never enter the full-site compatibility path. */
  requireProjectedSiteStream?: true;
  /** City Bench house edits by building id, applied to their placement requests before planning. */
  buildingOverrides?: Record<string, import('./cityEdits').HouseEdit> }
export interface UrbanSceneResponse { id: number;
  parentAcknowledged?: UrbanParentAcknowledged; parentDrained?: UrbanParentWorkerDrained; parentBegin?: UrbanParentWorkerBegin; parentBatch?: UrbanParentWorkerBatch; parentComplete?: UrbanParentWorkerCompletion; scene?: PlacementBatch; partitions?: Partition[];
  batch?: UrbanSceneBatch;
  /** Streamed runs finish with counts instead of another copy of the scene. */
  complete?: UrbanSceneCompletion;
  /** Native modes: the authoritative placement requests, before house edits (scoped edits replan from them). */
  requests?: import('../../../rust/bridge/urbanArchitecture').PlacementRequest[];
  /** Original city previews plus a runtime-only descriptor for selected-site reads. */
  sites?: import('./urbanSiteStore').UrbanSiteVisual[];
  siteQuery?: import('../../../rust/bridge/urbanBuildingSite').UrbanBuildingSiteQuery;
  /** For paged runs, sites + placement is pipeline wall time; placement includes
   * consumer ACK waits but excludes paged site reads. */
  timing?: { sites: number; placement: number; sitesPrepare?: number; sitesRead?: number; paged?: boolean };
  progress?: { completed: number; total: number }; error?: string }
export type UrbanSceneWorkerMessage = UrbanSceneRequest | { parentAck: UrbanParentWorkerAck } | { cancel: number } | { ack: { id: number; completed: number } };
/** Worker reply when it holds no raster; the client resends it. */
export const RASTER_MISSING = 'urban-scene:raster-missing';
export const sceneMode = (request: Pick<UrbanSceneRequest, 'mode' | 'silhouettes'>): UrbanSceneMode => request.mode ?? (request.silhouettes ? 'silhouette' : 'detailed');
/** Explicit City modes retain plans for lazy detail; omitted legacy mode is eager. */
export const usesCompactPlans = (request: Pick<UrbanSceneRequest, 'mode'>): boolean => request.mode === 'compact' || request.mode === 'detailed';

/** Also called inside the worker, before engine creation or any legacy read. */
export function validateProjectedSiteStream(request: UrbanSceneRequest): void {
  if (request.requireProjectedSiteStream === undefined) return;
  if (request.requireProjectedSiteStream !== true || !request.source || request.runtime?.profile !== 'local'
    || !usesCompactPlans(request) || request.progressive !== true)
    throw new Error('Projected site streams require a local retained source, explicit native plans and progressive ACK transport.');
}

export const sceneRuntimeKey = (runtime?: ExecutionRuntime): string => `${runtime?.profile ?? 'web'}:${runtime?.server.replace(/\/+$/, '') ?? ''}`;

/** Main-thread inputs may retain geometry for rollback, but a source read must
 * never clone or upload those arrays into the architecture worker. */
export function urbanSceneTransport(request: UrbanSceneRequest, omitRaster = false): UrbanSceneRequest {
  validateProjectedSiteStream(request);
  if (request.parentSession && (!usesCompactPlans(request) || request.progressive !== true
    || request.parentSession.coordinate_space !== 'world-metres' || !/^[a-f0-9]{64}$/.test(request.parentSession.fingerprint)
    || typeof request.parentSession.revision !== 'string' || !request.parentSession.revision))
    throw new Error('Native parent city generation requires a frozen source identity, explicit native mode and durable ACK stream.');
  if (request.source) {
    validateUrbanSource(request.source);
    if (request.runtime?.profile !== 'local' || !(usesCompactPlans(request) || sceneMode(request) === 'silhouette')) {
      throw new Error('Retained urban sources require local compact plans or silhouettes.');
    }
    if (request.keys && (request.keys.some(key => typeof key !== 'string' || !key) || new Set(request.keys).size !== request.keys.length)) throw new Error('Invalid retained urban city keys.');
    const { layouts: _layouts, partitions: _partitions, raster: _raster, ...message } = request;
    return message;
  }
  if (!request.layouts || !request.partitions) throw new Error('Urban geometry is missing and no retained source was supplied.');
  return omitRaster ? { ...request, raster: undefined } : request;
}

/** Shared by worker and main-thread fallback, including the strict no-upload
 * source branch. Legacy capacity reconciliation still receives full geometry. */
export function urbanBuildingSitesRequest(request: UrbanSceneRequest, raster?: SettlementRaster): UrbanRequest {
  const message = urbanSceneTransport(request);
  const common = { id: message.id, kind: 'buildingSites' as const, seed: message.seed, runtime: message.runtime, architectureCulture: architectureProfile(message.settings) };
  return message.source ? { ...common, source: message.source, keys: message.keys }
    : { ...common, raster, layouts: message.layouts, partitions: message.partitions };
}
