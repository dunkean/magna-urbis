import type { Decor } from './decor';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import type { TerrainProvider } from '../surface/provider';
import type { TerrainGrid } from '../surface/model';
import type { SurfaceRegistrationBinding } from '../surface/registrationBinding';
import type { SurfaceLiveRegion } from '../../scripts/surface_live_plugin';
import { SurfaceCompilerClient, type SurfaceCompilerWorker } from '../surface/workerClient';
import { createSurfaceWorkerProcessor } from '../surface/workerProcessor';
import { SURFACE_WORKER_PROTOCOL, surfaceWorkerBounds, type SurfaceWorkerInitialization } from '../surface/workerProtocol';
import { prepareSurfaceDecorWorkerSource, type SurfaceDecorWorkerSource } from './surfaceWorkerSource';

/** Explicit synchronous Node/offline compatibility path. Browser callers use createSurfaceLiveBinarySession.
 * The provider must have been registered from this exact retained terrain. */
export function createSurfaceLiveSession(decor: Decor, scene: Building3dScene | undefined,
  provider: TerrainProvider, isCurrent: () => boolean) {
  if (typeof window !== 'undefined') throw new Error('Browser surface compilation requires createSurfaceLiveBinarySession and its dedicated worker');
  const bindingProvider = provider as TerrainProvider & { readonly registrationBinding?: Readonly<SurfaceRegistrationBinding>; readonly registrationParent?: TerrainGrid };
  const initialization = { protocol: SURFACE_WORKER_PROTOCOL, kind: 'initialize' as const, sessionId: 'explicit-node-object',
    sourceEpoch: decor.meta.id, sceneEpoch: 'retained-scene-1', payload: { decor, scene, providerId: provider.id, registrationBinding: bindingProvider.registrationBinding, parentTerrain: bindingProvider.registrationParent } };
  const processor = createSurfaceWorkerProcessor(prepareSurfaceDecorWorkerSource);
  const ready = processor.handle(initialization);
  if (ready.kind === 'error') throw new Error(ready.error.message);
  let serial = 0;
  return async (region: SurfaceLiveRegion, signal: AbortSignal) => {
    if (signal.aborted || !isCurrent()) throw new DOMException('Terrain or city changed during surface generation', 'AbortError');
    const terrain = await provider.request({ bounds: surfaceWorkerBounds(region), spacingM: region.extent / region.resolution,
      worldVersion: decor.meta.id, signal });
    if (signal.aborted || !isCurrent()) throw new DOMException('Terrain or city changed during surface generation', 'AbortError');
    return processor.packetFor({ protocol: SURFACE_WORKER_PROTOCOL, kind: 'compile', sessionId: initialization.sessionId,
      sourceEpoch: initialization.sourceEpoch, sceneEpoch: initialization.sceneEpoch, requestId: ++serial,
      terrain, region, registrationBinding: bindingProvider.registrationBinding });
  };
}

export interface SurfaceLiveCompilerOptions {
  sourceEpoch?: string; sceneEpoch?: string; registrationBinding?: Readonly<SurfaceRegistrationBinding>;
  /** Mapper styles change independently of the cached physical context. */
  presentation?: () => import('../surface/presentation').SurfacePresentation;
  /** Browser production defaults to a real worker. The synchronous path must be explicitly requested by Node/offline tests. */
  execution?: 'worker' | 'synchronous-node';
  workerFactory?: () => SurfaceCompilerWorker;
}

