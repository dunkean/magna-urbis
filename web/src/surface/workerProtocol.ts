import type { Bounds, CompileOptions, SurfaceCompileInput, SurfaceWorld, TerrainGrid } from './model';
import type { SurfaceRegistrationBinding } from './registrationBinding';

export const SURFACE_WORKER_PROTOCOL = 1 as const;
export interface SurfaceWorkerEpochs { sourceEpoch: string; sceneEpoch: string }
export interface SurfaceWorkerRegion { x: number; y: number; extent: number; resolution: number; knownContextId?: string; knownSceneContextId?: string; preview?: boolean }
export interface SurfaceWorkerInitialization<Payload = unknown> extends SurfaceWorkerEpochs { payload: Payload }
export interface PreparedSurfaceWorkerSource {
  input: SurfaceCompileInput; parentTerrain?: TerrainGrid; providerId: string; urban?: unknown; urbanId?: string; sourceMetadata?: Record<string, unknown>;
  /** Only an adapter that registered this exact retained source may bind its capture identity to a provider generation. */
  registrationBinding?: Readonly<SurfaceRegistrationBinding>;
  compileOptions?: Omit<CompileOptions, 'signal'>;
}
interface Routing extends SurfaceWorkerEpochs { protocol: typeof SURFACE_WORKER_PROTOCOL; sessionId: string }
export interface SurfaceWorkerInit extends Routing { kind: 'initialize'; payload: unknown }
export interface SurfaceWorkerJob extends Routing {
  kind: 'compile'; requestId: number; terrain: TerrainGrid; region: SurfaceWorkerRegion;
  maxCandidates?: number; maxCheckedSlots?: number; binaryBudgetBytes?: number; memoryBudgetBytes?: number;
  registrationBinding?: Readonly<SurfaceRegistrationBinding>;
  presentation?: import('./presentation').SurfacePresentation;
}
export type SurfaceWorkerRequest = SurfaceWorkerInit | SurfaceWorkerJob;
export type SurfaceWorkerResponse =
  | (Routing & { kind: 'initialized' })
  | (Routing & { kind: 'compiled'; requestId: number; binary: ArrayBuffer; contextId: string; environmentVersion: string; canonicalBuildCount: number })
  | (Routing & { kind: 'error'; requestId?: number; error: { name: string; message: string } });
export interface SurfaceWorkerPacket {
  format: 'magna-surface-packet'; version: 1; world: SurfaceWorld; urban?: unknown;
  terrainParents?: Array<{ terrain: TerrainGrid; bounds: Bounds; canonicalContextId: string }>;
  candidates?: import('./model').SurfaceCandidate[]; candidateColumns?: import('./candidateColumns').CandidateColumns;
  urbanId?: string; presentation?: import('./presentation').SurfacePresentation;
  candidateBounds: Bounds; source: Record<string, unknown>;
  candidatePages?: import('./candidatePages').SurfaceCandidatePages;
}

export function assertSurfaceWorkerRouting(message: SurfaceWorkerRequest): void {
  if (message.protocol !== SURFACE_WORKER_PROTOCOL || !['sessionId', 'sourceEpoch', 'sceneEpoch'].every(key => {
    const value = message[key as keyof SurfaceWorkerRequest]; return typeof value === 'string' && value.length > 0 && value.length <= 1024;
  })) throw new Error('Invalid surface worker protocol/session epochs');
}

export function surfaceWorkerBounds(region: SurfaceWorkerRegion): Bounds {
  if (!region || ![region.x, region.y, region.extent, region.resolution].every(Number.isFinite)
    || region.extent <= 0 || !Number.isInteger(region.resolution) || region.resolution < 4 || region.resolution > 1024 || region.preview!==undefined&&typeof region.preview!=='boolean'
    || ['knownContextId', 'knownSceneContextId'].some(key => { const v = region[key as keyof SurfaceWorkerRegion]; return v !== undefined && (typeof v !== 'string' || v.length > 256); })) throw new Error('Invalid live surface region');
  return { minX: region.x, minZ: region.y, maxX: region.x + region.extent, maxZ: region.y + region.extent };
}

