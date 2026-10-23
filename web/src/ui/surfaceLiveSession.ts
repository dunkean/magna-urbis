import type { Decor } from './decor';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import type { TerrainProvider } from '../surface/provider';
import type { SurfaceWorld } from '../surface/model';
import type { SurfaceLiveRegion } from '../../scripts/surface_live_plugin';
import { compileSurfaceWorld, retargetSurfaceWorld } from '../surface/compiler';
import { generateSurfaceCandidates } from '../surface/population';
import { decorToSurfaceInput, exportMagnaBuildings } from '../surface/adapters/magna';
import { occupationFromMagnaScene, type SurfaceRoad } from '../surface/adapters/occupation';

/** Retains a canonical context while actual Infinite Generation heights refine.
 * The provider must have been registered from this exact retained terrain. */
export function createSurfaceLiveSession(decor: Decor, scene: Building3dScene | undefined,
  provider: TerrainProvider, isCurrent: () => boolean) {
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
