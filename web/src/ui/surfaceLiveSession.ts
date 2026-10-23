import type { Decor } from './decor';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import type { TerrainProvider } from '../surface/provider';
import type { SurfaceWorld } from '../surface/model';
import type { SurfaceLiveRegion } from '../../scripts/surface_live_plugin';
import { compileSurfaceWorld, retargetSurfaceWorld } from '../surface/compiler';
import { generateSurfaceCandidates } from '../surface/population';
import { decorToSurfaceInput, exportMagnaBuildings } from '../surface/adapters/magna';
import { occupationFromMagnaScene, type SurfaceRoad } from '../surface/adapters/occupation';
import { SurfaceCompilerClient, type SurfaceCompilerWorker } from '../surface/workerClient';
import { createSurfaceWorkerProcessor } from '../surface/workerProcessor';
import { SURFACE_WORKER_PROTOCOL, surfaceWorkerBounds, type SurfaceWorkerInitialization } from '../surface/workerProtocol';
import { prepareSurfaceDecorWorkerSource, type SurfaceDecorWorkerSource } from './surfaceWorkerSource';

/** Explicit synchronous Node/offline compatibility path. Browser callers use createSurfaceLiveBinarySession.
 * The provider must have been registered from this exact retained terrain. */
export function createSurfaceLiveSession(decor: Decor, scene: Building3dScene | undefined,
  provider: TerrainProvider, isCurrent: () => boolean) {
  if (typeof window !== 'undefined') throw new Error('Browser surface compilation requires createSurfaceLiveBinarySession and its dedicated worker');
  let canonical: SurfaceWorld | undefined;
  const sourceInput = decorToSurfaceInput(decor);
  const roads: SurfaceRoad[] = (decor.meta.roads?.segments ?? []).map(road => ({ points: road.path.map(p => [p.x, p.y]), widthM: road.width }));
  const buildings = scene ?? { buildings: [] };
  sourceInput.occupation = occupationFromMagnaScene(sourceInput.terrain, buildings, roads, sourceInput.occupation);
  const urban = { ...exportMagnaBuildings(buildings), roads };
  const assertCurrent = (signal: AbortSignal) => {
    if (signal.aborted || !isCurrent()) throw new DOMException('Terrain or city changed during surface generation', 'AbortError');
  };
  return async (region: SurfaceLiveRegion, signal: AbortSignal) => {
    assertCurrent(signal);
    if (![region.x, region.y, region.extent, region.resolution].every(Number.isFinite)
      || region.extent <= 0 || !Number.isInteger(region.resolution) || region.resolution < 4 || region.resolution > 1024)
      throw new Error('Invalid live surface region');
    const bounds = { minX: region.x, minZ: region.y, maxX: region.x + region.extent, maxZ: region.y + region.extent };
    const footprint = { minX: sourceInput.terrain.originX - sourceInput.terrain.spacingM / 2,
      minZ: sourceInput.terrain.originZ - sourceInput.terrain.spacingM / 2,
      maxX: sourceInput.terrain.originX + (sourceInput.terrain.width - .5) * sourceInput.terrain.spacingM,
      maxZ: sourceInput.terrain.originZ + (sourceInput.terrain.height - .5) * sourceInput.terrain.spacingM };
    if (bounds.minX < footprint.minX || bounds.minZ < footprint.minZ || bounds.maxX > footprint.maxX || bounds.maxZ > footprint.maxZ)
      throw new RangeError('Live request extends outside the retained world context');
    const terrain = await provider.request({ bounds, spacingM: region.extent / region.resolution,
      worldVersion: canonical?.versions.environment ?? decor.meta.id, signal });
    assertCurrent(signal);
    if (!canonical || canonical.terrain.source.id !== terrain.source.id || canonical.terrain.source.version !== terrain.source.version) {
      // This binding is warranted by provider registration from the same retained
      // field, not guessed from seed or display resolution. Original capture ID
      // remains in source.meta below. The capture's original LOD stays unknown.
      const source = { ...sourceInput.terrain.source, id: terrain.source.id, version: terrain.source.version,
        provenance: `${sourceInput.terrain.source.provenance}; registered retained field lineage=${terrain.source.id}` };
      canonical = compileSurfaceWorld({ ...sourceInput, terrain: { ...sourceInput.terrain, source } }, { signal });
    }
    const world = retargetSurfaceWorld(canonical, terrain, { signal });
    assertCurrent(signal);
    const b = world.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const radius = Math.min(240, region.extent / 2);
    const candidateBounds = { minX: Math.max(b.minX, cx - radius), maxX: Math.min(b.maxX, cx + radius),
      minZ: Math.max(b.minZ, cz - radius), maxZ: Math.min(b.maxZ, cz + radius) };
    const candidates = generateSurfaceCandidates(world, candidateBounds, { maxCandidates: 100000, signal });
    assertCurrent(signal);
    const contextId = world.canonicalContextRef!.id;
    return { format: 'magna-surface-packet', version: 1,
      world: { ...world, canonicalContext: region.knownContextId === contextId ? undefined : world.canonicalContext },
      urban, candidates, candidateBounds,
      source: { meta: decor.meta, originalSource: sourceInput.terrain.source, live: true,
        provider: provider.id, canonicalContextId: contextId, request: { ...region } } };
  };
}

export interface SurfaceLiveCompilerOptions {
  sourceEpoch?: string; sceneEpoch?: string;
  /** Browser production defaults to a real worker. The synchronous path must be explicitly requested by Node/offline tests. */
  execution?: 'worker' | 'synchronous-node';
  workerFactory?: () => SurfaceCompilerWorker;
}

/** Live browser path: asynchronous generation provider, interruptible compiler worker, transferred MUFSURF1 bytes. */
export function createSurfaceLiveBinarySession(decor: Decor, scene: Building3dScene | undefined,
  provider: TerrainProvider, isCurrent: () => boolean, options: SurfaceLiveCompilerOptions = {}) {
  const initialization: SurfaceWorkerInitialization<SurfaceDecorWorkerSource> = {
    sourceEpoch: options.sourceEpoch ?? decor.meta.id, sceneEpoch: options.sceneEpoch ?? 'retained-scene-1',
    payload: { decor, scene, providerId: provider.id },
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
        const result = await compiler.compile({ terrain, region }, controller.signal);
        assertCurrent(controller.signal, id);
        return result.binary;
      }
      if (!initialized) {
        const response = processor!.handle({ protocol: SURFACE_WORKER_PROTOCOL, kind: 'initialize', sessionId: 'explicit-node-sync', ...initialization });
        if (response.kind === 'error') throw new Error(response.error.message);
        initialized = true;
      }
      const response = processor!.handle({ protocol: SURFACE_WORKER_PROTOCOL, kind: 'compile', sessionId: 'explicit-node-sync',
        sourceEpoch: initialization.sourceEpoch, sceneEpoch: initialization.sceneEpoch, requestId: id, terrain, region });
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
