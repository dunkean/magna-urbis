import { assertNotAborted, type Bounds, type TerrainGrid } from './model';

export interface TerrainRequest {
  bounds: Bounds; spacingM: number; worldVersion: string; signal?: AbortSignal;
}
/** Infinite Generation adapter implements this contract; interpolation is never a new source LOD. */
export interface TerrainProvider {
  readonly id: string;
  request(request: TerrainRequest): Promise<TerrainGrid>;
}
export interface VersionedTerrainResult { worldVersion: string; requestId: number; terrain: TerrainGrid }

/** Suppresses late results after edit, navigation, cancellation or a newer request. */
export class SurfaceTerrainSession {
  private serial = 0;
  private controller?: AbortController;
  constructor(private provider: TerrainProvider, public worldVersion: string) {}
  invalidate(worldVersion: string): void {
    this.worldVersion = worldVersion;
    this.cancel();
  }
  cancel(): void { this.serial++; this.controller?.abort(); }
  async request(request: Omit<TerrainRequest, 'worldVersion'>): Promise<VersionedTerrainResult> {
    this.cancel();
    const requestId = this.serial;
    const worldVersion = this.worldVersion;
    const controller = new AbortController();
    this.controller = controller;
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) controller.abort();
    try {
      assertNotAborted(controller.signal);
      const terrain = await this.provider.request({ ...request, worldVersion, signal: controller.signal });
      assertNotAborted(controller.signal);
      if (requestId !== this.serial || worldVersion !== this.worldVersion) throw new DOMException('Stale surface result', 'AbortError');
      return { requestId, worldVersion, terrain };
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
    }
  }
}
