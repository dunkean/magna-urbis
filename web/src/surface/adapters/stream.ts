import type { TerrainProvider } from '../provider';
import { assertNotAborted, type Bounds, type TerrainGrid } from '../model';

export interface SurfaceStreamRequest {
  id: string; worldId: string; bounds: Bounds; resolutionM: number;
  /** Informational request hint; provider response always reports the actual source level. */
  sourceLOD?: number;
}
export interface SurfaceStreamResponse<T> { id: string; worldId: string; sourceLOD: number; payload: T }

/** Transport-independent bridge: JSON file watcher, HTTP or browser worker can
 * use this handler. The publisher checks the world epoch again after compilation. */
export function createSurfaceStreamHandler<T>(provider: TerrainProvider, currentWorldId: () => string,
  compile: (terrain: TerrainGrid, request: SurfaceStreamRequest) => Promise<T> | T) {
  return async (request: SurfaceStreamRequest, signal?: AbortSignal): Promise<SurfaceStreamResponse<T>> => {
    if (!request.id || request.worldId !== currentWorldId()) throw new Error('Stale surface world request.');
    assertNotAborted(signal);
    const terrain = await provider.request({ bounds: request.bounds, spacingM: request.resolutionM,
      worldVersion: request.worldId, signal });
    assertNotAborted(signal);
    const payload = await compile(terrain, request);
    assertNotAborted(signal);
    if (request.worldId !== currentWorldId()) throw new Error('Stale surface world response.');
    return { id: request.id, worldId: request.worldId, sourceLOD: terrain.source.sourceLOD, payload };
  };
}
