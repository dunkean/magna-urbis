import type { Bounds, CompileOptions, SurfaceCompileInput, SurfaceWorld, TerrainGrid } from './model';

export const SURFACE_WORKER_PROTOCOL = 1 as const;
export interface SurfaceWorkerEpochs { sourceEpoch: string; sceneEpoch: string }
export interface SurfaceWorkerRegion { x: number; y: number; extent: number; resolution: number; knownContextId?: string }
export interface SurfaceWorkerInitialization<Payload = unknown> extends SurfaceWorkerEpochs { payload: Payload }
export interface PreparedSurfaceWorkerSource {
  input: SurfaceCompileInput; providerId: string; urban?: unknown; sourceMetadata?: Record<string, unknown>;
  /** Only an adapter that registered this exact retained source may bind its capture identity to a provider generation. */
  registeredSourceBinding?: boolean;
  compileOptions?: Omit<CompileOptions, 'signal'>;
}
interface Routing extends SurfaceWorkerEpochs { protocol: typeof SURFACE_WORKER_PROTOCOL; sessionId: string }
export interface SurfaceWorkerInit extends Routing { kind: 'initialize'; payload: unknown }
export interface SurfaceWorkerJob extends Routing {
  kind: 'compile'; requestId: number; terrain: TerrainGrid; region: SurfaceWorkerRegion;
  maxCandidates?: number; maxCheckedSlots?: number; binaryBudgetBytes?: number; memoryBudgetBytes?: number;
}
export type SurfaceWorkerRequest = SurfaceWorkerInit | SurfaceWorkerJob;
export type SurfaceWorkerResponse =
  | (Routing & { kind: 'initialized' })
  | (Routing & { kind: 'compiled'; requestId: number; binary: ArrayBuffer; contextId: string; environmentVersion: string; canonicalBuildCount: number })
  | (Routing & { kind: 'error'; requestId?: number; error: { name: string; message: string } });
export interface SurfaceWorkerPacket {
  format: 'magna-surface-packet'; version: 1; world: SurfaceWorld; urban: unknown;
  candidates: import('./model').SurfaceCandidate[]; candidateBounds: Bounds; source: Record<string, unknown>;
}

export function assertSurfaceWorkerRouting(message: SurfaceWorkerRequest): void {
  if (message.protocol !== SURFACE_WORKER_PROTOCOL || !['sessionId', 'sourceEpoch', 'sceneEpoch'].every(key => {
    const value = message[key as keyof SurfaceWorkerRequest]; return typeof value === 'string' && value.length > 0 && value.length <= 1024;
  })) throw new Error('Invalid surface worker protocol/session epochs');
}

export function surfaceWorkerBounds(region: SurfaceWorkerRegion): Bounds {
  if (!region || ![region.x, region.y, region.extent, region.resolution].every(Number.isFinite)
    || region.extent <= 0 || !Number.isInteger(region.resolution) || region.resolution < 4 || region.resolution > 1024
    || region.knownContextId !== undefined && (typeof region.knownContextId !== 'string' || region.knownContextId.length > 256)) throw new Error('Invalid live surface region');
  return { minX: region.x, minZ: region.y, maxX: region.x + region.extent, maxZ: region.y + region.extent };
}