/** Live browser path: asynchronous generation provider, interruptible compiler worker, transferred MUFSURF1 bytes. */
export function createSurfaceLiveBinarySession(decor: Decor, scene: Building3dScene | undefined,
  provider: TerrainProvider, isCurrent: () => boolean, options: SurfaceLiveCompilerOptions = {}) {
  const bindingProvider = provider as TerrainProvider & { readonly registrationBinding?: Readonly<SurfaceRegistrationBinding>; readonly registrationParent?: TerrainGrid };
  const initialization: SurfaceWorkerInitialization<SurfaceDecorWorkerSource> = {
    sourceEpoch: options.sourceEpoch ?? decor.meta.id, sceneEpoch: options.sceneEpoch ?? 'retained-scene-1',
    payload: { decor, scene, providerId: provider.id, registrationBinding: options.registrationBinding ?? bindingProvider.registrationBinding, parentTerrain: bindingProvider.registrationParent },
  };
  const synchronous = options.execution === 'synchronous-node';
  if (synchronous && typeof window !== 'undefined') throw new Error('Synchronous surface compilation is restricted to explicit Node/offline use');
  const factory = options.workerFactory ?? (() => {
    if (typeof Worker === 'undefined') throw new Error('Surface compilation requires a Worker; Node tests may explicitly select synchronous-node');
    return new Worker(new URL('./surfaceCompiler.worker.ts', import.meta.url), { type: 'module' }) as unknown as SurfaceCompilerWorker;
  });
  const compiler = synchronous ? undefined : new SurfaceCompilerClient(initialization, factory);
  const processor = synchronous ? createSurfaceWorkerProcessor(prepareSurfaceDecorWorkerSource) : undefined;
  let initialized = false, active: AbortController | undefined, serial = 0, disposed = false, environmentVersion: string | undefined;
  const assertCurrent = (signal: AbortSignal, id: number) => {
    if (disposed || signal.aborted || id !== serial || !isCurrent()) throw new DOMException('Terrain or city changed during surface generation', 'AbortError');
  };
  const handler = async (region: SurfaceLiveRegion, signal: AbortSignal): Promise<ArrayBuffer> => {
    if (signal.aborted || disposed || !isCurrent()) throw new DOMException('Surface session is cancelled or stale', 'AbortError');
    const bounds = surfaceWorkerBounds(region), width = decor.raster.width;
    if (bounds.minX < 0 || bounds.minZ < 0 || bounds.maxX > width || bounds.maxZ > width) throw new RangeError('Live request extends outside the retained world context');
    active?.abort(); compiler?.cancel();
    const controller = new AbortController(), id = ++serial; active = controller;
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    // Existing callers supply an identity predicate rather than an invalidation event.
    // Poll only during active work, so an edited source/scene terminates the worker promptly.
    const currentTimer = setInterval(() => { if (!isCurrent()) controller.abort(); }, 25);
    try {
      const terrain = await provider.request({ bounds, spacingM: region.extent / region.resolution,
        worldVersion: compiler?.environmentVersion ?? environmentVersion ?? decor.meta.id, signal: controller.signal });
      assertCurrent(controller.signal, id);
      if (compiler) {
        const result = await compiler.compile({ terrain, region, registrationBinding: bindingProvider.registrationBinding ?? options.registrationBinding, presentation: options.presentation?.() }, controller.signal);
        assertCurrent(controller.signal, id);
        return result.binary;
      }
      if (!initialized) {
        const response = processor!.handle({ protocol: SURFACE_WORKER_PROTOCOL, kind: 'initialize', sessionId: 'explicit-node-sync', ...initialization });
        if (response.kind === 'error') throw new Error(response.error.message);
        initialized = true;
      }
      const response = processor!.handle({ protocol: SURFACE_WORKER_PROTOCOL, kind: 'compile', sessionId: 'explicit-node-sync',
        sourceEpoch: initialization.sourceEpoch, sceneEpoch: initialization.sceneEpoch, requestId: id, terrain, region, registrationBinding: bindingProvider.registrationBinding ?? options.registrationBinding, presentation: options.presentation?.() });
      if (response.kind !== 'compiled') throw new Error(response.kind === 'error' ? response.error.message : 'No synchronous surface result');
      environmentVersion = response.environmentVersion;
      assertCurrent(controller.signal, id);
      return response.binary;
    } catch (error) {
      if (controller.signal.aborted || id !== serial || !isCurrent()) throw new DOMException('Surface session cancelled or superseded', 'AbortError');
      throw error;
    } finally {
      clearInterval(currentTimer); signal.removeEventListener('abort', abort);
      if (active === controller) active = undefined;
    }
  };
  return Object.assign(handler, {
    execution: synchronous ? 'synchronous-node' as const : 'worker' as const,
    dispose() { disposed = true; serial++; active?.abort(); compiler?.dispose(); },
  });
}
