import type { TerrainProvider } from '../provider';
import { assertNotAborted, type Bounds, type TerrainGrid } from '../model';

export interface SurfaceStreamRequest {
  id: string; worldId: string; bounds: Bounds; resolutionM: number;
  /** Informational request hint; provider response always reports the actual source level. */
  sourceLOD?: number;
}
export interface SurfaceStreamResponse<T> { id: string; worldId: string; sourceLOD: number; sourceLODKnown?: boolean; nativeSpacingM: number; payload: T }

/** Transport-independent bridge: JSON file watcher, HTTP or browser worker can
 * use this handler. The publisher checks the world epoch again after compilation. */
export function createSurfaceStreamHandler<T>(provider: TerrainProvider, currentWorldId: () => string,
  compile: (terrain: TerrainGrid, request: SurfaceStreamRequest) => Promise<T> | T) {
  return async (request: SurfaceStreamRequest, signal?: AbortSignal): Promise<SurfaceStreamResponse<T>> => {
    if (!request.id || request.worldId !== currentWorldId()) throw new DOMException('Stale surface world request.', 'AbortError');
    const b = request.bounds;
    if (!b || ![b.minX, b.minZ, b.maxX, b.maxZ, request.resolutionM].every(Number.isFinite) || b.maxX <= b.minX || b.maxZ <= b.minZ || request.resolutionM <= 0) throw new Error('Invalid surface stream bounds or resolution.');
    assertNotAborted(signal);
    let terrain: TerrainGrid;
    try { terrain = await provider.request({ bounds: request.bounds, spacingM: request.resolutionM, worldVersion: request.worldId, signal }); }
    catch (error) { if (signal?.aborted || request.worldId !== currentWorldId()) throw new DOMException('Stale surface world response.', 'AbortError'); throw error; }
    assertNotAborted(signal);
    const payload = await compile(terrain, request);
    assertNotAborted(signal);
    if (request.worldId !== currentWorldId()) throw new DOMException('Stale surface world response.', 'AbortError');
    return { id: request.id, worldId: request.worldId, sourceLOD: terrain.source.sourceLOD,
      sourceLODKnown: terrain.source.sourceLODKnown, nativeSpacingM: terrain.source.nativeSpacingM, payload };
  };
}
