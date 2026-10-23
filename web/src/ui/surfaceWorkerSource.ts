import type { Decor } from './decor';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { decorToSurfaceInput, exportMagnaBuildings } from '../surface/adapters/magna';
import { occupationFromMagnaScene, type SurfaceRoad } from '../surface/adapters/occupation';
import type { PreparedSurfaceWorkerSource } from '../surface/workerProtocol';
import { archiveSurfaceSource } from '../surface/adapters/sourceArchive';

export interface SurfaceDecorWorkerSource { decor: Decor; scene?: Building3dScene; providerId: string }

/** Runs inside the compiler worker: occupation rasters and urban geometry export do not block the UI. */
export function prepareSurfaceDecorWorkerSource(value: unknown): PreparedSurfaceWorkerSource {
  const payload = value as SurfaceDecorWorkerSource;
  if (!payload?.decor?.raster || typeof payload.providerId !== 'string' || !payload.providerId.length) throw new Error('Invalid retained surface worker source');
  const { decor, scene } = payload;
  const input = decorToSurfaceInput(decor);
  const roads: SurfaceRoad[] = (decor.meta.roads?.segments ?? []).map(road => ({ points: road.path.map(p => [p.x, p.y]), widthM: road.width }));
  const buildings = scene ?? { buildings: [] };
  input.occupation = occupationFromMagnaScene(input.terrain, buildings, roads, input.occupation);
  return { input, providerId: payload.providerId, registeredSourceBinding: true,
    urban: { ...exportMagnaBuildings(buildings), roads }, sourceMetadata: archiveSurfaceSource({ meta: decor.meta }) };
}
